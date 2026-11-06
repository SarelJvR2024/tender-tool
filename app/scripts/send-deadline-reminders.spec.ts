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
import { processDeadlineReminderCandidates } from "./send-deadline-reminders.ts";
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
