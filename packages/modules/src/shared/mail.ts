import { eventRepository, type IEvent } from "@tbook/db";
import { resolveModules, sendMail, type MailTransporter } from "@tbook/services";

/**
 * Short transactional emails the modules send (bus waitlist notice,
 * cancellation confirmation): plain text with {{placeholders}} turned into
 * a small HTML message. Sent through the org's SMTP; tests inject a
 * transporter with setModuleMailTransporter.
 */

let transporterOverride: MailTransporter | undefined;
/** Test seam. */
export function setModuleMailTransporter(transporter: MailTransporter | undefined): void {
  transporterOverride = transporter;
}
export function moduleMailTransporter(): MailTransporter | undefined {
  return transporterOverride;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}

/** Text → HTML paragraph: escaped, line breaks kept, http(s) links clickable. */
export function textToHtml(text: string): string {
  const escaped = escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
  return `<p>${escaped.replace(/\n/g, "<br>")}</p>`;
}

/** The event website link from the event-emails module settings ({{siteUrl}}). */
export async function eventSiteUrl(event: IEvent): Promise<string> {
  const modules = await resolveModules({ organizationId: event.organizationId ? String(event.organizationId) : null, event });
  return modules.config<{ siteUrl?: string }>("event-emails").siteUrl ?? "";
}

/** `test`: about a test record — the subject gets "[TESZT] ". */
export async function sendModuleMail(event: IEvent | string, message: { to: string; subject: string; text: string; test?: boolean }, transporter?: MailTransporter): Promise<void> {
  const doc = typeof event === "string" ? await eventRepository.findById(event) : event;
  if (!doc || !message.to) return;
  await sendMail(
    doc.organizationId ? String(doc.organizationId) : null,
    { to: message.to, subject: message.subject, html: textToHtml(message.text), test: message.test },
    transporter ?? transporterOverride,
  );
}
