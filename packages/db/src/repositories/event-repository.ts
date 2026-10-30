import { EventModel, type IEvent } from "../models/event";

export const eventRepository = {
  findById(id: string): Promise<IEvent | null> {
    return EventModel.findById(id).exec();
  },
  findByGroupId(groupId: string): Promise<IEvent[]> {
    return EventModel.find({ groupId }).sort({ sortOrder: 1, startDate: 1 }).exec();
  },
  /**
   * Admin listing: an org's events by the same two-way rule as the booking
   * scope — events carrying the organizationId, plus events of the org's
   * groups (legacy production events have no organizationId of their own).
   */
  findForOrgScope(organizationId: string, groupIds: string[]): Promise<IEvent[]> {
    return EventModel.find({ $or: [{ organizationId }, { groupId: { $in: groupIds } }] })
      .sort({ startDate: -1 })
      .exec();
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
  /**
   * Reserves passes on several days of a day-pass event, all-or-nothing.
   *
   * Every per-day counter lives in the one event document, so a single
   * findOneAndUpdate can test every day's remaining room in its filter and
   * increment them all in its update — MongoDB applies a single-document
   * write atomically, which is the whole guarantee: either every day in the
   * basket had room and all of them are incremented, or none are. That is
   * the same trick reserveCapacity uses for the event total, extended
   * across days without needing a transaction.
   *
   * `limits` maps a day to its capacity, or null for unlimited. Returns null
   * when any day lacks room.
   */
  reserveDayCapacity(eventId: string, tickets: Record<string, number>, limits: Record<string, number | null>): Promise<IEvent | null> {
    const conditions: Record<string, unknown>[] = [];
    const inc: Record<string, number> = {};

    for (const [day, qty] of Object.entries(tickets)) {
      inc[`daySold.${day}`] = qty;
      const limit = limits[day] ?? null;
      if (limit === null) continue;
      // A missing counter means nothing sold yet, which a $lte alone would not match.
      if (qty > limit) return Promise.resolve(null);
      conditions.push({
        $or: [{ [`daySold.${day}`]: { $exists: false } }, { [`daySold.${day}`]: { $lte: limit - qty } }],
      });
    }

    return EventModel.findOneAndUpdate(
      { _id: eventId, ...(conditions.length > 0 ? { $and: conditions } : {}) },
      { $inc: inc },
      { returnDocument: "after" },
    ).exec();
  },
  /** Day-pass counterpart of reserveCapacityUnchecked — a console user knowingly selling past a day's cap. */
  reserveDayCapacityUnchecked(eventId: string, tickets: Record<string, number>): Promise<IEvent | null> {
    const inc = Object.fromEntries(Object.entries(tickets).map(([day, qty]) => [`daySold.${day}`, qty]));
    return EventModel.findOneAndUpdate({ _id: eventId }, { $inc: inc }, { returnDocument: "after" }).exec();
  },
  /** Compensating release for reserveDayCapacity; each day is clamped at 0. */
  async releaseDayCapacity(eventId: string, tickets: Record<string, number>): Promise<void> {
    for (const [day, qty] of Object.entries(tickets)) {
      const path = `daySold.${day}`;
      const decremented = await EventModel.updateOne({ _id: eventId, [path]: { $gte: qty } }, { $inc: { [path]: -qty } });
      if (decremented.matchedCount === 0) await EventModel.updateOne({ _id: eventId }, { $set: { [path]: 0 } });
    }
  },
};
