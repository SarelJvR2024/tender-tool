import type { CSSProperties } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatRand, median } from "@/lib/dealEconomics";
import { bestOutcome, firmsMet, loadOutcomesForTenders, ownPosition, sampleStrength, signedPct, type OwnPosition, type TenderOutcome } from "@/lib/marketPricing";

/**
 * "How your prices compared" on /pipeline/pricing (0053): each priced tender
 * whose result a buyer has published, with where the company's own price
 * sat on that tender's register, plus the firms the company has met most
 * often on those registers. Only the company's own tenders - no other
 * tender's register is shown here. Design + coverage caveats:
 * docs/specs/Award-Price-Analysis-Findings.md.
 */

export type PricedTender = { tenderId: string; contractNo: string | null; title: string; price: number | null };

const th: CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6B6758", padding: "8px 10px", borderBottom: "1px solid #E5E1D5", whiteSpace: "nowrap" };
const td: CSSProperties = { fontSize: 13, color: "#16233B", padding: "8px 10px", borderBottom: "1px solid #F0EEE6", verticalAlign: "top" };
const num: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

export async function MarketComparison({ tenders }: { tenders: PricedTender[] }) {
  const supabase = await createClient();
  const [{ data: company }, { byTender, error }] = await Promise.all([
    supabase.from("companies").select("legal_name, csd_trading_name").maybeSingle(),
    loadOutcomesForTenders(supabase, tenders.map((t) => t.tenderId)),
  ]);
  const names = [company?.legal_name, company?.csd_trading_name];
  const matched = tenders
    .map((t) => {
      const outcome = bestOutcome(byTender.get(t.tenderId));
      return outcome ? { t, outcome, position: ownPosition(outcome, names, t.price) } : null;
    })
    .filter((m): m is { t: PricedTender; outcome: TenderOutcome; position: OwnPosition } => m !== null);
  const placed = matched.filter((m) => m.position.entry && m.position.rank !== null);
  const confirmed = placed.filter((m) => m.position.found === "name_and_price");
  const vsWinner = placed.map((m) => (m.position.youWon ? null : m.position.vsWinnerPct)).filter((v): v is number => v !== null);
  const vsMedian = placed.map((m) => m.position.vsMedianPct).filter((v): v is number => v !== null);
  const lowest = placed.filter((m) => m.position.rank === 1).length;
  const firms = firmsMet(placed.map((m) => ({ outcome: m.outcome, position: m.position }))).filter((f) => f.met >= 2).slice(0, 12);

  return (
    <div id="market" style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>How your prices compared with the published results</h2>
      <p style={{ fontSize: 12, color: "#6B6758", margin: "0 0 10px" }}>
        Matched to SANRAL&apos;s opening registers / award notices and the eTenders Awarded tab. Most buyers publish only the
        winner, or nothing, so expect only some of your tenders here.
      </p>
      {error && <p style={{ fontSize: 12, color: "#B91C1C" }}>Could not read published results: {error}</p>}

      {matched.length === 0 ? (
        <div style={{ background: "#FFFFFF", border: "1px dashed #E5E1D5", borderRadius: 11, padding: 18, fontSize: 13, color: "#6B6758" }}>
          None of your {tenders.length} priced tender{tenders.length === 1 ? "" : "s"} has a published bidders list or award yet.
        </div>
      ) : (
        <>
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "12px 16px", marginBottom: 12, fontSize: 13, color: "#16233B", lineHeight: 1.6 }}>
            <strong>{matched.length}</strong> of your {tenders.length} priced tenders have a published result; you are on the register of{" "}
            <strong>{placed.length}</strong> ({confirmed.length} by name and price, {placed.length - confirmed.length} by name or price only - check those).
            {placed.length > 0 && (
              <>
                {" "}You were the lowest bid on {lowest} of {placed.length}.
                {vsMedian.length > 0 && <> Typically {signedPct(median(vsMedian))} vs the median bid</>}
                {vsWinner.length > 0 && <>, {signedPct(median(vsWinner))} vs the winning bid when you did not win</>}.
              </>
            )}
            {sampleStrength(placed.length) !== "fair" && (
              <div style={{ fontSize: 11, color: "#B45309" }}>Based on {placed.length} tender{placed.length === 1 ? "" : "s"} - too few for a pattern; read each row on its own.</div>
            )}
          </div>

          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={th}>Tender</th>
                  <th style={{ ...th, textAlign: "right" }}>Your price</th>
                  <th style={th}>Placed</th>
                  <th style={{ ...th, textAlign: "right" }}>vs lowest</th>
                  <th style={{ ...th, textAlign: "right" }}>vs median</th>
                  <th style={{ ...th, textAlign: "right" }}>vs winner</th>
                  <th style={th}>Result</th>
                </tr>
              </thead>
              <tbody>
                {matched.map(({ t, outcome, position: p }) => (
                  <tr key={t.tenderId}>
                    <td style={{ ...td, maxWidth: 240 }}>
                      <Link href={`/tenders/${t.tenderId}#market`} style={{ color: "#16233B", textDecoration: "none" }}>
                        {t.contractNo && <div style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600 }}>{t.contractNo}</div>}
                        <div style={{ fontSize: 12 }}>{t.title}</div>
                      </Link>
                    </td>
                    <td style={num}>{formatRand(p.price)}</td>
                    <td style={td}>
                      {p.entry && p.rank !== null ? `${p.rank} of ${p.of}` : <span style={{ color: "#9A9684" }}>not on register</span>}
                      {p.found === "name" || p.found === "price" || p.found === "similar_name" ? <div style={{ fontSize: 10, color: "#B45309" }}>by {p.found === "similar_name" ? "similar name" : p.found} only - check</div> : null}
                      {outcome.register_columns > 1 && <div style={{ fontSize: 10, color: "#9A9684" }}>batch: {p.field.label}</div>}
                    </td>
                    <td style={num}>{p.rank === 1 ? "lowest" : signedPct(p.vsLowPct)}</td>
                    <td style={num}>{signedPct(p.vsMedianPct)}</td>
                    <td style={num}>{p.youWon ? "won" : signedPct(p.vsWinnerPct)}</td>
                    <td style={{ ...td, fontSize: 12 }}>
                      {outcome.status === "awarded" ? <>Awarded to {outcome.winner_name}{outcome.winner_amount_zar ? ` (${formatRand(outcome.winner_amount_zar)})` : ""}</> : "Register out, not awarded yet"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Firms you have bid against most</h3>
          <p style={{ fontSize: 12, color: "#6B6758", margin: "0 0 8px" }}>
            From the published registers of tenders you bid on, only. Names as the buyer typed them, so one firm can appear under two spellings.
          </p>
          {firms.length === 0 ? (
            <div style={{ fontSize: 12, color: "#6B6758" }}>No firm appears on more than one of your published registers yet.</div>
          ) : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                <thead>
                  <tr>
                    <th style={th}>Firm</th>
                    <th style={{ ...th, textAlign: "right" }}>Tenders met</th>
                    <th style={{ ...th, textAlign: "right" }}>They won</th>
                    <th style={{ ...th, textAlign: "right" }}>You priced lower</th>
                  </tr>
                </thead>
                <tbody>
                  {firms.map((f) => (
                    <tr key={f.name}>
                      <td style={td}>{f.name}</td>
                      <td style={num}>{f.met}</td>
                      <td style={num}>{f.theyWon}</td>
                      <td style={num}>{f.compared ? `${f.youLower} of ${f.compared}` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
