"use server";

import { revalidatePath } from "next/cache";
import { ActionError } from "@tbook/actions";
import { EVENT_EMAILS, eventEmails } from "@tbook/modules";
import { getEventForOrg, resolveModules } from "@tbook/services";
import type { EligibilityRulesConfig } from "@tbook/domain";
import { requireOrgPermission } from "@/lib/admin-auth";

/**
 * Event emails. Editing templates needs email:send (fallback
 * booking:manage) — the same permission as sending, since a template is
 * what gets sent.
 */

export interface EmailActionResult {
  ok: boolean;
  message?: string;
  id?: string;
}

function fail(error: unknown, label: string): EmailActionResult {
  if (error instanceof ActionError) return { ok: false, message: error.message };
  console.error(`[${label}]`, error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

async function requireEmailEvent(eventId: string) {
  const context = await requireOrgPermission("email:send");
  const event = await getEventForOrg(context.organizationId, eventId);
  if (!(await resolveModules({ organizationId: context.organizationId, event })).isOn(EVENT_EMAILS)) {
    throw ActionError.validation("Event emails aren't switched on for this event (event page → Modules).");
  }
  return context;
}

function readConditions(form: FormData): EligibilityRulesConfig | null {
  const raw = text(form, "conditions");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EligibilityRulesConfig;
    return parsed && Array.isArray(parsed.rules) ? parsed : null;
  } catch {
    throw ActionError.validation("Could not read the conditions.");
  }
}

function readInput(form: FormData): eventEmails.EventEmailInput {
  const rawTrigger = text(form, "trigger");
  const trigger: eventEmails.EmailTrigger = rawTrigger === "on_registration" || eventEmails.isSystemEmailTrigger(rawTrigger) ? rawTrigger : "manual";
  const audienceRaw = text(form, "audience");
  const audience = (["registered", "list_all", "list_unregistered"] as const).find((a) => a === audienceRaw) ?? "registered";
  return {
    name: text(form, "name"),
    subject: text(form, "subject"),
    body: String(form.get("body") ?? ""),
    trigger,
    audience,
    listId: text(form, "listId") || null,
    listMatchFieldKey: text(form, "listMatchFieldKey") || null,
    conditions: readConditions(form),
    attachTicket: form.get("attachTicket") !== null,
    active: form.get("active") !== null,
    sortOrder: Number.parseInt(text(form, "sortOrder") || "0", 10) || 0,
  };
}

export async function saveEventEmailAction(eventId: string, emailId: string | null, formData: FormData): Promise<EmailActionResult> {
  try {
    const { organizationId } = await requireEmailEvent(eventId);
    const input = readInput(formData);
    let id = emailId;
    if (emailId) {
      const existing = await eventEmails.getEventEmailForOrg(organizationId, emailId);
      if (String(existing.eventId) !== eventId) throw ActionError.notFound("Email not found");
      await eventEmails.updateEventEmail(organizationId, emailId, input);
    } else {
      id = String((await eventEmails.createEventEmail(organizationId, eventId, input))._id);
    }
    revalidatePath(`/admin/events/${eventId}`, "layout");
    return { ok: true, message: "Email saved.", id: id ?? undefined };
  } catch (error) {
    return fail(error, "saveEventEmailAction");
  }
}

export async function deleteEventEmailAction(emailId: string): Promise<EmailActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("email:send");
    await eventEmails.deleteEventEmail(organizationId, emailId);
    revalidatePath("/admin/events/[eventId]", "layout");
    return { ok: true, message: "Email deleted." };
  } catch (error) {
    return fail(error, "deleteEventEmailAction");
  }
}

export async function sendTestEmailAction(emailId: string, to: string): Promise<EmailActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("email:send");
    const basedOn = await eventEmails.sendEventEmailTest(organizationId, emailId, to);
    return { ok: true, message: `Test sent to ${to} (filled with ${basedOn}).` };
  } catch (error) {
    return fail(error, "sendTestEmailAction");
  }
}

export async function countRecipientsAction(emailId: string): Promise<EmailActionResult & { count?: number }> {
  try {
    const { organizationId } = await requireOrgPermission("email:send");
    return { ok: true, count: await eventEmails.countEmailRecipients(organizationId, emailId) };
  } catch (error) {
    return fail(error, "countRecipientsAction");
  }
}

export async function startEmailSendAction(emailId: string, resendAll: boolean, resendFailed = true): Promise<EmailActionResult> {
  try {
    const { organizationId, userId } = await requireOrgPermission("email:send");
    const email = await eventEmails.getEventEmailForOrg(organizationId, emailId);
    await requireEmailEvent(String(email.eventId));
    await eventEmails.startEventEmailSend(organizationId, emailId, userId, { resendAll, resendFailed });
    return { ok: true, message: "Sending started. You can leave this page — it keeps going." };
  } catch (error) {
    return fail(error, "startEmailSendAction");
  }
}

export async function stopEmailSendAction(emailId: string): Promise<EmailActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("email:send");
    await eventEmails.stopEventEmailSend(organizationId, emailId);
    return { ok: true, message: "Stopped after the current message. Send again later to finish the rest." };
  } catch (error) {
    return fail(error, "stopEmailSendAction");
  }
}

export interface SendProgress {
  /** "interrupted": the server running it went away; the resume job continues it within a few minutes. */
  status: "idle" | "running" | "interrupted" | "done" | "stopped";
  /** While running: sending, waiting for the next batch, or backing off because the SMTP server throttles. */
  phase: "sending" | "pausing" | "throttled" | null;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Refused temporarily, retried later in this run. */
  deferred: number;
  batchSize: number | null;
  batchPauseSeconds: number | null;
  /** ISO time of the next batch (while pausing / throttled). */
  nextBatchAt: string | null;
  lastError: string | null;
  resumeCount: number;
  logSent: number;
  logFailed: number;
}

export async function emailProgressAction(emailId: string): Promise<SendProgress | null> {
  try {
    const { organizationId } = await requireOrgPermission("email:send");
    const email = await eventEmails.getEventEmailForOrg(organizationId, emailId);
    const log = await eventEmails.listEmailDeliveries(organizationId, emailId, { limit: 1 });
    const state = email.sendState ?? eventEmails.idleState();
    // A send whose heartbeat stopped (server restart) is continued by the server's resume job.
    const stale = state.status === "running" && (!state.heartbeatAt || Date.now() - new Date(state.heartbeatAt).getTime() > eventEmails.STALE_AFTER_MS);
    const running = state.status === "running" && !stale;
    return {
      status: stale ? "interrupted" : state.status,
      phase: running ? (state.phase ?? "sending") : null,
      total: state.total,
      sent: state.sent,
      failed: state.failed,
      skipped: state.skipped,
      deferred: state.deferred ?? 0,
      batchSize: state.batchSize ?? null,
      batchPauseSeconds: state.batchPauseSeconds ?? null,
      nextBatchAt: running && state.nextBatchAt ? new Date(state.nextBatchAt).toISOString() : null,
      lastError: state.lastError ?? null,
      resumeCount: state.resumeCount ?? 0,
      logSent: log.sent,
      logFailed: log.failed,
    };
  } catch {
    return null;
  }
}
