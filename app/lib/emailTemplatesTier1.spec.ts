import { describe, expect, it } from "vitest";
import { corrigendumAlertEmail } from "./emailTemplatesTier1";

// Finding 446: corrigendumAlerts.ts's changesForDoc() now produces a
// { kind: "briefing", date: null, cancelled: true, ... } TenderChange for a
// buyer addendum that cancels (or makes non-compulsory) a briefing session -
// a real sentinel, not "no briefing information at all". This file's own
// row-mapping used to assume every "briefing"/"closing_date" TenderChange
// carries a real date string (new Date(c.date), escapeHtml(formatDate(c.date)
// ?? c.date)) - escapeHtml() calls `.replace()` directly on its argument with
// no null guard, so rendering a cancelled briefing's `date: null` would throw
// a real TypeError (`Cannot read properties of null (reading 'replace')`),
// not just render wrong. No test exercised this shape at all before this
// fix (no app/lib/emailTemplatesTier1.spec.ts existed).
describe("corrigendumAlertEmail - briefing cancellation (Finding 446)", () => {
  const base = {
    reference: "SANRAL/N3/01", tenderTitle: "N3 upgrade", buyerShortName: "SANRAL",
    companyName: "Acme Civils", appUrl: "https://app.example", tenderId: "t1",
  };

  it("renders a cancelled briefing without throwing, with a clear 'cancelled' message - not a date", () => {
    const email = corrigendumAlertEmail({
      ...base,
      changes: [{ kind: "briefing", date: null, previousDate: null, quote: "the compulsory briefing is hereby cancelled", cancelled: true }],
    });
    expect(email.html).toContain("Cancelled or no longer compulsory");
    expect(email.text).toContain("Cancelled or no longer compulsory");
    // Never a raw "null" or an "Invalid Date" leaking into the real email.
    expect(email.html).not.toMatch(/null/i);
    expect(email.html).not.toMatch(/invalid date/i);
  });

  it("renders a cancelled briefing alongside a real closing_date change in the same addendum, without losing either fact", () => {
    const email = corrigendumAlertEmail({
      ...base,
      changes: [
        { kind: "closing_date", date: "2026-12-01", previousDate: "2026-11-15", quote: "closing moved" },
        { kind: "briefing", date: null, previousDate: null, quote: "briefing cancelled", cancelled: true },
      ],
    });
    expect(email.text).toContain("Closing date");
    expect(email.text).toContain("Briefing date: Cancelled or no longer compulsory");
  });
});
