import { afterEach, describe, expect, it, vi } from "vitest";

// Finding 345 (standing solution-architect review, 2026-11-10): the same
// naive-UTC-slice-of-a-timestamptz bug Findings 289-292/344 already fixed
// repeatedly (engine/ in Python, then 3 TypeScript display call sites in
// compliance-data.ts/general-pack-review-data.ts/general-workspace.tsx)
// also existed, unfixed and unchecked, in ensureClosingMilestone()
// (app/app/tenders/[id]/actions.ts) - the idempotent auto-seed that writes
// the "Tender closes" standard tender_tasks row the very first time a
// tender's own Workspace page is viewed (page.tsx, called unconditionally
// alongside ensureBriefingMilestone() before the task list is read back).
//
// Unlike Finding 344's 3 sites (a per-request display/RPC-argument
// computation, recomputed fresh on every read), this one PERSISTS the wrong
// value: `due_date` (tender_tasks.due_date, a plain `date` column per
// System-Status.md's own confirmed column-type sweep) is written via
// `upsert(..., { onConflict: "company_id,tender_id,kind", ignoreDuplicates:
// true })` - so once the naive slice writes a day-early due_date, every
// later page view's own idempotent upsert is silently ignored
// (ignoreDuplicates) and the wrong value is never corrected. This due_date
// then drives page.tsx's own "Due {date}"/days-left countdown display
// (lines ~418/1444/1461) directly in the Tender Workspace's Tasks &
// milestones section - a real, persisted, user-facing date-off-by-one, not
// a transient display glitch.
//
// Mocking technique: a table-keyed stub, same convention as
// compliance-data.spec.ts's own Finding-344 regression test (keyed by table
// name rather than call order, since ensureClosingMilestone() calls
// requireCompanyId() - its own company_members read - before the
// tender_tasks upsert this test needs to inspect). Calls the real,
// unmodified ensureClosingMilestone(), never a reimplementation.

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`unexpected redirect to ${url}`);
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

type UpsertCall = { payload: Record<string, unknown>; opts: unknown };

const upsertCalls: UpsertCall[] = [];

function makeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      if (table === "company_members") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = async () => ({ data: { company_id: "company-1" }, error: null });
        return chain;
      }
      if (table === "tender_tasks") {
        return {
          upsert: async (payload: Record<string, unknown>, opts: unknown) => {
            upsertCalls.push({ payload, opts });
            return { data: null, error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const supabaseState: { current: ReturnType<typeof makeSupabase> | null } = { current: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseState.current,
}));

afterEach(() => {
  vi.resetModules();
  upsertCalls.length = 0;
  supabaseState.current = null;
});

// 00:30 SAST on 2026-10-21, stored (as PostgREST always does for a
// timestamptz) as its UTC equivalent - the exact representative shape
// Findings 289-292/344 each use.
const TRICKY_CLOSING_DATE = "2026-10-20T22:30:00+00:00";
const REAL_SAST_CLOSING_DAY = "2026-10-21";

describe("ensureClosingMilestone: due_date is the tender's own SAST closing day", () => {
  it("writes the real SAST calendar day, not a naive UTC slice one day early", async () => {
    supabaseState.current = makeSupabase();

    const { ensureClosingMilestone } = await import("./actions");
    await ensureClosingMilestone("tender-1", TRICKY_CLOSING_DATE);

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].payload.due_date).toBe(REAL_SAST_CLOSING_DAY);
    // The exact wrong value the pre-fix `closingDate.slice(0, 10)` produces
    // for this same real timestamp - confirming this is a genuine
    // divergence, not merely a different-but-still-valid representation.
    expect(upsertCalls[0].payload.due_date).not.toBe(TRICKY_CLOSING_DATE.slice(0, 10));
  });
});
