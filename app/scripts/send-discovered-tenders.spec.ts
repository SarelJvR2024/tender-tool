// Regression test for a real bug found 2026-11-07 (standing solution-
// architect review): processDiscoveredTenderCompany() used to claim every
// candidate row (claim_notification()) BEFORE looking up
// operationalRecipients() for that company - and worse, the claim used to
// happen for ALL companies' rows up front, before grouping by company at
// all. A company with zero opted-in recipients at the moment this script
// ran would have every one of its newly-discovered tenders permanently
// claimed with nothing ever sent - even once that company later opted a
// member in. Flagged for this file specifically on 2026-11-06 (see
// docs/specs/System-Status.md's "Did NOT re-open ..." entry that pass) and
// left for a dedicated fix rather than overridden on the spot.
import { describe, expect, it } from "vitest";
import { processDiscoveredTenderCompany } from "./send-discovered-tenders.ts";
import type { DiscoveredOpportunityRow } from "../lib/discoveredTendersDigest.ts";

type Call = { table?: string; name?: string; kind: "rpc" | "from"; params?: Record<string, unknown> };

/** Thenable, chainable query-builder stub good enough for the one .from() shape this function uses (a .maybeSingle() company-name lookup) - same technique scripts/send-operational-alerts.spec.ts already established. */
function makeBuilder(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data, error }),
  };
  return builder;
}

function mockSupabase(opts: {
  companyRow?: { legal_name: string } | null;
  rpcResponses: Record<string, { data: unknown; error: unknown } | { data: unknown; error: unknown }[]>;
}) {
  const calls: Call[] = [];
  const cursors: Record<string, number> = {};
  const rpc = (name: string, params: Record<string, unknown>) => {
    calls.push({ name, kind: "rpc", params });
    const queued = opts.rpcResponses[name];
    if (!queued) return Promise.resolve({ data: null, error: null });
    if (Array.isArray(queued)) {
      const i = cursors[name] ?? 0;
      cursors[name] = i + 1;
      return Promise.resolve(queued[Math.min(i, queued.length - 1)]);
    }
    return Promise.resolve(queued);
  };
  const from = (table: string) => {
    calls.push({ table, kind: "from" });
    return makeBuilder(opts.companyRow ?? { legal_name: "Reviewer Civils (Pty) Ltd" });
  };
  return { rpc, from, calls } as unknown as { rpc: typeof rpc; from: typeof from; calls: Call[] };
}

function row(overrides: Partial<DiscoveredOpportunityRow> = {}): DiscoveredOpportunityRow {
  return {
    id: "opp-1",
    company_id: "company-1",
    contract_number: "N.007-030-2026/1F",
    buyer: "SANRAL",
    title: "Upgrade of road",
    description: null,
    etenders_category: "Civil Engineering",
    categories: null,
    closing_date: "2026-12-01",
    verdict: "strong_fit",
    ...overrides,
  };
}

describe("processDiscoveredTenderCompany", () => {
  it("never claims claim_notification for a company with zero opted-in recipients", async () => {
    const supabase = mockSupabase({
      rpcResponses: { company_notification_recipients: { data: [], error: null } },
    });

    const result = await processDiscoveredTenderCompany(supabase as never, "company-1", [row()], "https://app.example", {
      dryRun: false,
      testRecipient: null,
    });

    expect(result).toEqual({ claimedCount: 0, sent: 0, skippedNoRecipients: 1, dryRunRow: null });
    // The real bug: this RPC call used to happen regardless (and for every
    // company up front, before this one was even known to have no recipients).
    expect(supabase.calls.some((c) => c.name === "claim_notification")).toBe(false);
  });

  it("looks up recipients BEFORE claiming when the company has a real opted-in recipient, and claims every row", async () => {
    const supabase = mockSupabase({
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
        claim_notification: { data: true, error: null },
        record_notification_sent: { data: null, error: null },
      },
    });

    const result = await processDiscoveredTenderCompany(
      supabase as never,
      "company-1",
      [row({ id: "opp-1" }), row({ id: "opp-2" })],
      "https://app.example",
      { dryRun: false, testRecipient: null },
    );

    expect(result.skippedNoRecipients).toBe(0);
    expect(result.claimedCount).toBe(2);
    // Recipients must be resolved BEFORE any claim - the whole point of the fix.
    const recipientsIdx = supabase.calls.findIndex((c) => c.name === "company_notification_recipients");
    const firstClaimIdx = supabase.calls.findIndex((c) => c.name === "claim_notification");
    expect(recipientsIdx).toBeGreaterThanOrEqual(0);
    expect(recipientsIdx).toBeLessThan(firstClaimIdx);
  });

  it("claims nothing and sends nothing when every row was already claimed by an earlier run", async () => {
    const supabase = mockSupabase({
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
        claim_notification: { data: false, error: null }, // already claimed
      },
    });

    const result = await processDiscoveredTenderCompany(supabase as never, "company-1", [row()], "https://app.example", {
      dryRun: false,
      testRecipient: null,
    });

    expect(result).toEqual({ claimedCount: 0, sent: 0, skippedNoRecipients: 0, dryRunRow: null });
  });

  it("--dry-run never claims, and shows the recipients-empty status without skipping", async () => {
    const supabase = mockSupabase({
      rpcResponses: { company_notification_recipients: { data: [], error: null } },
    });

    const result = await processDiscoveredTenderCompany(supabase as never, "company-1", [row()], "https://app.example", {
      dryRun: true,
      testRecipient: null,
    });

    expect(supabase.calls.some((c) => c.name === "claim_notification")).toBe(false);
    expect(result.dryRunRow?.status).toBe("Skipped (no opted-in recipients)");
  });

  // Finding 347: --test-recipient is documented (lib/senderCliArgs.ts's own
  // header) as safe specifically because "using the real key here would
  // permanently burn that one-time claim, and the real recipient would
  // never get the real notification later" - but the CLAIM call itself
  // (the one that actually inserts the permanent notification_claims row)
  // used the real, untouched discoveredTenderIdempotencyKey() regardless of
  // testRecipient; only the later record_notification_sent call used
  // testIdempotencyKey(). A --test-recipient run therefore permanently
  // burns the real company's real one-shot "discovered tender" claim for
  // this opportunity - the exact outcome the design comment says this flag
  // exists to prevent.
  it("--test-recipient must claim under the TEST-prefixed key, never the real one (Finding 347)", async () => {
    const supabase = mockSupabase({
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
        claim_notification: { data: true, error: null },
        record_notification_sent: { data: null, error: null },
      },
    });

    await processDiscoveredTenderCompany(supabase as never, "company-1", [row({ id: "opp-1" })], "https://app.example", {
      dryRun: false,
      testRecipient: "qa@example.com",
    });

    const claimCall = supabase.calls.find((c) => c.name === "claim_notification");
    expect(claimCall).toBeDefined();
    const claimedKey = claimCall!.params!.p_idempotency_key as string;
    expect(claimedKey.startsWith("test-")).toBe(true);
    expect(claimedKey).not.toBe("discovered-tender-opp-1");
  });
});
