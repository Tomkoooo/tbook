"use client";

import { useState, type ReactNode } from "react";
import { useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Classes that make the editor's HTML look like formatted text. */
export const RICH_TEXT_CONTENT_CLASS =
  "min-h-48 px-4 py-3 text-sm outline-none [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6";

/** The shared Tiptap setup: paragraphs, headings (H2/H3), lists, bold/italic/underline/strike, links. */
export function useRichTextEditor({ content, ariaLabel, onChange }: { content: string; ariaLabel: string; onChange: (html: string) => void }) {
  return useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
    ],
    content,
    immediatelyRender: false,
    editorProps: { attributes: { class: RICH_TEXT_CONTENT_CLASS, "aria-label": ariaLabel } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
}

/** Formatting toolbar; `extra` renders at the right end (e.g. a placeholder menu). */
export function RichTextToolbar({ editor, extra }: { editor: Editor | null; extra?: ReactNode }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            heading: e.isActive("heading", { level: 2 }),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            link: e.isActive("link"),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  if (!editor || !state) return <div className="bg-muted/50 h-10 border-b" />;
  const chain = () => editor.chain().focus();

  function applyLink() {
    const url = linkUrl.trim();
    if (url) chain().extendMarkRange("link").setLink({ href: url }).run();
    setLinkOpen(false);
    setLinkUrl("");
  }

  return (
    <div className="bg-muted/50 border-b">
      <div className="flex flex-wrap items-center gap-0.5 p-1" role="toolbar" aria-label="Formatting">
        <ToolButton label="Bold" active={state.bold} onClick={() => chain().toggleBold().run()}>
          <Bold />
        </ToolButton>
        <ToolButton label="Italic" active={state.italic} onClick={() => chain().toggleItalic().run()}>
          <Italic />
        </ToolButton>
        <ToolButton label="Underline" active={state.underline} onClick={() => chain().toggleUnderline().run()}>
          <Underline />
        </ToolButton>
        <ToolButton label="Strikethrough" active={state.strike} onClick={() => chain().toggleStrike().run()}>
          <Strikethrough />
        </ToolButton>
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
        <ToolButton label="Heading" active={state.heading} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
          <Heading2 />
        </ToolButton>
        <ToolButton label="Bulleted list" active={state.bullet} onClick={() => chain().toggleBulletList().run()}>
          <List />
        </ToolButton>
        <ToolButton label="Numbered list" active={state.ordered} onClick={() => chain().toggleOrderedList().run()}>
          <ListOrdered />
        </ToolButton>
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
        <ToolButton
          label="Add link"
          active={state.link || linkOpen}
          onClick={() => {
            setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
            setLinkOpen((open) => !open);
          }}
        >
          <Link2 />
        </ToolButton>
        {state.link ? (
          <ToolButton label="Remove link" onClick={() => chain().unsetLink().run()}>
            <Unlink />
          </ToolButton>
        ) : null}
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
        <ToolButton label="Undo" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
          <Undo2 />
        </ToolButton>
        <ToolButton label="Redo" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
          <Redo2 />
        </ToolButton>
        {extra ? <div className="ml-auto">{extra}</div> : null}
      </div>

      {linkOpen ? (
        <div className="flex items-center gap-2 border-t p-2">
          <Input
            autoFocus
            value={linkUrl}
            placeholder="https://example.com"
            className="h-8"
            aria-label="Link address"
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") setLinkOpen(false);
            }}
          />
          <Button type="button" size="sm" onClick={applyLink}>
            Apply
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(active && "bg-accent text-accent-foreground")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

