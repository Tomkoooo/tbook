import { feedback } from "@tbook/modules";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 — submits a guest's survey answers. POST { code | token, answers: { questionId: value } }.
 * `code` is the registration number or ID; `token` the `t` of a personal link.
 * Once per guest (409 "already_answered"); answers are stored without identity.
 * With the preview key: a draft event's survey, and test registrations
 * (their answers are stored as test answers, `test: true`, left out of results).
 */
export async function POST(request: Request, context: { params: Promise<{ surveyId: string }> }) {
  return runV1(request, async () => {
    const { groupId, preview } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:feedback", 20);
    const { surveyId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.answers !== "object" || body.answers === null) throw new V1HttpError(400, "answers is required.");
    return feedback.submitSurvey(
      surveyId,
      { code: typeof body.code === "string" ? body.code : undefined, token: typeof body.token === "string" ? body.token : undefined, answers: body.answers as Record<string, unknown> },
      "api",
      groupId,
      { preview },
    );
  });
}
