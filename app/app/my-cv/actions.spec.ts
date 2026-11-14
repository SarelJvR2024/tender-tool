import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness tests for app/my-cv/actions.ts.
//
// Same bug class as every other "membership-revoked-mid-request" fix in this
// repo (23b43b4, 7345243, 0a3ac73, 7434ddb, d0d9414, ...): an
// `.update(...).eq("id", id)` checked only by `error`. PostgREST returns a
// 2xx with `error: null` and zero rows affected when RLS's own USING clause
// (re-evaluated against the OLD row) no longer matches at write time, even
// though an earlier read in the same request saw the row.
//
// This file's own gate is slightly different from the company-membership
// instances already fixed elsewhere: every write here is also narrowed by
// 0077's "employee restricted to own record"/"...own person" RESTRICTIVE
// policies, keyed on people.linked_user_id = auth.uid() (own_linked_person_id()).
// The realistic trigger is an owner/admin unlinking this person (clearing
// people.linked_user_id, e.g. correcting a mistaken link or off-boarding
// someone) - or removing the signed-in user's own company_members row
// outright - while their My CV form is still open/submitting. No file
// upload is unconditionally destroyed here (unlike the company/experience/
// properties instances), but each write still silently no-ops while the
// page reports success, and applyMyCvExtraction()'s second write can leave
// a real AI-extracted CV result permanently stuck on 'pending_review' with
// the UI believing it was already applied.
//
// my-cv/actions.ts was never swept for this bug class by any prior pass
// (every prior sweep covered app/app/people/actions.ts, company/*, and
// experience/actions.ts - a different file under app/app/my-cv/ with its
// own self-service requireOwnPerson() gate). Found and fixed in the standing
// solution-architect review, 2026-11-06.
//
// Mocking technique and chain shape copied from the established convention
// (app/company/actions.spec.ts, app/experience/actions.spec.ts, ...) - calls
// the real, unmodified exported action, not a reimplementation of its logic.

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

function makeSupabase(fromQueues: Resp[][], rpcQueue: Resp[] = [], storageOpts?: { uploadError?: { message: string } | null }) {
  let fromCallIndex = 0;
  let rpcCallIndex = 0;
  const rpcCalls: { name: string; params: unknown }[] = [];
  const insertCalls: unknown[] = [];
  const uploadCalls: { bucket: string; path: string }[] = [];
  const removeCalls: { bucket: string; paths: string[] }[] = [];
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => {
      const queue = fromQueues[fromCallIndex] ?? [];
      fromCallIndex += 1;
      return makeChain(queue, insertCalls);
    },
    // apply_my_cv_extraction_checked() (0123) moved the read-gate-write
    // sequence into one locked Postgres transaction - from this TS-level
    // mock's point of view that's a single rpc() call, queued the same way
    // .from() responses are.
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push({ name, params });
      const next = rpcQueue[rpcCallIndex] ?? { data: null, error: null };
      rpcCallIndex += 1;
      return next;
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          uploadCalls.push({ bucket, path });
          return { data: { path }, error: storageOpts?.uploadError ?? null };
        },
        remove: async (paths: string[]) => {
          removeCalls.push({ bucket, paths });
          return { data: null, error: null };
        },
      }),
    },
    rpcCalls,
    insertCalls,
    uploadCalls,
    removeCalls,
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

// requireOwnPerson()'s own two reads - a genuine member, linked to a person.
// A function, not a shared constant: makeChain's own queue.shift() mutates
// whatever array it's given, so a module-level constant reused (even via
// spread, which only shallow-copies the outer array) across tests would be
// emptied by the first test and starve every later one.
function requireOwnPersonOk(): Resp[][] {
  return [
    [{ data: { company_id: "company-1" }, error: null }], // company_members select
    [{ data: { id: "person-1" }, error: null }], // people select (linked_user_id match)
  ];
}

describe("saveMyDetails - membership/link revoked mid-request (people update matches zero rows)", () => {
  it("does not report success when the update matches zero rows", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: null, error: null }], // update().select("id").maybeSingle() - zero-row RLS match
    ]);

    const { saveMyDetails } = await import("./actions");
    const url = await expectRedirect(saveMyDetails(formDataWith({ phone: "0821234567" })));

    expect(url).not.toContain("saved=details");
    expect(url).toContain("/my-cv?error=");
  });
});

describe("saveMyDetails - real update still succeeds", () => {
  it("saves normally when the update genuinely matches the row", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: { id: "person-1" }, error: null }], // real match
    ]);

    const { saveMyDetails } = await import("./actions");
    const url = await expectRedirect(saveMyDetails(formDataWith({ phone: "0821234567" })));

    expect(url).toBe("/my-cv?saved=details");
  });
});

// Finding 467: saveMyDetails() is this page's OWN separate manual "My
// details" edit form (app/app/my-cv/page.tsx's first Card, a plain <input>
// via the page's local Field() helper) - a different form entirely from the
// CV-extraction-review card further down the same page, which submits
// through applyMyCvExtraction() instead. Finding 432 constrained
// ecsa_level/highest_level only on that second form (both the <select> in
// the page and the "choose one of SANRAL's options" check in
// applyMyCvExtraction()) - its own write-up, and lib/cvExtraction.ts's own
// header comment, call out "my-cv/page.tsx" as fixed for this exact gap, but
// both actually meant this CV-review card, not this separate manual form on
// the same route, so saveMyDetails() itself was never touched: it still
// takes ecsa_level/highest_level as plain strings with no check at all - the
// exact same door Finding 466 closed on people/[id]/page.tsx's own manual
// "edit this person" form, just left open here. A value that doesn't match
// one of SANRAL's own Form B2.1 dropdown labels saves fine through this form
// with zero warning, only for engine/fill_conventional.py's set_dropdown_for()
// to later refuse it with a FieldError when a real pack is generated.
describe("saveMyDetails - a 'select'-kind field must be one of SANRAL's own options (Finding 467)", () => {
  it("refuses an ecsa_level that isn't one of ECSA_LEVELS", async () => {
    const supabase = makeSupabase([...requireOwnPersonOk()]);
    supabaseState.current = supabase;

    const { saveMyDetails } = await import("./actions");
    const url = await expectRedirect(saveMyDetails(formDataWith({ ecsa_level: "Pr Eng" })));

    expect(url).toContain("/my-cv?error=");
    expect(url).toContain(encodeURIComponent("choose one of SANRAL's options"));
  });

  it("refuses a highest_level that isn't one of QUALIFICATION_LEVELS", async () => {
    const supabase = makeSupabase([...requireOwnPersonOk()]);
    supabaseState.current = supabase;

    const { saveMyDetails } = await import("./actions");
    const url = await expectRedirect(saveMyDetails(formDataWith({ highest_level: "BEng" })));

    expect(url).toContain("/my-cv?error=");
    expect(url).toContain(encodeURIComponent("choose one of SANRAL's options"));
  });

  it("still saves normally when both are genuinely one of SANRAL's own options", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: { id: "person-1" }, error: null }], // real match
    ]);

    const { saveMyDetails } = await import("./actions");
    const url = await expectRedirect(
      saveMyDetails(formDataWith({ ecsa_level: "Professional Engineer", highest_level: "Masters Degree" })),
    );

    expect(url).toBe("/my-cv?saved=details");
  });

  it("still saves normally when both are left blank (not recorded)", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: { id: "person-1" }, error: null }], // real match
    ]);

    const { saveMyDetails } = await import("./actions");
    const url = await expectRedirect(saveMyDetails(formDataWith({ phone: "0821234567" })));

    expect(url).toBe("/my-cv?saved=details");
  });
});

// Finding 482 (standing solution-architect review, 2026-11-14): saveMyDetails()
// is this page's own manual "My details" form (app/app/my-cv/page.tsx's
// first Card) - the self-service twin of app/app/people/actions.ts
// savePerson(), which Finding 481 just fixed for the SAME shape on its own
// date columns (ecsa_date/sacpcmp_date/highest_graduated/initial_graduated).
// This form only ever submits ONE of those four columns - highest_graduated
// (rendered as a type="date" <input> at my-cv/page.tsx line 203) -
// ecsa_date/sacpcmp_date/initial_graduated are not part of this manual form
// at all (only reachable here via the separate CV-extraction-review card,
// through applyMyCvExtraction(), which already runs this exact check per
// Finding 432). Before this fix, saveMyDetails() ran its Finding 467
// ecsa_level/highest_level "select" check but had NO check at all on
// highest_graduated - a direct POST (or a browser date-picker quirk) could
// save any string straight into people.highest_graduated. Confirmed real:
// engine/fill_tender.py and engine/fill_conventional.py both call
// `wb.set_date(T, at(B["highest_date"], base), q["highest_graduated"])`,
// and sanral_fill.py's own set_date() strictly requires `YYYY-MM-DD`
// (`datetime.date.fromisoformat`), raising ValueError otherwise - so a bad
// value saved here fails loudly, but only much later, at real pack
// generation, instead of immediately at data entry.
describe("saveMyDetails - highest_graduated must be a real yyyy-mm-dd date (Finding 482)", () => {
  it("refuses a highest_graduated that isn't ISO yyyy-mm-dd", async () => {
    const supabase = makeSupabase([...requireOwnPersonOk()]);
    supabaseState.current = supabase;

    const { saveMyDetails } = await import("./actions");
    const url = await expectRedirect(saveMyDetails(formDataWith({ highest_graduated: "23/04/2010" })));

    expect(url).toContain("/my-cv?error=");
    expect(url).toContain(encodeURIComponent('Date graduated (highest): "23/04/2010" isn\'t a date (yyyy-mm-dd).'));
  });

  it("still saves normally when highest_graduated is a genuine ISO date", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: { id: "person-1" }, error: null }], // real match
    ]);

    const { saveMyDetails } = await import("./actions");
    const url = await expectRedirect(saveMyDetails(formDataWith({ highest_graduated: "2010-04-23" })));

    expect(url).toBe("/my-cv?saved=details");
  });

  it("still saves normally when highest_graduated is left blank (not recorded)", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: { id: "person-1" }, error: null }], // real match
    ]);

    const { saveMyDetails } = await import("./actions");
    const url = await expectRedirect(saveMyDetails(formDataWith({ phone: "0821234567" })));

    expect(url).toBe("/my-cv?saved=details");
  });
});

// Finding 432: must be one of lib/cvExtraction.ts's own ECSA_LEVELS strings
// now that applyMyCvExtraction() validates "select"-kind fields the same
// way its sibling applyCvExtraction() already does - "Pr Eng" (this
// fixture's value before that fix) is not a real SANRAL dropdown label and
// would now be refused.
const EXTRACTION_FORM = {
  extraction_id: "extraction-1",
  use_ecsa_level: "on",
  f_ecsa_level: "Professional Engineer",
};

// applyMyCvExtraction()'s own person-update-then-mark-applied sequence used
// to be two separate, unlocked writes, the second of which never re-checked
// review_status in its own .eq() chain - the exact gap this file's own
// discardMyCvExtraction() (below) was already fixed for (standing review,
// 2026-11-06), never applied to its "apply" twin until now. Moved into one
// locked SQL transaction (apply_my_cv_extraction_checked, 0123) - standing
// review, 2026-11-07 (Server Action read-then-write/TOCTOU-gate sweep). From
// this TS-level mock's point of view, the write is now a single rpc() call.
describe("applyMyCvExtraction - apply_my_cv_extraction_checked rpc reports a failure", () => {
  it("does not report success", async () => {
    supabaseState.current = makeSupabase(
      [
        ...requireOwnPersonOk(),
        [{ data: { id: "extraction-1", person_id: "person-1", review_status: "pending_review", proposed: {} }, error: null }], // cv_extraction_results read
      ],
      [{ data: null, error: { message: "These extracted fields were already saved or discarded." } }],
    );

    const { applyMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(applyMyCvExtraction(formDataWith(EXTRACTION_FORM)));

    expect(url).not.toContain("saved=extracted");
    expect(url).toContain("/my-cv?error=");
    expect(url).toContain(encodeURIComponent("already saved or discarded"));
  });
});

describe("applyMyCvExtraction - apply_my_cv_extraction_checked rpc succeeds", () => {
  it("saves and marks the extraction applied, passing the ticked fields through to the rpc call", async () => {
    const supabase = makeSupabase(
      [
        ...requireOwnPersonOk(),
        [{ data: { id: "extraction-1", person_id: "person-1", review_status: "pending_review", proposed: {} }, error: null }],
        [{ data: [], error: null }], // queueStandardCvs' own "already queued?" check - nothing pending
      ],
      [{ data: null, error: null }],
    );
    supabaseState.current = supabase;

    const { applyMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(applyMyCvExtraction(formDataWith(EXTRACTION_FORM)));

    expect(url).toBe("/my-cv?saved=extracted");
    expect(supabase.rpcCalls).toHaveLength(1);
    expect(supabase.rpcCalls[0].name).toBe("apply_my_cv_extraction_checked");
    const params = supabase.rpcCalls[0].params as { p_person_fields: Record<string, string> };
    expect(params.p_person_fields).toEqual({ ecsa_level: "Professional Engineer" });
  });
});

// Finding (standing solution-architect review, 2026-11-07): this function is
// the one true sibling of app/app/people/actions.ts applyCvExtraction() that
// never called queueStandardCvs() at all - no comment anywhere said this was
// deliberate, unlike the already-documented "no project-adding step" scope
// cut in this function's own header comment above. Confirmed via
// engine/general/process_general_jobs.py's own per-role generated_cvs
// lookup (takes the newest 'ready' row regardless of tender_id) that these
// standard rows are a real fallback CV source for general-tender packs, not
// just the "My generated CVs" read-only card on this same page - so a CV
// confirmed exclusively through My CV never got a single standard CV
// queued, with no way to retry once apply_my_cv_extraction_checked() had
// already moved the extraction's review_status off 'pending_review'.
describe("applyMyCvExtraction - also queues the 4 standard CV formats on success, same as applyCvExtraction", () => {
  it("inserts the 4 standard (tender_id-less) generated_cvs rows after the rpc succeeds", async () => {
    const supabase = makeSupabase(
      [
        ...requireOwnPersonOk(),
        [{ data: { id: "extraction-1", person_id: "person-1", review_status: "pending_review", proposed: {} }, error: null }],
        [{ data: [], error: null }], // queueStandardCvs' own "already queued?" check - nothing pending
      ],
      [{ data: null, error: null }],
    );
    supabaseState.current = supabase;

    const { applyMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(applyMyCvExtraction(formDataWith(EXTRACTION_FORM)));

    expect(url).toBe("/my-cv?saved=extracted");
    expect(supabase.insertCalls).toHaveLength(1);
    const rows = supabase.insertCalls[0] as { company_id: string; person_id: string; format: string; detail: string; status: string; requested_by: string }[];
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => `${r.format}/${r.detail}`).sort()).toEqual([
      "sanral_keyperson/detailed",
      "sanral_keyperson/summary",
      "world_bank/detailed",
      "world_bank/summary",
    ]);
    for (const r of rows) {
      expect(r.company_id).toBe("company-1");
      expect(r.person_id).toBe("person-1");
      expect(r.status).toBe("requested");
      expect(r.requested_by).toBe("user-1");
    }
  });
});

// Finding 431: this function's own `fields` list used to be a hand-typed
// subset of 10 keys instead of lib/cvExtraction.ts's canonical
// EXTRACTED_PERSON_FIELDS (17) that app/app/people/actions.ts
// applyCvExtraction() already uses for the identical review card on the full
// People page - silently dropping 7 real fields extract_cv_fields.py
// genuinely proposes (id_number, role, phone, email, initial_description,
// initial_institution, initial_graduated), including initial_graduated,
// which engine/pack_generator/confirm_pack.py hard-stops pack confirmation
// on when missing for a key person.
describe("applyMyCvExtraction - a field outside the old hand-typed 10-key subset is still saved (Finding 431)", () => {
  it("passes initial_graduated (and other previously-dropped fields) through to the rpc call", async () => {
    const supabase = makeSupabase(
      [
        ...requireOwnPersonOk(),
        [{ data: { id: "extraction-1", person_id: "person-1", review_status: "pending_review", proposed: {} }, error: null }],
        [{ data: [], error: null }], // queueStandardCvs' own "already queued?" check - nothing pending
      ],
      [{ data: null, error: null }],
    );
    supabaseState.current = supabase;

    const { applyMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(
      applyMyCvExtraction(
        formDataWith({
          extraction_id: "extraction-1",
          use_initial_graduated: "on",
          f_initial_graduated: "2010-04-23",
          use_role: "on",
          f_role: "Project Leader",
        }),
      ),
    );

    expect(url).toBe("/my-cv?saved=extracted");
    const params = supabase.rpcCalls[0].params as { p_person_fields: Record<string, string> };
    expect(params.p_person_fields).toEqual({ initial_graduated: "2010-04-23", role: "Project Leader" });
  });
});

// Finding 432 (standing solution-architect review, 2026-11-11): this
// function had NO validation of any kind - not even the required-name/
// ISO-date/select-options checks its sibling applyCvExtraction() already
// has - so an employee retyping the id_number box this page's own review
// card shows (a plain text input, not masked or constrained in any way
// before this fix) could save a garbage value straight into people.id_number,
// the same real-world column savePerson() (Finding 219) and now
// applyCvExtraction() (Finding 432, above) are both gated on.
describe("applyMyCvExtraction - id_number is validated via isValidSaId() (Finding 432)", () => {
  it("refuses a ticked id_number that isn't a real South African ID number", async () => {
    const supabase = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: { id: "extraction-1", person_id: "person-1", review_status: "pending_review", proposed: {} }, error: null }],
    ]);
    supabaseState.current = supabase;

    const { applyMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(
      applyMyCvExtraction(formDataWith({ extraction_id: "extraction-1", use_id_number: "on", f_id_number: "abc123def0123" })),
    );

    expect(url).toContain("/my-cv?error=");
    expect(url).toContain(encodeURIComponent("valid 13-digit South African ID number"));
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("still saves normally when the ticked id_number is genuinely valid", async () => {
    const supabase = makeSupabase(
      [
        ...requireOwnPersonOk(),
        [{ data: { id: "extraction-1", person_id: "person-1", review_status: "pending_review", proposed: {} }, error: null }],
        [{ data: [], error: null }], // queueStandardCvs' own "already queued?" check - nothing pending
      ],
      [{ data: null, error: null }],
    );
    supabaseState.current = supabase;

    const { applyMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(
      applyMyCvExtraction(formDataWith({ extraction_id: "extraction-1", use_id_number: "on", f_id_number: "8601205135087" })),
    );

    expect(url).toBe("/my-cv?saved=extracted");
    const params = supabase.rpcCalls[0].params as { p_person_fields: Record<string, string> };
    expect(params.p_person_fields).toEqual({ id_number: "8601205135087" });
  });
});

// Finding 432: "select"-kind fields (ecsa_level/highest_level) must be one
// of lib/cvExtraction.ts's own fixed option lists - SANRAL's real Form
// B2.1 dropdown labels - the same check applyCvExtraction() already runs;
// this function had none at all, and this page's own review card rendered
// every field (select ones included) as a plain free-text input, so
// nothing anywhere stopped an arbitrary string from reaching
// people.ecsa_level, which engine/fill_conventional.py refuses outright
// when it isn't one of those exact labels.
describe("applyMyCvExtraction - a 'select'-kind field must be one of SANRAL's own options (Finding 432)", () => {
  it("refuses an ecsa_level that isn't one of ECSA_LEVELS", async () => {
    const supabase = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: { id: "extraction-1", person_id: "person-1", review_status: "pending_review", proposed: {} }, error: null }],
    ]);
    supabaseState.current = supabase;

    const { applyMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(
      applyMyCvExtraction(formDataWith({ extraction_id: "extraction-1", use_ecsa_level: "on", f_ecsa_level: "Pr Eng" })),
    );

    expect(url).toContain("/my-cv?error=");
    expect(url).toContain(encodeURIComponent("choose one of SANRAL's options"));
    expect(supabase.rpcCalls).toHaveLength(0);
  });
});

describe("applyMyCvExtraction - queueStandardCvs' own pending-check read fails", () => {
  it("reports failure instead of silently dropping the CV queue request", async () => {
    supabaseState.current = makeSupabase(
      [
        ...requireOwnPersonOk(),
        [{ data: { id: "extraction-1", person_id: "person-1", review_status: "pending_review", proposed: {} }, error: null }],
        [{ data: null, error: { message: "read failed" } }], // queueStandardCvs' own pending check - errors
      ],
      [{ data: null, error: null }],
    );

    const { applyMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(applyMyCvExtraction(formDataWith(EXTRACTION_FORM)));

    expect(url).not.toContain("saved=extracted");
    expect(url).toContain("/my-cv?error=");
    expect(url).toContain(encodeURIComponent("could not be queued"));
  });
});

describe("discardMyCvExtraction - matches zero rows (revoked mid-request, or already moved on)", () => {
  it("does not redirect as if the discard happened", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: null, error: null }], // update().select("id").maybeSingle() - zero-row match
    ]);

    const { discardMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(discardMyCvExtraction(formDataWith({ extraction_id: "extraction-1" })));

    expect(url).toContain("/my-cv?error=");
  });
});

describe("discardMyCvExtraction - real update still succeeds", () => {
  it("redirects back to /my-cv with no error when the discard genuinely matches", async () => {
    supabaseState.current = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: { id: "extraction-1" }, error: null }],
    ]);

    const { discardMyCvExtraction } = await import("./actions");
    const url = await expectRedirect(discardMyCvExtraction(formDataWith({ extraction_id: "extraction-1" })));

    expect(url).toBe("/my-cv");
  });
});

// Finding 422: uploadMyCv()'s own header comment says it follows "the same
// upload flow as app/app/people/actions.ts uploadCv" - including, until
// now, that function's own gap. The file is uploaded to cv-documents
// FIRST, then the cv_uploads row that records it is inserted; before this
// fix, an insert failure there left the already-uploaded file orphaned in
// Storage forever, instead of being cleaned up the way every other upload
// action in this app already does.
describe("uploadMyCv - cv_uploads insert fails after the file already uploaded (Finding 422)", () => {
  it("removes the orphaned file from storage instead of leaving it there forever", async () => {
    const supabase = makeSupabase([
      ...requireOwnPersonOk(),
      [{ data: null, error: { message: "insert failed" } }], // cv_uploads insert
    ]);
    supabaseState.current = supabase;

    const { uploadMyCv } = await import("./actions");

    const fd = new FormData();
    fd.set("mode", "as_is");
    fd.set("file", new File(["cv-bytes"], "cv.pdf", { type: "application/pdf" }));

    const url = await expectRedirect(uploadMyCv(fd));

    expect(url).toContain("/my-cv?error=");
    expect(supabase.uploadCalls).toHaveLength(1);
    expect(supabase.uploadCalls[0].bucket).toBe("cv-documents");
    expect(supabase.removeCalls).toHaveLength(1);
    expect(supabase.removeCalls[0]).toEqual({ bucket: "cv-documents", paths: [supabase.uploadCalls[0].path] });
  });
});
