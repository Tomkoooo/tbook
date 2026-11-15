/**
 * Whether this process runs background jobs. Off during `next build`
 * (NEXT_PHASE), in tests (VITEST / NODE_ENV=test) and with
 * TBOOK_BACKGROUND_JOBS=off; in `next dev` only with TBOOK_BACKGROUND_JOBS=on
 * (a laptop pointed at a shared database shouldn't pick up its sends).
 */
export function backgroundJobsEnabled(env: Record<string, string | undefined>): boolean {
  const flag = (env.TBOOK_BACKGROUND_JOBS ?? "").trim().toLowerCase();
  if (flag === "off" || flag === "0" || flag === "false") return false;
  if (env.NEXT_PHASE === "phase-production-build") return false;
  if (env.VITEST || env.NODE_ENV === "test") return false;
  if (env.NODE_ENV === "development") return flag === "on" || flag === "1" || flag === "true";
  if (!env.DATABASE_URL) return false;
  return true;
}

/** Starts the in-process jobs: the resume job for interrupted manual email sends (every 60 s). */
export async function startBackgroundJobs(): Promise<void> {
  const [{ ensureDbConnection }, { eventEmails }] = await Promise.all([import("@tbook/db"), import("@tbook/modules")]);
  eventEmails.startEventEmailResumeScheduler({ beforeRun: () => ensureDbConnection() });
  console.info("[tbook] background jobs started (event email resume)");
}
