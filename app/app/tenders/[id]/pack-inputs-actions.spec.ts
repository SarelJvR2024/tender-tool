import { afterEach, describe, expect, it, vi } from "vitest";

// Finding 423: uploadTenderTemplate() (app/app/tenders/[id]/pack-inputs-
// actions.ts) uploads the company's blank-template copy to the
// 'tender-documents' bucket, THEN calls record_tender_document() (0025/
// 0045) to register it. record_tender_document() can genuinely fail
// independently of the upload itself having succeeded - e.g. its own
// "Start a pack for this tender before uploading its templates" check
// (0045), or a transient RPC error - and pre-fix, that failure path never
// cleaned up the file the upload step had just put in storage: an orphan
// with nothing in this repo ever pointing at or sweeping it again.
//
// This is the same upload-then-insert-orphans-on-failure shape Finding 422
// already fixed across every file literally named `actions.ts` under
// app/app/** - pack-inputs-actions.ts sat outside that sweep's own file
// glob (it is deliberately NOT named `actions.ts`, per this file's own
// header comment: "Kept out of actions.ts so the two can change
// independently").
//
// Mocking technique copied from the established convention in this same
// directory (general-actions.spec.ts / vault-quick-fix-actions.spec.ts): a
// sequential per-`.from()`-call response queue, a minimal thenable/
// chainable stub, an `.rpc()` spy, a `.storage.from().upload()/.remove()`
// spy, and mocked `@/lib/supabase/server`/`next/navigation`/`next/cache` -
// calls the real, unmodified exported action, not a reimplementation of
// its logic.

type Resp = { data: unknown; error: { message: string } | null };

// `upsertCalls`: Finding 469's own test below needs to inspect the BODY of
// a `.from(table).upsert(body, opts)` call (not just that an upsert
// happened, like uploadCalls/removeCalls already do for storage) - so this
// generic chain, shared with every other test in this file, records each
// one it sees (table name + body) rather than treating upsert as just
// another no-op passthrough method like `.eq()`/`.select()`.
function makeChain(queue: Resp[], table: string, upsertCalls: { table: string; body: unknown }[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "in", "maybeSingle", "order"];
  for (const m of methods) chain[m] = () => chain;
  chain.upsert = (body: unknown) => {
    upsertCalls.push({ table, body });
    return chain;
  };
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => {
    const next = queue.shift();
    resolve(next ?? { data: null, error: null });
  };
  return chain;
}

function makeSupabase(
  fromQueues: Resp[][],
  opts: { rpcResp: Resp; uploadError?: { message: string } | null }
) {
  let fromCallIndex = 0;
  const fromCalls: string[] = [];
  const uploadCalls: { bucket: string; path: string }[] = [];
  const removeCalls: { bucket: string; paths: string[] }[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const upsertCalls: { table: string; body: unknown }[] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        fromCalls.push(table);
        const queue = fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue, table, upsertCalls);
      },
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string) => {
            uploadCalls.push({ bucket, path });
            return { data: opts.uploadError ? null : { path }, error: opts.uploadError ?? null };
          },
          remove: async (paths: string[]) => {
            removeCalls.push({ bucket, paths });
            return { data: null, error: null };
          },
        }),
      },
      rpc: async (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        return opts.rpcResp;
      },
    },
    fromCalls,
    uploadCalls,
    removeCalls,
    rpcCalls,
    upsertCalls,
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

function formData(tenderId: string, docType: string, fileName: string) {
  const fd = new FormData();
  fd.set("tender_id", tenderId);
  fd.set("doc_type", docType);
  fd.set("file", new File([new Uint8Array([1, 2, 3])], fileName));
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

describe("uploadTenderTemplate - record_tender_document() fails after the upload already succeeded", () => {
  it("removes the just-uploaded object from storage instead of orphaning it forever", async () => {
    const { client, uploadCalls, removeCalls, rpcCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId's company_members lookup
      ],
      {
        rpcResp: { data: null, error: { message: "Start a pack for this tender before uploading its templates." } },
      }
    );
    supabaseState.current = client;

    const { uploadTenderTemplate } = await import("./pack-inputs-actions");

    const url = await expectRedirect(
      uploadTenderTemplate(formData("tender-1", "technical_xlsm", "Technical Submission.xlsm"))
    );

    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].bucket).toBe("tender-documents");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("record_tender_document");

    // The bug: pre-fix, nothing ever removed the object the upload call
    // above just put in storage once record_tender_document() failed.
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0].bucket).toBe("tender-documents");
    expect(removeCalls[0].paths).toEqual([uploadCalls[0].path]);

    expect(url).toContain("/tenders/tender-1");
    expect(url).toContain("error=");
  });

  it("does NOT call remove() when the upload itself is the thing that failed (nothing to clean up)", async () => {
    const { client, uploadCalls, removeCalls, rpcCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }],
      ],
      {
        rpcResp: { data: null, error: null },
        uploadError: { message: "network error" },
      }
    );
    supabaseState.current = client;

    const { uploadTenderTemplate } = await import("./pack-inputs-actions");

    await expectRedirect(
      uploadTenderTemplate(formData("tender-1", "technical_xlsm", "Technical Submission.xlsm"))
    );

    expect(uploadCalls).toHaveLength(1);
    expect(rpcCalls).toHaveLength(0); // record_tender_document is never reached
    expect(removeCalls).toHaveLength(0); // nothing was ever stored - no orphan possible
  });

  it("does not remove anything and redirects to the saved url when both the upload and the RPC succeed", async () => {
    const { client, uploadCalls, removeCalls, rpcCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }],
      ],
      { rpcResp: { data: "doc-1", error: null } }
    );
    supabaseState.current = client;

    const { uploadTenderTemplate } = await import("./pack-inputs-actions");

    const url = await expectRedirect(
      uploadTenderTemplate(formData("tender-1", "technical_xlsm", "Technical Submission.xlsm"))
    );

    expect(uploadCalls).toHaveLength(1);
    expect(rpcCalls).toHaveLength(1);
    expect(removeCalls).toHaveLength(0);
    expect(url).toContain("saved=template");
  });
});

// Finding 469 (standing solution-architect review, 2026-11-12):
// confirmPositionPerson() is the ONLY place in the app that writes
// tender_pack_assignments.confirmed_person_id, but it never wrote the
// table's own specialism_warning column (0001) at all - sync_position_
// suggestions() (engine/pack/process_pack_jobs.py) only ever writes
// candidate_scores/scored_at, never this scalar column either. Three real
// consumers read it: compliance-report.tsx's "Specialism not evidenced"
// chip, process_pack_jobs.py's pack_suggestions_positions() (feeding
// run_forms_pipeline.py's ACTIONS_TO_SIGN.md note), and process_cv_jobs.py
// (feeding generate_cv.py's own warning paragraph on the tender-specific CV
// cover page that ships in the actual submitted pack) - all three always
// read `false`, the column's untouched schema default, for every real
// confirmation ever made. Fixed by looking the just-confirmed person's own
// specialism_warning up in the position's already-stored candidate_scores
// ranking and carrying it across in the same upsert.
describe("confirmPositionPerson - specialism_warning is carried from candidate_scores into the write", () => {
  it("writes specialism_warning: true when the confirmed person's own candidate_scores entry flags it", async () => {
    const { client, upsertCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }], // 0: company_members
        [{ data: { id: "pack-1", status: "suggested" }, error: null }], // 1: tender_packs select
        [{ data: { id: "person-1" }, error: null }], // 2: people existence check (personId set)
        [{ data: { candidate_scores: [
          { person_id: "person-1", name: "Jane Doe", score: 3, years_experience: 5, ecsa_level: null,
            matched: [], missing: ["pavement"], specialism_warning: true, rationale: "no overlap" },
        ] }, error: null }], // 3: tender_pack_assignments candidate_scores
        [{ data: { position_description: "Pavement specialist" }, error: null }], // 4: tender_requirements
        [{ data: [], error: null }], // 5: person_role_eligibility
        [{ data: [{ id: "person-1" }], error: null }], // 6: people (company)
        [{ data: null, error: null }], // 7: tender_pack_assignments upsert
        [{ data: [], error: null }], // 8: tender_requirements position_code list
        [{ data: [], error: null }], // 9: tender_pack_assignments position_code/confirmed_person_id list
      ],
      { rpcResp: { data: null, error: null } }
    );
    supabaseState.current = client;

    const { confirmPositionPerson } = await import("./pack-inputs-actions");
    await confirmPositionPerson("tender-1", "pack-1", "DS1", "person-1");

    const asg = upsertCalls.find((c) => c.table === "tender_pack_assignments");
    expect(asg).toBeDefined();
    expect((asg!.body as { confirmed_person_id: string }).confirmed_person_id).toBe("person-1");
    // The bug: pre-fix, this key was entirely absent from the upsert body -
    // the column was never written at all, so it stayed at its schema
    // default (false) forever regardless of what candidate_scores said.
    expect((asg!.body as { specialism_warning: boolean }).specialism_warning).toBe(true);
  });

  it("writes specialism_warning: false when the confirmed person's own candidate_scores entry does not flag it", async () => {
    const { client, upsertCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }],
        [{ data: { id: "pack-1", status: "suggested" }, error: null }],
        [{ data: { id: "person-2" }, error: null }],
        [{ data: { candidate_scores: [
          { person_id: "person-2", name: "Mark Smith", score: 9, years_experience: 12, ecsa_level: "Professional Engineer",
            matched: ["pavement", "materials"], missing: [], specialism_warning: false, rationale: "matches on: materials, pavement" },
        ] }, error: null }],
        [{ data: { position_description: "Pavement specialist" }, error: null }],
        [{ data: [], error: null }],
        [{ data: [{ id: "person-2" }], error: null }],
        [{ data: null, error: null }],
        [{ data: [], error: null }],
        [{ data: [], error: null }],
      ],
      { rpcResp: { data: null, error: null } }
    );
    supabaseState.current = client;

    const { confirmPositionPerson } = await import("./pack-inputs-actions");
    await confirmPositionPerson("tender-1", "pack-1", "DS1", "person-2");

    const asg = upsertCalls.find((c) => c.table === "tender_pack_assignments");
    expect((asg!.body as { specialism_warning: boolean }).specialism_warning).toBe(false);
  });

  it("writes specialism_warning: false when clearing a position (personId null), even with a stale warning on file for someone else", async () => {
    const { client, upsertCalls } = makeSupabase(
      [
        [{ data: { company_id: "company-1" }, error: null }], // 0: company_members
        [{ data: { id: "pack-1", status: "suggested" }, error: null }], // 1: tender_packs select
        // no people-existence check: personId is null, that `if` block is skipped entirely
        [{ data: { candidate_scores: [
          { person_id: "person-1", name: "Jane Doe", score: 3, years_experience: 5, ecsa_level: null,
            matched: [], missing: ["pavement"], specialism_warning: true, rationale: "no overlap" },
        ] }, error: null }], // 2: tender_pack_assignments candidate_scores
        [{ data: { position_description: "Pavement specialist" }, error: null }], // 3: tender_requirements
        [{ data: [], error: null }], // 4: person_role_eligibility
        [{ data: [{ id: "person-1" }], error: null }], // 5: people (company)
        [{ data: null, error: null }], // 6: tender_pack_assignments upsert
        [{ data: [], error: null }], // 7: tender_requirements position_code list
        [{ data: [], error: null }], // 8: tender_pack_assignments position_code/confirmed_person_id list
      ],
      { rpcResp: { data: null, error: null } }
    );
    supabaseState.current = client;

    const { confirmPositionPerson } = await import("./pack-inputs-actions");
    await confirmPositionPerson("tender-1", "pack-1", "DS1", null);

    const asg = upsertCalls.find((c) => c.table === "tender_pack_assignments");
    expect((asg!.body as { confirmed_person_id: string | null }).confirmed_person_id).toBeNull();
    expect((asg!.body as { specialism_warning: boolean }).specialism_warning).toBe(false);
  });
});
