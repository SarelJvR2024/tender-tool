import { afterEach, describe, expect, it, vi } from "vitest";

// Regression test for Finding 360: moveTenderStage()/recordOutcomeAndMoveStage()
// (app/app/pipeline/actions.ts) only ever checked the FORWARD direction of the
// won-project CV sync (syncWonProjectToTeam, app/app/tenders/[id]/actions.ts
// line ~545: "if (packRow!.pipeline_stage !== 'won') fail(...)") before
// letting that sync write a confirmed team member's own project history
// (`projects`, feeding engine/cv/generate_cv.py directly). Nothing anywhere
// checked the REVERSE: once a pack stops being 'won' - corrected back to
// 'submitted' via the board's own "← Back" mis-click fixer, or changed to
// 'lost' via OutcomeForm's own "Mark Lost" button (recordOutcomeAndMoveStage
// lets either outcome overwrite the other at any time, by its own header
// comment, "to correct it later") - whatever syncWonProjectToTeam() already
// wrote into `projects` stayed there forever, with no later sync ever
// re-checking it (WonProjectCard itself only renders on pipeline_stage ===
// "won", so there is no UI path left to even see, let alone fix, a stale row
// once the stage has moved on). Fixed via won-project-sync-logic.ts's new
// shouldClearWonProjectSync(): both actions now read the pack's own CURRENT
// stage before moving it, and delete any `projects` rows this pack's own
// `source_tender_pack_id` owns the moment that read shows "was won, now
// isn't" - symmetric to the forward-direction gate that already existed.
//
// Mocking technique copied verbatim from the established convention
// (app/app/tenders/[id]/actions.spec.ts and its own precedents).

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
  const fromCalls: string[] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        fromCalls.push(table);
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

const membership = { data: { company_id: "company-1" }, error: null };

describe("moveTenderStage - leaving won must clear the stale won-project sync", () => {
  it("deletes this pack's synced `projects` rows when moving a won tender back to submitted", async () => {
    const { client, fromCalls } = makeSupabase([
      [membership], // company_members select
      [{ data: { id: "pack-1", pipeline_stage: "won" }, error: null }], // tender_packs select (current stage)
      [{ data: null, error: null }], // tender_packs upsert (the actual move)
      [{ data: null, error: null }], // projects delete
    ]);
    supabaseState.current = client;

    const { moveTenderStage } = await import("./actions");
    const fd = formDataWith({ tender_id: "tender-1", stage: "submitted" });
    await expectRedirect(moveTenderStage(fd));

    // The real assertion: a cleanup delete against `projects` must have
    // happened at all - pre-fix, "projects" never appears in fromCalls here.
    expect(fromCalls).toContain("projects");
  });

  it("does NOT touch `projects` when the pack was never won in the first place", async () => {
    const { client, fromCalls } = makeSupabase([
      [membership],
      [{ data: { id: "pack-1", pipeline_stage: "assessing" }, error: null }],
      [{ data: null, error: null }], // tender_packs upsert
    ]);
    supabaseState.current = client;

    const { moveTenderStage } = await import("./actions");
    const fd = formDataWith({ tender_id: "tender-1", stage: "building" });
    await expectRedirect(moveTenderStage(fd));

    expect(fromCalls).not.toContain("projects");
  });
});

describe("recordOutcomeAndMoveStage - correcting Awarded to Lost must clear the stale won-project sync", () => {
  it("deletes this pack's synced `projects` rows when OutcomeForm's own 'Mark Lost' overwrites a prior 'won'", async () => {
    const { client, fromCalls } = makeSupabase([
      [membership], // company_members select
      [{ data: { id: "pack-1", pipeline_stage: "won" }, error: null }], // tender_packs select (current stage)
      [{ data: null, error: null }], // tender_answers upsert (outcome fields) - none set in this test
      [{ data: null, error: null }], // tender_packs upsert (the actual move)
      [{ data: null, error: null }], // projects delete
    ]);
    supabaseState.current = client;

    const { recordOutcomeAndMoveStage } = await import("./actions");
    const fd = formDataWith({ tender_id: "tender-1", stage: "lost" });
    await expectRedirect(recordOutcomeAndMoveStage(fd));

    expect(fromCalls).toContain("projects");
  });

  it("does NOT touch `projects` when re-confirming the same outcome (won -> won)", async () => {
    const { client, fromCalls } = makeSupabase([
      [membership],
      [{ data: { id: "pack-1", pipeline_stage: "won" }, error: null }],
      [{ data: null, error: null }], // tender_answers upsert
      [{ data: null, error: null }], // tender_packs upsert
    ]);
    supabaseState.current = client;

    const { recordOutcomeAndMoveStage } = await import("./actions");
    const fd = formDataWith({ tender_id: "tender-1", stage: "won" });
    await expectRedirect(recordOutcomeAndMoveStage(fd));

    expect(fromCalls).not.toContain("projects");
  });
});
