import type { SupabaseClient } from "@supabase/supabase-js";

// Tender pipeline stages (feature list item 10, migration 0021's
// tender_packs.pipeline_stage). Exactly the five the spec names - no extras.

export const PIPELINE_STAGES = ["found", "bidding", "submitted", "won", "lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && (PIPELINE_STAGES as readonly string[]).includes(value);
}

export const STAGE_META: Record<PipelineStage, { label: string; bg: string; color: string; hint: string }> = {
  found: { label: "Found", bg: "#F0EEE6", color: "#6B6758", hint: "On our radar, not yet decided" },
  bidding: { label: "Bidding", bg: "#FEF3C7", color: "#B45309", hint: "Preparing the submission" },
  submitted: { label: "Submitted", bg: "#E8EBF1", color: "#16233B", hint: "Handed in, awaiting outcome" },
  won: { label: "Won", bg: "#DCFCE7", color: "#15803D", hint: "Awarded to us" },
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
 * pack_generation_jobs or general tender_engine_jobs 'generate_pack') means
 * the company is bidding, so a tender still at 'found' moves to 'bidding'.
 * Never moves a tender backwards and never past bidding - "pack ready" is not
 * "handed in to the buyer", so submitted/won/lost stay manual on /pipeline.
 * Best-effort: a failure here must not block the pack request itself.
 */
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
