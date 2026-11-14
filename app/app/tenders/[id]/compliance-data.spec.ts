import { afterEach, describe, expect, it, vi } from "vitest";

// Finding 477: loadTenderCompliance()'s own positionRows computation read
// `suggested_person_id` straight from the DB row, but that column is only
// ever written by pack-inputs-actions.ts's confirmPositionPerson() - as a
// side effect of a human clicking confirm/clear for THAT position.
// sync_position_suggestions() (engine/pack/process_pack_jobs.py) only ever
// writes candidate_scores/scored_at, never suggested_person_id. So a
// position nobody has ever confirmed or cleared keeps suggested_person_id
// null forever, even once candidate_scores holds a real, current ranking -
// unlike page.tsx's own Key Positions card, which always recomputes the
// suggestion fresh from candidate_scores via suggestForPosition() rather
// than trusting that column. compliance-report.tsx (and submission-pack.tsx,
// which shares this same loader) showed "No key person confirmed" for a
// position that page.tsx, on the very same tender, already named a real
// suggested candidate for.
//
// First dedicated test file for compliance-data.ts (none existed before -
// confirmed by directory listing). Mocking technique copied from the
// established convention for this exact shape of RSC data loader
// (submission-plan-data.spec.ts): a table-keyed chainable stub that
// actually applies each `.eq()`/`.in()` filter against the table's own
// seeded row set, plus a `.rpc()` stub for findMatchingExperience()'s
// experience_matches call. Calls the real, unmodified loadTenderCompliance(),
// never a reimplementation of its logic.

type Row = Record<string, unknown>;

function makeChain(rows: Row[]) {
  let filtered = rows;
  let single = false;
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val);
      return chain;
    },
    in: (col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => vals.includes(r[col]));
      return chain;
    },
    order: () => chain,
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
    from: (table: string) => makeChain(tables[table] ?? []),
    rpc: async () => ({ data: [], error: null }),
  };
}

const supabaseState: { current: ReturnType<typeof makeSupabase> | null } = { current: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseState.current,
}));

afterEach(() => {
  vi.resetModules();
  supabaseState.current = null;
});

const CANDIDATE_SCORES = [
  { person_id: "person-top", name: "Top Suggestion", score: 10, years_experience: 5, ecsa_level: null, matched: ["pavement"], missing: [], specialism_warning: false, rationale: "top" },
  { person_id: "person-second", name: "Second Ranked", score: 4, years_experience: 2, ecsa_level: null, matched: [], missing: ["pavement"], specialism_warning: true, rationale: "second" },
];

function seedTables(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    tenders: [{ id: "tender-1", closing_date: "2027-01-15T09:00:00Z", family: "Conventional Consultant Tender", evaluation_rules: null }],
    companies: [{ id: "company-1" }],
    tender_packs: [{ id: "pack-1", tender_id: "tender-1" }],
    tender_requirements: [{ tender_id: "tender-1", position_code: "DS1", position_description: "Design Engineer - Pavements", managerial: false, is_alternate: false }],
    financial_captures: [],
    tender_tasks: [],
    tender_roles: [],
    person_role_eligibility: [], // nobody tagged - suggestForPosition ranks across everyone on file
    company_offices: [],
    company_document_templates: [],
    field_provenance: [],
    tender_pack_assignments: [
      {
        tender_pack_id: "pack-1",
        position_code: "DS1",
        confirmed_person_id: null,
        suggested_person_id: null, // never written - the bug this finding is about
        specialism_warning: false,
        candidate_scores: CANDIDATE_SCORES,
      },
    ],
    people: [
      { id: "person-top", name: "Top Suggestion" },
      { id: "person-second", name: "Second Ranked" },
    ],
    projects: [],
    cv_uploads: [],
    generated_cvs: [],
    held_registrations: [],
    discipline_categories: [],
    ...overrides,
  };
}

describe("loadTenderCompliance - suggested candidate (Finding 477)", () => {
  it("names a real, ranked candidate_scores suggestion even when suggested_person_id was never written", async () => {
    supabaseState.current = makeSupabase(seedTables());

    const { loadTenderCompliance } = await import("./compliance-data");
    const result = await loadTenderCompliance("tender-1");

    expect(result?.mapped).toBe(true);
    if (!result || !result.mapped) throw new Error("expected a mapped SANRAL result");
    const row = result.positionRows.find((p) => p.code === "DS1");
    expect(row).toBeDefined();
    expect(row!.person).toBeNull(); // nobody confirmed
    // The bug: pre-fix this read the raw (never-written) suggested_person_id
    // column and was always null here, so compliance-report.tsx fell back
    // to "No key person confirmed" with no name at all.
    expect(row!.suggested).not.toBeNull();
    expect(row!.suggested!.name).toBe("Top Suggestion");
  });

  it("still shows nothing suggested once a position genuinely has no candidate_scores on file", async () => {
    supabaseState.current = makeSupabase(
      seedTables({
        tender_pack_assignments: [
          { tender_pack_id: "pack-1", position_code: "DS1", confirmed_person_id: null, suggested_person_id: null, specialism_warning: false, candidate_scores: null },
        ],
      }),
    );

    const { loadTenderCompliance } = await import("./compliance-data");
    const result = await loadTenderCompliance("tender-1");

    if (!result || !result.mapped) throw new Error("expected a mapped SANRAL result");
    const row = result.positionRows.find((p) => p.code === "DS1");
    expect(row!.suggested).toBeNull();
  });

  it("shows no suggestion once a person is confirmed - confirmed always wins over suggested", async () => {
    supabaseState.current = makeSupabase(
      seedTables({
        tender_pack_assignments: [
          {
            tender_pack_id: "pack-1",
            position_code: "DS1",
            confirmed_person_id: "person-second",
            suggested_person_id: null,
            specialism_warning: true,
            candidate_scores: CANDIDATE_SCORES,
          },
        ],
      }),
    );

    const { loadTenderCompliance } = await import("./compliance-data");
    const result = await loadTenderCompliance("tender-1");

    if (!result || !result.mapped) throw new Error("expected a mapped SANRAL result");
    const row = result.positionRows.find((p) => p.code === "DS1");
    expect(row!.person?.id).toBe("person-second");
    expect(row!.suggested).toBeNull();
  });
});
