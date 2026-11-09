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

function makeSupabase(
  fromQueues: Resp[][],
  rpcResp: Resp = { data: null, error: null },
  uploadResp: { error: { message: string } | null } = { error: null },
) {
  let fromCallIndex = 0;
  const fromCalls: string[] = [];
  const updateCalls: unknown[] = [];
  const removeCalls: { bucket: string; paths: string[] }[] = [];
  const uploadCalls: { bucket: string; path: string }[] = [];
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
          upload: async (path: string) => {
            uploadCalls.push({ bucket, path });
            return uploadResp;
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
    uploadCalls,
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

// Standing review, 2026-11-07: a from-scratch re-grep of every `.update(`
// site in app/app for the "plain update twin" RLS-zero-row shape (the one
// Finding 197 closed out for company_offices) found saveGeneralAnswers()'s
// own `companies` update was never swept for it - PostgREST returns a 2xx
// with `error: null` and zero rows affected when RLS's own `using
// (is_company_member(id))` (0001) no longer matches at write time (a
// membership revoked mid-request), indistinguishable from a real update by
// `error` alone. Pre-fix, the function still redirected "?saved=answers"
// with no indication the company-fields half of the save never took effect.
function generalAnswersFormData(tenderId: string) {
  const fd = new FormData();
  fd.set("tender_id", tenderId);
  fd.set("c:sars_tcs_pin", "ABC123");
  return fd;
}

const genericManifest = { questions: [], company_fields: [{ column: "sars_tcs_pin" }] };

describe("saveGeneralAnswers - companies update matches zero rows (RLS race)", () => {
  it("redirects with an error, not the bare '?saved=answers', when the companies update matches no row", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireMember
      [{ data: null, error: null }], // tenders select
      [{ data: { document_requirements: genericManifest }, error: null }], // tender_packs select (ownPack)
      [{ data: null, error: null }], // companies update - zero rows matched, no error
    ]);
    supabaseState.current = client;

    const { saveGeneralAnswers } = await import("./general-actions");

    const url = await expectRedirect(saveGeneralAnswers(generalAnswersFormData("tender-1")));

    expect(url).toContain("/tenders/tender-1?error=");
    expect(url).not.toBe("/tenders/tender-1?saved=answers#general-preparation");
  });
});

describe("saveGeneralAnswers - companies update genuinely succeeds", () => {
  it("redirects to the real success URL when the update actually matches", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireMember
      [{ data: null, error: null }], // tenders select
      [{ data: { document_requirements: genericManifest }, error: null }], // tender_packs select (ownPack)
      [{ data: { id: "company-1" }, error: null }], // companies update - real match
    ]);
    supabaseState.current = client;

    const { saveGeneralAnswers } = await import("./general-actions");

    const url = await expectRedirect(saveGeneralAnswers(generalAnswersFormData("tender-1")));

    expect(url).toBe("/tenders/tender-1?saved=answers#general-preparation");
  });
});

// Standing review finding, 2026-11-09, continuing Finding 231:
// uploadTenderDocument() wrote via .upsert(onConflict: "company_id,
// tender_id,field_key"), the identical "replace a document, storage race"
// shape Finding 231 fixed at six other, update()-based sites - but upsert
// can't take that fix's own `.eq(column, previousPath)` filter (PostgREST
// upsert has no row-level WHERE of its own). Fixed by moving the write into
// replace_tender_answer_document() (0125), a SECURITY DEFINER function that
// locks the company row and re-checks the row's current storage_path
// against what this request read before uploading, raising instead of
// overwriting on a mismatch. The actual two-session race is reproduced
// directly in a disposable scratch Postgres database (see migration 0125's
// own header comment) - these tests only check this Server Action's own
// wiring: the RPC is called with the right arguments, and either outcome
// (success or a raised conflict) is handled the same way Finding 231's own
// sites already were (clean up THIS request's own upload on failure, never
// touch the still-referenced previous file; delete the superseded previous
// file only once the write that replaces it has actually committed).
function uploadDocFormData(tenderId: string, key: string, file: File) {
  const fd = new FormData();
  fd.set("tender_id", tenderId);
  fd.set("returnable_key", key);
  fd.set("file", file);
  return fd;
}

describe("uploadTenderDocument - replace_tender_answer_document raises a conflict (another request just replaced it)", () => {
  it("cleans up THIS request's own just-uploaded file, surfaces the real conflict message, and does not touch the previous file", async () => {
    const file = new File(["bytes"], "municipal.pdf", { type: "application/pdf" });
    const { client, uploadCalls, removeCalls, rpcCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }], // requireMember
        [{ data: { storage_path: "company-1/tenders/tender-1/old-uuid-old.pdf" }, error: null }], // existing answer
      ],
      { data: null, error: { message: "This document was just replaced in another tab or request - refresh and try again." } },
    );
    supabaseState.current = client;

    const { uploadTenderDocument } = await import("./general-actions");

    const url = await expectRedirect(uploadTenderDocument(uploadDocFormData("tender-1", "municipal_account", file)));

    expect(url).toContain("/tenders/tender-1");
    expect(url).toContain(encodeURIComponent("just replaced in another tab or request"));

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("replace_tender_answer_document");
    const args = rpcCalls[0].args as Record<string, unknown>;
    expect(args.p_expected_previous_path).toBe("company-1/tenders/tender-1/old-uuid-old.pdf");
    expect(args.p_field_key).toBe("upload:municipal_account");

    // This request's own new upload is cleaned up (it lost the race)...
    expect(uploadCalls).toHaveLength(1);
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0].paths).toEqual([uploadCalls[0].path]);
    // ...and the PREVIOUS file (still the real, current one - this request
    // never actually won) is never touched.
    expect(removeCalls[0].paths).not.toContain("company-1/tenders/tender-1/old-uuid-old.pdf");
  });
});

describe("uploadTenderDocument - replace_tender_answer_document succeeds", () => {
  it("deletes the superseded previous file and redirects to the real success URL", async () => {
    const file = new File(["bytes"], "municipal.pdf", { type: "application/pdf" });
    const { client, removeCalls, rpcCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireMember
      [{ data: { storage_path: "company-1/tenders/tender-1/old-uuid-old.pdf" }, error: null }], // existing answer
    ]); // default rpcResp: { data: null, error: null } - success

    supabaseState.current = client;

    const { uploadTenderDocument } = await import("./general-actions");

    const url = await expectRedirect(uploadTenderDocument(uploadDocFormData("tender-1", "municipal_account", file)));

    expect(url).toBe("/tenders/tender-1?saved=doc#general-preparation");
    expect(rpcCalls).toHaveLength(1);
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0].paths).toEqual(["company-1/tenders/tender-1/old-uuid-old.pdf"]);
  });
});

describe("uploadTenderDocument - no previous document on file", () => {
  it("does not try to delete anything when there was nothing to replace", async () => {
    const file = new File(["bytes"], "municipal.pdf", { type: "application/pdf" });
    const { client, removeCalls, rpcCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireMember
      [{ data: null, error: null }], // no existing answer
    ]);

    supabaseState.current = client;

    const { uploadTenderDocument } = await import("./general-actions");

    const url = await expectRedirect(uploadTenderDocument(uploadDocFormData("tender-1", "municipal_account", file)));

    expect(url).toBe("/tenders/tender-1?saved=doc#general-preparation");
    const args = rpcCalls[0].args as Record<string, unknown>;
    expect(args.p_expected_previous_path).toBeNull();
    expect(removeCalls).toHaveLength(0);
  });
});
