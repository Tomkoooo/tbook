"use client";

import { useActionState, useState } from "react";
import { RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmailEditor } from "@/components/email-editor";
import { ResultNotice } from "@/components/form-bits";
import { SectionCard } from "@/components/section-card";
import { StickyFormFooter } from "@/components/sticky-form-footer";
import {
  resetBookingEmailAction,
  saveBookingEmailAction,
  sendBookingEmailTestAction,
  type SettingsActionResult,
} from "../../settings-actions";

/**
 * The one customer email for a paid booking. Save, test and reset share
 * one form so "send test" mails exactly what is in the editor right now,
 * saved or not.
 */
export function BookingEmailForm({ subject, body, isCustom }: { subject: string; body: string; isCustom: boolean }) {
  // Three actions share one notice; show whichever finished last.
  const [last, setLast] = useState<SettingsActionResult | null>(null);
  const track = (run: (formData: FormData) => Promise<SettingsActionResult>) =>
    async (_prev: SettingsActionResult | null, formData: FormData) => {
      const result = await run(formData);
      setLast(result);
      return result;
    };
  const [, save, saving] = useActionState(track(saveBookingEmailAction), null);
  const [, test, testing] = useActionState(track(sendBookingEmailTestAction), null);
  const [, reset, resetting] = useActionState(track(() => resetBookingEmailAction()), null);

  return (
    <SectionCard
      title="Booking email"
      description="Sent once when a booking is paid. The ticket PDF and the invoice PDF are attached automatically when they exist."
    >
      <form action={save} className="grid gap-4">
        <EmailEditor initialSubject={subject} initialBody={body} />
        <StickyFormFooter status={<ResultNotice result={last} />}>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save email"}
          </Button>
          <Button type="submit" variant="outline" formAction={test} disabled={testing}>
            <Send /> {testing ? "Sending…" : "Send test to me"}
          </Button>
          {isCustom ? (
            <Button type="submit" variant="ghost" formAction={reset} disabled={resetting} className="ml-auto">
              <RotateCcw /> Reset to default
            </Button>
          ) : null}
        </StickyFormFooter>
      </form>
    </SectionCard>
  );
}
