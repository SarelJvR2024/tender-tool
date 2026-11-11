import { afterEach, describe, expect, it, vi } from "vitest";

// Finding 391 (standing QA/robustness review, 2026-11-11): cleanDocuments()
// rejects the WHOLE batch the moment any ONE entry's path is invalid - but
// the browser has already put every file in Storage before calling this
// action (this file's own header comment). addManualTenderDocuments()/
// addPrivateTenderDocuments() had no cleanup at all when cleanDocuments()
// returned null, so a batch with one bad path alongside an otherwise
// genuinely-uploaded file left that real file orphaned in Storage forever.
// registerManualTender() already had this fixed (2026-11-09) for its own
// no-docs refusal; it was never swept to its two siblings in this file.
// First dedicated test file for actions.ts - confirmed by grep, zero
// coverage existed for any of its three exported actions before this pass.
//
// Mocking technique copied from the established convention
// (logistics-actions.spec.ts and its own precedents): a minimal
// thenable/chainable stub plus explicit spies for rpc()/storage.remove(),
// and a mocked @/lib/supabase/server / next/navigation / next/cache -
// calls the real, unmodified exported actions, not a reimplementation.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(resp: Resp) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "insert"];
  for (const m of methods) chain[m] = () => chain;
  (chain as { maybeSingle: unknown }).maybeSingle = async () => resp;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => resolve(resp);
  return chain;
}

function makeSupabase(opts: {
  membership?: Resp;
  rpc?: Resp;
  pack?: Resp;
  insert?: Resp;
  jobInsert?: Resp;
}) {
  const removeCalls: string[][] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      if (table === "company_members") return makeChain(opts.membership ?? { data: { company_id: "company-1" }, error: null });
      if (table === "tender_packs") return makeChain(opts.pack ?? { data: { id: "pack-1" }, error: null });
      if (table === "tender_private_documents") return makeChain(opts.insert ?? { data: null, error: null });
      // tender_engine_jobs or anything else: a no-op successful insert
      return makeChain(opts.jobInsert ?? { data: null, error: null });
    },
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return opts.rpc ?? { data: true, error: null };
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removeCalls.push(paths);
          return { data: null, error: null };
        },
      }),
    },
  };
  return { client, removeCalls, rpcCalls };
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

const TENDER_ID = "11111111-1111-1111-1111-111111111111";
const COMPANY_ID = "company-1";
const VALID_PATH = `manual/${COMPANY_ID}/${TENDER_ID}/real-upload.pdf`;
const PRIVATE_VALID_PATH = `private/${COMPANY_ID}/${TENDER_ID}/real-upload.pdf`;

describe("addManualTenderDocuments - cleanDocuments() rejects the whole batch", () => {
  it("still removes the genuinely-uploaded, valid-prefix file from Storage, not just returns an error", async () => {
    const { client, removeCalls } = makeSupabase({});
    supabaseState.current = client;
    const { addManualTenderDocuments } = await import("./actions");

    const result = await addManualTenderDocuments({
      tenderId: TENDER_ID,
      documents: [
        { title: "Real doc", storage_path: VALID_PATH },
        { title: "Bad entry", storage_path: "some/other/company/escape.pdf" },
      ],
    });

    expect(result).toEqual({ error: "Choose at least one document." });
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0]).toEqual([VALID_PATH]);
  });

  it("never asks Storage to remove the invalid-prefix path itself", async () => {
    const { client, removeCalls } = makeSupabase({});
    supabaseState.current = client;
    const { addManualTenderDocuments } = await import("./actions");

    await addManualTenderDocuments({
      tenderId: TENDER_ID,
      documents: [
        { title: "Real doc", storage_path: VALID_PATH },
        { title: "Bad entry", storage_path: "some/other/company/escape.pdf" },
      ],
    });

    expect(removeCalls.flat()).not.toContain("some/other/company/escape.pdf");
  });

  it("a fully valid batch is accepted and reaches the RPC, no cleanup called", async () => {
    const { client, removeCalls, rpcCalls } = makeSupabase({});
    supabaseState.current = client;
    const { addManualTenderDocuments } = await import("./actions");

    const url = await expectRedirect(
      addManualTenderDocuments({ tenderId: TENDER_ID, documents: [{ title: "Real doc", storage_path: VALID_PATH }] }),
    );

    expect(url).toContain("saved=intake");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("add_manual_tender_documents");
    expect(removeCalls).toHaveLength(0);
  });
});

describe("addPrivateTenderDocuments - cleanDocuments() rejects the whole batch", () => {
  it("still removes the genuinely-uploaded, valid-prefix file from Storage, not just returns an error", async () => {
    const { client, removeCalls } = makeSupabase({});
    supabaseState.current = client;
    const { addPrivateTenderDocuments } = await import("./actions");

    const result = await addPrivateTenderDocuments({
      tenderId: TENDER_ID,
      documents: [
        { title: "Real doc", storage_path: PRIVATE_VALID_PATH },
        { title: "Bad entry", storage_path: "manual/other-company/escape.pdf" },
      ],
    });

    expect(result).toEqual({ error: "Choose at least one document." });
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0]).toEqual([PRIVATE_VALID_PATH]);
  });
});
