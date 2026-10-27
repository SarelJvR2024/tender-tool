import { describe, expect, it } from "vitest";
import { complianceDigestCandidatesForCompany, complianceDigestIdempotencyKey, COMPLIANCE_DIGEST_THRESHOLDS } from "./complianceDigestCandidates";
import { SARS_PIN_RISK_NOTE } from "./emailTemplatesTier2";

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
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

  it("does not fire a field that is not exactly on a threshold day", async () => {
    const supabase = stubSupabase({
      company: { id: "co1", legal_name: "Acme", sars_tcs_pin_expiry: daysFromNow(20), coid_letter_of_good_standing_expiry: null, cidb_expiry: null, pi_insurance_expiry: null, iso_9001_expiry: null, bank_confirmation_letter_valid_until: null, bee_proof_expiry: null },
      held: [], types: [], people: [],
    });
    expect(await complianceDigestCandidatesForCompany(supabase, "co1")).toHaveLength(0);
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
