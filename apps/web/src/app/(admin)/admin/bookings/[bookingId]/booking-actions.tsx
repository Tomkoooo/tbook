"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
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
    <SectionCard title="Actions">
      <div className="grid gap-4">
        {notice ? <Notice tone={notice.ok ? "success" : "danger"}>{notice.message}</Notice> : null}

        {canConfirm ? (
          <form action={confirm} className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={confirming}>
              {confirming ? "Confirming…" : "Confirm booking"}
            </Button>
            <span className="text-muted-foreground text-sm">Marks a paid booking as confirmed.</span>
          </form>
        ) : null}

        {canResend ? (
          <form action={resend} className="flex flex-wrap items-center gap-3">
            <Input
              name="toEmail"
              type="email"
              placeholder={customerEmail || "guest@example.com"}
              className="max-w-64"
              aria-label="Send entries to"
            />
            <Button type="submit" variant="outline" disabled={resending}>
              {resending ? "Sending…" : "Re-send entries"}
            </Button>
            <span className="text-muted-foreground text-sm">Leave blank to use the booking&apos;s own email.</span>
          </form>
        ) : null}

        {canCancel ? (
          <form action={cancel} className="flex flex-wrap items-center gap-3">
            <Input name="reason" placeholder="Reason (optional)" className="max-w-64" aria-label="Cancellation reason" />
            <Button type="submit" variant="destructive" disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel booking"}
            </Button>
            <span className="text-muted-foreground text-sm">Voids its entries and releases the event&apos;s capacity.</span>
          </form>
        ) : null}
      </div>
    </SectionCard>
  );
}
