import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness test for app/company/team/actions.ts's
// revokeInvite().
//
// Finding 325: the same "plain delete twin discards a zero-row RLS match"
// bug already fixed on officeActions.ts's deleteCompanyOffice(),
// comment-actions.ts's deleteTenderComment(), general-actions.ts's
// removePrivateTenderDocument() and b7-actions.ts's clearSubcontractingPlan()
// - but never swept into THIS file, because every OTHER write in it
// (createInvite/setMemberRole/removeMember) already goes through a locked
// SECURITY DEFINER RPC (0113/0114) and so has no zero-row-match shape to
// find in the first place. revokeInvite() alone is a plain client-side
// `.delete()` straight on company_invites.
//
// "company_invites: admins manage their company's invites" (migration 0077)
// is `using (tt_is_company_admin(company_id))` - the same USING-only,
// re-evaluated-at-write-time policy shape as every sibling fix in this bug
// class. PostgREST's real behaviour on a zero-row-match DELETE under RLS is
// a 2xx with `error: null` - indistinguishable from a real revoke by `error`
// alone. Pre-fix, revokeInvite() redirected `saved=revoked` regardless.
//
// Mocking technique and chain shape copied from
// app/company/officeActions.spec.ts (this repo's own established
// convention for this) - calls the real, unmodified exported action, not a
// reimplementation of its logic.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(queue: Resp[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "update", "insert", "delete", "eq", "is", "order", "single"];
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
    rpc: () => ({ then: (resolve: (r: Resp) => void) => resolve({ data: null, error: null }) }),
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

const MEMBERSHIP = { data: { company_id: "company-1", role: "admin", user_id: "user-1" }, error: null };

describe("revokeInvite - caller's own admin role revoked mid-request, or invite already accepted (company_invites delete matches zero rows)", () => {
  it("does not report success when the delete matches zero rows", async () => {
    supabaseState.current = makeSupabase([
      [MEMBERSHIP], // requireCompanyAdmin()'s own company_members read
      [{ data: null, error: null }], // delete(...).select("id").maybeSingle() - zero-row RLS match
    ]);

    const { revokeInvite } = await import("./actions");

    const url = await expectRedirect(revokeInvite(formDataWith({ invite_id: "invite-1" })));

    expect(url).not.toContain("saved=revoked");
    expect(url).toContain("/company/team?error=");
  });
});

describe("revokeInvite - real delete still succeeds", () => {
  it("revokes normally when the delete genuinely matches the row", async () => {
    supabaseState.current = makeSupabase([
      [MEMBERSHIP],
      [{ data: { id: "invite-1" }, error: null }], // real match
    ]);

    const { revokeInvite } = await import("./actions");

    const url = await expectRedirect(revokeInvite(formDataWith({ invite_id: "invite-1" })));

    expect(url).toBe("/company/team?saved=revoked");
  });
});
