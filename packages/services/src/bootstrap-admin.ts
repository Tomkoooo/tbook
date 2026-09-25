import { userRepository } from "@tbook/db";

/**
 * Ported from the legacy plugin's lib/bootstrap-admin.ts, simplified: this
 * rewrite is multi-tenant-only (no legacy single-tenant `role: ADMIN` mode
 * to preserve), so this only ever sets `isSystemAdmin`.
 */
export const BOOTSTRAP_ADMIN_ENV = "BOOTSTRAP_ADMIN_EMAILS";
export const BOOTSTRAP_SYSTEM_ADMIN_ENV = "BOOTSTRAP_SYSTEM_ADMIN_EMAILS";

/** Parse a comma-, semicolon-, or newline-separated admin allowlist from env. */
export function parseBootstrapAdminEmails(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of value.split(/[,;\n]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

export function getBootstrapAdminEmails(): string[] {
  const system = parseBootstrapAdminEmails(process.env[BOOTSTRAP_SYSTEM_ADMIN_ENV]);
  if (system.length > 0) return system;
  return parseBootstrapAdminEmails(process.env[BOOTSTRAP_ADMIN_ENV]);
}

/** Promotes the signing-in user to isSystemAdmin when their email is on the bootstrap allowlist. */
export async function maybeBootstrapAdmin(email: string | undefined | null): Promise<void> {
  const allowlist = getBootstrapAdminEmails();
  if (allowlist.length === 0) return;
  const candidateEmail = (email || "").trim().toLowerCase();
  if (!candidateEmail || !allowlist.includes(candidateEmail)) return;

  const candidate = await userRepository.findByEmail(candidateEmail);
  if (!candidate || candidate.isSystemAdmin === true) return;

  await userRepository.setSystemAdmin(String(candidate._id), true);
  console.info(`[bootstrap-admin] Promoted '${candidateEmail}' to system admin via bootstrap allowlist.`);
}
