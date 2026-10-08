"use client";

import { useState } from "react";
import type { AttendeeFieldDef } from "@tbook/schemas";
import { Field, Input, Select } from "@tbook/ui";

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
    <fieldset
      style={{
        border: "1px solid var(--tbook-border)",
        borderRadius: "var(--tbook-radius-sm)",
        padding: 12,
        margin: 0,
      }}
    >
      <legend className="tbook-field-label">{label}</legend>

      {attendeeFields.length > 0 ? (
        <div className="tbook-filter-form">
          {attendeeFields.map((field) => (
            <AttendeeField key={field.key} name={`attendee.${index}.${field.key}`} field={field} />
          ))}
        </div>
      ) : null}

      {isTeam ? (
        <div className="tbook-stack" style={{ marginTop: attendeeFields.length > 0 ? 12 : 0 }}>
          {rosterSize == null && teamMemberLimit != null ? (
            <div className="tbook-row">
              <span className="tbook-faint">Players in this team:</span>
              <Input
                type="number"
                min={1}
                max={teamMemberLimit}
                value={memberCount}
                onChange={(e) =>
                  setMemberCount(Math.min(Math.max(Number(e.target.value) || 1, 1), teamMemberLimit))
                }
                style={{ width: 90 }}
                aria-label="Players in this team"
              />
              <span className="tbook-faint">max {teamMemberLimit}</span>
            </div>
          ) : null}

          {Array.from({ length: memberCount }, (_, memberIndex) => (
            <div
              key={memberIndex}
              style={{
                borderLeft: "3px solid var(--tbook-border-strong)",
                paddingLeft: 12,
              }}
            >
              <p className="tbook-field-label" style={{ margin: "0 0 6px" }}>
                Player {memberIndex + 1}
              </p>
              <div className="tbook-filter-form">
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
      <Field label={field.label} htmlFor={name}>
        <Select
          {...common}
          placeholder={field.required ? undefined : "—"}
          // The schema calls them `choices`, each already {value,label}.
          options={(field.choices ?? []).map((choice) => ({ value: choice.value, label: choice.label }))}
        />
      </Field>
    );
  }

  const inputType =
    field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text";

  return (
    <Field label={field.label} htmlFor={name}>
      <Input {...common} type={inputType} autoComplete="off" />
    </Field>
  );
}
