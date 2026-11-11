import { V1HttpError } from "./response";

/** Body of a guest self-service call: the event and the guest's code (registration number or ID). */
export async function readGuestBody(request: Request): Promise<{ eventId: string; code: string; body: Record<string, unknown> }> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") throw new V1HttpError(400, "Invalid JSON body.");
  const eventId = String(body.eventId ?? "").trim();
  const code = String(body.code ?? "").trim();
  if (!eventId || !code) throw new V1HttpError(400, "eventId and code are required.");
  return { eventId, code, body };
}
