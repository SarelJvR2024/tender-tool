import { describe, expect, it } from "vitest";
import { changesForDoc, isCorrigendumCandidate, type WatchedDocRow } from "./corrigendumAlerts";

describe("changesForDoc - mapping tender_watched_documents.changes into TenderChange[]", () => {
  it("maps a closing_date change first", () => {
    const doc: WatchedDocRow = {
      id: "d1", kind: "addendum", title: "Addendum 1", summary: null,
      changes: { closing_date: { date: "2026-12-01", previous_on_file: "2026-11-15", quote: "closing moved" } },
    };
    expect(changesForDoc(doc)).toEqual([
      { kind: "closing_date", date: "2026-12-01", previousDate: "2026-11-15", quote: "closing moved" },
    ]);
  });

  it("maps a briefing change", () => {
    const doc: WatchedDocRow = {
      id: "d2", kind: "addendum", title: null, summary: null,
      changes: { briefing: { date: "2026-11-05", previous_date: null, quote: "new briefing date" } },
    };
    expect(changesForDoc(doc)).toEqual([
      { kind: "briefing", date: "2026-11-05", previousDate: null, quote: "new briefing date" },
    ]);
  });

  it("maps other_changes entries with a human label from the known kind vocabulary", () => {
    const doc: WatchedDocRow = {
      id: "d3", kind: "clarification", title: null, summary: null,
      changes: { other_changes: [{ kind: "clarification", quote: "Q&A response 1" }] },
    };
    expect(changesForDoc(doc)).toEqual([{ kind: "other", label: "Clarification issued", quote: "Q&A response 1" }]);
  });

  it("combines closing_date, briefing and other_changes in that order when all three are present", () => {
    const doc: WatchedDocRow = {
      id: "d4", kind: "addendum", title: null, summary: null,
      changes: {
        closing_date: { date: "2026-12-01", quote: "a" },
        briefing: { date: "2026-11-05", quote: "b" },
        other_changes: [{ kind: "cancellation", quote: "c" }],
      },
    };
    const result = changesForDoc(doc);
    expect(result.map((c) => c.kind)).toEqual(["closing_date", "briefing", "other"]);
  });

  it("falls back to the document's own kind/summary when there is no structured change at all", () => {
    const doc: WatchedDocRow = {
      id: "d5", kind: "supporting_document", title: "Site plan.pdf", summary: "A revised site plan",
      changes: {},
    };
    expect(changesForDoc(doc)).toEqual([{ kind: "other", label: "New supporting document", quote: "A revised site plan" }]);
  });

  it("falls back to the title when there is no summary either", () => {
    const doc: WatchedDocRow = { id: "d6", kind: null, title: "Unnamed file.pdf", summary: null, changes: null };
    expect(changesForDoc(doc)).toEqual([{ kind: "other", label: "New document", quote: "Unnamed file.pdf" }]);
  });
});

describe("isCorrigendumCandidate - submission-suppression", () => {
  it("excludes a terminal 'won' pipeline stage", () => {
    expect(isCorrigendumCandidate({ pipeline_stage: "won" })).toBe(false);
  });

  it("excludes a terminal 'lost' pipeline stage", () => {
    expect(isCorrigendumCandidate({ pipeline_stage: "lost" })).toBe(false);
  });

  it("keeps 'submitted' - an addendum before closing can still require a resubmission", () => {
    expect(isCorrigendumCandidate({ pipeline_stage: "submitted" })).toBe(true);
  });

  it("keeps 'found' and 'bidding'", () => {
    expect(isCorrigendumCandidate({ pipeline_stage: "found" })).toBe(true);
    expect(isCorrigendumCandidate({ pipeline_stage: "bidding" })).toBe(true);
  });

  it("keeps a null stage rather than excluding it by accident", () => {
    expect(isCorrigendumCandidate({ pipeline_stage: null })).toBe(true);
  });
});
