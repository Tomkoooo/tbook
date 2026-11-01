"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ActionError } from "@tbook/actions";
import {
  createInvite,
  createOrganization,
  createRole,
  deactivateMember,
  deleteRole,
  revokeInvite,
  saveBookingEmailTemplate,
  saveGeneralSettings,
  saveVoucherPdfLayout,
  saveSmtpSettings,
  saveStripeSettings,
  saveSzamlazzSettings,
  sendBookingEmailTest,
  sendMail,
  sendSmtpTestEmail,
  setMemberRoles,
  setOrganizationStatus,
  updateRole,
} from "@tbook/services";
import { getSessionUser, requireOrgPermission, requireSystemAdmin } from "@/lib/admin-auth";
import { activeOrgCookieOptions } from "@/lib/org-cookie";

/**
 * Server actions for organization settings, members/roles and (system
 * admin only) the organization list. Same contract as actions.ts: each one
 * re-checks its permission here and returns a plain result so the form can
 * show it inline.
 */

export interface SettingsActionResult {
  ok: boolean;
  message?: string;
  /** Invite link, shown when the invite email could not be sent. */
  inviteUrl?: string;
}

async function attempt(fn: () => Promise<string | SettingsActionResult>): Promise<SettingsActionResult> {
  try {
    const result = await fn();
    return typeof result === "string" ? { ok: true, message: result } : result;
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[settings action]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const flag = (form: FormData, key: string) => form.get(key) !== null;

/** Mail errors (bad password, unreachable host) are exactly what an admin testing SMTP needs to see. */
async function surfaceMailError(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw ActionError.validation(`The email could not be sent: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Emails an invite link. Returns the link either way, so a failed mail can still be shared by hand. */
async function deliverInvite(organizationId: string, organizationName: string, email: string, token: string): Promise<SettingsActionResult> {
  const inviteUrl = `${appUrl()}/invite/${token}`;
  try {
    await sendMail(organizationId, {
      to: email,
      subject: `You're invited to ${organizationName} on tBook`,
      html:
        `<p>You've been invited to join <strong>${escapeHtml(organizationName)}</strong> on tBook.</p>` +
        `<p><a href="${inviteUrl}">Accept the invitation</a></p>` +
        `<p>The link is valid for 7 days. Sign in with this email address (${escapeHtml(email)}) to accept it.</p>`,
    });
    return { ok: true, message: `Invitation sent to ${email}.` };
  } catch (error) {
    console.error("[invite email]", error);
    return { ok: true, message: `The invite was created, but the email could not be sent. Share this link with ${email}:`, inviteUrl };
  }
}

/* ---- General -------------------------------------------------------------- */

export async function saveGeneralSettingsAction(formData: FormData): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    await saveGeneralSettings(organizationId, { name: text(formData, "name"), currency: text(formData, "currency") });
    revalidatePath("/admin", "layout");
    return "Saved.";
  });
}

/* ---- Integrations --------------------------------------------------------- */

export async function saveStripeSettingsAction(formData: FormData): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    await saveStripeSettings(organizationId, {
      enabled: flag(formData, "enabled"),
      publishableKey: text(formData, "publishableKey"),
      secretKey: text(formData, "secretKey"),
      webhookSecret: text(formData, "webhookSecret"),
    });
    revalidatePath("/admin/integrations");
    return "Stripe settings saved.";
  });
}

export async function saveSmtpSettingsAction(formData: FormData): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    await saveSmtpSettings(organizationId, {
      host: text(formData, "host"),
      port: Number(text(formData, "port") || 587),
      user: text(formData, "user"),
      pass: text(formData, "pass"),
      fromEmail: text(formData, "fromEmail"),
      fromName: text(formData, "fromName"),
    });
    revalidatePath("/admin/integrations");
    return "Email settings saved.";
  });
}

export async function sendSmtpTestAction(): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    const user = await getSessionUser();
    await surfaceMailError(() => sendSmtpTestEmail(organizationId, user?.email ?? ""));
    return `Test email sent to ${user?.email}.`;
  });
}

export async function saveSzamlazzSettingsAction(formData: FormData): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    await saveSzamlazzSettings(organizationId, {
      enabled: flag(formData, "enabled"),
      agentKey: text(formData, "agentKey"),
      sellerName: text(formData, "sellerName"),
      sellerBank: text(formData, "sellerBank"),
      sellerBankAccount: text(formData, "sellerBankAccount"),
      receiptPrefix: text(formData, "receiptPrefix"),
      receiptTemplate: text(formData, "receiptTemplate"),
    });
    revalidatePath("/admin/integrations");
    return "Számlázz.hu settings saved.";
  });
}

/* ---- Booking email -------------------------------------------------------- */

export async function saveBookingEmailAction(formData: FormData): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    await saveBookingEmailTemplate(organizationId, { subject: text(formData, "subject"), body: String(formData.get("body") ?? "") });
    revalidatePath("/admin/settings/email");
    return "Booking email saved.";
  });
}

export async function resetBookingEmailAction(): Promise<SettingsActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    await saveBookingEmailTemplate(organizationId, { subject: "", body: "" });
    return "Reset to the default email.";
  });
  if (result.ok) {
    revalidatePath("/admin/settings/email");
    // The editor holds its own state, so reload the page to show the default text.
    redirect("/admin/settings/email?reset=1");
  }
  return result;
}

/** Saves the voucher PDF layout the editor holds (a JSON blob), or resets to the default when it is empty. */
export async function saveVoucherPdfLayoutAction(layoutJson: string | null): Promise<SettingsActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    let layout: unknown = null;
    if (layoutJson) {
      try {
        layout = JSON.parse(layoutJson);
      } catch {
        throw ActionError.validation("Could not read the voucher layout.");
      }
    }
    await saveVoucherPdfLayout(organizationId, layout);
    return layoutJson ? "Voucher layout saved. New tickets use it right away." : "Reset to the default voucher.";
  });
  if (result.ok) revalidatePath("/admin/settings/voucher-pdf");
  return result;
}

export async function sendBookingEmailTestAction(formData: FormData): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    const user = await getSessionUser();
    await surfaceMailError(() =>
      sendBookingEmailTest(organizationId, user?.email ?? "", {
        subject: text(formData, "subject"),
        body: String(formData.get("body") ?? ""),
      }),
    );
    return `Test sent to ${user?.email}, filled with sample booking details.`;
  });
}

/* ---- Members and roles ---------------------------------------------------- */

export async function inviteMemberAction(organizationName: string, formData: FormData): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId, userId } = await requireOrgPermission("member:invite");
    const email = text(formData, "email").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw ActionError.validation("Enter a valid email address.");
    const roleIds = formData.getAll("roleIds").map(String).filter(Boolean);
    if (roleIds.length === 0) throw ActionError.validation("Pick at least one role.");
    const { token } = await createInvite({ organizationId, email, roleIds, invitedByUserId: userId });
    revalidatePath("/admin/members");
    return deliverInvite(organizationId, organizationName, email, token);
  });
}

export async function revokeInviteAction(inviteId: string): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId } = await requireOrgPermission("member:invite");
    await revokeInvite(organizationId, inviteId);
    revalidatePath("/admin/members");
    return "Invite revoked.";
  });
}

export async function setMemberRolesAction(membershipId: string, formData: FormData): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId } = await requireOrgPermission("member:manage");
    await setMemberRoles(organizationId, membershipId, formData.getAll("roleIds").map(String).filter(Boolean));
    revalidatePath("/admin/members");
    return "Roles updated.";
  });
}

export async function deactivateMemberAction(membershipId: string): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId, membershipId: own } = await requireOrgPermission("member:manage");
    if (own && own === membershipId) throw ActionError.validation("You can't remove yourself.");
    await deactivateMember(organizationId, membershipId);
    revalidatePath("/admin/members");
    return "Member removed.";
  });
}

export async function saveRoleAction(roleId: string | null, formData: FormData): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId } = await requireOrgPermission("role:manage");
    const input = {
      organizationId,
      name: text(formData, "name"),
      description: text(formData, "description"),
      permissions: formData.getAll("permissions").map(String),
    };
    if (!input.name) throw ActionError.validation("Give the role a name.");
    if (roleId) await updateRole({ ...input, roleId });
    else await createRole(input);
    revalidatePath("/admin/members");
    return roleId ? "Role saved." : "Role created.";
  });
}

export async function deleteRoleAction(roleId: string): Promise<SettingsActionResult> {
  return attempt(async () => {
    const { organizationId } = await requireOrgPermission("role:manage");
    await deleteRole(organizationId, roleId);
    revalidatePath("/admin/members");
    return "Role deleted.";
  });
}

/* ---- Organizations (system admin) ----------------------------------------- */

export async function createOrganizationAction(formData: FormData): Promise<SettingsActionResult> {
  const result = await attempt(async () => {
    const { userId } = await requireSystemAdmin();
    const name = text(formData, "name");
    if (!name) throw ActionError.validation("Give the organization a name.");
    const currency = text(formData, "currency").toUpperCase() || "HUF";
    if (!/^[A-Z]{3}$/.test(currency)) throw ActionError.validation("Currency must be a 3-letter code, like HUF or EUR.");
    const ownerEmail = text(formData, "ownerEmail").toLowerCase();
    const makeMeOwner = flag(formData, "makeMeOwner");

    const { organization, invite } = await createOrganization({
      name,
      currency,
      createdByUserId: userId,
      ownerUserId: makeMeOwner ? userId : null,
      ownerEmail: makeMeOwner ? null : ownerEmail || null,
    });
    revalidatePath("/admin/organizations");

    if (invite) {
      const delivered = await deliverInvite(organization.id, organization.name, ownerEmail, invite.token);
      return { ...delivered, message: `${organization.name} created. ${delivered.message}` };
    }
    return `${organization.name} created.`;
  });
  return result;
}

export async function setOrganizationStatusAction(organizationId: string, status: "active" | "suspended"): Promise<SettingsActionResult> {
  return attempt(async () => {
    await requireSystemAdmin();
    await setOrganizationStatus(organizationId, status);
    revalidatePath("/admin/organizations");
    return status === "active" ? "Organization reactivated." : "Organization suspended.";
  });
}

/** Switches the console into an organization (system admins can enter any). */
export async function openOrganizationAction(organizationId: string): Promise<SettingsActionResult> {
  const result = await attempt(async () => {
    await requireSystemAdmin();
    (await cookies()).set(activeOrgCookieOptions(organizationId));
    return "Opened.";
  });
  if (result.ok) redirect("/admin");
  return result;
}
