import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness tests for app/my-cv/actions.ts.
//
// Same bug class as every other "membership-revoked-mid-request" fix in this
// repo (23b43b4, 7345243, 0a3ac73, 7434ddb, d0d9414, ...): an
// `.update(...).eq("id", id)` checked only by `error`. PostgREST returns a
// 2xx with `error: null` and zero rows affected when RLS's own USING clause
// (re-evaluated against the OLD row) no longer matches at write time, even
// though an earlier read in the same request saw the row.
//
// This file's own gate is slightly different from the company-membership
// instances already fixed elsewhere: every write here is also narrowed by
// 0077's "employee restricted to own record"/"...own person" RESTRICTIVE
// policies, keyed on people.linked_user_id = auth.uid() (own_linked_person_id()).
// The realistic trigger is an owner/admin unlinking this person (clearing
// people.linked_user_id, e.g. correcting a mistaken link or off-boarding
// someone) - or removing the signed-in user's own company_members row
// outright - while their My CV form is still open/submitting. No file
// upload is unconditionally destroyed here (unlike the company/experience/
// properties instances), but each write still silently no-ops while the
// page reports success, and applyMyCvExtraction()'s second write can leave
// a real AI-extracted CV result permanently stuck on 'pending_review' with
// the UI believing it was already applied.
//
// my-cv/actions.ts was never swept for this bug class by any prior pass
// (every prior sweep covered app/app/people/actions.ts, company/*, and
// experience/actions.ts - a different file under app/app/my-cv/ with its
// own self-service requireOwnPerson() gate). Found and fixed in the standing
// solution-architect review, 2026-11-06.
//
// Mocking technique and chain shape copied from the established convention
// (app/company/actions.spec.ts, app/experience/actions.spec.ts, ...) - calls
// the real, unmodified exported action, not a reimplementation of its logic.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(queue: Resp[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "update", "insert", "delete", "eq", "order", "single"];
  for (const m of methods) chain[m] = () => chain;
  chain.maybeSingle = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => {
    const next = queue.shift();
    resolve(next ?? { data: null, error: null });
  };
  return chain;
}

function makeSupabase(fromQueues: Resp[][], rpcQueue: Resp[] = []) {
  let fromCallIndex = 0;
  let rpcCallIndex = 0;
  const rpcCalls: { name: string; params: unknown }[] = [];
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => {
      const queue = fromQueues[fromCallIndex] ?? [];
      fromCallIndex += 1;
      return makeChain(queue);
    },
    // apply_my_cv_extraction_checked() (0123) moved the read-gate-write
    // sequence into one locked Postgres transaction - from this TS-level
    // mock's point of view that's a single rpc() call, queued the same way
    // .from() responses are.
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push({ name, params });
      const next = rpcQueue[rpcCallIndex] ?? { data: null, error: null };
      rpcCallIndex += 1;
      return next;
    },
    rpcCalls,
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

// requireOwnPerson()'s own two reads - a genuine member, linked to a person.
// A function, not a shared constant: makeChain's own queue.shift() mutates
// whatever array it's given, so a module-level constant reused (even via
// spread, which only shallow-copies the outer array) across tests would be
// emptied by the first test and starve every later one.
function requireOwnPersonOk(): Resp[][] {
  return [
    [{ data: { company_id: "company-1" }, error: null }], // company_members select
    [{ data: { id: "person-1" }, error: null }], // people select (linked_user_id match)
  ];
}

describe("saveMyDetails - membership/link revoked mid-request (people update matches zero rows)", () => {
  it("does not report success when the update matches zero rows", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: null, error: null }], // update().select("id").maybeSingle() - zero-row RLS match
    ]);

    const { saveMyDetails } = await import("./actions");
    const url = await expectRedirect(saveMyDetails(formDataWith({ phone: "0821234567" })));

    expect(url).not.toContain("saved=details");
    expect(url).toContain("/my-cv?error=");
  });
});

describe("saveMyDetails - real update still succeeds", () => {
  it("saves normally when the update genuinely matches the row", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: { id: "person-1" }, error: null }], // real match
    ]);

    const { saveMyDetails } = await import("./actions");
    const url = await expectRedirect(saveMyDetails(formDataWith({ phone: "0821234567" })));

    expect(url).toBe("/my-cv?saved=details");
  });
});

const EXTRACTION_FORM = {
  extraction_id: "extraction-1",
  use_ecsa_level: "on",
  f_ecsa_level: "Pr Eng",
};

// applyMyCvExtraction()'s own person-update-then-mark-applied sequence used
// to be two separate, unlocked writes, the second of which never re-checked
// review_status in its own .eq() chain - the exact gap this file's own
// discardMyCvExtraction() (below) was already fixed for (standing review,
// 2026-11-06), never applied to its "apply" twin until now. Moved into one
// locked SQL transaction (apply_my_cv_extraction_checked, 0123) - standing
// review, 2026-11-07 (Server Action read-then-write/TOCTOU-gate sweep). From
// this TS-level mock's point of view, the write is now a single rpc() call.
describe("applyMyCvExtraction - apply_my_cv_extraction_checked rpc reports a failure", () => {
  it("does not report success", async () => {
    supabaseState.current = makeSupabase(
      [
        ...requireOwnPersonOk(),
        [{ data: { id: "extraction-1", person_id: "person-1", review_status: "pending_review", proposed: {} }, error: null }], // cv_extraction_results read
      ],
      [{ data: null, error: { message: "These extracted fields were already saved or discarded." } }],
    );

    const { applyMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(applyMyCvExtraction(formDataWith(EXTRACTION_FORM)));

    expect(url).not.toContain("saved=extracted");
    expect(url).toContain("/my-cv?error=");
    expect(url).toContain(encodeURIComponent("already saved or discarded"));
  });
});

describe("applyMyCvExtraction - apply_my_cv_extraction_checked rpc succeeds", () => {
  it("saves and marks the extraction applied, passing the ticked fields through to the rpc call", async () => {
    const supabase = makeSupabase(
      [
        ...requireOwnPersonOk(),
        [{ data: { id: "extraction-1", person_id: "person-1", review_status: "pending_review", proposed: {} }, error: null }],
      ],
      [{ data: null, error: null }],
    );
    supabaseState.current = supabase;

    const { applyMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(applyMyCvExtraction(formDataWith(EXTRACTION_FORM)));

    expect(url).toBe("/my-cv?saved=extracted");
    expect(supabase.rpcCalls).toHaveLength(1);
    expect(supabase.rpcCalls[0].name).toBe("apply_my_cv_extraction_checked");
    const params = supabase.rpcCalls[0].params as { p_person_fields: Record<string, string> };
    expect(params.p_person_fields).toEqual({ ecsa_level: "Pr Eng" });
  });
});

describe("discardMyCvExtraction - matches zero rows (revoked mid-request, or already moved on)", () => {
  it("does not redirect as if the discard happened", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: null, error: null }], // update().select("id").maybeSingle() - zero-row match
    ]);

    const { discardMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(discardMyCvExtraction(formDataWith({ extraction_id: "extraction-1" })));

    expect(url).toContain("/my-cv?error=");
  });
});

describe("discardMyCvExtraction - real update still succeeds", () => {
  it("redirects back to /my-cv with no error when the discard genuinely matches", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: { id: "extraction-1" }, error: null }],
    ]);

    const { discardMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(discardMyCvExtraction(formDataWith({ extraction_id: "extraction-1" })));

    expect(url).toBe("/my-cv");
  });
});
