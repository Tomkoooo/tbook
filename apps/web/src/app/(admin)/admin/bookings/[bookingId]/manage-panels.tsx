"use client";

import { useActionState, useState } from "react";
import type { AttendeeFieldDef, BookingAttendee } from "@tbook/schemas";
import { Button, Card, Field, Input, Notice, Select } from "@tbook/ui";
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
    <Card title="Record a payment">
      {state?.message ? <Notice tone={state.ok ? "success" : "danger"}>{state.message}</Notice> : null}

      <form action={action} className="tbook-stack" style={{ marginTop: state?.message ? 12 : 0 }}>
        <div className="tbook-filter-form">
          <Field label="Method" htmlFor="method">
            <Select
              id="method"
              name="method"
              defaultValue="transfer"
              options={[
                { value: "transfer", label: "Bank transfer" },
                { value: "cash", label: "Cash" },
                { value: "comp", label: "Comped / free" },
                { value: "other", label: "Other" },
              ]}
            />
          </Field>
          <Field label="Reference" htmlFor="reference" hint="Transfer reference, receipt no.">
            <Input id="reference" name="reference" placeholder="NAV-2026-0001" />
          </Field>
          <Field label="Note" htmlFor="note">
            <Input id="note" name="note" placeholder="Arrived 2026-10-01" />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Recording…" : "Mark paid"}
          </Button>
          <span className="tbook-faint" style={{ marginLeft: 8 }}>
            Issues the entries, invoice and any integrations, exactly as a card payment would.
          </span>
        </div>
      </form>
    </Card>
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
    <Card title="Edit details">
      {state?.message ? <Notice tone={state.ok ? "success" : "danger"}>{state.message}</Notice> : null}

      {state?.tdartsResyncRequired ? (
        <Notice tone="warning">
          This booking is already enrolled in tDarts. The tDarts partner API has no update endpoint yet, so the
          tournament roster still holds the previous details — correct them in tDarts directly for now.
        </Notice>
      ) : null}

      <form action={action} className="tbook-stack" style={{ marginTop: 12 }}>
        <input type="hidden" name="guests" value={guests} />

        <div className="tbook-filter-form">
          <Field label="Contact name" htmlFor="customer.name">
            <Input id="customer.name" name="customer.name" defaultValue={customer.name} required />
          </Field>
          <Field label="Email" htmlFor="customer.email">
            <Input id="customer.email" name="customer.email" type="email" defaultValue={customer.email} required />
          </Field>
          <Field label="Phone" htmlFor="customer.phone">
            <Input id="customer.phone" name="customer.phone" defaultValue={customer.phone} required />
          </Field>
        </div>

        <Field label="Admin note" htmlFor="adminNote" hint="Internal only — never shown to the guest.">
          <Input id="adminNote" name="adminNote" defaultValue={adminNote} />
        </Field>

        {canEditAttendees ? (
          <>
            <label className="tbook-row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                name="editsAttendees"
                checked={editsAttendees}
                onChange={(e) => setEditsAttendees(e.target.checked)}
              />
              <span>Also edit {isTeam ? "team rosters" : "attendee details"}</span>
            </label>

            {editsAttendees ? (
              <div className="tbook-stack">
                <p className="tbook-faint" style={{ margin: 0 }}>
                  Renaming an attendee updates their entry ticket. Entries already checked in are left as they are —
                  they record who was admitted.
                </p>
                {Array.from({ length: guests }, (_, index) => {
                  const attendee = attendees[index];
                  const members = attendee?.members ?? [];
                  return (
                    <fieldset
                      key={index}
                      style={{
                        border: "1px solid var(--tbook-border)",
                        borderRadius: "var(--tbook-radius-sm)",
                        padding: 12,
                        margin: 0,
                      }}
                    >
                      <legend className="tbook-field-label">
                        {isTeam ? `Team ${index + 1}` : `Attendee ${index + 1}`}
                      </legend>

                      {attendeeFields.length > 0 ? (
                        <div className="tbook-filter-form">
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
                            <div
                              key={memberIndex}
                              style={{ borderLeft: "3px solid var(--tbook-border-strong)", paddingLeft: 12, marginTop: 10 }}
                            >
                              <p className="tbook-field-label" style={{ margin: "0 0 6px" }}>
                                Player {memberIndex + 1}
                              </p>
                              <div className="tbook-filter-form">
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
    </Card>
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
    <Card title="Invoice">
      {state?.message ? <Notice tone={state.ok ? "success" : "danger"}>{state.message}</Notice> : null}

      {invoiceNumber ? (
        <p className="tbook-muted" style={{ marginTop: state?.message ? 12 : 0 }}>
          Current: <code>{invoiceNumber}</code>{" "}
          <span className="tbook-faint">({invoiceSource === "manual" ? "entered by hand" : "Számlázz.hu"})</span>
        </p>
      ) : null}

      {/* encType is required for the PDF: without it the file arrives as a
          filename string rather than bytes. */}
      <form action={action} encType="multipart/form-data" className="tbook-stack" style={{ marginTop: 12 }}>
        <div className="tbook-filter-form">
          <Field label="Invoice number" htmlFor="invoiceNumber">
            <Input id="invoiceNumber" name="invoiceNumber" required placeholder="SZ-2026-0042" />
          </Field>
          <Field label="PDF (optional)" htmlFor="pdf" hint="Max 10 MB">
            <Input id="pdf" name="pdf" type="file" accept="application/pdf" />
          </Field>
        </div>
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Saving…" : "Attach invoice"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
