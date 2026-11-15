import { describe, expect, it } from "vitest";
import { backgroundJobsEnabled } from "./background-jobs";

describe("backgroundJobsEnabled", () => {
  const prod = { NODE_ENV: "production", DATABASE_URL: "mongodb://db/tbook" };

  it("runs in a production server", () => {
    expect(backgroundJobsEnabled(prod)).toBe(true);
  });

  it("never runs during next build or tests, or when switched off", () => {
    expect(backgroundJobsEnabled({ ...prod, NEXT_PHASE: "phase-production-build" })).toBe(false);
    expect(backgroundJobsEnabled({ ...prod, VITEST: "true" })).toBe(false);
    expect(backgroundJobsEnabled({ ...prod, NODE_ENV: "test" })).toBe(false);
    expect(backgroundJobsEnabled({ ...prod, TBOOK_BACKGROUND_JOBS: "off" })).toBe(false);
    expect(backgroundJobsEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("runs under next dev only when asked", () => {
    expect(backgroundJobsEnabled({ ...prod, NODE_ENV: "development" })).toBe(false);
    expect(backgroundJobsEnabled({ ...prod, NODE_ENV: "development", TBOOK_BACKGROUND_JOBS: "on" })).toBe(true);
  });
});
