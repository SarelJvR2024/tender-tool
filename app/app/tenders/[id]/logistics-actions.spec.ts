import { afterEach, describe, expect, it, vi } from "vitest";

// First dedicated test file for logistics-actions.ts. Standing review,
// 2026-11-07: a from-scratch re-grep of every `.update(` site in app/app for
// the "plain update twin" RLS-zero-row shape (the one Finding 197 closed out
// for company_offices) found saveSubmissionLogistics()'s own `tender_packs`
// update was never swept for it - PostgREST returns a 2xx with `error: null`
// and zero rows affected when RLS's own `using (is_company_member(company_id))`
// (0001) no longer matches at write time (a membership revoked mid-request),
// indistinguishable from a real update by `error` alone. Pre-fix, the form
// still redirected "saved=logistics" even though nothing was actually saved.
//
// Mocking technique copied from the established convention
// (app/app/company/officeActions.spec.ts and its own precedents): a
// sequential per-`.from()`-call response queue, a minimal thenable/chainable
// stub, and a mocked `@/lib/supabase/server`/`next/navigation`/`next/cache` -
// calls the real, unmodified exported action, not a reimplementation of its
// logic.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(queue: Resp[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "update", "eq", "maybeSingle"];
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
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => {
        const queue = fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue);
      },
    },
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

function logisticsFormData(tenderId: string) {
  const fd = new FormData();
  fd.set("tender_id", tenderId);
  fd.set("submission_type", "email");
  fd.set("estimated_print_hours", "2");
  fd.set("estimated_transit_hours", "4");
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

describe("saveSubmissionLogistics - tender_packs update matches zero rows (RLS race)", () => {
  it("redirects with an error, not the bare 'saved=logistics', when the update itself matches no row", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireMember
      [{ data: null, error: null }], // tender_packs update - zero rows matched, no error
    ]);
    supabaseState.current = client;

    const { saveSubmissionLogistics } = await import("./logistics-actions");

    const url = await expectRedirect(saveSubmissionLogistics(logisticsFormData("tender-1")));

    expect(url).toContain("/tenders/tender-1?error=");
    expect(url).not.toContain("saved=logistics");
  });
});

describe("saveSubmissionLogistics - tender_packs update genuinely succeeds", () => {
  it("redirects to the real success URL when the update actually matches", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireMember
      [{ data: { id: "pack-1" }, error: null }], // tender_packs update - real match
    ]);
    supabaseState.current = client;

    const { saveSubmissionLogistics } = await import("./logistics-actions");

    const url = await expectRedirect(saveSubmissionLogistics(logisticsFormData("tender-1")));

    expect(url).toContain("saved=logistics");
  });
});
