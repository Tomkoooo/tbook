"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckboxField, FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import {
  applyImportTargetAction,
  importDataListAction,
  uploadImportFileAction,
  type ApplyResult,
  type UploadResult,
  type UploadedSheet,
} from "../../data-actions";

interface TargetOption {
  key: string;
  label: string;
  description: string;
  needsEvent: boolean;
  fields: Array<{ key: string; label: string; required?: boolean; hint?: string }>;
}

const DATA_LIST = "core:data-list";

/** Loose header match, so "E-mail cím" pre-selects for "Email". */
function simplify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function guessColumn(header: string[], ...hints: string[]): string {
  const wanted = hints.map(simplify).filter(Boolean);
  return header.find((h) => wanted.includes(simplify(h))) ?? header.find((h) => wanted.some((w) => simplify(h).includes(w))) ?? "";
}

/**
 * Upload → sheet → destination → column mapping → apply. The parsed file
 * lives in a server-side import session (expires after a day), so each step
 * sends only choices, never the file again.
 */
export function ImportWizard({
  targets,
  lists,
  events,
  replaceListId,
}: {
  targets: TargetOption[];
  lists: Array<{ id: string; name: string }>;
  events: Array<{ id: string; name: string }>;
  replaceListId: string | null;
}) {
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [destination, setDestination] = useState(DATA_LIST);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [pending, startTransition] = useTransition();

  const sheet = upload?.sheets?.find((s) => s.name === sheetName) ?? null;
  const target = targets.find((t) => t.key === destination) ?? null;

  const onUpload = (formData: FormData) =>
    startTransition(async () => {
      setResult(null);
      const outcome = await uploadImportFileAction(formData);
      setUpload(outcome);
      const first = outcome.sheets?.find((s) => s.rowCount > 0) ?? outcome.sheets?.[0];
      setSheetName(first?.name ?? "");
    });

  return (
    <div className="grid gap-6">
      <SectionCard title="1. File" description="The first non-empty row is read as the column headers.">
        <form action={onUpload} className="flex flex-wrap items-end gap-3">
          <FormField label="Spreadsheet" htmlFor="import-file" className="min-w-64 flex-1">
            <Input id="import-file" name="file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required />
          </FormField>
          <Button type="submit" disabled={pending}>
            <Upload /> Read file
          </Button>
        </form>
        {upload && !upload.ok ? (
          <div className="mt-3">
            <ResultNotice result={upload} />
          </div>
        ) : null}
      </SectionCard>

      {upload?.ok && upload.sheets ? (
        <SectionCard title="2. Sheet" description={upload.fileName}>
          <div className="grid gap-4">
            {upload.sheets.length > 1 ? (
              <FormField label="Sheet" htmlFor="import-sheet" className="max-w-sm">
                <NativeSelect id="import-sheet" value={sheetName} onChange={(e) => setSheetName(e.target.value)}>
                  {upload.sheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.rowCount} rows)
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : null}
            {sheet ? <SheetPreview sheet={sheet} /> : null}
          </div>
        </SectionCard>
      ) : null}

      {upload?.ok && sheet ? (
        <SectionCard title="3. What the rows become">
          <div className="grid gap-4">
            <FormField label="Import into" htmlFor="import-target" className="max-w-md" hint={target?.description ?? "A list rules and emails can use, e.g. the employees allowed to register."}>
              <NativeSelect id="import-target" value={destination} onChange={(e) => (setDestination(e.target.value), setResult(null))}>
                <option value={DATA_LIST}>Data list</option>
                {targets.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
        </SectionCard>
      ) : null}

      {upload?.ok && upload.sessionId && sheet ? (
        destination === DATA_LIST ? (
          <DataListMapping
            key={sheet.name}
            sessionId={upload.sessionId}
            sheet={sheet}
            fileName={upload.fileName ?? ""}
            lists={lists}
            replaceListId={replaceListId}
            pending={pending}
            onApply={(input) => startTransition(async () => setResult(await importDataListAction(input)))}
          />
        ) : target ? (
          <TargetMapping
            key={`${sheet.name}:${target.key}`}
            target={target}
            sheet={sheet}
            events={events}
            pending={pending}
            onApply={(eventId, mapping) =>
              startTransition(async () =>
                setResult(await applyImportTargetAction({ sessionId: upload.sessionId!, sheetName: sheet.name, targetKey: target.key, eventId, mapping })),
              )
            }
          />
        ) : null
      ) : null}

      {result ? (
        <div className="grid gap-2">
          <ResultNotice result={result} />
          {result.details && result.details.length > 0 ? (
            <Notice tone="warning">
              <ul className="list-disc pl-4">
                {result.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {result.ok && result.listId ? (
            <div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/data/${result.listId}`}>Open the list</Link>
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SheetPreview({ sheet }: { sheet: UploadedSheet }) {
  if (sheet.header.length === 0) return <p className="text-muted-foreground text-sm">This sheet is empty.</p>;
  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <FileSpreadsheet className="size-4" /> {sheet.rowCount} rows · {sheet.header.length} columns · first rows:
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {sheet.header.map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheet.preview.map((row, index) => (
              <TableRow key={index}>
                {sheet.header.map((h, column) => (
                  <TableCell key={h} className="whitespace-nowrap">
                    {row[column] ?? ""}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ColumnSelect({ id, header, value, onChange, optional }: { id: string; header: string[]; value: string; onChange: (value: string) => void; optional?: boolean }) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{optional ? "— none —" : "Choose a column…"}</option>
      {header.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </NativeSelect>
  );
}

function DataListMapping({
  sessionId,
  sheet,
  fileName,
  lists,
  replaceListId,
  pending,
  onApply,
}: {
  sessionId: string;
  sheet: UploadedSheet;
  fileName: string;
  lists: Array<{ id: string; name: string }>;
  replaceListId: string | null;
  pending: boolean;
  onApply: (input: Parameters<typeof importDataListAction>[0]) => void;
}) {
  const header = sheet.header;
  const [listId, setListId] = useState(replaceListId ?? "");
  const [name, setName] = useState(() => lists.find((l) => l.id === replaceListId)?.name ?? fileName.replace(/\.(xlsx|csv)$/i, ""));
  const [description, setDescription] = useState("");
  const [keyColumn, setKeyColumn] = useState(() => guessColumn(header, "törzsszám", "azonosító", "id", "dolgozó", "kód"));
  const [keyNormalization, setKeyNormalization] = useState("trim_case");
  const [emailColumn, setEmailColumn] = useState(() => guessColumn(header, "email", "e-mail", "e-mail cím"));
  const [nameColumn, setNameColumn] = useState(() => guessColumn(header, "név", "name", "teljes név"));
  const [columns, setColumns] = useState<string[]>(header);

  const keySample = useMemo(() => {
    const index = header.indexOf(keyColumn);
    return index < 0 ? [] : sheet.preview.map((row) => row[index] ?? "").filter(Boolean).slice(0, 3);
  }, [header, keyColumn, sheet.preview]);

  return (
    <SectionCard title="4. Columns" description="Pick the column that identifies each row. Its values are what a registration answer is checked against.">
      <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="List" htmlFor="dl-list">
            <NativeSelect
              id="dl-list"
              value={listId}
              onChange={(e) => {
                setListId(e.target.value);
                const existing = lists.find((l) => l.id === e.target.value);
                if (existing) setName(existing.name);
              }}
            >
              <option value="">Create a new list</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  Replace the rows of “{list.name}”
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Name" htmlFor="dl-name">
            <Input id="dl-name" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Description (optional)" htmlFor="dl-description">
          <Input id="dl-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FormField label="Key column" htmlFor="dl-key" hint={keySample.length ? `e.g. ${keySample.join(", ")}` : undefined}>
            <ColumnSelect id="dl-key" header={header} value={keyColumn} onChange={setKeyColumn} />
          </FormField>
          <FormField label="Compare keys as" htmlFor="dl-norm" hint="How a typed answer is matched to a key.">
            <NativeSelect id="dl-norm" value={keyNormalization} onChange={(e) => setKeyNormalization(e.target.value)}>
              <option value="trim_case">Text, ignoring case and spaces</option>
              <option value="digits_only">Digits only (IDs, numbers)</option>
              <option value="alnum">Letters and digits only</option>
            </NativeSelect>
          </FormField>
          <FormField label="Email column" htmlFor="dl-email" hint="Lets emails go to the list.">
            <ColumnSelect id="dl-email" header={header} value={emailColumn} onChange={setEmailColumn} optional />
          </FormField>
          <FormField label="Name column" htmlFor="dl-name-col" hint="Used to greet people.">
            <ColumnSelect id="dl-name-col" header={header} value={nameColumn} onChange={setNameColumn} optional />
          </FormField>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Columns to keep</legend>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {header.map((h) => (
              <CheckboxField
                key={h}
                label={h}
                checked={columns.includes(h) || h === keyColumn}
                disabled={h === keyColumn}
                onCheckedChange={(on) => setColumns(on ? [...columns, h] : columns.filter((c) => c !== h))}
              />
            ))}
          </div>
        </fieldset>
        <div>
          <Button
            disabled={pending || !keyColumn || !name.trim()}
            onClick={() =>
              onApply({ sessionId, sheetName: sheet.name, listId: listId || null, name, description, columns, keyColumn, keyNormalization, emailColumn, nameColumn })
            }
          >
            {listId ? "Replace rows" : "Create list"} ({sheet.rowCount} rows)
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function TargetMapping({
  target,
  sheet,
  events,
  pending,
  onApply,
}: {
  target: TargetOption;
  sheet: UploadedSheet;
  events: Array<{ id: string; name: string }>;
  pending: boolean;
  onApply: (eventId: string | null, mapping: Record<string, string>) => void;
}) {
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [mapping, setMapping] = useState<Record<string, string>>(() =>
    Object.fromEntries(target.fields.map((field) => [field.key, guessColumn(sheet.header, field.label, field.key)])),
  );
  const missing = target.fields.filter((field) => field.required && !mapping[field.key]);

  return (
    <SectionCard title="4. Columns" description="Match each item to a column of the sheet.">
      <div className="grid gap-5">
        {target.needsEvent ? (
          <FormField label="Event" htmlFor="target-event" className="max-w-md">
            <NativeSelect id="target-event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {target.fields.map((field) => (
            <FormField key={field.key} label={`${field.label}${field.required ? " *" : ""}`} htmlFor={`map-${field.key}`} hint={field.hint}>
              <ColumnSelect
                id={`map-${field.key}`}
                header={sheet.header}
                value={mapping[field.key] ?? ""}
                optional={!field.required}
                onChange={(value) => setMapping({ ...mapping, [field.key]: value })}
              />
            </FormField>
          ))}
        </div>
        <div>
          <Button disabled={pending || missing.length > 0 || (target.needsEvent && !eventId)} onClick={() => onApply(target.needsEvent ? eventId : null, mapping)}>
            Import {sheet.rowCount} rows
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
