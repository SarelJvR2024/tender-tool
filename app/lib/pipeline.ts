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

// The two stages that must never be reached except through an outcome
// capture (recordOutcomeAndMoveStage) - whatever stage a tender is coming
// from. Used below to derive, rather than hand-list a second time, every
// stage OutcomeForm (pipeline/outcome-form.tsx) has to render on - see that
// constant's own comment for the bug this fixed (2026-11-06): briefing_
// shortlisted was added to NEXT_STAGES.submitted as an alternative path to
// won/lost (0105), but OutcomeForm's own stage gate and the plain-button
// bar's "hide forward buttons" check were both still hand-listing only
// 'submitted', so a tender sitting at briefing_shortlisted got plain Won/
// Lost buttons with no outcome form at all, AND 'submitted' itself had no
// way to reach briefing_shortlisted in the first place (the whole forward-
// button bar was hidden for it). Both symptoms were one root cause: two
// stage lists that had to be kept in sync by hand and weren't.
export const OUTCOME_STAGES: readonly PipelineStage[] = ["won", "lost"];

/**
 * Every stage OutcomeForm must render on: won/lost themselves (to add or
 * correct the outcome later) plus every stage NEXT_STAGES can move straight
 * to won/lost FROM (so that move can never skip the outcome capture,
 * whichever of the two real paths - straight from submitted, or via
 * briefing_shortlisted first - a tender actually took). Computed from
 * NEXT_STAGES itself rather than listed separately, so a future stage added
 * to NEXT_STAGES's own won/lost targets can't silently reopen this gap again.
 */
export const OUTCOME_FORM_STAGES: readonly PipelineStage[] = PIPELINE_STAGES.filter(
  (s) => OUTCOME_STAGES.includes(s) || NEXT_STAGES[s].some((next) => OUTCOME_STAGES.includes(next))
);

/**
 * Groups /pipeline's cards into one array per column (PIPELINE_STAGES
 * order), then sorts each column: "open work" (found/assessing/building)
 * keeps the order it's given (the caller's own closing-date-ascending
 * query - "sorts by what closes next"); every stage `OUTCOME_FORM_STAGES`
 * covers (submitted/briefing_shortlisted/won/lost - sitting at or reached
 * only through an outcome) sorts most-recent stage-change first ("outcomes
 * by most recent first"), per this function's own prior inline comment.
 *
 * Pulled out of pipeline/page.tsx (standing review, 2026-11-11) after a
 * real bug: that inline version hand-listed the recency-sorted stages as
 * `["submitted", "won", "lost"]` - written in the SAME commit
 * (`ff98f25`) that added the `briefing_shortlisted` column, which was
 * simply never added to this list. `briefing_shortlisted` cards (shown with
 * their own `stageChangedAt` date on the card face, exactly like
 * `submitted`'s) silently kept whatever order the original closing-date
 * query left them in - the only column on the whole board whose own
 * displayed date and visual order disagreed. Reusing `OUTCOME_FORM_STAGES`
 * here (rather than hand-listing a 4th copy of the same stage set) is the
 * exact fix pattern that constant's own header comment already explains:
 * "two hand-kept stage lists had to stay in sync and didn't" - this was a
 * third such list, found independently of the first two.
 */
export function groupCardsByStage<T extends { stage: PipelineStage; stageChangedAt: string | null }>(
  cards: readonly T[],
): Record<PipelineStage, T[]> {
  const byStage = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, [] as T[]])) as Record<PipelineStage, T[]>;
  for (const c of cards) byStage[c.stage].push(c);
  for (const s of OUTCOME_FORM_STAGES) {
    byStage[s] = [...byStage[s]].sort((a, b) => (b.stageChangedAt ?? "").localeCompare(a.stageChangedAt ?? ""));
  }
  return byStage;
}

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
  // Logging only, no behavioral branch changed - this function's own
  // docstring already calls it best-effort, but the failure was previously
  // invisible even to this function's own console (TS-sweep grep blind
  // spot: a bare `await supabase....update(...)` with no destructuring at
  // all, not even `error` - standing review, 2026-11-06).
  const { error } = await supabase
    .from("tender_packs")
    .update({ pipeline_stage: "assessing" })
    .eq("id", tenderPackId)
    .eq("pipeline_stage", "found");
  if (error) console.error("tender_packs advanceFoundToAssessing failed", error);
}
