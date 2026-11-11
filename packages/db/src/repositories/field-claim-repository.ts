import { Types } from "mongoose";
import { FieldClaimModel, type IFieldClaim } from "../models/field-claim";

export interface FieldClaimInput {
  fieldKey: string;
  value: string;
}

export const fieldClaimRepository = {
  /**
   * Claims every value for one booking, all or nothing: on a duplicate the
   * claims already written by this call are removed and the clashing claim
   * is returned. Returns null when every value was claimed.
   */
  async claimAll(
    scope: { organizationId: string | null; eventId: string; bookingId: string },
    claims: FieldClaimInput[],
  ): Promise<FieldClaimInput | null> {
    // The unique index is the guarantee; make sure it exists before relying
    // on it (Mongoose builds indexes in the background on first use).
    await FieldClaimModel.init();
    const written: string[] = [];
    for (const claim of claims) {
      try {
        const doc = await FieldClaimModel.create({
          organizationId: scope.organizationId ? new Types.ObjectId(scope.organizationId) : null,
          eventId: new Types.ObjectId(scope.eventId),
          bookingId: new Types.ObjectId(scope.bookingId),
          fieldKey: claim.fieldKey,
          value: claim.value,
        });
        written.push(String(doc._id));
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          if (written.length > 0) await FieldClaimModel.deleteMany({ _id: { $in: written } }).exec();
          return claim;
        }
        if (written.length > 0) await FieldClaimModel.deleteMany({ _id: { $in: written } }).exec();
        throw error;
      }
    }
    return null;
  },
  async releaseForBooking(bookingId: string): Promise<void> {
    await FieldClaimModel.deleteMany({ bookingId }).exec();
  },
  async releaseValues(bookingId: string, claims: FieldClaimInput[]): Promise<void> {
    if (claims.length === 0) return;
    await FieldClaimModel.deleteMany({ bookingId, $or: claims.map((c) => ({ fieldKey: c.fieldKey, value: c.value })) }).exec();
  },
  findForEvent(eventId: string, fieldKey: string, value: string): Promise<IFieldClaim | null> {
    return FieldClaimModel.findOne({ eventId, fieldKey, value }).exec();
  },
};
