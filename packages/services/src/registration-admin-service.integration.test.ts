import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import {
  BookingModel,
  EventGroupModel,
  EventModel,
  OrganizationModel,
  VoucherModel,
  dbConnect,
  dbDisconnectAll,
  eventRepository,
  voucherRepository,
} from "@tbook/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachInvoiceToBooking,
  createAdminRegistration,
  ensureVouchersForBooking,
  listRegistrableEvents,
  markBookingPaidOffline,
  previewAdminRegistration,
  updateBookingDetails,
} from "./registration-admin-service";

const ACTOR = { userId: new Types.ObjectId().toHexString() };

describe("registration-admin-service", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let otherOrgId: string;
  /** person-unit, sales open, capacity 10 */
  let personEventId: string;
  /** team-unit, roster of 2, sales CLOSED */
  let pairEventId: string;
  /** person-unit, capacity 2, already full */
  let fullEventId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await Promise.all([
      BookingModel.deleteMany({}),
      EventModel.deleteMany({}),
      EventGroupModel.deleteMany({}),
      OrganizationModel.deleteMany({}),
      VoucherModel.deleteMany({}),
    ]);

    const org = await OrganizationModel.create({ name: "Magyar Darts", slug: "mdsz", status: "active" });
    const other = await OrganizationModel.create({ name: "Rival", slug: "rival", status: "active" });
    orgId = String(org._id);
    otherOrgId = String(other._id);

    const apiKey = { apiKeyHash: "h", apiKeyHint: "tbk_x", apiKeyCreatedAt: new Date() };
    const group = await EventGroupModel.create({ name: "WDF", organizationId: org._id, status: "active", ...apiKey });

    const day = 24 * 60 * 60 * 1000;
    const base = {
      groupId: group._id,
      organizationId: org._id,
      status: "active" as const,
      startDate: new Date(Date.now() + 30 * day),
      endDate: new Date(Date.now() + 31 * day),
      ticketFeeHuf: 10000,
      ticketFeeMode: "per_person" as const,
      ticketPriceBasis: "gross" as const,
      ticketVatPercent: 27,
      vouchersEnabled: true,
    };

    const personEvent = await EventModel.create({
      ...base,
      name: "Hungarian Open Singles",
      registrationUnit: "person",
      capacity: 10,
      soldGuestCount: 0,
      attendeeFieldSchema: [
        { key: "full_name", label: "Teljes név", type: "text", required: true },
        { key: "email", label: "E-mail", type: "email", required: true },
      ],
    });
    personEventId = String(personEvent._id);

    // Mirrors the real "Hungarian Open Pairs": a team unit whose roster is
    // exactly two players, with sales already closed — the normal shape of
    // an offline registration an org manager has to enter after the fact.
    const pairEvent = await EventModel.create({
      ...base,
      name: "Hungarian Open Pairs",
      registrationUnit: "team",
      playersPerTicket: 2,
      teamMemberLimit: 2,
      salesClosesAt: new Date(Date.now() - day),
      capacity: 20,
      soldGuestCount: 0,
      teamMemberFieldSchema: [
        { key: "full_name", label: "Teljes név", type: "text", required: true },
        { key: "email", label: "E-mail", type: "email", required: true },
      ],
    });
    pairEventId = String(pairEvent._id);

    const fullEvent = await EventModel.create({
      ...base,
      name: "Sold Out Masters",
      registrationUnit: "person",
      capacity: 2,
      soldGuestCount: 2,
    });
    fullEventId = String(fullEvent._id);
  });

  const customer = { name: "Kovács Béla", email: "Bela@Example.COM", phone: "+36301112233", note: "" };

  describe("single-person registration", () => {
    it("creates a pending registration marked as admin-created", async () => {
      const { booking, finalized } = await createAdminRegistration(
        orgId,
        {
          eventId: personEventId,
          guests: 1,
          customer,
          attendees: [{ fields: { full_name: "Kovács Béla", email: "bela@example.com" } }],
        },
        ACTOR,
      );

      expect(finalized).toBe(false);
      expect(booking.status).toBe("pending");
      expect(booking.source).toBe("admin");
      expect(String(booking.createdByUserId)).toBe(ACTOR.userId);
      // Normalized by the shared public-path code, not re-implemented here.
      expect(booking.customer.email).toBe("bela@example.com");
      expect(booking.totalHuf).toBe(10000);
    });

    it("reserves event capacity, exactly like a storefront booking", async () => {
      await createAdminRegistration(
        orgId,
        { eventId: personEventId, guests: 3, customer, attendees: Array.from({ length: 3 }, (_, i) => ({ fields: { full_name: `P${i}`, email: `p${i}@example.com` } })) },
        ACTOR,
      );

      expect((await eventRepository.findById(personEventId))?.soldGuestCount).toBe(3);
    });

    it("refuses an event belonging to another organization", async () => {
      await expect(
        createAdminRegistration(otherOrgId, { eventId: personEventId, guests: 1, customer }, ACTOR),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("validates attendee fields against the event schema", async () => {
      await expect(
        createAdminRegistration(
          orgId,
          { eventId: personEventId, guests: 1, customer, attendees: [{ fields: { full_name: "" } }] },
          ACTOR,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("team / multi-player registration", () => {
    it("registers a pair, storing the roster under members", async () => {
      const { booking } = await createAdminRegistration(
        orgId,
        {
          eventId: pairEventId,
          guests: 1,
          customer,
          attendees: [
            {
              fields: {},
              members: [
                { fields: { full_name: "Mayu Shimizu", email: "mayu@example.com" } },
                { fields: { full_name: "Yukie Sakaguchi", email: "yukie@example.com" } },
              ],
            },
          ],
          // Sales are closed on this event, which is the whole point.
          overrides: { allowClosedSales: true },
        },
        ACTOR,
      );

      // Same nesting the real production data uses, so downstream code
      // (vouchers, tDarts pair enrolment) sees no difference.
      expect(booking.attendees).toHaveLength(1);
      expect(booking.attendees[0]?.members).toHaveLength(2);
      expect(booking.attendees[0]?.members?.[0]?.fields.full_name).toBe("Mayu Shimizu");
      expect(booking.playersPerTicket).toBe(2);
    });

    it("rejects a roster that is the wrong size for a fixed-roster event", async () => {
      await expect(
        createAdminRegistration(
          orgId,
          {
            eventId: pairEventId,
            guests: 1,
            customer,
            attendees: [{ fields: {}, members: [{ fields: { full_name: "Solo", email: "solo@example.com" } }] }],
            overrides: { allowClosedSales: true },
          },
          ACTOR,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("prices a pair ticket as one entry, not two", async () => {
      const { booking } = await createAdminRegistration(
        orgId,
        {
          eventId: pairEventId,
          guests: 1,
          customer,
          attendees: [
            {
              fields: {},
              members: [
                { fields: { full_name: "A", email: "a@example.com" } },
                { fields: { full_name: "B", email: "b@example.com" } },
              ],
            },
          ],
          overrides: { allowClosedSales: true },
        },
        ACTOR,
      );
      expect(booking.totalHuf).toBe(10000);
    });
  });

  describe("policy overrides", () => {
    it("refuses a closed-sales event without the override", async () => {
      await expect(
        createAdminRegistration(orgId, { eventId: pairEventId, guests: 1, customer }, ACTOR),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("refuses to exceed capacity without the override", async () => {
      await expect(
        createAdminRegistration(orgId, { eventId: fullEventId, guests: 1, customer }, ACTOR),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("allows a deliberate over-capacity registration with the override", async () => {
      const { booking } = await createAdminRegistration(
        orgId,
        { eventId: fullEventId, guests: 1, customer, overrides: { allowOverCapacity: true } },
        ACTOR,
      );
      expect(booking.status).toBe("pending");
      expect((await eventRepository.findById(fullEventId))?.soldGuestCount).toBe(3);
    });

    it("registers into an archived event only with the override", async () => {
      await EventModel.updateOne({ _id: personEventId }, { $set: { status: "archived" } });

      await expect(
        createAdminRegistration(orgId, { eventId: personEventId, guests: 1, customer }, ACTOR),
      ).rejects.toMatchObject({ status: 404 });

      const { booking } = await createAdminRegistration(
        orgId,
        {
          eventId: personEventId,
          guests: 1,
          customer,
          attendees: [{ fields: { full_name: "X", email: "x@example.com" } }],
          overrides: { allowInactiveEvent: true },
        },
        ACTOR,
      );
      expect(booking.status).toBe("pending");
    });
  });

  describe("marking paid offline", () => {
    async function pendingBooking() {
      const { booking } = await createAdminRegistration(
        orgId,
        { eventId: personEventId, guests: 1, customer, attendees: [{ fields: { full_name: "Kovács Béla", email: "bela@example.com" } }] },
        ACTOR,
      );
      return String(booking._id);
    }

    it("records the payment and runs the full after-payment pipeline", async () => {
      const bookingId = await pendingBooking();

      const paid = await markBookingPaidOffline(
        orgId,
        bookingId,
        { method: "transfer", reference: "NAV-2026-0001", note: "arrived 2026-10-01" },
        ACTOR,
      );

      expect(paid.status).toBe("paid");
      expect(paid.paymentMethod).toBe("transfer");
      expect(paid.offlinePayment?.reference).toBe("NAV-2026-0001");
      expect(String(paid.offlinePayment?.markedByUserId)).toBe(ACTOR.userId);
      expect(paid.paidAt).toBeInstanceOf(Date);

      // The point of going through afterBookingPaid: a transfer-paid
      // registration must end up with the same artefacts as a card one.
      const vouchers = await voucherRepository.findByBookingId(bookingId);
      expect(vouchers).toHaveLength(1);
      expect(vouchers[0]?.displayName).toBe("Kovács Béla");
    });

    it("creates the registration already paid in one call", async () => {
      const { booking, finalized } = await createAdminRegistration(
        orgId,
        {
          eventId: personEventId,
          guests: 1,
          customer,
          attendees: [{ fields: { full_name: "Kovács Béla", email: "bela@example.com" } }],
          markPaid: { method: "cash", reference: "door" },
        },
        ACTOR,
      );

      expect(finalized).toBe(true);
      expect(booking.status).toBe("paid");
      expect(booking.paymentMethod).toBe("cash");
      expect(await voucherRepository.findByBookingId(String(booking._id))).toHaveLength(1);
    });

    it("refuses to mark an already-paid booking paid again", async () => {
      const bookingId = await pendingBooking();
      await markBookingPaidOffline(orgId, bookingId, { method: "transfer" }, ACTOR);

      await expect(markBookingPaidOffline(orgId, bookingId, { method: "cash" }, ACTOR)).rejects.toMatchObject({
        status: 400,
      });
    });

    it("refuses to mark a cancelled booking paid", async () => {
      const bookingId = await pendingBooking();
      await BookingModel.updateOne({ _id: bookingId }, { $set: { status: "cancelled" } });

      await expect(markBookingPaidOffline(orgId, bookingId, { method: "transfer" }, ACTOR)).rejects.toMatchObject({
        status: 400,
      });
    });

    it("runs the pipeline once when two managers mark paid concurrently", async () => {
      const bookingId = await pendingBooking();

      const results = await Promise.allSettled([
        markBookingPaidOffline(orgId, bookingId, { method: "transfer" }, ACTOR),
        markBookingPaidOffline(orgId, bookingId, { method: "cash" }, ACTOR),
      ]);

      // The CAS on status is what guarantees this: one wins, one is told so.
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await voucherRepository.findByBookingId(bookingId)).toHaveLength(1);
    });

    it("refuses another org's booking", async () => {
      const bookingId = await pendingBooking();
      await expect(markBookingPaidOffline(otherOrgId, bookingId, { method: "transfer" }, ACTOR)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe("editing details", () => {
    async function paidBooking() {
      const { booking } = await createAdminRegistration(
        orgId,
        {
          eventId: personEventId,
          guests: 1,
          customer,
          attendees: [{ fields: { full_name: "Kovács Béla", email: "bela@example.com" } }],
          markPaid: { method: "transfer" },
        },
        ACTOR,
      );
      return String(booking._id);
    }

    it("updates contact details without touching the rest of the customer", async () => {
      const bookingId = await paidBooking();

      const { booking } = await updateBookingDetails(orgId, bookingId, {
        customer: { phone: "+36309998888" },
      });

      expect(booking.customer.phone).toBe("+36309998888");
      // The dotted-path update must not wipe the siblings.
      expect(booking.customer.name).toBe("Kovács Béla");
      expect(booking.customer.email).toBe("bela@example.com");
    });

    it("lowercases an edited email, like the booking path does", async () => {
      const bookingId = await paidBooking();
      const { booking } = await updateBookingDetails(orgId, bookingId, { customer: { email: "NEW@Example.COM" } });
      expect(booking.customer.email).toBe("new@example.com");
    });

    it("renames the attendee and re-points the voucher at the new name", async () => {
      const bookingId = await paidBooking();
      expect((await voucherRepository.findByBookingId(bookingId))[0]?.displayName).toBe("Kovács Béla");

      const result = await updateBookingDetails(orgId, bookingId, {
        attendees: [{ fields: { full_name: "Kovács Bélá-né", email: "bela@example.com" } }],
      });

      // Otherwise the name on the ticket stops matching the person at the door.
      expect(result.vouchersRenamed).toBe(1);
      expect(result.vouchersSkipped).toBe(0);
      expect((await voucherRepository.findByBookingId(bookingId))[0]?.displayName).toBe("Kovács Bélá-né");
    });

    it("leaves a checked-in voucher's name alone and reports it as skipped", async () => {
      const bookingId = await paidBooking();
      const [voucher] = await voucherRepository.findByBookingId(bookingId);
      await voucherRepository.checkIn(String(voucher!._id), null);

      const result = await updateBookingDetails(orgId, bookingId, {
        attendees: [{ fields: { full_name: "Renamed Later", email: "bela@example.com" } }],
      });

      // A checked-in voucher records that someone with that name was
      // admitted; rewriting it would falsify the attendance record. The
      // manager is told instead of being left to assume it was updated.
      const after = await voucherRepository.findById(String(voucher!._id));
      expect(after?.displayName).toBe("Kovács Béla");
      expect(result.vouchersRenamed).toBe(0);
      expect(result.vouchersSkipped).toBe(1);
    });

    it("leaves a void voucher's name alone too", async () => {
      const bookingId = await paidBooking();
      await voucherRepository.voidAllForBooking(bookingId);

      const result = await updateBookingDetails(orgId, bookingId, {
        attendees: [{ fields: { full_name: "Renamed", email: "bela@example.com" } }],
      });

      expect(result.vouchersRenamed).toBe(0);
      expect(result.vouchersSkipped).toBe(1);
    });

    it("never re-prices a booking on an edit", async () => {
      const bookingId = await paidBooking();
      const before = await BookingModel.findById(bookingId);

      const { booking } = await updateBookingDetails(orgId, bookingId, {
        customer: { name: "Totally Different Person" },
      });

      // A rename must not silently re-price a paid booking.
      expect(booking.totalHuf).toBe(before?.totalHuf);
      expect(booking.quote.totalHuf).toBe(before?.quote.totalHuf);
    });

    it("validates an attendee edit against the booking's own schema snapshot", async () => {
      const bookingId = await paidBooking();
      // The organizer has since changed the event's schema; the edit must
      // still be judged against what the guest actually filled in.
      await EventModel.updateOne(
        { _id: personEventId },
        { $set: { attendeeFieldSchema: [{ key: "totally_new", label: "New", type: "text", required: true }] } },
      );

      const { booking } = await updateBookingDetails(orgId, bookingId, {
        attendees: [{ fields: { full_name: "Still Valid", email: "bela@example.com" } }],
      });
      expect(booking.attendees[0]?.fields.full_name).toBe("Still Valid");
    });

    it("rejects an attendee edit that breaks a required field", async () => {
      const bookingId = await paidBooking();
      await expect(
        updateBookingDetails(orgId, bookingId, { attendees: [{ fields: { full_name: "" } }] }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("edits a pair's roster members", async () => {
      const { booking: created } = await createAdminRegistration(
        orgId,
        {
          eventId: pairEventId,
          guests: 1,
          customer,
          attendees: [
            {
              fields: {},
              members: [
                { fields: { full_name: "Wrong Name", email: "a@example.com" } },
                { fields: { full_name: "B Player", email: "b@example.com" } },
              ],
            },
          ],
          overrides: { allowClosedSales: true },
        },
        ACTOR,
      );

      const { booking } = await updateBookingDetails(orgId, String(created._id), {
        attendees: [
          {
            fields: {},
            members: [
              { fields: { full_name: "Correct Name", email: "a@example.com" } },
              { fields: { full_name: "B Player", email: "b@example.com" } },
            ],
          },
        ],
      });

      expect(booking.attendees[0]?.members?.[0]?.fields.full_name).toBe("Correct Name");
    });

    it("flags that a tDarts resync is needed when a synced booking's attendees change", async () => {
      const bookingId = await paidBooking();
      await BookingModel.updateOne(
        { _id: bookingId },
        { $set: { tdartsSync: [{ participantKey: "p0", status: "synced", tournamentCode: "ABC", playerId: "pl_1" }] } },
      );

      const result = await updateBookingDetails(orgId, bookingId, {
        attendees: [{ fields: { full_name: "New Name", email: "bela@example.com" } }],
      });

      // The tDarts partner API has no update endpoint, so the console has to
      // surface this rather than silently leave the roster stale.
      expect(result.tdartsResyncRequired).toBe(true);
    });

    it("does not flag a resync for a contact-only edit", async () => {
      const bookingId = await paidBooking();
      await BookingModel.updateOne(
        { _id: bookingId },
        { $set: { tdartsSync: [{ participantKey: "p0", status: "synced", tournamentCode: "ABC" }] } },
      );

      const result = await updateBookingDetails(orgId, bookingId, { customer: { phone: "+36300000000" } });
      expect(result.tdartsResyncRequired).toBe(false);
    });

    it("is a no-op for an empty patch", async () => {
      const bookingId = await paidBooking();
      const result = await updateBookingDetails(orgId, bookingId, {});
      expect(result.vouchersRenamed).toBe(0);
    });

    it("refuses another org's booking", async () => {
      const bookingId = await paidBooking();
      await expect(updateBookingDetails(otherOrgId, bookingId, { customer: { name: "X" } })).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe("attaching an invoice", () => {
    async function paidBooking() {
      const { booking } = await createAdminRegistration(
        orgId,
        { eventId: personEventId, guests: 1, customer, attendees: [{ fields: { full_name: "K", email: "k@example.com" } }], markPaid: { method: "transfer" } },
        ACTOR,
      );
      return String(booking._id);
    }

    it("records a manually issued invoice number", async () => {
      const bookingId = await paidBooking();

      const booking = await attachInvoiceToBooking(orgId, bookingId, { invoiceNumber: "SZ-2026-0042" });

      expect(booking.invoiceNumber).toBe("SZ-2026-0042");
      expect(booking.invoiceStatus).toBe("issued");
      // So a hand-recorded invoice is never mistaken for a provider one.
      expect(booking.invoiceSource).toBe("manual");
    });

    it("clears a previous automatic failure", async () => {
      const bookingId = await paidBooking();
      await BookingModel.updateOne({ _id: bookingId }, { $set: { invoiceStatus: "failed", invoiceError: "NAV rejected" } });

      const booking = await attachInvoiceToBooking(orgId, bookingId, { invoiceNumber: "SZ-1" });
      expect(booking.invoiceError).toBeNull();
    });

    it("stores an attached PDF and points the booking at it", async () => {
      const bookingId = await paidBooking();
      const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(32, 0x20)]);

      const booking = await attachInvoiceToBooking(orgId, bookingId, { invoiceNumber: "SZ-2", pdf: { bytes: pdf } });
      expect(booking.invoicePdfFileName).toBeTruthy();
    });

    it("rejects a file that is not a PDF", async () => {
      const bookingId = await paidBooking();
      await expect(
        attachInvoiceToBooking(orgId, bookingId, { invoiceNumber: "SZ-3", pdf: { bytes: Buffer.from("<html>nope") } }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("requires a non-blank invoice number", async () => {
      const bookingId = await paidBooking();
      await expect(attachInvoiceToBooking(orgId, bookingId, { invoiceNumber: "   " })).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe("preview and listing", () => {
    it("quotes without creating anything", async () => {
      const preview = await previewAdminRegistration(orgId, { eventId: personEventId, guests: 2 });

      expect(preview.quote.totalHuf).toBe(20000);
      expect(preview.registrationFieldSchema.map((f) => f.key)).toEqual(["full_name", "email"]);
      expect(await BookingModel.countDocuments({})).toBe(0);
    });

    it("exposes the team field schema so the console can render a roster form", async () => {
      const preview = await previewAdminRegistration(orgId, {
        eventId: pairEventId,
        guests: 1,
        overrides: { allowClosedSales: true },
      });
      expect(preview.teamMemberFieldSchema.map((f) => f.key)).toEqual(["full_name", "email"]);
    });

    it("lists registrable events with their registration shape and capacity", async () => {
      const events = await listRegistrableEvents(orgId);
      const pair = events.find((e) => e.name === "Hungarian Open Pairs");

      expect(pair).toMatchObject({ registrationUnit: "team", playersPerTicket: 2, teamMemberLimit: 2 });
      // Closed-sales and sold-out events must still be listed — registering
      // into them is exactly what an org manager needs this screen for.
      expect(events.map((e) => e.name)).toContain("Sold Out Masters");
    });

    it("does not list another org's events", async () => {
      expect(await listRegistrableEvents(otherOrgId)).toEqual([]);
    });
  });

  describe("ensureVouchersForBooking", () => {
    it("issues missing voucher rows for a paid booking", async () => {
      const { booking } = await createAdminRegistration(
        orgId,
        { eventId: personEventId, guests: 2, customer, attendees: [{ fields: { full_name: "A", email: "a@example.com" } }, { fields: { full_name: "B", email: "b@example.com" } }] },
        ACTOR,
      );
      const bookingId = String(booking._id);
      // Paid directly, bypassing the pipeline, to simulate a booking whose
      // issuance never ran.
      await BookingModel.updateOne({ _id: bookingId }, { $set: { status: "paid", paidAt: new Date() } });

      expect(await ensureVouchersForBooking(orgId, bookingId)).toBe(2);
    });

    it("refuses a booking that is not paid", async () => {
      const { booking } = await createAdminRegistration(
        orgId,
        { eventId: personEventId, guests: 1, customer, attendees: [{ fields: { full_name: "A", email: "a@example.com" } }] },
        ACTOR,
      );
      await expect(ensureVouchersForBooking(orgId, String(booking._id))).rejects.toMatchObject({ status: 400 });
    });
  });
});
