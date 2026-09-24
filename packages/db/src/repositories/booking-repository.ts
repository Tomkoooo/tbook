import { Types } from "mongoose";
import { BookingModel, type IBooking } from "../models/booking";

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
};
