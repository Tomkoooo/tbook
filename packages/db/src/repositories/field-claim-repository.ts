import { Types } from "mongoose";
import { FieldClaimModel, type IFieldClaim } from "../models/field-claim";

export interface FieldClaimInput {
  fieldKey: string;
  value: string;
}

/**
 * Test bookings (v1 X-TBook-Test) claim in their own namespace: the stored
 * fieldKey is "test:<key>", so the existing unique index keeps test IDs
 * unique among tests without ever blocking (or being blocked by) a live
 * registration.
 */
export const TEST_CLAIM_PREFIX = "test:";
export function claimFieldKey(fieldKey: string, isTest = false): string {
  return isTest ? `${TEST_CLAIM_PREFIX}${fieldKey}` : fieldKey;
}

export const fieldClaimRepository = {
  /**
   * Claims every value for one booking, all or nothing: on a duplicate the
   * claims already written by this call are removed and the clashing claim
   * is returned. Returns null when every value was claimed.
   */
  async claimAll(
    scope: { organizationId: string | null; eventId: string; bookingId: string; isTest?: boolean },
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
          fieldKey: claimFieldKey(claim.fieldKey, scope.isTest),
          value: claim.value,
          isTest: Boolean(scope.isTest),
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
    // Scoped by booking, so either namespace can be matched.
    await FieldClaimModel.deleteMany({
      bookingId,
      $or: claims.flatMap((c) => [
        { fieldKey: c.fieldKey, value: c.value },
        { fieldKey: claimFieldKey(c.fieldKey, true), value: c.value },
      ]),
    }).exec();
  },
  /** The claim on a value in the live namespace, or with `isTest` in the test one. */
  findForEvent(eventId: string, fieldKey: string, value: string, isTest = false): Promise<IFieldClaim | null> {
    return FieldClaimModel.findOne({ eventId, fieldKey: claimFieldKey(fieldKey, isTest), value }).exec();
  },
};
