import { describe, expect, it } from "vitest";
import { ariaSort, hrefWithParams, nextSortDir, parseSort, sortRows } from "./table-sort";

const fallback = { key: "createdAt", dir: "desc" } as const;

describe("parseSort", () => {
  it("accepts allowed keys and directions", () => {
    expect(parseSort({ sortBy: "total", sortDir: "asc" }, ["createdAt", "total"], fallback)).toEqual({ key: "total", dir: "asc" });
  });
  it("falls back for unknown keys and bad directions", () => {
    expect(parseSort({ sortBy: "password", sortDir: "sideways" }, ["createdAt"], fallback)).toEqual(fallback);
    expect(parseSort({}, ["createdAt"], fallback)).toEqual(fallback);
  });
  it("uses the first value of repeated params", () => {
    expect(parseSort({ sortBy: ["total", "x"] }, ["total"], fallback).key).toBe("total");
  });
});

describe("nextSortDir / ariaSort", () => {
  it("flips only the active descending column", () => {
    expect(nextSortDir({ key: "a", dir: "desc" }, "a")).toBe("asc");
    expect(nextSortDir({ key: "a", dir: "asc" }, "a")).toBe("desc");
    expect(nextSortDir({ key: "a", dir: "asc" }, "b")).toBe("desc");
  });
  it("reports aria-sort", () => {
    expect(ariaSort({ key: "a", dir: "asc" }, "a")).toBe("ascending");
    expect(ariaSort({ key: "a", dir: "desc" }, "a")).toBe("descending");
    expect(ariaSort({ key: "a", dir: "desc" }, "b")).toBe("none");
  });
});

describe("hrefWithParams", () => {
  it("keeps other params, replaces and removes overrides", () => {
    expect(hrefWithParams("/admin/x", { q: "a", page: "3" }, { sortBy: "total", page: undefined })).toBe("/admin/x?q=a&sortBy=total");
  });
  it("returns the bare path when nothing is left", () => {
    expect(hrefWithParams("/admin/x", { page: "2" }, { page: undefined })).toBe("/admin/x");
  });
});

describe("sortRows", () => {
  const rows = [{ n: "b", v: 2 }, { n: "a", v: null }, { n: "c", v: 10 }, { n: "d", v: 2 }];
  it("sorts numbers, keeps ties stable and sinks empty values", () => {
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.n)).toEqual(["b", "d", "c", "a"]);
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.n)).toEqual(["c", "b", "d", "a"]);
  });
  it("compares strings naturally", () => {
    const items = ["item10", "item2", "Item1"];
    expect(sortRows(items, (s) => s, "asc")).toEqual(["Item1", "item2", "item10"]);
  });
});
