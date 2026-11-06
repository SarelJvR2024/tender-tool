import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness test for app/company/properties/actions.ts's
// savePropertyDocument().
//
// Same bug class as 23b43b4 (app/company/registrations/actions.ts's
// saveHeldRegistration()) and this pass's own app/company/actions.ts fix
// (uploadVaultDocument()): the update branch does
// `supabase.from("property_documents").update(row).eq("id", existing.id)`
// and only checks `error`. PostgREST returns a 2xx with `error: null` and
// zero rows affected when RLS's own `using (is_company_member(company_id))`
// (0050, re-evaluated against the OLD row) no longer matches - e.g. this
// user's own company_members row being removed (another admin's
// removeMember(), 0114) between the `existing` read earlier in this same
// action and this write - indistinguishable from a real update by `error`
// alone.
//
// The consequence here is the same worse-than-an-orphan shape as the
// app/company/actions.ts fix: pre-fix, the code (a) never cleans up the
// just-uploaded new file (orphaned), AND (b) still unconditionally deletes
// the PREVIOUS document file from storage afterwards, even though the row
// was never actually updated to stop pointing at it - destroying the
// building's still-referenced, previously valid document while the UI
// reports "saved".
//
// Mocking technique and chain shape copied from the established convention
// (app/company/registrations/actions.spec.ts, app/company/actions.spec.ts)
// - calls the real, unmodified exported action, not a reimplementation.

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

function makeSupabase(opts: { fromQueues: Resp[][]; uploadError?: { message: string } | null }) {
  let fromCallIndex = 0;
  const uploadCalls: string[] = [];
  const removeCalls: string[][] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => {
        const queue = opts.fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue);
      },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            uploadCalls.push(path);
            return { data: { path }, error: opts.uploadError ?? null };
          },
          remove: async (paths: string[]) => {
            removeCalls.push(paths);
            return { data: null, error: null };
          },
        }),
      },
    },
    uploadCalls,
    removeCalls,
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

describe("savePropertyDocument - membership revoked mid-request (update matches zero rows)", () => {
  it("does not report success, does not leave the new upload orphaned, and does not delete the still-referenced previous file", async () => {
    const { client, uploadCalls, removeCalls } = makeSupabase({
      fromQueues: [
        // requireCompanyId(): company_members select
        [{ data: { company_id: "company-1" }, error: null }],
        // existing property_documents select - still a member at this point
        [{ data: { id: "doc-1", storage_path: "company-1/properties/prop-1/title_deed/old-old.pdf" }, error: null }],
        // update(row).eq("id", existing.id) - membership revoked in between
        // -> RLS's own `using (is_company_member(company_id))` matches 0
        // rows, real PostgREST behaviour is {error: null}, not an error.
        [{ data: null, error: null }],
      ],
    });
    supabaseState.current = client;

    const { savePropertyDocument } = await import("./actions");

    const fd = formDataWith({ property_id: "prop-1", document_type: "title_deed" });
    fd.set("file", new File(["pdf-bytes"], "title-deed.pdf", { type: "application/pdf" }));

    const url = await expectRedirect(savePropertyDocument(fd));

    // The real, fixed behaviour: redirected with an error, not `saved=doc`.
    expect(url).not.toContain("saved=doc");
    expect(url).toContain("/company/properties?error=");

    expect(uploadCalls).toHaveLength(1); // upload happens before the update
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain(uploadCalls[0]); // new upload cleaned up
    expect(removedPaths).not.toContain("company-1/properties/prop-1/title_deed/old-old.pdf"); // previous file preserved
  });
});

describe("savePropertyDocument - real update still succeeds", () => {
  it("still saves normally and swaps the previous file out when the update genuinely matches the row", async () => {
    const { client, uploadCalls, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [{ data: { id: "doc-1", storage_path: "company-1/properties/prop-1/title_deed/old-old.pdf" }, error: null }],
        [{ data: { id: "doc-1" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { savePropertyDocument } = await import("./actions");

    const fd = formDataWith({ property_id: "prop-1", document_type: "title_deed" });
    fd.set("file", new File(["pdf-bytes"], "title-deed.pdf", { type: "application/pdf" }));

    const url = await expectRedirect(savePropertyDocument(fd));

    expect(url).toContain("saved=doc");
    expect(uploadCalls).toHaveLength(1);
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain("company-1/properties/prop-1/title_deed/old-old.pdf");
  });
});
