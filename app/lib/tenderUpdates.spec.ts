import { describe, expect, it } from "vitest";
import { closingDisagreementReason, closingNeedsDecision, type ClosingDateChange } from "./tenderUpdates";

// QA finding, 2026-11-09: closingNeedsDecision() is true both when the
// buyer's own listing genuinely disagrees with the document AND when there
// is simply no closing date on file yet to compare a direction against
// (direction: "unknown") - a real, reachable state (app/app/tenders/new/
// actions.ts lets closingDate stay blank regardless of ocid; engine/discovery/
// tender_updates.py's classify_document() genuinely returns direction:
// "unknown" with listing_agrees: true in that case, confirmed live against
// the real classify_document() - see this finding's own write-up in
// docs/specs/QA-Edge-Case-Findings.md). closingDisagreementReason() must
// never claim "the buyer's own listing doesn't show this date" when the
// listing genuinely does (c.listing_agrees), since the same card's own
// "The buyer's eTenders listing shows" row would show that exact date right
// next to this text, directly contradicting it.
function cd(overrides: Partial<ClosingDateChange>): ClosingDateChange {
  return {
    date: "2026-11-06",
    time: "11:00",
    quote: "CLOSING DATE IS EXTENDED TO FRIDAY 06 NOVEMBER 2026 AT 11:00 AM",
    previous_on_file: null,
    previous_in_document: null,
    direction: "unknown",
    listing_date: null,
    listing_agrees: false,
    applied: false,
    ...overrides,
  };
}

describe("closingDisagreementReason", () => {
  it("never claims the listing disagrees when listing_agrees is true (direction: unknown, no date on file yet)", () => {
    const c = cd({ direction: "unknown", listing_date: "2026-11-06", listing_agrees: true, applied: false });
    expect(closingNeedsDecision(c)).toBe(true); // still needs a decision - no date on file to confirm a direction
    const reason = closingDisagreementReason(c);
    expect(reason).not.toMatch(/doesn't show this date/);
    expect(reason).toMatch(/already shows this same date/);
  });

  it("keeps the real 'listing disagrees' wording when the listing genuinely shows a different date", () => {
    const c = cd({ direction: "unknown", listing_date: "2026-11-20", listing_agrees: false, applied: false });
    expect(closingNeedsDecision(c)).toBe(true);
    expect(closingDisagreementReason(c)).toBe("the buyer's own listing doesn't show this date");
  });

  it("keeps the real 'listing disagrees' wording when the listing has no date at all", () => {
    const c = cd({ direction: "later", listing_date: null, listing_agrees: false, applied: false });
    expect(closingNeedsDecision(c)).toBe(true);
    expect(closingDisagreementReason(c)).toBe("the buyer's own listing doesn't show this date");
  });
});
