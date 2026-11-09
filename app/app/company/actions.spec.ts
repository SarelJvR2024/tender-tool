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

// updateCompanyProfile() - the "plain update twin" of uploadVaultDocument()
// above, in this SAME file: `supabase.from("companies").update(update).eq(
// "id", companyId)` checked only `error`, no destructive consequence (no
// file upload precedes it), but still a real silent-false-success. Found
// re-reading this whole file end to end for siblings of its own
// already-fixed uploadVaultDocument() (standing review, 2026-11-06) - this
// function was never swept before this pass.
describe("updateCompanyProfile - membership revoked mid-request (companies update matches zero rows)", () => {
  it("does not report success when the update matches zero rows", async () => {
    const { client } = makeSupabase({
      fromQueues: [
        [{ data: null, error: null }], // update().select("id").maybeSingle() - zero-row RLS match
      ],
    });
    supabaseState.current = client;

    const { updateCompanyProfile } = await import("./actions");

    const fd = formDataWith({ legal_name: "Klip Corp (Pty) Ltd" });
    const url = await expectRedirect(updateCompanyProfile("company-1", fd));

    expect(url).not.toContain("saved=1");
    expect(url).toContain("/company?error=");
  });
});

describe("updateCompanyProfile - real update still succeeds", () => {
  it("saves normally when the update genuinely matches the row", async () => {
    const { client } = makeSupabase({
      fromQueues: [
        [{ data: { id: "company-1" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { updateCompanyProfile } = await import("./actions");

    const fd = formDataWith({ legal_name: "Klip Corp (Pty) Ltd" });
    const url = await expectRedirect(updateCompanyProfile("company-1", fd));

    expect(url).toBe("/company?saved=1");
  });
});

// Second, SEPARATE race in uploadVaultDocument() - a storage-layer one, not
// an RLS one, and not guarded against by the zero-rows check above (standing
// review, 2026-11-09). A double-click, or two tabs, submitting the SAME
// replace at nearly the same moment: both requests read the SAME
// `previousPath` before either writes, both uploads genuinely succeed
// (distinct random storage paths - no collision there), and the pre-fix
// `update({[column]: storagePath}).eq("id", companyId)` has no filter on
// `column` itself, so BOTH updates unconditionally succeed too - whichever
// commits last "wins" the row. The OTHER request's own just-uploaded file is
// now referenced by nothing (the row points at the winner's path) and is
// deleted by nobody (each request's own cleanup only ever targets the
// `previousPath` it read, the ORIGINAL file - never the other request's new
// one) - a permanent, silent storage leak, and BOTH users are told "Document
// saved."
//
// This needs a genuinely stateful mock, not the FIFO response queue above:
// the real race is that BOTH requests' own `existing` reads must land before
// EITHER request's own `update` commits, which a queue keyed by call order
// cannot represent when two concurrent invocations interleave their own
// calls. `state` below stands in for the one real, shared Postgres row both
// concurrent Server Action invocations actually read and write against.
describe("uploadVaultDocument - two concurrent replace requests (both succeed, no RLS failure - a genuine double-submit)", () => {
  it("lets exactly one request win the row, and cleans up the LOSER's own new upload immediately - no orphan, no silent double success", async () => {
    const COLUMN = "iso_9001_document_path";
    const ORIGINAL_PATH = "company-1/vault/iso_9001/old-uuid-old-cert.pdf";
    const state: { value: string | null } = { value: ORIGINAL_PATH };
    const uploadCalls: string[] = [];
    const removeCalls: string[][] = [];

    function makeCompaniesChain() {
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
        filters[col] = val; // null, in every real caller of .is() here
        return chain;
      };
      chain.maybeSingle = () => chain;
      (chain as { then: (resolve: (r: unknown) => void) => void }).then = (resolve) => {
        if (!isUpdate) {
          resolve({ data: { [COLUMN]: state.value }, error: null });
          return;
        }
        // Real PostgREST semantics: the UPDATE's WHERE clause (here, "id"
        // plus - once the fix lands - an exact match on the row's CURRENT
        // `column` value) must match the row as it stands RIGHT NOW, not as
        // it stood when this request read it. The pre-fix code never
        // filters on `column` at all, so `matches` is unconditionally true
        // below regardless of `state.value` - this mock represents real
        // Postgres/PostgREST behaviour either way, it does not bake in the
        // fix.
        const matches = !(COLUMN in filters) || filters[COLUMN] === state.value;
        if (matches) {
          state.value = patch[COLUMN] as string;
          resolve({ data: { id: "company-1" }, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      };
      return chain;
    }

    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => makeCompaniesChain(),
      storage: {
        from: () => ({
          upload: async (path: string) => {
            uploadCalls.push(path);
            // Request B's own upload round-trip just happens to come back
            // faster (e.g. a smaller file) - nothing in the real code
            // serialises two concurrent requests' uploads against each
            // other, so either one can legitimately finish first.
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

    const { uploadVaultDocument } = await import("./actions");

    const fdA = formDataWith({ kind: "iso_9001", acknowledge_mismatch: "true" });
    fdA.set("file", new File(["pdf-bytes-a"], "request-a-iso-cert.pdf", { type: "application/pdf" }));
    const fdB = formDataWith({ kind: "iso_9001", acknowledge_mismatch: "true" });
    fdB.set("file", new File(["pdf-bytes-b"], "request-b-iso-cert.pdf", { type: "application/pdf" }));

    // The real double-click / two-tabs shape: both in flight at once, same
    // company, same document kind, genuinely different files.
    const [urlA, urlB] = await Promise.all([
      expectRedirect(uploadVaultDocument("company-1", fdA)),
      expectRedirect(uploadVaultDocument("company-1", fdB)),
    ]);

    expect(uploadCalls).toHaveLength(2);
    const pathA = uploadCalls.find((p) => p.includes("request-a"))!;
    const pathB = uploadCalls.find((p) => p.includes("request-b"))!;

    const successes = [urlA, urlB].filter((u) => u.includes("saved=doc"));
    const failures = [urlA, urlB].filter((u) => u.includes("/company?error="));

    // THE FIX's required behaviour: exactly one request wins (the row ends
    // up pointing at exactly one of the two genuinely-uploaded files), and
    // the loser is told to try again rather than silently told "saved" while
    // its own upload rots, unreferenced, in the bucket forever.
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const finalValue = state.value;
    expect([pathA, pathB]).toContain(finalValue);
    const loserPath = finalValue === pathA ? pathB : pathA;

    // The original pre-race file, and the LOSER's own new upload, must both
    // be removed - nothing left orphaned. The WINNER's own new file (now the
    // row's real value) must never be removed.
    expect(removeCalls.flat()).toContain(ORIGINAL_PATH);
    expect(removeCalls.flat()).toContain(loserPath);
    expect(removeCalls.flat()).not.toContain(finalValue);
  });
});
