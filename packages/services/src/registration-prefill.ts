import { ActionError } from "@tbook/actions";
import { eventRepository, fieldClaimRepository, type IEvent } from "@tbook/db";
import { normalizeUniqueValue, resolveEligibilityRules, type EligibilityRulesConfig } from "@tbook/domain";
import type { AttendeeFieldDef, AttendeeFieldValue } from "@tbook/schemas";
import { findDataListRow } from "./data-list-service";

/**
 * "Start with your ID": the guest types their identifying answer (e.g.
 * employee ID) first, and the rest of the form is filled from the matching
 * row of the data list that answer is checked against. Everything stays
 * editable; the normal registration checks run on submit.
 *
 * Setup lives in the form builder only: a field marked "identifies the
 * guest" with an `in_list` rule on it names the list, and each field's
 * `prefillColumn` names the column it is copied from.
 */

export interface RegistrationPrefillSetup {
  /** The identifying field the guest fills in first. */
  fieldKey: string;
  label: string;
  helpText: string;
  /** The data list the identifier is checked against. */
  listId: string;
  /** Field key → list column. */
  columns: Record<string, string>;
}

export interface RegistrationPrefillResult {
  found: boolean;
  /** Already registered for this event (a unique identifier with an active registration). */
  alreadyRegistered: boolean;
  /** Answers to start the form with (only when found and not yet registered). */
  fields: Record<string, AttendeeFieldValue>;
}

type EventLike = Pick<IEvent, "attendeeFieldSchema" | "eligibilityPreset" | "eligibilityFormRules"> & Record<string, unknown>;

function plainFields(event: EventLike): AttendeeFieldDef[] {
  return ((event.attendeeFieldSchema ?? []) as unknown[]).map((field) => {
    const maybe = field as { toObject?: () => AttendeeFieldDef };
    return typeof maybe.toObject === "function" ? maybe.toObject() : (field as AttendeeFieldDef);
  });
}

/** Whether (and how) this event's form starts with an identifier lookup. Null = it doesn't. */
export function registrationPrefillSetup(event: EventLike): RegistrationPrefillSetup | null {
  const fields = plainFields(event);
  const columns: Record<string, string> = {};
  for (const field of fields) {
    const column = field.prefillColumn?.trim();
    if (column && !field.identifier) columns[field.key] = column;
  }
  if (Object.keys(columns).length === 0) return null;

  const doc = event as EventLike & { toObject?: () => EventLike };
  const plain = typeof doc.toObject === "function" ? doc.toObject() : event;
  const rules = resolveEligibilityRules({ ...plain, eligibilityFormRules: plain.eligibilityFormRules as EligibilityRulesConfig | null } as never);
  const listRules = (rules?.formRules?.rules ?? []).filter((rule) => rule.op === "in_list" && rule.value?.trim());
  for (const field of fields.filter((f) => f.identifier)) {
    const rule = listRules.find((r) => r.fieldKey === field.key);
    if (rule) return { fieldKey: field.key, label: field.label, helpText: field.helpText ?? "", listId: rule.value.trim(), columns };
  }
  return null;
}

/** Maps a list cell onto a field's answer; null when it doesn't fit (e.g. no matching dropdown option). */
function cellToAnswer(field: AttendeeFieldDef, raw: string | undefined): AttendeeFieldValue | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (field.type === "select") {
    if (field.choicesSource) return null;
    const wanted = value.toLocaleLowerCase("hu");
    const choice = (field.choices ?? []).find((c) => c.value.toLocaleLowerCase("hu") === wanted || c.label.toLocaleLowerCase("hu") === wanted);
    return choice ? choice.value : null;
  }
  if (field.type === "checkbox") return ["true", "igen", "yes", "1", "x"].includes(value.toLowerCase()) ? "true" : null;
  if (field.type === "number") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return value.slice(0, 500);
}

/**
 * Looks the code up and returns the answers to start the form with. A
 * guest who is already registered gets no data back, only the flag (the
 * site then points them to the guest self-service page).
 */
export async function prefillRegistration(eventId: string, rawCode: string): Promise<RegistrationPrefillResult> {
  const event = await eventRepository.findById(eventId);
  if (!event) throw ActionError.notFound("Event not found");
  const setup = registrationPrefillSetup(event as unknown as EventLike);
  if (!setup) throw ActionError.validation("This event's form doesn't start with an ID lookup.");
  const code = String(rawCode ?? "").trim().slice(0, 100);
  if (!code) throw ActionError.validation("Enter your ID.");

  const fields = plainFields(event as unknown as EventLike);
  const identifier = fields.find((f) => f.key === setup.fieldKey)!;
  if (identifier.unique) {
    const claimed = await fieldClaimRepository.findForEvent(eventId, setup.fieldKey, normalizeUniqueValue(code));
    if (claimed) return { found: true, alreadyRegistered: true, fields: { [setup.fieldKey]: code } };
  }

  const organizationId = event.organizationId ? String(event.organizationId) : null;
  const row = organizationId ? await findDataListRow(organizationId, setup.listId, code).catch(() => null) : null;
  if (!row) return { found: false, alreadyRegistered: false, fields: {} };

  const answers: Record<string, AttendeeFieldValue> = { [setup.fieldKey]: code };
  for (const field of fields) {
    const column = setup.columns[field.key];
    if (!column) continue;
    const answer = cellToAnswer(field, row[column]);
    if (answer != null) answers[field.key] = answer;
  }
  return { found: true, alreadyRegistered: false, fields: answers };
}
