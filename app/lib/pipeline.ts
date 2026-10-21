import type { SupabaseClient } from "@supabase/supabase-js";

// Tender pipeline stages (feature list item 10, migration 0021's
// tender_packs.pipeline_stage). Exactly the five the spec names - no extras.

export const PIPELINE_STAGES = ["found", "bidding", "submitted", "won", "lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && (PIPELINE_STAGES as readonly string[]).includes(value);
}

// Labels renamed toward prompt 10 item 4's own 7-column spec
// (Discovered/Assessing/Building/Submitted/Briefing-Shortlisted/Awarded/Lost)
// as far as that's a presentation-only change - the stored values themselves
// are unchanged (pipeline_stage's own check constraint, migration 0021,
// still only allows these 5). Two of the 7 requested columns genuinely
// can't exist without a migration (there is nowhere today to store
// "Assessing" vs "Building" as different states from "Bidding", or a
// separate "Briefing/Shortlisted" state between Submitted and an outcome) -
// flagged in app/AGENTS.md rather than invented. "Bidding" covers both
// Assessing and Building here, and "Won" is relabeled "Awarded" (a genuine
// 1:1 rename, not a new state).
export const STAGE_META: Record<PipelineStage, { label: string; bg: string; color: string; hint: string }> = {
  found: { label: "Discovered", bg: "#F0EEE6", color: "#6B6758", hint: "On our radar, not yet decided" },
  bidding: { label: "Assessing & building", bg: "#FEF3C7", color: "#B45309", hint: "Assessing fit and preparing the submission" },
  submitted: { label: "Submitted", bg: "#E8EBF1", color: "#16233B", hint: "Handed in, awaiting outcome" },
  won: { label: "Awarded", bg: "#DCFCE7", color: "#15803D", hint: "Awarded to us" },
  lost: { label: "Lost", bg: "#FEE2E2", color: "#B91C1C", hint: "Not awarded to us" },
};

// The forward step(s) offered on each card. Submitted forks into won/lost.
export const NEXT_STAGES: Record<PipelineStage, PipelineStage[]> = {
  found: ["bidding"],
  bidding: ["submitted"],
  submitted: ["won", "lost"],
  won: [],
  lost: [],
};

// One step back, for correcting a mis-click.
export const PREVIOUS_STAGE: Record<PipelineStage, PipelineStage | null> = {
  found: null,
  bidding: "found",
  submitted: "bidding",
  won: "submitted",
  lost: "submitted",
};

/**
 * The one automatic stage change: requesting a submission pack (SANRAL
 * pack_generation_jobs, engine 'sanral' or 'general', kind 'generate_pack') means
 * the company is bidding, so a tender still at 'found' moves to 'bidding'.
 * Never moves a tender backwards and never past bidding - "pack ready" is not
 * "handed in to the buyer", so submitted/won/lost stay manual on /pipeline.
 * Best-effort: a failure here must not block the pack request itself.
 */
/** The 4 outcome fields (prompt 10, item 4), namespaced in tender_answers - see recordOutcomeAndMoveStage (pipeline/actions.ts) for why this table and not a new one. Lives here, not actions.ts, because a "use server" file can only export async functions. */
export const OUTCOME_FIELD_KEYS = {
  winningCompany: "outcome:winning_company",
  winningPriceZar: "outcome:winning_price_zar",
  biddersCount: "outcome:bidders_count",
  reasonLost: "outcome:reason_lost",
} as const;

export async function advanceFoundToBidding(
  supabase: SupabaseClient,
  tenderPackId: string
) {
  await supabase
    .from("tender_packs")
    .update({ pipeline_stage: "bidding" })
    .eq("id", tenderPackId)
    .eq("pipeline_stage", "found");
}
