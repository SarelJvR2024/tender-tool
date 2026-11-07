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
import { describe, expect, it } from "vitest";
import { processComplianceDigestForCompany } from "./send-compliance-digest.ts";
import type { ComplianceDigestCandidate } from "../lib/complianceDigestCandidates.ts";

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
});
