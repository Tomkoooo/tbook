"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { acceptInvite } from "@tbook/services";
import { getSessionUser } from "@/lib/admin-auth";
import { activeOrgCookieOptions } from "@/lib/org-cookie";

/** Accepts the invite for the signed-in user and opens that organization. */
export async function acceptInviteAction(token: string): Promise<{ ok: boolean; message?: string }> {
  let organizationId: string;
  try {
    const user = await getSessionUser();
    if (!user?.email) throw ActionError.unauthorized();
    organizationId = await acceptInvite(token, user.id, user.email);
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[accept invite]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
  (await cookies()).set(activeOrgCookieOptions(organizationId));
  redirect("/admin");
}
