import type { SupabaseClient } from "@supabase/supabase-js";

// Tender pipeline stages (feature list item 10, migration 0021's
// tender_packs.pipeline_stage; widened by migration 0105, task #48 -
// see that file's own header for the dry-run/backfill this was built from).

// 7 real stages (app/AGENTS.md "Bids pipeline redesign" - the two it flagged
// as genuinely missing, now built): 'bidding' split into 'assessing' and
// 'building', plus 'briefing_shortlisted' between 'submitted' and an
// outcome. This is the board's own column order too (/pipeline maps this
// array straight to columns) - 'bidding' is deliberately NOT one of them,
// see LEGACY_BIDDING_STAGE below for why it still exists as a value.
export const PIPELINE_STAGES = [
  "found", "assessing", "building", "submitted",
  "briefing_shortlisted", "won", "lost",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Transitional-only value, kept out of PIPELINE_STAGES on purpose. Migration
// 0105 widens tender_packs.pipeline_stage's check constraint from 5 values
// to these 7 AND backfills every existing 'bidding' row away in the same
// transaction - but it has to be run by hand in Supabase's SQL Editor (no
// DDL path exists from a Claude Code session; see 0105's own header), so
// there's a real window, of unknown length, where a live row can still be
// 'bidding' under the OLD 5-value constraint while this app code (which
// ships independently, via Vercel) already expects the new 7. Every place
// that reads a RAW stored pipeline_stage value - not a value already read
// through a Card/UI layer - has to keep treating 'bidding' as the same
// "still actively working on it" bucket 'assessing'/'building' are, or that
// one row (and its company) would silently vanish from dashboards, deadline/
// corrigendum alerts and the 0048/0106 SQL RPC the moment this code deploys,
// hours or days before Sarel actually runs 0105. Once 0105 has run, no row
// can ever be 'bidding' again (the new constraint forbids it) - at that
// point every reference to this constant below is simply unreachable, dead
// code, not a latent bug. Safe to delete in a follow-up once 0105's run is
// confirmed.
export const LEGACY_BIDDING_STAGE = "bidding" as const;

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && (PIPELINE_STAGES as readonly string[]).includes(value);
}

/**
 * Normalizes a raw, possibly-not-yet-backfilled tender_packs.pipeline_stage
 * read (including the legacy 'bidding', pre-0105) to a real PipelineStage
 * for display. Every place that turns a raw DB read into a value it will
 * index STAGE_META/NEXT_STAGES/PREVIOUS_STAGE with MUST go through this
 * first - none of those 3 Records has a 'bidding' entry (see
 * LEGACY_BIDDING_STAGE's own comment above), so skipping this on a still-
 * legacy row throws, not just mis-labels. The 'assessing' default (rather
 * than 'building') is deliberately the more conservative of the two - the
 * live migration differentiates per row using real signals (confirmed
 * assignments/answers/a financial capture) once it actually runs; this is
 * only the client-side fallback for however long a row hasn't been
 * backfilled yet.
 */
export function normalizeStage(stage: string): PipelineStage {
  if (isPipelineStage(stage)) return stage;
  if (stage === LEGACY_BIDDING_STAGE) return "assessing";
  return "found"; // unreachable for any real stored value; a safe default, never thrown from here
}

// "Still actively being pursued, not yet submitted" - the one shared
// allow-list every dashboard/alert/"active bids" stat reads, so they can't
// drift from each other (see the comment that already existed here before
// 0105 - same reasoning, now covering 3 real stages instead of 1, plus the
// transitional legacy value above since this is read against RAW stored
// values in dashboardStats.ts/dashboard/page.tsx, not through a normalized
// Card).
export const IN_PROGRESS_STAGES = ["found", "assessing", "building", LEGACY_BIDDING_STAGE] as const;

// Labels matching prompt 10 item 4's own 7-column spec (Discovered/
// Assessing/Building/Submitted/Briefing-Shortlisted/Awarded/Lost), now that
// 0105 actually stores all 7 as distinct values (was a presentation-only
// relabel over 5 stored values before 0105 - see app/AGENTS.md "Bids
// pipeline redesign" for that earlier state and why the 2 extra columns
// needed a migration rather than being invented in-memory). "Won" stays
// relabeled "Awarded" (a genuine 1:1 rename, not a new state, same as
// "found"'s own "Evaluating (Go/No-Go)" relabel below).
//
// Design-system audit fix (2026-10-21): `chipClass` replaces this map's old
// literal `bg`/`color` hex pairs (stale from before the design-system
// migration) with the design tokens' own soft-tint pattern, mapped by
// semantic intent rather than a 1:1 hex swap: found (not yet decided) is
// neutral/muted, same as StatusBadge's "draft"; assessing/building (active
// work still to do - one 'bidding' tone before 0105 split it in two) is
// warning; submitted/briefing_shortlisted match StatusBadge's own
// "submitted" variant exactly (border-accent/30 bg-accent/10 text-accent);
// won/lost are success/destructive. This is a STAGE MACHINE, not a Verify/
// Provide/Fix task classifier (see app/AGENTS.md "Bids pipeline" for why
// V/P/F doesn't apply here) - same judgment call as Home's own StatusBadge
// vocabulary.
export const STAGE_META: Record<PipelineStage, { label: string; chipClass: string; hint: string }> = {
  // "Evaluating (Go/No-Go)" (Sarel, 2026-10-29) - a 1:1 relabel, same as
  // "Awarded" below; the stored value stays 'found' (migration 0021's own
  // check constraint), same reasoning as every other rename in this map.
  found: { label: "Evaluating (Go/No-Go)", chipClass: "border-muted-foreground/20 bg-muted text-muted-foreground", hint: "On our radar, not yet decided" },
  assessing: { label: "Assessing", chipClass: "border-warning/20 bg-warning/10 text-warning", hint: "Deciding whether to bid" },
  building: { label: "Building", chipClass: "border-warning/20 bg-warning/10 text-warning", hint: "Preparing the submission" },
  submitted: { label: "Submitted", chipClass: "border-accent/30 bg-accent/10 text-accent", hint: "Handed in, awaiting outcome" },
  briefing_shortlisted: { label: "Briefing / shortlisted", chipClass: "border-accent/30 bg-accent/10 text-accent", hint: "Buyer has briefed or shortlisted us, still awaiting a final outcome" },
  won: { label: "Awarded", chipClass: "border-success/30 bg-success/15 text-success", hint: "Awarded to us" },
  lost: { label: "Lost", chipClass: "border-destructive/20 bg-destructive/10 text-destructive", hint: "Not awarded to us" },
};

// The forward step(s) offered on each card. Submitted can go straight to an
// outcome, or through a briefing/shortlist step first - both are real,
// buyer-dependent paths, so submitted offers all three rather than forcing
// briefing_shortlisted on every tender.
export const NEXT_STAGES: Record<PipelineStage, PipelineStage[]> = {
  found: ["assessing"],
  assessing: ["building"],
  building: ["submitted"],
  submitted: ["briefing_shortlisted", "won", "lost"],
  briefing_shortlisted: ["won", "lost"],
  won: [],
  lost: [],
};

// One step back, for correcting a mis-click. won/lost/briefing_shortlisted
// can each be reached two ways now (straight from submitted, or via
// briefing_shortlisted) - "back" always lands on the more common direct
// path (submitted), a documented judgment call, not a tracked "where this
// row actually came from" history.
export const PREVIOUS_STAGE: Record<PipelineStage, PipelineStage | null> = {
  found: null,
  assessing: "found",
  building: "assessing",
  submitted: "building",
  briefing_shortlisted: "submitted",
  won: "submitted",
  lost: "submitted",
};

/** The 4 outcome fields (prompt 10, item 4), namespaced in tender_answers - see recordOutcomeAndMoveStage (pipeline/actions.ts) for why this table and not a new one. Lives here, not actions.ts, because a "use server" file can only export async functions. */
export const OUTCOME_FIELD_KEYS = {
  winningCompany: "outcome:winning_company",
  winningPriceZar: "outcome:winning_price_zar",
  biddersCount: "outcome:bidders_count",
  reasonLost: "outcome:reason_lost",
} as const;

/**
 * The one automatic stage change: requesting a submission pack (SANRAL
 * pack_generation_jobs, engine 'sanral' or 'general', kind 'generate_pack')
 * means the company is starting to assess/prepare the tender, so a tender
 * still at 'found' moves to 'assessing' (0105 - was 'bidding' before the
 * stage split). Never moves a tender backwards and never past assessing -
 * "pack ready" is not "handed in to the buyer", so building/submitted/
 * briefing_shortlisted/won/lost stay manual on /pipeline. Best-effort: a
 * failure here must not block the pack request itself.
 */
export async function advanceFoundToAssessing(
  supabase: SupabaseClient,
  tenderPackId: string
) {
  await supabase
    .from("tender_packs")
    .update({ pipeline_stage: "assessing" })
    .eq("id", tenderPackId)
    .eq("pipeline_stage", "found");
}
