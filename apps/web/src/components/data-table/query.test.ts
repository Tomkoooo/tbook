import { describe, expect, it } from "vitest";
import { applyClientQuery, parseDataTableQuery, parseSort, withParams } from "./query";
import type { ColumnDef } from "./types";

type Row = { name: string; age: number; kind: string; at: string; active: boolean; tags: string[] };

const columns: ColumnDef<Row>[] = [
  { key: "name", label: "Name", searchable: true, sortable: true, filterable: true },
  { key: "age", label: "Age", type: "number", sortable: true, filterable: true },
  { key: "kind", label: "Kind", type: "enum", filterable: true, enumValues: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
  { key: "at", label: "At", type: "date", filterable: true },
  { key: "active", label: "Active", type: "boolean", filterable: true },
  { key: "tags", label: "Tags", filterVariant: "select", filterable: true },
  { key: "secret", label: "Secret" },
];

const rows: Row[] = [
  { name: "Ágnes", age: 30, kind: "a", at: "2026-07-01", active: true, tags: ["vip"] },
  { name: "Béla", age: 41, kind: "b", at: "2026-07-05", active: false, tags: [] },
  { name: "Csaba", age: 25, kind: "a", at: "2026-07-09", active: true, tags: ["vip", "press"] },
];

const query = (params: Record<string, string | string[]>) => parseDataTableQuery(params);

describe("parseDataTableQuery", () => {
  it("reads search, sort, page and repeated filters from the URL", () => {
    const parsed = query({ search: " ann ", sort: "-age", page: "3", pageSize: "50", "f.kind": ["a", "b"], "f.age": ["10", "20"] });
    expect(parsed).toMatchObject({ search: "ann", sort: "-age", page: 3, pageSize: 50, filters: { kind: ["a", "b"], age: ["10", "20"] } });
  });

  it("never accepts an unbounded page size and falls back to the viewer's saved size", () => {
    expect(query({ pageSize: "100000" }).pageSize).toBe(25);
    expect(parseDataTableQuery({ pageSize: "7" }, { savedPageSize: 100 }).pageSize).toBe(100);
    expect(parseDataTableQuery({}, { sort: "-createdAt" }).sort).toBe("-createdAt");
    expect(query({ page: "-4" }).page).toBe(1);
  });
});

describe("parseSort", () => {
  it("only accepts columns the list marks sortable", () => {
    expect(parseSort("-age", columns)).toEqual({ key: "age", dir: "desc" });
    expect(parseSort("name", columns)).toEqual({ key: "name", dir: "asc" });
    expect(parseSort("secret", columns)).toBeNull();
    expect(parseSort("", columns)).toBeNull();
  });
});

describe("applyClientQuery", () => {
  const run = (params: Record<string, string | string[]>) => applyClientQuery(rows, columns, query(params)).rows.map((row) => row.name);

  it("searches the searchable columns, accent-insensitively enough for Hungarian case", () => {
    expect(run({ search: "bé" })).toEqual(["Béla"]);
    expect(run({ search: "zzz" })).toEqual([]);
  });

  it("filters by type: enum, number range, date range (inclusive end day), boolean, array cell", () => {
    expect(run({ "f.kind": "a" })).toEqual(["Ágnes", "Csaba"]);
    expect(run({ "f.age": ["26", "35"] })).toEqual(["Ágnes"]);
    expect(run({ "f.at": ["2026-07-02", "2026-07-09"] })).toEqual(["Béla", "Csaba"]);
    expect(run({ "f.active": "false" })).toEqual(["Béla"]);
    expect(run({ "f.tags": "press" })).toEqual(["Csaba"]);
  });

  it("ignores filters and sorts on columns that don't allow them", () => {
    expect(run({ "f.secret": "x" })).toEqual(["Ágnes", "Béla", "Csaba"]);
    expect(run({ sort: "secret" })).toEqual(["Ágnes", "Béla", "Csaba"]);
  });

  it("sorts and pages, reporting the total before paging", () => {
    expect(run({ sort: "-age" })).toEqual(["Béla", "Ágnes", "Csaba"]);
    const paged = applyClientQuery(rows, columns, { ...query({ sort: "age" }), page: 2, pageSize: 2 });
    expect(paged.rows.map((row) => row.name)).toEqual(["Béla"]);
    expect(paged.total).toBe(3);
  });
});

describe("withParams", () => {
  it("replaces, removes and keeps foreign params", () => {
    const current = new URLSearchParams("view=attendees&search=a&f.kind=a&f.kind=b&page=3");
    expect(withParams(current, { search: "b", "f.kind": ["c"], page: undefined })).toBe("view=attendees&search=b&f.kind=c");
    expect(withParams(current, { "f.kind": undefined })).toBe("view=attendees&search=a&page=3");
  });
});
