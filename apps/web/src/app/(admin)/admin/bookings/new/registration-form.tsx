"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { AttendeeFieldDef } from "@tbook/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckboxField, FormField, NativeSelect } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import { StickyFormFooter } from "@/components/sticky-form-footer";
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
    <form action={action} className="grid gap-4">
      {state && !state.ok ? <Notice tone="danger">{state.message}</Notice> : null}
      {state?.ok ? <Notice tone="success">{state.message}</Notice> : null}

      <input type="hidden" name="eventId" value={event.id} />

      <SectionCard title="Entries">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
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
          </FormField>
          <FormField label="Total" htmlFor="total" hint="Calculated server-side from the event's pricing">
            <Input
              id="total"
              className="tabular-nums"
              value={`${totalHuf.toLocaleString("hu-HU")} ${currency}`}
              readOnly
              disabled
            />
          </FormField>
        </div>
      </SectionCard>

      <SectionCard title="Who is paying / the contact">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Name" htmlFor="customer.name">
            <Input id="customer.name" name="customer.name" required autoComplete="off" />
          </FormField>
          <FormField label="Email" htmlFor="customer.email">
            <Input id="customer.email" name="customer.email" type="email" required autoComplete="off" />
          </FormField>
          <FormField label="Phone" htmlFor="customer.phone">
            <Input id="customer.phone" name="customer.phone" required autoComplete="off" />
          </FormField>
          <FormField label="Note from the guest" htmlFor="customer.note" className="sm:col-span-3">
            <Input id="customer.note" name="customer.note" placeholder="Dietary needs, arrival time…" />
          </FormField>
        </div>
      </SectionCard>

      {attendeeFields.length > 0 || isTeam ? (
        <SectionCard title={isTeam ? "Teams" : "Attendees"}>
          <div className="grid gap-4">
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
        </SectionCard>
      ) : null}

      <SectionCard title="Payment">
        <div className="grid gap-4">
          <CheckboxField
            name="markPaid"
            label="Already paid — issue entries and the invoice now"
            checked={markPaid}
            onCheckedChange={setMarkPaid}
          />

          {markPaid ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Method" htmlFor="paymentMethod">
                <NativeSelect id="paymentMethod" name="paymentMethod" defaultValue="transfer">
                  <option value="transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="comp">Comped / free</option>
                  <option value="other">Other</option>
                </NativeSelect>
              </FormField>
              <FormField label="Reference" htmlFor="paymentReference" hint="Transfer reference, receipt no.">
                <Input id="paymentReference" name="paymentReference" placeholder="NAV-2026-0001" />
              </FormField>
              <FormField label="Payment note" htmlFor="paymentNote">
                <Input id="paymentNote" name="paymentNote" placeholder="Arrived 2026-10-01" />
              </FormField>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              The registration will be created as <strong className="text-foreground">pending</strong>. It reserves
              capacity, but no entries or invoice are issued until you mark it paid.
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Internal note and overrides"
        description="Tick only what you mean to override — each one bypasses a rule the public booking flow enforces."
      >
        <div className="grid gap-4">
          <FormField label="Admin note" htmlFor="adminNote" hint="Only visible in this console, never to the guest.">
            <Input id="adminNote" name="adminNote" placeholder="Registered on behalf of the federation" />
          </FormField>
          <div className="grid gap-3">
            <CheckboxField name="allowClosedSales" defaultChecked label="Allow a closed or not-yet-open sales window" />
            <CheckboxField
              name="allowInactiveEvent"
              defaultChecked={event.status !== "active"}
              label="Allow a draft or archived event"
            />
            <CheckboxField
              name="allowOverCapacity"
              label={`Allow exceeding capacity${
                event.capacity != null ? ` (${event.soldGuestCount}/${event.capacity} taken)` : ""
              }`}
            />
            <CheckboxField name="skipEligibility" label="Skip the event's eligibility rules" />
          </div>
        </div>
      </SectionCard>

      <StickyFormFooter>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Creating…" : markPaid ? "Create and mark paid" : "Create pending registration"}
        </Button>
      </StickyFormFooter>
    </form>
  );
}
