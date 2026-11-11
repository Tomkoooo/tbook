import { extensions, registerModule } from "@tbook/services";
import { FEEDBACK, personalFeedbackUrl } from "./service";

export * from "./service";
export * from "./model";

export function registerFeedbackModule(): void {
  registerModule({
    key: FEEDBACK,
    name: "Feedback",
    description:
      "Surveys guests fill in once (with their personal link, or their registration number / ID; answers stored anonymously) and kiosk ratings on a tablet at the venue.",
    scopes: ["org", "group", "event"],
  });

  extensions.registerAttendeePlaceholders({
    moduleKey: FEEDBACK,
    placeholders: [{ key: "feedbackUrl", label: "Feedback: the guest's personal survey link", sample: "https://tbook.example/feedback/…" }],
    async values(ctx, booking, attendeeIndex) {
      return { feedbackUrl: ctx.modules.isOn(FEEDBACK) ? await personalFeedbackUrl(booking, attendeeIndex) : "" };
    },
  });
}
