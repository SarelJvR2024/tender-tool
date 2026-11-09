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

// The row update above (23b43b4) and the attach-write below (this pass) are
// two SEPARATE writes with two separate timing windows - fixing the first
// does not protect the second. If membership is revoked between the row
// write succeeding and the certificate-attach write, the attach write itself
// matches zero rows (same `error: null` PostgREST behaviour), and pre-fix
// code only checked `error` on it - so it went on to delete the OLD file the
// row still actually references (the attach never took effect), while the
// newly-uploaded file was left permanently unreferenced.
describe("saveHeldRegistration - membership revoked between the row write and the certificate attach write", () => {
  it("does not delete the still-referenced previous file, and cleans up the newly-uploaded orphan instead", async () => {
    const heldId = "11111111-1111-1111-1111-111111111111";
    const oldPath = `company-1/registrations/${heldId}/old-certificate.pdf`;
    const { client, uploadCalls, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()
        [{ data: { id: heldId }, error: null }], // update(row).eq("id", id) - real match
        [{ data: { storage_path: oldPath }, error: null }], // existing select, before upload
        [{ data: null, error: null }], // attach update(storage_path, original_filename) - 0 rows matched
      ],
    });
    supabaseState.current = client;

    const { saveHeldRegistration } = await import("./actions");

    const fd = formDataWith({
      held_id: heldId,
      registration_type_id: "22222222-2222-2222-2222-222222222222",
      holder: "company",
    });
    fd.set("file", new File(["pdf-bytes"], "new-certificate.pdf", { type: "application/pdf" }));

    const url = await expectRedirect(saveHeldRegistration(fd));

    expect(url).not.toContain("saved=1");
    expect(url).toContain("/company/registrations?error=");
    expect(uploadCalls).toHaveLength(1); // the new file genuinely was uploaded before the race was detected
    const newPath = uploadCalls[0];
    // The real bug: the OLD file must survive (the row still points at it),
    // and the NEW, now-unreferenced file must be cleaned up - never the
    // other way round.
    expect(removeCalls.flat()).not.toContain(oldPath);
    expect(removeCalls.flat()).toContain(newPath);
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

  it("still attaches a new certificate and removes the old one when the attach write genuinely matches", async () => {
    const heldId = "11111111-1111-1111-1111-111111111111";
    const oldPath = `company-1/registrations/${heldId}/old-certificate.pdf`;
    const { client, uploadCalls, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId()
        [{ data: { id: heldId }, error: null }], // update(row).eq("id", id) - real match
        [{ data: { storage_path: oldPath }, error: null }], // existing select, before upload
        [{ data: { id: heldId }, error: null }], // attach update - real match
      ],
    });
    supabaseState.current = client;

    const { saveHeldRegistration } = await import("./actions");

    const fd = formDataWith({
      held_id: heldId,
      registration_type_id: "22222222-2222-2222-2222-222222222222",
      holder: "company",
    });
    fd.set("file", new File(["pdf-bytes"], "new-certificate.pdf", { type: "application/pdf" }));

    const url = await expectRedirect(saveHeldRegistration(fd));

    expect(url).toContain("saved=1");
    expect(uploadCalls).toHaveLength(1);
    expect(removeCalls.flat()).toContain(oldPath);
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

// Second, SEPARATE race in saveHeldRegistration()'s certificate-attach step -
// a storage-layer one, not an RLS one (standing review, 2026-11-09). Same
// shape, same fix, as app/company/actions.ts uploadVaultDocument(): two
// near-simultaneous "attach a corrected certificate" submits for the SAME
// registration both read the same `existing.storage_path` before either
// writes, both uploads succeed (distinct random paths), and the pre-fix
// attach update has no filter on `storage_path` itself, so both attach
// updates would unconditionally succeed too - whichever commits last wins
// the row, orphaning the other request's own new file forever. Needs a
// genuinely stateful mock (not the FIFO queue above): both requests' own
// reads must land before either one's own attach-write commits.
describe("saveHeldRegistration - two concurrent certificate-attach requests (both succeed, no RLS failure)", () => {
  it("lets exactly one request win the row, and cleans up the LOSER's own new upload immediately - no orphan, no silent double success", async () => {
    const heldId = "11111111-1111-1111-1111-111111111111";
    const ORIGINAL_PATH = `company-1/registrations/${heldId}/old-old-certificate.pdf`;
    const state: { storagePath: string | null } = { storagePath: ORIGINAL_PATH };
    const uploadCalls: string[] = [];
    const removeCalls: string[][] = [];

    function makeHeldRegistrationsChain() {
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
      chain.maybeSingle = () => chain;
      (chain as { then: (resolve: (r: unknown) => void) => void }).then = (resolve) => {
        if (!isUpdate) {
          // The "existing" read before upload - the only select this table sees.
          resolve({ data: { storage_path: state.storagePath }, error: null });
          return;
        }
        if (!("storage_path" in patch)) {
          // The main row-fields update (registration_type_id/holder/etc.) -
          // no storage race on this write, succeeds unconditionally.
          resolve({ data: { id: heldId }, error: null });
          return;
        }
        // The attach update - optimistic-concurrency gated on storage_path.
        const matches = !("storage_path" in filters) || filters.storage_path === state.storagePath;
        if (matches) {
          state.storagePath = patch.storage_path as string;
          resolve({ data: { id: heldId }, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      };
      return chain;
    }

    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        if (table === "held_registrations") return makeHeldRegistrationsChain();
        // company_members, for requireCompanyId() - always a real member here.
        return makeChain([{ data: { company_id: "company-1" }, error: null }]);
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

    const { saveHeldRegistration } = await import("./actions");

    const fdA = formDataWith({
      held_id: heldId,
      registration_type_id: "22222222-2222-2222-2222-222222222222",
      holder: "company",
    });
    fdA.set("file", new File(["pdf-bytes-a"], "request-a-certificate.pdf", { type: "application/pdf" }));
    const fdB = formDataWith({
      held_id: heldId,
      registration_type_id: "22222222-2222-2222-2222-222222222222",
      holder: "company",
    });
    fdB.set("file", new File(["pdf-bytes-b"], "request-b-certificate.pdf", { type: "application/pdf" }));

    const [urlA, urlB] = await Promise.all([
      expectRedirect(saveHeldRegistration(fdA)),
      expectRedirect(saveHeldRegistration(fdB)),
    ]);

    expect(uploadCalls).toHaveLength(2);
    const pathA = uploadCalls.find((p) => p.includes("request-a"))!;
    const pathB = uploadCalls.find((p) => p.includes("request-b"))!;

    const successes = [urlA, urlB].filter((u) => u.includes("saved=1"));
    const failures = [urlA, urlB].filter((u) => u.includes("error="));

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const finalValue = state.storagePath;
    expect([pathA, pathB]).toContain(finalValue);
    const loserPath = finalValue === pathA ? pathB : pathA;

    expect(removeCalls.flat()).toContain(ORIGINAL_PATH);
    expect(removeCalls.flat()).toContain(loserPath);
    expect(removeCalls.flat()).not.toContain(finalValue);
  });
});
