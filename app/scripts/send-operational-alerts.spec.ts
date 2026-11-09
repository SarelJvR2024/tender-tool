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
import { describe, expect, it, vi } from "vitest";
import { runPrintCutoff, runBriefingReminders, runClarificationWindow, type RunOpts } from "./send-operational-alerts.ts";
import { POSTGREST_PAGE_SIZE } from "../lib/supabasePaging.ts";

type Call = { table?: string; name?: string; kind: "rpc" | "from" };

function daysFromToday(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
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
});

describe("runBriefingReminders", () => {
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
});

describe("runClarificationWindow", () => {
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
