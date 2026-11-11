import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { organizationRepository, orgMembershipRepository, orgRoleRepository, OrgInviteModel, UserModel } from "@tbook/db";
import {
  DEFAULT_BOOKING_EMAIL_TEMPLATE,
  isBlankEmailBody,
  renderBookingEmail,
  resolveBookingEmailTemplate,
  sampleBookingEmailValues,
  type BookingEmailTemplate,
} from "@tbook/domain";
import { currencySchema, normalizeVoucherPdfLayout, voucherPdfLayoutSchema, type VoucherPdfLayout } from "@tbook/schemas";
import { sendMail, type MailTransporter } from "./mailer";
import { encryptOrgSecret, maskSecret } from "./org-secrets";
import { assertLayoutImages } from "./voucher-pdf-assets";

/**
 * Organization settings as the console edits them: general details,
 * Stripe, SMTP, Számlázz.hu and the booking email. Secrets are never sent
 * back to the browser — views carry a mask, and a blank secret on save
 * keeps the stored value (same rule as SumUp).
 */

export type SecretMask = ReturnType<typeof maskSecret>;

export interface OrganizationSettingsView {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  currency: string;
  stripe: { enabled: boolean; publishableKey: string; secretKey: SecretMask; webhookSecret: SecretMask };
  smtp: { host: string; port: number; user: string; pass: SecretMask; fromEmail: string; fromName: string };
  szamlazz: {
    enabled: boolean;
    agentKey: SecretMask;
    sellerName: string;
    sellerBank: string;
    sellerBankAccount: string;
    receiptPrefix: string;
    receiptTemplate: "A" | "N";
  };
  bookingEmail: BookingEmailTemplate & { isCustom: boolean };
}

async function loadOrg(organizationId: string) {
  const org = await organizationRepository.findById(organizationId);
  if (!org) throw ActionError.notFound("Organization not found");
  return org;
}

/** Keeps the stored secret when the field was left blank. */
function nextSecret(input: string | undefined, stored: string | undefined | null): string {
  return input?.trim() ? encryptOrgSecret(input.trim()) : (stored ?? "");
}

export async function getOrganizationSettings(organizationId: string): Promise<OrganizationSettingsView> {
  const org = await loadOrg(organizationId);
  const s = org.settings ?? {};
  const templates = s.emailTemplates;
  const custom = templates?.bookingConfirmation ?? templates?.voucherDelivery ?? null;
  return {
    id: String(org._id),
    name: org.name,
    slug: org.slug,
    status: org.status,
    currency: s.currency ?? "HUF",
    stripe: {
      enabled: s.stripe?.enabled ?? false,
      publishableKey: s.stripe?.publishableKey ?? "",
      secretKey: maskSecret(s.stripe?.secretKeyEnc),
      webhookSecret: maskSecret(s.stripe?.webhookSecretEnc),
    },
    smtp: {
      host: s.smtp?.host ?? "",
      port: s.smtp?.port ?? 587,
      user: s.smtp?.user ?? "",
      pass: maskSecret(s.smtp?.passEnc),
      fromEmail: s.smtp?.fromEmail ?? "",
      fromName: s.smtp?.fromName ?? "",
    },
    szamlazz: {
      enabled: s.szamlazz?.enabled ?? false,
      agentKey: maskSecret(s.szamlazz?.agentKeyEnc),
      sellerName: s.szamlazz?.sellerName ?? "",
      sellerBank: s.szamlazz?.sellerBank ?? "",
      sellerBankAccount: s.szamlazz?.sellerBankAccount ?? "",
      receiptPrefix: s.szamlazz?.receiptPrefix ?? "NYGTA",
      receiptTemplate: s.szamlazz?.receiptTemplate === "N" ? "N" : "A",
    },
    bookingEmail: {
      ...resolveBookingEmailTemplate(templates?.bookingConfirmation, templates?.voucherDelivery),
      isCustom: Boolean(custom && (custom.subject?.trim() || !isBlankEmailBody(custom.body))),
    },
  };
}

export async function saveGeneralSettings(organizationId: string, input: { name: string; currency: string }): Promise<void> {
  await loadOrg(organizationId);
  const name = input.name.trim();
  if (!name) throw ActionError.validation("The organization needs a name.");
  const currency = input.currency.trim().toUpperCase();
  if (!currencySchema.safeParse(currency).success) throw ActionError.validation("Currency must be a 3-letter code, like HUF or EUR.");
  await organizationRepository.updateById(organizationId, { name, "settings.currency": currency } as never);
}

export async function saveStripeSettings(
  organizationId: string,
  input: { enabled: boolean; publishableKey: string; secretKey?: string; webhookSecret?: string },
): Promise<void> {
  const org = await loadOrg(organizationId);
  const current = org.settings?.stripe;
  const secretKeyEnc = nextSecret(input.secretKey, current?.secretKeyEnc);
  const webhookSecretEnc = nextSecret(input.webhookSecret, current?.webhookSecretEnc);

  if (input.secretKey?.trim() && !/^(sk|rk)_(test|live)_/.test(input.secretKey.trim())) {
    throw ActionError.validation("The secret key should start with sk_live_, sk_test_ or rk_….");
  }
  if (input.webhookSecret?.trim() && !input.webhookSecret.trim().startsWith("whsec_")) {
    throw ActionError.validation("The webhook signing secret should start with whsec_.");
  }
  if (input.enabled && (!secretKeyEnc || !webhookSecretEnc)) {
    throw ActionError.validation("To use your own Stripe account, save both the secret key and the webhook signing secret.");
  }

  await organizationRepository.updateById(organizationId, {
    "settings.stripe": { enabled: input.enabled, publishableKey: input.publishableKey.trim(), secretKeyEnc, webhookSecretEnc },
  } as never);
}

export async function saveSmtpSettings(
  organizationId: string,
  input: { host: string; port: number; user: string; pass?: string; fromEmail: string; fromName: string },
): Promise<void> {
  const org = await loadOrg(organizationId);
  const host = input.host.trim();
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw ActionError.validation("Port must be a number between 1 and 65535.");
  const passEnc = nextSecret(input.pass, org.settings?.smtp?.passEnc);
  if (host && (!input.user.trim() || !passEnc)) {
    throw ActionError.validation("Fill in the username and password for the SMTP server.");
  }

  await organizationRepository.updateById(organizationId, {
    "settings.smtp": {
      host,
      port,
      user: input.user.trim(),
      passEnc,
      fromEmail: input.fromEmail.trim(),
      fromName: input.fromName.trim(),
    },
  } as never);
}

/** Sends a short test message through the org's SMTP (or the platform's, when the org has none). */
export async function sendSmtpTestEmail(organizationId: string, to: string, transporter?: MailTransporter): Promise<void> {
  const org = await loadOrg(organizationId);
  if (!to.trim()) throw ActionError.validation("Enter an address to send the test to.");
  await sendMail(
    organizationId,
    {
      to: to.trim(),
      subject: `tBook test email from ${org.name}`,
      html: `<p>This is a test email from <strong>${org.name.replace(/</g, "&lt;")}</strong>. Your email settings work.</p>`,
    },
    transporter,
  );
}

export async function saveSzamlazzSettings(
  organizationId: string,
  input: {
    enabled: boolean;
    agentKey?: string;
    sellerName: string;
    sellerBank: string;
    sellerBankAccount: string;
    receiptPrefix?: string;
    receiptTemplate?: string;
  },
): Promise<void> {
  const org = await loadOrg(organizationId);
  const current = org.settings?.szamlazz;
  const agentKeyEnc = nextSecret(input.agentKey, current?.agentKeyEnc);
  if (input.enabled && !agentKeyEnc) throw ActionError.validation("To issue invoices, save a Számlázz.hu agent key.");
  const receiptPrefix = (input.receiptPrefix ?? current?.receiptPrefix ?? "NYGTA").trim() || "NYGTA";
  if (!/^[A-Za-z0-9]{1,10}$/.test(receiptPrefix)) {
    throw ActionError.validation("The receipt prefix may only contain letters and digits (up to 10), e.g. NYGTA.");
  }

  await organizationRepository.updateById(organizationId, {
    "settings.szamlazz": {
      enabled: input.enabled,
      agentKeyEnc,
      sellerName: input.sellerName.trim(),
      sellerBank: input.sellerBank.trim(),
      sellerBankAccount: input.sellerBankAccount.trim(),
      vatPercent: current?.vatPercent ?? 27,
      receiptPrefix,
      receiptTemplate: (input.receiptTemplate ?? current?.receiptTemplate) === "N" ? "N" : "A",
    },
  } as never);
}

/** Saves the booking email. Saving the default text unchanged, or blank fields, means "use the default". */
export async function saveBookingEmailTemplate(organizationId: string, input: { subject: string; body: string }): Promise<void> {
  await loadOrg(organizationId);
  const subject = input.subject.trim();
  const body = isBlankEmailBody(input.body) ? "" : input.body;
  if (body.length > 100_000) throw ActionError.validation("The email body is too long.");
  const isDefault =
    (!subject || subject === DEFAULT_BOOKING_EMAIL_TEMPLATE.subject) && (!body || body === DEFAULT_BOOKING_EMAIL_TEMPLATE.body);

  await organizationRepository.updateById(organizationId, {
    "settings.emailTemplates.bookingConfirmation": isDefault ? null : { subject, body },
    // The old ticket-only template would otherwise win as a fallback after a reset.
    "settings.emailTemplates.voucherDelivery": null,
  } as never);
}

/** Mails the (unsaved) draft, filled with sample values, so an admin can check it in a real inbox. */
export async function sendBookingEmailTest(
  organizationId: string,
  to: string,
  draft: { subject: string; body: string },
  transporter?: MailTransporter,
): Promise<void> {
  const org = await loadOrg(organizationId);
  if (!to.trim()) throw ActionError.validation("Your account has no email address to send the test to.");
  const template = resolveBookingEmailTemplate(draft);
  const rendered = renderBookingEmail(template, { ...sampleBookingEmailValues(), organizationName: org.name });
  await sendMail(organizationId, { to: to.trim(), subject: `[Test] ${rendered.subject}`, html: rendered.body }, transporter);
}

// ---- Voucher PDF ------------------------------------------------------------

/** The org's voucher PDF layout; the shipped default when it never customised one. */
export async function getVoucherPdfLayout(organizationId: string): Promise<{ layout: VoucherPdfLayout; isCustom: boolean }> {
  const org = await loadOrg(organizationId);
  const stored = org.settings?.voucherPdfLayout ?? null;
  return { layout: normalizeVoucherPdfLayout(stored), isCustom: Boolean(stored) };
}

/** Saves the layout, or resets to the default when `layout` is null. */
export async function saveVoucherPdfLayout(organizationId: string, layout: unknown | null): Promise<void> {
  await loadOrg(organizationId);
  if (layout === null) {
    await organizationRepository.updateById(organizationId, { "settings.voucherPdfLayout": null } as never);
    return;
  }
  const parsed = voucherPdfLayoutSchema.safeParse(layout);
  if (!parsed.success) throw ActionError.validation("The voucher layout isn't valid.");
  const value = parsed.data;
  if (value.margin < 12 || value.margin > 120) throw ActionError.validation("The margin must be between 12 and 120 points.");
  if (value.blocks.length === 0 || value.blocks.length > 40) throw ActionError.validation("A voucher needs between 1 and 40 blocks.");
  if (!value.blocks.some((block) => block.type === "qrCode" && block.enabled)) {
    throw ActionError.validation("Keep the QR code block on — without it the voucher can't be scanned at the door.");
  }
  await assertLayoutImages(organizationId, value);
  await organizationRepository.updateById(organizationId, { "settings.voucherPdfLayout": value } as never);
}

// ---- Members ---------------------------------------------------------------

export interface MemberView {
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  status: string;
  roleIds: string[];
}

export async function listMembers(organizationId: string): Promise<MemberView[]> {
  const memberships = await orgMembershipRepository.findByOrganizationId(organizationId);
  const users = await UserModel.find({ _id: { $in: memberships.map((m) => m.userId) } }).exec();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  return memberships
    .map((m) => {
      const user = byId.get(String(m.userId));
      return {
        membershipId: String(m._id),
        userId: String(m.userId),
        email: user?.email ?? "",
        name: user?.name ?? "",
        status: m.status,
        roleIds: m.roleIds.map(String),
      };
    })
    .sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || a.email.localeCompare(b.email));
}

/** Changes a member's roles, refusing to leave the organization without an active Owner. */
export async function setMemberRoles(organizationId: string, membershipId: string, roleIds: string[]): Promise<void> {
  if (roleIds.length === 0) throw ActionError.validation("Give the member at least one role.");
  const [memberships, roles] = await Promise.all([
    orgMembershipRepository.findByOrganizationId(organizationId),
    orgRoleRepository.findByOrganizationId(organizationId),
  ]);
  const membership = memberships.find((m) => String(m._id) === membershipId);
  if (!membership) throw ActionError.notFound("Member not found");
  const orgRoleIds = new Set(roles.map((r) => String(r._id)));
  if (!roleIds.every((id) => orgRoleIds.has(id))) throw ActionError.validation("Unknown role.");

  const ownerId = roles.find((r) => r.isBuiltIn && r.name === "Owner")?._id;
  if (ownerId) {
    const ownersAfter = memberships.filter((m) => {
      if (m.status !== "active") return false;
      const ids = String(m._id) === membershipId ? roleIds : m.roleIds.map(String);
      return ids.includes(String(ownerId));
    });
    if (ownersAfter.length === 0) throw ActionError.validation("The organization must keep at least one Owner.");
  }

  await orgMembershipRepository.updateById(membershipId, { roleIds: roleIds.map((id) => new Types.ObjectId(id)) });
}

/** Disables (does not delete) a membership; refuses to remove the last Owner. */
export async function deactivateMember(organizationId: string, membershipId: string): Promise<void> {
  const [memberships, roles] = await Promise.all([
    orgMembershipRepository.findByOrganizationId(organizationId),
    orgRoleRepository.findByOrganizationId(organizationId),
  ]);
  const membership = memberships.find((m) => String(m._id) === membershipId);
  if (!membership) throw ActionError.notFound("Member not found");
  const ownerId = String(roles.find((r) => r.isBuiltIn && r.name === "Owner")?._id ?? "");
  const remainingOwners = memberships.filter(
    (m) => m.status === "active" && String(m._id) !== membershipId && m.roleIds.map(String).includes(ownerId),
  );
  if (ownerId && membership.roleIds.map(String).includes(ownerId) && remainingOwners.length === 0) {
    throw ActionError.validation("You can't remove the last Owner.");
  }
  await orgMembershipRepository.updateById(membershipId, { status: "disabled" });
}

export async function revokeInvite(organizationId: string, inviteId: string): Promise<void> {
  const result = await OrgInviteModel.deleteOne({ _id: inviteId, organizationId, acceptedAt: null }).exec();
  if (result.deletedCount === 0) throw ActionError.notFound("Invite not found");
}

/** Public details for the invite landing page (no secrets, no org internals). */
export async function getInvitePreview(tokenHash: string): Promise<{ organizationName: string; email: string; expired: boolean } | null> {
  const invite = await OrgInviteModel.findOne({ tokenHash }).exec();
  if (!invite) return null;
  const org = await organizationRepository.findById(String(invite.organizationId));
  return {
    organizationName: org?.name ?? "",
    email: invite.email,
    expired: Boolean(invite.acceptedAt) || invite.expiresAt.getTime() <= Date.now(),
  };
}

export async function listAllOrganizations(): Promise<Array<{ id: string; name: string; slug: string; status: string; createdAt: Date | null; modules: string[] }>> {
  const orgs = await organizationRepository.listAll();
  return orgs
    .map((org) => ({
      id: String(org._id),
      name: org.name,
      slug: org.slug,
      status: org.status,
      createdAt: (org as unknown as { createdAt?: Date }).createdAt ?? null,
      modules: Object.entries((org.modules ?? {}) as Record<string, { enabled?: boolean }>)
        .filter(([, state]) => state?.enabled)
        .map(([key]) => key),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function setOrganizationStatus(organizationId: string, status: "active" | "suspended"): Promise<void> {
  await loadOrg(organizationId);
  await organizationRepository.updateById(organizationId, { status });
}
