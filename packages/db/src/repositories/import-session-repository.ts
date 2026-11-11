import { Types } from "mongoose";
import { ImportSessionModel, type IImportSession } from "../models/import-session";

export const importSessionRepository = {
  create(data: Partial<IImportSession>): Promise<IImportSession> {
    return ImportSessionModel.create(data);
  },
  findById(id: string): Promise<IImportSession | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return ImportSessionModel.findById(id).exec();
  },
  async deleteById(id: string): Promise<void> {
    await ImportSessionModel.deleteOne({ _id: id }).exec();
  },
};
