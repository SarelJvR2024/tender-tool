import { describe, expect, it } from "vitest";
import { getNotifications } from "./notifications";

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minimal Supabase client stub - same shape as complianceDigestCandidates.spec.ts's own
 * stubSupabase(), extended with the `tenders` table getNotifications() also reads. Every
 * chain method returns the same thenable `self`, so both call shapes work: awaiting the
 * chain directly, and calling .maybeSingle() on it for the single `companies` row. */
function stubSupabase(opts: {
  company: Record<string, unknown> | null;
  held?: Record<string, unknown>[];
  types?: Record<string, unknown>[];
  people?: Record<string, unknown>[];
  tenders?: Record<string, unknown>[];
}) {
  const rowsByTable: Record<string, unknown[]> = {
    held_registrations: opts.held ?? [],
    registration_types: opts.types ?? [],
    people: opts.people ?? [],
    tenders: opts.tenders ?? [],
  };
  return {
    from(table: string) {
      const self: Record<string, unknown> = {
        select: () => self,
        eq: () => self,
        not: () => self,
        order: () => self,
        maybeSingle: async () => ({ data: table === "companies" ? opts.company : null }),
        then: (resolve: (v: { data: unknown }) => void) => resolve({ data: rowsByTable[table] ?? [] }),
      };
      return self;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const blankCompany = {
  coid_letter_of_good_standing_expiry: null,
  cidb_expiry: null,
  sars_tcs_pin_expiry: null,
  pi_insurance_expiry: null,
  iso_9001_expiry: null,
  bank_confirmation_letter_valid_until: null,
  bee_proof_expiry: null,
};

describe("getNotifications - company field windows", () => {
  it("flags a 60-day field (e.g. SARS TCS PIN) at 45 days out - within the default window", async () => {
    const supabase = stubSupabase({ company: { ...blankCompany, sars_tcs_pin_expiry: daysFromNow(45) } });
    const notifications = await getNotifications(supabase);
    expect(notifications.map((n) => n.id)).toContain("company:sars_tcs_pin_expiry");
  });

  it("does NOT flag the bank confirmation letter at 45 days out - its own window is 30, not the 60-day default", async () => {
    // Real bug, found 2026-10-29: this used to apply the flat 60-day default to every
    // company field, including the bank letter - which the vault page and the real
    // compliance checks all treat as "renew soon" at 30 days (3-month validity). The bell
    // would nag about a letter the vault itself still called "Current".
    const supabase = stubSupabase({ company: { ...blankCompany, bank_confirmation_letter_valid_until: daysFromNow(45) } });
    const notifications = await getNotifications(supabase);
    expect(notifications.map((n) => n.id)).not.toContain("company:bank_confirmation_letter_valid_until");
  });

  it("DOES flag the bank confirmation letter at 25 days out - inside its own 30-day window", async () => {
    const supabase = stubSupabase({ company: { ...blankCompany, bank_confirmation_letter_valid_until: daysFromNow(25) } });
    const notifications = await getNotifications(supabase);
    const n = notifications.find((x) => x.id === "company:bank_confirmation_letter_valid_until");
    expect(n).toBeDefined();
    expect(n!.severity).toBe("warning");
  });

  it("flags an already-expired bank confirmation letter regardless of window", async () => {
    const supabase = stubSupabase({ company: { ...blankCompany, bank_confirmation_letter_valid_until: daysFromNow(-5) } });
    const notifications = await getNotifications(supabase);
    const n = notifications.find((x) => x.id === "company:bank_confirmation_letter_valid_until");
    expect(n).toBeDefined();
    expect(n!.severity).toBe("destructive");
  });
});
