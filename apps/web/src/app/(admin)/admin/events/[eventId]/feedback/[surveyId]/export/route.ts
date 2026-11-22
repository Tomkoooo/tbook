import { ActionError } from "@tbook/actions";
import { feedback } from "@tbook/modules";
import { requireOrgPermission } from "@/lib/admin-auth";

/** All answers of one survey as .xlsx (no guest identities are stored, so none are exported). */
export async function GET(_request: Request, context: { params: Promise<{ eventId: string; surveyId: string }> }) {
  try {
    const { organizationId } = await requireOrgPermission("feedback:manage");
    const { eventId, surveyId } = await context.params;
    // The survey must belong to the event in the path (and the org, which getSurveyForOrg checks).
    const survey = await feedback.getSurveyForOrg(organizationId, surveyId);
    if (String(survey.eventId) !== eventId) throw ActionError.notFound("Survey not found");
    const { fileName, buffer } = await feedback.exportSurveyXlsx(organizationId, surveyId);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ActionError) return new Response(error.message, { status: error.status });
    console.error("[feedback export]", error);
    return new Response("Could not build the export.", { status: 500 });
  }
}
