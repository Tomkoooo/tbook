import { ActionError } from "@tbook/actions";

/**
 * Thin client for the parts of SumUp's API a counter sale needs: pairing a
 * Solo reader, starting and cancelling a checkout on it, and looking a
 * transaction up afterwards.
 *
 * Only SumUp Solo readers take remote checkouts (the "Cloud API"). Air, 3G
 * and PIN+ can't be driven this way, which is why the point of sale keeps
 * a manual "I took the card myself" path.
 *
 * `fetch` is injectable so tests never touch the network.
 */

const DEFAULT_BASE_URL = "https://api.sumup.com";

export interface SumUpCredentials {
  merchantCode: string;
  apiKey: string;
  affiliateAppId: string;
  affiliateKey: string;
}

export interface SumUpHttpOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

export interface SumUpReader {
  id: string;
  name: string;
  status: string;
  model: string;
}

export interface SumUpTransaction {
  clientTransactionId: string;
  status: "SUCCESSFUL" | "CANCELLED" | "FAILED" | "PENDING" | "REFUNDED" | string;
  /** Major units, as SumUp reports it (10.1 = 10.10). */
  amount: number;
  currency: string;
  transactionCode: string | null;
}

/** ISO 4217 exponents that are not 2. HUF is 2 in ISO even though nobody uses the decimals. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XOF", "XAF"]);

export function sumUpMinorUnit(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

async function call<T>(creds: SumUpCredentials, path: string, init: RequestInit, http: SumUpHttpOptions): Promise<{ status: number; body: T | null }> {
  const doFetch = http.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${http.baseUrl ?? DEFAULT_BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw ActionError.validation("Could not reach SumUp. Check the connection and try again.");
  }
  const text = await response.text();
  let body: T | null = null;
  try {
    body = text ? (JSON.parse(text) as T) : null;
  } catch {
    body = null;
  }
  if (response.status === 401 || response.status === 403) {
    throw ActionError.validation("SumUp rejected the API key. Check it in Integrations.");
  }
  return { status: response.status, body };
}

/** SumUp reports the reason in an error code somewhere in the body; matching on the serialized body is the tolerant way to read it. */
function includesCode(body: unknown, code: string): boolean {
  return JSON.stringify(body ?? "").includes(code);
}

export async function pairReader(creds: SumUpCredentials, input: { pairingCode: string; name: string }, http: SumUpHttpOptions = {}): Promise<SumUpReader> {
  const { status, body } = await call<{ id?: string; name?: string; status?: string; device?: { model?: string } }>(
    creds,
    `/v0.1/merchants/${encodeURIComponent(creds.merchantCode)}/readers`,
    { method: "POST", body: JSON.stringify({ pairing_code: input.pairingCode.trim(), name: input.name.trim() }) },
    http,
  );
  if (status === 404) throw ActionError.validation("That pairing code wasn't found. Generate a new one on the reader (Connections → API → Connect) and try again.");
  if (status === 409) throw ActionError.validation("That reader is already paired.");
  if (status < 200 || status >= 300 || !body?.id) throw ActionError.validation("SumUp could not pair the reader.");
  return { id: body.id, name: body.name ?? input.name, status: body.status ?? "unknown", model: body.device?.model ?? "solo" };
}

export async function createReaderCheckout(
  creds: SumUpCredentials,
  readerId: string,
  input: { amount: number; currency: string; returnUrl: string | null; description?: string; foreignTransactionId?: string },
  http: SumUpHttpOptions = {},
): Promise<{ clientTransactionId: string }> {
  const minorUnit = sumUpMinorUnit(input.currency);
  const payload = {
    total_amount: { currency: input.currency.toUpperCase(), minor_unit: minorUnit, value: Math.round(input.amount * 10 ** minorUnit) },
    ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
    ...(input.description ? { description: input.description } : {}),
    affiliate: {
      app_id: creds.affiliateAppId,
      key: creds.affiliateKey,
      ...(input.foreignTransactionId ? { foreign_transaction_id: input.foreignTransactionId } : {}),
    },
  };
  const { status, body } = await call<{ data?: { client_transaction_id?: string } }>(
    creds,
    `/v0.1/merchants/${encodeURIComponent(creds.merchantCode)}/readers/${encodeURIComponent(readerId)}/checkout`,
    { method: "POST", body: JSON.stringify(payload) },
    http,
  );

  if (status === 404) throw ActionError.validation("That reader no longer exists in SumUp. Remove it and pair it again.");
  if (includesCode(body, "READER_BUSY")) throw ActionError.validation("The reader is busy with another payment. Wait a minute and try again.");
  if (includesCode(body, "READER_OFFLINE")) throw ActionError.validation("The reader is offline. Check its internet connection.");
  if (includesCode(body, "INVALID_AFFILIATE_KEY")) throw ActionError.validation("SumUp rejected the affiliate key. Check it in Integrations.");
  const id = body?.data?.client_transaction_id;
  if (status < 200 || status >= 300 || !id) throw ActionError.validation("SumUp could not start the payment on the reader.");
  return { clientTransactionId: id };
}

export async function terminateReaderCheckout(creds: SumUpCredentials, readerId: string, http: SumUpHttpOptions = {}): Promise<void> {
  await call(creds, `/v0.1/merchants/${encodeURIComponent(creds.merchantCode)}/readers/${encodeURIComponent(readerId)}/terminate`, { method: "POST" }, http);
}

/** Null when SumUp doesn't know the transaction (yet). */
export async function findTransaction(creds: SumUpCredentials, clientTransactionId: string, http: SumUpHttpOptions = {}): Promise<SumUpTransaction | null> {
  const { status, body } = await call<{ client_transaction_id?: string; status?: string; amount?: number; currency?: string; transaction_code?: string }>(
    creds,
    `/v2.1/merchants/${encodeURIComponent(creds.merchantCode)}/transactions?client_transaction_id=${encodeURIComponent(clientTransactionId)}`,
    { method: "GET" },
    http,
  );
  if (status === 404 || !body?.status) return null;
  return {
    clientTransactionId: body.client_transaction_id ?? clientTransactionId,
    status: body.status,
    amount: Number(body.amount ?? 0),
    currency: String(body.currency ?? ""),
    transactionCode: body.transaction_code ?? null,
  };
}
