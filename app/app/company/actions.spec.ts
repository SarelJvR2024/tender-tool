import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness test for app/company/actions.ts's
// uploadVaultDocument().
//
// The bug this guards against: the same "UPDATE ... WHERE id = X only
// checks `error`" shape 23b43b4 fixed in
// app/company/registrations/actions.ts's saveHeldRegistration() - except
// here the consequence is worse than an orphaned upload.
//
// uploadVaultDocument() does:
//   1. select the company's current <column> value (the previous document's
//      storage path, if any) - gated by "companies: members can select"
//      (using (is_company_member(id)), 0001).
//   2. upload the new file to storage.
//   3. `supabase.from("companies").update({[column]: storagePath}).eq("id",
//      companyId)` - gated by "companies: members can update" (using
//      (is_company_member(id)), 0001, same shape: USING only, re-evaluated
//      against the OLD row) - checking only `error`.
//   4. unconditionally remove the PREVIOUS file from storage, with no gate
//      on step 3 having actually matched a row.
//
// If the signed-in user's own company_members row is deleted between step 1
// and step 3 - the realistic trigger being another admin calling
// removeMember() (remove_member_checked(), 0114) on this same user while
// their vault-upload form is still open/submitting, not a hypothetical -
// PostgREST's real behaviour for step 3 is a 2xx with zero rows affected and
// `error: null`, indistinguishable from "it matched" by looking at `error`
// alone. Pre-fix, the code then: (a) never cleans up the just-uploaded new
// file (orphaned, same shape as the registrations bug), AND (b) still
// unconditionally deletes the PREVIOUS file from storage at step 4, even
// though the row was never actually updated to point at anything else - so
// the company's own, still-referenced, previously valid document is
// destroyed from storage while the UI reports "Document saved".
//
// Mocking technique and chain shape copied from
// app/company/registrations/actions.spec.ts (this repo's own established
// convention for this, introduced in 23b43b4) - calls the real, unmodified
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

describe("uploadVaultDocument - membership revoked mid-request (companies update matches zero rows)", () => {
  it("does not report success, does not leave the new upload orphaned, and does not delete the still-referenced previous file", async () => {
    const { client, uploadCalls, removeCalls } = makeSupabase({
      fromQueues: [
        // step 1: select existing <column> - still a member at this point
        [{ data: { iso_9001_document_path: "company-1/vault/iso_9001/old-uuid-old.pdf" }, error: null }],
        // step 3: update({[column]: storagePath}).eq("id", companyId) -
        // membership was revoked in between -> RLS's own `using
        // (is_company_member(id))` matches 0 rows, real PostgREST behaviour
        // is {error: null}, not an error.
        [{ data: null, error: null }],
      ],
    });
    supabaseState.current = client;

    const { uploadVaultDocument } = await import("./actions");

    const fd = formDataWith({ kind: "iso_9001", acknowledge_mismatch: "true" });
    fd.set("file", new File(["pdf-bytes"], "iso-cert.pdf", { type: "application/pdf" }));

    const url = await expectRedirect(uploadVaultDocument("company-1", fd));

    // The real, fixed behaviour: redirected with an error, not `saved=doc`.
    expect(url).not.toContain("saved=doc");
    expect(url).toContain("/company?error=");

    // The new upload must have happened (it's step 2, before the update) -
    // what matters is whether it's cleaned up afterwards.
    expect(uploadCalls).toHaveLength(1);

    // Neither the new file nor the previous one should be left in a bad
    // state: the new upload must be removed (not orphaned), and the
    // previous file must NOT be removed (the row was never actually
    // updated to stop pointing at it).
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain(uploadCalls[0]); // new upload cleaned up
    expect(removedPaths).not.toContain("company-1/vault/iso_9001/old-uuid-old.pdf"); // previous file preserved
  });
});

describe("uploadVaultDocument - real update still succeeds", () => {
  it("still saves normally and swaps the previous file out when the update genuinely matches the row", async () => {
    const { client, uploadCalls, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { iso_9001_document_path: "company-1/vault/iso_9001/old-uuid-old.pdf" }, error: null }],
        [{ data: { id: "company-1" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { uploadVaultDocument } = await import("./actions");

    const fd = formDataWith({ kind: "iso_9001", acknowledge_mismatch: "true" });
    fd.set("file", new File(["pdf-bytes"], "iso-cert.pdf", { type: "application/pdf" }));

    const url = await expectRedirect(uploadVaultDocument("company-1", fd));

    expect(url).toContain("saved=doc");
    expect(uploadCalls).toHaveLength(1);
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain("company-1/vault/iso_9001/old-uuid-old.pdf"); // previous file correctly swapped out
  });
});
