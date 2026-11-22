/**
 * Status → badge tone. Kept in one place so every surface renders a given
 * status identically; call sites never pick colours themselves.
 */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "note";

/**
 * Tone → utility classes for non-badge surfaces (KPI icon chips, status dots,
 * tinted rows). Full class names so Tailwind can see them; this is the only
 * place a tone is turned into colours besides the Badge/Alert variants.
 */
export const TONE_CLASSES: Record<StatusTone, { chip: string; soft: string; text: string; dot: string; border: string }> = {
  neutral: { chip: "bg-neutral-soft text-neutral-soft-foreground", soft: "bg-neutral-soft text-neutral-soft-foreground border-neutral-border", text: "text-neutral", dot: "bg-neutral", border: "border-neutral-border" },
  info: { chip: "bg-info-soft text-info-soft-foreground", soft: "bg-info-soft text-info-soft-foreground border-info-border", text: "text-info", dot: "bg-info", border: "border-info-border" },
  success: { chip: "bg-success-soft text-success-soft-foreground", soft: "bg-success-soft text-success-soft-foreground border-success-border", text: "text-success", dot: "bg-success", border: "border-success-border" },
  warning: { chip: "bg-warning-soft text-warning-soft-foreground", soft: "bg-warning-soft text-warning-soft-foreground border-warning-border", text: "text-warning", dot: "bg-warning", border: "border-warning-border" },
  danger: { chip: "bg-danger-soft text-danger-soft-foreground", soft: "bg-danger-soft text-danger-soft-foreground border-danger-border", text: "text-danger", dot: "bg-danger", border: "border-danger-border" },
  note: { chip: "bg-note-soft text-note-soft-foreground", soft: "bg-note-soft text-note-soft-foreground border-note-border", text: "text-note", dot: "bg-note", border: "border-note-border" },
};

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
