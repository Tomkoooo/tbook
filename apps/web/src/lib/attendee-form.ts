/**
 * Parses the registration form's flat FormData into the nested attendee
 * shape the service expects. Field names are
 * `attendee.<i>.<key>` for a person-unit entry and
 * `attendee.<i>.member.<j>.<key>` for one roster slot of a team ticket —
 * the same nesting the storefront produces, so both paths build identical
 * documents.
 */
export function parseAttendeesFromForm(formData: FormData, guests: number): Array<{ fields: Record<string, string>; members?: Array<{ fields: Record<string, string> }> }> {
  const rows: Array<{ fields: Record<string, string>; members: Map<number, Record<string, string>> }> = Array.from(
    { length: guests },
    () => ({ fields: {}, members: new Map() }),
  );

  for (const [rawKey, rawValue] of formData.entries()) {
    if (!rawKey.startsWith("attendee.")) continue;
    const value = String(rawValue);

    const memberMatch = /^attendee\.(\d+)\.member\.(\d+)\.(.+)$/.exec(rawKey);
    if (memberMatch) {
      const [, index, memberIndex, key] = memberMatch;
      const row = rows[Number(index)];
      if (!row) continue;
      const member = row.members.get(Number(memberIndex)) ?? {};
      member[key!] = value;
      row.members.set(Number(memberIndex), member);
      continue;
    }

    const fieldMatch = /^attendee\.(\d+)\.(.+)$/.exec(rawKey);
    if (!fieldMatch) continue;
    const [, index, key] = fieldMatch;
    const row = rows[Number(index)];
    if (row) row.fields[key!] = value;
  }

  return rows.map((row) => {
    if (row.members.size === 0) return { fields: row.fields };
    const members = [...row.members.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, fields]) => ({ fields }));
    return { fields: row.fields, members };
  });
}
