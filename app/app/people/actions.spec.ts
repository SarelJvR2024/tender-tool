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

function makeSupabase(fromQueues: Resp[][]) {
  let fromCallIndex = 0;
  const insertCalls: unknown[] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => {
        const queue = fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue, insertCalls);
      },
    },
    insertCalls,
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
      [{ data: null, error: null }], // cv_extraction_results update (mark applied)
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
