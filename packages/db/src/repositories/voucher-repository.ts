import { VoucherModel, type IVoucher } from "../models/voucher";

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
};
