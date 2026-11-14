"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ActionError } from "@tbook/actions";
import { busTransport, BUS_TRANSPORT } from "@tbook/modules";
import { getEventForOrg, resolveModules } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";

/** Bus routes, captain links and boarding, behind bus:manage (fallback booking:manage). */

export interface BusActionResult {
  ok: boolean;
  message?: string;
  /** Shown once after a captain link is created. */
  captainUrl?: string;
}

function fail(error: unknown, label: string): BusActionResult {
  if (error instanceof ActionError) return { ok: false, message: error.message };
  console.error(`[${label}]`, error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

async function requireBusEvent(eventId: string) {
  const context = await requireOrgPermission("bus:manage");
  const event = await getEventForOrg(context.organizationId, eventId);
  if (!(await resolveModules({ organizationId: context.organizationId, event })).isOn(BUS_TRANSPORT)) {
    throw ActionError.validation("Bus transport isn't switched on for this event (event page → Modules).");
  }
  return { ...context, event };
}

/** "2026-12-04T15:30" from a datetime-local input, read as Budapest time. */
function departureFromInput(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw);
  return match ? busTransport.budapestToUtc(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])) : null;
}

/** The repeatable stop rows of the bus form (rows without a city are dropped). */
function stopsFromForm(formData: FormData) {
  const cities = formData.getAll("stopCity").map((value) => String(value).trim());
  const points = formData.getAll("stopPickupPoint").map((value) => String(value).trim());
  const times = formData.getAll("stopDepartureAt").map((value) => String(value).trim());
  return cities
    .map((city, index) => ({ city, pickupPoint: points[index] ?? "", departureAt: departureFromInput(times[index] ?? "") }))
    .filter((stop) => stop.city);
}

export async function saveBusRouteAction(eventId: string, routeId: string | null, formData: FormData): Promise<BusActionResult> {
  try {
    const { organizationId } = await requireBusEvent(eventId);
    const input = {
      code: text(formData, "code"),
      city: text(formData, "city"),
      pickupPoint: text(formData, "pickupPoint"),
      departureAt: departureFromInput(text(formData, "departureAt")),
      returnInfo: text(formData, "returnInfo"),
      capacity: Number.parseInt(text(formData, "capacity"), 10),
      captainName: text(formData, "captainName"),
      captainPhone: text(formData, "captainPhone"),
      notes: text(formData, "notes"),
      active: formData.get("active") !== null,
      sortOrder: Number.parseInt(text(formData, "sortOrder") || "0", 10) || 0,
      stops: stopsFromForm(formData),
    };
    if (!input.code || !input.city) throw ActionError.validation("Give the bus a code and a city.");
    if (!Number.isFinite(input.capacity) || input.capacity < 1) throw ActionError.validation("Seats must be at least 1.");
    if (routeId) {
      const route = await busTransport.getRouteForOrg(organizationId, routeId);
      if (String(route.eventId) !== eventId) throw ActionError.notFound("Bus not found");
      await busTransport.updateRoute(organizationId, routeId, input);
    } else {
      await busTransport.createRoute(organizationId, eventId, input);
    }
    revalidatePath("/admin/bus");
    return { ok: true, message: routeId ? "Bus saved." : "Bus added." };
  } catch (error) {
    return fail(error, "saveBusRouteAction");
  }
}

export async function deleteBusRouteAction(routeId: string): Promise<BusActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("bus:manage");
    await busTransport.deleteRoute(organizationId, routeId);
    revalidatePath("/admin/bus");
    return { ok: true, message: "Bus deleted." };
  } catch (error) {
    return fail(error, "deleteBusRouteAction");
  }
}

async function appBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function rotateCaptainLinkAction(routeId: string): Promise<BusActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("bus:manage");
    const token = await busTransport.rotateCaptainToken(organizationId, routeId);
    revalidatePath("/admin/bus");
    return { ok: true, message: "New captain link created. Any earlier link stops working.", captainUrl: `${await appBaseUrl()}/captain/${token}` };
  } catch (error) {
    return fail(error, "rotateCaptainLinkAction");
  }
}

export async function revokeCaptainLinkAction(routeId: string): Promise<BusActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("bus:manage");
    await busTransport.revokeCaptainToken(organizationId, routeId);
    revalidatePath("/admin/bus");
    return { ok: true, message: "Captain link revoked." };
  } catch (error) {
    return fail(error, "revokeCaptainLinkAction");
  }
}

export async function recountBusSeatsAction(eventId: string): Promise<BusActionResult> {
  try {
    const { organizationId } = await requireBusEvent(eventId);
    const routes = await busTransport.recountSeats(organizationId, eventId);
    revalidatePath("/admin/bus");
    return { ok: true, message: `Seats recounted from the registrations on ${routes} buses.` };
  } catch (error) {
    return fail(error, "recountBusSeatsAction");
  }
}

/** Emails the bus's passengers who haven't had its current captain's details yet ("bus_captain_notice"). */
export async function sendCaptainNoticeAction(routeId: string): Promise<BusActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("bus:manage");
    const route = await busTransport.getRouteForOrg(organizationId, routeId);
    await requireBusEvent(String(route.eventId));
    const result = await busTransport.sendCaptainNotice(organizationId, routeId);
    revalidatePath("/admin/bus");
    const parts = [`${result.sent} of ${result.total} passengers emailed the captain's details.`];
    if (result.failed > 0) parts.push(`${result.failed} failed (see the email's delivery log on the Emails page).`);
    if (result.createdTemplate) parts.push("The “Bus: captain's details” email was created from the built-in text; edit it on the Emails page.");
    return { ok: result.failed === 0, message: parts.join(" ") };
  } catch (error) {
    return fail(error, "sendCaptainNoticeAction");
  }
}

export async function setBoardingAdminAction(routeId: string, attendeeKey: string, leg: string, status: string | null): Promise<BusActionResult> {
  try {
    const { organizationId, userId } = await requireOrgPermission("bus:board");
    const route = await busTransport.getRouteForOrg(organizationId, routeId);
    if (!(busTransport.busLegs as readonly string[]).includes(leg)) throw ActionError.validation("Unknown leg.");
    if (status !== null && !(busTransport.boardingStatuses as readonly string[]).includes(status)) throw ActionError.validation("Unknown status.");
    await busTransport.setBoarding(route, attendeeKey, leg as busTransport.BusLeg, status as busTransport.BoardingStatus | null, `user:${userId}`);
    revalidatePath(`/admin/bus/${routeId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "setBoardingAdminAction");
  }
}
