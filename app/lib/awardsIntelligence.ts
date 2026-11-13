// Phase 3 of the awards-intelligence work (Claude-Brief-Awards-Intelligence_v2.md
// section 3, Sarel, 2026-11-13) - the analysis engine: pure, deterministic
// functions over a set of "comparable awards" (same buyer + category in the
// last 36 months, or widened per the brief - resolving that comparison set
// is the CALLER's job, e.g. a server component querying public_tender_outcomes
// by buyer_key/categories/award_date; nothing in this file touches a
// database, a network call, or the clock).
//
// Every function here is pure: same input -> same output, no I/O, no
// randomness, no hidden state. That is deliberate, not incidental - it is
// what makes every rule in bidDontBidSignal() auditable (see its own
// docstring: "show every rule that fired, never a probability") and what
// lets matchPursuitsToAwards() be trusted to NEVER change a pipeline stage
// on its own (it returns a suggestion object; nothing writes anything).
//
// Builds on marketPricing.ts (reuses median/quantile/normName/MIN_SAMPLE
// rather than duplicating them) and the Phase 2/3 schema additions
// (migrations 0143/0144): buyer_key, winner_key, is_panel_award,
// pricing_excluded, bidders[].bbbee_level, bidders[].price_rank.

import { median, toNumber } from "@/lib/dealEconomics";
import { MIN_SAMPLE, normName, quantile, type Bidder, type TenderOutcome } from "@/lib/marketPricing";

// ------------------------------------------------------- 1. Competition

export type CompetitionStats = { n: number; median: number | null; low: number | null; high: number | null };

/** Median and range of bidder count, counting only awards that actually
 * published a bidder list (bidder_count > 0) - the brief's own wording.
 * This is deliberately NOT priced_bidder_count: a register that names
 * bidders with no price still shows how many competitors turned up. */
export function competitionStats(awards: readonly Pick<TenderOutcome, "bidder_count">[]): CompetitionStats {
  const counts = awards.map((a) => a.bidder_count).filter((c) => c > 0).sort((a, b) => a - b);
  return { n: counts.length, median: median(counts), low: counts[0] ?? null, high: counts.at(-1) ?? null };
}

// ------------------------------------------------------- 2. Who wins

export type BbbeeBucket = "EME" | "QSE" | "Level 1-2" | "other";

/** The brief's own bucket list stops at "EME / QSE / Level 1-2 / other" -
 * Level 3-8, "Non-compliant" and an unrecognised/unknown level all fold
 * into "other" because the brief draws the line there, not because this
 * file can't tell them apart (classify_bbbee_level() on the Python side
 * already does, per-bidder, if a finer split is ever wanted). */
export function bucketBbbeeLevel(level: string | null | undefined): BbbeeBucket {
  if (level === "EME") return "EME";
  if (level === "QSE") return "QSE";
  if (level === "Level 1" || level === "Level 2") return "Level 1-2";
  return "other";
}

function winnerBidder(award: Pick<TenderOutcome, "bidders">): Bidder | null {
  return award.bidders.find((b) => b.is_winner) ?? null;
}

export type BbbeeSplit = { n: number; EME: number; QSE: number; "Level 1-2": number; other: number };

/** Only single-winner AWARDED tenders count - a panel award or a register
 * with no confirmed winner has no one level to attribute the win to. */
export function winnerBbbeeSplit(
  awards: readonly Pick<TenderOutcome, "bidders" | "winner_count" | "status">[],
): BbbeeSplit {
  const split: BbbeeSplit = { n: 0, EME: 0, QSE: 0, "Level 1-2": 0, other: 0 };
  for (const a of awards) {
    if (a.status !== "awarded" || a.winner_count !== 1) continue;
    split[bucketBbbeeLevel(winnerBidder(a)?.bbbee_level)]++;
    split.n++;
  }
  return split;
}

export type WinnerCount = { key: string; name: string | null; wins: number; totalValueZar: number };

/** Groups single-winner AWARDED tenders by winner_key (the normalised
 * supplier identity, migration 0144) - never by the raw winner_name, which
 * the SAME real company can have typed several different ways across
 * tenders (store_award_outcomes.norm_name()'s own docstring). */
function countWins(
  awards: readonly Pick<TenderOutcome, "status" | "winner_count" | "winner_key" | "winner_name" | "winner_amount_zar">[],
): WinnerCount[] {
  const map = new Map<string, WinnerCount>();
  for (const a of awards) {
    if (a.status !== "awarded" || a.winner_count !== 1 || !a.winner_key) continue;
    const amt = toNumber(a.winner_amount_zar) ?? 0;
    const existing = map.get(a.winner_key);
    if (existing) {
      existing.wins += 1;
      existing.totalValueZar += amt;
    } else {
      map.set(a.winner_key, { key: a.winner_key, name: a.winner_name, wins: 1, totalValueZar: amt });
    }
  }
  return [...map.values()];
}

/** Top N winning suppliers by win count (ties broken by total value),
 * each with its win count AND total value - the brief's own two numbers. */
export function topWinningSuppliers(
  awards: readonly Pick<TenderOutcome, "status" | "winner_count" | "winner_key" | "winner_name" | "winner_amount_zar">[],
  limit = 5,
): WinnerCount[] {
  return countWins(awards).sort((a, b) => b.wins - a.wins || b.totalValueZar - a.totalValueZar).slice(0, limit);
}

// ------------------------------------------------------- 3. Price guide

export type PriceGuide = {
  n: number; median: number | null; p25: number | null; p75: number | null;
  vsLowest: { n: number; lowestDidNotWinPct: number | null; typicalGapPct: number | null };
};

/** median/p25/p75 of "usable" award amounts - single-winner, AWARDED, and
 * NOT pricing_excluded (Phase 2: non-competitive, a panel award, or a
 * nominal R1-or-less placeholder all get excluded here too, the same
 * guard store_award_outcomes.merge() already applies before storing). The
 * second half - winner's price vs the lowest published bid - only counts
 * awards where BOTH a lowest bid and a winner amount are on file. */
export function priceGuide(
  awards: readonly Pick<
    TenderOutcome,
    "status" | "winner_count" | "pricing_excluded" | "winner_amount_zar" | "low_bid_zar" | "lowest_bid_won"
  >[],
): PriceGuide {
  const usable = awards.filter((a) => a.status === "awarded" && a.winner_count === 1 && !a.pricing_excluded);
  const amounts = usable
    .map((a) => toNumber(a.winner_amount_zar))
    .filter((v): v is number => v !== null && v > 0)
    .sort((a, b) => a - b);

  const ranked = usable.filter(
    (a) => a.lowest_bid_won !== null && toNumber(a.low_bid_zar) !== null && toNumber(a.winner_amount_zar) !== null,
  );
  const notLowest = ranked.filter((a) => a.lowest_bid_won === false);
  const gaps = notLowest
    .map((a) => {
      const low = toNumber(a.low_bid_zar) as number;
      const win = toNumber(a.winner_amount_zar) as number;
      return low > 0 ? (win - low) / low : null;
    })
    .filter((g): g is number => g !== null);

  return {
    n: amounts.length,
    median: median(amounts),
    p25: quantile(amounts, 0.25),
    p75: quantile(amounts, 0.75),
    vsLowest: {
      n: ranked.length,
      lowestDidNotWinPct: ranked.length ? Math.round((notLowest.length / ranked.length) * 1000) / 10 : null,
      typicalGapPct: gaps.length ? Math.round(((median(gaps) ?? 0) * 100 + Number.EPSILON) * 10) / 10 : null,
    },
  };
}

// ------------------------------------------------------- 4. Repeat-winner signal

export type DominantIncumbent = {
  isDominant: boolean; winnerKey: string | null; winnerName: string | null; sharePct: number | null; n: number;
};

/** "Dominant incumbent" per the brief: a single supplier won more than 40%
 * of comparable awards. `n` is the count of single-winner AWARDED tenders
 * actually considered (the denominator the share is computed against), so
 * a caller can tell a real 40%+ share apart from a tiny, meaningless one. */
export function dominantIncumbent(
  awards: readonly Pick<TenderOutcome, "status" | "winner_count" | "winner_key" | "winner_name" | "winner_amount_zar">[],
): DominantIncumbent {
  const counts = countWins(awards);
  const n = counts.reduce((sum, c) => sum + c.wins, 0);
  if (!n || !counts.length) return { isDominant: false, winnerKey: null, winnerName: null, sharePct: null, n };
  const top = [...counts].sort((a, b) => b.wins - a.wins)[0];
  const sharePct = Math.round((top.wins / n) * 1000) / 10;
  return { isDominant: sharePct > 40, winnerKey: top.key, winnerName: top.name, sharePct, n };
}

// ------------------------------------------------------- 5. Bid / don't-bid signal

export type BidSignal = { signal: "Green" | "Amber" | "Grey"; rulesFired: string[]; n: number };

/** Green / Amber / Grey from transparent rules only - the brief's own
 * wording, repeated here so it can't drift: "Show every rule that fired.
 * Never output a win probability." This function returns no numeric
 * probability anywhere in its type; `rulesFired` always lists what was
 * actually checked, even when nothing triggered Amber (so "Green because
 * nothing fired" is never silently indistinguishable from "Green and here
 * is why").
 *
 * `userBbbeeLevel` is the company's OWN level in the same vocabulary
 * classify_bbbee_level() produces (EME | QSE | "Level 1".."Level 8" |
 * "Non-compliant") - pass null when the company hasn't recorded one; the
 * two B-BBEE-dependent rules then simply never fire (never guessed at).
 *
 * Rule order matches the brief exactly: Amber's three conditions are
 * checked first (median bidders >= 15, dominant incumbent, the user's own
 * level never won here); if none fire, Green is checked (median bidders
 * <= 6 AND the user's level has won here); otherwise Grey. */
export function bidDontBidSignal(args: {
  awards: readonly Pick<
    TenderOutcome,
    "status" | "winner_count" | "winner_key" | "winner_name" | "winner_amount_zar" | "bidders" | "bidder_count"
  >[];
  userBbbeeLevel: string | null;
}): BidSignal {
  const { awards, userBbbeeLevel } = args;
  const n = awards.length;
  if (n < MIN_SAMPLE) {
    return { signal: "Grey", rulesFired: [`Not enough comparable awards (n=${n}; need at least ${MIN_SAMPLE})`], n };
  }

  const competition = competitionStats(awards);
  const incumbent = dominantIncumbent(awards);
  const userLevelWon =
    userBbbeeLevel != null &&
    awards.some((a) => a.status === "awarded" && a.winner_count === 1 && winnerBidder(a)?.bbbee_level === userBbbeeLevel);

  const rulesFired: string[] = [];
  let amber = false;
  if (competition.median !== null && competition.median >= 15) {
    rulesFired.push(`High competition: a median of ${competition.median} bidders per comparable award`);
    amber = true;
  }
  if (incumbent.isDominant) {
    rulesFired.push(
      `Dominant incumbent: ${incumbent.winnerName ?? "one supplier"} won ${incumbent.sharePct}% of comparable awards`,
    );
    amber = true;
  }
  if (userBbbeeLevel != null && !userLevelWon) {
    rulesFired.push(`No comparable award was won by a supplier at your B-BBEE level (${userBbbeeLevel})`);
    amber = true;
  }
  if (amber) return { signal: "Amber", rulesFired, n };

  if (competition.median !== null && competition.median <= 6 && userLevelWon) {
    rulesFired.push(
      `Low competition (median ${competition.median} bidders) and a supplier at your B-BBEE level (${userBbbeeLevel}) has won here before`,
    );
    return { signal: "Green", rulesFired, n };
  }

  return { signal: "Grey", rulesFired: ["No Amber condition fired, but not enough signal to call it Green either"], n };
}

// ------------------------------------------------------- 6. Win/loss suggestion

export type Pursuit = {
  id: string;
  /** Whatever single identifier the CALLER has already resolved for this
   * pursuit's tender - an OCDS id, a SANRAL contract/NRA reference, or a
   * bid number - matched against TenderOutcome.reference. Resolving which
   * real column that should be (tenders.ocid / contract_no / nra_reference)
   * is the caller's job (e.g. the existing SQL function
   * tender_market_outcomes(), 0053) - this function only compares strings. */
  reference: string | null;
  buyer: string | null;
  title: string | null;
  /** The company's own legal/trading names, as already used elsewhere in
   * this codebase (marketPricing.ownPosition()) to recognise itself on a
   * published register. */
  companyNames: readonly (string | null | undefined)[];
};

export type PursuitMatch = {
  pursuitId: string;
  matchedOutcomeKey: string | null;
  matchedOn: "reference" | "title_similarity" | null;
  /** A SUGGESTION for the user to confirm - this function never writes
   * anything and never changes a pipeline stage; see this module's own
   * header comment. */
  suggestion: "Won" | "Lost" | "Unmatched";
  lostTo: string | null;
};

function normalizeReference(ref: string): string {
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A transparent, deterministic token-overlap (Jaccard) score on titles -
 * no fuzzy library, no ML, so the threshold below is auditable. Tokens
 * under 3 characters are dropped (same reasoning as store_award_outcomes.
 * first_token(): short fragments like "OF"/"AND" match everything and
 * mean nothing). */
function titleOverlap(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 3));
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / new Set([...ta, ...tb]).size;
}

/** Never asserted as a certain match on its own - this is strictly weaker
 * evidence than a reference match, so it only ever produces `matchedOn:
 * "title_similarity"`, distinct from `"reference"`, so a consuming UI can
 * show the difference rather than treat both as equally confident. */
const TITLE_SIMILARITY_THRESHOLD = 0.5;

/** Matches each pursuit to a published award: by `reference` first, else
 * by the SAME buyer plus the closest title above TITLE_SIMILARITY_THRESHOLD
 * (the brief's own fallback order). Returns a suggestion only - "Won" when
 * one of the company's own names is the award's single winner, "Lost"
 * (naming who won) otherwise, "Unmatched" when nothing was found or the
 * matched tender has no winner yet. The user confirms via the UI; nothing
 * here writes to a pipeline stage or any other record. */
export function matchPursuitsToAwards(
  pursuits: readonly Pursuit[],
  awards: readonly Pick<TenderOutcome, "outcome_key" | "reference" | "buyer" | "title" | "status" | "winner_name" | "winner_count">[],
): PursuitMatch[] {
  return pursuits.map((p) => {
    let matched: (typeof awards)[number] | null = null;
    let matchedOn: PursuitMatch["matchedOn"] = null;

    if (p.reference) {
      const ref = normalizeReference(p.reference);
      matched = awards.find((a) => a.reference && normalizeReference(a.reference) === ref) ?? null;
      if (matched) matchedOn = "reference";
    }

    if (!matched && p.buyer && p.title) {
      const sameBuyer = awards.filter((a) => a.buyer && normName(a.buyer) === normName(p.buyer) && a.title);
      let best: { award: (typeof awards)[number]; score: number } | null = null;
      for (const a of sameBuyer) {
        const score = titleOverlap(p.title, a.title as string);
        if (score >= TITLE_SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { award: a, score };
      }
      if (best) {
        matched = best.award;
        matchedOn = "title_similarity";
      }
    }

    if (!matched || matched.status !== "awarded") {
      return { pursuitId: p.id, matchedOutcomeKey: matched?.outcome_key ?? null, matchedOn, suggestion: "Unmatched", lostTo: null };
    }

    const companyWon =
      matched.winner_count === 1 &&
      !!matched.winner_name &&
      p.companyNames.some((name) => name && normName(name) === normName(matched!.winner_name));

    return {
      pursuitId: p.id,
      matchedOutcomeKey: matched.outcome_key,
      matchedOn,
      suggestion: companyWon ? "Won" : "Lost",
      lostTo: companyWon ? null : matched.winner_name,
    };
  });
}
