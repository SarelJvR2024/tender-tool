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

// Same bug class, found this pass in two sibling functions of this same file:
// saveProperty()'s edit branch (`.update(row).eq("id", id)`, no `.select()`)
// and, worse, deleteProperty() - which reads the building's OWN documents'
// storage paths BEFORE deleting the building row, then unconditionally
// removes those files from storage regardless of whether the delete actually
// matched a row. On the same membership-revoked-mid-request race, the
// building row survives untouched while its real, still-referenced document
// files are destroyed - and the page reports "removed".
describe("saveProperty - membership revoked mid-request (edit matches zero rows)", () => {
  it("does not report success when the update matches zero rows", async () => {
    const { client } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()
        [{ data: null, error: null }], // update(row).eq("id", id) - 0 rows matched
      ],
    });
    supabaseState.current = client;

    const { saveProperty } = await import("./actions");

    const fd = formDataWith({ property_id: "prop-1", label: "Main Road offices" });

    const url = await expectRedirect(saveProperty(fd));

    expect(url).not.toContain("saved=1");
    expect(url).toContain("/company/properties?error=");
  });
});

describe("deleteProperty - membership revoked mid-request (delete matches zero rows)", () => {
  it("does not report success and does not destroy the building's still-referenced documents", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()
        // property_documents select for storage paths - still readable (its
        // own RLS is keyed off property_id/company_id, not this user's
        // membership row directly)
        [{ data: [{ storage_path: "company-1/properties/prop-1/title_deed/deed.pdf" }], error: null }],
        // delete(...).eq("id", id) - membership revoked in between -> 0 rows
        [{ data: null, error: null }],
      ],
    });
    supabaseState.current = client;

    const { deleteProperty } = await import("./actions");

    const fd = formDataWith({ property_id: "prop-1" });

    const url = await expectRedirect(deleteProperty(fd));

    expect(url).not.toContain("saved=removed");
    expect(url).toContain("/company/properties?error=");
    expect(removeCalls).toHaveLength(0); // the real document file must survive
  });
});

describe("deleteProperty - real delete still succeeds", () => {
  it("still removes the building's documents from storage when the delete genuinely matches the row", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [{ data: [{ storage_path: "company-1/properties/prop-1/title_deed/deed.pdf" }], error: null }],
        [{ data: { id: "prop-1" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { deleteProperty } = await import("./actions");

    const fd = formDataWith({ property_id: "prop-1" });

    const url = await expectRedirect(deleteProperty(fd));

    expect(url).toContain("saved=removed");
    expect(removeCalls.flat()).toContain("company-1/properties/prop-1/title_deed/deed.pdf");
  });
});

// Second, SEPARATE race in savePropertyDocument()'s update branch - a
// storage-layer one, not an RLS one (standing review, 2026-11-09). Same
// shape, same fix, as app/company/actions.ts uploadVaultDocument(): two
// near-simultaneous "replace this building's document" submits both read
// the same `existing.storage_path` before either writes, both uploads
// succeed (distinct random paths), and the pre-fix update has no filter on
// `storage_path` itself, so both updates would unconditionally succeed too -
// whichever commits last wins the row, orphaning the other request's own
// new file forever. Needs a genuinely stateful mock (not the FIFO queue
// above): both requests' own reads must land before either one's own write
// commits.
describe("savePropertyDocument - two concurrent replace requests (both succeed, no RLS failure)", () => {
  it("lets exactly one request win the row, and cleans up the LOSER's own new upload immediately - no orphan, no silent double success", async () => {
    const ORIGINAL_PATH = "company-1/properties/prop-1/title_deed/old-old.pdf";
    const state: { storagePath: string | null } = { storagePath: ORIGINAL_PATH };
    const uploadCalls: string[] = [];
    const removeCalls: string[][] = [];

    function makePropertyDocumentsChain() {
      const filters: Record<string, unknown> = {};
      let isUpdate = false;
      let patch: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.update = (p: Record<string, unknown>) => {
        isUpdate = true;
        patch = p;
        return chain;
      };
      chain.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      };
      chain.is = (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      };
      chain.maybeSingle = () => chain;
      (chain as { then: (resolve: (r: unknown) => void) => void }).then = (resolve) => {
        if (!isUpdate) {
          resolve({ data: { id: "doc-1", storage_path: state.storagePath }, error: null });
          return;
        }
        const matches = !("storage_path" in filters) || filters.storage_path === state.storagePath;
        if (matches) {
          state.storagePath = patch.storage_path as string;
          resolve({ data: { id: "doc-1" }, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      };
      return chain;
    }

    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        if (table === "property_documents") return makePropertyDocumentsChain();
        // company_members, for requireCompanyId() - always a real member here.
        return makeChain([{ data: { company_id: "company-1" }, error: null }]);
      },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            uploadCalls.push(path);
            await new Promise((r) => setTimeout(r, path.includes("request-b") ? 5 : 20));
            return { data: { path }, error: null };
          },
          remove: async (paths: string[]) => {
            removeCalls.push(paths);
            return { data: null, error: null };
          },
        }),
      },
    };
    supabaseState.current = client as unknown as ReturnType<typeof makeSupabase>["client"];

    const { savePropertyDocument } = await import("./actions");

    const fdA = formDataWith({ property_id: "prop-1", document_type: "title_deed" });
    fdA.set("file", new File(["pdf-bytes-a"], "request-a-title-deed.pdf", { type: "application/pdf" }));
    const fdB = formDataWith({ property_id: "prop-1", document_type: "title_deed" });
    fdB.set("file", new File(["pdf-bytes-b"], "request-b-title-deed.pdf", { type: "application/pdf" }));

    const [urlA, urlB] = await Promise.all([
      expectRedirect(savePropertyDocument(fdA)),
      expectRedirect(savePropertyDocument(fdB)),
    ]);

    expect(uploadCalls).toHaveLength(2);
    const pathA = uploadCalls.find((p) => p.includes("request-a"))!;
    const pathB = uploadCalls.find((p) => p.includes("request-b"))!;

    const successes = [urlA, urlB].filter((u) => u.includes("saved=doc"));
    const failures = [urlA, urlB].filter((u) => u.includes("/company/properties?error="));

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const finalValue = state.storagePath;
    expect([pathA, pathB]).toContain(finalValue);
    const loserPath = finalValue === pathA ? pathB : pathA;

    expect(removeCalls.flat()).toContain(ORIGINAL_PATH);
    expect(removeCalls.flat()).toContain(loserPath);
    expect(removeCalls.flat()).not.toContain(finalValue);
  });
});
