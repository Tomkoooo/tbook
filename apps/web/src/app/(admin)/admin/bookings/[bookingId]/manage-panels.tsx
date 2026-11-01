"use client";

import { useActionState, useState } from "react";
import type { AttendeeFieldDef, BookingAttendee } from "@tbook/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckboxField, FormField, NativeSelect } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import {
  attachInvoiceAction,
  markPaidAction,
  updateBookingAction,
  type ActionResult,
  type UpdateBookingResult,
} from "../../actions";
import { AttendeeField } from "../new/attendee-fields";

/**
 * Record a payment taken outside the platform. Shown only while the
 * booking is still awaiting payment — the action re-checks that too.
 */
export function MarkPaidPanel({ bookingId }: { bookingId: string }) {
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) => markPaidAction(bookingId, formData),
    null,
  );

  return (
    <SectionCard title="Record a payment" description="Issues the entries, invoice and any integrations, exactly as a card payment would.">
      <form action={action} className="grid gap-4">
        {state?.message ? <Notice tone={state.ok ? "success" : "danger"}>{state.message}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Method" htmlFor="method">
            <NativeSelect id="method" name="method" defaultValue="transfer">
              <option value="transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="comp">Comped / free</option>
              <option value="other">Other</option>
            </NativeSelect>
          </FormField>
          <FormField label="Reference" htmlFor="reference" hint="Transfer reference, receipt no.">
            <Input id="reference" name="reference" placeholder="NAV-2026-0001" />
          </FormField>
          <FormField label="Note" htmlFor="note">
            <Input id="note" name="note" placeholder="Arrived 2026-10-01" />
          </FormField>
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Recording…" : "Mark paid"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/**
 * Edit contact details and attendee data.
 *
 * Attendee editing is behind an explicit toggle so a contact-only fix never
 * resubmits the whole roster — resubmitting it would re-validate every
 * field and could fail on data the editor didn't touch.
 */
export function EditBookingPanel({
  bookingId,
  guests,
  customer,
  adminNote,
  attendees,
  attendeeFields,
  teamMemberFields,
}: {
  bookingId: string;
  guests: number;
  customer: { name: string; email: string; phone: string };
  adminNote: string;
  attendees: BookingAttendee[];
  attendeeFields: AttendeeFieldDef[];
  teamMemberFields: AttendeeFieldDef[];
}) {
  const [editsAttendees, setEditsAttendees] = useState(false);
  const [state, action, pending] = useActionState(
    async (_prev: UpdateBookingResult | null, formData: FormData) => updateBookingAction(bookingId, formData),
    null,
  );

  const isTeam = teamMemberFields.length > 0;
  const canEditAttendees = attendeeFields.length > 0 || isTeam;

  return (
    <SectionCard title="Edit details">
      <form action={action} className="grid gap-4">
        {state?.message ? <Notice tone={state.ok ? "success" : "danger"}>{state.message}</Notice> : null}
        {state?.tdartsResyncRequired ? (
          <Notice tone="warning">
            This booking is already enrolled in tDarts. The tDarts partner API has no update endpoint yet, so the
            tournament roster still holds the previous details — correct them in tDarts directly for now.
          </Notice>
        ) : null}

        <input type="hidden" name="guests" value={guests} />

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Contact name" htmlFor="customer.name">
            <Input id="customer.name" name="customer.name" defaultValue={customer.name} required />
          </FormField>
          <FormField label="Email" htmlFor="customer.email">
            <Input id="customer.email" name="customer.email" type="email" defaultValue={customer.email} required />
          </FormField>
          <FormField label="Phone" htmlFor="customer.phone">
            <Input id="customer.phone" name="customer.phone" defaultValue={customer.phone} required />
          </FormField>
        </div>

        <FormField label="Admin note" htmlFor="adminNote" hint="Internal only — never shown to the guest.">
          <Input id="adminNote" name="adminNote" defaultValue={adminNote} />
        </FormField>

        {canEditAttendees ? (
          <>
            <CheckboxField
              name="editsAttendees"
              label={`Also edit ${isTeam ? "team rosters" : "attendee details"}`}
              checked={editsAttendees}
              onCheckedChange={setEditsAttendees}
            />

            {editsAttendees ? (
              <div className="grid gap-4">
                <p className="text-muted-foreground text-sm">
                  Renaming an attendee updates their entry ticket. Entries already checked in are left as they are —
                  they record who was admitted.
                </p>
                {Array.from({ length: guests }, (_, index) => {
                  const attendee = attendees[index];
                  const members = attendee?.members ?? [];
                  return (
                    <fieldset key={index} className="grid gap-3 rounded-lg border p-4">
                      <legend className="px-1 text-sm font-medium">
                        {isTeam ? `Team ${index + 1}` : `Attendee ${index + 1}`}
                      </legend>

                      {attendeeFields.length > 0 ? (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {attendeeFields.map((field) => (
                            <AttendeeField
                              key={field.key}
                              name={`attendee.${index}.${field.key}`}
                              field={field}
                              defaultValue={
                                attendee?.fields?.[field.key] != null ? String(attendee.fields[field.key]) : undefined
                              }
                            />
                          ))}
                        </div>
                      ) : null}

                      {isTeam
                        ? members.map((member, memberIndex) => (
                            <div key={memberIndex} className="grid gap-2 border-l-2 pl-4">
                              <p className="text-sm font-medium">Player {memberIndex + 1}</p>
                              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {teamMemberFields.map((field) => (
                                  <AttendeeField
                                    key={field.key}
                                    name={`attendee.${index}.member.${memberIndex}.${field.key}`}
                                    field={field}
                                    defaultValue={
                                      member?.fields?.[field.key] != null
                                        ? String(member.fields[field.key])
                                        : undefined
                                    }
                                  />
                                ))}
                              </div>
                            </div>
                          ))
                        : null}
                    </fieldset>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}

        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/**
 * Record an invoice issued elsewhere — an org invoicing from its own
 * accounting system, or a booking whose automatic Számlázz.hu issue failed.
 */
export function AttachInvoicePanel({
  bookingId,
  invoiceNumber,
  invoiceSource,
}: {
  bookingId: string;
  invoiceNumber: string | null;
  invoiceSource: string;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) => attachInvoiceAction(bookingId, formData),
    null,
  );

  return (
    <SectionCard
      title="Invoice"
      description={
        invoiceNumber ? (
          <>
            Current: <code className="font-mono">{invoiceNumber}</code> (
            {invoiceSource === "manual" ? "entered by hand" : "Számlázz.hu"})
          </>
        ) : undefined
      }
    >
      {/* encType is required for the PDF: without it the file arrives as a
          filename string rather than bytes. */}
      <form action={action} encType="multipart/form-data" className="grid gap-4">
        {state?.message ? <Notice tone={state.ok ? "success" : "danger"}>{state.message}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Invoice number" htmlFor="invoiceNumber">
            <Input id="invoiceNumber" name="invoiceNumber" required placeholder="SZ-2026-0042" />
          </FormField>
          <FormField label="PDF (optional)" htmlFor="pdf" hint="Max 10 MB">
            <Input id="pdf" name="pdf" type="file" accept="application/pdf" />
          </FormField>
        </div>
        <div>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Attach invoice"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
