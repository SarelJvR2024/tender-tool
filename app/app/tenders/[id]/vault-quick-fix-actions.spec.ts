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
      [{ data: null, error: null }], // companies update
    ]);
    supabaseState.current = client;

    const { saveVaultQuickFields } = await import("./vault-quick-fix-actions");

    const res = await saveVaultQuickFields("tender-1", "company-1", { sars_tcs_pin: "ABC123" });

    expect(res).toEqual({ ok: true });
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
