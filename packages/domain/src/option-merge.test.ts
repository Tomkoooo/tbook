import type { OptionDef } from "@tbook/schemas";
import { describe, expect, it } from "vitest";
import { mergeOptionSchemas } from "./option-merge";

function option(key: string, sortOrder: number): OptionDef {
  return { key, label: key, type: "checkbox", required: false, defaultValue: null, sortOrder, dependsOn: null };
}

describe("mergeOptionSchemas", () => {
  it("concatenates non-overlapping keys sorted by sortOrder", () => {
    const merged = mergeOptionSchemas([option("a", 1)], [option("b", 0)]);
    expect(merged.map((o) => o.key)).toEqual(["b", "a"]);
  });

  it("local options override group options with the same key", () => {
    const groupOption = { ...option("meals", 0), label: "Group meals" };
    const localOption = { ...option("meals", 0), label: "Hotel meals" };
    const merged = mergeOptionSchemas([groupOption], [localOption]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.label).toBe("Hotel meals");
  });
});
