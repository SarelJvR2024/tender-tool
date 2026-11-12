// Regression test for a real bug found 2026-11-06 (standing solution-
// architect review): processDeadlineReminderCandidates() used to call the
// one-time-ever record_deadline_reminder_sent() claim BEFORE looking up
// criticalBidRecipients(), so a company with zero registered members at the
// moment this script ran would have its claim permanently burned with
// nothing ever sent - even after that company later added a member, days
// before the same tender's own closing date. Same bug class
// scripts/send-returnables-digest.ts was fixed for on 2026-10-30, just under
// a different claim RPC name, which is why that pass's grep for
// claim_notification callers never found this one.
import { describe, expect, it, vi } from "vitest";
import { processDeadlineReminderCandidates, filterCancelledTenders } from "./send-deadline-reminders.ts";
import { POSTGREST_PAGE_SIZE } from "../lib/supabasePaging.ts";
import type { DeadlineReminderCandidate } from "../lib/deadlineReminders.ts";

type RpcCall = { name: string; params: Record<string, unknown> };

/** Minimal sequential-response mock, same technique app/app/**\/*.spec.ts already uses for Server Actions - keyed by RPC name so call order itself is the thing under test. */
function mockSupabase(responses: Record<string, { data: unknown; error: unknown } | { data: unknown; error: unknown }[]>) {
  const calls: RpcCall[] = [];
  const cursors: Record<string, number> = {};
  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    calls.push({ name, params });
    const queued = responses[name];
    if (!queued) return { data: null, error: null };
    if (Array.isArray(queued)) {
      const i = cursors[name] ?? 0;
      cursors[name] = i + 1;
      return queued[Math.min(i, queued.length - 1)];
    }
    return queued;
  });
  return { rpc, calls } as unknown as { rpc: typeof rpc; calls: RpcCall[] };
}

function candidate(overrides: Partial<DeadlineReminderCandidate> = {}): DeadlineReminderCandidate {
  return {
    tender: { id: "tender-1", contract_no: "N.007-030-2026/1F", description: "Upgrade of road", closing_date: "2026-11-10T11:00:00+02:00", tender_packs: [] },
    companyId: "company-1",
    daysLeft: 3,
    threshold: 3,
    ...overrides,
  };
}

describe("processDeadlineReminderCandidates", () => {
  it("never claims record_deadline_reminder_sent for a company with zero registered members", async () => {
    const supabase = mockSupabase({
      company_notification_recipients: { data: [], error: null }, // criticalBidRecipients() -> zero rows
    });

    const result = await processDeadlineReminderCandidates(supabase as never, [candidate()], "https://app.example");

    expect(result).toEqual({ sent: 0, skippedAlreadySent: 0, skippedNoMembers: 1 });
    // The real bug: this RPC call used to happen regardless, permanently burning the one-shot claim.
    expect(supabase.calls.some((c) => c.name === "record_deadline_reminder_sent")).toBe(false);
  });

  it("claims and sends when the company has a real registered member", async () => {
    const supabase = mockSupabase({
      company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za" }], error: null },
      record_deadline_reminder_sent: { data: true, error: null },
      record_notification_sent: { data: null, error: null },
    });

    const result = await processDeadlineReminderCandidates(supabase as never, [candidate()], "https://app.example");

    expect(result.skippedNoMembers).toBe(0);
    expect(supabase.calls.some((c) => c.name === "record_deadline_reminder_sent")).toBe(true);
    // Recipients must be resolved BEFORE the claim - the whole point of the fix.
    const recipientsIdx = supabase.calls.findIndex((c) => c.name === "company_notification_recipients");
    const claimIdx = supabase.calls.findIndex((c) => c.name === "record_deadline_reminder_sent");
    expect(recipientsIdx).toBeGreaterThanOrEqual(0);
    expect(recipientsIdx).toBeLessThan(claimIdx);
  });

  it("still counts an already-claimed candidate (real dedupe, not a false positive) once it has a real recipient", async () => {
    const supabase = mockSupabase({
      company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za" }], error: null },
      record_deadline_reminder_sent: { data: false, error: null }, // already sent by an earlier run
    });

    const result = await processDeadlineReminderCandidates(supabase as never, [candidate()], "https://app.example");

    expect(result).toEqual({ sent: 0, skippedAlreadySent: 1, skippedNoMembers: 0 });
  });
});

// QA finding (2026-11-12): nothing ever clears/marks stale tenders.closing_date
// when the buyer cancels a tender outright - without filterCancelledTenders(),
// a candidate for an already-cancelled tender would still reach
// processDeadlineReminderCandidates() and fire the "closing in 3 days"/"24
// hours" email the Tender Workspace page already contradicts. Same shape as
// Finding 448's own fix for briefingReminders.ts/send-operational-alerts.ts,
// a different signal (whole-tender cancellation) and a different consumer
// (this deadline email).
describe("filterCancelledTenders", () => {
  /** Thenable, chainable .from() builder - same technique scripts/send-operational-alerts.spec.ts's own makeBuilder() uses, so .range()-paging is actually exercised rather than hidden by an over-generous mock. */
  function makeBuilder(data: unknown, error: unknown = null) {
    const capped = Array.isArray(data) ? data.slice(0, POSTGREST_PAGE_SIZE) : data;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      range: (from: number, to: number) => Promise.resolve({ data: Array.isArray(data) ? data.slice(from, to + 1) : data, error }),
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: capped, error }).then(resolve, reject),
    };
    return builder;
  }

  function mockSupabase(docRows: unknown, error: unknown = null) {
    const from = vi.fn(() => makeBuilder(docRows, error));
    return { from } as unknown as { from: typeof from };
  }

  it("returns every candidate unchanged when the secondary query finds no cancellation at all", async () => {
    const supabase = mockSupabase([]);
    const candidates = [candidate(), candidate({ tender: { ...candidate().tender, id: "tender-2" } })];

    const result = await filterCancelledTenders(supabase as never, candidates);

    expect(result).toEqual(candidates);
  });

  it("drops every candidate whose tender has a cancellation-kind watched document", async () => {
    const supabase = mockSupabase([{ tender_id: "tender-1", kind: "cancellation" }]);

    const result = await filterCancelledTenders(supabase as never, [candidate()]);

    expect(result).toEqual([]);
  });

  it("keeps a still-live tender's own candidate while dropping a cancelled sibling tender's", async () => {
    const supabase = mockSupabase([{ tender_id: "tender-1", kind: "cancellation" }]);
    const liveCandidate = candidate({ tender: { ...candidate().tender, id: "tender-2" }, companyId: "company-2" });

    const result = await filterCancelledTenders(supabase as never, [candidate(), liveCandidate]);

    expect(result).toEqual([liveCandidate]);
  });

  it("fails open - keeps every candidate unfiltered - when the secondary query errors", async () => {
    const supabase = mockSupabase(null, { message: "connection reset" });

    const result = await filterCancelledTenders(supabase as never, [candidate()]);

    expect(result).toEqual([candidate()]);
  });

  it("short-circuits with zero candidates without querying Supabase at all", async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as { from: typeof from };

    const result = await filterCancelledTenders(supabase as never, []);

    expect(result).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
