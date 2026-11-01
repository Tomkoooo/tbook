"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CameraOff, CheckCircle2, ScanLine, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, NativeSelect } from "@/components/form-bits";
import { SectionCard } from "@/components/section-card";
import { cn } from "@/lib/utils";
import { scanAction, type ScanActionResult } from "../../actions";

type Tone = "success" | "warning" | "danger";

const RESULT_TONES: Record<string, Tone> = {
  valid: "success",
  duplicate: "warning",
  wrong_event: "warning",
  wrong_day: "warning",
  invalid: "danger",
};

/** Large, colour-coded result so the door staff can read it at a glance. */
const TONE_STYLES: Record<Tone, { box: string; Icon: typeof CheckCircle2 }> = {
  success: { box: "border-success/30 bg-success-muted text-success", Icon: CheckCircle2 },
  warning: { box: "border-warning/30 bg-warning-muted text-warning", Icon: AlertTriangle },
  danger: { box: "border-danger/30 bg-danger-muted text-danger", Icon: XCircle },
};

const RESULT_TITLES: Record<string, string> = {
  valid: "Admitted",
  duplicate: "Already checked in",
  wrong_event: "Wrong event",
  wrong_day: "Wrong day",
  invalid: "Not valid",
};

/** The same code is ignored for this long after it was read, so a held-up phone isn't scanned twice. */
const REPEAT_GUARD_MS = 4000;

/**
 * Door scanner. Three ways in, all feeding the same server action:
 *  - a hardware QR/barcode scanner, which types the code and presses Enter
 *    into the focused field (the most reliable path at a busy door);
 *  - the device camera, for a phone or tablet with no scanner;
 *  - typing the code by hand when a guest's code won't scan.
 *
 * Dated day-pass entries are checked against `day`, which starts as today so
 * a pass for another date is refused at the door; switch it to a specific
 * date, or to every day, when needed.
 */
export function ScanPanel({
  eventId,
  today,
  days,
}: {
  eventId: string;
  /** Today's date in the event's time zone, `yyyy-mm-dd`. */
  today: string;
  /** The event's dates when it sells day passes; empty for a one-entry event. */
  days: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [day, setDay] = useState(today);
  const dayRef = useRef(day);
  dayRef.current = day;
  const [cameraOn, setCameraOn] = useState(false);
  const lastRead = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const [state, action, pending] = useActionState(
    async (_prev: ScanActionResult | null, formData: FormData) => scanAction(eventId, formData),
    null,
  );

  useEffect(() => {
    if (pending) return;
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    if (!cameraOn) input.focus();
    // Buzz on a result so the operator can look at the guest instead of the screen.
    if (state && typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(state.result === "valid" ? 60 : [80, 60, 80]);
    }
  }, [state, pending]);

  const submitCode = useCallback(
    (code: string) => {
      const now = Date.now();
      if (lastRead.current.code === code && now - lastRead.current.at < REPEAT_GUARD_MS) return;
      lastRead.current = { code, at: now };
      const formData = new FormData();
      formData.set("code", code);
      formData.set("day", dayRef.current);
      startTransition(() => action(formData));
    },
    [action],
  );

  const tone: Tone | null = state?.result ? (RESULT_TONES[state.result] ?? "danger") : state?.message ? "danger" : null;
  const isToday = day === today;

  return (
    <SectionCard
      title="Scan"
      actions={
        <Button type="button" variant={cameraOn ? "secondary" : "outline"} size="sm" onClick={() => setCameraOn((on) => !on)}>
          {cameraOn ? <CameraOff /> : <Camera />} {cameraOn ? "Stop camera" : "Use camera"}
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid gap-4">
          {days.length > 0 ? (
            <FormField
              label="Admitting for"
              htmlFor="scan-day"
              hint={
                day === "any"
                  ? "Passes for any date are accepted."
                  : isToday
                    ? "Passes dated for another day are refused."
                    : `Only passes dated ${day} are accepted. Switch back to today for normal door duty.`
              }
            >
              <NativeSelect id="scan-day" value={day} onChange={(e) => setDay(e.target.value)}>
                <option value={today}>Today ({today})</option>
                {days
                  .filter((value) => value !== today)
                  .map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                <option value="any">Any day</option>
              </NativeSelect>
            </FormField>
          ) : null}

          <form action={action}>
            <input type="hidden" name="day" value={day} />
            <FormField label="Entry code" htmlFor="code" hint="Scan with a handheld scanner, or type the code and press Enter.">
              <div className="relative">
                <ScanLine className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2" />
                <Input
                  ref={inputRef}
                  id="code"
                  name="code"
                  className="h-12 pl-11 font-mono text-lg md:text-lg"
                  autoComplete="off"
                  autoFocus
                  placeholder="Waiting for a scan…"
                  disabled={pending}
                />
              </div>
            </FormField>
          </form>

          {cameraOn ? <CameraScanner onCode={submitCode} paused={pending} /> : null}
        </div>

        <div className="min-h-24">
          {state && tone ? (
            <ScanResult
              tone={tone}
              title={state.result ? (RESULT_TITLES[state.result] ?? "Result") : null}
              name={state.attendeeName}
              validDate={state.validDate}
              message={state.message}
            />
          ) : (
            <div className="text-muted-foreground flex h-24 items-center justify-center rounded-lg border border-dashed text-sm">
              The result of the last scan appears here.
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/**
 * Live camera reader for QR codes and common 1-D barcodes. Uses the
 * browser's built-in BarcodeDetector where there is one (fast, handles
 * glare well) and falls back to ZXing in JavaScript where there isn't
 * (Safari, Firefox). The camera needs HTTPS — or localhost.
 */
function CameraScanner({ onCode, paused }: { onCode: (code: string) => void; paused: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopZxing: (() => void) | undefined;

    const emit = (code: string) => {
      if (!pausedRef.current && code) onCodeRef.current(code);
    };

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't open the camera here. Camera scanning needs a secure (HTTPS) connection.");
        return;
      }
      const constraints: MediaStreamConstraints = { video: { facingMode: { ideal: "environment" } }, audio: false };

      try {
        const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
        if (Detector) {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stopped) return stream.getTracks().forEach((track) => track.stop());
          video!.srcObject = stream;
          await video!.play();
          const detector = new Detector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "itf", "data_matrix"] });
          let busy = false;
          timer = setInterval(async () => {
            if (busy || video!.readyState < 2) return;
            busy = true;
            try {
              const found = await detector.detect(video!);
              if (found[0]?.rawValue) emit(found[0].rawValue);
            } catch {
              // A frame that can't be decoded is just skipped.
            } finally {
              busy = false;
            }
          }, 160);
          return;
        }

        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (stopped) return;
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 160 });
        const controls = await reader.decodeFromConstraints(constraints, video!, (result) => {
          if (result) emit(result.getText());
        });
        if (stopped) controls.stop();
        else stopZxing = () => controls.stop();
      } catch (cause) {
        if (stopped) return;
        const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
        setError(denied ? "Camera access was blocked. Allow it in the browser's site settings and try again." : "Couldn't start the camera.");
      }
    }

    void start();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stopZxing?.();
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, []);

  if (error) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden rounded-lg border">
      <video ref={videoRef} className="size-full object-cover" playsInline muted />
      <div className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.25)]" />
    </div>
  );
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> };
}

function ScanResult({
  tone,
  title,
  name,
  validDate,
  message,
}: {
  tone: Tone;
  title: string | null;
  name?: string | null;
  validDate?: string | null;
  message?: string | null;
}) {
  const { box, Icon } = TONE_STYLES[tone];
  return (
    <div
      className={cn("flex items-center gap-4 rounded-lg border p-4", box)}
      role={title ? "status" : "alert"}
      aria-live="polite"
    >
      <Icon className="size-8 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="text-xl font-bold">{title}</p> : null}
        {name ? <p className="text-base font-medium">{name}</p> : null}
        {validDate ? <p className="text-sm tabular-nums">Pass for {validDate}</p> : null}
        {message ? <p className="text-sm">{message}</p> : null}
      </div>
    </div>
  );
}
