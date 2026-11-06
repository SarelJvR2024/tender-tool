import { afterEach, describe, expect, it, vi } from "vitest";

// Regression test for syncWonProjectToTeam() (app/app/tenders/[id]/actions.ts) -
// Standing review, 2026-11-06: a 4th grep blind spot in the standing TS-sweep.
// The sweep's own grep only ever matched the literal substring "const { data"
// (first camelCase guard files, then hyphenated *-actions.ts files, then bare
// unchecked `await supabase....update/insert/delete/upsert()` with no
// destructuring at all were found as blind spots in that order). This is a
// fourth: `const [{ data: x }, { data: y }] = await Promise.all([...])` never
// matches "const { data" either, because there is a "[" between "const" and
// "{" - so every array/tuple-destructured Promise.all() read in the codebase
// (grep: `grep -rn "const \[{" --include="*.ts" app/app app/lib`) went
// unchecked by every prior pass of this sweep.
//
// Pre-fix, `syncWonProjectToTeam()`'s own `[{ data: assignmentRows }, ...] =
// await Promise.all([...])` captured no error at all. A transient failure on
// the `tender_pack_assignments` read made `assignmentRows` null, so
// `confirmed` (the list of positions to sync into project history) silently
// became `[]`, the whole upsert block was skipped, and the action still
// redirected to `#won-project` with no `error=` param - reporting success
// while nothing was actually synced into any person's project history (and
// therefore never flowing into their next generated CV).
//
// Mocking technique copied from the established convention
// (app/app/company/document-scan/actions.spec.ts and its own precedents),
// extended with `.in`/`.upsert` chain methods this file's own writes need.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(queue: Resp[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "delete", "update", "upsert", "eq", "in", "order", "single", "maybeSingle"];
  for (const m of methods) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => {
    const next = queue.shift();
    resolve(next ?? { data: null, error: null });
  };
  return chain;
}

function makeSupabase(fromQueues: Resp[][]) {
  let fromCallIndex = 0;
  const fromCalls: unknown[][] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        fromCalls.push([table, fromCallIndex]);
        const queue = fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue);
      },
    },
    fromCalls,
  };
}

const supabaseState: { current: ReturnType<typeof makeSupabase>["client"] | null } = { current: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseState.current,
}));

class RedirectSignal extends Error {
  url: string;
  constructor(url: string) {
    super("NEXT_REDIRECT");
    this.url = url;
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

function formDataWith(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    throw new Error("expected a redirect, action returned normally");
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
}

afterEach(() => {
  vi.resetModules();
  supabaseState.current = null;
});

const wonPackRow = { data: { id: "pack-1", tender_id: "tender-1", pipeline_stage: "won" }, error: null };

describe("syncWonProjectToTeam - tender_pack_assignments read fails", () => {
  it("does not report success when the confirmed-positions read fails, and does not skip syncing silently", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
      [wonPackRow], // tender_packs select (gate re-derive)
      [{ data: null, error: null }], // tender_packs update
      [{ data: null, error: { message: "read replica unavailable" } }], // tender_pack_assignments select -> FAILS
      [{ data: null, error: null }], // tenders select
      [{ data: null, error: null }], // tender_requirements select
    ]);
    supabaseState.current = client;

    const { syncWonProjectToTeam } = await import("./actions");

    const fd = formDataWith({
      tender_id: "tender-1",
      tender_pack_id: "pack-1",
      project_completed_at: "2026-11-01",
    });
    const url = await expectRedirect(syncWonProjectToTeam(fd));

    expect(url).toContain("/tenders/tender-1?error=");
    expect(url).not.toContain("#won-project&");
    // Must not be the bare success redirect this bug produced pre-fix.
    expect(url).not.toBe("/tenders/tender-1#won-project");
  });
});

describe("syncWonProjectToTeam - all reads succeed, no confirmed positions", () => {
  it("still redirects to the success anchor when there is genuinely nothing to sync", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
      [wonPackRow],
      [{ data: null, error: null }], // tender_packs update
      [{ data: [], error: null }], // tender_pack_assignments select - genuinely empty
      [{ data: { contract_no: "C1", title: "Road upgrade" }, error: null }], // tenders select
      [{ data: [], error: null }], // tender_requirements select
      [{ data: [], error: null }], // projects select (existingSynced)
    ]);
    supabaseState.current = client;

    const { syncWonProjectToTeam } = await import("./actions");

    const fd = formDataWith({
      tender_id: "tender-1",
      tender_pack_id: "pack-1",
      project_completed_at: "2026-11-01",
    });
    const url = await expectRedirect(syncWonProjectToTeam(fd));

    expect(url).toBe("/tenders/tender-1#won-project");
  });
});
