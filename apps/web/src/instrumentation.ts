/**
 * Next.js calls register() once when a server process starts. Background
 * jobs (today: continuing interrupted manual email sends) start here, only
 * in the Node.js runtime and never during `next build` or tests — see
 * backgroundJobsEnabled().
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { backgroundJobsEnabled, startBackgroundJobs } = await import("./lib/background-jobs");
  if (!backgroundJobsEnabled(process.env)) return;
  await startBackgroundJobs();
}
