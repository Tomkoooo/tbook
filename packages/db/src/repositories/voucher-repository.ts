import { Types, type QueryFilter } from "mongoose";
import { VoucherModel, type IVoucher } from "../models/voucher";

export interface VoucherListFilter {
  status?: IVoucher["status"][];
  /** Matched against the attendee display name, case-insensitively. */
  search?: string;
}

/** Escapes a user-supplied search term so it can't act as a regex. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildVoucherQuery(eventId: string, filter: VoucherListFilter = {}): QueryFilter<IVoucher> {
  const query: QueryFilter<IVoucher> = { eventId: new Types.ObjectId(eventId) };
  if (filter.status && filter.status.length > 0) query.status = { $in: filter.status };
  const search = filter.search?.trim();
  if (search) query.displayName = new RegExp(escapeRegex(search), "i");
  return query;
}

export const voucherRepository = {
  findById(id: string): Promise<IVoucher | null> {
    return VoucherModel.findById(id).exec();
  },
  findByToken(token: string): Promise<IVoucher | null> {
    return VoucherModel.findOne({ token }).exec();
  },
  findByBookingId(bookingId: string): Promise<IVoucher[]> {
    return VoucherModel.find({ bookingId }).sort({ attendeeIndex: 1 }).exec();
  },
  create(data: Partial<IVoucher>): Promise<IVoucher> {
    return VoucherModel.create(data);
  },
  createMany(data: Partial<IVoucher>[]): Promise<IVoucher[]> {
    return VoucherModel.create(data);
  },
  updateById(id: string, update: Partial<IVoucher>): Promise<IVoucher | null> {
    return VoucherModel.findByIdAndUpdate(id, update, { returnDocument: "after" }).exec();
  },
  voidAllForBooking(bookingId: string): Promise<void> {
    return VoucherModel.updateMany({ bookingId, status: { $ne: "void" } }, { $set: { status: "void" } })
      .exec()
      .then(() => undefined);
  },
  /** All vouchers for a booking share one multi-page PDF (one page per guest). */
  setPdfFileNameForBooking(bookingId: string, pdfFileName: string): Promise<void> {
    return VoucherModel.updateMany({ bookingId }, { $set: { pdfFileName } })
      .exec()
      .then(() => undefined);
  },
  markEmailedForBooking(bookingId: string, email: string, name: string): Promise<void> {
    return VoucherModel.updateMany({ bookingId }, { $set: { emailedAt: new Date(), lastSentToEmail: email, lastSentToName: name } })
      .exec()
      .then(() => undefined);
  },
  /** CAS check-in — the filter's status:"active" makes this atomic against double-scanning. */
  checkIn(voucherId: string, userId: string | null): Promise<IVoucher | null> {
    return VoucherModel.findOneAndUpdate(
      { _id: voucherId, status: "active" },
      { $set: { status: "checked_in", checkedInAt: new Date(), checkedInByUserId: userId } },
      { returnDocument: "after" },
    ).exec();
  },
  /**
   * The door roster for one event: every issued voucher, newest check-ins
   * visible via `checkedInAt`. Scoping is by event rather than by org
   * because the caller (the admin check-in screen) has already resolved
   * that the event belongs to its org.
   */
  listByEvent(
    eventId: string,
    filter: VoucherListFilter = {},
    opts: { limit?: number; skip?: number } = {},
  ): Promise<IVoucher[]> {
    return VoucherModel.find(buildVoucherQuery(eventId, filter))
      .sort({ displayName: 1, attendeeIndex: 1 })
      .skip(opts.skip ?? 0)
      .limit(opts.limit ?? 100)
      .lean<IVoucher[]>()
      .exec();
  },
  countByEvent(eventId: string, filter: VoucherListFilter = {}): Promise<number> {
    return VoucherModel.countDocuments(buildVoucherQuery(eventId, filter)).exec();
  },
  /** Check-in progress per status for one event (admin dashboard + roster header). */
  aggregateStatusTotalsByEvent(eventId: string): Promise<Array<{ status: IVoucher["status"]; count: number }>> {
    return VoucherModel.aggregate<{ status: IVoucher["status"]; count: number }>([
      { $match: { eventId: new Types.ObjectId(eventId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $project: { _id: 0, status: "$_id", count: 1 } },
      { $sort: { status: 1 } },
    ]).exec();
  },
  /** Undo an accidental check-in (permission-gated to voucher:manage). */
  revertCheckIn(voucherId: string): Promise<IVoucher | null> {
    return VoucherModel.findOneAndUpdate(
      { _id: voucherId, status: "checked_in" },
      { $set: { status: "active", checkedInAt: null, checkedInByUserId: null } },
      { returnDocument: "after" },
    ).exec();
  },
};
