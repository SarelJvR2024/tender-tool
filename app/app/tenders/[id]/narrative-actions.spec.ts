import { afterEach, describe, expect, it, vi } from "vitest";

// First dedicated test file for narrative-actions.ts. Standing review,
// 2026-11-07: a from-scratch re-grep of every `.update(` site in app/app for
// the "plain update twin" RLS-zero-row shape (the one Finding 197 closed out
// for company_offices) found uploadNarrativeFinal()'s own `narrative_documents`
// update was never swept for it - PostgREST returns a 2xx with `error: null`
// and zero rows affected when RLS's own `using (is_company_member(company_id))`
// (0087) no longer matches at write time (a membership revoked between the
// `row` check and this write), indistinguishable from a real update by
// `error` alone. Pre-fix, the uploaded file replaced the fixed, deterministic
// storage object while the row's own final_* columns silently never changed
// to match - a silent mismatch, not just a silent no-op.
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
      storage: {
        from: () => ({
          upload: async () => ({ data: null, error: null }),
        }),
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

function uploadFormData(tenderId: string, docId: string) {
  const fd = new FormData();
  fd.set("tender_id", tenderId);
  fd.set("narrative_document_id", docId);
  fd.set("file", new File(["final draft"], "final.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
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

describe("uploadNarrativeFinal - narrative_documents update matches zero rows (RLS race)", () => {
  it("redirects with an error, not the bare success anchor, when the update itself matches no row", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
      [{ data: { id: "doc-1" }, error: null }], // row ownership check - still sees the row
      [{ data: null, error: null }], // narrative_documents update - zero rows matched, no error
    ]);
    supabaseState.current = client;

    const { uploadNarrativeFinal } = await import("./narrative-actions");

    const url = await expectRedirect(uploadNarrativeFinal(uploadFormData("tender-1", "doc-1")));

    expect(url).toContain("/tenders/tender-1?error=");
    expect(url).not.toBe("/tenders/tender-1#narrative-documents");
  });
});

describe("uploadNarrativeFinal - narrative_documents update genuinely succeeds", () => {
  it("redirects to the real success anchor when the update actually matches", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
      [{ data: { id: "doc-1" }, error: null }], // row ownership check
      [{ data: { id: "doc-1" }, error: null }], // narrative_documents update - real match
    ]);
    supabaseState.current = client;

    const { uploadNarrativeFinal } = await import("./narrative-actions");

    const url = await expectRedirect(uploadNarrativeFinal(uploadFormData("tender-1", "doc-1")));

    expect(url).toBe("/tenders/tender-1#narrative-documents");
  });
});
