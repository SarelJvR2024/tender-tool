"use client";

import { useMemo, useState } from "react";
import { PPR_2022_THRESHOLD_ZAR, calculatePreferencePoints, systemForValue, type BeeLevel } from "@/lib/preferencePoints";
import { OtherTools, ToolsHeader } from "../_components/ToolsHeader";

// Design-system migration (2026-10-21): raw inline-CSSProperties ->
// Tailwind + tokens (see CidbGradeClient's own header comment for the
// shared reasoning). No pass/fail verdict on this page - only a plain
// input-validation error, mapped to text-destructive.
const CARD = "rounded-xl border border-border bg-card p-5";
const LABEL = "mb-1.5 block text-xs font-semibold text-foreground";
const INPUT = "min-h-11 w-full rounded-lg border border-border px-3 text-sm";

// Same real hydration-mismatch fix as CidbGradeClient's own formatZar: a
// plain `.toLocaleString("en-ZA")` disagrees between Node's and the
// browser's ICU data (comma vs the correct SA space grouping) on this
// static-prerendered page. Formatted by hand instead.
function formatThousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

const LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "Level 1" },
  { value: "2", label: "Level 2" },
  { value: "3", label: "Level 3" },
  { value: "4", label: "Level 4" },
  { value: "5", label: "Level 5" },
  { value: "6", label: "Level 6" },
  { value: "7", label: "Level 7" },
  { value: "8", label: "Level 8" },
  { value: "non_compliant", label: "Non-compliant / no valid certificate" },
];

export default function BeePreferencePointsClient() {
  const [contractValue, setContractValue] = useState("20000000");
  const [tenderPrice, setTenderPrice] = useState("1100000");
  const [lowestPrice, setLowestPrice] = useState("1000000");
  const [level, setLevel] = useState<string>("1");
  const [systemOverride, setSystemOverride] = useState<"auto" | "80/20" | "90/10">("auto");

  const result = useMemo(() => {
    const cv = Number(contractValue);
    const tp = Number(tenderPrice);
    const lp = Number(lowestPrice);
    if (!Number.isFinite(cv) || !Number.isFinite(tp) || !Number.isFinite(lp) || lp <= 0) {
      return { error: "Enter valid numbers (the lowest acceptable price must be greater than 0)." as string | null, data: null };
    }
    try {
      const beeLevel: BeeLevel = level === "non_compliant" ? "non_compliant" : (Number(level) as BeeLevel);
      const data = calculatePreferencePoints({
        contractValueZarInclVat: cv,
        tenderPriceZar: tp,
        lowestAcceptablePriceZar: lp,
        beeLevel,
        system: systemOverride === "auto" ? undefined : systemOverride,
      });
      return { error: null, data };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Invalid input", data: null };
    }
  }, [contractValue, tenderPrice, lowestPrice, level, systemOverride]);

  const defaultSystem = Number.isFinite(Number(contractValue)) ? systemForValue(Number(contractValue)) : null;

  return (
    <div className="min-h-screen bg-background">
      <ToolsHeader />

      <main className="mx-auto max-w-[640px] px-4 pt-8 pb-16">
        <h1 className="mb-2 font-display text-[22px] font-bold text-foreground">B-BBEE preference points calculator</h1>
        <p className="mb-6 text-[13px] leading-relaxed text-muted-foreground">
          Implements the actual 80/20 and 90/10 price-points formulas from the Preferential Procurement Regulations,
          2022 (regs 4-5), plus the standard B-BBEE status-level specific-goals table most organs of state publish
          (Treasury&apos;s SBD 6.1).
        </p>

        <div className={`${CARD} mb-5`}>
          <div className="mb-4">
            <label className={LABEL} htmlFor="cv">Contract/tender value (Rand, incl. VAT)</label>
            <input id="cv" type="number" min={0} value={contractValue} onChange={(e) => setContractValue(e.target.value)} className={INPUT} />
            {defaultSystem && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {`R50 million threshold -> defaults to the ${defaultSystem} system for this value.`}
              </p>
            )}
          </div>

          <div className="mb-4">
            <label className={LABEL} htmlFor="system">Preference point system</label>
            <select id="system" value={systemOverride} onChange={(e) => setSystemOverride(e.target.value as "auto" | "80/20" | "90/10")} className={INPUT}>
              <option value="auto">Automatic (from contract value)</option>
              <option value="80/20">80/20 (force)</option>
              <option value="90/10">90/10 (force)</option>
            </select>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              A buyer must state the system on the tender itself (reg 3(1)) - override here when the document says so,
              rather than relying on the R{formatThousands(PPR_2022_THRESHOLD_ZAR)} default.
            </p>
          </div>

          <div className="mb-4">
            <label className={LABEL} htmlFor="tp">Your tendered price (Rand)</label>
            <input id="tp" type="number" min={0} value={tenderPrice} onChange={(e) => setTenderPrice(e.target.value)} className={INPUT} />
          </div>

          <div className="mb-4">
            <label className={LABEL} htmlFor="lp">Lowest acceptable tender price, Pmin (Rand)</label>
            <input id="lp" type="number" min={0} value={lowestPrice} onChange={(e) => setLowestPrice(e.target.value)} className={INPUT} />
          </div>

          <div className="mb-4">
            <label className={LABEL} htmlFor="level">Your B-BBEE status level</label>
            <select id="level" value={level} onChange={(e) => setLevel(e.target.value)} className={INPUT}>
              {LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {result.error ? (
            <p className="text-[13px] text-destructive">{result.error}</p>
          ) : (
            result.data && (
              <div className="rounded-lg bg-card px-4 py-3.5">
                <div className="flex justify-between py-1 text-[13px] text-foreground">
                  <span>Price points (Ps)</span>
                  <span className="font-bold">{result.data.pricePoints} / {result.data.maxPricePoints}</span>
                </div>
                <div className="flex justify-between py-1 text-[13px] text-foreground">
                  <span>B-BBEE specific-goals points</span>
                  <span className="font-bold">{result.data.beeGoalsPoints} / {result.data.maxGoalsPoints}</span>
                </div>
                <div className="mt-2 flex justify-between border-t border-border pt-2 text-base text-foreground">
                  <span className="font-bold">Total ({result.data.system})</span>
                  <span className="font-bold">{result.data.totalPoints} / 100</span>
                </div>
              </div>
            )
          )}
          {!result.error && result.data && (
            <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
              The B-BBEE specific-goals points above use the common Treasury SBD 6.1 table - each buyer sets its own
              specific goals (reg 3(1)), so check the actual tender&apos;s own preference schedule before relying on this.
            </p>
          )}
        </div>

        <div className={CARD}>
          <div className="mb-2.5 text-[13px] font-bold text-foreground">B-BBEE status-level points table</div>
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[320px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3">Level</th>
                  <th className="py-1 pr-3">80/20 points</th>
                  <th className="py-1">90/10 points</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [1, 20, 10], [2, 18, 9], [3, 14, 7], [4, 12, 5], [5, 8, 4], [6, 6, 3], [7, 4, 2], [8, 2, 1],
                ].map(([lvl, p80, p90]) => (
                  <tr key={lvl} className="border-t border-border text-foreground">
                    <td className="py-1.5 pr-3">Level {lvl}</td>
                    <td className="py-1.5 pr-3">{p80}</td>
                    <td className="py-1.5">{p90}</td>
                  </tr>
                ))}
                <tr className="border-t border-border text-foreground">
                  <td className="py-1.5 pr-3">Non-compliant</td>
                  <td className="py-1.5 pr-3">0</td>
                  <td className="py-1.5">0</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <OtherTools except="/tools/bee-preference-points" />

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
          Source: Preferential Procurement Regulations, 2022 (GG 47452, Notice 2721 of 4 Nov 2022) regs 4-5 for the
          price-points formula and the R50 million threshold. Not legal advice.
        </p>
      </main>
    </div>
  );
}
