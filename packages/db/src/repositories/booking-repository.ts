import { Types, type QueryFilter } from "mongoose";
import { BookingModel, type IBooking } from "../models/booking";

/**
 * Admin-table query scope. `organizationId` alone is not enough: real
 * legacy documents exist with no `organizationId` field at all (see
 * scripts/migration-fixtures — one production group and one event are
 * missing it), and bookings inherit the same drift. So the scope also
 * carries the org's group ids and the query unions on them, matching how
 * createPendingBooking derives a booking's org (`group?.organizationId ??
 * event.organizationId`). Without the union, an admin would simply not see
 * their oldest bookings.
 */
export interface BookingScope {
  organizationId: string;
  groupIds: string[];
}

export interface BookingListFilter {
  status?: IBooking["status"][];
  invoiceStatus?: IBooking["invoiceStatus"][];
  eventId?: string;
  groupId?: string;
  hotelId?: string;
  /** Matched against customer name / email / phone, case-insensitively. */
  search?: string;
  createdFrom?: Date;
  createdTo?: Date;
}

export type BookingSortKey = "createdAt" | "totalHuf" | "eventName" | "customerName";

/** Escapes a user-supplied search term so it can't act as a regex. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds the Mongo filter for a scoped, filtered admin booking query. */
export function buildBookingQuery(scope: BookingScope, filter: BookingListFilter = {}): QueryFilter<IBooking> {
  const scopeClauses: QueryFilter<IBooking>[] = [{ organizationId: new Types.ObjectId(scope.organizationId) }];
  if (scope.groupIds.length > 0) {
    scopeClauses.push({ groupId: { $in: scope.groupIds.map((id) => new Types.ObjectId(id)) } });
  }

  const query: QueryFilter<IBooking> = { $or: scopeClauses };

  if (filter.status && filter.status.length > 0) query.status = { $in: filter.status };
  if (filter.invoiceStatus && filter.invoiceStatus.length > 0) query.invoiceStatus = { $in: filter.invoiceStatus };
  if (filter.eventId) query.eventId = new Types.ObjectId(filter.eventId);
  if (filter.groupId) query.groupId = new Types.ObjectId(filter.groupId);
  if (filter.hotelId) query.hotelId = new Types.ObjectId(filter.hotelId);

  if (filter.createdFrom || filter.createdTo) {
    query.createdAt = {
      ...(filter.createdFrom ? { $gte: filter.createdFrom } : {}),
      ...(filter.createdTo ? { $lte: filter.createdTo } : {}),
    };
  }

  const search = filter.search?.trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    // $and so the search's own $or can't overwrite the scope's $or above —
    // that would silently widen the query across every organization.
    query.$and = [{ $or: [{ "customer.name": rx }, { "customer.email": rx }, { "customer.phone": rx }, { eventName: rx }] }];
  }

  return query;
}

const SORT_FIELDS: Record<BookingSortKey, string> = {
  createdAt: "createdAt",
  totalHuf: "totalHuf",
  eventName: "eventName",
  customerName: "customer.name",
};

export const bookingRepository = {
  findById(id: string): Promise<IBooking | null> {
    return BookingModel.findById(id).exec();
  },
  findByStripeSessionId(stripeSessionId: string): Promise<IBooking | null> {
    return BookingModel.findOne({ stripeSessionId }).exec();
  },
  findByCheckoutBundleId(checkoutBundleId: string): Promise<IBooking[]> {
    return BookingModel.find({ checkoutBundleId }).exec();
  },
  /**
   * Read-then-write guest count for capacity checks. The legacy plugin used
   * this same aggregation with no locking (a real oversell race under
   * concurrent checkouts) — packages/services replaces the write side with
   * an atomic findOneAndUpdate guarded by capacity per the approved plan;
   * this aggregate stays useful for admin dashboards/read-only capacity
   * displays.
   */
  async aggregateGuestCountForEvent(eventId: string, statuses: IBooking["status"][]): Promise<number> {
    // aggregate() bypasses Mongoose's automatic query casting, so the
    // ObjectId conversion has to happen explicitly here.
    const result = await BookingModel.aggregate<{ _id: null; total: number }>([
      { $match: { eventId: new Types.ObjectId(eventId), status: { $in: statuses } } },
      { $group: { _id: null, total: { $sum: "$guests" } } },
    ]).exec();
    return result[0]?.total ?? 0;
  },
  create(data: Partial<IBooking>): Promise<IBooking> {
    return BookingModel.create(data);
  },
  updateById(id: string, update: Partial<IBooking>): Promise<IBooking | null> {
    return BookingModel.findByIdAndUpdate(id, update, { returnDocument: "after" }).exec();
  },
  /**
   * CAS transition guarding webhook idempotency: only flips a booking tied
   * to this exact Stripe session from pending/checkout_started to paid.
   * Returns null (not an error) when the booking was already finalized —
   * the filter's status condition is what makes repeated Stripe webhook
   * deliveries for the same session safe to call more than once.
   */
  markPaidIfPending(bookingId: string, stripeSessionId: string, paidAt: Date): Promise<IBooking | null> {
    return BookingModel.findOneAndUpdate(
      { _id: bookingId, stripeSessionId, status: { $in: ["pending", "checkout_started"] } },
      { $set: { status: "paid", paidAt } },
      { returnDocument: "after" },
    ).exec();
  },
  /**
   * Cancels in a single write, optionally replacing the customer note.
   * Uses a dotted `$set` on the nested path rather than writing a whole
   * `customer` object: spreading a Mongoose subdocument yields its
   * internals (`$__`, `_doc`, …) rather than its fields, so building the
   * replacement that way silently wipes name/email/phone. Sibling of
   * markPaidIfPending — the status transition itself is validated by the
   * service before this is called.
   */
  markCancelled(bookingId: string, note: string | null): Promise<IBooking | null> {
    return BookingModel.findByIdAndUpdate(
      bookingId,
      { $set: { status: "cancelled", ...(note == null ? {} : { "customer.note": note }) } },
      { returnDocument: "after" },
    ).exec();
  },
  /**
   * Raw per-booking selections + accommodation guest count for a hotel's
   * active bookings — the input @tbook/services' hotel room/package
   * inventory check sums per package key (mirrors the legacy plugin's
   * countSoldPackageUnitsForHotel query shape; the actual summing logic
   * lives in @tbook/services using @tbook/domain's pure helpers, this stays
   * a thin data read).
   */
  async findAccommodationSummariesByHotel(hotelId: string, statuses: IBooking["status"][]): Promise<Array<{ selections: Record<string, unknown>; accommodationGuests: number }>> {
    const rows = await BookingModel.find({ hotelId, status: { $in: statuses } })
      .select("selections guests quote.accommodationGuests")
      .lean()
      .exec();
    return rows.map((row) => {
      const quoteGuests = (row.quote as { accommodationGuests?: number } | undefined)?.accommodationGuests;
      return {
        selections: (row.selections ?? {}) as Record<string, unknown>,
        accommodationGuests: typeof quoteGuests === "number" && quoteGuests > 0 ? quoteGuests : (row.guests ?? 1),
      };
    });
  },
  /**
   * Org-scoped, filtered, paged admin booking list. `.lean()` because the
   * admin table only reads — no Mongoose document methods are needed, and
   * hydrating thousands of documents for a table is pure overhead.
   */
  listInScope(
    scope: BookingScope,
    filter: BookingListFilter = {},
    opts: { limit?: number; skip?: number; sortBy?: BookingSortKey; sortDir?: "asc" | "desc" } = {},
  ): Promise<IBooking[]> {
    const sortField = SORT_FIELDS[opts.sortBy ?? "createdAt"];
    return BookingModel.find(buildBookingQuery(scope, filter))
      .sort({ [sortField]: opts.sortDir === "asc" ? 1 : -1, _id: -1 })
      .skip(opts.skip ?? 0)
      .limit(opts.limit ?? 50)
      .lean<IBooking[]>()
      .exec();
  },
  countInScope(scope: BookingScope, filter: BookingListFilter = {}): Promise<number> {
    return BookingModel.countDocuments(buildBookingQuery(scope, filter)).exec();
  },
  /**
   * Org-scoped single-booking read. Returns null rather than throwing for a
   * booking in another org, so the action layer can answer 404 and avoid
   * leaking whether the id exists at all.
   */
  findByIdInScope(id: string, scope: BookingScope): Promise<IBooking | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return BookingModel.findOne({ ...buildBookingQuery(scope, {}), _id: new Types.ObjectId(id) }).exec();
  },
  /**
   * Per-status, per-currency counts and money for the dashboard and list
   * summary.
   *
   * Grouping by currency as well as status is not optional: `totalHuf` is a
   * legacy misnomer that actually holds the amount in the booking's own
   * `currency`, and real organizations run in different ones (the Magyar
   * Darts Szövetség data is entirely EUR). Summing across currencies would
   * produce a meaningless number, and labelling it with a single currency
   * would be worse than useless.
   */
  async aggregateStatusTotalsInScope(
    scope: BookingScope,
    filter: BookingListFilter = {},
  ): Promise<Array<{ status: IBooking["status"]; currency: string; count: number; totalHuf: number; guests: number }>> {
    return BookingModel.aggregate<{ status: IBooking["status"]; currency: string; count: number; totalHuf: number; guests: number }>([
      { $match: buildBookingQuery(scope, filter) },
      {
        $group: {
          _id: { status: "$status", currency: { $ifNull: ["$currency", "HUF"] } },
          count: { $sum: 1 },
          totalHuf: { $sum: { $ifNull: ["$totalHuf", 0] } },
          guests: { $sum: { $ifNull: ["$guests", 0] } },
        },
      },
      { $project: { _id: 0, status: "$_id.status", currency: "$_id.currency", count: 1, totalHuf: 1, guests: 1 } },
      { $sort: { status: 1, currency: 1 } },
    ]).exec();
  },
  /**
   * Async cursor over a filtered scope for CSV export — streams rather than
   * buffering, so exporting an org's full booking history can't blow the
   * server's memory on a large event.
   */
  cursorInScope(scope: BookingScope, filter: BookingListFilter = {}) {
    return BookingModel.find(buildBookingQuery(scope, filter)).sort({ createdAt: -1 }).lean<IBooking>().cursor();
  },
};
