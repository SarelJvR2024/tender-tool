import { describe, expect, it } from "vitest";
import { idWarnings, isBlack, isValidSaId, needsPersonFallbackOption, resolveOwnershipBreakdown, type OwnershipBreakdown } from "./principals";

// Regression coverage for Finding 217 (2026-11-08): isValidSaId() used to
// check only the Luhn checksum, so a 13-digit number whose embedded date is
// impossible (every digit 0; month 13) still passed as "valid" - no warning
// from idWarnings(), and nothing stopping company/principals/actions.ts's
// own hard validation gate from saving it. The sibling that solves the same
// "is this really someone's SA ID number" question,
// engine/cv/extract_cv_fields.py's _plausible_sa_id(), already required a
// plausible month/day and a citizenship digit of 0 or 1 (hardened the same
// day for the exact calendar-date gap) - this brings isValidSaId() to the
// same three checks: Luhn, a real calendar date (either century), and a
// valid citizenship digit.
describe("isValidSaId", () => {
  // All four of the following are genuinely Luhn-valid (computed, not
  // guessed) - the bug this covers is specifically that Luhn-validity alone
  // used to be treated as "valid", regardless of the date/citizenship
  // digits it encodes.
  it("rejects a Luhn-valid number whose embedded date is impossible - every digit 0 (month 00)", () => {
    expect(isValidSaId("0000000000000")).toBe(false);
  });

  it("rejects a Luhn-valid number with an impossible month (13)", () => {
    expect(isValidSaId("0013000000003")).toBe(false);
  });

  it("rejects a Luhn-valid number with a real date but a citizenship digit that is neither 0 nor 1", () => {
    // YYMMDD=900101 (a real date), sequence 0000, citizenship digit 5 (invalid), Luhn-correct.
    expect(isValidSaId("9001010000585")).toBe(false);
  });

  it("accepts a Luhn-valid number with a real date and a valid (0) citizenship digit", () => {
    expect(isValidSaId("9001010000080")).toBe(true);
  });

  it("still rejects a number that isn't 13 digits, or fails the Luhn check", () => {
    expect(isValidSaId("123")).toBe(false);
    expect(isValidSaId("9001010000081")).toBe(false); // last digit changed, breaks Luhn
  });
});

// Standing review, 2026-11-09: idWarnings() already cross-checked gender and
// sa_citizen against parseSaId()'s own decoded output, but never
// date_of_birth - a free-typed field (company/principals/actions.ts), so a
// typo or wrong-record paste silently disagreed with the ID-encoded date
// with no warning, even though the function already calls parseSaId() and
// had `parsed.birth` sitting right there unused. "9001010000080" is a
// genuinely Luhn-valid SA ID (YYMMDD=900101, citizenship digit 0) that
// decodes to birth date "1990-01-01" (1990, not 2090 - the real date, since
// 2090 is in the future).
describe("idWarnings", () => {
  const VALID_ID = "9001010000080"; // decodes to 1990-01-01, SA citizen, female (sequence digits 0000 < 5000)

  it("flags a date_of_birth that disagrees with what the ID number encodes", () => {
    const warnings = idWarnings({ id_number: VALID_ID, gender: null, sa_citizen: null, date_of_birth: "1990-01-05" });
    expect(warnings).toContain("Date of birth recorded as 1990-01-05, but the ID number encodes 1990-01-01.");
  });

  it("does not flag a date_of_birth that matches the ID number", () => {
    const warnings = idWarnings({ id_number: VALID_ID, gender: null, sa_citizen: null, date_of_birth: "1990-01-01" });
    expect(warnings).toEqual([]);
  });

  it("does not flag anything when date_of_birth is not on file at all", () => {
    const warnings = idWarnings({ id_number: VALID_ID, gender: null, sa_citizen: null, date_of_birth: null });
    expect(warnings).toEqual([]);
  });

  it("still flags gender/sa_citizen mismatches too, same as before this check was added", () => {
    const warnings = idWarnings({ id_number: VALID_ID, gender: "male", sa_citizen: true, date_of_birth: null });
    expect(warnings).toContain("Gender recorded as male, but the ID number encodes female.");
    expect(warnings.some((w) => w.includes("permanent resident"))).toBe(false); // real SA citizen digit, sa_citizen=true agrees
  });

  it("flags nothing for an invalid id_number beyond the existing validity warning - no crash from parseSaId() on bad input", () => {
    const warnings = idWarnings({ id_number: "0000000000000", gender: null, sa_citizen: null, date_of_birth: "1990-01-01" });
    expect(warnings).toContain("ID number is not valid - check it against the ID document.");
    expect(warnings.some((w) => w.includes("Date of birth"))).toBe(false); // parsed.birth is null for this input, so no spurious mismatch
  });
});

// Regression coverage for the Directors & shareholders register data-loss
// bug (QA Finding 177, 2026-11-07): the "Also one of your people (CV)?"
// <select> in app/app/company/principals/page.tsx's PrincipalForm must keep
// an already-linked person selectable even when they are missing from the
// loaded `people` list - whether that's because the `people` read failed (a
// previously-discarded Supabase error on the calling page) or the person was
// since removed. Without this, the <select>'s defaultValue matches no
// <option>, the browser silently falls back to "No", and saving ANY other
// field on this form (position, ownership %, ...) resubmits person_id=""
// and wipes the real company_principals.person_id link -
// savePrincipal() (app/app/company/principals/actions.ts) always writes
// person_id straight from the submitted form field, on every edit save.
// Same shape as app/lib/dealEconomics.ts's needsCreditFallbackOption()
// (Finding 175).
describe("needsPersonFallbackOption", () => {
  it("is false when nobody is linked yet", () => {
    expect(needsPersonFallbackOption(null, [])).toBe(false);
    expect(needsPersonFallbackOption(null, [{ id: "p1" }])).toBe(false);
  });

  it("is false when the linked person is in the loaded list (the normal, happy path)", () => {
    expect(needsPersonFallbackOption("p1", [{ id: "p1" }, { id: "p2" }])).toBe(false);
  });

  it("is true when someone is linked but the people list came back empty - the discarded-read-error shape this finding fixes", () => {
    expect(needsPersonFallbackOption("p1", [])).toBe(true);
  });

  it("is true when someone is linked but isn't in an otherwise non-empty list (since removed)", () => {
    expect(needsPersonFallbackOption("p1", [{ id: "p2" }, { id: "p3" }])).toBe(true);
  });
});

// Regression coverage for Finding 194 (2026-11-07): `/company/principals/
// page.tsx` used to discard `company_ownership_breakdown`'s own read error
// entirely - a sibling in the same Promise.all whose own error WAS captured
// (`company_principals`), the same single-function error-capture divergence
// Finding 193 fixed for admin/customers. Because the view is a GROUP BY with
// no row for a company with zero qualifying shareholders, a genuinely-empty
// register and a FAILED read both land on `data: null` - indistinguishable
// without the error, and the page showed the exact same "No shareholdings
// recorded yet" either way, even directly above a list of principal cards
// that can themselves show a real non-zero "% of shares" for that company.
const breakdown: OwnershipBreakdown = {
  shareholders: 2,
  total_pct: 100,
  black_pct: 60,
  black_women_pct: 30,
  women_pct: 40,
  youth_pct: 0,
  black_youth_pct: 0,
  disabled_pct: 0,
  black_disabled_pct: 0,
  military_veteran_pct: 0,
  hdi_pct: 60,
  unclassified_pct: 0,
};

describe("resolveOwnershipBreakdown", () => {
  it("returns the row when the read succeeded with real shareholders (the normal, happy path)", () => {
    expect(resolveOwnershipBreakdown(breakdown, null)).toEqual({ kind: "ok", breakdown });
  });

  it("returns 'empty' when the read genuinely succeeded with no qualifying shareholders (no row, no error)", () => {
    expect(resolveOwnershipBreakdown(null, null)).toEqual({ kind: "empty" });
  });

  it("returns 'error' - not 'empty' - when the read failed, even though both produce the same null row: the discarded-read-error shape this finding fixes", () => {
    expect(resolveOwnershipBreakdown(null, { message: "connection reset" })).toEqual({ kind: "error" });
  });

  it("returns 'error' even if a failed read somehow still carried a stale/zero-shareholder row alongside its own error", () => {
    expect(resolveOwnershipBreakdown({ ...breakdown, shareholders: 0 }, { message: "timeout" })).toEqual({ kind: "error" });
  });
});

// Finding 320 (2026-11-10): isBlack() is this file's own definition of the
// B-BBEE Act's "black people" test - its own module comment above RACES
// spells it out as "African, Coloured and Indian South Africans" (plus
// Chinese South Africans) - but the function itself only ever checked
// `race`, never citizenship, even though migration 0050's own
// company_ownership_breakdown view computes the SAME classification as
// `race in (...) and coalesce(sa_citizen, true)` for every black_pct/
// black_women_pct/black_youth_pct/black_disabled_pct/hdi_pct column it
// derives from this register. A qualifying-race permanent resident (
// sa_citizen === false) was tagged "Black" on their own PrincipalCard while
// the ownership percentages shown directly above that same card correctly
// excluded their shares - the same "page keys off the wrong of two
// closely-related variables" shape as this track's other principals-page
// findings, just for a boolean pair instead of raw-vs-derived.
describe("isBlack", () => {
  it("is true for a qualifying race with sa_citizen left unset (matches the SQL view's own coalesce(sa_citizen, true))", () => {
    expect(isBlack("african", null)).toBe(true);
  });

  it("is true for a qualifying race when explicitly recorded as an SA citizen", () => {
    expect(isBlack("coloured", true)).toBe(true);
  });

  it("is false for a qualifying race when explicitly recorded as NOT an SA citizen - the gap this finding fixes", () => {
    expect(isBlack("indian", false)).toBe(false);
  });

  it("is false for a non-qualifying race regardless of citizenship", () => {
    expect(isBlack("white", true)).toBe(false);
  });

  it("is false with no race recorded at all", () => {
    expect(isBlack(null, null)).toBe(false);
  });
});
