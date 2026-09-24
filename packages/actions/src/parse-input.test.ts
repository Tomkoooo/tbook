import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ActionError } from "./action-error";
import { parseInput } from "./parse-input";

describe("parseInput", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns the parsed value on success", () => {
    expect(parseInput(schema, { name: "World Darts Festival" })).toEqual({
      name: "World Darts Festival",
    });
  });

  it("throws a validation ActionError on failure", () => {
    try {
      parseInput(schema, { name: "" });
      expect.unreachable("expected parseInput to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ActionError);
      expect((error as ActionError).status).toBe(400);
      expect((error as ActionError).code).toBe("validation_error");
    }
  });
});
