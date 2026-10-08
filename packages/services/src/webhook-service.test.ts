import { describe, expect, it, vi } from "vitest";
import {
  deliverWebhook,
  generateWebhookId,
  generateWebhookSecret,
  signWebhookBody,
  verifyWebhookSignature,
} from "./webhook-service";
import type { OrgWebhook } from "@tbook/schemas";

function webhook(overrides: Partial<OrgWebhook> = {}): OrgWebhook {
  return {
    id: "hook-1",
    url: "https://example.test/hook",
    description: "",
    events: ["booking.paid"],
    enabled: true,
    // Empty means unsigned; the signed cases set this explicitly via a real
    // encrypted secret in the integration suite.
    secretEnc: "",
    createdAt: null,
    lastStatus: null,
    lastError: null,
    lastDeliveredAt: null,
    ...overrides,
  };
}

const payload = {
  event: "booking.paid" as const,
  sentAt: "2026-10-08T12:00:00.000Z",
  organizationId: "6ac7c00d8eeeb3b8529cfbca",
  data: { id: "abc" },
};

describe("signWebhookBody", () => {
  it("produces a stable sha256= prefixed hex HMAC", () => {
    const signature = signWebhookBody('{"a":1}', "secret");
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signWebhookBody('{"a":1}', "secret")).toBe(signature);
  });

  it("changes when the body changes", () => {
    expect(signWebhookBody('{"a":1}', "s")).not.toBe(signWebhookBody('{"a":2}', "s"));
  });

  it("changes when the secret changes", () => {
    expect(signWebhookBody('{"a":1}', "s1")).not.toBe(signWebhookBody('{"a":1}', "s2"));
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a correct signature", () => {
    const body = '{"hello":"world"}';
    expect(verifyWebhookSignature(body, "secret", signWebhookBody(body, "secret"))).toBe(true);
  });

  it("rejects a signature made with the wrong secret", () => {
    const body = '{"hello":"world"}';
    expect(verifyWebhookSignature(body, "secret", signWebhookBody(body, "other"))).toBe(false);
  });

  it("rejects a tampered body", () => {
    const signature = signWebhookBody('{"amount":100}', "secret");
    expect(verifyWebhookSignature('{"amount":999}', "secret", signature)).toBe(false);
  });

  it("returns false rather than throwing on a malformed signature of the wrong length", () => {
    // timingSafeEqual throws on a length mismatch, so this guards that path.
    expect(verifyWebhookSignature("{}", "secret", "garbage")).toBe(false);
    expect(verifyWebhookSignature("{}", "secret", "")).toBe(false);
  });
});

describe("secret and id generation", () => {
  it("generates prefixed, unique secrets", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_/);
    expect(a).not.toBe(b);
  });

  it("generates unique endpoint ids", () => {
    expect(generateWebhookId()).not.toBe(generateWebhookId());
  });
});

describe("deliverWebhook", () => {
  it("POSTs the payload as JSON with the event and delivery headers", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));

    const outcome = await deliverWebhook(webhook(), payload, fetchImpl as unknown as typeof fetch);

    expect(outcome).toMatchObject({ ok: true, status: 200, error: null });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/hook");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-TBook-Event"]).toBe("booking.paid");
    expect(headers["X-TBook-Delivery"]).toBeTruthy();
    expect(JSON.parse(String(init.body))).toMatchObject({ event: "booking.paid", data: { id: "abc" } });
  });

  it("omits the signature header when the endpoint has no secret", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    await deliverWebhook(webhook(), payload, fetchImpl as unknown as typeof fetch);

    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["X-TBook-Signature"]).toBeUndefined();
  });

  it("reports a non-2xx response as a failed delivery rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));

    const outcome = await deliverWebhook(webhook(), payload, fetchImpl as unknown as typeof fetch);
    expect(outcome).toMatchObject({ ok: false, status: 500, error: "HTTP 500" });
  });

  it("reports a network failure as a failed delivery rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    const outcome = await deliverWebhook(webhook(), payload, fetchImpl as unknown as typeof fetch);
    expect(outcome).toMatchObject({ ok: false, status: null });
    expect(outcome.error).toContain("ECONNREFUSED");
  });

  it("aborts a hanging endpoint and reports a timeout", async () => {
    vi.useFakeTimers();
    // An endpoint that accepts the connection and never answers would
    // otherwise pin the after-payment hook open indefinitely.
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
        }),
    );

    const promise = deliverWebhook(webhook(), payload, fetchImpl as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(6_000);
    const outcome = await promise;

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("timed out");
    vi.useRealTimers();
  });

  it("refuses to follow a redirect, so an endpoint cannot bounce a signed payload elsewhere", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    await deliverWebhook(webhook(), payload, fetchImpl as unknown as typeof fetch);

    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe("error");
  });
});
