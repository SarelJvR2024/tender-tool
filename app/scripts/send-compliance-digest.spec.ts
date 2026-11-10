// Regression tests for 2 real bugs in this file.
//
// 2026-11-07 (standing solution-architect review, Finding 163):
// processComplianceDigestForCompany() gated its recipients on
// operationalRecipients() - the unrelated, default-off "new tenders
// discovered" daily-digest opt-in (migration 0073) - rather than the
// unconditional criticalBidRecipients() every other critical, bid-
// protecting alert (corrigenda, returnables, closing-deadline reminders)
// already uses. A lapsing SARS Tax PIN/COID/B-BBEE/CIDB/ECSA/SACPCMP
// certificate can disqualify an active bid outright; gating that alert
// behind a toggle 32/33 real companies never turned on meant those
// companies got zero compliance-expiry warnings, silently, contradicting
// app/company/Notifications.tsx's own UI copy ("closing deadline
// reminders ... are always delivered to keep your submissions
// compliant").
//
// 2026-11-07 (earlier pass, same day): processComplianceDigestForCompany()
// used to claim each candidate via claim_notification() BEFORE looking up
// recipients, so a company with zero recipients at the moment this script
// ran would have every one of its compliance items permanently claimed
// with nothing ever sent - even once that company later got a recipient,
// before the same document's own expiry. Same bug class, same shape as
// scripts/send-deadline-reminders.ts's own 2026-11-06 fix - flagged for
// this file specifically on 2026-11-06 (see docs/specs/System-Status.md's
// "Did NOT re-open ..." entry that pass) and left for a dedicated fix
// rather than overridden on the spot.
import { describe, expect, it, vi } from "vitest";
import { processComplianceDigestForCompany, allCompanies } from "./send-compliance-digest.ts";
import type { ComplianceDigestCandidate } from "../lib/complianceDigestCandidates.ts";
import { POSTGREST_PAGE_SIZE } from "../lib/supabasePaging.ts";

type RpcCall = { name: string; params: Record<string, unknown> };

/** Minimal sequential-response mock, same technique app/app/**\/*.spec.ts and scripts/send-deadline-reminders.spec.ts already use - keyed by RPC name so call order itself is the thing under test. */
function mockSupabase(responses: Record<string, { data: unknown; error: unknown } | { data: unknown; error: unknown }[]>) {
  const calls: RpcCall[] = [];
  const cursors: Record<string, number> = {};
  const rpc = (name: string, params: Record<string, unknown>) => {
    calls.push({ name, params });
    const queued = responses[name];
    if (!queued) return Promise.resolve({ data: null, error: null });
    if (Array.isArray(queued)) {
      const i = cursors[name] ?? 0;
      cursors[name] = i + 1;
      return Promise.resolve(queued[Math.min(i, queued.length - 1)]);
    }
    return Promise.resolve(queued);
  };
  return { rpc, calls } as unknown as { rpc: typeof rpc; calls: RpcCall[] };
}

/** A `.from("companies").select(...).range(from, to)` chain (with an optional `.eq()` narrowing) whose `.range()` resolves with the real slice it's asked for - real pagination behaviour, not one canned response, so a test using this actually exercises whether a caller ranges through every page or silently stops at the first. */
function mockCompaniesTable(allRows: { id: string; legal_name: string | null }[]) {
  const range = vi.fn(async (from: number, to: number) => ({ data: allRows.slice(from, to + 1), error: null }));
  const eq = vi.fn(() => ({ range }));
  const select = vi.fn(() => ({ eq, range }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as Parameters<typeof allCompanies>[0], range };
}

describe("allCompanies", () => {
  it("pages through .range() until every company is read, not just the first PostgREST page (Finding, notify rotation 2026-11-09)", async () => {
    // Real incident this guards against: main()'s own companies read used
    // to be a plain, unranged .select() - past PostgREST's 1000-row cap,
    // every company created after the 1000th silently never got its SARS
    // Tax PIN/COID/B-BBEE/CIDB/ECSA/SACPCMP compliance-expiry digest, ever.
    const rows = Array.from({ length: POSTGREST_PAGE_SIZE + 5 }, (_, i) => ({ id: `c${i}`, legal_name: `Company ${i}` }));
    const { client, range } = mockCompaniesTable(rows);
    const { rows: result, error } = await allCompanies(client, null);
    expect(error).toBeNull();
    expect(result).toHaveLength(POSTGREST_PAGE_SIZE + 5);
    expect(result[POSTGREST_PAGE_SIZE + 4]).toEqual({ id: `c${POSTGREST_PAGE_SIZE + 4}`, legal_name: `Company ${POSTGREST_PAGE_SIZE + 4}` });
    expect(range).toHaveBeenCalledTimes(2); // one full 1000-row page, then the 5-row remainder
  });

  it("still applies the --company-id scope when given one", async () => {
    const rows = [{ id: "c1", legal_name: "Klipcorp" }];
    const { client } = mockCompaniesTable(rows);
    const { rows: result, error } = await allCompanies(client, "c1");
    expect(error).toBeNull();
    expect(result).toEqual(rows);
  });
});

function candidate(overrides: Partial<ComplianceDigestCandidate> = {}): ComplianceDigestCandidate {
  return {
    itemKey: "sars_tax_pin",
    threshold: 30,
    item: { label: "SARS Tax Compliance PIN", expiryDate: "2026-12-07", daysLeft: 30, href: "/company" },
    ...overrides,
  };
}

const company = { id: "company-1", legal_name: "Reviewer Civils (Pty) Ltd" };

describe("processComplianceDigestForCompany", () => {
  it("never claims claim_notification for a company with zero registered members", async () => {
    const supabase = mockSupabase({
      company_notification_recipients: { data: [], error: null }, // criticalBidRecipients() -> zero rows
    });

    const result = await processComplianceDigestForCompany(supabase as never, company, [candidate()], "https://app.example", {
      dryRun: false,
      testRecipient: null,
    });

    expect(result).toEqual({ claimedCount: 0, sent: 0, skippedNoRecipients: 1, dryRunRow: null });
    // The real bug: this RPC call used to happen regardless, permanently burning the one-shot claim.
    expect(supabase.calls.some((c) => c.name === "claim_notification")).toBe(false);
  });

  it("sends regardless of daily_digest_opt_in - Finding 163's fix (criticalBidRecipients(), not operationalRecipients())", async () => {
    const supabase = mockSupabase({
      // Every member here has NEVER opted into the unrelated daily digest -
      // the pre-fix operationalRecipients() filter would have returned zero
      // recipients for this exact row shape.
      company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: false }], error: null },
      claim_notification: { data: true, error: null },
      record_notification_sent: { data: null, error: null },
    });

    const result = await processComplianceDigestForCompany(supabase as never, company, [candidate()], "https://app.example", {
      dryRun: false,
      testRecipient: null,
    });

    expect(result.skippedNoRecipients).toBe(0);
    expect(result.claimedCount).toBe(1);
    // The real bug: the pre-fix operationalRecipients() filter would have
    // made this a zero-recipients skip (skippedNoRecipients: 1,
    // claimedCount: 0) purely because of daily_digest_opt_in: false above.
  });

  it("looks up recipients BEFORE claiming when the company has a real opted-in recipient", async () => {
    const supabase = mockSupabase({
      company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
      claim_notification: { data: true, error: null },
      record_notification_sent: { data: null, error: null },
    });

    const result = await processComplianceDigestForCompany(supabase as never, company, [candidate()], "https://app.example", {
      dryRun: false,
      testRecipient: null,
    });

    expect(result.skippedNoRecipients).toBe(0);
    expect(result.claimedCount).toBe(1);
    expect(supabase.calls.some((c) => c.name === "claim_notification")).toBe(true);
    // Recipients must be resolved BEFORE the claim - the whole point of the fix.
    const recipientsIdx = supabase.calls.findIndex((c) => c.name === "company_notification_recipients");
    const claimIdx = supabase.calls.findIndex((c) => c.name === "claim_notification");
    expect(recipientsIdx).toBeGreaterThanOrEqual(0);
    expect(recipientsIdx).toBeLessThan(claimIdx);
  });

  it("still handles an already-claimed candidate correctly (real dedupe, not a false positive) once it has a real recipient", async () => {
    const supabase = mockSupabase({
      company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
      claim_notification: { data: false, error: null }, // already claimed by an earlier run
    });

    const result = await processComplianceDigestForCompany(supabase as never, company, [candidate()], "https://app.example", {
      dryRun: false,
      testRecipient: null,
    });

    expect(result).toEqual({ claimedCount: 0, sent: 0, skippedNoRecipients: 0, dryRunRow: null });
  });

  it("--dry-run never claims, and shows the recipients-empty status without skipping", async () => {
    const supabase = mockSupabase({
      company_notification_recipients: { data: [], error: null },
    });

    const result = await processComplianceDigestForCompany(supabase as never, company, [candidate()], "https://app.example", {
      dryRun: true,
      testRecipient: null,
    });

    expect(supabase.calls.some((c) => c.name === "claim_notification")).toBe(false);
    expect(result.dryRunRow?.status).toBe("Skipped (no recipients)");
  });

  // Finding 347: --test-recipient is documented (lib/senderCliArgs.ts's own
  // header) as safe specifically because "using the real key here would
  // permanently burn that one-time claim, and the real recipient would
  // never get the real notification later" - but the CLAIM call itself
  // (the one that actually inserts the permanent notification_claims row)
  // used the real, untouched complianceDigestIdempotencyKey() regardless of
  // testRecipient; only the later record_notification_sent call used
  // testIdempotencyKey(). A --test-recipient run therefore permanently
  // burns the real company's real one-shot compliance-expiry claim - the
  // exact outcome the design comment says this flag exists to prevent.
  it("--test-recipient must claim under the TEST-prefixed key, never the real one (Finding 347)", async () => {
    const supabase = mockSupabase({
      company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
      claim_notification: { data: true, error: null },
      record_notification_sent: { data: null, error: null },
    });

    await processComplianceDigestForCompany(supabase as never, company, [candidate()], "https://app.example", {
      dryRun: false,
      testRecipient: "qa@example.com",
    });

    const claimCall = supabase.calls.find((c) => c.name === "claim_notification");
    expect(claimCall).toBeDefined();
    const claimedKey = claimCall!.params.p_idempotency_key as string;
    expect(claimedKey.startsWith("test-")).toBe(true);
    expect(claimedKey).not.toBe("compliance-digest-company-1-sars_tax_pin-30");
  });
});
