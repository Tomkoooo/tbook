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
};
