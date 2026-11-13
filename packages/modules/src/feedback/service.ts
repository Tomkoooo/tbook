import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import ExcelJS from "exceljs";
import { ActionError } from "@tbook/actions";
import { BookingModel, eventRepository, type IBooking, type IEvent } from "@tbook/db";
import { resolveModules } from "@tbook/services";
import type { BookingAttendee } from "@tbook/schemas";
import { attendeeKeyOf, findAttendeeByCode } from "../shared/attendees";
import { SurveyModel, SurveyRespondentModel, SurveyResponseModel, questionTypes, type ISurvey, type QuestionType, type SurveyQuestion } from "./model";

export const FEEDBACK = "feedback";
export const RATING_MAX = 5;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

async function moduleOn(event: IEvent): Promise<boolean> {
  return (await resolveModules({ organizationId: event.organizationId ? String(event.organizationId) : null, event })).isOn(FEEDBACK);
}

// ---- Editing -----------------------------------------------------------------------

export interface SurveyInput {
  kind: "survey" | "kiosk";
  title: string;
  intro?: string;
  thankYou?: string;
  active?: boolean;
  questions: Array<{ id?: string; type: string; label: string; required?: boolean; choices?: string[] }>;
}

export function cleanQuestions(raw: SurveyInput["questions"], kind: "survey" | "kiosk"): SurveyQuestion[] {
  const out: SurveyQuestion[] = [];
  for (const question of raw.slice(0, 30)) {
    const label = String(question.label ?? "").trim().slice(0, 300);
    if (!label) continue;
    const type = (questionTypes as readonly string[]).includes(question.type) ? (question.type as QuestionType) : "rating";
    // A kiosk is tap-only: ratings and choices.
    if (kind === "kiosk" && type === "text") throw ActionError.validation("A kiosk can only ask ratings and choices.");
    const choices = type === "choice" ? [...new Set((question.choices ?? []).map((c) => String(c).trim()).filter(Boolean))].slice(0, 12) : [];
    if (type === "choice" && choices.length < 2) throw ActionError.validation(`“${label}” needs at least two options.`);
    const id = /^[a-z0-9]{6,16}$/.test(question.id ?? "") ? question.id! : randomBytes(5).toString("hex");
    out.push({ id, type, label, required: Boolean(question.required), choices });
  }
  if (out.length === 0) throw ActionError.validation("Add at least one question.");
  return out;
}

async function eventForOrg(organizationId: string, eventId: string): Promise<IEvent> {
  const event = await eventRepository.findById(eventId);
  if (!event || String(event.organizationId) !== organizationId) throw ActionError.notFound("Event not found");
  return event;
}

export function listSurveys(eventId: string): Promise<ISurvey[]> {
  return SurveyModel.find({ eventId }).sort({ createdAt: 1 }).exec();
}

export async function getSurveyForOrg(organizationId: string, surveyId: string): Promise<ISurvey> {
  const survey = /^[a-f0-9]{24}$/i.test(surveyId) ? await SurveyModel.findById(surveyId).exec() : null;
  if (!survey || String(survey.organizationId) !== organizationId) throw ActionError.notFound("Survey not found");
  return survey;
}

export async function createSurvey(organizationId: string, eventId: string, input: SurveyInput): Promise<ISurvey> {
  const event = await eventForOrg(organizationId, eventId);
  const title = input.title.trim().slice(0, 200);
  if (!title) throw ActionError.validation("Give the survey a title.");
  return SurveyModel.create({
    organizationId: event.organizationId,
    eventId: event._id,
    kind: input.kind === "kiosk" ? "kiosk" : "survey",
    title,
    intro: (input.intro ?? "").slice(0, 2000),
    thankYou: (input.thankYou ?? "").slice(0, 1000),
    active: input.active ?? true,
    questions: cleanQuestions(input.questions, input.kind),
    linkSecret: randomBytes(32).toString("hex"),
  });
}

export async function updateSurvey(organizationId: string, surveyId: string, input: SurveyInput): Promise<ISurvey> {
  const survey = await getSurveyForOrg(organizationId, surveyId);
  const title = input.title.trim().slice(0, 200);
  if (!title) throw ActionError.validation("Give the survey a title.");
  survey.title = title;
  survey.intro = (input.intro ?? "").slice(0, 2000);
  survey.thankYou = (input.thankYou ?? "").slice(0, 1000);
  survey.active = input.active ?? survey.active;
  survey.questions = cleanQuestions(input.questions, survey.kind);
  return survey.save();
}

/** A survey with answers is switched off rather than deleted, so results aren't lost. */
export async function deleteSurvey(organizationId: string, surveyId: string): Promise<"deleted" | "deactivated"> {
  const survey = await getSurveyForOrg(organizationId, surveyId);
  if (survey.responseCount > 0) {
    await SurveyModel.updateOne({ _id: survey._id }, { $set: { active: false } }).exec();
    return "deactivated";
  }
  await SurveyModel.deleteOne({ _id: survey._id }).exec();
  return "deleted";
}

export async function rotateKioskToken(organizationId: string, surveyId: string): Promise<string> {
  const survey = await getSurveyForOrg(organizationId, surveyId);
  if (survey.kind !== "kiosk") throw ActionError.validation("Only a kiosk survey has a kiosk link.");
  const token = randomBytes(24).toString("base64url");
  await SurveyModel.updateOne({ _id: survey._id }, { $set: { kioskTokenHash: hash(token), kioskTokenHint: token.slice(-4) } }).exec();
  return `${appUrl()}/kiosk/${token}`;
}

// ---- Personal links ------------------------------------------------------------------

function sign(survey: Pick<ISurvey, "linkSecret">, attendeeKey: string): string {
  return createHmac("sha256", survey.linkSecret).update(attendeeKey).digest("base64url").slice(0, 32);
}

export function personalToken(survey: Pick<ISurvey, "linkSecret">, attendeeKey: string): string {
  return `${Buffer.from(attendeeKey).toString("base64url")}.${sign(survey, attendeeKey)}`;
}

export function verifyPersonalToken(survey: Pick<ISurvey, "linkSecret">, token: string): string | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const attendeeKey = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = Buffer.from(sign(survey, attendeeKey));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? attendeeKey : null;
}

export async function personalFeedbackUrl(booking: IBooking, attendeeIndex: number): Promise<string> {
  const survey = await SurveyModel.findOne({ eventId: booking.eventId, kind: "survey", active: true }).sort({ createdAt: 1 }).exec();
  if (!survey) return "";
  const attendee = (booking.attendees ?? [])[attendeeIndex] as BookingAttendee | undefined;
  return `${appUrl()}/feedback/${String(survey._id)}?t=${personalToken(survey, attendeeKeyOf(booking, attendee, attendeeIndex))}`;
}

// ---- Answering -------------------------------------------------------------------------

export interface PublicSurvey {
  id: string;
  kind: "survey" | "kiosk";
  eventName: string;
  title: string;
  intro: string;
  thankYou: string;
  ratingMax: number;
  questions: SurveyQuestion[];
}

function toPublic(survey: ISurvey, event: IEvent): PublicSurvey {
  return {
    id: String(survey._id),
    kind: survey.kind,
    eventName: event.name,
    title: survey.title,
    intro: survey.intro,
    thankYou: survey.thankYou,
    ratingMax: RATING_MAX,
    questions: survey.questions.map((q) => ({ id: q.id, type: q.type, label: q.label, required: q.required, choices: [...q.choices] })),
  };
}

async function openSurvey(survey: ISurvey | null): Promise<{ survey: ISurvey; event: IEvent } | null> {
  if (!survey || !survey.active) return null;
  const event = await eventRepository.findById(String(survey.eventId));
  if (!event || !(await moduleOn(event))) return null;
  return { survey, event };
}

export async function getPublicSurvey(surveyId: string, groupId: string | null = null): Promise<PublicSurvey | null> {
  if (!/^[a-f0-9]{24}$/i.test(surveyId)) return null;
  const open = await openSurvey(await SurveyModel.findById(surveyId).exec());
  if (!open || open.survey.kind !== "survey" || (groupId && String(open.event.groupId) !== groupId)) return null;
  return toPublic(open.survey, open.event);
}

export async function listPublicSurveys(eventId: string, groupId: string | null, opts: { preview?: boolean } = {}): Promise<PublicSurvey[]> {
  const event = await eventRepository.findById(eventId);
  if (!event || (groupId && String(event.groupId) !== groupId) || (event.status === "draft" && !opts.preview) || !(await moduleOn(event))) return [];
  const surveys = await SurveyModel.find({ eventId, kind: "survey", active: true }).sort({ createdAt: 1 }).exec();
  return surveys.map((survey) => toPublic(survey, event));
}

export async function getKiosk(token: string): Promise<PublicSurvey | null> {
  if (!token || token.length < 20) return null;
  const open = await openSurvey(await SurveyModel.findOne({ kioskTokenHash: hash(token), kind: "kiosk" }).exec());
  return open ? toPublic(open.survey, open.event) : null;
}

function cleanAnswers(survey: ISurvey, raw: Record<string, unknown>): Record<string, string | number> {
  const answers: Record<string, string | number> = {};
  for (const question of survey.questions) {
    const value = raw[question.id];
    const empty = value == null || String(value).trim() === "";
    if (empty) {
      if (question.required) throw ActionError.validation(`Kérjük, válaszolj erre: ${question.label}`);
      continue;
    }
    if (question.type === "rating") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > RATING_MAX) throw ActionError.validation(`Válassz 1–${RATING_MAX} közötti értéket: ${question.label}`);
      answers[question.id] = n;
    } else if (question.type === "choice") {
      if (!question.choices.includes(String(value))) throw ActionError.validation(`Válassz egy lehetőséget: ${question.label}`);
      answers[question.id] = String(value);
    } else {
      answers[question.id] = String(value).trim().slice(0, 3000);
    }
  }
  if (Object.keys(answers).length === 0) throw ActionError.validation("Legalább egy kérdésre válaszolj.");
  return answers;
}

async function record(survey: ISurvey, answers: Record<string, string | number>, source: "survey" | "kiosk" | "api", isTest = false): Promise<void> {
  await SurveyResponseModel.create({ organizationId: survey.organizationId, eventId: survey.eventId, surveyId: survey._id, source, answers, isTest });
  // Test answers don't count (results, exports and the delete rule ignore them).
  if (!isTest) await SurveyModel.updateOne({ _id: survey._id }, { $inc: { responseCount: 1 } }).exec();
}

/** True when a personal-link attendee key ("<attendee id>" or "<bookingId>:<index>") belongs to a test registration. */
async function isTestAttendeeKey(eventId: unknown, attendeeKey: string): Promise<boolean> {
  const [bookingId, index] = attendeeKey.split(":");
  const byIndex = index != null && /^[a-f0-9]{24}$/i.test(bookingId ?? "");
  const filter: Record<string, unknown> = byIndex ? { _id: bookingId, eventId } : { eventId, "attendees.id": attendeeKey };
  const booking = await BookingModel.findOne(filter, { isTest: 1 }).lean().exec();
  return Boolean(booking?.isTest);
}

/**
 * A guest's answers. They are identified by their personal link (`token`)
 * or by their registration number / ID (`code`), once per guest; what they
 * answered is stored without who they are.
 */
export async function submitSurvey(
  surveyId: string,
  input: { code?: string; token?: string; answers: Record<string, unknown> },
  source: "survey" | "api" = "survey",
  groupId: string | null = null,
  /**
   * `preview`: the API request carries the group's preview key — a draft
   * event's survey and test registrations are accepted. Without it (API) a
   * test registration is not found. A personal link (source "survey") of a
   * test guest always works; its answer is stored as a test answer.
   */
  opts: { preview?: boolean } = {},
): Promise<{ thankYou: string; test?: true }> {
  const open = /^[a-f0-9]{24}$/i.test(surveyId) ? await openSurvey(await SurveyModel.findById(surveyId).exec()) : null;
  const hidden = source === "api" && open?.event.status === "draft" && !opts.preview;
  if (!open || hidden || open.survey.kind !== "survey" || (groupId && String(open.event.groupId) !== groupId)) throw ActionError.notFound("Ez a kérdőív most nem elérhető.");
  const { survey, event } = open;
  // A personal link names its guest exactly; a typed code finds a test guest only with the preview key.
  const includeTest = source !== "api" || Boolean(opts.preview);
  const codeIncludesTest = source === "api" && Boolean(opts.preview);

  let attendeeKey: string | null = null;
  let isTest = false;
  if (input.token) {
    attendeeKey = verifyPersonalToken(survey, input.token);
    if (attendeeKey) {
      isTest = await isTestAttendeeKey(event._id, attendeeKey);
      if (isTest && !includeTest) attendeeKey = null;
    }
  }
  if (!attendeeKey && input.code) {
    const hit = await findAttendeeByCode(event, input.code, { includeTest: codeIncludesTest });
    if (hit) {
      attendeeKey = attendeeKeyOf(hit.booking, (hit.booking.attendees ?? [])[hit.attendeeIndex] as BookingAttendee | undefined, hit.attendeeIndex);
      isTest = Boolean(hit.booking.isTest);
    }
  }
  if (!attendeeKey) throw ActionError.validation("Nem találjuk a regisztrációdat. Ellenőrizd a regisztrációs számodat vagy az azonosítódat.");

  const answers = cleanAnswers(survey, input.answers ?? {});
  await SurveyRespondentModel.init();
  try {
    await SurveyRespondentModel.create({ surveyId: survey._id, hash: hash(`${String(survey._id)}:${attendeeKey}`), isTest });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw ActionError.conflict("Ezt a kérdőívet már kitöltötted. Köszönjük!", "already_answered");
    throw error;
  }
  await record(survey, answers, source, isTest);
  return isTest ? { thankYou: survey.thankYou, test: true } : { thankYou: survey.thankYou };
}

export async function submitKiosk(token: string, raw: Record<string, unknown>): Promise<void> {
  const open = token && token.length >= 20 ? await openSurvey(await SurveyModel.findOne({ kioskTokenHash: hash(token), kind: "kiosk" }).exec()) : null;
  if (!open) throw ActionError.notFound("This kiosk link isn't active.");
  await record(open.survey, cleanAnswers(open.survey, raw), "kiosk");
}

// ---- Results ---------------------------------------------------------------------------

export interface QuestionResult {
  question: SurveyQuestion;
  answered: number;
  average: number | null;
  /** rating: counts for 1..RATING_MAX; choice: one per option. */
  counts: Array<{ label: string; count: number }>;
  texts: string[];
}

export async function surveyResults(organizationId: string, surveyId: string): Promise<{ survey: ISurvey; total: number; bySource: Record<string, number>; questions: QuestionResult[] }> {
  const survey = await getSurveyForOrg(organizationId, surveyId);
  const responses = await SurveyResponseModel.find({ surveyId: survey._id, isTest: { $ne: true } }).sort({ createdAt: -1 }).lean().exec();
  const bySource: Record<string, number> = {};
  for (const response of responses) bySource[response.source] = (bySource[response.source] ?? 0) + 1;
  const questions = survey.questions.map((question) => {
    const values = responses.map((r) => (r.answers ?? {})[question.id]).filter((v) => v != null && v !== "");
    if (question.type === "rating") {
      const numbers = values.map(Number).filter((n) => n >= 1 && n <= RATING_MAX);
      return {
        question,
        answered: numbers.length,
        average: numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null,
        counts: Array.from({ length: RATING_MAX }, (_, i) => ({ label: String(i + 1), count: numbers.filter((n) => n === i + 1).length })),
        texts: [],
      };
    }
    if (question.type === "choice") {
      return { question, answered: values.length, average: null, counts: question.choices.map((label) => ({ label, count: values.filter((v) => v === label).length })), texts: [] };
    }
    return { question, answered: values.length, average: null, counts: [], texts: values.slice(0, 200).map(String) };
  });
  return { survey, total: responses.length, bySource, questions };
}

export async function exportSurveyXlsx(organizationId: string, surveyId: string): Promise<{ fileName: string; buffer: Buffer }> {
  const survey = await getSurveyForOrg(organizationId, surveyId);
  const responses = await SurveyResponseModel.find({ surveyId: survey._id, isTest: { $ne: true } }).sort({ createdAt: 1 }).lean().exec();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Válaszok");
  sheet.columns = [
    { header: "Időpont", key: "at", width: 20 },
    { header: "Forrás", key: "source", width: 10 },
    ...survey.questions.map((q) => ({ header: q.label, key: q.id, width: q.type === "text" ? 50 : 16 })),
  ];
  sheet.getRow(1).font = { bold: true };
  for (const response of responses) {
    sheet.addRow({ at: response.createdAt, source: response.source, ...(response.answers ?? {}) });
  }
  const safe = survey.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "survey";
  return { fileName: `${safe}.xlsx`, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
}

// ---- Kiosk for signed-in staff ---------------------------------------------------------

/** The organization's kiosks that are open right now (active, module on), for staff with feedback:kiosk. */
export async function listOpenKiosks(organizationId: string): Promise<PublicSurvey[]> {
  const surveys = await SurveyModel.find({ organizationId, kind: "kiosk", active: true }).sort({ createdAt: 1 }).exec();
  const open: PublicSurvey[] = [];
  for (const survey of surveys) {
    const hit = await openSurvey(survey);
    if (hit) open.push(toPublic(hit.survey, hit.event));
  }
  return open;
}

async function openKioskForOrg(organizationId: string, surveyId: string) {
  if (!/^[a-f0-9]{24}$/i.test(surveyId)) return null;
  const survey = await SurveyModel.findOne({ _id: surveyId, organizationId, kind: "kiosk" }).exec();
  return openSurvey(survey);
}

/** One open kiosk of the organization, or null. */
export async function getKioskForOrg(organizationId: string, surveyId: string): Promise<PublicSurvey | null> {
  const open = await openKioskForOrg(organizationId, surveyId);
  return open ? toPublic(open.survey, open.event) : null;
}

/** A tap on a kiosk run by a signed-in member: stored exactly like a kiosk-link answer. */
export async function submitKioskForOrg(organizationId: string, surveyId: string, raw: Record<string, unknown>): Promise<void> {
  const open = await openKioskForOrg(organizationId, surveyId);
  if (!open) throw ActionError.notFound("This kiosk isn't active.");
  await record(open.survey, cleanAnswers(open.survey, raw), "kiosk");
}
