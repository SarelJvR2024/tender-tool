import { afterEach, describe, expect, it, vi } from "vitest";

// First dedicated test file for vault-quick-fix-actions.ts - standing
// review, 2026-11-07h. This file's own local requireCompanyId(companyId) -
// written for the Tender Workspace "Quick Blocker Resolver" drawer
// (2026-10-24, Batch 3) - is the one hyphenated-*-actions.ts holdout that
// the 2026-11-06 b002f4e sweep ("requireCompanyId()'s own company_members
// read across 23 Server Action files had no error capture") never reached:
// every other requireCompanyId() in this codebase has a shared
// `(user_id) -> company_id` signature and was swept; this one instead takes
// a caller-supplied companyId (to cross-check a client-passed id against the
// signed-in user's real membership) and was missed because its shape
// differs. It never captured `error` from the company_members read at all -
// a transient read failure was indistinguishable from "you really aren't a
// member of this company", surfacing the wrong, non-actionable message
// ("Not signed in to this company.") instead of the sibling files' real
// "Couldn't verify your company - try again." This does not fail OPEN (a
// read failure still denies the write, same as every sibling), but it is
// the same swallowed-Supabase-error shape this review has tracked all
// along, just resolving to a misleading denial rather than a false grant.
//
// Mocking technique copied from the established convention
// (app/app/people/actions.spec.ts and siblings): a sequential per-`.from()`-
// call response queue, a minimal thenable/chainable stub, and a mocked
// `@/lib/supabase/server`/`next/cache` - calls the real, unmodified exported
// actions, not a reimplementation of their logic.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(queue: Resp[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "update", "eq", "upload"];
  for (const m of methods) chain[m] = () => chain;
  chain.maybeSingle = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => {
    const next = queue.shift();
    resolve(next ?? { data: null, error: null });
  };
  return chain;
}

function makeSupabase(fromQueues: Resp[][]) {
  let fromCallIndex = 0;
  const removeCalls: { bucket: string; paths: string[] }[] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => {
        const queue = fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue);
      },
      storage: {
        from: (bucket: string) => ({
          upload: async () => ({ data: null, error: null }),
          remove: async (paths: string[]) => {
            removeCalls.push({ bucket, paths });
            return { data: null, error: null };
          },
        }),
      },
    },
    removeCalls,
  };
}

const supabaseState: { current: ReturnType<typeof makeSupabase>["client"] | null } = { current: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseState.current,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

afterEach(() => {
  vi.resetModules();
  supabaseState.current = null;
});

describe("saveVaultQuickFields - requireCompanyId's own company_members read fails", () => {
  it("reports a real verification failure, not 'Not signed in to this company.', and does not go on to write companies", async () => {
    const { client } = makeSupabase([
      [{ data: null, error: { message: "read failed" } }], // requireCompanyId's company_members lookup errors
    ]);
    supabaseState.current = client;

    const { saveVaultQuickFields } = await import("./vault-quick-fix-actions");

    const res = await saveVaultQuickFields("tender-1", "company-1", { sars_tcs_pin: "ABC123" });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toBe("Not signed in to this company.");
      expect(res.error.toLowerCase()).toContain("try again");
    }
  });
});

describe("saveVaultQuickFields - genuinely not a member of this company", () => {
  it("still denies the write, with the original 'not signed in' message", async () => {
    const { client } = makeSupabase([
      [{ data: null, error: null }], // requireCompanyId - no matching row, no error
    ]);
    supabaseState.current = client;

    const { saveVaultQuickFields } = await import("./vault-quick-fix-actions");

    const res = await saveVaultQuickFields("tender-1", "company-1", { sars_tcs_pin: "ABC123" });

    expect(res).toEqual({ ok: false, error: "Not signed in to this company." });
  });
});

describe("saveVaultQuickFields - real membership, real save", () => {
  it("saves normally when the membership read genuinely succeeds", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId - real membership
      [{ data: { id: "company-1" }, error: null }], // companies update
    ]);
    supabaseState.current = client;

    const { saveVaultQuickFields } = await import("./vault-quick-fix-actions");

    const res = await saveVaultQuickFields("tender-1", "company-1", { sars_tcs_pin: "ABC123" });

    expect(res).toEqual({ ok: true });
  });
});

// Standing review, 2026-11-07: a from-scratch re-grep of every `.update(`
// site in app/app for the "plain update twin" RLS-zero-row shape (the one
// Finding 197 closed out for company_offices) found this file's own two
// `companies` updates were never swept for it - requireCompanyId()'s own
// synchronous membership re-check and this write are not atomic, so a
// membership revoked between them (removeMember(), 0114) makes RLS's own
// `using (is_company_member(id))` (0001) match zero rows at write time,
// returned as a 2xx with `error: null`, indistinguishable from a real
// update by `error` alone.
describe("saveVaultQuickFields - companies update matches zero rows (RLS race)", () => {
  it("reports a real failure, not ok:true, when the update itself matches no row", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId - real membership
      [{ data: null, error: null }], // companies update - zero rows matched, no error
    ]);
    supabaseState.current = client;

    const { saveVaultQuickFields } = await import("./vault-quick-fix-actions");

    const res = await saveVaultQuickFields("tender-1", "company-1", { sars_tcs_pin: "ABC123" });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).not.toBe("Not signed in to this company.");
  });
});

describe("uploadCoidQuickFix - requireCompanyId's own company_members read fails", () => {
  it("reports a real verification failure and never touches storage", async () => {
    const { client, removeCalls } = makeSupabase([
      [{ data: null, error: { message: "read failed" } }], // requireCompanyId's company_members lookup errors
    ]);
    supabaseState.current = client;

    const { uploadCoidQuickFix } = await import("./vault-quick-fix-actions");

    const file = new File(["x"], "coid.pdf", { type: "application/pdf" });
    const res = await uploadCoidQuickFix("tender-1", "company-1", file);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toBe("Not signed in to this company.");
      expect(res.error.toLowerCase()).toContain("try again");
    }
    expect(removeCalls).toHaveLength(0);
  });
});

describe("uploadCoidQuickFix - real membership, real save", () => {
  it("uploads, saves the new path, and removes only the previous file", async () => {
    const { client, removeCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
      [{ data: { coid_letter_document_path: "company-1/vault/coid/old.pdf" }, error: null }], // existing read
      [{ data: { id: "company-1" }, error: null }], // companies update - real match
    ]);
    supabaseState.current = client;

    const { uploadCoidQuickFix } = await import("./vault-quick-fix-actions");

    const file = new File(["x"], "coid.pdf", { type: "application/pdf" });
    const res = await uploadCoidQuickFix("tender-1", "company-1", file);

    expect(res).toEqual({ ok: true });
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0].paths).toEqual(["company-1/vault/coid/old.pdf"]);
  });
});

// Standing review, 2026-11-07: a from-scratch re-grep of every `.update(`
// site in app/app for the "plain update twin" RLS-zero-row shape found this
// function's own `companies` update was an unswept copy of company/
// actions.ts's own uploadVaultDocument() - same table, same destructive
// consequence class: without a zero-row check, a membership revoked between
// requireCompanyId() and this write leaves the row still pointing at the OLD
// file while the code unconditionally deletes that same OLD file from
// storage below - worse than a plain orphan, since the row ends up
// referencing a file that no longer exists, while the just-uploaded new file
// sits permanently unreferenced.
describe("uploadCoidQuickFix - companies update matches zero rows (RLS race)", () => {
  it("removes the just-uploaded new file, and does NOT delete the still-referenced previous file", async () => {
    const { client, removeCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
      [{ data: { coid_letter_document_path: "company-1/vault/coid/old.pdf" }, error: null }], // existing read
      [{ data: null, error: null }], // companies update - zero rows matched, no error
    ]);
    supabaseState.current = client;

    const { uploadCoidQuickFix } = await import("./vault-quick-fix-actions");

    const file = new File(["x"], "coid.pdf", { type: "application/pdf" });
    const res = await uploadCoidQuickFix("tender-1", "company-1", file);

    expect(res.ok).toBe(false);
    // The still-referenced OLD file must survive: only the newly-uploaded
    // file (not "old.pdf") may ever be passed to remove().
    const removedPaths = removeCalls.flatMap((c) => c.paths);
    expect(removedPaths).not.toContain("company-1/vault/coid/old.pdf");
    expect(removeCalls).toHaveLength(1);
  });
});

// Second, SEPARATE race in uploadCoidQuickFix() - a storage-layer one, not
// an RLS one (standing review, 2026-11-09). Same shape, same fix, as
// app/company/actions.ts uploadVaultDocument(): two near-simultaneous COID
// uploads for the same company (the drawer's own retry-on-timeout, or two
// tabs) both read the same `previousPath` before either writes, both
// uploads succeed (distinct random paths), and the pre-fix update has no
// filter on `column` itself, so both updates would unconditionally succeed
// too - whichever commits last wins the row, orphaning the other request's
// own new file forever. Needs a genuinely stateful mock (not the FIFO queue
// above): both requests' own reads must land before either one's own write
// commits.
describe("uploadCoidQuickFix - two concurrent uploads (both succeed, no RLS failure - a genuine double-submit)", () => {
  it("lets exactly one request win the row, and cleans up the LOSER's own new upload immediately - no orphan, no silent double success", async () => {
    const COLUMN = "coid_letter_document_path";
    const ORIGINAL_PATH = "company-1/vault/coid/old-old.pdf";
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
        filters[col] = val;
        return chain;
      };
      chain.maybeSingle = () => chain;
      (chain as { then: (resolve: (r: unknown) => void) => void }).then = (resolve) => {
        if (!isUpdate) {
          resolve({ data: { [COLUMN]: state.value }, error: null });
          return;
        }
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
      from: (table: string) => {
        if (table === "companies") return makeCompaniesChain();
        // company_members, for requireCompanyId() - always a real member here.
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq"]) chain[m] = () => chain;
        chain.maybeSingle = () => chain;
        (chain as { then: (resolve: (r: unknown) => void) => void }).then = (resolve) => resolve({ data: { company_id: "company-1" }, error: null });
        return chain;
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

    const { uploadCoidQuickFix } = await import("./vault-quick-fix-actions");

    const fileA = new File(["a"], "request-a-coid.pdf", { type: "application/pdf" });
    const fileB = new File(["b"], "request-b-coid.pdf", { type: "application/pdf" });

    const [resA, resB] = await Promise.all([
      uploadCoidQuickFix("tender-1", "company-1", fileA),
      uploadCoidQuickFix("tender-1", "company-1", fileB),
    ]);

    expect(uploadCalls).toHaveLength(2);
    const pathA = uploadCalls.find((p) => p.includes("request-a"))!;
    const pathB = uploadCalls.find((p) => p.includes("request-b"))!;

    const successes = [resA, resB].filter((r) => r.ok);
    const failures = [resA, resB].filter((r) => !r.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const finalValue = state.value;
    expect([pathA, pathB]).toContain(finalValue);
    const loserPath = finalValue === pathA ? pathB : pathA;

    expect(removeCalls.flat()).toContain(ORIGINAL_PATH);
    expect(removeCalls.flat()).toContain(loserPath);
    expect(removeCalls.flat()).not.toContain(finalValue);
  });
});
