import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequirementManifest } from "@/lib/generalTender";

// Finding 355 (standing review, 2026-11-10): loadSubmissionPlan()'s own
// "Key-personnel roles" block read `generated_cvs` with no `tender_id`
// filter at all (`.in("person_id", taggedIds).eq("status", "ready")`), so a
// person whose ONLY ready, tender-SPECIFIC CV belongs to a completely
// different tender was still counted as "has a CV" here - the identical
// generated_cvs tender-scoping gap Finding 342/PR #221 is fixing on the
// engine side (process_general_jobs.py's own gather_pack_inputs()) and
// standing item 29 already flags as unfixed on general-pack-review-data.ts
// (left there deliberately, for colliding with PR #211's own edits to those
// exact lines - this file is untouched by both PR #211 and PR #221).
//
// First dedicated test file for submission-plan-data.ts (none existed
// before this - confirmed by directory listing, same gap Finding 308's own
// write-up already noted for every *-data.ts server loader in this screen
// family). Mocking technique copied from the established convention
// (app/app/tenders/[id]/general-actions.spec.ts and siblings), but the
// chainable stub here actually APPLIES each `.eq()`/`.in()` filter to the
// table's own seeded row set (rather than just replaying a fixed response
// regardless of filters) - deliberately, so this test is a real
// discriminator of the bug (a query missing a filter actually returns a
// row it shouldn't), not just a check that a particular method was called.
// Calls the real, unmodified `loadSubmissionPlan()`, never a reimplementation.

type Row = Record<string, unknown>;

function makeChain(rows: Row[], single: boolean) {
  let filtered = rows;
  const chain: Record<string, unknown> = {
    eq: (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val);
      return chain;
    },
    in: (col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => vals.includes(r[col]));
      return chain;
    },
    order: () => chain,
    select: () => chain,
    maybeSingle: () => {
      single = true;
      return chain;
    },
  };
  (chain as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => {
    resolve({ data: single ? (filtered[0] ?? null) : filtered, error: null });
  };
  return chain;
}

function makeSupabase(tables: Record<string, Row[]>) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => makeChain(tables[table] ?? [], false),
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => (globalThis as unknown as { __supabase: unknown }).__supabase }));

afterEach(() => {
  vi.resetModules();
});

const MANIFEST: RequirementManifest = {
  version: 1,
  extracted_at: "2026-01-01T00:00:00Z",
  form_suite: "SBD",
  documents: [],
  forms: [],
  buyer_forms: [],
  returnables: [],
  roles: [{ role_code: "site_agent", mentions: 1, document: "notice.pdf", quote: "a site agent" }],
  cidb: null,
  briefing: null,
  scoring: { preference_system: { system: "" }, functionality: {}, specific_goal_bases: [] },
  experience_evidence: { source: "", rules: [] },
  locality: { rows: [], mandatory_local_office: null },
  questions: [],
  company_fields: [],
  gaps: [],
};

async function runLoadSubmissionPlan(tenderId: string, generatedCvRows: Row[]) {
  const supabase = makeSupabase({
    tenders: [{ id: tenderId, document_requirements: MANIFEST, closing_date: null, briefing_date: null }],
    tender_packs: [{ id: "pack-1", tender_id: tenderId, company_id: "company-1", document_requirements: null }],
    companies: [{}],
    tender_answers: [],
    people: [{ id: "person-1", name: "Jane Site Agent", signatory_capacity: null }],
    tender_roles: [{ code: "site_agent", title: "Site Agent" }],
    person_role_eligibility: [{ person_id: "person-1", role_code: "site_agent" }],
    generated_cvs: generatedCvRows,
    cv_uploads: [],
  });
  (globalThis as unknown as { __supabase: unknown }).__supabase = supabase;
  vi.resetModules();
  const { loadSubmissionPlan } = await import("./submission-plan-data");
  return loadSubmissionPlan(tenderId);
}

describe("loadSubmissionPlan - Key-personnel roles CV check (Finding 355)", () => {
  it("does NOT count a ready CV generated for a DIFFERENT tender as 'has a CV' for this one", async () => {
    // The person's only ready, usable CV is tender-specific to "tender-OTHER",
    // not "tender-THIS" - generated_cvs.tender_id is never null for a
    // role-tagged row (0008's own check constraint), so this is the real
    // shape a stale/cross-tender row takes.
    const snapshot = await runLoadSubmissionPlan("tender-THIS", [
      { person_id: "person-1", status: "ready", storage_path_pdf: "cvs/person-1-OTHER.pdf", tender_id: "tender-OTHER" },
    ]);
    const roleStep = snapshot.steps.find((s) => s.id === "role:site_agent");
    expect(roleStep).toBeDefined();
    // roleStatus()'s own reviewStatus stays "confirmed" either way (a tagged
    // role is never itself a Fix/Provide item) - the real, observable
    // difference this bug caused is the note text: with the bug, a
    // cross-tender CV wrongly counts as "everyone has a CV", which
    // (roleStatus()'s own null-note branch) silently drops the warning
    // text entirely; fixed, it must say so explicitly.
    expect(roleStep!.note).toBe("Tagged, but no CV uploaded or generated yet for anyone in this role.");
  });

  it("DOES count a ready, usable CV generated for THIS tender (no false warning)", async () => {
    const snapshot = await runLoadSubmissionPlan("tender-THIS", [
      { person_id: "person-1", status: "ready", storage_path_pdf: "cvs/person-1-THIS.pdf", tender_id: "tender-THIS" },
    ]);
    const roleStep = snapshot.steps.find((s) => s.id === "role:site_agent");
    expect(roleStep).toBeDefined();
    expect(roleStep!.note).not.toBe("Tagged, but no CV uploaded or generated yet for anyone in this role.");
  });
});
