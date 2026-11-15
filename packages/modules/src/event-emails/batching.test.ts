import { describe, expect, it } from "vitest";
import { isTemporaryMailError, sendBatchSettings, throttlePauseSeconds } from "./batching";

describe("sendBatchSettings", () => {
  it("defaults to 50 per batch and a 60 s pause", () => {
    expect(sendBatchSettings({})).toEqual({ batchSize: 50, batchPauseSeconds: 60 });
    expect(sendBatchSettings(null)).toEqual({ batchSize: 50, batchPauseSeconds: 60 });
    expect(sendBatchSettings({ sendBatchSize: "", sendBatchPauseSeconds: "abc" })).toEqual({ batchSize: 50, batchPauseSeconds: 60 });
  });

  it("reads console strings and numbers, clamped to sane bounds", () => {
    expect(sendBatchSettings({ sendBatchSize: " 20 ", sendBatchPauseSeconds: 90 })).toEqual({ batchSize: 20, batchPauseSeconds: 90 });
    expect(sendBatchSettings({ sendBatchSize: "0", sendBatchPauseSeconds: "-5" })).toEqual({ batchSize: 1, batchPauseSeconds: 0 });
    expect(sendBatchSettings({ sendBatchSize: "99999", sendBatchPauseSeconds: "99999" })).toEqual({ batchSize: 1000, batchPauseSeconds: 3600 });
  });
});

describe("throttlePauseSeconds", () => {
  it("doubles the batch pause per throttle in a row, at least 30 s, capped at 15 min", () => {
    expect(throttlePauseSeconds(60, 1)).toBe(120);
    expect(throttlePauseSeconds(60, 2)).toBe(240);
    expect(throttlePauseSeconds(0, 1)).toBe(60);
    expect(throttlePauseSeconds(60, 10)).toBe(900);
  });
});

describe("isTemporaryMailError", () => {
  it("treats SMTP 4xx replies and connection errors as temporary", () => {
    for (const responseCode of [421, 450, 451, 452]) expect(isTemporaryMailError(Object.assign(new Error("try later"), { responseCode }))).toBe(true);
    expect(isTemporaryMailError(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }))).toBe(true);
    expect(isTemporaryMailError(Object.assign(new Error("Greeting never received"), { code: "ECONNECTION" }))).toBe(true);
    expect(isTemporaryMailError(new Error("421 4.7.0 Too many connections, try again later"))).toBe(true);
  });

  it("treats 5xx replies and other errors as permanent", () => {
    expect(isTemporaryMailError(Object.assign(new Error("550 5.1.1 User unknown"), { responseCode: 550 }))).toBe(false);
    expect(isTemporaryMailError(Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 }))).toBe(false);
    expect(isTemporaryMailError(new Error("No SMTP configuration available"))).toBe(false);
    expect(isTemporaryMailError(null)).toBe(false);
  });
});
