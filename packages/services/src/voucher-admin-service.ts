import {
  eventGroupRepository,
  eventRepository,
  voucherRepository,
  type IEvent,
  type IVoucher,
  type VoucherListFilter,
} from "@tbook/db";
import { ActionError } from "@tbook/actions";
import { scanVoucher, type ScanVoucherOptions, type VoucherScanResponse } from "./voucher-service";
import { dispatchWebhookEvent, voucherWebhookData } from "./webhook-service";

/**
 * Read models + write orchestration behind the admin check-in console.
 * Permission enforcement stays at the request layer (apps/web's
 * requireOrgPermission), as everywhere else in this package.
 */

/**
 * Asserts an event belongs to the acting org, by the same two-way rule the
 * booking scope uses: either the event carries the `organizationId`, or it
 * belongs to one of the org's groups. The second branch is not a nicety —
 * real production events exist with no `organizationId` field at all (see
 * scripts/migration-fixtures), and checking only the direct field would
 * make an org's own legacy events look like someone else's.
 *
 * Reports 404 rather than 403 so the event id space isn't probeable.
 */
export async function assertEventInOrg(organizationId: string, eventId: string): Promise<IEvent> {
  const event = await eventRepository.findById(eventId);
  if (!event) throw ActionError.notFound("Event not found");

  if (event.organizationId && String(event.organizationId) === organizationId) return event;

  if (event.groupId) {
    const group = await eventGroupRepository.findById(String(event.groupId));
    if (group?.organizationId && String(group.organizationId) === organizationId) return event;
  }

  throw ActionError.notFound("Event not found");
}

export interface CheckInRosterResult {
  event: { id: string; name: string; startDate: Date; endDate: Date; kind: "standard" | "day_pass" };
  vouchers: IVoucher[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  statusTotals: Array<{ status: IVoucher["status"]; count: number }>;
  checkedIn: number;
  /** Still admittable: issued and not yet scanned (void ones are excluded). */
  outstanding: number;
}

const MAX_PAGE_SIZE = 200;

/** The door roster for one event: who's expected, who's already scanned in. */
export async function listCheckInRosterForOrg(
  organizationId: string,
  eventId: string,
  filter: VoucherListFilter = {},
  opts: { page?: number; pageSize?: number } = {},
): Promise<CheckInRosterResult> {
  const event = await assertEventInOrg(organizationId, eventId);

  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), MAX_PAGE_SIZE);
  const page = Math.max(opts.page ?? 1, 1);

  const [vouchers, total, statusTotals] = await Promise.all([
    voucherRepository.listByEvent(eventId, filter, { limit: pageSize, skip: (page - 1) * pageSize }),
    voucherRepository.countByEvent(eventId, filter),
    voucherRepository.aggregateStatusTotalsByEvent(eventId),
  ]);

  const byStatus = (status: IVoucher["status"]) => statusTotals.find((row) => row.status === status)?.count ?? 0;

  return {
    event: { id: String(event._id), name: event.name, startDate: event.startDate, endDate: event.endDate, kind: event.kind ?? "standard" },
    vouchers,
    total,
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
    statusTotals,
    checkedIn: byStatus("checked_in"),
    outstanding: byStatus("active"),
  };
}

/**
 * Admin scan. Always passes the acting org down so a voucher from another
 * tenant reads as "not found" rather than being checked in — the scanner is
 * the one surface where a stray QR code from a different event or org
 * genuinely does get presented.
 */
export async function scanVoucherAsAdmin(
  organizationId: string,
  rawToken: string,
  opts: Omit<ScanVoucherOptions, "organizationId"> = {},
): Promise<VoucherScanResponse> {
  if (opts.eventId) await assertEventInOrg(organizationId, opts.eventId);
  const outcome = await scanVoucher(rawToken, { ...opts, organizationId });

  // Only a real, first check-in is an event worth publishing — a duplicate
  // scan or an invalid code is not, or a door queue would spam integrations.
  if (outcome.result === "valid" && outcome.voucher && opts.mode !== "lookup") {
    await dispatchWebhookEvent(organizationId, "voucher.checked_in", voucherWebhookData(outcome.voucher));
  }

  return outcome;
}

/**
 * Undoes an accidental check-in. Org-scoped via the voucher's own event, so
 * a legacy voucher with no `organizationId` is still reachable by the org
 * that owns its event.
 */
export async function revertCheckInAsAdmin(organizationId: string, voucherId: string): Promise<IVoucher> {
  const voucher = await voucherRepository.findById(voucherId);
  if (!voucher) throw ActionError.notFound("Voucher not found");

  await assertEventInOrg(organizationId, String(voucher.eventId));

  const reverted = await voucherRepository.revertCheckIn(voucherId);
  if (!reverted) throw ActionError.validation("This entry is not checked in.");
  return reverted;
}
