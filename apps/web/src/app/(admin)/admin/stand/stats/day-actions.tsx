"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reopenDayAction, resendReportAction } from "../actions";

/** Per closed day: email the report again, or reopen the latest day to fix it. */
export function DayActions({ dayId, defaultEmail, canReopen }: { dayId: string; defaultEmail: string; canReopen: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Input className="h-8 w-48" type="email" aria-label="Report recipient" placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !email}
        onClick={() =>
          start(async () => {
            setMessage((await resendReportAction(dayId, email)).message ?? null);
          })
        }
      >
        Jelentés küldése
      </Button>
      {canReopen ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await reopenDayAction(dayId);
              setMessage(r.message ?? null);
              if (r.ok) router.push("/admin/stand");
            })
          }
        >
          Újranyitás
        </Button>
      ) : null}
      {message ? <span className="text-muted-foreground text-xs">{message}</span> : null}
    </div>
  );
}
