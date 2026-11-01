"use client";

import { useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { Braces } from "lucide-react";
import { BOOKING_EMAIL_PLACEHOLDERS, renderBookingEmail, sampleBookingEmailValues } from "@tbook/domain";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextToolbar, useRichTextEditor } from "@/components/rich-text-toolbar";
import { cn } from "@/lib/utils";

/**
 * Rich text editor for the booking email. Admins never touch HTML: Tiptap
 * produces it, and `{{placeholders}}` are inserted from a menu. The form
 * receives `subject` and `body` (HTML) through hidden inputs.
 *
 * The preview renders inside a sandboxed iframe with no scripts allowed,
 * so whatever ends up in the body can never run inside the console.
 */
export function EmailEditor({ initialSubject, initialBody }: { initialSubject: string; initialBody: string }) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const subjectRef = useRef<HTMLInputElement>(null);

  const editor = useRichTextEditor({ content: initialBody, ariaLabel: "Email body", onChange: setBody });

  function insertIntoSubject(token: string) {
    const input = subjectRef.current;
    const start = input?.selectionStart ?? subject.length;
    const end = input?.selectionEnd ?? subject.length;
    const next = subject.slice(0, start) + token + subject.slice(end);
    setSubject(next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const preview = renderBookingEmail({ subject, body }, sampleBookingEmailValues());

  return (
    <div className="grid gap-4">
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="body" value={body} />

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="email-subject">Subject</Label>
          <PlaceholderMenu onPick={insertIntoSubject} label="Insert into subject" compact />
        </div>
        <Input id="email-subject" ref={subjectRef} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <Label>Message</Label>
          <div className="bg-background focus-within:border-ring focus-within:ring-ring/50 overflow-hidden rounded-md border shadow-xs focus-within:ring-[3px]">
            <RichTextToolbar
              editor={editor}
              extra={<PlaceholderMenu onPick={(token) => editor?.chain().focus().insertContent(token).run()} label="Insert placeholder" />}
            />
            <EditorContent editor={editor} />
          </div>
          <p className="text-muted-foreground text-xs">
            Placeholders like <code className="font-mono">{"{{customerName}}"}</code> are filled in for each booking.
          </p>
        </div>

        <div className="grid content-start gap-1.5">
          <Label>Preview (sample booking)</Label>
          <div className="overflow-hidden rounded-md border">
            <div className="bg-muted/50 border-b px-4 py-2 text-sm">
              <span className="text-muted-foreground">Subject: </span>
              <span className="font-medium">{preview.subject || "—"}</span>
            </div>
            <iframe
              title="Email preview"
              sandbox=""
              className="h-80 w-full bg-white"
              srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;margin:16px}a{color:#0369a1}</style></head><body>${preview.body}</body></html>`}
            />
          </div>
          <p className="text-muted-foreground text-xs">Attachments (tickets, invoice) are added automatically when they exist.</p>
        </div>
      </div>
    </div>
  );
}

function PlaceholderMenu({ onPick, label, compact }: { onPick: (token: string) => void; label: string; compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant={compact ? "ghost" : "outline"} size="sm" className={cn(compact && "h-7")}>
          <Braces /> {compact ? "Placeholder" : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {BOOKING_EMAIL_PLACEHOLDERS.map((placeholder) => (
          <DropdownMenuItem key={placeholder.key} onSelect={() => onPick(`{{${placeholder.key}}}`)}>
            <div className="grid">
              <span>{placeholder.label}</span>
              <span className="text-muted-foreground font-mono text-xs">{`{{${placeholder.key}}}`}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
