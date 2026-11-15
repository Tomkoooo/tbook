import { resumeInterruptedEventEmailSends } from "./service";

/** How often the resume job looks for interrupted manual sends. */
export const EMAIL_RESUME_INTERVAL_MS = 60 * 1000;

const SCHEDULER_KEY = Symbol.for("tbook.eventEmails.resumeScheduler");

interface SchedulerHandle {
  stop: () => void;
}

/**
 * Starts the in-process resume job: every `intervalMs` it continues the
 * manual sends whose runner died (see `resumeInterruptedEventEmailSends`;
 * the atomic claim makes it safe with several instances). Idempotent per
 * process (a dev reload doesn't start a second timer). `beforeRun` lets
 * the caller make sure the database is connected. Returns a stop function.
 */
export function startEventEmailResumeScheduler(opts: { intervalMs?: number; firstRunAfterMs?: number; beforeRun?: () => Promise<unknown> } = {}): () => void {
  const holder = globalThis as unknown as Record<symbol, SchedulerHandle | undefined>;
  const existing = holder[SCHEDULER_KEY];
  if (existing) return existing.stop;

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await opts.beforeRun?.();
      await resumeInterruptedEventEmailSends();
    } catch (error) {
      console.error("[tbook] event email resume job failed", error);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs ?? EMAIL_RESUME_INTERVAL_MS);
  const first = setTimeout(() => void tick(), opts.firstRunAfterMs ?? 15 * 1000);
  timer.unref?.();
  first.unref?.();
  const handle: SchedulerHandle = {
    stop: () => {
      clearInterval(timer);
      clearTimeout(first);
      if (holder[SCHEDULER_KEY] === handle) holder[SCHEDULER_KEY] = undefined;
    },
  };
  holder[SCHEDULER_KEY] = handle;
  return handle.stop;
}
