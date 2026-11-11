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
    // QA pass, 2026-11-11 (Finding 415): this used to use kind: "clarification"
    // here - a DOCUMENT-level kind (DOC_KIND_LABEL) that find_other_changes()
    // can never actually produce for an other_changes entry (see the test
    // just below for the real, line-level vocabulary) - which happened to
    // still resolve a label by coincidence and so masked the real lookup-
    // table mismatch. "wording_replaced" is a real OTHER_CHANGE_RES kind.
    const doc: WatchedDocRow = {
      id: "d3", kind: "addendum", title: null, summary: null,
      changes: { other_changes: [{ kind: "wording_replaced", quote: "Q&A response 1" }] },
    };
    expect(changesForDoc(doc)).toEqual([{ kind: "other", label: "Wording replaced", quote: "Q&A response 1" }]);
  });

  // QA pass, 2026-11-11 (Finding 415): `other_changes[].kind` is NEVER one of
  // DOC_KIND_LABEL's own keys (addendum/clarification/cancellation/
  // revised_document/supporting_document - the DOCUMENT-level classification,
  // engine/discovery/tender_updates.py's classify_document()'s own `kind`).
  // It is a totally separate, line-level vocabulary from that same file's
  // find_other_changes()/OTHER_CHANGE_RES: scope, requirement_removed,
  // wording_replaced, pricing, evaluation, cidb, validity. The test just
  // above (and the "combines ... in that order" test below, which uses
  // kind: "cancellation") used a value from the WRONG vocabulary by mistake,
  // which happened to collide with a real DOC_KIND_LABEL key and so passed -
  // masking that every REAL other_changes entry (none of which can ever be
  // "clarification" or "cancellation") always misses that lookup and silently
  // falls back to the generic "Change noted", discarding the specific signal
  // (scope/pricing/evaluation/CIDB/validity) this exact regex detection work
  // exists to produce, in the real email sent to companies by
  // scripts/send-corrigendum-alerts.ts (scheduled every 2h, 07:00-19:00 SAST
  // weekdays). Confirmed directly against tender_updates.py's own
  // OTHER_CHANGE_RES list - these 7 are the only kind values find_other_changes()
  // can ever produce.
  it("maps a REAL other_changes kind (from tender_updates.py's own OTHER_CHANGE_RES, not the document-level vocabulary) to its own specific label, not the generic fallback", () => {
    const doc: WatchedDocRow = {
      id: "d3b", kind: "addendum", title: null, summary: null,
      changes: {
        other_changes: [
          { kind: "scope", quote: "The scope of works is amended as follows" },
          { kind: "requirement_removed", quote: "Clause 4.2 is hereby deleted" },
          { kind: "wording_replaced", quote: "Clause 3.1 shall now read ..." },
          { kind: "pricing", quote: "The Bill of Quantities is revised, see attached" },
          { kind: "evaluation", quote: "The functionality criteria are amended" },
          { kind: "cidb", quote: "The CIDB grading is corrected to 7CE" },
          { kind: "validity", quote: "The tender validity period is extended" },
        ],
      },
    };
    expect(changesForDoc(doc).map((c) => (c.kind === "other" ? c.label : c.kind))).toEqual([
      "Scope of work amended",
      "Requirement removed",
      "Wording replaced",
      "Pricing / BOQ amended",
      "Evaluation criteria changed",
      "CIDB grading changed",
      "Bid validity extended",
    ]);
  });

  it("combines closing_date, briefing and other_changes in that order when all three are present", () => {
    const doc: WatchedDocRow = {
      id: "d4", kind: "addendum", title: null, summary: null,
      changes: {
        closing_date: { date: "2026-12-01", quote: "a" },
        briefing: { date: "2026-11-05", quote: "b" },
        other_changes: [{ kind: "scope", quote: "c" }],
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

  it("keeps 'briefing_shortlisted' - the one stage that only ever follows 'submitted', same reasoning", () => {
    expect(isCorrigendumCandidate({ pipeline_stage: "briefing_shortlisted" })).toBe(true);
  });

  // QA pass, 2026-11-08: this used to test 'found' and 'bidding' - 'bidding'
  // is a RETIRED stage value (migration 0105 widened the 5-value enum to 7
  // and backfilled every 'bidding' row into 'assessing'/'building'; no real
  // row can hold 'bidding' any more). Replaced with the real, current
  // intermediate stages, so this test exercises the actual data shape the
  // function sees in production, not a value it can no longer receive.
  it("keeps every real, current intermediate stage ('found', 'assessing', 'building')", () => {
    expect(isCorrigendumCandidate({ pipeline_stage: "found" })).toBe(true);
    expect(isCorrigendumCandidate({ pipeline_stage: "assessing" })).toBe(true);
    expect(isCorrigendumCandidate({ pipeline_stage: "building" })).toBe(true);
  });

  it("keeps a null stage rather than excluding it by accident", () => {
    expect(isCorrigendumCandidate({ pipeline_stage: null })).toBe(true);
  });
});
