import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSavingsCounterSummary } from "./savingsCounterData";

// Standing solution-architect review, 2026-11-06: fetchSavingsCounterSummary()
// used to destructure both its reads as just `{ data }`, with no error
// captured at all - a real Supabase failure on either the `companies` read
// or the `savings_counted_steps` read was indistinguishable from the
// genuine "nothing counted yet" case, so the caller's SavingsCounterCard
// rendered the ordinary "Finish your first bid" empty state on a real
// failure (the same silent-empty-state-on-error bug class already fixed
// elsewhere in this codebase, e.g. analytics' own briefing-attendance
// section). These tests exercise the fix directly against the real,
// unmodified function - not a reimplementation of its logic - using the
// same sequential-response-queue mocking convention already established
// for Server Actions (app/people/actions.spec.ts and siblings), adapted
// here for a plain `.from()`-chain-returning fetcher instead of an action.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(resp: Resp) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "order", "eq", "maybeSingle"];
  for (const m of methods) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => resolve(resp);
  return chain;
}

function makeSupabase(companyResp: Resp, rowsResp: Resp) {
  let callIndex = 0;
  return {
    from: () => {
      const resp = callIndex === 0 ? companyResp : rowsResp;
      callIndex += 1;
      return makeChain(resp);
    },
  } as unknown as Parameters<typeof fetchSavingsCounterSummary>[0];
}

const OK_COMPANY: Resp = { data: { savings_baseline_hours_per_tender: 20, savings_baseline_hourly_cost_zar: 450 }, error: null };
const OK_ROWS: Resp = { data: [], error: null };

describe("fetchSavingsCounterSummary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns error: false and a real null summary on the genuine 'no company row yet' case", async () => {
    const supabase = makeSupabase({ data: null, error: null }, OK_ROWS);
    const { summary, error } = await fetchSavingsCounterSummary(supabase);
    expect(summary).toBeNull();
    expect(error).toBe(false);
  });

  it("returns error: true (not a plain empty summary) when the companies read fails", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = makeSupabase({ data: null, error: { message: "connection reset" } }, OK_ROWS);
    const { summary, error } = await fetchSavingsCounterSummary(supabase);
    // Pre-fix this looked identical to the genuine "no company yet" case -
    // the whole point of this test is that it no longer does.
    expect(summary).toBeNull();
    expect(error).toBe(true);
    expect(logSpy).toHaveBeenCalledWith("companies select failed (savings counter)", { message: "connection reset" });
  });

  it("returns error: true when the savings_counted_steps read fails, even though the company read succeeded", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = makeSupabase(OK_COMPANY, { data: null, error: { message: "timeout" } });
    const { summary, error } = await fetchSavingsCounterSummary(supabase);
    // Pre-fix: `rows ?? []` swallowed this into a real-looking, all-zero
    // summary (zero tenders counted) - indistinguishable from a company
    // that genuinely hasn't done anything yet.
    expect(error).toBe(true);
    expect(summary?.allTime.tendersCounted).toBe(0);
    expect(logSpy).toHaveBeenCalledWith("savings_counted_steps select failed (savings counter)", { message: "timeout" });
  });

  it("returns error: false and a real summary on the ordinary success path", async () => {
    const supabase = makeSupabase(OK_COMPANY, {
      data: [{ tender_id: "t1", hours: 10, counted_at: new Date().toISOString() }],
      error: null,
    });
    const { summary, error } = await fetchSavingsCounterSummary(supabase);
    expect(error).toBe(false);
    expect(summary).not.toBeNull();
    expect(summary?.allTime.tendersCounted).toBe(1);
    expect(summary?.usingDefaultBaseline).toBe(false);
  });
});
