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
  updateById(id: string, update: Partial<IVoucher>): Promise<IVoucher | null> {
    return VoucherModel.findByIdAndUpdate(id, update, { new: true }).exec();
  },
};
