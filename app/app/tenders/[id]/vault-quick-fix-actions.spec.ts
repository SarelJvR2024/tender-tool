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
