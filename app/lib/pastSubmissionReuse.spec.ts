import { describe, expect, it } from "vitest";
import { buildReusePlan } from "./pastSubmissionReuse";
import { GENERAL_FAMILY } from "./generalTender";

/**
 * Found 2026-11-06 (standing solution-architect review, TS-side unprotected-
 * read sweep): buildReusePlan() never checked the TARGET tender's own
 * pipeline_stage before building a plan - only reuse-past-submission.tsx's
 * own widget-hiding check did (stage in submitted/briefing_shortlisted/won/
 * lost -> don't render the form at all), and that's a display-only gate.
 * applyPastSubmission() rebuilds its plan from this same function "from the
 * database, not taken from the preview the browser saw" (this file's own
 * header comment) - so a stale tab left open from before the tender was
 * submitted, or a direct POST with a still-valid source id, could silently
 * overwrite tender_answers / reconfirm key positions on a tender that has
 * already gone in. This file had no test coverage at all before this fix.
 *
 * A minimal Supabase client stub - just enough chaining for this file's own
 * query shapes (.from().select()...eq()/in()/neq()...maybeSingle(), or
 * awaited directly as a list). Every chain method returns the SAME object
 * (`self`), which is itself thenable, matching this repo's existing
 * stubSupabase() convention (see complianceDigestCandidates.spec.ts).
 */
function stubSupabase(opts: {
  target: Record<string, unknown>;
  // The one past tender valid as a *source* (already submitted/won/lost).
  sourceTenderId: string;
  sourcePackRow: Record<string, unknown>; // pipeline_stage + nested tenders row
  // pipeline_stage of the TARGET's own tender_packs row, as it really is in
  // the database right now (what this fix re-checks).
  targetPipelineStage: string | null;
}) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const self: any = {
        select: () => self,
        order: () => self,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return self;
        },
        in: (col: string, vals: unknown) => {
          filters[`in:${col}`] = vals;
          return self;
        },
        neq: (col: string, val: unknown) => {
          filters[`neq:${col}`] = val;
          return self;
        },
        maybeSingle: async () => {
          if (table === "tenders") return { data: opts.target };
          return { data: null };
        },
        then: (resolve: (v: { data: unknown[] }) => void) => {
          if (table === "tender_packs" && "neq:tender_id" in filters) {
            // listPastSubmissions' own query: every DONE_STAGES pack except the target's.
            return resolve({ data: [opts.sourcePackRow] });
          }
          if (table === "tender_packs" && "in:tender_id" in filters) {
            // buildReusePlan's own target+source pack lookup (this fix's own read).
            const rows: Record<string, unknown>[] = [];
            if (opts.targetPipelineStage !== null) {
              rows.push({ id: "pack-target", tender_id: opts.target.id, pipeline_stage: opts.targetPipelineStage });
            }
            rows.push({ id: "pack-source", tender_id: opts.sourceTenderId, pipeline_stage: opts.sourcePackRow.pipeline_stage });
            return resolve({ data: rows });
          }
          if (table === "people") return resolve({ data: [] });
          return resolve({ data: [] });
        },
      };
      return self;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const TARGET = {
  id: "t-target",
  contract_no: "T1",
  title: "Target tender",
  description: null,
  buyer: "Acme Metro",
  family: GENERAL_FAMILY,
  // null manifest keeps buildReusePlan's own general-flow branch to its
  // "documents haven't been read yet" note, with no tender_answers query -
  // the smallest fixture that still exercises the real code path.
  document_requirements: null,
};

const SOURCE_PACK_ROW = {
  tender_id: "t-source",
  pipeline_stage: "submitted",
  submitted_at: "2026-01-01",
  tenders: { id: "t-source", contract_no: "S1", title: "Source tender", description: null, buyer: "Acme Metro", family: GENERAL_FAMILY },
};

describe("buildReusePlan - re-checks the TARGET tender's own stage, not just the chosen source's", () => {
  for (const doneStage of ["submitted", "briefing_shortlisted", "won", "lost"]) {
    it(`refuses to build a plan once the target itself has reached "${doneStage}", even with a valid source`, async () => {
      const supabase = stubSupabase({ target: TARGET, sourceTenderId: "t-source", sourcePackRow: SOURCE_PACK_ROW, targetPipelineStage: doneStage });
      const plan = await buildReusePlan(supabase, "t-target", "t-source");
      expect(plan).toBeNull();
    });
  }

  it("still builds a plan for a target that is genuinely still being prepared", async () => {
    const supabase = stubSupabase({ target: TARGET, sourceTenderId: "t-source", sourcePackRow: SOURCE_PACK_ROW, targetPipelineStage: "bidding" });
    const plan = await buildReusePlan(supabase, "t-target", "t-source");
    expect(plan).not.toBeNull();
    expect(plan?.source.tender_id).toBe("t-source");
  });

  it("still builds a plan when the target has no tender_packs row yet (a brand-new tender)", async () => {
    const supabase = stubSupabase({ target: TARGET, sourceTenderId: "t-source", sourcePackRow: SOURCE_PACK_ROW, targetPipelineStage: null });
    const plan = await buildReusePlan(supabase, "t-target", "t-source");
    expect(plan).not.toBeNull();
  });
});
