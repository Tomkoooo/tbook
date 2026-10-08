import { EventModel, type IEvent } from "../models/event";

export const eventRepository = {
  findById(id: string): Promise<IEvent | null> {
    return EventModel.findById(id).exec();
  },
  findByGroupId(groupId: string): Promise<IEvent[]> {
    return EventModel.find({ groupId }).sort({ sortOrder: 1, startDate: 1 }).exec();
  },
  /** Public storefront read: active events for a group, in display order. */
  findActiveByGroupId(groupId: string): Promise<IEvent[]> {
    return EventModel.find({ groupId, status: "active" }).sort({ sortOrder: 1, startDate: 1 }).exec();
  },
  findActiveByOrganizationId(organizationId: string): Promise<IEvent[]> {
    return EventModel.find({ organizationId, status: "active" }).sort({ startDate: 1 }).exec();
  },
  /** Public directory listing: how many not-yet-ended active events a group currently has on sale. */
  countActiveUpcomingForGroup(groupId: string, now: Date): Promise<number> {
    return EventModel.countDocuments({ groupId, status: "active", endDate: { $gte: now } }).exec();
  },
  /** Public directory listing: the soonest not-yet-ended active event for a group. */
  findNextActiveUpcomingForGroup(groupId: string, now: Date): Promise<IEvent | null> {
    return EventModel.findOne({ groupId, status: "active", endDate: { $gte: now } })
      .sort({ startDate: 1 })
      .exec();
  },
  create(data: Partial<IEvent>): Promise<IEvent> {
    return EventModel.create(data);
  },
  updateById(id: string, update: Partial<IEvent>): Promise<IEvent | null> {
    return EventModel.findByIdAndUpdate(id, update, { returnDocument: "after" }).exec();
  },
  /**
   * Atomically reserves `guests` of capacity by incrementing soldGuestCount,
   * guarded by a capacity condition in the filter itself — single-document
   * writes are atomic in MongoDB, so this closes the legacy read-then-write
   * oversell race without needing a multi-document transaction (which would
   * require a replica-set-mode test double). `capacity: null` means
   * unlimited. Returns the updated event on success, or null when there
   * isn't enough room left (the caller should not create a booking then).
   */
  reserveCapacity(eventId: string, guests: number): Promise<IEvent | null> {
    return EventModel.findOneAndUpdate(
      {
        _id: eventId,
        $or: [
          { capacity: null },
          { $expr: { $lte: [{ $add: ["$soldGuestCount", guests] }, "$capacity"] } },
        ],
      },
      { $inc: { soldGuestCount: guests } },
      { returnDocument: "after" },
    ).exec();
  },
  /**
   * Unconditional capacity increment, for an org manager deliberately
   * registering past a sold-out cap (a comped entry, a late addition the
   * organizer has agreed to). Separate method rather than a flag on
   * reserveCapacity so overselling can never happen by passing the wrong
   * argument on the public booking path — a caller has to name it.
   */
  reserveCapacityUnchecked(eventId: string, guests: number): Promise<IEvent | null> {
    return EventModel.findOneAndUpdate({ _id: eventId }, { $inc: { soldGuestCount: guests } }, { returnDocument: "after" }).exec();
  },
  /**
   * Compensating release for `reserveCapacity` — used both by expireBooking
   * (releasing a no-longer-held reservation) and as a rollback when booking
   * creation fails after capacity was already reserved. Clamped at 0 so a
   * double-release can never push the counter negative.
   */
  async releaseCapacity(eventId: string, guests: number): Promise<void> {
    await EventModel.updateOne(
      { _id: eventId },
      [{ $set: { soldGuestCount: { $max: [0, { $subtract: ["$soldGuestCount", guests] }] } } }],
      { updatePipeline: true },
    );
  },
};
