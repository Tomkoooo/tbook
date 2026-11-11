"use server";

import { revalidatePath } from "next/cache";
import { ActionError } from "@tbook/actions";
import { cleanModuleConfig, getEventForOrg, setEventModule, setOrganizationModule } from "@tbook/services";
import { requireOrgPermission, requireSystemAdmin } from "@/lib/admin-auth";

/**
 * Feature-module switches. A system admin grants a module to an
 * organization; inside that grant, members with module:manage switch it
 * on per event and fill in its settings.
 */

export interface ModuleActionResult {
  ok: boolean;
  message?: string;
}

function fail(error: unknown, label: string): ModuleActionResult {
  if (error instanceof ActionError) return { ok: false, message: error.message };
  console.error(`[${label}]`, error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

export async function setOrganizationModuleAction(organizationId: string, moduleKey: string, enabled: boolean): Promise<ModuleActionResult> {
  try {
    const { userId } = await requireSystemAdmin();
    await setOrganizationModule(organizationId, moduleKey, { enabled }, userId);
    revalidatePath("/admin/organizations");
    return { ok: true, message: enabled ? "Module granted." : "Module withdrawn." };
  } catch (error) {
    return fail(error, "setOrganizationModuleAction");
  }
}

export async function setEventModuleAction(eventId: string, moduleKey: string, enabled: boolean): Promise<ModuleActionResult> {
  try {
    const { organizationId, userId } = await requireOrgPermission("module:manage");
    await getEventForOrg(organizationId, eventId);
    await setEventModule(organizationId, eventId, moduleKey, { enabled }, userId);
    revalidatePath(`/admin/events/${eventId}`);
    return { ok: true, message: enabled ? "Switched on for this event." : "Switched off for this event." };
  } catch (error) {
    return fail(error, "setEventModuleAction");
  }
}

export async function saveEventModuleConfigAction(eventId: string, moduleKey: string, formData: FormData): Promise<ModuleActionResult> {
  try {
    const { organizationId, userId } = await requireOrgPermission("module:manage");
    await getEventForOrg(organizationId, eventId);
    const config = cleanModuleConfig(moduleKey, Object.fromEntries(formData.entries()));
    await setEventModule(organizationId, eventId, moduleKey, { config }, userId);
    revalidatePath(`/admin/events/${eventId}`);
    return { ok: true, message: "Settings saved." };
  } catch (error) {
    return fail(error, "saveEventModuleConfigAction");
  }
}
