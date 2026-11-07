import { afterEach, describe, expect, it, vi } from "vitest";

// Finding 147 (standing review, 2026-11-07i): removePrivateTenderDocument()
// (app/app/tenders/[id]/general-actions.ts) read the post-delete
// `tender_private_documents` count with no `error` captured at all. On a
// transient read failure the Supabase client returns `count: null`, and the
// pre-fix `(count ?? 0) === 0` treated that identically to "zero private
// documents remain" - the real, destructive consequence being the "down to
// zero" branch firing and wiping this pack's `document_requirements`/
// `intake` even when real private documents are still on file (the count
// read simply failed, it didn't actually return 0). This is the opposite
// failure mode from the already-reviewed, already-accepted-as-safe
// `pack`-read failure a few lines below it (which just no-ops via `pack &&`)
// - a prior pass's own write-up ("a failed reset here just means ... is
// skipped once, leaving stale data") was about THAT read failing, not this
// one, and never separately traced what happens when the count read itself
// fails while the pack read succeeds.
//
// Mocking technique copied from the established convention
// (app/app/tenders/[id]/vault-quick-fix-actions.spec.ts and its own
// precedents): a sequential per-`.from()`-call response queue, a minimal
// thenable/chainable stub, and mocked `@/lib/supabase/server`/
// `next/navigation`/`next/cache` - calls the real, unmodified exported
// action, not a reimplementation of its logic. Extended with an `.rpc()`
// spy and an `.update()` call recorder so the test can tell apart "reset
// branch fired" from "requeue branch fired" from "neither fired", which is
// the actual behavior under test here (not just final data/error shape).

type Resp = { data: unknown; error: { message: string } | null; count?: number | null };

function makeChain(queue: Resp[], updateCalls: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "delete", "eq", "in", "maybeSingle"];
  for (const m of methods) chain[m] = () => chain;
  chain.update = (body: unknown) => {
    updateCalls.push(body);
    return chain;
  };
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => {
    const next = queue.shift();
    resolve(next ?? { data: null, error: null });
  };
  return chain;
}

function makeSupabase(fromQueues: Resp[][], rpcResp: Resp = { data: null, error: null }) {
  let fromCallIndex = 0;
  const fromCalls: string[] = [];
  const updateCalls: unknown[] = [];
  const removeCalls: { bucket: string; paths: string[] }[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        fromCalls.push(table);
        const queue = fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue, updateCalls);
      },
      storage: {
        from: (bucket: string) => ({
          remove: async (paths: string[]) => {
            removeCalls.push({ bucket, paths });
            return { data: null, error: null };
          },
        }),
      },
      rpc: async (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        return rpcResp;
      },
    },
    fromCalls,
    updateCalls,
    removeCalls,
    rpcCalls,
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

function formData(tenderId: string, docId: string) {
  const fd = new FormData();
  fd.set("tender_id", tenderId);
  fd.set("document_id", docId);
  return fd;
}

afterEach(() => {
  vi.resetModules();
  supabaseState.current = null;
});

describe("removePrivateTenderDocument - the post-delete count read fails", () => {
  it("does NOT wipe document_requirements/intake just because the count read errored, with real documents possibly still on file", async () => {
    const { client, updateCalls, rpcCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireMember's company_members lookup
      [{ data: { id: "doc-1", storage_path: "private/company-1/tender-1/x.pdf" }, error: null }], // doc select
      [{ data: null, error: null }], // delete
      [{ data: null, error: { message: "read failed" }, count: null }], // count read FAILS
      [{ data: { id: "pack-1" }, error: null }], // pack select succeeds
    ]);
    supabaseState.current = client;

    const { removePrivateTenderDocument } = await import("./general-actions");

    await expect(removePrivateTenderDocument(formData("tender-1", "doc-1"))).rejects.toThrow("NEXT_REDIRECT");

    // Neither the destructive reset (tender_packs.update wiping
    // document_requirements/intake) nor the requeue RPC should fire when the
    // count read itself failed - the real remaining-document count is
    // unknown, not necessarily zero.
    const resetCalls = updateCalls.filter(
      (c) => c && typeof c === "object" && "document_requirements" in (c as Record<string, unknown>)
    );
    expect(resetCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("removePrivateTenderDocument - count read genuinely succeeds at zero", () => {
  it("still takes the reset branch when the count read actually returns 0, not just on a guess", async () => {
    const { client, updateCalls, rpcCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: { id: "doc-1", storage_path: "private/company-1/tender-1/x.pdf" }, error: null }],
      [{ data: null, error: null }],
      [{ data: null, error: null, count: 0 }], // count read succeeds, genuinely 0
      [{ data: { id: "pack-1" }, error: null }],
    ]);
    supabaseState.current = client;

    const { removePrivateTenderDocument } = await import("./general-actions");

    await expect(removePrivateTenderDocument(formData("tender-1", "doc-1"))).rejects.toThrow("NEXT_REDIRECT");

    const resetCalls = updateCalls.filter(
      (c) => c && typeof c === "object" && "document_requirements" in (c as Record<string, unknown>)
    );
    expect(resetCalls).toHaveLength(1);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("removePrivateTenderDocument - count read genuinely succeeds above zero", () => {
  it("takes the requeue branch, never the destructive reset, when documents genuinely remain", async () => {
    const { client, updateCalls, rpcCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: { id: "doc-1", storage_path: "private/company-1/tender-1/x.pdf" }, error: null }],
      [{ data: null, error: null }],
      [{ data: null, error: null, count: 2 }], // count read succeeds, 2 remain
      [{ data: { id: "pack-1" }, error: null }],
    ]);
    supabaseState.current = client;

    const { removePrivateTenderDocument } = await import("./general-actions");

    await expect(removePrivateTenderDocument(formData("tender-1", "doc-1"))).rejects.toThrow("NEXT_REDIRECT");

    const resetCalls = updateCalls.filter(
      (c) => c && typeof c === "object" && "document_requirements" in (c as Record<string, unknown>)
    );
    expect(resetCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("request_general_job_checked");
  });
});
