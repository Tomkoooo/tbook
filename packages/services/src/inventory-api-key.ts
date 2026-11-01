import { ActionError } from "@tbook/actions";
import { OrganizationModel, organizationRepository } from "@tbook/db";
import { apiKeyHint, generateApiKey, hashApiKey, normalizeTBookApiKey } from "./api-key";

/**
 * Organization-level key for the inventory API (used by the webshop).
 * Separate from event-group keys: it grants read/write access to this
 * organization's products and stock, nothing else. Only the hash is stored.
 */

export interface InventoryApiKeyView {
  configured: boolean;
  hint: string;
  createdAt: string | null;
}

export async function getInventoryApiKey(organizationId: string): Promise<InventoryApiKeyView> {
  const org = await organizationRepository.findById(organizationId);
  const api = org?.settings?.inventoryApi;
  return { configured: Boolean(api?.keyHash), hint: api?.keyHint ?? "", createdAt: api?.createdAt?.toISOString() ?? null };
}

/** Creates or replaces the key. The plaintext is returned once; the old key stops working immediately. */
export async function rotateInventoryApiKey(organizationId: string): Promise<{ plaintext: string }> {
  const plaintext = generateApiKey();
  const result = await OrganizationModel.updateOne(
    { _id: organizationId },
    { $set: { "settings.inventoryApi": { keyHash: hashApiKey(plaintext), keyHint: apiKeyHint(plaintext), createdAt: new Date() } } },
  ).exec();
  if (result.matchedCount === 0) throw ActionError.notFound("Organization not found");
  return { plaintext };
}

export async function revokeInventoryApiKey(organizationId: string): Promise<void> {
  await OrganizationModel.updateOne({ _id: organizationId }, { $set: { "settings.inventoryApi": { keyHash: null, keyHint: "", createdAt: null } } }).exec();
}

/** The organization a key belongs to, or a 401. Suspended organizations are refused. */
export async function resolveInventoryApiKey(rawKey: string | null): Promise<{ organizationId: string }> {
  const key = normalizeTBookApiKey(rawKey);
  if (!key) throw ActionError.unauthorized("Missing API key (X-TBook-Api-Key header).");
  const org = await OrganizationModel.findOne({ "settings.inventoryApi.keyHash": hashApiKey(key) }).exec();
  if (!org || org.status !== "active") throw ActionError.unauthorized("Invalid or revoked API key.");
  return { organizationId: String(org._id) };
}
