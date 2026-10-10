import { describe, expect, it, vi } from "vitest";
import { buildTDartsTeamRoster, enrollTDartsPair, enrollTDartsPlayer, extractParticipantContact, resolveTDartsCredentials, signTDartsRequest, TDartsApiError } from "./tdarts-sync-service";

describe("signTDartsRequest", () => {
  it("is deterministic HMAC-SHA256 over `${timestamp}.${rawBody}`", () => {
    const a = signTDartsRequest("secret", "1700000000", '{"a":1}');
    const b = signTDartsRequest("secret", "1700000000", '{"a":1}');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the timestamp, body, or secret changes", () => {
    const base = signTDartsRequest("secret", "1700000000", "body");
    expect(signTDartsRequest("secret", "1700000001", "body")).not.toBe(base);
    expect(signTDartsRequest("secret", "1700000000", "other")).not.toBe(base);
    expect(signTDartsRequest("other-secret", "1700000000", "body")).not.toBe(base);
  });
});

describe("resolveTDartsCredentials", () => {
  it("returns null when disabled or missing fields", () => {
    expect(resolveTDartsCredentials(null)).toBeNull();
    expect(resolveTDartsCredentials({ enabled: false, apiBaseUrl: "https://api.tdarts.hu", partnerClientId: "x", partnerClientSecretEnc: "y" })).toBeNull();
    expect(resolveTDartsCredentials({ enabled: true, apiBaseUrl: "", partnerClientId: "x", partnerClientSecretEnc: "y" })).toBeNull();
  });

  it("strips trailing slashes from apiBaseUrl", () => {
    const creds = resolveTDartsCredentials({ enabled: true, apiBaseUrl: "https://api.tdarts.hu/", partnerClientId: "client", partnerClientSecretEnc: "plaintext-secret" });
    expect(creds?.apiBaseUrl).toBe("https://api.tdarts.hu");
  });
});

describe("extractParticipantContact", () => {
  const schema = [
    { key: "fullName", label: "Teljes név", type: "text" as const, required: true, helpText: "", sortOrder: 0 },
    { key: "email", label: "Email", type: "email" as const, required: true, helpText: "", sortOrder: 1 },
    { key: "nationality", label: "Állampolgárság", type: "text" as const, required: false, helpText: "", sortOrder: 2 },
    { key: "dob", label: "Születési dátum", type: "date" as const, required: false, helpText: "", sortOrder: 3 },
  ];

  it("extracts name/email/country/birthDate from matched fields", () => {
    const contact = extractParticipantContact(schema, { fullName: "Kiss Béla", email: "bela@example.com", nationality: "Hungarian", dob: "1995-04-12" }, { name: "Buyer", email: "buyer@example.com" });
    expect(contact).toEqual({ email: "bela@example.com", name: "Kiss Béla", country: "HU", birthDate: "1995-04-12", nameIsFallback: false, emailIsFallback: false });
  });

  it("flags nameIsFallback/emailIsFallback when the participant left fields blank", () => {
    const contact = extractParticipantContact(schema, { fullName: "", email: "" }, { name: "Buyer", email: "buyer@example.com" });
    expect(contact.name).toBe("Buyer");
    expect(contact.nameIsFallback).toBe(true);
    expect(contact.email).toBe("buyer@example.com");
    expect(contact.emailIsFallback).toBe(true);
  });

  it("does not flag a fallback when the schema has no name/email field at all", () => {
    const contact = extractParticipantContact([], {}, { name: "Buyer", email: "buyer@example.com" });
    expect(contact.nameIsFallback).toBe(false);
    expect(contact.emailIsFallback).toBe(false);
  });

  it("omits an invalid/unmapped country rather than guessing wrong", () => {
    const contact = extractParticipantContact(schema, { fullName: "X", email: "x@example.com", nationality: "Narnia" }, { name: "Buyer", email: "buyer@example.com" });
    expect(contact.country).toBeUndefined();
  });
});

describe("enrollTDartsPlayer / enrollTDartsPair", () => {
  const creds = { apiBaseUrl: "https://api.tdarts.hu", partnerClientId: "client-1", partnerClientSecret: "secret" };

  it("signs the request and sends it to the tournament enroll endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ playerId: "p1", rosterStatus: "applied" }), { status: 200 }));

    const result = await enrollTDartsPlayer(creds, { tournamentCode: "WDF2026", email: "a@example.com", name: "A", orderId: "booking1:0" }, fetchImpl);

    expect(result).toEqual({ playerId: "p1", rosterStatus: "applied" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tdarts.hu/partner/tournaments/WDF2026/enroll");
    expect((init.headers as Record<string, string>)["X-Client-Id"]).toBe("client-1");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("booking1:0");
    expect((init.headers as Record<string, string>)["X-Signature"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws with the API's error message on a non-OK response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Tournament full" }), { status: 409 }));
    await expect(enrollTDartsPlayer(creds, { tournamentCode: "WDF2026", email: "a@example.com", name: "A", orderId: "x" }, fetchImpl)).rejects.toThrow("Tournament full");
  });

  it("registers both pair members in one call with a single orderId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ pairPlayerId: "pp1", rosterStatus: "applied" }), { status: 200 }));

    await enrollTDartsPair(creds, { tournamentCode: "WDF2026", member1: { email: "a@example.com", name: "A" }, member2: { email: "b@example.com", name: "B" }, orderId: "booking1:0" }, fetchImpl);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.email).toBe("a@example.com");
    expect(body.partner.email).toBe("b@example.com");
  });
});

describe("buildTDartsTeamRoster", () => {
  const memberSchema = [
    { key: "fullName", label: "Név", type: "text" as const, required: true, helpText: "", sortOrder: 0 },
    { key: "email", label: "Email", type: "email" as const, required: false, helpText: "", sortOrder: 1 },
  ];
  const buyer = { name: "Buyer", email: "buyer@example.com" };
  const member = (fullName: string, email = "") => ({ fields: { fullName, email } });

  it("falls back to '<first player> +N' when the ticket has no team-name field", () => {
    const roster = buildTDartsTeamRoster([], {}, memberSchema, [member("Anna", "a@example.com"), member("Béla"), member("Cili")], buyer);
    expect(roster).toMatchObject({ ok: true, teamName: "Anna +2" });
  });

  it("never hands a member the buyer's email, even when the member schema has no email field at all", () => {
    const nameOnly = [memberSchema[0]!];
    const roster = buildTDartsTeamRoster([], {}, nameOnly, [member("Anna"), member("Béla"), member("Cili")], buyer);
    // No own email anywhere → refused rather than enrolled under the buyer's address.
    expect(roster).toEqual({ ok: false, error: expect.stringContaining("No team member has an email") });
  });

  it("refuses duplicate member emails and rosters that are really a pair", () => {
    const dup = buildTDartsTeamRoster([], {}, memberSchema, [member("Anna", "x@example.com"), member("Béla", "X@example.com"), member("Cili")], buyer);
    expect(dup).toMatchObject({ ok: false });
    const pair = buildTDartsTeamRoster([], {}, memberSchema, [member("Anna", "a@example.com"), member("Béla")], buyer);
    expect(pair).toMatchObject({ ok: false });
  });
});

describe("TDartsApiError", () => {
  it("carries tDarts' stable refusal code", async () => {
    const creds = { apiBaseUrl: "https://api.tdarts.hu", partnerClientId: "client-1", partnerClientSecret: "secret" };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Registration is closed", code: "TOURNAMENT_ALREADY_STARTED" }), { status: 422 }));
    const error = await enrollTDartsPlayer(creds, { tournamentCode: "WDF2026", email: "a@example.com", name: "A", orderId: "x" }, fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(TDartsApiError);
    expect(error).toMatchObject({ status: 422, code: "TOURNAMENT_ALREADY_STARTED", message: "Registration is closed" });
  });
});
