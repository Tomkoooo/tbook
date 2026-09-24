import nodemailer, { type Transporter } from "nodemailer";
import { organizationRepository, type IOrganization } from "@tbook/db";
import { decryptOrgSecret } from "./org-secrets";

/**
 * Minimal nodemailer-based sender. Legacy used a shared core MailerService
 * (not ported — out of scope). Same org-vs-platform-fallback shape already
 * established for Stripe (checkout-service.ts) and Számlázz.hu
 * (invoice-service.ts): an org can override SMTP entirely; otherwise the
 * platform env vars are used. Env var names match what's already wired in
 * portainer.stack.tbook.example.yml from Phase 0.
 */

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}

interface ResolvedSmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

function platformSmtpConfig(): ResolvedSmtpConfig | null {
  const host = process.env.EMAIL_HOST?.trim();
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASS?.trim();
  const fromEmail = process.env.EMAIL_FROM?.trim() || user;
  if (!host || !user || !pass || !fromEmail) return null;
  return {
    host,
    port: Number(process.env.EMAIL_PORT) || 465,
    user,
    pass,
    fromEmail,
    fromName: process.env.EMAIL_FROM_NAME?.trim() || "tBook",
  };
}

function orgSmtpConfig(org: IOrganization | null): ResolvedSmtpConfig | null {
  const smtp = org?.settings?.smtp;
  if (!smtp?.host || !smtp.user) return null;
  const pass = decryptOrgSecret(smtp.passEnc);
  if (!pass) return null;
  return {
    host: smtp.host,
    port: smtp.port || 465,
    user: smtp.user,
    pass,
    fromEmail: smtp.fromEmail || smtp.user,
    fromName: smtp.fromName || "tBook",
  };
}

export async function resolveSmtpConfig(organizationId: string | null | undefined): Promise<ResolvedSmtpConfig | null> {
  if (organizationId) {
    const org = await organizationRepository.findById(organizationId);
    const fromOrg = orgSmtpConfig(org);
    if (fromOrg) return fromOrg;
  }
  return platformSmtpConfig();
}

/** Minimal shape this module needs from a transporter — real nodemailer.Transporter satisfies it; tests inject a mock. */
export type MailTransporter = Pick<Transporter, "sendMail">;

function buildTransporter(config: ResolvedSmtpConfig): MailTransporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
}

/**
 * Sends an email via the resolved org-or-platform SMTP config. Pass
 * `transporter` in tests to avoid any real network/SMTP connection.
 */
export async function sendMail(organizationId: string | null | undefined, input: SendMailInput, transporter?: MailTransporter): Promise<void> {
  const config = await resolveSmtpConfig(organizationId);
  if (!config) throw new Error("No SMTP configuration available (neither organization nor platform).");

  const transport = transporter ?? buildTransporter(config);
  await transport.sendMail({
    from: `"${config.fromName}" <${config.fromEmail}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
  });
}
