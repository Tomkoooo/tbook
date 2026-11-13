import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { BookingModel, FieldClaimModel, VoucherModel, eventRepository } from "@tbook/db";
import { BusBoardingModel, BusWaitlistEntryModel } from "./bus-transport/model";
import { EmailDeliveryModel } from "./event-emails/model";
import { SurveyModel, SurveyRespondentModel, SurveyResponseModel } from "./feedback/model";
import { WaitlistEntryModel } from "./waitlist/model";

/**
 * Test data of one event (v1 preview key + `X-TBook-Test: 1`): test
 * bookings and everything hanging off them — tickets, unique-answer
 * claims (test namespace), bus waitlist places and boardings, email send
 * log rows, test waitlist entries, test survey answers.
 *
 * Test records never took event capacity, day passes or bus seats, so
 * removing them changes no live counter. Nothing is emailed.
 */

export interface TestDataCounts {
  bookings: number;
  attendees: number;
  vouchers: number;
  fieldClaims: number;
  busWaitlistEntries: number;
  busBoardings: number;
  emailDeliveries: number;
  waitlistEntries: number;
  surveyResponses: number;
  surveyRespondents: number;
}

export interface TestDataSnapshot {
  counts: TestDataCounts;
  /** The documents as they are now (for the CLI's restore point). */
  documents: Record<keyof TestDataCounts, unknown[]>;
  /** One line per test booking, for a dry-run listing. */
  bookings: Array<{ id: string; registrationNumber: string | null; status: string; customer: string; email: string; guests: number; createdAt: Date }>;
  waitlist: Array<{ id: string; status: string; customer: string; email: string; guests: number; createdAt: Date }>;
}

async function eventForOrg(organizationId: string, eventId: string) {
  const event = Types.ObjectId.isValid(eventId) ? await eventRepository.findById(eventId) : null;
  if (!event || String(event.organizationId) !== organizationId) throw ActionError.notFound("Event not found in this organization.");
  return event;
}

async function filters(eventId: Types.ObjectId) {
  const bookingIds = (await BookingModel.find({ eventId, isTest: true }, { _id: 1 }).lean().exec()).map((b) => b._id);
  const surveyIds = (await SurveyModel.find({ eventId }, { _id: 1 }).lean().exec()).map((s) => s._id);
  const byBooking = { bookingId: { $in: bookingIds } };
  return {
    bookings: { eventId, isTest: true },
    vouchers: { $or: [byBooking, { eventId, isTest: true }] },
    fieldClaims: { $or: [byBooking, { eventId, isTest: true }] },
    busWaitlistEntries: { eventId, ...byBooking },
    busBoardings: { eventId, ...byBooking },
    emailDeliveries: { eventId, ...byBooking },
    waitlistEntries: { eventId, isTest: true },
    surveyResponses: { eventId, isTest: true },
    surveyRespondents: { surveyId: { $in: surveyIds }, isTest: true },
  } satisfies Record<CollectionKey, object>;
}

// Each collection with its model, loosely typed (the purge only finds and deletes).
type LooseModel = { find(q: object): { lean(): { exec(): Promise<unknown[]> } }; deleteMany(q: object): { exec(): Promise<{ deletedCount?: number }> } };
type CollectionKey = Exclude<keyof TestDataCounts, "attendees">;
const MODELS: Record<CollectionKey, LooseModel> = {
  bookings: BookingModel as unknown as LooseModel,
  vouchers: VoucherModel as unknown as LooseModel,
  fieldClaims: FieldClaimModel as unknown as LooseModel,
  busWaitlistEntries: BusWaitlistEntryModel as unknown as LooseModel,
  busBoardings: BusBoardingModel as unknown as LooseModel,
  emailDeliveries: EmailDeliveryModel as unknown as LooseModel,
  waitlistEntries: WaitlistEntryModel as unknown as LooseModel,
  surveyResponses: SurveyResponseModel as unknown as LooseModel,
  surveyRespondents: SurveyRespondentModel as unknown as LooseModel,
};
const KEYS = Object.keys(MODELS) as CollectionKey[];

/** What a purge would remove (read only). */
export async function findTestData(organizationId: string, eventId: string): Promise<TestDataSnapshot> {
  const event = await eventForOrg(organizationId, eventId);
  const query = await filters(event._id as Types.ObjectId);
  const documents = {} as Record<keyof TestDataCounts, unknown[]>;
  for (const key of KEYS) documents[key] = await MODELS[key].find(query[key]).lean().exec();
  const bookings = documents.bookings as Array<{ _id: unknown; registrationNumber?: string | null; status: string; customer?: { name?: string; email?: string }; guests: number; attendees?: unknown[]; createdAt: Date }>;
  const entries = documents.waitlistEntries as Array<{ _id: unknown; status: string; customer?: { name?: string; email?: string }; guests: number; createdAt: Date }>;
  documents.attendees = [];
  const counts = Object.fromEntries(KEYS.map((key) => [key, documents[key].length])) as unknown as TestDataCounts;
  counts.attendees = bookings.reduce((sum, b) => sum + Math.max(b.attendees?.length ?? 0, b.guests ?? 0), 0);
  return {
    counts,
    documents,
    bookings: bookings.map((b) => ({
      id: String(b._id),
      registrationNumber: b.registrationNumber ?? null,
      status: b.status,
      customer: b.customer?.name ?? "",
      email: b.customer?.email ?? "",
      guests: b.guests,
      createdAt: b.createdAt,
    })),
    waitlist: entries.map((e) => ({ id: String(e._id), status: e.status, customer: e.customer?.name ?? "", email: e.customer?.email ?? "", guests: e.guests, createdAt: e.createdAt })),
  };
}

/**
 * Deletes the event's test data. Sends no email and runs no release hook
 * (no waitlist promotion, no bus notice): test records hold no live
 * capacity or seats, so nothing live changes. Returns what was deleted.
 */
export async function purgeTestData(organizationId: string, eventId: string): Promise<TestDataCounts> {
  const event = await eventForOrg(organizationId, eventId);
  const query = await filters(event._id as Types.ObjectId);
  const attendees = (await BookingModel.find(query.bookings, { guests: 1, attendees: 1 }).lean().exec()).reduce((sum, b) => sum + Math.max(b.attendees?.length ?? 0, b.guests ?? 0), 0);
  const counts = { attendees } as TestDataCounts;
  // Bookings last: the other filters are keyed by the test booking ids.
  for (const key of [...KEYS.filter((k) => k !== "bookings"), "bookings" as const]) {
    counts[key] = (await MODELS[key].deleteMany(query[key]).exec()).deletedCount ?? 0;
  }
  return counts;
}
