// Market feedback on tender prices (Sarel, 2026-10-17: "see what we can do
// with tender submission and award and award price information to provide
// this as an added benefit to give that analysis feedback"). Combines the
// company's own submitted price (tender_packs, 0034) with what buyers
// published afterwards (public_tender_outcomes, 0053, written by
// engine/discovery/store_award_outcomes.py from award_outcomes.py's two public
// sources). Design + data coverage: docs/specs/Award-Price-Analysis-Findings.md.
//
// Honesty rules, same discipline as field provenance (confirmed / assumed /
// missing):
//  * a company is only "found" on a register by its own name AND the price it
//    recorded ("confirmed"); name or price alone is shown as "probably you -
//    check", never silently treated as certain;
//  * rand amounts are compared only WITHIN one tender (same scope, same
//    register). Across tenders only scale-free numbers are aggregated:
//    bidders per tender, the winner's rank, winning bid / median bid, how
//    often the lowest bid won. Contract size is shown as size, not as "the
//    price to bid";
//  * every aggregate carries its own sample size, and below MIN_SAMPLE it is
//    not shown at all.

import type { SupabaseClient } from "@supabase/supabase-js";
import { median, toNumber } from "@/lib/dealEconomics";

export type BidAmount = { column: string | null; amount_zar: number | null; amount_raw: string | null };
export type Bidder = { name: string; amounts: BidAmount[]; bbbee?: string | null; notes?: string | null; is_winner?: boolean };

export type TenderOutcome = {
  id: string;
  outcome_key: string;
  reference: string | null;
  buyer: string | null;
  title: string | null;
  project_type: string | null;
  procurement_type: string | null;
  categories: string[];
  competitive: boolean;
  status: "register_published" | "awarded";
  closing_date: string | null;
  award_date: string | null;
  winner_name: string | null;
  winner_amount_zar: number | string | null;
  winner_points: string | null;
  winner_count: number;
  bidders: Bidder[];
  bidders_source: "sanral_register" | "etenders_bidders" | null;
  register_columns: number;
  bidder_count: number;
  priced_bidder_count: number;
  median_bid_zar: number | string | null;
  winner_rank: number | null;
  winner_vs_median: number | string | null;
  lowest_bid_won: boolean | null;
  winner_match_basis: string | null;
  data_notes: string[];
  sources: string[];
  source_urls: string[];
  attribution: string | null;
  refreshed_at: string;
};

export const OUTCOME_COLUMNS =
  "id, outcome_key, reference, buyer, title, project_type, procurement_type, categories, competitive, status, closing_date, award_date, winner_name, winner_amount_zar, winner_points, winner_count, bidders, bidders_source, register_columns, bidder_count, priced_bidder_count, median_bid_zar, winner_rank, winner_vs_median, lowest_bid_won, winner_match_basis, data_notes, sources, source_urls, attribution, refreshed_at";

/** The per-tender numbers the benchmarks aggregate (no bidder names, no register). */
export type OutcomeStats = Pick<
  TenderOutcome,
  "id" | "status" | "award_date" | "closing_date" | "winner_name" | "winner_amount_zar" | "winner_count" | "bidder_count" | "priced_bidder_count" | "winner_rank" | "winner_vs_median" | "lowest_bid_won" | "register_columns" | "sources"
>;
export const STATS_COLUMNS =
  "id, status, award_date, closing_date, winner_name, winner_amount_zar, winner_count, bidder_count, priced_bidder_count, winner_rank, winner_vs_median, lowest_bid_won, register_columns, sources";

export const SOURCE_LABEL: Record<string, string> = {
  sanral_awarded: "SANRAL awarded tenders page",
  sanral_closed: "SANRAL closed tenders page (opening register)",
  etenders_portal: "eTenders Awarded tab",
};

/** Below this many tenders an aggregate is not shown; below THIN_SAMPLE it is flagged. */
export const MIN_SAMPLE = 5;
export const THIN_SAMPLE = 15;
export type SampleStrength = "too_few" | "thin" | "fair";
export function sampleStrength(n: number): SampleStrength {
  return n < MIN_SAMPLE ? "too_few" : n < THIN_SAMPLE ? "thin" : "fair";
}

// ------------------------------------------------------------ names

const NOISE_WORDS = ["PTY", "LTD", "LIMITED", "CC", "INC", "T/A", "TRADING AS", "THE", "SA", "SOUTH AFRICA", "HOLDINGS", "GROUP"];
const NAME_NOISE = new RegExp(`\\b(${NOISE_WORDS.map((w) => w.replace("/", "\\/")).join("|")})\\b`, "g");

/** Same rule as store_award_outcomes.norm_name(): "Klipcorp Pty Ltd" == "KLIPCORP (PTY) LTD". */
export function normName(name: string | null | undefined): string {
  let s = (name ?? "").toUpperCase().replace(/&/g, " AND ");
  if (!/^\(.*\)$/.test(s.trim())) s = s.replace(/\(.*?\)/g, " ");
  return s.replace(NAME_NOISE, " ").replace(/[^A-Z0-9]/g, "");
}

/** First distinctive word of a name (store_award_outcomes.first_token): "Klipcorp Consulting" -> "KLIPCORP". */
export function firstToken(name: string | null | undefined): string | null {
  for (const w of (name ?? "").toUpperCase().split(/[^A-Z0-9]+/)) {
    if (w.length >= 3 && !NOISE_WORDS.includes(w)) return w;
  }
  return null;
}

// ------------------------------------------------------------ one tender, one company

/** Same rule as store_award_outcomes.OUTLIER_FACTOR: an amount 5x off the median is almost always a typing error on the register. */
export const OUTLIER_FACTOR = 5;

export type ColumnField = {
  column: number;
  label: string | null;
  amounts: number[]; // sorted ascending, priced bids only, typing errors left out
  outliers: number[]; // amounts left out as likely typing errors (shown in the register as published)
  low: number | null;
  median: number | null;
  high: number | null;
};

export function columnField(outcome: Pick<TenderOutcome, "bidders">, column: number): ColumnField {
  const all = outcome.bidders
    .map((b) => b.amounts[column]?.amount_zar ?? null)
    .filter((a): a is number => typeof a === "number" && a > 0)
    .sort((a, b) => a - b);
  const m = median(all);
  const ok = (a: number) => all.length < 3 || m === null || (a >= m / OUTLIER_FACTOR && a <= m * OUTLIER_FACTOR);
  const amounts = all.filter(ok);
  const outliers = all.filter((a) => !ok(a));
  const label = outcome.bidders.find((b) => b.amounts[column])?.amounts[column]?.column ?? null;
  return { column, label, amounts, outliers, low: amounts[0] ?? null, median: median(amounts), high: amounts.at(-1) ?? null };
}

export type OwnPosition = {
  /** how the company was found on the register */
  found: "name_and_price" | "name" | "price" | "similar_name" | "not_found";
  entry: Bidder | null;
  column: number;
  field: ColumnField;
  price: number | null; // the company's price on this register (as published), else as recorded
  rank: number | null; // 1 = lowest priced bid
  of: number;
  winnerAmount: number | null;
  vsWinnerPct: number | null;
  vsMedianPct: number | null;
  vsLowPct: number | null;
  youWon: boolean | null;
  /** the published figure and the recorded one differ (VAT basis? a correction?) */
  recordedDiffers: boolean;
};

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, b * 0.001);
}

const pct = (a: number | null, b: number | null) => (a !== null && b ? Math.round(((a - b) / b) * 1000) / 10 : null);

/**
 * Where this company sits on a published register. companyNames: the
 * company's legal and trading names; submittedPrice: tender_packs'
 * submitted_price_zar. Batch registers (one price per contract) are read in
 * the column whose price matches the recorded one.
 */
export function ownPosition(outcome: TenderOutcome, companyNames: (string | null | undefined)[], submittedPrice: number | null): OwnPosition {
  const names = new Set(companyNames.map(normName).filter(Boolean));
  const byName = outcome.bidders.filter((b) => names.has(normName(b.name)));
  const columns = Math.max(1, outcome.register_columns || 0);

  const priceHit = (b: Bidder) =>
    submittedPrice === null ? -1 : b.amounts.findIndex((a) => typeof a.amount_zar === "number" && near(a.amount_zar, submittedPrice));

  let entry: Bidder | null = null;
  let column = 0;
  let found: OwnPosition["found"] = "not_found";
  const named = byName.find((b) => priceHit(b) >= 0);
  if (named) {
    entry = named;
    column = priceHit(named);
    found = "name_and_price";
  } else if (byName.length === 1) {
    entry = byName[0];
    found = "name";
  } else {
    const priced = outcome.bidders.filter((b) => priceHit(b) >= 0);
    const tokens = new Set(companyNames.map(firstToken).filter(Boolean));
    const similar = outcome.bidders.filter((b) => tokens.has(firstToken(b.name)));
    if (priced.length === 1) {
      entry = priced[0];
      column = priceHit(priced[0]);
      found = "price";
    } else if (similar.length === 1) {
      // "Klipcorp Consulting" for "Klipcorp (Pty) Ltd": shown, never treated as certain.
      entry = similar[0];
      found = "similar_name";
    }
  }
  const field = columnField(outcome, Math.min(column, columns - 1));
  const published = entry?.amounts[field.column]?.amount_zar ?? null;
  const price = published ?? submittedPrice;
  const winner = outcome.bidders.find((b) => b.is_winner) ?? null;
  // A winner is only known per tender, not per contract of a batch.
  const winnerAmount = columns === 1 ? winner?.amounts[0]?.amount_zar ?? toNumber(outcome.winner_amount_zar) : null;
  const rank = price !== null && field.amounts.length > 0 && entry ? 1 + field.amounts.filter((a) => a < price).length : null;
  return {
    found,
    entry,
    column: field.column,
    field,
    price,
    rank,
    of: field.amounts.length,
    winnerAmount,
    vsWinnerPct: entry ? pct(price, winnerAmount) : null,
    vsMedianPct: entry ? pct(price, field.median) : null,
    vsLowPct: entry ? pct(price, field.low) : null,
    youWon: outcome.status === "awarded" && entry ? !!entry.is_winner : null,
    recordedDiffers: published !== null && submittedPrice !== null && !near(published, submittedPrice),
  };
}

export const FOUND_LABEL: Record<OwnPosition["found"], string> = {
  name_and_price: "Found on the register under your name, at the price you recorded",
  name: "Found under your name - the price differs from the one you recorded, or none is recorded",
  price: "A bid at exactly your recorded price, under another name - probably you (a JV or trading name?); check",
  similar_name: "A firm with a name like yours (same first word) - probably you, but the price you recorded is not on the register; check",
  not_found: "Your company is not on this register under its name or at your recorded price",
};

// ------------------------------------------------------------ benchmarks across tenders

export type Benchmark = {
  n: number;
  awarded: number;
  dateFrom: string | null;
  dateTo: string | null;
  bidders: { n: number; median: number | null; p25: number | null; p75: number | null };
  lowestWon: { n: number; won: number };
  winnerVsMedian: { n: number; median: number | null };
  contractSize: { n: number; p25: number | null; median: number | null; p75: number | null };
  winners: { n: number; distinct: number; top3Share: number | null };
  sources: Record<string, number>;
};

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function benchmark(rows: OutcomeStats[]): Benchmark {
  const dates = rows.map((r) => r.award_date ?? r.closing_date).filter((d): d is string => !!d).sort();
  const counts = rows.filter((r) => r.priced_bidder_count >= 2).map((r) => r.priced_bidder_count).sort((a, b) => a - b);
  const ranked = rows.filter((r) => r.lowest_bid_won !== null);
  const ratios = rows.map((r) => toNumber(r.winner_vs_median)).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const single = rows.filter((r) => r.status === "awarded" && r.winner_count === 1);
  const sizes = single.map((r) => toNumber(r.winner_amount_zar)).filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  const winnerCounts = new Map<string, number>();
  for (const r of single) {
    const k = normName(r.winner_name);
    if (k) winnerCounts.set(k, (winnerCounts.get(k) ?? 0) + 1);
  }
  const top3 = [...winnerCounts.values()].sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
  const sources: Record<string, number> = {};
  for (const r of rows) for (const s of r.sources) sources[s] = (sources[s] ?? 0) + 1;
  return {
    n: rows.length,
    awarded: rows.filter((r) => r.status === "awarded").length,
    dateFrom: dates[0] ?? null,
    dateTo: dates.at(-1) ?? null,
    bidders: { n: counts.length, median: median(counts), p25: quantile(counts, 0.25), p75: quantile(counts, 0.75) },
    lowestWon: { n: ranked.length, won: ranked.filter((r) => r.lowest_bid_won).length },
    winnerVsMedian: { n: ratios.length, median: median(ratios) },
    contractSize: { n: sizes.length, p25: quantile(sizes, 0.25), median: median(sizes), p75: quantile(sizes, 0.75) },
    winners: { n: winnerCounts.size ? single.length : 0, distinct: winnerCounts.size, top3Share: single.length ? top3 / single.length : null },
    sources,
  };
}

export type Segment = { key: string; label: string; sanralOnly: boolean; buyer: string | null; categories: string[] };

/**
 * The comparison groups for a tender: same buyer + same discipline, and all
 * buyers + same discipline. SANRAL tenders are recognised by their SANRAL
 * reference (outcome_key 'sanral:...'), any other buyer by its name.
 */
export function segmentsFor(args: { buyerLabel: string; isSanral: boolean; categories: string[]; categoryLabel: string }): Segment[] {
  if (args.categories.length === 0) return [];
  const out: Segment[] = [];
  if (args.isSanral) out.push({ key: "buyer", label: `SANRAL · ${args.categoryLabel}`, sanralOnly: true, buyer: null, categories: args.categories });
  else if (args.buyerLabel && !args.buyerLabel.startsWith("(")) out.push({ key: "buyer", label: `${args.buyerLabel} · ${args.categoryLabel}`, sanralOnly: false, buyer: args.buyerLabel, categories: args.categories });
  out.push({ key: "all", label: `All buyers · ${args.categoryLabel}`, sanralOnly: false, buyer: null, categories: args.categories });
  return out;
}

/** Competitive published outcomes in a segment (numbers only - no registers). */
export async function loadSegment(supabase: SupabaseClient, s: Segment): Promise<{ rows: OutcomeStats[]; error: string | null }> {
  let q = supabase.from("public_tender_outcomes").select(STATS_COLUMNS).eq("competitive", true).overlaps("categories", s.categories);
  if (s.sanralOnly) q = q.like("outcome_key", "sanral:%");
  if (s.buyer) q = q.ilike("buyer", s.buyer.replace(/[%_]/g, (c) => `\\${c}`));
  const { data, error } = await q.limit(5000);
  return { rows: (data ?? []) as OutcomeStats[], error: error?.message ?? null };
}

/** Outcomes published for these tenders (tender_market_outcomes(), 0053), keyed by tender id. */
export async function loadOutcomesForTenders(
  supabase: SupabaseClient,
  tenderIds: string[],
): Promise<{ byTender: Map<string, TenderOutcome[]>; error: string | null }> {
  const byTender = new Map<string, TenderOutcome[]>();
  if (tenderIds.length === 0) return { byTender, error: null };
  const { data: links, error } = await supabase.rpc("tender_market_outcomes", { p_tender_ids: tenderIds });
  if (error) return { byTender, error: error.message };
  const ids = [...new Set(((links ?? []) as { outcome_id: string }[]).map((l) => l.outcome_id))];
  if (ids.length === 0) return { byTender, error: null };
  const { data: rows, error: e2 } = await supabase.from("public_tender_outcomes").select(OUTCOME_COLUMNS).in("id", ids);
  if (e2) return { byTender, error: e2.message };
  const byId = new Map(((rows ?? []) as TenderOutcome[]).map((r) => [r.id, r]));
  for (const l of (links ?? []) as { tender_id: string; outcome_id: string }[]) {
    const o = byId.get(l.outcome_id);
    if (o) byTender.set(l.tender_id, [...(byTender.get(l.tender_id) ?? []), o]);
  }
  return { byTender, error: null };
}

/** The richest outcome when a tender matched more than one (register + winner first). */
export function bestOutcome(list: TenderOutcome[] | undefined): TenderOutcome | null {
  if (!list || list.length === 0) return null;
  return [...list].sort(
    (a, b) => Number(b.status === "awarded") - Number(a.status === "awarded") || b.priced_bidder_count - a.priced_bidder_count,
  )[0];
}

// ------------------------------------------------------------ firms met on your own tenders

export type FirmMet = { name: string; met: number; theyWon: number; youLower: number; compared: number };

/**
 * Other firms on the published registers of tenders this company itself bid
 * on (only registers where the company was found). Scoped on purpose to the
 * company's own competitions - see the findings doc on competitor framing.
 */
export function firmsMet(entries: { outcome: TenderOutcome; position: OwnPosition }[]): FirmMet[] {
  const firms = new Map<string, FirmMet>();
  for (const { outcome, position } of entries) {
    if (!position.entry) continue;
    for (const b of outcome.bidders) {
      if (b === position.entry) continue;
      const k = normName(b.name);
      if (!k) continue;
      const f = firms.get(k) ?? { name: b.name, met: 0, theyWon: 0, youLower: 0, compared: 0 };
      f.met += 1;
      if (b.is_winner) f.theyWon += 1;
      const theirs = b.amounts[position.column]?.amount_zar ?? null;
      if (theirs !== null && position.price !== null) {
        f.compared += 1;
        if (position.price < theirs) f.youLower += 1;
      }
      firms.set(k, f);
    }
  }
  return [...firms.values()].sort((a, b) => b.met - a.met || b.theyWon - a.theyWon || a.name.localeCompare(b.name));
}

export function signedPct(v: number | null): string {
  if (v === null) return "-";
  if (v === 0) return "same";
  return `${v > 0 ? "+" : ""}${v.toLocaleString("en-ZA", { maximumFractionDigits: 1 })}%`;
}
