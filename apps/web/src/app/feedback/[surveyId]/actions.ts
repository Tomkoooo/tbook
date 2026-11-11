"use server";

import "@/lib/register-modules";
import { ActionError } from "@tbook/actions";
import { ensureDbConnection } from "@tbook/db";
import { feedback } from "@tbook/modules";
import { allowPublicAction } from "@/lib/public-rate-limit";

export async function submitFeedbackAction(
  surveyId: string,
  token: string,
  code: string,
  answers: Record<string, string | number>,
): Promise<{ ok: boolean; message?: string }> {
  try {
    if (!(await allowPublicAction("feedback", 10))) return { ok: false, message: "Túl sok próbálkozás, várj egy percet." };
    await ensureDbConnection();
    await feedback.submitSurvey(surveyId, { token: token || undefined, code: code || undefined, answers });
    return { ok: true };
  } catch (error) {
    if (error instanceof ActionError) {
      const hu: Record<string, string> = {
        already_answered: "Ezt a kérdőívet már kitöltötted. Köszönjük!",
      };
      return { ok: false, message: hu[error.code ?? ""] ?? (/registration/i.test(error.message) ? "Nem találjuk a regisztrációd. Ellenőrizd a regisztrációs számot vagy a törzsszámot." : error.message) };
    }
    console.error("[feedback submit]", error);
    return { ok: false, message: "Valami hiba történt. Próbáld újra." };
  }
}
