import type { SupabaseClient } from "@supabase/supabase-js";

// Tender pipeline stages (feature list item 10, migration 0021's
// tender_packs.pipeline_stage). Exactly the five the spec names - no extras.

export const PIPELINE_STAGES = ["found", "bidding", "submitted", "won", "lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// "Active bids" everywhere this label is shown (Home's stat card, the Bids
// board's own stat card) means work this company still has to do - found
// (not yet decided) or bidding (assessing/building). A submitted bid is
// handed in and awaiting an outcome, not active work, so it's deliberately
// excluded here and tracked under its own "Submitted this month" stat
// instead. Single source of truth so the two pages can't drift again (found
// drifted once: Home's own stat used to reuse discoveryReassessment.ts's
// broader ACTIVE_PURSUIT_STAGES, which legitimately includes "submitted" for
// a different purpose - a submitted bid can still be flagged if a
// re-assessment downgrades it - and ended up showing a different number
// from the Bids page for the same company whenever anything was submitted).
export const IN_PROGRESS_STAGES = ["found", "bidding"] as const satisfies readonly PipelineStage[];

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
//
// Design-system audit fix (2026-10-21): `chipClass` replaces this map's old
// literal `bg`/`color` hex pairs (stale from before the design-system
// migration) with the design tokens' own soft-tint pattern, mapped by
// semantic intent rather than a 1:1 hex swap: found (not yet decided) is
// neutral/muted, same as StatusBadge's "draft"; bidding (active work still
// to do) is warning; submitted matches StatusBadge's own "submitted"
// variant exactly (border-accent/30 bg-accent/10 text-accent); won/lost are
// success/destructive. This is a STAGE MACHINE, not a Verify/Provide/Fix
// task classifier (see app/AGENTS.md "Bids pipeline" for why V/P/F doesn't
// apply here) - same judgment call as Home's own StatusBadge vocabulary.
export const STAGE_META: Record<PipelineStage, { label: string; chipClass: string; hint: string }> = {
  found: { label: "Discovered", chipClass: "border-muted-foreground/20 bg-muted text-muted-foreground", hint: "On our radar, not yet decided" },
  bidding: { label: "Assessing & building", chipClass: "border-warning/20 bg-warning/10 text-warning", hint: "Assessing fit and preparing the submission" },
  submitted: { label: "Submitted", chipClass: "border-accent/30 bg-accent/10 text-accent", hint: "Handed in, awaiting outcome" },
  won: { label: "Awarded", chipClass: "border-success/30 bg-success/15 text-success", hint: "Awarded to us" },
  lost: { label: "Lost", chipClass: "border-destructive/20 bg-destructive/10 text-destructive", hint: "Not awarded to us" },
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
