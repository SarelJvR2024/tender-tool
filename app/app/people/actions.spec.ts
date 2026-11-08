import { afterEach, describe, expect, it, vi } from "vitest";

// First dedicated test file for app/people/actions.ts - standing review,
// 2026-11-06. applyCvExtraction()'s project source_note embeds "today" as a
// human-readable audit-trail string ("AI-extracted, confirmed <today>"). It
// used a raw `new Date().toISOString().slice(0, 10)` - always UTC, so for
// the 00:00-01:59 SAST window every day (SAST = UTC+2, no DST) it silently
// read one calendar day early, the same established naive-UTC-"today" bug
// class already fixed elsewhere in this codebase (lib/publicHolidays.ts's
// own sastToday()). Low severity (a note string, not a stored date column
// anything does math against), but the same mechanical mistake, fixed the
// same way.
//
// Mocking technique copied from the established convention
// (app/company/registrations/actions.spec.ts and siblings): a sequential
// per-`.from()`-call response queue, a minimal thenable/chainable stub, and
// a mocked `@/lib/supabase/server`/`next/navigation`/`next/cache` - calls the
// real, unmodified exported action, not a reimplementation of its logic.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(queue: Resp[], insertCalls?: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "update", "delete", "eq", "order", "single", "is", "in", "limit"];
  for (const m of methods) chain[m] = () => chain;
  chain.insert = (payload: unknown) => {
    insertCalls?.push(payload);
    return chain;
  };
  chain.maybeSingle = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => {
    const next = queue.shift();
    resolve(next ?? { data: null, error: null });
  };
  return chain;
}

function makeSupabase(
  fromQueues: Resp[][],
  storageOpts?: { listFiles?: Record<string, { name: string }[]> },
  rpcQueue: Resp[] = [],
) {
  let fromCallIndex = 0;
  let rpcCallIndex = 0;
  const insertCalls: unknown[] = [];
  const removeCalls: { bucket: string; paths: string[] }[] = [];
  const rpcCalls: { name: string; params: unknown }[] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => {
        const queue = fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue, insertCalls);
      },
      // apply_cv_extraction_checked()/apply_my_cv_extraction_checked() (0123)
      // moved the read-gate-write sequence into one locked Postgres
      // transaction - from this TS-level mock's point of view that's a
      // single rpc() call, queued the same way .from() responses are.
      rpc: async (name: string, params: unknown) => {
        rpcCalls.push({ name, params });
        const next = rpcQueue[rpcCallIndex] ?? { data: null, error: null };
        rpcCallIndex += 1;
        return next;
      },
      storage: {
        from: (bucket: string) => ({
          list: async (path: string) => ({ data: storageOpts?.listFiles?.[path] ?? [], error: null }),
          remove: async (paths: string[]) => {
            removeCalls.push({ bucket, paths });
            return { data: null, error: null };
          },
        }),
      },
    },
    insertCalls,
    removeCalls,
    rpcCalls,
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

// Fixed sentinel so the test can assert the real sastToday() helper was
// actually used, not a coincidentally-matching raw UTC date.
vi.mock("@/lib/publicHolidays", () => ({
  sastToday: () => "2099-01-01",
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

const pendingExtraction = {
  data: {
    id: "extraction-1",
    person_id: "person-1",
    review_status: "pending_review",
    proposed: { person: {}, projects: [{}] },
    cv_upload_id: "upload-1",
    cv_uploads: { original_filename: "cv.pdf" },
  },
  error: null,
};

describe("applyCvExtraction - source_note's 'today' is SAST-anchored, not a naive UTC date", () => {
  it("stamps the project's source_note from sastToday(), not new Date().toISOString().slice(0, 10)", async () => {
    const { client, rpcCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId's company_members lookup
        [pendingExtraction], // cv_extraction_results select
        [{ data: [{ id: "existing-job" }], error: null }], // queueStandardCvs' own "already queued" check - skips the insert branch entirely
      ],
      undefined,
      [{ data: null, error: null }], // apply_cv_extraction_checked (0123) - succeeds
    );
    supabaseState.current = client;

    const { applyCvExtraction } = await import("./actions");

    const fd = formDataWith({
      person_id: "person-1",
      extraction_id: "extraction-1",
      p0_use: "on",
      p0_client_and_number: "City of Tshwane / C-123",
    });
    const url = await expectRedirect(applyCvExtraction(fd));

    expect(url).toContain("/people/person-1");
    expect(url).not.toContain("error=");

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("apply_cv_extraction_checked");
    const params = rpcCalls[0].params as { p_project_rows: Array<{ source_note: string }> };
    expect(params.p_project_rows).toHaveLength(1);
    expect(params.p_project_rows[0].source_note).toContain("confirmed 2099-01-01");
  });
});

// savePerson() edit path - "plain update twin" shape (no destructive
// consequence, but a real silent-false-success): `supabase.from("people").
// update(row).eq("id", id)` checked only `error`. Found alongside this
// pass's own deletePerson() re-read (standing review, 2026-11-06).
describe("savePerson - edit path, membership revoked mid-request (update matches zero rows)", () => {
  it("does not report success when the update matches zero rows", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
      [{ data: null, error: null }], // people update().select("id").maybeSingle() - 0 rows
    ]);
    supabaseState.current = client;

    const { savePerson } = await import("./actions");

    const fd = formDataWith({ id: "person-1", name: "Jane Doe" });
    const url = await expectRedirect(savePerson(fd));

    expect(url).not.toBe("/people/person-1");
    expect(url).toContain("/people/person-1?error=");
  });
});

describe("savePerson - edit path, real update still succeeds", () => {
  it("saves normally and redirects to the person's page", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: { id: "person-1" }, error: null }], // real match
    ]);
    supabaseState.current = client;

    const { savePerson } = await import("./actions");

    const fd = formDataWith({ id: "person-1", name: "Jane Doe" });
    const url = await expectRedirect(savePerson(fd));

    expect(url).toBe("/people/person-1");
  });
});

// Finding 218 (standing review, 2026-11-08) - generalizing Finding 217's shape
// ("a hard-validation gate checks only PART of what it should, because a
// same-purpose sibling was hardened and this one wasn't told") across every
// "is this a real X" validator in the codebase. people.id_number is, per
// 0001_init_schema.sql's own column comment, "a South African ID number" -
// the exact same real-world field company_principals.id_number is (0050),
// whose own save path, savePrincipal() (app/company/principals/actions.ts),
// already hard-gates with isValidSaId() ("That ID number isn't a valid
// 13-digit South African ID number."). savePerson() had NO validation on
// id_number at all - not a digit-count check, not isValidSaId(), nothing -
// so a value the sibling gate already correctly refuses sailed straight onto
// people.id_number, from which it is later printed verbatim onto real
// government tender forms (engine/fill_tender.py, engine/fill_conventional.py,
// engine/general/fill_flat_pdf.py's SBD4 "representative_id_number") and onto
// the person's generated CV (engine/cv/generate_cv.py's "ID Number:" line).
describe("savePerson - id_number is validated the same way its sibling savePrincipal() already does (Finding 218)", () => {
  it("refuses to save a person whose id_number isn't a real South African ID number", async () => {
    const { client, insertCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
    ]);
    supabaseState.current = client;

    const { savePerson } = await import("./actions");

    // "abc123def0123" is not 13 digits at all; isValidSaId() (run live, see
    // this finding's own write-up) correctly returns false for it.
    const fd = formDataWith({ id: "new", name: "Jane Doe", id_number: "abc123def0123" });
    const url = await expectRedirect(savePerson(fd));

    expect(url).toContain("/people/new?error=");
    expect(url).toContain(encodeURIComponent("valid 13-digit South African ID number"));
    expect(insertCalls).toHaveLength(0);
  });

  it("still saves normally when id_number is a genuinely valid South African ID number", async () => {
    const { client, insertCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: { id: "person-1" }, error: null }],
    ]);
    supabaseState.current = client;

    const { savePerson } = await import("./actions");

    // "8601205135087" is genuinely valid per isValidSaId() (Luhn-correct,
    // plausible 1986-01-20 birth date, citizenship digit 0) - the same
    // fixture engine/cv/process_cv_jobs.py already uses as its own "Test
    // Person".
    const fd = formDataWith({ id: "new", name: "Jane Doe", id_number: "8601205135087" });
    const url = await expectRedirect(savePerson(fd));

    expect(url).toBe("/people/person-1");
    expect(insertCalls).toHaveLength(1);
  });

  it("still allows leaving id_number blank (not every person needs one on file)", async () => {
    const { client, insertCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: { id: "person-1" }, error: null }],
    ]);
    supabaseState.current = client;

    const { savePerson } = await import("./actions");

    const fd = formDataWith({ id: "new", name: "Jane Doe" });
    const url = await expectRedirect(savePerson(fd));

    expect(url).toBe("/people/person-1");
    expect(insertCalls).toHaveLength(1);
  });
});

// applyCvExtraction()'s own people-update/projects-insert/mark-applied
// sequence used to be three separate, unlocked writes, the last of which
// never re-checked review_status in its own .eq() chain - a genuine two-
// concurrent-invocations race (double-click, two tabs on the same pending
// review card) that silently duplicated real `projects` rows with no error
// to either caller, found by the standing review's own systematic sweep of
// Server Actions for the Finding-178/180 read-then-write/TOCTOU-gate shape
// (2026-11-07). Moved into one locked SQL transaction
// (apply_cv_extraction_checked, 0123) - from this TS-level mock's point of
// view, the people update / projects insert / mark-applied write is now a
// single rpc() call, and any failure path (the row no longer pending_review,
// the caller no longer a company member, a genuine DB error) comes back as
// one rpc error instead of three separately-checked zero-row writes.
const extractionTickedPersonField = {
  person_id: "person-1",
  extraction_id: "extraction-1",
  use_ecsa_level: "on",
  f_ecsa_level: "Professional Engineer",
};

describe("applyCvExtraction - apply_cv_extraction_checked rpc reports a failure", () => {
  it("does not report success, and does not go on to queue standard CVs", async () => {
    const { client, rpcCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
        [pendingExtraction], // cv_extraction_results select
      ],
      undefined,
      [{ data: null, error: { message: "These extracted fields were already saved or discarded." } }],
    );
    supabaseState.current = client;

    const { applyCvExtraction } = await import("./actions");
    const url = await expectRedirect(applyCvExtraction(formDataWith(extractionTickedPersonField)));

    expect(url).not.toContain("cv_applied=");
    expect(url).toContain("/people/person-1?error=");
    expect(url).toContain(encodeURIComponent("already saved or discarded"));
    // queueStandardCvs() must not run at all once the rpc itself failed -
    // no further .from() call beyond the two reads above.
    expect(rpcCalls).toHaveLength(1);
  });
});

describe("applyCvExtraction - apply_cv_extraction_checked rpc succeeds", () => {
  it("succeeds normally and passes the ticked person fields through to the rpc call", async () => {
    const { client, rpcCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }],
        [pendingExtraction],
        [{ data: [{ id: "existing-job" }], error: null }], // queueStandardCvs' "already queued" check
      ],
      undefined,
      [{ data: null, error: null }],
    );
    supabaseState.current = client;

    const { applyCvExtraction } = await import("./actions");
    const url = await expectRedirect(applyCvExtraction(formDataWith(extractionTickedPersonField)));

    expect(url).toContain("/people/person-1?cv_applied=");
    expect(url).not.toContain("error=");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("apply_cv_extraction_checked");
    const params = rpcCalls[0].params as { p_person_fields: Record<string, string> };
    expect(params.p_person_fields).toEqual({ ecsa_level: "Professional Engineer" });
  });
});

// queueStandardCvs()'s own "already queued?" check (called from
// applyCvExtraction()) had no error capture - standing review, 2026-11-06.
// Unlike requestTenderCv()'s equivalent dedupe check, this one has NO
// database-level unique-index backstop (migration 0075 deliberately scoped
// its index to tender-specific requests only), so a transient read failure
// here used to fall through to "nothing pending" and queue a second,
// duplicate set of 4 standard-CV jobs. Now fails closed instead.
describe("applyCvExtraction - queueStandardCvs' own pending-check read fails", () => {
  it("does not queue a duplicate set of standard CVs, and reports the failure rather than silently proceeding", async () => {
    const { client, insertCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
        [pendingExtraction], // cv_extraction_results select
        [{ data: null, error: { message: "read failed" } }], // queueStandardCvs' own pending check - errors
      ],
      undefined,
      [{ data: null, error: null }], // apply_cv_extraction_checked - succeeds
    );
    supabaseState.current = client;

    const { applyCvExtraction } = await import("./actions");

    const url = await expectRedirect(applyCvExtraction(formDataWith(extractionTickedPersonField)));

    expect(url).toContain("/people/person-1?error=");
    expect(url).not.toContain("cv_applied=");
    // No generated_cvs insert should have happened - the pending-check's own
    // read failure must not be treated as "nothing pending, go ahead".
    expect(insertCalls).toHaveLength(0);
  });
});

describe("discardCvExtraction - matches zero rows (revoked mid-request, or already moved on)", () => {
  it("does not redirect as if the discard happened", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
      [{ data: null, error: null }], // update().select("id").maybeSingle() - zero-row match
    ]);
    supabaseState.current = client;

    const { discardCvExtraction } = await import("./actions");
    const url = await expectRedirect(discardCvExtraction(formDataWith({ person_id: "person-1", extraction_id: "extraction-1" })));

    expect(url).toContain("/people/person-1?error=");
  });
});

describe("discardCvExtraction - real update still succeeds", () => {
  it("redirects back to the person's page with no error when the discard genuinely matches", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: { id: "extraction-1" }, error: null }],
    ]);
    supabaseState.current = client;

    const { discardCvExtraction } = await import("./actions");
    const url = await expectRedirect(discardCvExtraction(formDataWith({ person_id: "person-1", extraction_id: "extraction-1" })));

    expect(url).toBe("/people/person-1");
  });
});

// deleteProject() used to check NOTHING at all on the delete - not even
// `error` (the same "worst instance" shape experience/actions.ts's
// deleteExperience() had before its own fix). No destructive consequence
// (projects have no attached storage file), so this only needs an `error`
// check, not a full rows-matched gate.
describe("deleteProject - the delete's own error is now actually checked", () => {
  it("surfaces a real delete error instead of silently reporting success", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
      [{ data: null, error: { message: "boom" } }], // projects delete fails
    ]);
    supabaseState.current = client;

    const { deleteProject } = await import("./actions");

    const fd = formDataWith({ project_id: "project-1", person_id: "person-1" });
    const url = await expectRedirect(deleteProject(fd));

    expect(url).toContain("/people/person-1?error=");
  });

  it("still redirects cleanly when the delete genuinely succeeds", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: null, error: null }],
    ]);
    supabaseState.current = client;

    const { deleteProject } = await import("./actions");

    const fd = formDataWith({ project_id: "project-1", person_id: "person-1" });
    const url = await expectRedirect(deleteProject(fd));

    expect(url).toBe("/people/person-1");
  });
});

// deletePerson() - reordered 2026-11-06. Previously the row delete ran LAST,
// checked only by `error`, AFTER every CV/generated-CV/registration-
// certificate storage file had already been unconditionally destroyed. A
// membership-revoked-mid-request race (another admin's removeMember(), 0114,
// at any point during this function's own earlier reads/listings - a real,
// multi-round-trip window, not a narrow one) meant PostgREST's real "0 rows,
// error: null" response on that final delete went undetected, while every
// real file this person's rows pointed at was already gone and the person
// row itself was never actually deleted. The delete now runs FIRST, checked
// with `.select("id").maybeSingle()`, and all storage removal is gated on it
// having actually matched.
describe("deletePerson - membership revoked mid-request (people delete matches zero rows)", () => {
  it("does not report success and does not delete any of this person's files", async () => {
    const { client, removeCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
      [{ data: { id: "person-1" }, error: null }], // up-front existence check
      [{ data: [{ storage_path: "company-1/people/person-1/uploads/cv1.pdf" }], error: null }], // cv_uploads select
      [{ data: [], error: null }], // generated_cvs select
      [{ data: [{ storage_path: "company-1/registrations/person-1/cert.pdf" }], error: null }], // held_registrations select
      [{ data: null, error: null }], // people delete().select("id").maybeSingle() - membership revoked -> 0 rows
    ]);
    supabaseState.current = client;

    const { deletePerson } = await import("./actions");

    const fd = formDataWith({ id: "person-1" });
    const url = await expectRedirect(deletePerson(fd));

    expect(url).not.toBe("/people");
    expect(url).toContain("/people/person-1?error=");
    // Nothing should have been removed from storage - the row was never
    // actually deleted.
    expect(removeCalls).toHaveLength(0);
  });
});

describe("deletePerson - real delete still succeeds", () => {
  it("deletes the person and then cleans up all of their real files", async () => {
    const { client, removeCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [{ data: { id: "person-1" }, error: null }],
      [{ data: [{ storage_path: "company-1/people/person-1/uploads/cv1.pdf" }], error: null }],
      [{ data: [], error: null }],
      [{ data: [{ storage_path: "company-1/registrations/person-1/cert.pdf" }], error: null }],
      [{ data: { id: "person-1" }, error: null }], // real match
    ]);
    supabaseState.current = client;

    const { deletePerson } = await import("./actions");

    const fd = formDataWith({ id: "person-1" });
    const url = await expectRedirect(deletePerson(fd));

    expect(url).toBe("/people");
    const cvRemove = removeCalls.find((c) => c.bucket === "cv-documents");
    const regRemove = removeCalls.find((c) => c.bucket === "company-documents");
    expect(cvRemove?.paths).toContain("company-1/people/person-1/uploads/cv1.pdf");
    expect(regRemove?.paths).toContain("company-1/registrations/person-1/cert.pdf");
  });
});
