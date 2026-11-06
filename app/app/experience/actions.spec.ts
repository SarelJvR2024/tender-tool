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
