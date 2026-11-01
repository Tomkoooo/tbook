import { MongoMemoryServer } from "mongodb-memory-server";
import { OrganizationModel, OrgInviteModel, OrgMembershipModel, OrgRoleModel, UserModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { DEFAULT_BOOKING_EMAIL_TEMPLATE } from "@tbook/domain";
import { DEFAULT_VOUCHER_PDF_LAYOUT } from "@tbook/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptOrgSecret } from "./org-secrets";
import { addMember, createInvite, createOrganization, getOwnerRoleId, updateMember } from "./org-service";
import {
  deactivateMember,
  getOrganizationSettings,
  getVoucherPdfLayout,
  listMembers,
  revokeInvite,
  saveBookingEmailTemplate,
  saveGeneralSettings,
  saveSmtpSettings,
  saveStripeSettings,
  saveVoucherPdfLayout,
  sendSmtpTestEmail,
  setMemberRoles,
} from "./org-settings-service";

describe("org-settings-service", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    vi.stubEnv("TBOOK_ORG_SECRETS_KEY", "test-secrets-key-test-secrets-key");
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      OrganizationModel.deleteMany({}),
      OrgMembershipModel.deleteMany({}),
      OrgRoleModel.deleteMany({}),
      OrgInviteModel.deleteMany({}),
      UserModel.deleteMany({}),
    ]);
  });

  async function orgWithOwner() {
    const owner = await UserModel.create({ email: "owner@example.com", name: "Owner" });
    const { organization } = await createOrganization({ name: "Test Org", ownerUserId: String(owner._id) });
    return { orgId: organization.id, owner };
  }

  it("masks secrets and keeps them when the field is left blank", async () => {
    const { orgId } = await orgWithOwner();
    await saveStripeSettings(orgId, { enabled: true, publishableKey: "pk_test_1", secretKey: "sk_test_abc", webhookSecret: "whsec_abc" });
    await saveStripeSettings(orgId, { enabled: true, publishableKey: "pk_test_2", secretKey: "", webhookSecret: "" });

    const view = await getOrganizationSettings(orgId);
    expect(view.stripe.publishableKey).toBe("pk_test_2");
    expect(view.stripe.secretKey.configured).toBe(true);
    expect(JSON.stringify(view)).not.toContain("sk_test_abc");

    const org = await OrganizationModel.findById(orgId).exec();
    expect(decryptOrgSecret(org?.settings?.stripe?.secretKeyEnc)).toBe("sk_test_abc");
  });

  it("refuses to enable Stripe without both secrets, and rejects a malformed key", async () => {
    const { orgId } = await orgWithOwner();
    await expect(saveStripeSettings(orgId, { enabled: true, publishableKey: "", secretKey: "sk_test_x" })).rejects.toThrow(/webhook/);
    await expect(saveStripeSettings(orgId, { enabled: false, publishableKey: "", secretKey: "pk_live_oops" })).rejects.toThrow(/sk_live_/);
  });

  it("validates general settings and SMTP", async () => {
    const { orgId } = await orgWithOwner();
    await expect(saveGeneralSettings(orgId, { name: "X", currency: "euro" })).rejects.toThrow(/3-letter/);
    await saveGeneralSettings(orgId, { name: " Renamed ", currency: "eur" });
    expect((await getOrganizationSettings(orgId)).currency).toBe("EUR");
    expect((await getOrganizationSettings(orgId)).name).toBe("Renamed");

    await expect(saveSmtpSettings(orgId, { host: "smtp.x", port: 587, user: "", fromEmail: "", fromName: "" })).rejects.toThrow(/username/);
    await saveSmtpSettings(orgId, { host: "smtp.x", port: 465, user: "u", pass: "p", fromEmail: "a@x.hu", fromName: "Org" });
    const transporter = { sendMail: vi.fn().mockResolvedValue({}) };
    await sendSmtpTestEmail(orgId, "me@example.com", transporter);
    expect(transporter.sendMail.mock.calls[0]?.[0].from).toBe('"Org" <a@x.hu>');
  });

  it("saves, reports and resets the booking email template", async () => {
    const { orgId } = await orgWithOwner();
    expect((await getOrganizationSettings(orgId)).bookingEmail).toEqual({ ...DEFAULT_BOOKING_EMAIL_TEMPLATE, isCustom: false });

    await saveBookingEmailTemplate(orgId, { subject: "Hi {{customerName}}", body: "<p>Custom</p>" });
    expect((await getOrganizationSettings(orgId)).bookingEmail).toEqual({ subject: "Hi {{customerName}}", body: "<p>Custom</p>", isCustom: true });

    // Saving the default text back counts as a reset, and clears the legacy template too.
    await OrganizationModel.updateOne({ _id: orgId }, { "settings.emailTemplates.voucherDelivery": { subject: "Old", body: "<p>Old</p>" } });
    await saveBookingEmailTemplate(orgId, DEFAULT_BOOKING_EMAIL_TEMPLATE);
    expect((await getOrganizationSettings(orgId)).bookingEmail.isCustom).toBe(false);
  });

  it("lists members with their emails and protects the last Owner", async () => {
    const { orgId } = await orgWithOwner();
    const viewer = await UserModel.create({ email: "viewer@example.com" });
    const ownerRoleId = (await getOwnerRoleId(orgId))!;
    const viewerRoleId = String((await OrgRoleModel.findOne({ organizationId: orgId, name: "Viewer" }).exec())!._id);
    await addMember({ organizationId: orgId, userId: String(viewer._id), roleIds: [viewerRoleId] });

    const members = await listMembers(orgId);
    expect(members.map((m) => m.email)).toEqual(["owner@example.com", "viewer@example.com"]);
    const ownerMembership = members[0]!.membershipId;

    await expect(setMemberRoles(orgId, ownerMembership, [viewerRoleId])).rejects.toThrow(/at least one Owner/);
    await expect(deactivateMember(orgId, ownerMembership)).rejects.toThrow(/last Owner/);

    // With a second owner, the first can step down.
    await setMemberRoles(orgId, members[1]!.membershipId, [ownerRoleId]);
    await setMemberRoles(orgId, ownerMembership, [viewerRoleId]);
    await deactivateMember(orgId, ownerMembership);
    expect((await listMembers(orgId)).find((m) => m.membershipId === ownerMembership)?.status).toBe("disabled");
  });

  it("never touches another organization's membership", async () => {
    const a = await orgWithOwner();
    const otherUser = await UserModel.create({ email: "b@example.com" });
    const { organization: b } = await createOrganization({ name: "Org B", ownerUserId: String(otherUser._id) });
    const bMembership = (await listMembers(b.id))[0]!.membershipId;

    await expect(updateMember({ organizationId: a.orgId, membershipId: bMembership, status: "disabled" })).rejects.toThrow();
    await expect(setMemberRoles(a.orgId, bMembership, [(await getOwnerRoleId(a.orgId))!])).rejects.toThrow(/not found/);
    expect((await listMembers(b.id))[0]!.status).toBe("active");
  });

  it("revokes only pending invites of its own organization", async () => {
    const { orgId } = await orgWithOwner();
    const { inviteId } = await createInvite({ organizationId: orgId, email: "new@example.com", roleIds: [] });
    await expect(revokeInvite("0123456789abcdef01234567", inviteId)).rejects.toThrow(/not found/);
    await revokeInvite(orgId, inviteId);
    expect(await OrgInviteModel.countDocuments({})).toBe(0);
  });

  it("saves, reads back and resets the voucher PDF layout, and refuses one without a QR code", async () => {
    const { orgId } = await orgWithOwner();
    expect((await getVoucherPdfLayout(orgId)).isCustom).toBe(false);

    const custom = {
      ...DEFAULT_VOUCHER_PDF_LAYOUT,
      primaryColor: "#b91c1c",
      blocks: [...DEFAULT_VOUCHER_PDF_LAYOUT.blocks, { id: "note", type: "customText", enabled: true, text: "Doors open at 9." }],
    };
    await saveVoucherPdfLayout(orgId, custom);
    const saved = await getVoucherPdfLayout(orgId);
    expect(saved.isCustom).toBe(true);
    expect(saved.layout.primaryColor).toBe("#b91c1c");
    expect(saved.layout.blocks.at(-1)?.text).toBe("Doors open at 9.");

    const noQr = { ...custom, blocks: custom.blocks.map((b) => (b.type === "qrCode" ? { ...b, enabled: false } : b)) };
    await expect(saveVoucherPdfLayout(orgId, noQr)).rejects.toThrow(/QR code/);

    await saveVoucherPdfLayout(orgId, null);
    expect((await getVoucherPdfLayout(orgId)).isCustom).toBe(false);
  });
});
