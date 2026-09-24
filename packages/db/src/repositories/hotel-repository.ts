import { HotelModel, type IHotel } from "../models/hotel";

export const hotelRepository = {
  findById(id: string): Promise<IHotel | null> {
    return HotelModel.findById(id).exec();
  },
  findByGroupId(groupId: string): Promise<IHotel[]> {
    return HotelModel.find({ groupId }).sort({ sortOrder: 1 }).exec();
  },
  create(data: Partial<IHotel>): Promise<IHotel> {
    return HotelModel.create(data);
  },
  updateById(id: string, update: Partial<IHotel>): Promise<IHotel | null> {
    return HotelModel.findByIdAndUpdate(id, update, { returnDocument: "after" }).exec();
  },
};
