import { afterEach, describe, expect, it, vi } from "vitest";

// Finding 423: uploadTenderTemplate() (app/app/tenders/[id]/pack-inputs-
// actions.ts) uploads the company's blank-template copy to the
// 'tender-documents' bucket, THEN calls record_tender_document() (0025/
// 0045) to register it. record_tender_document() can genuinely fail
// independently of the upload itself having succeeded - e.g. its own
// "Start a pack for this tender before uploading its templates" check
// (0045), or a transient RPC error - and pre-fix, that failure path never
// cleaned up the file the upload step had just put in storage: an orphan
// with nothing in this repo ever pointing at or sweeping it again.
//
// This is the same upload-then-insert-orphans-on-failure shape Finding 422
// already fixed across every file literally named `actions.ts` under
// app/app/** - pack-inputs-actions.ts sat outside that sweep's own file
// glob (it is deliberately NOT named `actions.ts`, per this file's own
// header comment: "Kept out of actions.ts so the two can change
// independently").
//
// Mocking technique copied from the established convention in this same
// directory (general-actions.spec.ts / vault-quick-fix-actions.spec.ts): a
// sequential per-`.from()`-call response queue, a minimal thenable/
// chainable stub, an `.rpc()` spy, a `.storage.from().upload()/.remove()`
// spy, and mocked `@/lib/supabase/server`/`next/navigation`/`next/cache` -
// calls the real, unmodified exported action, not a reimplementation of
// its logic.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(queue: Resp[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "in", "maybeSingle"];
  for (const m of methods) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => {
    const next = queue.shift();
    resolve(next ?? { data: null, error: null });
  };
  return chain;
}

function makeSupabase(
  fromQueues: Resp[][],
  opts: { rpcResp: Resp; uploadError?: { message: string } | null }
) {
  let fromCallIndex = 0;
  const fromCalls: string[] = [];
  const uploadCalls: { bucket: string; path: string }[] = [];
  const removeCalls: { bucket: string; paths: string[] }[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        fromCalls.push(table);
        const queue = fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue);
      },
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string) => {
            uploadCalls.push({ bucket, path });
            return { data: opts.uploadError ? null : { path }, error: opts.uploadError ?? null };
          },
          remove: async (paths: string[]) => {
            removeCalls.push({ bucket, paths });
            return { data: null, error: null };
          },
        }),
      },
      rpc: async (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        return opts.rpcResp;
      },
    },
    fromCalls,
    uploadCalls,
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

function formData(tenderId: string, docType: string, fileName: string) {
  const fd = new FormData();
  fd.set("tender_id", tenderId);
  fd.set("doc_type", docType);
  fd.set("file", new File([new Uint8Array([1, 2, 3])], fileName));
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

describe("uploadTenderTemplate - record_tender_document() fails after the upload already succeeded", () => {
  it("removes the just-uploaded object from storage instead of orphaning it forever", async () => {
    const { client, uploadCalls, removeCalls, rpcCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId's company_members lookup
      ],
      {
        rpcResp: { data: null, error: { message: "Start a pack for this tender before uploading its templates." } },
      }
    );
    supabaseState.current = client;

    const { uploadTenderTemplate } = await import("./pack-inputs-actions");

    const url = await expectRedirect(
      uploadTenderTemplate(formData("tender-1", "technical_xlsm", "Technical Submission.xlsm"))
    );

    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].bucket).toBe("tender-documents");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("record_tender_document");

    // The bug: pre-fix, nothing ever removed the object the upload call
    // above just put in storage once record_tender_document() failed.
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0].bucket).toBe("tender-documents");
    expect(removeCalls[0].paths).toEqual([uploadCalls[0].path]);

    expect(url).toContain("/tenders/tender-1");
    expect(url).toContain("error=");
  });

  it("does NOT call remove() when the upload itself is the thing that failed (nothing to clean up)", async () => {
    const { client, uploadCalls, removeCalls, rpcCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }],
      ],
      {
        rpcResp: { data: null, error: null },
        uploadError: { message: "network error" },
      }
    );
    supabaseState.current = client;

    const { uploadTenderTemplate } = await import("./pack-inputs-actions");

    await expectRedirect(
      uploadTenderTemplate(formData("tender-1", "technical_xlsm", "Technical Submission.xlsm"))
    );

    expect(uploadCalls).toHaveLength(1);
    expect(rpcCalls).toHaveLength(0); // record_tender_document is never reached
    expect(removeCalls).toHaveLength(0); // nothing was ever stored - no orphan possible
  });

  it("does not remove anything and redirects to the saved url when both the upload and the RPC succeed", async () => {
    const { client, uploadCalls, removeCalls, rpcCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }],
      ],
      { rpcResp: { data: "doc-1", error: null } }
    );
    supabaseState.current = client;

    const { uploadTenderTemplate } = await import("./pack-inputs-actions");

    const url = await expectRedirect(
      uploadTenderTemplate(formData("tender-1", "technical_xlsm", "Technical Submission.xlsm"))
    );

    expect(uploadCalls).toHaveLength(1);
    expect(rpcCalls).toHaveLength(1);
    expect(removeCalls).toHaveLength(0);
    expect(url).toContain("saved=template");
  });
});
