import { ActionError } from "@tbook/actions";
import { describe, expect, it } from "vitest";
import { runAction } from "./api-response";

describe("runAction", () => {
  it("returns a 200 JSON response on success", async () => {
    const response = await runAction(async () => ({ ok: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("maps ActionError to its status code and shape", async () => {
    const response = await runAction(async () => {
      throw ActionError.notFound("Event not found");
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Event not found", details: undefined },
    });
  });

  it("maps unexpected errors to a 500", async () => {
    const response = await runAction(async () => {
      throw new Error("boom");
    });
    expect(response.status).toBe(500);
  });
});
