import { eventGroupRepository } from "@tbook/db";
import { extractApiKeyFromRequest, extractPreviewKeyFromRequest, hashApiKey, verifyPreviewKey } from "@tbook/services";
import { V1HttpError } from "./response";

/**
 * Resolves the event-group scope from the request's API key (public v1
 * routes). `preview` is true when the request also carries the group's
 * dev preview key in `X-TBook-Preview` (a wrong or missing key is simply
 * not preview mode).
 */
export async function requireApiKeyGroup(request: Request): Promise<{ groupId: string; preview: boolean }> {
  const key = extractApiKeyFromRequest(request);
  if (!key) {
    throw new V1HttpError(401, "Missing API key.");
  }
  const group = await eventGroupRepository.findByApiKeyHash(hashApiKey(key));
  if (!group || group.status !== "active") {
    throw new V1HttpError(401, "Invalid or revoked API key.");
  }
  return { groupId: String(group._id), preview: verifyPreviewKey(extractPreviewKeyFromRequest(request), group) };
}
