import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { complianceDigestCandidatesForCompany, complianceDigestIdempotencyKey, thresholdFor, COMPLIANCE_DIGEST_THRESHOLDS } from "./complianceDigestCandidates";
import { SARS_PIN_RISK_NOTE } from "./emailTemplatesTier2";

// Frozen, unambiguous instant - safely mid-day in both UTC and SAST (SAST =
// UTC+2), nowhere near either timezone's own midnight - and not the ambient
// wall clock. Previously this file's daysFromNow() built its "N days from
// today" fixture off the real host clock's own UTC calendar day while
// complianceDigestCandidatesForCompany()'s underlying daysUntil() computes
// "today" as the real SAST calendar day; those two disagree by exactly one
// day during the real 00:00-02:00 SAST window on a host with no TZ env set
// (every CI runner and this sandbox), making these tests genuinely flaky at
// that hour regardless of any code change. Freezing the clock (fixture
// construction AND the function-under-test's own ambient `new Date()` call)
// to one instant where UTC-today and SAST-today are the same calendar day
// makes the day-count unambiguous at any real wall-clock time.
const FROZEN_NOW = new Date("2026-06-15T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function daysFromNow(days: number): string {
  const d = new Date(FROZEN_NOW);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A minimal Supabase client stub - just enough chaining for this file's own query shapes (.from().select()...eq()...maybeSingle()/not()...). Every chain method returns the SAME object (`self`), which is itself thenable, so both call shapes work: awaiting the chain directly (held_registrations/registration_types/people) and calling .maybeSingle() on it (companies). */
function stubSupabase(opts: { company: Record<string, unknown> | null; held: Record<string, unknown>[]; types: Record<string, unknown>[]; people: Record<string, unknown>[] }) {
  const rowsByTable: Record<string, unknown[]> = { held_registrations: opts.held, registration_types: opts.types, people: opts.people };
  return {
    from(table: string) {
      const self: Record<string, unknown> = {
        select: () => self,
        eq: () => self,
        not: () => self,
        maybeSingle: async () => ({ data: table === "companies" ? opts.company : null }),
        then: (resolve: (v: { data: unknown }) => void) => resolve({ data: rowsByTable[table] ?? [] }),
      };
      return self;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("thresholdFor", () => {
  it("matches exactly on each threshold day", () => {
    expect(thresholdFor(30)).toBe(30);
    expect(thresholdFor(14)).toBe(14);
    expect(thresholdFor(7)).toBe(7);
  });

  // Finding 476 (standing QA/robustness review, 2026-11-14): same bug class
  // and same fix shape as clarificationThresholdFor() (Finding 401) and
  // trialDay7Candidates() (Finding 387) - a missed/late daily cron run can
  // still catch up on a later day instead of permanently losing a
  // bid-disqualifying compliance-expiry reminder.
  it("still matches the 30-day threshold on a catch-up day between the two windows", () => {
    expect(thresholdFor(29)).toBe(30);
    expect(thresholdFor(20)).toBe(30);
    expect(thresholdFor(15)).toBe(30);
  });

  it("still matches the 14-day threshold on a catch-up day between the two windows", () => {
    expect(thresholdFor(13)).toBe(14);
    expect(thresholdFor(10)).toBe(14);
    expect(thresholdFor(8)).toBe(14);
  });

  it("still matches the 7-day threshold on a catch-up day below it", () => {
    expect(thresholdFor(6)).toBe(7);
    expect(thresholdFor(1)).toBe(7);
  });

  it("never matches outside any window", () => {
    expect(thresholdFor(31)).toBeNull();
    expect(thresholdFor(0)).toBeNull();
    expect(thresholdFor(-1)).toBeNull();
  });
});

describe("complianceDigestCandidatesForCompany", () => {
  it("fires a company field expiry exactly at the 14-day threshold", async () => {
    const supabase = stubSupabase({
      company: { id: "co1", legal_name: "Acme", sars_tcs_pin_expiry: daysFromNow(14), coid_letter_of_good_standing_expiry: null, cidb_expiry: null, pi_insurance_expiry: null, iso_9001_expiry: null, bank_confirmation_letter_valid_until: null, bee_proof_expiry: null },
      held: [], types: [], people: [],
    });
    const candidates = await complianceDigestCandidatesForCompany(supabase, "co1");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].itemKey).toBe("company:sars_tcs_pin_expiry");
    expect(candidates[0].threshold).toBe(14);
    expect(candidates[0].item.riskNote).toBe(SARS_PIN_RISK_NOTE);
  });

  it("does not fire a field more than 30 days out - too early for any threshold yet", async () => {
    const supabase = stubSupabase({
      company: { id: "co1", legal_name: "Acme", sars_tcs_pin_expiry: daysFromNow(31), coid_letter_of_good_standing_expiry: null, cidb_expiry: null, pi_insurance_expiry: null, iso_9001_expiry: null, bank_confirmation_letter_valid_until: null, bee_proof_expiry: null },
      held: [], types: [], people: [],
    });
    expect(await complianceDigestCandidatesForCompany(supabase, "co1")).toHaveLength(0);
  });

  // Finding 476 (standing QA/robustness review, 2026-11-14): day 20 is NOT
  // exactly on the 30/14/7-day boundary, but a missed/late cron run that
  // first reaches this item on day 20 (inside the 30-day threshold's own
  // catch-up window, 15..30) must still catch it, not permanently lose it.
  it("fires a company field expiry on a catch-up day, same as a missed cron run self-healing on the next one", async () => {
    const supabase = stubSupabase({
      company: { id: "co1", legal_name: "Acme", sars_tcs_pin_expiry: daysFromNow(20), coid_letter_of_good_standing_expiry: null, cidb_expiry: null, pi_insurance_expiry: null, iso_9001_expiry: null, bank_confirmation_letter_valid_until: null, bee_proof_expiry: null },
      held: [], types: [], people: [],
    });
    const candidates = await complianceDigestCandidatesForCompany(supabase, "co1");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].threshold).toBe(30);
  });

  it("fires a held registration at the 30-day threshold with the registration type's own label", async () => {
    const supabase = stubSupabase({
      company: { id: "co1", legal_name: "Acme" },
      held: [{ id: "h1", expiry_date: daysFromNow(30), registration_type_id: "t1" }],
      types: [{ id: "t1", label: "CIDB Grade 6GB" }],
      people: [],
    });
    const candidates = await complianceDigestCandidatesForCompany(supabase, "co1");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].item.label).toBe("CIDB Grade 6GB");
    expect(candidates[0].threshold).toBe(30);
  });

  it("fires both ECSA and SACPCMP for one person independently at the 7-day threshold", async () => {
    const supabase = stubSupabase({
      company: { id: "co1", legal_name: "Acme" },
      held: [], types: [],
      people: [{ id: "p1", name: "Jane Doe", ecsa_expiry: daysFromNow(7), sacpcmp_expiry: daysFromNow(7) }],
    });
    const candidates = await complianceDigestCandidatesForCompany(supabase, "co1");
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.item.label).sort()).toEqual(["ECSA registration - Jane Doe", "SACPCMP registration - Jane Doe"]);
  });

  // Finding 294 (2026-11-09): this file's own person loop used to hardcode
  // only ecsa_expiry/sacpcmp_expiry - SACNASP/SAGC were silently never
  // candidates for the compliance digest email, even though
  // lib/personCredentials.ts (the People page's own chip) and
  // engine/compliance/watch_deadlines.py (the separate email reminder
  // script) have covered all four bodies since a9a5364, 10 days before
  // this file was written.
  it("fires for SACNASP and SAGC too, not just ECSA/SACPCMP", async () => {
    const supabase = stubSupabase({
      company: { id: "co1", legal_name: "Acme" },
      held: [], types: [],
      people: [{ id: "p1", name: "Jane Doe", sacnasp_expiry: daysFromNow(7), sagc_expiry: daysFromNow(7) }],
    });
    const candidates = await complianceDigestCandidatesForCompany(supabase, "co1");
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.item.label).sort()).toEqual(["SACNASP registration - Jane Doe", "SAGC registration - Jane Doe"]);
  });

  it("every configured threshold is reachable", () => {
    expect(COMPLIANCE_DIGEST_THRESHOLDS).toEqual([30, 14, 7]);
  });
});

describe("complianceDigestIdempotencyKey", () => {
  it("is stable for the same (company, item, threshold)", () => {
    const a = complianceDigestIdempotencyKey("co1", "company:sars_tcs_pin_expiry", 14);
    const b = complianceDigestIdempotencyKey("co1", "company:sars_tcs_pin_expiry", 14);
    expect(a).toBe(b);
  });

  it("differs when the threshold differs - the same item can alert at 30, 14 AND 7 days, each once", () => {
    const a = complianceDigestIdempotencyKey("co1", "company:sars_tcs_pin_expiry", 30);
    const b = complianceDigestIdempotencyKey("co1", "company:sars_tcs_pin_expiry", 14);
    expect(a).not.toBe(b);
  });
});
