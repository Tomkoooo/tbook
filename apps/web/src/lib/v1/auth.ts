import { eventGroupRepository } from "@tbook/db";
import { extractApiKeyFromRequest, hashApiKey } from "@tbook/services";
import { V1HttpError } from "./response";

/** Resolves the event-group scope from the request's API key (public v1 routes). */
export async function requireApiKeyGroup(request: Request): Promise<{ groupId: string }> {
  const key = extractApiKeyFromRequest(request);
  if (!key) {
    throw new V1HttpError(401, "Missing API key.");
  }
  const group = await eventGroupRepository.findByApiKeyHash(hashApiKey(key));
  if (!group || group.status !== "active") {
    throw new V1HttpError(401, "Invalid or revoked API key.");
  }
  return { groupId: String(group._id) };
}
