import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness test for app/experience/actions.ts's
// saveExperienceTags().
//
// Same bug class as 23b43b4 (app/company/registrations/actions.ts's
// saveHeldRegistration()) and the two 7345243 fixes (app/company/actions.ts's
// uploadVaultDocument(), app/company/properties/actions.ts's
// savePropertyDocument()).
//
// saveExperienceTags() does, when a replacement file is attached:
//   1. select the item's current storage_path (the replaced document, if
//      any) - gated by "experience_items: tenant isolation" (using
//      (is_company_member(company_id)), 0012).
//   2. upload the new file to storage.
//   3. `supabase.from("experience_items").update(update).eq("id", id)` -
//      same policy, USING only, re-evaluated against the OLD row - checking
//      only `error`.
//   4. unconditionally remove the REPLACED file from storage, with no gate
//      on step 3 having actually matched a row.
//
// If the signed-in user's own company_members row is deleted between step 1
// and step 3 - another admin calling removeMember() (remove_member_checked(),
// 0114) on this same user while their tagging form is still open/submitting
// - PostgREST's real behaviour for step 3 is a 2xx with zero rows affected
// and `error: null`, indistinguishable from "it matched" by looking at
// `error` alone. Pre-fix, the code then: (a) never cleans up the
// just-uploaded replacement file (orphaned), AND (b) still unconditionally
// deletes the REPLACED file from storage at step 4, even though the row was
// never actually updated to stop pointing at it - destroying the company's
// own, still-referenced, previously valid evidence document from storage
// while the UI reports "saved".
//
// Mocking technique and chain shape copied from the established convention
// (app/company/registrations/actions.spec.ts, app/company/actions.spec.ts,
// app/company/properties/actions.spec.ts) - calls the real, unmodified
// exported action, not a reimplementation of its logic.

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

describe("saveExperienceTags - membership revoked mid-request (update matches zero rows)", () => {
  it("does not report success, does not leave the new upload orphaned, and does not delete the still-referenced replaced file", async () => {
    const { client, uploadCalls, removeCalls } = makeSupabase({
      fromQueues: [
        // requireCompanyId(): company_members select
        [{ data: { company_id: "company-1" }, error: null }],
        // existing experience_items select (storage_path) - still a member
        // at this point
        [{ data: { storage_path: "company-1/experience/old-old.pdf" }, error: null }],
        // update(update).eq("id", id) - membership revoked in between ->
        // RLS's own `using (is_company_member(company_id))` matches 0 rows,
        // real PostgREST behaviour is {error: null}, not an error.
        [{ data: null, error: null }],
      ],
    });
    supabaseState.current = client;

    const { saveExperienceTags } = await import("./actions");

    const fd = formDataWith({ id: "exp-1", project_name: "N1 upgrade", document_type: "reference_letter" });
    fd.append("disciplines", "roads_civil");
    fd.set("file", new File(["pdf-bytes"], "reference.pdf", { type: "application/pdf" }));

    const url = await expectRedirect(saveExperienceTags(fd));

    // The real, fixed behaviour: redirected with an error, not back to the
    // item's page without one.
    expect(url).toContain("/experience/exp-1?error=");

    expect(uploadCalls).toHaveLength(1); // upload happens before the update
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain(uploadCalls[0]); // new upload cleaned up... (not explicitly done by this fix, see note below)
  });
});

describe("saveExperienceTags - real update still succeeds", () => {
  it("still saves normally and replaces the previous file when the update genuinely matches the row", async () => {
    const { client, uploadCalls, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [{ data: { storage_path: "company-1/experience/old-old.pdf" }, error: null }],
        [{ data: { id: "exp-1" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { saveExperienceTags } = await import("./actions");

    const fd = formDataWith({ id: "exp-1", project_name: "N1 upgrade", document_type: "reference_letter" });
    fd.append("disciplines", "roads_civil");
    fd.set("file", new File(["pdf-bytes"], "reference.pdf", { type: "application/pdf" }));

    const url = await expectRedirect(saveExperienceTags(fd));

    expect(url).not.toContain("error=");
    expect(uploadCalls).toHaveLength(1);
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain("company-1/experience/old-old.pdf");
  });
});

// Same bug class, found this pass in deleteExperience() in this same file -
// worse than saveExperienceTags() above, since the pre-fix code didn't even
// check `error` on the delete call. It reads the item's own storage_path
// BEFORE deleting the row, then unconditionally removes that file from
// storage with no gate on the delete having actually matched a row. On the
// same membership-revoked-mid-request race, the item survives untouched
// while its real, still-referenced evidence document is destroyed from
// storage - and the page is left showing nothing wrong at all (no error
// query param either, pre-fix).
describe("deleteExperience - membership revoked mid-request (delete matches zero rows)", () => {
  it("does not destroy the still-referenced evidence file and surfaces an error", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()
        [{ data: { storage_path: "company-1/experience/evidence.pdf" }, error: null }], // existing select
        [{ data: null, error: null }], // delete(...).eq("id", id) - 0 rows matched
      ],
    });
    supabaseState.current = client;

    const { deleteExperience } = await import("./actions");

    const fd = formDataWith({ id: "exp-1" });

    const url = await expectRedirect(deleteExperience(fd));

    expect(url).toContain("/experience?error=");
    expect(removeCalls).toHaveLength(0); // the real evidence file must survive
  });
});

describe("deleteExperience - real delete still succeeds", () => {
  it("still removes the evidence file from storage when the delete genuinely matches the row", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [{ data: { storage_path: "company-1/experience/evidence.pdf" }, error: null }],
        [{ data: { id: "exp-1" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { deleteExperience } = await import("./actions");

    const fd = formDataWith({ id: "exp-1" });

    const url = await expectRedirect(deleteExperience(fd));

    expect(url).toBe("/experience");
    expect(removeCalls.flat()).toContain("company-1/experience/evidence.pdf");
  });
});

// Second, SEPARATE race in saveExperienceTags() - a storage-layer one, not
// an RLS one (standing review, 2026-11-09). Same shape, same fix, as
// app/company/actions.ts uploadVaultDocument(): two near-simultaneous
// "attach/replace the evidence document" submits for the SAME item both
// read the same `replacedPath` before either writes, both uploads succeed
// (distinct random paths), and the pre-fix update has no filter on
// `storage_path` itself, so both updates would unconditionally succeed too -
// whichever commits last wins the row, orphaning the other request's own
// new file forever. Needs a genuinely stateful mock (not the FIFO queue
// above): both requests' own reads must land before either one's own write
// commits.
describe("saveExperienceTags - two concurrent replace requests (both succeed, no RLS failure)", () => {
  it("lets exactly one request win the row, and cleans up the LOSER's own new upload immediately - no orphan, no silent double success", async () => {
    const ORIGINAL_PATH = "company-1/experience/old-old-reference.pdf";
    const state: { storagePath: string | null } = { storagePath: ORIGINAL_PATH };
    const uploadCalls: string[] = [];
    const removeCalls: string[][] = [];

    function makeExperienceItemsChain() {
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
          resolve({ data: { storage_path: state.storagePath }, error: null });
          return;
        }
        const matches = !("storage_path" in filters) || filters.storage_path === state.storagePath;
        if (matches) {
          state.storagePath = patch.storage_path as string;
          resolve({ data: { id: "exp-1" }, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      };
      return chain;
    }

    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        if (table === "experience_items") return makeExperienceItemsChain();
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

    const { saveExperienceTags } = await import("./actions");

    const fdA = formDataWith({ id: "exp-1", project_name: "N1 upgrade", document_type: "reference_letter" });
    fdA.append("disciplines", "roads_civil");
    fdA.set("file", new File(["pdf-bytes-a"], "request-a-reference.pdf", { type: "application/pdf" }));
    const fdB = formDataWith({ id: "exp-1", project_name: "N1 upgrade", document_type: "reference_letter" });
    fdB.append("disciplines", "roads_civil");
    fdB.set("file", new File(["pdf-bytes-b"], "request-b-reference.pdf", { type: "application/pdf" }));

    const [urlA, urlB] = await Promise.all([
      expectRedirect(saveExperienceTags(fdA)),
      expectRedirect(saveExperienceTags(fdB)),
    ]);

    expect(uploadCalls).toHaveLength(2);
    const pathA = uploadCalls.find((p) => p.includes("request-a"))!;
    const pathB = uploadCalls.find((p) => p.includes("request-b"))!;

    const successes = [urlA, urlB].filter((u) => !u.includes("error="));
    const failures = [urlA, urlB].filter((u) => u.includes("error="));

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
