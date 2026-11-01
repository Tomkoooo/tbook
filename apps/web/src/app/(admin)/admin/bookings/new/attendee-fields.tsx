"use client";

import { useState } from "react";
import type { AttendeeFieldDef } from "@tbook/schemas";
import { Input } from "@/components/ui/input";
import { FormField, NativeSelect } from "@/components/form-bits";

/**
 * Renders one entry's fields, plus its roster when the event is a team /
 * multi-player one.
 *
 * Input names are flat and positional — `attendee.<i>.<key>` and
 * `attendee.<i>.member.<j>.<key>` — because a server action receives
 * FormData, which has no nesting. The action parses them back into the
 * nested `{ fields, members }` shape the storefront also produces, so both
 * paths write identical documents.
 */
export function AttendeeFields({
  index,
  label,
  attendeeFields,
  teamMemberFields,
  rosterSize,
  teamMemberLimit,
}: {
  index: number;
  label: string;
  attendeeFields: AttendeeFieldDef[];
  teamMemberFields: AttendeeFieldDef[];
  /** Fixed roster size (playersPerTicket > 1), or null when it's variable. */
  rosterSize: number | null;
  teamMemberLimit: number | null;
}) {
  const isTeam = teamMemberFields.length > 0;

  // A fixed roster is exactly playersPerTicket rows and cannot be changed.
  // A variable one starts at 2 (the smallest meaningful team) and can grow
  // to the event's limit.
  const [memberCount, setMemberCount] = useState(rosterSize ?? Math.min(2, teamMemberLimit ?? 2));

  return (
    <fieldset className="grid gap-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">{label}</legend>

      {attendeeFields.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {attendeeFields.map((field) => (
            <AttendeeField key={field.key} name={`attendee.${index}.${field.key}`} field={field} />
          ))}
        </div>
      ) : null}

      {isTeam ? (
        <div className="grid gap-4">
          {rosterSize == null && teamMemberLimit != null ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Players in this team:</span>
              <Input
                type="number"
                min={1}
                max={teamMemberLimit}
                value={memberCount}
                onChange={(e) =>
                  setMemberCount(Math.min(Math.max(Number(e.target.value) || 1, 1), teamMemberLimit))
                }
                className="w-24"
                aria-label="Players in this team"
              />
              <span className="text-muted-foreground">max {teamMemberLimit}</span>
            </div>
          ) : null}

          {Array.from({ length: memberCount }, (_, memberIndex) => (
            <div key={memberIndex} className="grid gap-2 border-l-2 pl-4">
              <p className="text-sm font-medium">Player {memberIndex + 1}</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {teamMemberFields.map((field) => (
                  <AttendeeField
                    key={field.key}
                    name={`attendee.${index}.member.${memberIndex}.${field.key}`}
                    field={field}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

/** One field, rendered from its schema definition rather than hand-written per event. */
export function AttendeeField({
  name,
  field,
  defaultValue,
}: {
  name: string;
  field: AttendeeFieldDef;
  defaultValue?: string;
}) {
  const common = { id: name, name, required: field.required, defaultValue };

  if (field.type === "select") {
    return (
      <FormField label={field.label} htmlFor={name}>
        <NativeSelect {...common}>
          {field.required ? null : <option value="">—</option>}
          {/* The schema calls them `choices`, each already {value,label}. */}
          {(field.choices ?? []).map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
    );
  }

  const inputType =
    field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text";

  return (
    <FormField label={field.label} htmlFor={name}>
      <Input {...common} type={inputType} autoComplete="off" />
    </FormField>
  );
}
