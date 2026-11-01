/**
 * Status → badge tone. Kept in one place so every surface renders a given
 * status identically; call sites never pick colours themselves.
 */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export const BOOKING_STATUS_TONES: Record<string, StatusTone> = {
  pending: "warning",
  checkout_started: "warning",
  paid: "success",
  confirmed: "success",
  cancelled: "danger",
  expired: "neutral",
};

export const VOUCHER_STATUS_TONES: Record<string, StatusTone> = {
  active: "info",
  checked_in: "success",
  void: "danger",
};

export const INVOICE_STATUS_TONES: Record<string, StatusTone> = {
  none: "neutral",
  pending: "warning",
  issued: "success",
  failed: "danger",
  reversed: "neutral",
};

export function toneFor(map: Record<string, StatusTone>, status: string | null | undefined): StatusTone {
  return (status && map[status]) || "neutral";
}
