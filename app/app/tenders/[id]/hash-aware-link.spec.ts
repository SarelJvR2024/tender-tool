import { describe, it, expect } from "vitest";
import { isSamePageHash } from "./hash-aware-link";

// Regression coverage for the cross-tab anchor bug (QA finding, 2026-10-26,
// real tenders GG12700238 / N.007-030-2026/1F): "Change"/"Fix" hrefs
// (bid-task-status.ts, pack-review-data.ts, general-pack-review-data.ts)
// mix same-page hashes with real cross-page paths in the same field -
// HashAwareLink picks the right rendering for each, and this is the one
// decision that choice turns on.
describe("isSamePageHash", () => {
  it("is true for a bare same-page anchor", () => {
    expect(isSamePageHash("#tender-templates")).toBe(true);
    expect(isSamePageHash("#form-b7")).toBe(true);
    expect(isSamePageHash("#key-positions")).toBe(true);
  });

  it("is false for a cross-page path, with or without its own hash", () => {
    expect(isSamePageHash("/company")).toBe(false);
    expect(isSamePageHash("/company#bee-cidb")).toBe(false);
    expect(isSamePageHash("/experience")).toBe(false);
  });
});
