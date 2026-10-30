"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, Field, Input } from "@tbook/ui";
import { scanAction, type ScanActionResult } from "../../actions";

const RESULT_TONES: Record<string, string> = {
  valid: "success",
  duplicate: "warning",
  wrong_event: "warning",
  wrong_day: "warning",
  invalid: "danger",
};

const RESULT_TITLES: Record<string, string> = {
  valid: "Admitted",
  duplicate: "Already checked in",
  wrong_event: "Wrong event",
  wrong_day: "Wrong day",
  invalid: "Not valid",
};

/**
 * Door scanner. A plain text input rather than a camera API on purpose:
 * every hardware QR/barcode scanner presents as a keyboard, types the code
 * and sends Enter, so a focused input is the most reliable input path and
 * works offline-ish with no permissions prompt. The field is also usable
 * by hand when a guest's code won't scan.
 *
 * The input is re-focused and cleared after each submission so a queue of
 * guests can be scanned continuously without touching the screen.
 */
export function ScanPanel({ eventId }: { eventId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState(
    async (_prev: ScanActionResult | null, formData: FormData) => scanAction(eventId, formData),
    null,
  );

  useEffect(() => {
    if (pending) return;
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    input.focus();
  }, [state, pending]);

  const tone = state?.result ? (RESULT_TONES[state.result] ?? "neutral") : null;

  return (
    <Card title="Scan">
      <form action={action}>
        <Field label="Entry code" htmlFor="code" hint="Scan a QR code, or type it and press Enter.">
          <Input
            ref={inputRef}
            id="code"
            name="code"
            className="tbook-scan-input"
            autoComplete="off"
            autoFocus
            placeholder="Waiting for a scan…"
            disabled={pending}
          />
        </Field>
      </form>

      {state && tone ? (
        <div className={`tbook-scan-result tbook-notice-${tone}`} role="status" aria-live="polite" style={{ marginTop: 12 }}>
          <p className="tbook-scan-result-title">{RESULT_TITLES[state.result ?? ""] ?? "Result"}</p>
          {state.attendeeName ? <p className="tbook-scan-result-name">{state.attendeeName}</p> : null}
          <p className="tbook-scan-result-name">{state.message}</p>
        </div>
      ) : state?.message ? (
        <div className="tbook-scan-result tbook-notice-danger" role="alert" style={{ marginTop: 12 }}>
          <p className="tbook-scan-result-name">{state.message}</p>
        </div>
      ) : null}
    </Card>
  );
}
