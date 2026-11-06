import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness test for app/company/registrations/actions.ts.
//
// The bug this guards against: saveHeldRegistration()'s edit path does
// `supabase.from("held_registrations").update(row).eq("id", id)` and only
// checks `error`. PostgREST (what supabase-js talks to) returns a 2xx with
// no error when an UPDATE's WHERE clause (here, RLS's own `using
// (is_company_member(company_id))` on the OLD row) matches zero rows - that
// is completely indistinguishable from "it matched and was updated" by
// looking at `error` alone. If the edited row was deleted in another
// tab/device moments earlier (the form's `held_id` hidden field going
// stale), or a stale/foreign id otherwise reaches this action, the pre-fix
// code: (1) tells the user "Registration saved" when nothing was written,
// and (2) if a certificate file was attached, uploads it to storage and
// then - since the follow-up `storage_path` update *also* silently matches
// zero rows - leaves it permanently orphaned (no DB row ever references it,
// so it is never cleaned up).
//
// Supabase's own real HTTP behaviour (empty match => {error: null, data:
// null/[]}) is simulated here with a small sequential-response queue per
// `.from(...)` chain, since this repo has no existing supabase-js mocking
// convention to follow - the chain shape (`.select()/.update()/.eq()/
// .maybeSingle()` etc. all returning the same thenable) mirrors the real
// query builder closely enough to exercise the actual exported action,
// unmodified, rather than a reimplementation of its logic.

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
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } } ) },
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

describe("saveHeldRegistration - stale/foreign id no-op update", () => {
  it("fails cleanly (does not report success) and never uploads a file when the update matches zero rows", async () => {
    const { client, uploadCalls } = makeSupabase({
      fromQueues: [
        // requireCompanyId(): company_members select
        [{ data: { company_id: "company-1" }, error: null }],
        // held_registrations update(row).eq("id", id) - RLS matched 0 rows:
        // real PostgREST behaviour is {error: null}, not an error, whether
        // or not .select().maybeSingle() is chained after it (0 rows ->
        // data: null either way).
        [{ data: null, error: null }],
      ],
    });
    supabaseState.current = client;

    const { saveHeldRegistration } = await import("./actions");

    const fd = formDataWith({
      held_id: "11111111-1111-1111-1111-111111111111",
      registration_type_id: "22222222-2222-2222-2222-222222222222",
      holder: "company",
    });

    const url = await expectRedirect(saveHeldRegistration(fd));

    // The real, fixed behaviour: redirected with an error, not `saved=1`.
    expect(url).not.toContain("saved=1");
    expect(url).toContain("/company/registrations?error=");
    // No file was attached in this case, but the real regression (proven
    // in the next test) is that the pre-fix code carries on past this point
    // at all - asserting here too keeps both tests symmetric.
    expect(uploadCalls).toHaveLength(0);
  });

  it("never uploads the attached certificate file when the row update matched zero rows", async () => {
    const { client, uploadCalls, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()
        [{ data: null, error: null }], // update(row).eq("id", id) - 0 rows matched
      ],
    });
    supabaseState.current = client;

    const { saveHeldRegistration } = await import("./actions");

    const fd = formDataWith({
      held_id: "11111111-1111-1111-1111-111111111111",
      registration_type_id: "22222222-2222-2222-2222-222222222222",
      holder: "company",
    });
    fd.set("file", new File(["pdf-bytes"], "certificate.pdf", { type: "application/pdf" }));

    await expectRedirect(saveHeldRegistration(fd));

    // The orphan-upload bug: the pre-fix code has no gate here, so it goes
    // on to `select("storage_path")` (0 queued responses left -> the mock's
    // own default {data: null, error: null}, same as a real RLS-blocked
    // read) and then calls storage.upload() anyway. The fix must stop
    // before ever reaching the upload call.
    expect(uploadCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
  });
});

describe("saveHeldRegistration - real update still succeeds", () => {
  it("still saves normally when the update genuinely matches the row", async () => {
    const heldId = "11111111-1111-1111-1111-111111111111";
    const { client, uploadCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()
        [{ data: { id: heldId }, error: null }], // update(row).eq("id", id) - real match
      ],
    });
    supabaseState.current = client;

    const { saveHeldRegistration } = await import("./actions");

    const fd = formDataWith({
      held_id: heldId,
      registration_type_id: "22222222-2222-2222-2222-222222222222",
      holder: "company",
    });

    const url = await expectRedirect(saveHeldRegistration(fd));

    expect(url).toContain("saved=1");
    expect(url).toContain(`#r-${heldId}`);
    expect(uploadCalls).toHaveLength(0); // no file attached in this case
  });
});

// 23b43b4 fixed this file's own edit path (above) but left deleteHeldRegistration()
// with the identical, worse shape: it reads the registration's own certificate
// storage_path BEFORE deleting the row, then unconditionally removes that file
// from storage with no gate on the delete having actually matched a row. On the
// same membership-revoked-mid-request race, the registration survives untouched
// while its real, still-referenced certificate is destroyed - and the page
// reports "removed".
describe("deleteHeldRegistration - membership revoked mid-request (delete matches zero rows)", () => {
  it("does not report success and does not destroy the still-referenced certificate", async () => {
    const heldId = "11111111-1111-1111-1111-111111111111";
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()
        [{ data: { storage_path: "company-1/registrations/" + heldId + "/certificate.pdf" }, error: null }], // existing select
        [{ data: null, error: null }], // delete(...).eq("id", id) - 0 rows matched
      ],
    });
    supabaseState.current = client;

    const { deleteHeldRegistration } = await import("./actions");

    const fd = formDataWith({ held_id: heldId });

    const url = await expectRedirect(deleteHeldRegistration(fd));

    expect(url).not.toContain("saved=removed");
    expect(url).toContain("/company/registrations?error=");
    expect(removeCalls).toHaveLength(0); // the real certificate must survive
  });
});

describe("deleteHeldRegistration - real delete still succeeds", () => {
  it("still removes the certificate from storage when the delete genuinely matches the row", async () => {
    const heldId = "11111111-1111-1111-1111-111111111111";
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [{ data: { storage_path: "company-1/registrations/" + heldId + "/certificate.pdf" }, error: null }],
        [{ data: { id: heldId }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { deleteHeldRegistration } = await import("./actions");

    const fd = formDataWith({ held_id: heldId });

    const url = await expectRedirect(deleteHeldRegistration(fd));

    expect(url).toContain("saved=removed");
    expect(removeCalls.flat()).toContain("company-1/registrations/" + heldId + "/certificate.pdf");
  });
});
