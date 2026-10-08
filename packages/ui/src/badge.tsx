import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

/**
 * Status pill. Tones are semantic (not colour names) so the booking and
 * voucher status maps below stay the single place that decides what
 * "cancelled" looks like — the legacy plugin re-picked colours inline at
 * every call site.
 */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  const classes = ["tbook-badge", `tbook-badge-${tone}`, className].filter(Boolean).join(" ");
  return <span className={classes}>{children}</span>;
}

/** Booking status → tone. Kept here so every surface renders a status identically. */
export const BOOKING_STATUS_TONES: Record<string, BadgeTone> = {
  pending: "warning",
  checkout_started: "warning",
  paid: "success",
  confirmed: "success",
  cancelled: "danger",
  expired: "neutral",
};

export const VOUCHER_STATUS_TONES: Record<string, BadgeTone> = {
  active: "info",
  checked_in: "success",
  void: "danger",
};

export const INVOICE_STATUS_TONES: Record<string, BadgeTone> = {
  none: "neutral",
  pending: "warning",
  issued: "success",
  failed: "danger",
  reversed: "neutral",
};
