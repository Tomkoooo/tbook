"use client";

import { useEffect, useState, useTransition } from "react";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import { createDeviceLinkAction } from "@/app/auth/login-request-actions";

/**
 * Shows a short-lived QR code. It is created only when the button is
 * pressed, hides itself when it expires, and works once — so a code left on
 * a screen is harmless after two minutes.
 */
export function DeviceLinkCard() {
  const [code, setCode] = useState<{ qr: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!code) return;
    const tick = () => {
      const seconds = Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000));
      setLeft(seconds);
      if (seconds === 0) setCode(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [code]);

  return (
    <SectionCard title="QR code" description="Anyone who scans it within two minutes can sign in as you, so show it only to your own device.">
      <div className="grid justify-items-start gap-4">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {code ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- server-generated data: URL */}
            <img src={code.qr} alt="QR code that signs in the device that scans it" width={240} height={240} className="rounded-md border bg-white" />
            <p className="text-muted-foreground text-sm tabular-nums">Expires in {left} s. It works once.</p>
          </>
        ) : null}
        <Button
          variant={code ? "outline" : "default"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await createDeviceLinkAction();
              if (result.ok) {
                setError(null);
                setCode({ qr: result.qrDataUrl, expiresAt: result.expiresAt });
              } else setError(result.message);
            })
          }
        >
          <QrCode /> {code ? "New code" : "Show QR code"}
        </Button>
      </div>
    </SectionCard>
  );
}
