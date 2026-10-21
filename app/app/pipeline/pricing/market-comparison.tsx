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
 *
 * Design-system audit fix (2026-10-21): converted from inline-CSSProperties
 * stale hex to Tailwind + design tokens. Both tables keep plain horizontal
 * scroll on mobile (not converted to a stacked card list) - this is
 * secondary, below-the-fold market context rather than the screen's main
 * per-tender record, which is the pricing table above it; see
 * app/AGENTS.md for why only that one and the Bids list view got the full
 * card treatment.
 */

export type PricedTender = { tenderId: string; contractNo: string | null; title: string; price: number | null };

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
    <div id="market" className="mt-6">
      <h2 className="mb-1 text-base font-semibold text-foreground">How your prices compared with the published results</h2>
      <p className="mb-2.5 text-xs text-muted-foreground">
        Matched to SANRAL&apos;s opening registers / award notices and the eTenders Awarded tab. Most buyers publish only the
        winner, or nothing, so expect only some of your tenders here.
      </p>
      {error && <p className="text-xs text-destructive">Could not read published results: {error}</p>}

      {matched.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-4.5 text-sm text-muted-foreground">
          None of your {tenders.length} priced tender{tenders.length === 1 ? "" : "s"} has a published bidders list or award yet.
        </div>
      ) : (
        <>
          <div className="mb-3 rounded-lg border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground">
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
              <div className="text-xs text-warning">Based on {placed.length} tender{placed.length === 1 ? "" : "s"} - too few for a pattern; read each row on its own.</div>
            )}
          </div>

          <div className="mb-4 overflow-x-auto rounded-lg border border-border bg-card" style={{ WebkitOverflowScrolling: "touch" }}>
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold whitespace-nowrap text-muted-foreground">
                  <th className="px-2.5 py-2">Tender</th>
                  <th className="px-2.5 py-2 text-right">Your price</th>
                  <th className="px-2.5 py-2">Placed</th>
                  <th className="px-2.5 py-2 text-right">vs lowest</th>
                  <th className="px-2.5 py-2 text-right">vs median</th>
                  <th className="px-2.5 py-2 text-right">vs winner</th>
                  <th className="px-2.5 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {matched.map(({ t, outcome, position: p }) => (
                  <tr key={t.tenderId} className="border-b border-border/60 text-sm align-top last:border-0">
                    <td className="max-w-[240px] px-2.5 py-2">
                      <Link href={`/tenders/${t.tenderId}#market`} className="text-foreground no-underline hover:underline">
                        {t.contractNo && <div className="font-mono text-[11px] font-semibold">{t.contractNo}</div>}
                        <div className="text-xs">{t.title}</div>
                      </Link>
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-foreground">{formatRand(p.price)}</td>
                    <td className="px-2.5 py-2 text-foreground">
                      {p.entry && p.rank !== null ? `${p.rank} of ${p.of}` : <span className="text-muted-foreground">not on register</span>}
                      {p.found === "name" || p.found === "price" || p.found === "similar_name" ? <div className="text-[10px] text-warning">by {p.found === "similar_name" ? "similar name" : p.found} only - check</div> : null}
                      {outcome.register_columns > 1 && <div className="text-[10px] text-muted-foreground">batch: {p.field.label}</div>}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-foreground">{p.rank === 1 ? "lowest" : signedPct(p.vsLowPct)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-foreground">{signedPct(p.vsMedianPct)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-foreground">{p.youWon ? "won" : signedPct(p.vsWinnerPct)}</td>
                    <td className="px-2.5 py-2 text-xs text-foreground">
                      {outcome.status === "awarded" ? <>Awarded to {outcome.winner_name}{outcome.winner_amount_zar ? ` (${formatRand(outcome.winner_amount_zar)})` : ""}</> : "Register out, not awarded yet"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mb-1 text-sm font-semibold text-foreground">Firms you have bid against most</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            From the published registers of tenders you bid on, only. Names as the buyer typed them, so one firm can appear under two spellings.
          </p>
          {firms.length === 0 ? (
            <div className="text-xs text-muted-foreground">No firm appears on more than one of your published registers yet.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card" style={{ WebkitOverflowScrolling: "touch" }}>
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold whitespace-nowrap text-muted-foreground">
                    <th className="px-2.5 py-2">Firm</th>
                    <th className="px-2.5 py-2 text-right">Tenders met</th>
                    <th className="px-2.5 py-2 text-right">They won</th>
                    <th className="px-2.5 py-2 text-right">You priced lower</th>
                  </tr>
                </thead>
                <tbody>
                  {firms.map((f) => (
                    <tr key={f.name} className="border-b border-border/60 text-sm last:border-0">
                      <td className="px-2.5 py-2 text-foreground">{f.name}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-foreground">{f.met}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-foreground">{f.theyWon}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-foreground">{f.compared ? `${f.youLower} of ${f.compared}` : "-"}</td>
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
