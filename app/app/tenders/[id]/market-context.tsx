import type { CSSProperties, ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { expandDisciplines, loadDisciplineTaxonomy, taxonomyLabel, type DisciplineTaxonomy } from "@/lib/disciplineTaxonomy";
import { clientLabel, formatRand, toNumber } from "@/lib/dealEconomics";
import { GENERAL_FAMILY } from "@/lib/generalTender";
import {
  FOUND_LABEL,
  MIN_SAMPLE,
  SOURCE_LABEL,
  benchmark,
  bestOutcome,
  loadMarketTrend,
  loadOutcomesForTenders,
  loadSegment,
  ownPosition,
  sampleStrength,
  segmentsFor,
  signedPct,
  type Benchmark,
  type MarketTrend,
  type OwnPosition,
  type Segment,
  type TenderOutcome,
} from "@/lib/marketPricing";

/**
 * "Market" on the Tender Workspace (0053, docs/specs/Award-Price-Analysis-Findings.md):
 *  1. this tender's own published result - the opening register / award,
 *     with where this company's price sat in it;
 *  2. what similar published tenders looked like (same buyer + discipline,
 *     all buyers + discipline) - bidders per tender, how often the lowest
 *     bid won, winner vs the field - for deciding whether / how to pursue.
 * Public data only, read through RLS; every number carries its sample size.
 */

const card: CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };
const muted: CSSProperties = { fontSize: 12, color: "#6B6758" };
const h3: CSSProperties = { fontSize: 14, fontWeight: 700, color: "#16233B", margin: "14px 0 6px" };

type Facts = { id: string; buyer: string | null; family: string | null };

export async function MarketContext({ tender }: { tender: Facts }) {
  const supabase = await createClient();
  const [{ data: pack }, { data: company }, { data: opps }, { data: tenderTags }, { data: scopeRecord }, taxonomy, outcomes] = await Promise.all([
    supabase.from("tender_packs").select("pipeline_stage, submitted_price_zar, submitted_price_incl_vat, price_sector").eq("tender_id", tender.id).maybeSingle(),
    supabase.from("companies").select("legal_name, csd_trading_name").maybeSingle(),
    supabase.from("discovered_opportunities").select("categories").eq("tender_id", tender.id).limit(1),
    // industry_tags/discipline_tags (0060) - the tags the market trend below groups by.
    supabase.from("tenders").select("industry_tags, discipline_tags").eq("id", tender.id).maybeSingle(),
    // tender_scope_records (0060) - this tender's own value band, if the text states one,
    // used only to narrow the trend comparison; never required for it to show.
    supabase.from("tender_scope_records").select("value_band").eq("tender_id", tender.id).maybeSingle(),
    loadDisciplineTaxonomy(supabase),
    loadOutcomesForTenders(supabase, [tender.id]),
  ]);

  const isSanral = !!tender.family && tender.family !== GENERAL_FAMILY && tender.family !== "UNKNOWN";
  const categories = tenderCategories(pack?.price_sector ?? null, (opps?.[0]?.categories as string[] | null) ?? null, isSanral, taxonomy);
  const categoryLabel = categories.length ? categories.map((c) => taxonomyLabel(taxonomy, c)).join(" / ") : "";
  const segments = segmentsFor({ buyerLabel: clientLabel(tender.buyer, tender.family), isSanral, categories: expandDisciplines(taxonomy, categories), categoryLabel });
  const segmentRows = await Promise.all(segments.map((s) => loadSegment(supabase, s)));

  const trendTags = [...new Set([...((tenderTags?.industry_tags as string[] | null) ?? []), ...((tenderTags?.discipline_tags as string[] | null) ?? [])])];
  const valueBand = (scopeRecord?.value_band as string | null) ?? null;
  const { trend, error: trendError } = await loadMarketTrend(supabase, trendTags, valueBand);

  const outcome = bestOutcome(outcomes.byTender.get(tender.id));
  const submitted = toNumber(pack?.submitted_price_zar ?? null);
  const position = outcome ? ownPosition(outcome, [company?.legal_name, company?.csd_trading_name], submitted) : null;
  const stage = (pack?.pipeline_stage as string | undefined) ?? null;

  return (
    <div id="market" style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B" }}>Market: published bids and awards</div>
      <div style={{ ...muted, marginTop: 4 }}>
        From what buyers publish after closing (SANRAL&apos;s opening registers and award notices, the eTenders Awarded
        tab). Many buyers publish only the winner, and some publish nothing, so this is often empty or thin - it says so
        when it is.
      </div>
      {outcomes.error && <div style={{ ...muted, color: "#B91C1C", marginTop: 8 }}>Could not read published results: {outcomes.error}</div>}

      <div style={h3}>This tender</div>
      {outcome && position ? (
        <ThisTender outcome={outcome} position={position} submitted={submitted} stage={stage} inclVat={pack?.submitted_price_incl_vat !== false} />
      ) : (
        <div style={muted}>
          Nothing published for this tender yet.{" "}
          {isSanral
            ? "SANRAL usually puts the opening register (every bidder and price) on its closed-tenders page within days of closing, and the winner on its awarded-tenders page later."
            : "If the buyer publishes an award notice on the eTenders Awarded tab it shows here; only a minority of those list the other bidders."}
          {stage === "submitted" && submitted === null && " Record your submitted price on the Pipeline card, so you can see where it placed once the result is out."}
        </div>
      )}

      <div style={h3}>Similar published tenders</div>
      {segments.length === 0 ? (
        <div style={muted}>No discipline is known for this tender yet - set the sector under &ldquo;Price &amp; credit&rdquo; on its Pipeline card to compare it with similar tenders.</div>
      ) : (
        <SegmentTable segments={segments} results={segmentRows.map((r) => ({ b: benchmark(r.rows), error: r.error }))} />
      )}

      {trendTags.length > 0 && (trend || trendError) && (
        <>
          <div style={h3}>Market tendering trend{valueBand ? ` (${valueBand})` : ""}</div>
          {trendError ? (
            <div style={{ ...muted, color: "#B91C1C" }}>Could not read the market trend: {trendError}</div>
          ) : trend ? (
            <MarketTrendBlock trend={trend} tags={trendTags} valueBand={valueBand} />
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Discipline/value-band-level trend from comparable awarded, competitive
 * outcomes (market_trend_for_tags(), 0062) - historical reference only,
 * never a price the system sets or suggests. Only rendered when the caller
 * (loadMarketTrend()) already cleared MIN_SAMPLE comparable awards; this
 * component additionally hides the pct-of-estimate line on its own, thinner
 * sample (most comparable awards have no stated estimate to compare
 * against at all).
 */
function MarketTrendBlock({ trend, tags, valueBand }: { trend: MarketTrend; tags: string[]; valueBand: string | null }) {
  const bbbeeEntries = Object.entries(trend.bbbeeLevelCounts).sort((a, b) => b[1] - a[1]);
  const bbbeeTotal = bbbeeEntries.reduce((s, [, n]) => s + n, 0);
  return (
    <div>
      <div style={{ fontSize: 13, color: "#16233B", lineHeight: 1.6 }}>
        Based on <strong>{trend.n}</strong> comparable past award{trend.n === 1 ? "" : "s"} tagged {tags.map((t) => taxonomyLabelOrSlug(t)).join(" / ")}
        {valueBand ? <> in the {valueBand} value band</> : null}
        {trend.dateFrom && <> ({trend.dateFrom.slice(0, 7)} to {trend.dateTo?.slice(0, 7)})</>}.
        {trend.pctOfEstimate.median !== null ? (
          <>
            {" "}Where the buyer stated an estimate ({trend.pctOfEstimate.n} of those awards), winners typically priced at{" "}
            <strong>{Math.round(trend.pctOfEstimate.median * 100)}%</strong> of it.
          </>
        ) : (
          <> None of these awards had both a stated estimate and a winning amount to compare, so no price-vs-estimate figure is shown.</>
        )}
        {trend.bidderCount.median !== null && <> Typically {trend.bidderCount.median} bidder{trend.bidderCount.median === 1 ? "" : "s"} per tender ({trend.bidderCount.n} with a bidder count recorded).</>}
      </div>
      {bbbeeTotal > 0 && (
        <div style={{ ...muted, marginTop: 6 }}>
          Winning B-BBEE level, {bbbeeTotal} award{bbbeeTotal === 1 ? "" : "s"}: {bbbeeEntries.map(([level, n]) => `${level} (${n})`).join(", ")}.
        </div>
      )}
      <div style={{ fontSize: 11, color: "#9A9684", marginTop: 8 }}>
        Historical reference only, from past published outcomes - not a prediction or a recommended price. Trailing 24 months,
        competitive awards only.
      </div>
    </div>
  );
}

/** Slugs read as-is when no taxonomy label is loaded here - a plain, honest fallback, never invented wording. */
function taxonomyLabelOrSlug(slug: string): string {
  return slug.replace(/_/g, " ");
}

/** The tender's discipline: the sector the company set, else Discovery's categories, else SANRAL consulting. */
function tenderCategories(sector: string | null, discovered: string[] | null, isSanral: boolean, taxonomy: DisciplineTaxonomy): string[] {
  if (sector) return [sector];
  const known = (discovered ?? []).filter((c) => !c.startsWith("uncategorized") && taxonomy.categories.some((t) => t.slug === c));
  if (known.length) return known.slice(0, 2);
  // The SANRAL families Tender Tool fills are its consultant tenders.
  return isSanral ? ["consulting_engineering"] : [];
}

function ThisTender({ outcome, position, submitted, stage, inclVat }: { outcome: TenderOutcome; position: OwnPosition; submitted: number | null; stage: string | null; inclVat: boolean }) {
  const p = position;
  const winner = outcome.bidders.find((b) => b.is_winner);
  const batch = outcome.register_columns > 1;
  return (
    <div>
      <div style={{ fontSize: 13, color: "#16233B", lineHeight: 1.5 }}>
        {outcome.status === "awarded" ? (
          <>
            <strong>Awarded</strong> to {outcome.winner_name}
            {toNumber(outcome.winner_amount_zar) !== null && <> at {formatRand(outcome.winner_amount_zar)}</>}
            {outcome.award_date && <> on {outcome.award_date}</>}
            {outcome.winner_points && <> ({outcome.winner_points} points)</>}.
          </>
        ) : (
          <>
            <strong>Opening register published, not awarded yet.</strong> The winner is not known until the award is published.
          </>
        )}{" "}
        {outcome.bidder_count > 0 ? `${outcome.bidder_count} bidders on the register, ${p.of} with a readable price${batch ? ` for ${p.field.label ?? "this contract"}` : ""}.` : "No bidders list was published - only the award."}
      </div>

      {p.of >= 2 && <BidStrip position={p} winnerName={winner?.name ?? null} />}

      <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 8, background: p.found === "name_and_price" ? "#F0FDF4" : p.found === "not_found" ? "#F6F5F1" : "#FFFBEB", fontSize: 13, color: "#16233B" }}>
        <div style={{ fontWeight: 600 }}>{FOUND_LABEL[p.found]}</div>
        {p.entry && p.rank !== null && (
          <div style={{ marginTop: 4 }}>
            {p.entry.name}: {formatRand(p.price)} - <strong>{ordinal(p.rank)} lowest of {p.of}</strong>.
            {p.vsLowPct !== null && p.rank > 1 && <> {signedPct(p.vsLowPct)} vs the lowest bid,</>}
            {p.vsMedianPct !== null && <> {signedPct(p.vsMedianPct)} vs the median bid</>}
            {p.winnerAmount !== null && !p.youWon && <>, {signedPct(p.vsWinnerPct)} vs the winning bid</>}.
            {p.youWon && <> You won this one.</>}
          </div>
        )}
        {p.recordedDiffers && (
          <div style={{ ...muted, marginTop: 4 }}>
            The register shows {formatRand(p.price)}; you recorded {formatRand(submitted)} ({inclVat ? "incl." : "excl."} VAT). Buyers rarely say
            whether a register amount includes VAT - check which is right.
          </div>
        )}
        {p.found === "not_found" && stage && ["submitted", "won", "lost"].includes(stage) && (
          <div style={{ ...muted, marginTop: 4 }}>
            {submitted === null ? "No submitted price is recorded for this tender. " : ""}If you bid as a joint venture or under a trading name, the register lists that name instead.
          </div>
        )}
        {batch && <div style={{ ...muted, marginTop: 4 }}>Batch tender: one price per contract. Read in the column {p.found === "not_found" ? "first listed" : "your price is in"}; the winner is not known per contract.</div>}
      </div>

      {p.field.outliers.length > 0 && (
        <div style={{ ...muted, marginTop: 6 }}>
          {p.field.outliers.length} amount{p.field.outliers.length === 1 ? "" : "s"} on this register ({p.field.outliers.map((a) => formatRand(a)).join(", ")}) {p.field.outliers.length === 1 ? "is" : "are"} more than 5x away from the median and left out of the ranking - most likely a typing error by the buyer. Shown as published in the register below.
        </div>
      )}
      {outcome.bidders.length > 0 && <Register outcome={outcome} position={p} />}

      {outcome.data_notes.length > 0 && (
        <ul style={{ ...muted, margin: "8px 0 0", paddingLeft: 18 }}>
          {outcome.data_notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      <div style={{ fontSize: 11, color: "#9A9684", marginTop: 8 }}>
        Source: {outcome.sources.map((s) => SOURCE_LABEL[s] ?? s).join("; ")}
        {outcome.source_urls.map((u, i) => (
          <a key={u} href={u} target="_blank" rel="noreferrer" style={{ color: "#6B6758", marginLeft: 6 }}>[{i + 1}]</a>
        ))}
        {outcome.attribution && <div>{outcome.attribution}</div>}
        <div>Read {new Date(outcome.refreshed_at).toLocaleDateString("en-ZA")}. Amounts as published; VAT basis is not stated by the buyer.</div>
      </div>
    </div>
  );
}

/** One dot per priced bid on this register, on one rand axis; you and the winner labelled. */
function BidStrip({ position, winnerName }: { position: OwnPosition; winnerName: string | null }) {
  const f = position.field;
  const lo = f.low as number;
  const hi = f.high as number;
  const W = 600;
  const pad = 24;
  const x = (v: number) => (hi === lo ? W / 2 : pad + ((v - lo) / (hi - lo)) * (W - 2 * pad));
  // Simple lanes so near-equal bids don't sit on top of each other.
  const lanes: number[] = [];
  const dots = f.amounts.map((a) => {
    const cx = x(a);
    let lane = lanes.findIndex((last) => cx - last >= 16);
    if (lane === -1) lane = lanes.length < 4 ? lanes.length : 3;
    lanes[lane] = cx;
    return { a, cx, cy: 16 + lane * 16 };
  });
  const H = 16 + Math.max(1, lanes.length) * 16 + 8;
  const you = position.entry ? position.entry.amounts[f.column]?.amount_zar ?? null : null;
  const win = position.winnerAmount;
  const medianX = f.median !== null ? x(f.median) : null;
  return (
    <figure style={{ margin: "10px 0 0" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${f.amounts.length} priced bids from ${formatRand(lo)} to ${formatRand(hi)}`} style={{ display: "block", maxWidth: W }}>
        <line x1={pad} x2={W - pad} y1={H - 2} y2={H - 2} stroke="#E5E1D5" strokeWidth={1} />
        {medianX !== null && <line x1={medianX} x2={medianX} y1={4} y2={H - 2} stroke="#9A9684" strokeWidth={1.5} strokeDasharray="4 4" />}
        {dots.map((d, i) => {
          const isYou = you !== null && d.a === you;
          const isWin = win !== null && d.a === win;
          return (
            <g key={i}>
              <circle cx={d.cx} cy={d.cy} r={isYou || isWin ? 8 : 6} fill={isYou ? "#16233B" : isWin ? "#FFFFFF" : "#B8B4A6"} stroke={isWin ? "#D97706" : "#FFFFFF"} strokeWidth={isWin ? 2.5 : 2}>
                <title>{`${isYou ? "You: " : isWin ? `Winner${winnerName ? ` (${winnerName})` : ""}: ` : ""}${formatRand(d.a)}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      {/* Axis labels in HTML, not SVG text: the strip scales down to a third on a phone and SVG text would shrink with it. */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, color: "#6B6758", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
        <span>lowest {formatRand(lo)}</span>
        {f.median !== null && <span>median {formatRand(f.median)} (dashed)</span>}
        <span>highest {formatRand(hi)}</span>
      </div>
      <figcaption style={{ fontSize: 11, color: "#6B6758", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span><Dot fill="#B8B4A6" /> other bids</span>
        {you !== null && <span><Dot fill="#16233B" /> your bid</span>}
        {win !== null && <span><Dot fill="#FFFFFF" stroke="#D97706" /> winning bid</span>}
      </figcaption>
    </figure>
  );
}

function Dot({ fill, stroke }: { fill: string; stroke?: string }) {
  return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: fill, border: `2px solid ${stroke ?? fill}`, verticalAlign: "middle", marginRight: 3 }} />;
}

function Register({ outcome, position }: { outcome: TenderOutcome; position: OwnPosition }) {
  const cols = Math.max(1, outcome.register_columns);
  const rows = [...outcome.bidders].sort((a, b) => (a.amounts[position.column]?.amount_zar ?? Infinity) - (b.amounts[position.column]?.amount_zar ?? Infinity));
  const th: CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6B6758", padding: "6px 8px", borderBottom: "1px solid #E5E1D5", whiteSpace: "nowrap" };
  const td: CSSProperties = { fontSize: 12, color: "#16233B", padding: "6px 8px", borderBottom: "1px solid #F0EEE6", verticalAlign: "top" };
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ fontSize: 12, fontWeight: 600, color: "#16233B", cursor: "pointer" }}>
        The published register ({outcome.bidders.length} {outcome.bidders_source === "etenders_bidders" ? "bidders listed on eTenders" : "tenderers"})
      </summary>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginTop: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Tenderer</th>
              {Array.from({ length: cols }, (_, i) => (
                <th key={i} style={{ ...th, textAlign: "right" }}>{cols > 1 ? outcome.bidders.find((b) => b.amounts[i])?.amounts[i]?.column ?? `Contract ${i + 1}` : "Amount"}</th>
              ))}
              <th style={th}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b, i) => (
              <tr key={i} style={{ background: b === position.entry ? "#EEF2FF" : undefined }}>
                <td style={{ ...td, minWidth: 150 }}>
                  {b.name}
                  {b === position.entry && <strong style={{ marginLeft: 6, fontSize: 10 }}>YOU</strong>}
                  {b.is_winner && <strong style={{ marginLeft: 6, fontSize: 10, color: "#B45309" }}>WINNER</strong>}
                </td>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} style={{ ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {b.amounts[c]?.amount_zar ? formatRand(b.amounts[c].amount_zar) : b.amounts[c]?.amount_raw || "-"}
                  </td>
                ))}
                <td style={{ ...td, color: "#6B6758" }}>{[b.bbbee, b.notes].filter(Boolean).join("; ") || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function SegmentTable({ segments: allSegments, results: allResults }: { segments: Segment[]; results: { b: Benchmark; error: string | null }[] }) {
  // A comparison group with too few published results gets one line, not a column of "too few".
  const keep = allResults.map((r) => r.b.n >= MIN_SAMPLE);
  const segments = allSegments.filter((_, i) => keep[i]);
  const results = allResults.filter((_, i) => keep[i]);
  const small = allSegments.map((s, i) => ({ s, n: allResults[i].b.n })).filter((_, i) => !keep[i]);
  const smallNote = small.length > 0 && (
    <div style={{ ...muted, marginBottom: 6 }}>
      {small.map(({ s, n }) => `${s.label}: ${n === 0 ? "no" : `only ${n}`} published result${n === 1 ? "" : "s"} - too few to compare.`).join(" ")}
    </div>
  );
  if (segments.length === 0) return <>{smallNote}{allResults.some((r) => r.error) && <div style={{ ...muted, color: "#B91C1C" }}>Could not read: {allResults.find((r) => r.error)?.error}</div>}</>;
  const th: CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6B6758", padding: "6px 8px", borderBottom: "1px solid #E5E1D5" };
  const td: CSSProperties = { fontSize: 12, color: "#16233B", padding: "6px 8px", borderBottom: "1px solid #F0EEE6", verticalAlign: "top" };
  return (
    <>
      {smallNote}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
          <thead>
            <tr>
              <th style={th}></th>
              {segments.map((s) => <th key={s.key} style={th}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <MetricRow label="Published results compared" results={results} cell={(b) => <>{b.n} tender{b.n === 1 ? "" : "s"}{b.dateFrom && <div style={{ fontSize: 10, color: "#9A9684" }}>{b.dateFrom.slice(0, 7)} to {b.dateTo?.slice(0, 7)}</div>}<Strength n={b.n} /></>} td={td} />
            <MetricRow label="Priced bids per tender" results={results} n={(b) => b.bidders.n} cell={(b) => <>median {fmt(b.bidders.median)}<div style={{ fontSize: 10, color: "#9A9684" }}>middle half {fmt(b.bidders.p25)}-{fmt(b.bidders.p75)}</div></>} td={td} />
            <MetricRow label="Lowest bid won" results={results} n={(b) => b.lowestWon.n} cell={(b) => <>{b.lowestWon.won} of {b.lowestWon.n}</>} td={td} />
            <MetricRow label="Winning bid vs median bid" results={results} n={(b) => b.winnerVsMedian.n} cell={(b) => <>{ratioText(b.winnerVsMedian.median)}</>} td={td} />
            <MetricRow label="Contract size awarded" results={results} n={(b) => b.contractSize.n} cell={(b) => <>{formatRand(b.contractSize.p25)} - {formatRand(b.contractSize.p75)}<div style={{ fontSize: 10, color: "#9A9684" }}>middle half; median {formatRand(b.contractSize.median)}</div></>} td={td} />
            <MetricRow label="Different winners" results={results} n={(b) => b.winners.n} cell={(b) => <>{b.winners.distinct} firms won {b.winners.n}{b.winners.top3Share !== null && <div style={{ fontSize: 10, color: "#9A9684" }}>top 3 won {Math.round(b.winners.top3Share * 100)}%</div>}</>} td={td} />
          </tbody>
        </table>
      </div>
      <div style={{ ...muted, marginTop: 6 }}>
        Competitive tenders only (sole-source, single-source and emergency awards left out). Rand amounts differ with scope, so
        the comparison is in how crowded and how price-driven these tenders were, not in what to bid. Each figure shows only from {MIN_SAMPLE} published results; under 15 it is marked thin.
        {results.some((r) => r.error) && <span style={{ color: "#B91C1C" }}> Could not read: {results.find((r) => r.error)?.error}</span>}
      </div>
    </>
  );
}

function MetricRow({ label, results, cell, n, td }: { label: string; results: { b: Benchmark }[]; cell: (b: Benchmark) => ReactNode; n?: (b: Benchmark) => number; td: CSSProperties }) {
  return (
    <tr>
      <td style={{ ...td, color: "#6B6758", fontWeight: 600 }}>{label}</td>
      {results.map(({ b }, i) => {
        const k = n ? n(b) : b.n;
        const s = sampleStrength(k);
        return (
          <td key={i} style={td}>
            {s === "too_few" && n ? <span style={{ color: "#9A9684" }}>too few to say ({k})</span> : cell(b)}
            {n && s === "thin" && <div style={{ fontSize: 10, color: "#B45309" }}>thin: {k} tenders</div>}
          </td>
        );
      })}
    </tr>
  );
}

function Strength({ n }: { n: number }) {
  const s = sampleStrength(n);
  if (s === "fair") return null;
  return <div style={{ fontSize: 10, color: s === "thin" ? "#B45309" : "#9A9684" }}>{s === "thin" ? "thin sample - indicative only" : "too few to benchmark"}</div>;
}

function fmt(v: number | null): string {
  return v === null ? "-" : v.toLocaleString("en-ZA", { maximumFractionDigits: 1 });
}

function ratioText(r: number | null): string {
  if (r === null) return "-";
  const p = Math.round((1 - r) * 100);
  return p === 0 ? "typically at the median bid" : p > 0 ? `typically ${p}% below the median bid` : `typically ${-p}% above the median bid`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
