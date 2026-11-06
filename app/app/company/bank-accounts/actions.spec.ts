import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness test for app/company/bank-accounts/actions.ts.
//
// Same bug class as 23b43b4 (app/company/registrations/actions.ts's
// saveHeldRegistration()), 7345243 (app/company/actions.ts's
// uploadVaultDocument(), app/company/properties/actions.ts's
// savePropertyDocument()) and this pass's own fixes to that file's sibling
// save/delete functions, plus app/company/principals/actions.ts and
// app/experience/actions.ts.
//
// saveBankAccount()'s edit branch does
// `supabase.from("bank_accounts").update(row).eq("id", id)` and
// deleteBankAccount() does `supabase.from("bank_accounts").delete().eq("id",
// id)` - both checking only `error`. PostgREST returns a 2xx with
// `error: null` and zero rows affected when RLS's own `using
// (tt_is_company_admin(company_id))` (0050, re-evaluated against the OLD
// row) no longer matches - e.g. another admin's removeMember() revoking this
// user's own owner/admin company_members row, or demoting them to a lesser
// role, between page load and this write - indistinguishable from a real
// write by `error` alone. This table has no storage files, so the
// consequence here is "purely" the silent-false-success itself: the page
// reports "saved"/"removed" for an edit or delete that never actually
// happened - the account keeps its old (possibly stale) details, or stays on
// file entirely, with no indication anything is wrong.
//
// Mocking technique and chain shape copied from the established convention
// (app/company/registrations/actions.spec.ts et al.) - calls the real,
// unmodified exported action, not a reimplementation of its logic.

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

function makeSupabase(opts: { fromQueues: Resp[][] }) {
  let fromCallIndex = 0;
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => {
        const queue = opts.fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue);
      },
    },
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

const ADMIN_MEMBERSHIP = { data: { company_id: "company-1", role: "admin" }, error: null };

describe("saveBankAccount - membership/role revoked mid-request (edit matches zero rows)", () => {
  it("does not report success when the update matches zero rows", async () => {
    const { client } = makeSupabase({
      fromQueues: [
        [ADMIN_MEMBERSHIP], // requireCompanyId()
        [{ data: null, error: null }], // update(row).eq("id", id) - 0 rows matched
      ],
    });
    supabaseState.current = client;

    const { saveBankAccount } = await import("./actions");

    const fd = formDataWith({
      account_id: "acc-1",
      bank_name: "FNB",
      account_holder: "Test Co",
      account_number: "1234567890",
    });

    const url = await expectRedirect(saveBankAccount(fd));

    expect(url).not.toContain("saved=1");
    expect(url).toContain("/company/bank-accounts?error=");
  });
});

describe("saveBankAccount - real update still succeeds", () => {
  it("still saves normally when the update genuinely matches the row", async () => {
    const { client } = makeSupabase({
      fromQueues: [
        [ADMIN_MEMBERSHIP],
        [{ data: { id: "acc-1" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { saveBankAccount } = await import("./actions");

    const fd = formDataWith({
      account_id: "acc-1",
      bank_name: "FNB",
      account_holder: "Test Co",
      account_number: "1234567890",
    });

    const url = await expectRedirect(saveBankAccount(fd));

    expect(url).toContain("saved=1");
  });
});

describe("deleteBankAccount - membership/role revoked mid-request (delete matches zero rows)", () => {
  it("does not report success when the delete matches zero rows", async () => {
    const { client } = makeSupabase({
      fromQueues: [
        [ADMIN_MEMBERSHIP], // requireCompanyId()
        [{ data: null, error: null }], // delete(...).eq("id", id) - 0 rows matched
      ],
    });
    supabaseState.current = client;

    const { deleteBankAccount } = await import("./actions");

    const fd = formDataWith({ account_id: "acc-1" });

    const url = await expectRedirect(deleteBankAccount(fd));

    expect(url).not.toContain("saved=removed");
    expect(url).toContain("/company/bank-accounts?error=");
  });
});

describe("deleteBankAccount - real delete still succeeds", () => {
  it("still reports removed when the delete genuinely matches the row", async () => {
    const { client } = makeSupabase({
      fromQueues: [
        [ADMIN_MEMBERSHIP],
        [{ data: { id: "acc-1" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { deleteBankAccount } = await import("./actions");

    const fd = formDataWith({ account_id: "acc-1" });

    const url = await expectRedirect(deleteBankAccount(fd));

    expect(url).toContain("saved=removed");
  });
});
