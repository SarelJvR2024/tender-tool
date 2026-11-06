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
) {
  let fromCallIndex = 0;
  const insertCalls: unknown[] = [];
  const removeCalls: { bucket: string; paths: string[] }[] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => {
        const queue = fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue, insertCalls);
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
    const { client, insertCalls } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId's company_members lookup
      [pendingExtraction], // cv_extraction_results select
      [{ data: null, error: null }], // projects insert
      [{ data: { id: "extraction-1" }, error: null }], // cv_extraction_results update().select("id").maybeSingle() (mark applied) - real match
      [{ data: [{ id: "existing-job" }], error: null }], // queueStandardCvs' own "already queued" check - skips the insert branch entirely
    ]);
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

    const projectInsert = insertCalls[0] as Array<{ source_note: string }>;
    expect(projectInsert).toHaveLength(1);
    expect(projectInsert[0].source_note).toContain("confirmed 2099-01-01");
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

// applyCvExtraction()/discardCvExtraction() - the same membership-revoked-
// mid-request "plain update twin" shape as savePerson() above, found
// unswept in THIS file (standing review, 2026-11-06). Notably,
// app/app/my-cv/actions.ts's own applyMyCvExtraction()/
// discardMyCvExtraction() - explicitly documented there as "same shape as
// app/app/people/actions.ts applyCvExtraction" - were already fixed for
// this exact race; the original this file's sibling was modeled on had
// never itself been swept. No file/destructive consequence (person fields
// just don't get re-applied; cv_extraction_results can get stuck on
// 'pending_review'), but still a real silent-false-success.
const extractionTickedPersonField = {
  person_id: "person-1",
  extraction_id: "extraction-1",
  use_ecsa_level: "on",
  f_ecsa_level: "Professional Engineer",
};

describe("applyCvExtraction - person update matches zero rows", () => {
  it("does not report success, and does not go on to insert projects or mark the extraction applied", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
      [pendingExtraction], // cv_extraction_results select
      [{ data: null, error: null }], // people update().select("id").maybeSingle() - zero-row RLS match
    ]);
    supabaseState.current = client;

    const { applyCvExtraction } = await import("./actions");
    const url = await expectRedirect(applyCvExtraction(formDataWith(extractionTickedPersonField)));

    expect(url).not.toContain("cv_applied=");
    expect(url).toContain("/people/person-1?error=");
  });
});

describe("applyCvExtraction - person update matches, but marking the extraction applied matches zero rows", () => {
  it("does not report success, leaving the extraction genuinely re-checkable rather than silently stuck on 'pending_review'", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [pendingExtraction],
      [{ data: { id: "person-1" }, error: null }], // people update - real match
      [{ data: null, error: null }], // cv_extraction_results update().select("id").maybeSingle() - zero-row RLS match
    ]);
    supabaseState.current = client;

    const { applyCvExtraction } = await import("./actions");
    const url = await expectRedirect(applyCvExtraction(formDataWith(extractionTickedPersonField)));

    expect(url).not.toContain("cv_applied=");
    expect(url).toContain("/people/person-1?error=");
  });
});

describe("applyCvExtraction - person update + mark-applied both genuinely match", () => {
  it("still succeeds normally with the added .select().maybeSingle() gates", async () => {
    const { client } = makeSupabase([
      [{ data: { company_id: "company-1" }, error: null }],
      [pendingExtraction],
      [{ data: { id: "person-1" }, error: null }], // people update - real match
      [{ data: { id: "extraction-1" }, error: null }], // cv_extraction_results update - real match
      [{ data: [{ id: "existing-job" }], error: null }], // queueStandardCvs' "already queued" check
    ]);
    supabaseState.current = client;

    const { applyCvExtraction } = await import("./actions");
    const url = await expectRedirect(applyCvExtraction(formDataWith(extractionTickedPersonField)));

    expect(url).toContain("/people/person-1?cv_applied=");
    expect(url).not.toContain("error=");
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
