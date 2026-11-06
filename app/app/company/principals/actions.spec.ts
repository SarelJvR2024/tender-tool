import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness test for app/company/principals/actions.ts's
// uploadPrincipalDocument().
//
// Same bug class as 23b43b4 (app/company/registrations/actions.ts's
// saveHeldRegistration()) and the two 7345243 fixes (app/company/actions.ts's
// uploadVaultDocument(), app/company/properties/actions.ts's
// savePropertyDocument()) - this file was read in full by an earlier pass
// (which correctly judged savePrincipal() to have no file-upload consequence)
// but that read didn't cover this function, uploadPrincipalDocument() -
// exactly the "file-upload sibling the prior pass's own note didn't cover"
// shape savePropertyDocument() turned out to be for saveProperty().
//
// uploadPrincipalDocument() does:
//   1. select the principal's current <pathColumn> value (the previous
//      document's storage path, if any) - gated by "company_principals:
//      tenant isolation" (using (is_company_member(company_id)), 0050).
//   2. upload the new file to storage.
//   3. `supabase.from("company_principals").update(update).eq("id", id)` -
//      same policy, USING only, re-evaluated against the OLD row - checking
//      only `error`.
//   4. unconditionally remove the PREVIOUS file from storage, with no gate
//      on step 3 having actually matched a row.
//
// If the signed-in user's own company_members row is deleted between step 1
// and step 3 - another admin calling removeMember() (remove_member_checked(),
// 0114) on this same user while their document-upload form is still
// open/submitting - PostgREST's real behaviour for step 3 is a 2xx with zero
// rows affected and `error: null`, indistinguishable from "it matched" by
// looking at `error` alone. Pre-fix, the code then: (a) never cleans up the
// just-uploaded new file (orphaned), AND (b) still unconditionally deletes
// the PREVIOUS file from storage at step 4, even though the row was never
// actually updated to point at anything else - destroying the person's own,
// still-referenced, previously valid certified-ID or disability-proof
// document from storage while the UI reports "Document saved".
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

describe("uploadPrincipalDocument - membership revoked mid-request (update matches zero rows)", () => {
  it("does not report success, does not leave the new upload orphaned, and does not delete the still-referenced previous file", async () => {
    const { client, uploadCalls, removeCalls } = makeSupabase({
      fromQueues: [
        // requireCompanyId(): company_members select
        [{ data: { company_id: "company-1" }, error: null }],
        // existing company_principals select (spec.pathColumn) - still a
        // member at this point
        [{ data: { certified_id_path: "company-1/principals/p-1/certified_id/old-old.pdf" }, error: null }],
        // update(update).eq("id", id) - membership revoked in between ->
        // RLS's own `using (is_company_member(company_id))` matches 0 rows,
        // real PostgREST behaviour is {error: null}, not an error.
        [{ data: null, error: null }],
      ],
    });
    supabaseState.current = client;

    const { uploadPrincipalDocument } = await import("./actions");

    const fd = formDataWith({ principal_id: "p-1", kind: "certified_id", certified_id_on: "2026-11-06" });
    fd.set("file", new File(["pdf-bytes"], "id-copy.pdf", { type: "application/pdf" }));

    const url = await expectRedirect(uploadPrincipalDocument(fd));

    // The real, fixed behaviour: redirected with an error, not `saved=doc`.
    expect(url).not.toContain("saved=doc");
    expect(url).toContain("/company/principals?error=");

    expect(uploadCalls).toHaveLength(1); // upload happens before the update
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain(uploadCalls[0]); // new upload cleaned up
    expect(removedPaths).not.toContain("company-1/principals/p-1/certified_id/old-old.pdf"); // previous file preserved
  });
});

describe("uploadPrincipalDocument - real update still succeeds", () => {
  it("still saves normally and swaps the previous file out when the update genuinely matches the row", async () => {
    const { client, uploadCalls, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [{ data: { certified_id_path: "company-1/principals/p-1/certified_id/old-old.pdf" }, error: null }],
        [{ data: { id: "p-1" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { uploadPrincipalDocument } = await import("./actions");

    const fd = formDataWith({ principal_id: "p-1", kind: "certified_id", certified_id_on: "2026-11-06" });
    fd.set("file", new File(["pdf-bytes"], "id-copy.pdf", { type: "application/pdf" }));

    const url = await expectRedirect(uploadPrincipalDocument(fd));

    expect(url).toContain("saved=doc");
    expect(uploadCalls).toHaveLength(1);
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain("company-1/principals/p-1/certified_id/old-old.pdf");
  });
});

// Same bug class, found this pass in two sibling functions of this same
// file: savePrincipal()'s edit branch (`.update(update).eq("id", id)`, no
// `.select()`) and, worse, deletePrincipal() - which reads the person's OWN
// certified-ID/disability-proof storage paths BEFORE deleting the principal
// row, then unconditionally removes those files from storage regardless of
// whether the delete actually matched a row. On the same
// membership-revoked-mid-request race, the principal's row survives
// untouched while their real, still-referenced POPIA documents are
// destroyed from storage - and the page reports "removed".
describe("savePrincipal - membership revoked mid-request (edit matches zero rows)", () => {
  it("does not report success when the update matches zero rows", async () => {
    const { client } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()
        [{ data: null, error: null }], // update(update).eq("id", id) - 0 rows matched
      ],
    });
    supabaseState.current = client;

    const { savePrincipal } = await import("./actions");

    const fd = formDataWith({ principal_id: "p-1", role: "director", full_name: "Jane Director" });

    const url = await expectRedirect(savePrincipal(fd));

    expect(url).not.toContain("saved=1");
    expect(url).toContain("/company/principals?error=");
  });
});

describe("deletePrincipal - membership revoked mid-request (delete matches zero rows)", () => {
  it("does not report success and does not destroy the person's still-referenced POPIA documents", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()
        // company_principals select for certified_id_path/disability_proof_path -
        // still readable (its own select is a point read keyed by id, same race
        // window as the update case above, just not yet hit here)
        [{ data: { certified_id_path: "company-1/principals/p-1/certified_id/id.pdf", disability_proof_path: null }, error: null }],
        // delete(...).eq("id", id) - membership revoked in between -> 0 rows
        [{ data: null, error: null }],
      ],
    });
    supabaseState.current = client;

    const { deletePrincipal } = await import("./actions");

    const fd = formDataWith({ principal_id: "p-1" });

    const url = await expectRedirect(deletePrincipal(fd));

    expect(url).not.toContain("saved=removed");
    expect(url).toContain("/company/principals?error=");
    expect(removeCalls).toHaveLength(0); // the real POPIA document must survive
  });
});

describe("deletePrincipal - real delete still succeeds", () => {
  it("still removes the person's documents from storage when the delete genuinely matches the row", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [{ data: { certified_id_path: "company-1/principals/p-1/certified_id/id.pdf", disability_proof_path: null }, error: null }],
        [{ data: { id: "p-1" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { deletePrincipal } = await import("./actions");

    const fd = formDataWith({ principal_id: "p-1" });

    const url = await expectRedirect(deletePrincipal(fd));

    expect(url).toContain("saved=removed");
    expect(removeCalls.flat()).toContain("company-1/principals/p-1/certified_id/id.pdf");
  });
});
