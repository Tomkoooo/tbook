import { backgroundJobsEnabled, startBackgroundJobs } from "./lib/background-jobs";

/** Node.js runtime only — called from instrumentation.ts. */
export async function startNodeInstrumentation(): Promise<void> {
  if (backgroundJobsEnabled(process.env)) await startBackgroundJobs();
}
