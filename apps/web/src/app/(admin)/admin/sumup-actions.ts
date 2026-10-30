"use server";

import { revalidatePath } from "next/cache";
import { ActionError, parseInput } from "@tbook/actions";
import { pairSumUpReader, removeSumUpReader, saveSumUpSettings } from "@tbook/services";
import { z } from "zod";
import { requireOrgPermission } from "@/lib/admin-auth";

export interface SumUpActionResult {
  ok: boolean;
  message?: string;
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  merchantCode: z.string().trim().max(50),
  apiKey: z.string().trim().max(500).optional(),
  affiliateAppId: z.string().trim().max(200),
  affiliateKey: z.string().trim().max(500).optional(),
});

function fail(error: unknown): SumUpActionResult {
  if (error instanceof ActionError) return { ok: false, message: error.message };
  console.error("[sumup action]", error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function saveSumUpAction(formData: FormData): Promise<SumUpActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("org:update");
    const input = parseInput(settingsSchema, {
      enabled: formData.get("enabled") !== null,
      merchantCode: str(formData, "merchantCode"),
      apiKey: str(formData, "apiKey"),
      affiliateAppId: str(formData, "affiliateAppId"),
      affiliateKey: str(formData, "affiliateKey"),
    });
    await saveSumUpSettings(organizationId, input);
    revalidatePath("/admin/integrations");
    return { ok: true, message: "SumUp settings saved." };
  } catch (error) {
    return fail(error);
  }
}

export async function pairReaderAction(formData: FormData): Promise<SumUpActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("org:update");
    const reader = await pairSumUpReader(organizationId, { pairingCode: str(formData, "pairingCode"), name: str(formData, "name") });
    revalidatePath("/admin/integrations");
    return { ok: true, message: `Paired "${reader.name}".` };
  } catch (error) {
    return fail(error);
  }
}

export async function removeReaderAction(readerId: string): Promise<SumUpActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("org:update");
    await removeSumUpReader(organizationId, readerId);
    revalidatePath("/admin/integrations");
    return { ok: true, message: "Reader removed." };
  } catch (error) {
    return fail(error);
  }
}
