import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness test for app/tenders/[id]/comment-actions.ts's
// deleteTenderComment().
//
// Finding 323: the exact same "plain update/delete twin discards a zero-row
// RLS match" bug class already fixed across company_offices/properties/
// registrations/bank-accounts/principals/team (Finding 322 and its siblings,
// standing review 2026-11-07) - but comment-actions.ts was never part of
// that sweep at all (it has no matching "standing review, 2026-11-07"
// comment anywhere in the file). "tender_comments: authors delete their own
// notes" (migration 0033) is
// `for delete ... using (is_company_member(company_id) and author_id =
// auth.uid())` - USING-only, re-evaluated against the row at delete time,
// the same shape as every sibling table above. A membership-revoked-mid-
// request race (another admin removing this signed-in user from the company
// while their own "Delete note" form submit is still in flight) makes a
// zero-row-match delete indistinguishable from a real one by `error` alone.
// Confirmed live against a real scratch-Postgres replay of the full schema
// (0033's own policy): with company_members revoked but author_id still
// matching, `delete from tender_comments where id = ... and author_id = ...`
// returns `DELETE 0`, no error, and the row is still there.
//
// Pre-fix, deleteTenderComment() then redirected to `#activity` with no
// `?error`, telling the user their note was deleted when it was not.
//
// Mocking technique and chain shape copied from
// app/company/officeActions.spec.ts (this repo's own established convention
// for this) - calls the real, unmodified exported action, not a
// reimplementation of its logic.

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

const DELETE_FORM = { tender_id: "tender-1", comment_id: "comment-1" };

describe("deleteTenderComment - membership revoked mid-request (tender_comments delete matches zero rows)", () => {
  it("does not report success when the delete matches zero rows", async () => {
    supabaseState.current = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireMember()'s own company_members read
      [{ data: null, error: null }], // delete().eq("id",...).eq("author_id",...).select("id").maybeSingle() - zero-row RLS match
    ]);

    const { deleteTenderComment } = await import("./comment-actions");

    const url = await expectRedirect(deleteTenderComment(formDataWith(DELETE_FORM)));

    expect(url).toContain("/tenders/tender-1?error=");
    expect(url).toContain("#activity");
  });
});

describe("deleteTenderComment - real delete still succeeds", () => {
  it("removes the note normally when the delete genuinely matches the row", async () => {
    supabaseState.current = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: { id: "comment-1" }, error: null }], // real match
    ]);

    const { deleteTenderComment } = await import("./comment-actions");

    const url = await expectRedirect(deleteTenderComment(formDataWith(DELETE_FORM)));

    expect(url).toBe("/tenders/tender-1#activity");
  });
});
