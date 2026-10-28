/**
 * Coverage for the Tender Command Center's pure triage logic (dispatchTriage.ts).
 * Run: node --experimental-strip-types --test lib/dispatchTriage.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyDispatchBucket,
  departureDeadline,
  deriveDecisionNeeded,
  hoursUntilPrintSignDeadline,
  operationalStatusMessage,
  printSignDeadline,
  type ClassifyInput,
  type DispatchLogisticsInput,
} from "./dispatchTriage.ts";
import { daysUntil } from "./dates.ts";

const baseLogistics: DispatchLogisticsInput = {
  closingDate: "2026-11-01T11:00:00+02:00",
  submissionType: "physical_box",
  estimatedPrintHours: 4,
  estimatedTransitHours: 2,
  dispatchStatus: "not_ready",
};

test("printSignDeadline: closing minus print and transit hours, for a physical submission", () => {
  const d = printSignDeadline(baseLogistics);
  assert.ok(d);
  // 6 hours before 2026-11-01T11:00+02:00 = 2026-11-01T05:00+02:00
  assert.equal(d!.toISOString(), new Date("2026-11-01T05:00:00+02:00").toISOString());
});

test("printSignDeadline: null for a digital submission - no physical print/transit buffer", () => {
  assert.equal(printSignDeadline({ ...baseLogistics, submissionType: "etenders_portal" }), null);
});

test("printSignDeadline: null with no closing date", () => {
  assert.equal(printSignDeadline({ ...baseLogistics, closingDate: null }), null);
});

test("departureDeadline: closing minus transit only - the separate 'must leave by' step", () => {
  const d = departureDeadline(baseLogistics);
  assert.ok(d);
  // 2 hours before 2026-11-01T11:00+02:00 = 2026-11-01T09:00+02:00 - later
  // than printSignDeadline's 05:00, since no print/bind/sign buffer applies.
  assert.equal(d!.toISOString(), new Date("2026-11-01T09:00:00+02:00").toISOString());
});

test("departureDeadline: null for a digital submission, same as printSignDeadline", () => {
  assert.equal(departureDeadline({ ...baseLogistics, submissionType: "etenders_portal" }), null);
});

test("departureDeadline: null with no closing date", () => {
  assert.equal(departureDeadline({ ...baseLogistics, closingDate: null }), null);
});

test("hoursUntilPrintSignDeadline: positive before the cutoff, negative after", () => {
  const now = new Date("2026-11-01T03:00:00+02:00"); // 2h before the 05:00 cutoff
  assert.equal(hoursUntilPrintSignDeadline(baseLogistics, now), 2);
  const later = new Date("2026-11-01T06:00:00+02:00"); // 1h after
  assert.equal(hoursUntilPrintSignDeadline(baseLogistics, later), -1);
});

test("classifyDispatchBucket: critical once inside the 48h print-cutoff window and not yet dispatched", () => {
  const now = new Date("2026-10-30T10:00:00+02:00"); // 19h before the 2026-11-01T05:00 cutoff
  const input: ClassifyInput = { ...baseLogistics, pipelineStage: "bidding", decisionNeeded: "none" };
  assert.equal(classifyDispatchBucket(input, now), "critical");
});

test("classifyDispatchBucket: not critical once printed and bound, even past the cutoff", () => {
  const now = new Date("2026-11-01T06:00:00+02:00"); // after the cutoff
  const input: ClassifyInput = { ...baseLogistics, dispatchStatus: "printed_and_bound", pipelineStage: "bidding", decisionNeeded: "none" };
  // Falls through to "in_progress" (closing date itself is within 7 days) or "decision" - either way, never "critical" once dispatched.
  assert.notEqual(classifyDispatchBucket(input, now), "critical");
});

test("classifyDispatchBucket: decision bucket when a real decision is needed and not yet critical", () => {
  const now = new Date("2026-10-20T10:00:00+02:00"); // well outside the 48h print window
  const input: ClassifyInput = { ...baseLogistics, pipelineStage: "bidding", decisionNeeded: "attend_briefing" };
  assert.equal(classifyDispatchBucket(input, now), "decision");
});

test("classifyDispatchBucket: in_progress when closing within 7 days but nothing more urgent", () => {
  const now = new Date("2026-10-27T10:00:00+02:00"); // ~5 days before closing, well before the print cutoff too
  const input: ClassifyInput = { ...baseLogistics, pipelineStage: "bidding", decisionNeeded: "none" };
  assert.equal(classifyDispatchBucket(input, now), "in_progress");
});

test("classifyDispatchBucket: radar when closing is more than 7 days away and nothing else fires", () => {
  const now = new Date("2026-10-01T10:00:00+02:00");
  const input: ClassifyInput = { ...baseLogistics, pipelineStage: "bidding", decisionNeeded: "none" };
  assert.equal(classifyDispatchBucket(input, now), "radar");
});

test("classifyDispatchBucket: the 7-day boundary agrees with lib/dates.ts's own daysUntil() - no second, disagreeing day count", () => {
  // Real drift found 2026-10-28: this file used to compute "days to close"
  // inline from the raw now-vs-target instant, while every card's own
  // displayed DeadlineChip uses dates.ts's daysUntil() (midnight-normalized).
  // A tender closing 2026-11-04T09:00+02:00, viewed this afternoon, landed in
  // the "in_progress" (Urgent Actions) lane via the inline math (7 days) while
  // its own chip read daysUntil()'s 8 days left - the lane said urgent, the
  // number on the same card said otherwise. Pinning that the two now agree.
  const now = new Date("2026-10-28T15:00:00+02:00");
  const closingDate = "2026-11-04T09:00:00+02:00";
  const input: ClassifyInput = { ...baseLogistics, closingDate, pipelineStage: "bidding", decisionNeeded: "none" };
  assert.equal(daysUntil(closingDate, now), 8);
  assert.equal(classifyDispatchBucket(input, now), "radar"); // 8 days > 7, same boundary daysUntil() itself uses
});

test("classifyDispatchBucket: null once the tender is submitted, won or lost - not triaged at all", () => {
  const now = new Date("2026-10-30T10:00:00+02:00");
  for (const stage of ["submitted", "won", "lost"] as const) {
    const input: ClassifyInput = { ...baseLogistics, pipelineStage: stage, decisionNeeded: "none" };
    assert.equal(classifyDispatchBucket(input, now), null);
  }
});

test("classifyDispatchBucket: a digital submission closing within 48h is critical too, via the closing date itself", () => {
  const now = new Date("2026-10-31T10:00:00+02:00"); // 25h before the 2026-11-01T11:00 closing
  const input: ClassifyInput = { ...baseLogistics, submissionType: "etenders_portal", pipelineStage: "bidding", decisionNeeded: "none" };
  assert.equal(classifyDispatchBucket(input, now), "critical");
});

test("deriveDecisionNeeded: attend_briefing for a future briefing not yet marked done", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const result = deriveDecisionNeeded(
    { briefingDate: "2026-10-28T11:00:00Z", briefingTaskStatus: "not_started", hasRealFixBlocker: false, closingDate: null },
    now,
  );
  assert.equal(result, "attend_briefing");
});

test("deriveDecisionNeeded: none once the briefing task is marked done", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const result = deriveDecisionNeeded(
    { briefingDate: "2026-10-28T11:00:00Z", briefingTaskStatus: "done", hasRealFixBlocker: false, closingDate: null },
    now,
  );
  assert.equal(result, "none");
});

test("deriveDecisionNeeded: director_resolution for a real Fix blocker within 7 days of closing", () => {
  const now = new Date("2026-10-25T00:00:00Z");
  const result = deriveDecisionNeeded(
    { briefingDate: null, briefingTaskStatus: null, hasRealFixBlocker: true, closingDate: "2026-10-30T11:00:00Z" },
    now,
  );
  assert.equal(result, "director_resolution");
});

test("deriveDecisionNeeded: a real Fix blocker more than 7 days out is not yet a decision - still just in-progress work", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const result = deriveDecisionNeeded(
    { briefingDate: null, briefingTaskStatus: null, hasRealFixBlocker: true, closingDate: "2026-10-30T11:00:00Z" },
    now,
  );
  assert.equal(result, "none");
});

test("deriveDecisionNeeded: a past briefing date never fires attend_briefing - it already happened", () => {
  const now = new Date("2026-10-29T00:00:00Z");
  const result = deriveDecisionNeeded(
    { briefingDate: "2026-10-20T11:00:00Z", briefingTaskStatus: "not_started", hasRealFixBlocker: false, closingDate: null },
    now,
  );
  assert.equal(result, "none");
});

test("operationalStatusMessage: CRITICAL wording with the real blocking summary inside the 48h window", () => {
  const now = new Date("2026-10-30T10:00:00+02:00"); // 43h before the 2026-11-01T05:00 cutoff
  const msg = operationalStatusMessage(baseLogistics, "2 returnables are missing.", now);
  assert.equal(msg, "CRITICAL: you have 43 hours until the print cutoff. 2 returnables are missing.");
});

test("operationalStatusMessage: PRINT OVERDUE once the cutoff has passed", () => {
  const now = new Date("2026-11-01T06:00:00+02:00");
  const msg = operationalStatusMessage(baseLogistics, null, now);
  assert.equal(msg, "PRINT OVERDUE - the print & sign cutoff has already passed for a physical submission.");
});

test("operationalStatusMessage: falls back to the blocking summary alone outside the critical window", () => {
  const now = new Date("2026-10-01T10:00:00+02:00");
  const msg = operationalStatusMessage(baseLogistics, "Ready for pricing.", now);
  assert.equal(msg, "Ready for pricing.");
});

test("operationalStatusMessage: null when nothing urgent and nothing blocking - an honest empty state, not a fabricated reassurance", () => {
  const now = new Date("2026-10-01T10:00:00+02:00");
  const msg = operationalStatusMessage(baseLogistics, null, now);
  assert.equal(msg, null);
});
