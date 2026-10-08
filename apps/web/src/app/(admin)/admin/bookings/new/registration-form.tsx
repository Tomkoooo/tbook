"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { AttendeeFieldDef } from "@tbook/schemas";
import { Button, Card, Field, Input, Notice, Select } from "@tbook/ui";
import { createRegistrationAction, type CreateRegistrationResult } from "../../actions";
import { AttendeeFields } from "./attendee-fields";

/**
 * The registration form. One component covers both single-person and
 * team/multi-player events: the event's `attendeeFields` and
 * `teamMemberFields` schemas decide what gets rendered, so there is no
 * per-event-type branch here beyond "does this ticket have a roster".
 *
 * Changing the entry count re-navigates with `?guests=`, so the server
 * re-prices and re-renders the right number of attendee blocks rather than
 * this component guessing at the price.
 */
export function RegistrationForm({
  event,
  guests,
  currency,
  totalHuf,
  attendeeFields,
  teamMemberFields,
}: {
  event: {
    id: string;
    name: string;
    status: string;
    capacity: number | null;
    soldGuestCount: number;
    teamMemberLimit: number | null;
    playersPerTicket: number;
  };
  guests: number;
  currency: string;
  totalHuf: number;
  attendeeFields: AttendeeFieldDef[];
  teamMemberFields: AttendeeFieldDef[];
}) {
  const router = useRouter();
  const [markPaid, setMarkPaid] = useState(true);

  const [state, action, pending] = useActionState(
    async (_prev: CreateRegistrationResult | null, formData: FormData) => createRegistrationAction(formData),
    null,
  );

  const isTeam = teamMemberFields.length > 0;
  const rosterSize = event.playersPerTicket > 1 ? event.playersPerTicket : null;

  // On success the manager almost always wants the booking they just made.
  if (state?.ok && state.bookingId) {
    router.push(`/admin/bookings/${state.bookingId}`);
  }

  return (
    <form action={action} className="tbook-stack">
      {state && !state.ok ? <Notice tone="danger">{state.message}</Notice> : null}
      {state?.ok ? <Notice tone="success">{state.message}</Notice> : null}

      <input type="hidden" name="eventId" value={event.id} />

      <Card title="Entries">
        <div className="tbook-filter-form">
          <Field
            label={isTeam ? "Number of teams" : "Number of entries"}
            htmlFor="guests"
            hint={rosterSize ? `Each entry covers ${rosterSize} players` : undefined}
          >
            <Input
              id="guests"
              name="guests"
              type="number"
              min={1}
              max={50}
              defaultValue={guests}
              // Re-navigating lets the server re-price and render the right
              // number of attendee blocks, instead of this form guessing.
              onChange={(e) => {
                const value = Math.min(Math.max(Number(e.target.value) || 1, 1), 50);
                router.replace(`/admin/bookings/new?eventId=${event.id}&guests=${value}`);
              }}
            />
          </Field>
          <Field label="Total" htmlFor="total" hint="Calculated server-side from the event's pricing">
            <Input id="total" value={`${totalHuf.toLocaleString("hu-HU")} ${currency}`} readOnly disabled />
          </Field>
        </div>
      </Card>

      <Card title="Who is paying / the contact">
        <div className="tbook-filter-form">
          <Field label="Name" htmlFor="customer.name">
            <Input id="customer.name" name="customer.name" required autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="customer.email">
            <Input id="customer.email" name="customer.email" type="email" required autoComplete="off" />
          </Field>
          <Field label="Phone" htmlFor="customer.phone">
            <Input id="customer.phone" name="customer.phone" required autoComplete="off" />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="Note from the guest" htmlFor="customer.note">
            <Input id="customer.note" name="customer.note" placeholder="Dietary needs, arrival time…" />
          </Field>
        </div>
      </Card>

      {attendeeFields.length > 0 || isTeam ? (
        <Card title={isTeam ? "Teams" : "Attendees"}>
          <div className="tbook-stack">
            {Array.from({ length: guests }, (_, index) => (
              <AttendeeFields
                key={index}
                index={index}
                label={isTeam ? `Team ${index + 1}` : `Attendee ${index + 1}`}
                attendeeFields={attendeeFields}
                teamMemberFields={teamMemberFields}
                rosterSize={rosterSize}
                teamMemberLimit={event.teamMemberLimit}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="Payment">
        <label className="tbook-row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            name="markPaid"
            checked={markPaid}
            onChange={(e) => setMarkPaid(e.target.checked)}
          />
          <span>Already paid — issue entries and the invoice now</span>
        </label>

        {markPaid ? (
          <div className="tbook-filter-form" style={{ marginTop: 12 }}>
            <Field label="Method" htmlFor="paymentMethod">
              <Select
                id="paymentMethod"
                name="paymentMethod"
                defaultValue="transfer"
                options={[
                  { value: "transfer", label: "Bank transfer" },
                  { value: "cash", label: "Cash" },
                  { value: "comp", label: "Comped / free" },
                  { value: "other", label: "Other" },
                ]}
              />
            </Field>
            <Field label="Reference" htmlFor="paymentReference" hint="Transfer reference, receipt no.">
              <Input id="paymentReference" name="paymentReference" placeholder="NAV-2026-0001" />
            </Field>
            <Field label="Payment note" htmlFor="paymentNote">
              <Input id="paymentNote" name="paymentNote" placeholder="Arrived 2026-10-01" />
            </Field>
          </div>
        ) : (
          <p className="tbook-faint" style={{ marginTop: 8 }}>
            The registration will be created as <strong>pending</strong>. It reserves capacity, but no entries or invoice
            are issued until you mark it paid.
          </p>
        )}
      </Card>

      <Card title="Internal note and overrides">
        <Field label="Admin note" htmlFor="adminNote" hint="Only visible in this console, never to the guest.">
          <Input id="adminNote" name="adminNote" placeholder="Registered on behalf of the federation" />
        </Field>

        <div className="tbook-stack" style={{ marginTop: 12 }}>
          <p className="tbook-faint" style={{ margin: 0 }}>
            Tick only what you mean to override — each one bypasses a rule the public booking flow enforces.
          </p>
          <label className="tbook-row" style={{ gap: 6 }}>
            <input type="checkbox" name="allowClosedSales" defaultChecked />
            <span>Allow a closed or not-yet-open sales window</span>
          </label>
          <label className="tbook-row" style={{ gap: 6 }}>
            <input type="checkbox" name="allowInactiveEvent" defaultChecked={event.status !== "active"} />
            <span>Allow a draft or archived event</span>
          </label>
          <label className="tbook-row" style={{ gap: 6 }}>
            <input type="checkbox" name="allowOverCapacity" />
            <span>
              Allow exceeding capacity
              {event.capacity != null ? ` (${event.soldGuestCount}/${event.capacity} taken)` : ""}
            </span>
          </label>
          <label className="tbook-row" style={{ gap: 6 }}>
            <input type="checkbox" name="skipEligibility" />
            <span>Skip the event&apos;s eligibility rules</span>
          </label>
        </div>
      </Card>

      <div className="tbook-row">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : markPaid ? "Create and mark paid" : "Create pending registration"}
        </Button>
      </div>
    </form>
  );
}
