import { afterEach, describe, expect, it, vi } from "vitest";

// Finding 324 (standing review): clearSubcontractingPlan()'s own
// `tender_subcontracting_plans` delete used to be a plain
// `.delete().eq("company_id", companyId).eq("tender_id", tenderId)` with only
// `error` checked - the same "plain delete twin discards a zero-row RLS
// match" bug Findings 322/323 fixed for deleteCompanyOffice()/
// deleteTenderComment(). "tender_subcontracting_plans: tenant isolation"
// (0056) is `using (is_company_member(company_id))`, the identical
// USING-only, re-evaluated-at-write-time shape - a membership revoked
// mid-request makes PostgREST return a 2xx with `error: null` and zero rows
// affected. The "Clear this answer" button (subcontracting-plan.tsx) only
// renders when a plan is already saved, so a zero-row match here is the
// race, not a legitimate "nothing to clear" click. Pre-fix, the function
// still redirected "?saved=b7" unconditionally, telling the company its Form
// B7 answer was cleared when the old plan/waiver was still on file, silently
// stale for engine/pack/process_pack_jobs.py's own B7 gate until the page is
// reloaded.
//
// Mocking convention copied from the established pattern
// (general-actions.spec.ts / comment-actions.spec.ts): a sequential
// per-`.from()`-call response queue, a minimal thenable/chainable stub, and
// mocked `@/lib/supabase/server`/`next/navigation`/`next/cache` - calls the
// real, unmodified exported action, not a reimplementation of its logic.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(queue: Resp[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "delete", "upsert", "eq", "maybeSingle"];
  for (const m of methods) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => {
    const next = queue.shift();
    resolve(next ?? { data: null, error: null });
  };
  return chain;
}

function makeSupabase(fromQueues: Resp[][]) {
  let fromCallIndex = 0;
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => {
      const queue = fromQueues[fromCallIndex] ?? [];
      fromCallIndex += 1;
      return makeChain(queue);
    },
  };
}

const supabaseState: { current: ReturnType<typeof makeSupabase> | null } = { current: null };

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

function formData(tenderId: string) {
  const fd = new FormData();
  fd.set("tender_id", tenderId);
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

describe("clearSubcontractingPlan - delete matches zero rows (RLS race)", () => {
  it("redirects with an error, not the bare '?saved=b7', when the delete matches no row", async () => {
    supabaseState.current = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireMember's company_members lookup
      [{ data: null, error: null }], // delete - zero rows matched, no error
    ]);

    const { clearSubcontractingPlan } = await import("./b7-actions");

    const url = await expectRedirect(clearSubcontractingPlan(formData("tender-1")));

    expect(url).toContain("/tenders/tender-1?error=");
    expect(url).toContain("#form-b7");
    expect(url).not.toBe("/tenders/tender-1?saved=b7#form-b7");
  });
});

describe("clearSubcontractingPlan - delete genuinely succeeds", () => {
  it("redirects to the real success URL when the delete actually matches", async () => {
    supabaseState.current = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: { id: "plan-1" }, error: null }], // delete - real match
    ]);

    const { clearSubcontractingPlan } = await import("./b7-actions");

    const url = await expectRedirect(clearSubcontractingPlan(formData("tender-1")));

    expect(url).toBe("/tenders/tender-1?saved=b7#form-b7");
  });
});
