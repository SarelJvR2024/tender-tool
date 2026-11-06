import { describe, it, expect } from "vitest";
import { tooOld } from "./properties";

// Standing review, 2026-11-06: tooOld() is the Company Properties page's own
// "this document is past the tender rule's own age limit" check
// (pest_control_certificate/sapoa_grading, both maxAgeMonths: 12), feeding a
// warning shown directly to the user before they submit a lease tender. It
// used to count months forward with a bare `date.setMonth(date.getMonth() +
// n)` - correct on an ordinary day, but a certificate issued on a leap day
// (Feb 29) with a 12-month window silently rolled over to March 1 of the
// following (non-leap) year instead of landing on Feb 28, so the document
// read as still valid one extra day past the real cutoff. Same underlying
// JS Date "month overflow" bug as lib/payfast.ts's nextPeriodEnd(), found in
// the same pass.
describe("tooOld", () => {
  it("a leap-day-issued certificate is correctly flagged too old the day after its real Feb 28 anniversary", () => {
    const doc = { document_type: "sapoa_grading", issued_on: "2024-02-29" };
    const today = new Date("2025-03-01T00:00:00.000Z"); // 1 year + 1 day after the real anniversary
    expect(tooOld(doc, today)).toBe(
      "Older than 12 months - NW won't accept it; get a new one.",
    );
  });

  it("a leap-day-issued certificate is not yet too old exactly on its real Feb 28 anniversary", () => {
    const doc = { document_type: "sapoa_grading", issued_on: "2024-02-29" };
    const today = new Date("2025-02-28T00:00:00.000Z");
    expect(tooOld(doc, today)).toBeNull();
  });

  it("an ordinary issue date (no day-of-month overflow) is unaffected", () => {
    const doc = { document_type: "pest_control_certificate", issued_on: "2025-06-15" };
    expect(tooOld(doc, new Date("2026-06-16T00:00:00.000Z"))).toBe(
      "Older than 12 months - LA won't accept it; get a new one.",
    );
    expect(tooOld(doc, new Date("2026-06-14T00:00:00.000Z"))).toBeNull();
  });

  it("a document type with no age limit is never flagged", () => {
    const doc = { document_type: "title_deed", issued_on: "2000-01-01" };
    expect(tooOld(doc, new Date())).toBeNull();
  });

  it("no issue date on file is unknown, not a wrong confident answer", () => {
    const doc = { document_type: "sapoa_grading", issued_on: null };
    expect(tooOld(doc, new Date())).toBeNull();
  });
});
