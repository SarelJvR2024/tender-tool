"use client";

import { useMemo, useState } from "react";
import { PPR_2022_THRESHOLD_ZAR, calculatePreferencePoints, systemForValue, type BeeLevel } from "@/lib/preferencePoints";
import { ToolsHeader } from "../_components/ToolsHeader";

const CARD: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "20px 22px", boxSizing: "border-box" };
const LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#16233B", display: "block", marginBottom: 6 };
const INPUT: React.CSSProperties = { width: "100%", minHeight: 40, padding: "0 12px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 14, boxSizing: "border-box" };

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

export default function BeePreferencePointsPage() {
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
    <div style={{ minHeight: "100vh", background: "#F6F5F1", fontFamily: "system-ui, sans-serif" }}>
      <ToolsHeader />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px 64px", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 8px" }}>B-BBEE preference points calculator</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 24px", lineHeight: 1.5 }}>
          Implements the actual 80/20 and 90/10 price-points formulas from the Preferential Procurement Regulations,
          2022 (regs 4-5), plus the standard B-BBEE status-level specific-goals table most organs of state publish
          (Treasury&apos;s SBD 6.1).
        </p>

        <div style={{ ...CARD, marginBottom: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={LABEL} htmlFor="cv">Contract/tender value (Rand, incl. VAT)</label>
            <input id="cv" type="number" min={0} value={contractValue} onChange={(e) => setContractValue(e.target.value)} style={INPUT} />
            {defaultSystem && (
              <p style={{ fontSize: 11, color: "#6B6758", marginTop: 6 }}>
                {`R50 million threshold -> defaults to the ${defaultSystem} system for this value.`}
              </p>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={LABEL} htmlFor="system">Preference point system</label>
            <select id="system" value={systemOverride} onChange={(e) => setSystemOverride(e.target.value as "auto" | "80/20" | "90/10")} style={INPUT}>
              <option value="auto">Automatic (from contract value)</option>
              <option value="80/20">80/20 (force)</option>
              <option value="90/10">90/10 (force)</option>
            </select>
            <p style={{ fontSize: 11, color: "#6B6758", marginTop: 6 }}>
              A buyer must state the system on the tender itself (reg 3(1)) - override here when the document says so,
              rather than relying on the R{PPR_2022_THRESHOLD_ZAR.toLocaleString("en-ZA")} default.
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={LABEL} htmlFor="tp">Your tendered price (Rand)</label>
            <input id="tp" type="number" min={0} value={tenderPrice} onChange={(e) => setTenderPrice(e.target.value)} style={INPUT} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={LABEL} htmlFor="lp">Lowest acceptable tender price, Pmin (Rand)</label>
            <input id="lp" type="number" min={0} value={lowestPrice} onChange={(e) => setLowestPrice(e.target.value)} style={INPUT} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={LABEL} htmlFor="level">Your B-BBEE status level</label>
            <select id="level" value={level} onChange={(e) => setLevel(e.target.value)} style={INPUT}>
              {LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {result.error ? (
            <p style={{ color: "#B91C1C", fontSize: 13 }}>{result.error}</p>
          ) : (
            result.data && (
              <div style={{ background: "#F6F5F1", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#16233B", padding: "4px 0" }}>
                  <span>Price points (Ps)</span>
                  <span style={{ fontWeight: 700 }}>{result.data.pricePoints} / {result.data.maxPricePoints}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#16233B", padding: "4px 0" }}>
                  <span>B-BBEE specific-goals points</span>
                  <span style={{ fontWeight: 700 }}>{result.data.beeGoalsPoints} / {result.data.maxGoalsPoints}</span>
                </div>
                <div style={{ borderTop: "1px solid #E5E1D5", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 16, color: "#16233B" }}>
                  <span style={{ fontWeight: 700 }}>Total ({result.data.system})</span>
                  <span style={{ fontWeight: 700 }}>{result.data.totalPoints} / 100</span>
                </div>
              </div>
            )
          )}
        </div>

        <div style={CARD}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B", marginBottom: 10 }}>B-BBEE status-level points table</div>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#6B6758" }}>
                <th style={{ padding: "4px 0" }}>Level</th>
                <th style={{ padding: "4px 0" }}>80/20 points</th>
                <th style={{ padding: "4px 0" }}>90/10 points</th>
              </tr>
            </thead>
            <tbody>
              {[
                [1, 20, 10], [2, 18, 9], [3, 14, 7], [4, 12, 5], [5, 8, 4], [6, 6, 3], [7, 4, 2], [8, 2, 1],
              ].map(([lvl, p80, p90]) => (
                <tr key={lvl} style={{ borderTop: "1px solid #F0EEE6" }}>
                  <td style={{ padding: "6px 0" }}>Level {lvl}</td>
                  <td style={{ padding: "6px 0" }}>{p80}</td>
                  <td style={{ padding: "6px 0" }}>{p90}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "1px solid #F0EEE6" }}>
                <td style={{ padding: "6px 0" }}>Non-compliant</td>
                <td style={{ padding: "6px 0" }}>0</td>
                <td style={{ padding: "6px 0" }}>0</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: 11, color: "#6B6758", marginTop: 24, lineHeight: 1.5 }}>
          Source: Preferential Procurement Regulations, 2022 (GG 47452, Notice 2721 of 4 Nov 2022) regs 4-5 for the
          price-points formula and the R50 million threshold. The PPR 2022 itself sets no fixed B-BBEE points table -
          each organ of state defines its own specific goals (reg 3(1)) - so the level table above is the common
          Treasury SBD 6.1 table most buyers (including SANRAL) publish unchanged, not a legal guarantee for every
          tender. Always check the actual tender document&apos;s own SBD 6.1/preference schedule. Not legal advice.
        </p>
      </main>
    </div>
  );
}
