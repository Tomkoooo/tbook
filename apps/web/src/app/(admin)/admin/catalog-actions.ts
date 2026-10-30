"use server";

import { revalidatePath } from "next/cache";
import { ActionError, parseInput } from "@tbook/actions";
import {
  createEvent,
  createEventGroup,
  createHotel,
  rotateEventGroupApiKey,
  updateEvent,
  updateEventGroup,
  updateHotel,
} from "@tbook/services";
import { adminEventGroupInputSchema, adminEventInputSchema, adminHotelInputSchema } from "@tbook/schemas";
import { requireOrgPermission } from "@/lib/admin-auth";

/**
 * Server actions behind the catalog forms (groups, events, hotels). Same
 * contract as actions.ts: re-check the permission here, return a plain
 * result so failures render inline.
 */

export interface CatalogActionResult {
  ok: boolean;
  message?: string;
  /** Id of the saved record — lets a create form navigate to the edit page. */
  id?: string;
  /** Shown once, when a group key is created or rotated. */
  apiKey?: string;
}

function fail(error: unknown, label: string): CatalogActionResult {
  if (error instanceof ActionError) return { ok: false, message: error.message };
  console.error(`[${label}]`, error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
/** Empty field → null, so "no limit" is expressible. */
const optionalNumber = (form: FormData, key: string) => {
  const raw = text(form, key);
  return raw === "" ? null : Number(raw);
};
const requiredNumber = (form: FormData, key: string) => Number(text(form, key) || 0);
const optionalDate = (form: FormData, key: string) => text(form, key) || null;
const flag = (form: FormData, key: string) => form.get(key) !== null;

/** Row editors submit their rows as one JSON field; a malformed one is a validation error, not a crash. */
function jsonRows(form: FormData, key: string): unknown[] {
  const raw = text(form, key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw ActionError.validation(`Could not read the ${key} rows.`);
  }
}

/** Reads the day-pass section of the event form. Rows come as JSON, closed days as free text. */
function dayPassFromForm(form: FormData) {
  const overrides: Record<string, number> = {};
  for (const row of jsonRows(form, "capacityOverrides") as Array<{ date?: string; capacity?: number | string }>) {
    if (row?.date && row.capacity !== "" && row.capacity != null) overrides[row.date] = Number(row.capacity);
  }
  return {
    weekdayPriceHuf: requiredNumber(form, "weekdayPriceHuf"),
    weekendPriceHuf: requiredNumber(form, "weekendPriceHuf"),
    weekendDays: form.getAll("weekendDays").map(Number),
    dailyCapacity: optionalNumber(form, "dailyCapacity"),
    capacityOverrides: overrides,
    closedDays: text(form, "closedDays")
      .split(/[\s,;]+/)
      .filter(Boolean),
  };
}

export async function saveGroupAction(groupId: string | null, formData: FormData): Promise<CatalogActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("group:write");
    const input = parseInput(adminEventGroupInputSchema, {
      name: text(formData, "name"),
      description: text(formData, "description"),
      status: text(formData, "status") || "draft",
      defaultPriceBasis: text(formData, "defaultPriceBasis") || "net",
      defaultVatPercent: requiredNumber(formData, "defaultVatPercent"),
      listOnTBookSite: flag(formData, "listOnTBookSite"),
      listingTitle: text(formData, "listingTitle"),
      listingUrl: text(formData, "listingUrl"),
    });

    revalidatePath("/admin/groups");
    if (groupId) {
      await updateEventGroup(organizationId, groupId, input);
      return { ok: true, id: groupId, message: "Group saved." };
    }
    const { group, apiKey } = await createEventGroup(organizationId, input);
    return { ok: true, id: String(group._id), apiKey, message: "Group created. Copy its API key now — it won't be shown again." };
  } catch (error) {
    return fail(error, "save group");
  }
}

export async function rotateGroupKeyAction(groupId: string): Promise<CatalogActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("group:apiKey");
    const { apiKey } = await rotateEventGroupApiKey(organizationId, groupId);
    revalidatePath(`/admin/groups/${groupId}`);
    return { ok: true, apiKey, message: "New API key issued. The previous key no longer works." };
  } catch (error) {
    return fail(error, "rotate group key");
  }
}

export async function saveEventAction(eventId: string | null, formData: FormData): Promise<CatalogActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("event:write");
    const tdartsEnabled = flag(formData, "tdartsEnabled");
    const kind = text(formData, "kind") || "standard";
    const input = parseInput(adminEventInputSchema, {
      kind,
      dayPass: kind === "day_pass" ? dayPassFromForm(formData) : null,
      groupId: text(formData, "groupId"),
      name: text(formData, "name"),
      description: text(formData, "description"),
      address: text(formData, "address"),
      startDate: text(formData, "startDate"),
      endDate: text(formData, "endDate"),
      startTime: text(formData, "startTime") || null,
      endTime: text(formData, "endTime") || null,
      salesOpensAt: optionalDate(formData, "salesOpensAt"),
      salesClosesAt: optionalDate(formData, "salesClosesAt"),
      currency: text(formData, "currency").toUpperCase() || "HUF",
      // A day-pass event is priced per day, so the flat ticket fee is unused.
      ticketFeeHuf: kind === "day_pass" ? 0 : requiredNumber(formData, "ticketFeeHuf"),
      ticketFeeMode: text(formData, "ticketFeeMode") || "per_person",
      registrationUnit: text(formData, "registrationUnit") || "person",
      playersPerTicket: requiredNumber(formData, "playersPerTicket") || 1,
      ticketPriceBasis: text(formData, "ticketPriceBasis") || "net",
      ticketVatPercent: requiredNumber(formData, "ticketVatPercent"),
      capacity: optionalNumber(formData, "capacity"),
      vouchersEnabled: flag(formData, "vouchersEnabled"),
      publicListing: text(formData, "publicListing") || "listed",
      status: text(formData, "status") || "draft",
      tdartsEnabled,
      tdartsTournamentCode: tdartsEnabled ? text(formData, "tdartsTournamentCode") || null : null,
    });

    revalidatePath("/admin/events");
    if (eventId) {
      await updateEvent(organizationId, eventId, input);
      return { ok: true, id: eventId, message: "Event saved." };
    }
    const event = await createEvent(organizationId, input);
    return { ok: true, id: String(event._id), message: "Event created." };
  } catch (error) {
    return fail(error, "save event");
  }
}

export async function saveHotelAction(hotelId: string | null, formData: FormData): Promise<CatalogActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("hotel:write");
    const input = parseInput(adminHotelInputSchema, {
      groupId: text(formData, "groupId"),
      name: text(formData, "name"),
      description: text(formData, "description"),
      address: text(formData, "address"),
      distanceFromVenueKm: optionalNumber(formData, "distanceFromVenueKm"),
      contactEmail: text(formData, "contactEmail"),
      contactPhone: text(formData, "contactPhone"),
      currency: text(formData, "currency").toUpperCase() || "HUF",
      bookingCapacity: optionalNumber(formData, "bookingCapacity"),
      roomInventory: optionalNumber(formData, "roomInventory"),
      status: text(formData, "status") || "draft",
      priceBasis: text(formData, "priceBasis") || "net",
      vatPercent: requiredNumber(formData, "vatPercent"),
      roomTypes: jsonRows(formData, "roomTypes"),
      packages: jsonRows(formData, "packages"),
    });

    revalidatePath("/admin/hotels");
    if (hotelId) {
      await updateHotel(organizationId, hotelId, input);
      return { ok: true, id: hotelId, message: "Hotel saved." };
    }
    const hotel = await createHotel(organizationId, input);
    return { ok: true, id: String(hotel._id), message: "Hotel created." };
  } catch (error) {
    return fail(error, "save hotel");
  }
}
