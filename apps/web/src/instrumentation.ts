/**
 * Next.js calls register() once when a server process starts. Background
 * jobs (today: continuing interrupted manual email sends) start here, only
 * in the Node.js runtime and never during `next build` or tests — see
 * backgroundJobsEnabled().
 *
 * The Node-only work lives in instrumentation-node.ts behind a *positive*
 * NEXT_RUNTIME check: that form is what lets the bundler drop it from the
 * edge bundle (an early `return` for other runtimes is not recognised, and
 * the edge build then fails on Node built-ins such as `child_process`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNodeInstrumentation } = await import("./instrumentation-node");
    await startNodeInstrumentation();
  }
}
