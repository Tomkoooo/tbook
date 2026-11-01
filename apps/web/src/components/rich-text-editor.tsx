"use client";

import { useEffect, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { RichTextToolbar, useRichTextEditor } from "@/components/rich-text-toolbar";

/**
 * Rich text field: admins format text, the form receives HTML. Submits
 * through a hidden input named `name`, and reports changes via onChange.
 * The server sanitizes the HTML before storing it.
 */
export function RichTextEditor({
  name,
  initialValue,
  ariaLabel,
  onChange,
  disabled,
}: {
  name?: string;
  initialValue: string;
  ariaLabel: string;
  onChange?: (html: string) => void;
  disabled?: boolean;
}) {
  const [html, setHtml] = useState(initialValue);
  const editor = useRichTextEditor({
    content: initialValue,
    ariaLabel,
    onChange: (next) => {
      setHtml(next);
      onChange?.(next);
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div className="bg-background focus-within:border-ring focus-within:ring-ring/50 overflow-hidden rounded-md border shadow-xs focus-within:ring-[3px]">
      {name ? <input type="hidden" name={name} value={html} /> : null}
      {disabled ? null : <RichTextToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
