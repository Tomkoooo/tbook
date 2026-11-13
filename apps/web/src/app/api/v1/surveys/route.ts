import { feedback } from "@tbook/modules";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { runV1, V1HttpError } from "@/lib/v1/response";

/** v1 — an event's open surveys (module "feedback"): GET ?eventId=. Ratings are 1..ratingMax. A draft event's surveys only with the preview key. */
export async function GET(request: Request) {
  return runV1(request, async () => {
    const { groupId, preview } = await requireApiKeyGroup(request);
    const eventId = new URL(request.url).searchParams.get("eventId") ?? "";
    if (!eventId) throw new V1HttpError(400, "eventId is required.");
    return { surveys: await feedback.listPublicSurveys(eventId, groupId, { preview }) };
  });
}
