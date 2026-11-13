import { eventGroupRepository } from "@tbook/db";
import { extractApiKeyFromRequest, extractPreviewKeyFromRequest, hashApiKey, requestAsksForTestMode, verifyPreviewKey } from "@tbook/services";
import { V1HttpError } from "./response";

/**
 * Resolves the event-group scope from the request's API key (public v1
 * routes). `preview` is true when the request also carries the group's
 * dev preview key in `X-TBook-Preview` (a wrong or missing key is simply
 * not preview mode). `test` is true when, on top of a valid preview key,
 * the request sends `X-TBook-Test: 1` (test bookings: really saved and
 * emailed, kept apart from live data); without the preview key the header
 * is ignored.
 */
export async function requireApiKeyGroup(request: Request): Promise<{ groupId: string; preview: boolean; test: boolean }> {
  const key = extractApiKeyFromRequest(request);
  if (!key) {
    throw new V1HttpError(401, "Missing API key.");
  }
  const group = await eventGroupRepository.findByApiKeyHash(hashApiKey(key));
  if (!group || group.status !== "active") {
    throw new V1HttpError(401, "Invalid or revoked API key.");
  }
  const preview = verifyPreviewKey(extractPreviewKeyFromRequest(request), group);
  return { groupId: String(group._id), preview, test: preview && requestAsksForTestMode(request) };
}
