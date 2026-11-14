// Regression test for a real bug found 2026-11-06 (standing solution-
// architect review): all 3 stages here (print cutoff, briefing countdown,
// clarification window) used to call the one-time-ever
// record_operational_alert_sent() claim BEFORE looking up
// operationalRecipients(), so a company with zero opted-in recipients at the
// moment this script ran would have its claim permanently burned with
// nothing ever sent - even after that company later opted a member in,
// hours/days before the same tender's own deadline. Same bug class, same
// shape as scripts/send-deadline-reminders.ts's own identical fix this same
// pass - just under this file's own claim RPC name
// (record_operational_alert_sent, not record_deadline_reminder_sent), which
// is why the 2026-10-30 pass's grep for claim_notification callers never
// found any of these 4 call sites.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPrintCutoff, runBriefingReminders, runClarificationWindow, type RunOpts } from "./send-operational-alerts.ts";
import { POSTGREST_PAGE_SIZE } from "../lib/supabasePaging.ts";

type Call = { table?: string; name?: string; kind: "rpc" | "from" };

// Frozen, unambiguous instant for runBriefingReminders/runClarificationWindow
// below only (NOT runPrintCutoff, whose own `pack` fixture deliberately
// anchors to the real ambient clock via `Date.now() + 40h` and must keep
// seeing the real wall clock) - safely mid-day in both UTC and SAST (SAST =
// UTC+2), nowhere near either timezone's own midnight. daysFromToday() below
// used to build its "N days from today" fixture off the real host clock's
// own local (effectively UTC, no TZ env set) calendar day, while
// runBriefingReminders()/runClarificationWindow()'s underlying daysUntil()
// call computes "today" as the real SAST calendar day; those two disagree by
// exactly one day during the real 00:00-02:00 SAST window, making these
// tests genuinely flaky at that hour regardless of any code change. Freezing
// the clock (both the fixture dates below AND the functions-under-test's own
// ambient `new Date()` call, via each describe block's own
// beforeEach/afterEach pair) to one instant where UTC-today and SAST-today
// are the same calendar day makes the day-count unambiguous at any real
// wall-clock time.
const FROZEN_NOW = new Date("2026-06-15T10:00:00.000Z");

function daysFromToday(n: number): string {
  const d = new Date(FROZEN_NOW);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}

/** Thenable, chainable query-builder stub good enough for every .from() shape these 3 functions use (range-paginated reads, a direct awaited chain, and a .maybeSingle() lookup). `.range(from, to)` slices a real array response the same way PostgREST's own pagination would, rather than always handing back the whole thing - so a test using an array longer than one page actually exercises whether a caller pages through every row or silently stops at the first. Awaiting the builder directly (no `.range()` at all) mirrors PostgREST's own real db-max-rows default too - capped at POSTGREST_PAGE_SIZE, same as the real server would silently truncate to - so a query that's missing its own `.range()`/fetchAllRows() call is caught here, not hidden by a mock that's more generous than production. */
function makeBuilder(data: unknown, error: unknown = null) {
  const capped = Array.isArray(data) ? data.slice(0, POSTGREST_PAGE_SIZE) : data;
  const builder: Record<string, unknown> = {
    select: () => builder, eq: () => builder, not: () => builder, order: () => builder, in: () => builder, gte: () => builder, is: () => builder,
    range: (from: number, to: number) => Promise.resolve({ data: Array.isArray(data) ? data.slice(from, to + 1) : data, error }),
    maybeSingle: () => Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error }),
    then: (resolve: (v: { data: unknown; error: unknown }) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve({ data: capped, error }).then(resolve, reject),
  };
  return builder;
}

function mockSupabase(opts: { fromResponses: Record<string, unknown>; rpcResponses: Record<string, { data: unknown; error: unknown }> }) {
  const calls: Call[] = [];
  const rpc = vi.fn(async (name: string) => {
    calls.push({ name, kind: "rpc" });
    return opts.rpcResponses[name] ?? { data: null, error: null };
  });
  const from = vi.fn((table: string) => {
    calls.push({ table, kind: "from" });
    return makeBuilder(opts.fromResponses[table] ?? []);
  });
  return { rpc, from, calls } as unknown as { rpc: typeof rpc; from: typeof from; calls: Call[] };
}

const baseOpts: RunOpts = { dryRun: false, scopeCompanyId: null, testRecipient: null };

describe("runPrintCutoff", () => {
  const pack = {
    id: "pack-1", tender_id: "tender-1", company_id: "company-1", pipeline_stage: "building",
    submission_type: "physical_box", estimated_print_hours: 0, estimated_transit_hours: 0, dispatch_status: "not_started",
    tenders: { id: "tender-1", contract_no: "N.007-030-2026/1F", description: "Upgrade", closing_date: new Date(Date.now() + 40 * 60 * 60 * 1000).toISOString() },
  };

  it("never claims record_operational_alert_sent for a company with zero opted-in recipients", async () => {
    const supabase = mockSupabase({
      fromResponses: { tender_packs: [pack] },
      rpcResponses: { company_notification_recipients: { data: [], error: null } },
    });
    const result = await runPrintCutoff(supabase as never, "https://app.example", baseOpts, []);
    expect(result.sent).toBe(0);
    expect(supabase.calls.some((c) => c.name === "record_operational_alert_sent")).toBe(false);
  });

  it("claims and attempts to send when a recipient exists", async () => {
    const supabase = mockSupabase({
      fromResponses: { tender_packs: [pack] },
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
        record_operational_alert_sent: { data: true, error: null },
      },
    });
    await runPrintCutoff(supabase as never, "https://app.example", baseOpts, []);
    const recipientsIdx = supabase.calls.findIndex((c) => c.name === "company_notification_recipients");
    const claimIdx = supabase.calls.findIndex((c) => c.name === "record_operational_alert_sent");
    expect(recipientsIdx).toBeGreaterThanOrEqual(0);
    expect(recipientsIdx).toBeLessThan(claimIdx);
  });

  // Finding 411: this is the realistic DEFAULT state for every company
  // (migration 0073: daily_digest_opt_in defaults to false for every
  // member) - a 48-hour physical print/transit cutoff is exactly the
  // "cannot be disabled for active bidders" category migration 0093's own
  // header names, so it must still send even when nobody has opted in.
  it("still attempts to claim/send for a real member who has never opted into the daily digest (Finding 411)", async () => {
    const supabase = mockSupabase({
      fromResponses: { tender_packs: [pack] },
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: false }], error: null },
        record_operational_alert_sent: { data: true, error: null },
      },
    });
    await runPrintCutoff(supabase as never, "https://app.example", baseOpts, []);
    // Pre-fix (operationalRecipients()), an opted-out member resolves to
    // zero recipients, so the candidate is skipped before ever claiming -
    // the claim call below would never happen.
    expect(supabase.calls.some((c) => c.name === "record_operational_alert_sent")).toBe(true);
  });
});

describe("runBriefingReminders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const tender = { id: "tender-2", contract_no: "N.007-040-2026/1F", description: "Rehab", briefing_date: daysFromToday(5), briefing_time: "10:00", tender_packs: [{ company_id: "company-1", pipeline_stage: "assessing" }] };

  it("never claims record_operational_alert_sent for a company with zero opted-in recipients", async () => {
    const supabase = mockSupabase({
      fromResponses: { tenders: [tender] },
      rpcResponses: { company_notification_recipients: { data: [], error: null } },
    });
    const result = await runBriefingReminders(supabase as never, "https://app.example", baseOpts, []);
    expect(result.sent).toBe(0);
    expect(supabase.calls.some((c) => c.name === "record_operational_alert_sent")).toBe(false);
  });

  it("claims and attempts to send when a recipient exists", async () => {
    const supabase = mockSupabase({
      fromResponses: { tenders: [tender] },
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
        record_operational_alert_sent: { data: true, error: null },
      },
    });
    await runBriefingReminders(supabase as never, "https://app.example", baseOpts, []);
    const recipientsIdx = supabase.calls.findIndex((c) => c.name === "company_notification_recipients");
    const claimIdx = supabase.calls.findIndex((c) => c.name === "record_operational_alert_sent");
    expect(recipientsIdx).toBeGreaterThanOrEqual(0);
    expect(recipientsIdx).toBeLessThan(claimIdx);
  });

  it("still attempts to claim/send for a real member who has never opted into the daily digest (Finding 411)", async () => {
    const supabase = mockSupabase({
      fromResponses: { tenders: [tender] },
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: false }], error: null },
        record_operational_alert_sent: { data: true, error: null },
      },
    });
    await runBriefingReminders(supabase as never, "https://app.example", baseOpts, []);
    expect(supabase.calls.some((c) => c.name === "record_operational_alert_sent")).toBe(true);
  });

  // Finding 448: tenders.briefing_date is never cleared when a briefing is
  // cancelled by an addendum (watch_tender_updates.py never applies the
  // cancelled sentinel, and accept_tender_update_date() refuses to accept
  // one) - so without a separate check, this candidate would still fire a
  // reminder for a briefing the Tender Workspace page already correctly
  // tells the same person was cancelled.
  it("never claims or sends when the tender's latest watched document says the briefing was cancelled", async () => {
    const supabase = mockSupabase({
      fromResponses: {
        tenders: [tender],
        tender_watched_documents: [{ tender_id: tender.id, first_seen_at: "2026-06-01T00:00:00Z", changes: { briefing: { cancelled: true } } }],
      },
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
        record_operational_alert_sent: { data: true, error: null },
      },
    });
    const result = await runBriefingReminders(supabase as never, "https://app.example", baseOpts, []);
    expect(result.sent).toBe(0);
    expect(result.candidates).toBe(0);
    expect(supabase.calls.some((c) => c.name === "record_operational_alert_sent")).toBe(false);
  });

  // A later addendum that moves the briefing to a new date (no `cancelled`
  // key on the newest document) is not still "cancelled" - the reminder
  // must still fire, same as before this fix.
  it("still fires when an earlier cancellation was superseded by a later, real briefing-date change", async () => {
    const supabase = mockSupabase({
      fromResponses: {
        tenders: [tender],
        tender_watched_documents: [
          { tender_id: tender.id, first_seen_at: "2026-06-01T00:00:00Z", changes: { briefing: { cancelled: true } } },
          { tender_id: tender.id, first_seen_at: "2026-06-05T00:00:00Z", changes: { briefing: { cancelled: false } } },
        ],
      },
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
        record_operational_alert_sent: { data: true, error: null },
      },
    });
    const result = await runBriefingReminders(supabase as never, "https://app.example", baseOpts, []);
    expect(result.candidates).toBe(1);
    expect(supabase.calls.some((c) => c.name === "record_operational_alert_sent")).toBe(true);
  });
});

describe("runClarificationWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const task = {
    id: "task-1", company_id: "company-1", tender_id: "tender-3", description: "Submit clarification questions", due_date: daysFromToday(10), status: "open", kind: "clarification",
    tenders: { id: "tender-3", contract_no: "N.007-050-2026/1F", description: "Signage", buyer: "SANRAL" },
  };

  it("never claims record_operational_alert_sent for a company with zero opted-in recipients", async () => {
    const supabase = mockSupabase({
      fromResponses: { tender_tasks: [task], tender_packs: null },
      rpcResponses: { company_notification_recipients: { data: [], error: null } },
    });
    const result = await runClarificationWindow(supabase as never, "https://app.example", baseOpts, []);
    expect(result.sent).toBe(0);
    expect(supabase.calls.some((c) => c.name === "record_operational_alert_sent")).toBe(false);
  });

  it("claims and attempts to send when a recipient exists", async () => {
    const supabase = mockSupabase({
      fromResponses: { tender_tasks: [task], tender_packs: null },
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
        record_operational_alert_sent: { data: true, error: null },
      },
    });
    await runClarificationWindow(supabase as never, "https://app.example", baseOpts, []);
    const recipientsIdx = supabase.calls.findIndex((c) => c.name === "company_notification_recipients");
    const claimIdx = supabase.calls.findIndex((c) => c.name === "record_operational_alert_sent");
    expect(recipientsIdx).toBeGreaterThanOrEqual(0);
    expect(recipientsIdx).toBeLessThan(claimIdx);
  });

  it("still attempts to claim/send for a real member who has never opted into the daily digest (Finding 411)", async () => {
    const supabase = mockSupabase({
      fromResponses: { tender_tasks: [task], tender_packs: null },
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: false }], error: null },
        record_operational_alert_sent: { data: true, error: null },
      },
    });
    await runClarificationWindow(supabase as never, "https://app.example", baseOpts, []);
    expect(supabase.calls.some((c) => c.name === "record_operational_alert_sent")).toBe(true);
  });

  it("pages through every tender_tasks row via fetchAllRows(), not just the first PostgREST page (Finding, compliance/reminders rotation 2026-11-09)", async () => {
    // Real incident this guards against: this stage's own tender_tasks read
    // used to be a plain, unranged .select() - unlike its two siblings
    // (runPrintCutoff/runBriefingReminders above, both already paginated) -
    // so past PostgREST's 1000-row cap, every clarification task sorting
    // past row 1000 silently never got its 10-day/48h reminder, ever.
    const manyTasks = Array.from({ length: POSTGREST_PAGE_SIZE + 5 }, (_, i) => ({
      id: `task-${i}`, company_id: `company-${i}`, tender_id: `tender-${i}`, description: "Submit clarification questions",
      due_date: daysFromToday(10), status: "open", kind: "clarification",
      tenders: { id: `tender-${i}`, contract_no: `N.007-0${i}-2026/1F`, description: "Signage", buyer: "SANRAL" },
    }));
    const supabase = mockSupabase({
      fromResponses: { tender_tasks: manyTasks, tender_packs: null },
      rpcResponses: {
        company_notification_recipients: { data: [{ email: "bids@reviewer-civils.co.za", daily_digest_opt_in: true }], error: null },
      },
    });
    // --dry-run: no real email send per candidate (would otherwise make
    // 1000+ real network calls to Resend in this test) - still exercises
    // the real fetchAllRows()/.range() read and candidate derivation this
    // fix is actually about.
    const dryRunRows: unknown[] = [];
    const result = await runClarificationWindow(supabase as never, "https://app.example", { ...baseOpts, dryRun: true }, dryRunRows as never);
    expect(result.candidates).toBe(manyTasks.length);
    expect(dryRunRows.length).toBe(manyTasks.length);
  });
});
