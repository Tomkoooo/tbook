"use client";

import { useActionState } from "react";
import { Button, Card, Input, Notice } from "@tbook/ui";
import { VALID_BOOKING_STATUS_TRANSITIONS, type BookingStatus } from "@tbook/schemas";
import { cancelBookingAction, confirmBookingAction, resendEntriesAction, type ActionResult } from "../../actions";

/**
 * The three write actions on a booking. Each is its own form with its own
 * `useActionState`, so one failing (e.g. SMTP down on a re-send) leaves the
 * others usable and reports inline rather than as an error page.
 *
 * Which buttons appear is driven by VALID_BOOKING_STATUS_TRANSITIONS — the
 * same table booking-service enforces server-side — so the UI can't offer
 * a transition the service would then reject.
 */
export function BookingActions({
  bookingId,
  status,
  customerEmail,
  voucherCount,
  canManageBooking,
  canManageVouchers,
}: {
  bookingId: string;
  status: BookingStatus;
  customerEmail: string;
  voucherCount: number;
  canManageBooking: boolean;
  canManageVouchers: boolean;
}) {
  const allowed = VALID_BOOKING_STATUS_TRANSITIONS[status] ?? [];
  const canCancel = canManageBooking && allowed.includes("cancelled");
  const canConfirm = canManageBooking && allowed.includes("confirmed");
  const canResend = canManageVouchers && voucherCount > 0;

  const [cancelState, cancel, cancelling] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) => cancelBookingAction(bookingId, formData),
    null,
  );
  const [confirmState, confirm, confirming] = useActionState(
    async (): Promise<ActionResult> => confirmBookingAction(bookingId),
    null,
  );
  const [resendState, resend, resending] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) => resendEntriesAction(bookingId, formData),
    null,
  );

  if (!canCancel && !canConfirm && !canResend) {
    return null;
  }

  const notice = [cancelState, confirmState, resendState].find((state) => state?.message);

  return (
    <Card title="Actions">
      {notice ? <Notice tone={notice.ok ? "success" : "danger"}>{notice.message}</Notice> : null}

      <div className="tbook-stack" style={{ marginTop: notice ? 12 : 0 }}>
        {canConfirm ? (
          <form action={confirm}>
            <div className="tbook-row">
              <Button type="submit" disabled={confirming}>
                {confirming ? "Confirming…" : "Confirm booking"}
              </Button>
              <span className="tbook-faint">Marks a paid booking as confirmed.</span>
            </div>
          </form>
        ) : null}

        {canResend ? (
          <form action={resend}>
            <div className="tbook-row">
              <Input
                name="toEmail"
                type="email"
                placeholder={customerEmail || "guest@example.com"}
                style={{ maxWidth: 260 }}
                aria-label="Send entries to"
              />
              <Button type="submit" variant="secondary" disabled={resending}>
                {resending ? "Sending…" : "Re-send entries"}
              </Button>
              <span className="tbook-faint">Leave blank to use the booking&apos;s own email.</span>
            </div>
          </form>
        ) : null}

        {canCancel ? (
          <form action={cancel}>
            <div className="tbook-row">
              <Input name="reason" placeholder="Reason (optional)" style={{ maxWidth: 260 }} aria-label="Cancellation reason" />
              <button type="submit" className="tbook-btn tbook-btn-danger" disabled={cancelling}>
                {cancelling ? "Cancelling…" : "Cancel booking"}
              </button>
              <span className="tbook-faint">Voids its entries and releases the event&apos;s capacity.</span>
            </div>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
