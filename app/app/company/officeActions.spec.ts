import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness test for app/company/officeActions.ts's
// saveCompanyOffice().
//
// The bug this guards against: the exact same "plain update twin" shape
// already fixed in app/company/actions.ts's updateCompanyProfile(),
// app/company/properties/actions.ts's saveProperty(),
// app/company/principals/actions.ts's savePrincipal(),
// app/company/registrations/actions.ts's saveHeldRegistration() and
// app/company/bank-accounts/actions.ts's saveBankAccount() - but never swept
// into THIS file (standing review, 2026-11-07): the edit branch did
// `supabase.from("company_offices").update(row).eq("id", id)` and checked
// only `error`.
//
// "company_offices: tenant isolation" (migration 0015) is
// `for all ... using (is_company_member(company_id))` - the exact same
// USING-only, re-evaluated-against-the-OLD-row shape as every sibling table
// above. PostgREST's real behaviour on a membership-revoked-mid-request race
// (another admin calling removeMember() on this same signed-in user while
// their "Save office" form is still open) is a 2xx with zero rows affected
// and `error: null` - indistinguishable from a real update by `error` alone.
// Pre-fix, saveCompanyOffice() then redirected with `saved=office`, telling
// the user their edit was saved when nothing was actually written (no file
// upload precedes this write, so there is no orphaned-upload/wrongly-deleted
// -previous-file consequence - same severity class as updateCompanyProfile()).
//
// Mocking technique and chain shape copied from app/company/actions.spec.ts
// (this repo's own established convention for this, introduced in 23b43b4) -
// calls the real, unmodified exported action, not a reimplementation of its
// logic.

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

function makeSupabase(fromQueues: Resp[][]) {
  let fromCallIndex = 0;
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => {
      const queue = fromQueues[fromCallIndex] ?? [];
      fromCallIndex += 1;
      return makeChain(queue);
    },
  };
}

const supabaseState: { current: ReturnType<typeof makeSupabase> | null } = { current: null };

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

const EDIT_FORM = { office_id: "office-1", province: "Western Cape", office_kind: "branch" };

describe("saveCompanyOffice - membership revoked mid-request (company_offices update matches zero rows)", () => {
  it("does not report success when the update matches zero rows", async () => {
    supabaseState.current = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()'s own company_members read
      [{ data: null, error: null }], // update(row).eq("id", id).select("id").maybeSingle() - zero-row RLS match
    ]);

    const { saveCompanyOffice } = await import("./officeActions");

    const url = await expectRedirect(saveCompanyOffice(formDataWith(EDIT_FORM)));

    expect(url).not.toContain("saved=office");
    expect(url).toContain("/company?error=");
  });
});

describe("saveCompanyOffice - real update still succeeds", () => {
  it("saves normally when the update genuinely matches the row", async () => {
    supabaseState.current = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: { id: "office-1" }, error: null }], // real match
    ]);

    const { saveCompanyOffice } = await import("./officeActions");

    const url = await expectRedirect(saveCompanyOffice(formDataWith(EDIT_FORM)));

    expect(url).toBe("/company?saved=office#offices");
  });
});

describe("saveCompanyOffice - new office (insert branch, no zero-row check needed)", () => {
  it("still saves a brand new office normally", async () => {
    supabaseState.current = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: null, error: null }], // insert - no .select(), real success shape is {error: null}
    ]);

    const { saveCompanyOffice } = await import("./officeActions");

    const url = await expectRedirect(saveCompanyOffice(formDataWith({ province: "Gauteng", office_kind: "head_office" })));

    expect(url).toBe("/company?saved=office#offices");
  });
});

// Finding 322: deleteCompanyOffice() had the identical "plain update/delete
// twin" shape as saveCompanyOffice() above - "company_offices: tenant
// isolation" (0015) is the same USING-only policy, so the same
// membership-revoked-mid-request race makes a zero-row-match delete
// indistinguishable from a real one by `error` alone. The update branch
// (saveCompanyOffice, tested above) was swept for this on 2026-11-07; the
// delete branch in the same file was missed until now.
describe("deleteCompanyOffice - membership revoked mid-request (company_offices delete matches zero rows)", () => {
  it("does not report success when the delete matches zero rows", async () => {
    supabaseState.current = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()'s own company_members read
      [{ data: null, error: null }], // delete().eq("id", id).select("id").maybeSingle() - zero-row RLS match
    ]);

    const { deleteCompanyOffice } = await import("./officeActions");

    const url = await expectRedirect(deleteCompanyOffice(formDataWith({ office_id: "office-1" })));

    expect(url).not.toContain("saved=office");
    expect(url).toContain("/company?error=");
  });
});

describe("deleteCompanyOffice - real delete still succeeds", () => {
  it("removes the office normally when the delete genuinely matches the row", async () => {
    supabaseState.current = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: { id: "office-1" }, error: null }], // real match
    ]);

    const { deleteCompanyOffice } = await import("./officeActions");

    const url = await expectRedirect(deleteCompanyOffice(formDataWith({ office_id: "office-1" })));

    expect(url).toBe("/company?saved=office#offices");
  });
});
