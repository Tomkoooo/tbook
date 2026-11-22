"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { FEEDBACK, feedback } from "@tbook/modules";
import { getEventForOrg, resolveModules } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";
import { eventPath } from "@/lib/event-routes";

/** Surveys and kiosk links, behind feedback:manage (fallback event:write). */

export interface FeedbackActionResult {
  ok: boolean;
  message?: string;
  kioskUrl?: string;
}

function fail(error: unknown, label: string): FeedbackActionResult {
  if (error instanceof ActionError) return { ok: false, message: error.message };
  console.error(`[${label}]`, error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

function readInput(form: FormData): feedback.SurveyInput {
  let questions: feedback.SurveyInput["questions"] = [];
  try {
    questions = JSON.parse(String(form.get("questions") ?? "[]"));
  } catch {
    throw ActionError.validation("The questions couldn't be read.");
  }
  return {
    kind: form.get("kind") === "kiosk" ? "kiosk" : "survey",
    title: String(form.get("title") ?? ""),
    intro: String(form.get("intro") ?? ""),
    thankYou: String(form.get("thankYou") ?? ""),
    active: form.get("active") !== null,
    questions: Array.isArray(questions) ? questions : [],
  };
}

export async function saveSurveyAction(surveyId: string | null, eventId: string, _prev: FeedbackActionResult | null, form: FormData): Promise<FeedbackActionResult> {
  let createdId: string | null = null;
  try {
    const { organizationId } = await requireOrgPermission("feedback:manage");
    if (surveyId) {
      const existing = await feedback.getSurveyForOrg(organizationId, surveyId);
      if (String(existing.eventId) !== eventId) throw ActionError.notFound("Survey not found");
      await feedback.updateSurvey(organizationId, surveyId, readInput(form));
    } else {
      const event = await getEventForOrg(organizationId, eventId);
      if (!(await resolveModules({ organizationId, event })).isOn(FEEDBACK)) throw ActionError.validation("Switch on Feedback for this event first.");
      createdId = String((await feedback.createSurvey(organizationId, eventId, readInput(form)))._id);
    }
    revalidatePath(`/admin/events/${eventId}`, "layout");
  } catch (error) {
    return fail(error, "saveSurveyAction");
  }
  if (createdId) redirect(eventPath(eventId, "feedback", createdId));
  return { ok: true, message: "Saved." };
}

export async function deleteSurveyAction(surveyId: string): Promise<FeedbackActionResult> {
  let deleted = false;
  let eventId = "";
  try {
    const { organizationId } = await requireOrgPermission("feedback:manage");
    eventId = String((await feedback.getSurveyForOrg(organizationId, surveyId)).eventId);
    deleted = (await feedback.deleteSurvey(organizationId, surveyId)) === "deleted";
    revalidatePath(`/admin/events/${eventId}`, "layout");
    if (!deleted) return { ok: true, message: "It has answers, so it was switched off instead of deleted." };
  } catch (error) {
    return fail(error, "deleteSurveyAction");
  }
  redirect(eventPath(eventId, "feedback"));
}

export async function rotateKioskLinkAction(surveyId: string): Promise<FeedbackActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("feedback:manage");
    const kioskUrl = await feedback.rotateKioskToken(organizationId, surveyId);
    revalidatePath("/admin/events/[eventId]", "layout");
    return { ok: true, kioskUrl, message: "New kiosk link created. The old one no longer works." };
  } catch (error) {
    return fail(error, "rotateKioskLinkAction");
  }
}
