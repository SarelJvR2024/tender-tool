"use client";

import { useState } from "react";
import { saveSubcontractingPlan } from "./b7-actions";
import { B7_MAX_TES, B7_POLICY_MIN_PCT, B7_TBC_NAME, type SubcontractingPlan, type TargetedEnterprise } from "@/lib/sanralB7";

/**
 * The company's answer to SANRAL Form B7: either "we will subcontract" with
 * 1-4 Targeted Enterprises - the exact fields Form B7 asks per Targeted
 * Enterprise (TEND 1X rows 3906-3936) - or "this tender's Book 1 says B7 is
 * not required", quoting it. Nothing is pre-filled: every value is the
 * company's own. Saved as one JSON field via saveSubcontractingPlan(),
 * which re-validates server-side.
 */

type Row = {
  name: string;
  to_be_identified: boolean;
  size: "" | "EME" | "QSE";
  pct_of_contract: string;
  pct_excl_provisional: string;
  black_ownership_pct: string;
  bee_level: string;
  head_office: string;
  in_project_province: "" | "YES" | "NO";
  consulting_engineering_firm: "" | "YES" | "NO";
  tax_reference: string;
};

const EMPTY: Row = {
  name: "", to_be_identified: false, size: "", pct_of_contract: "", pct_excl_provisional: "", black_ownership_pct: "",
  bee_level: "", head_office: "", in_project_province: "", consulting_engineering_firm: "", tax_reference: "",
};

const s = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));
const toRow = (te: TargetedEnterprise): Row => ({
  name: te.name ?? "",
  to_be_identified: te.to_be_identified,
  size: te.size ?? "",
  pct_of_contract: s(te.pct_of_contract),
  pct_excl_provisional: s(te.pct_excl_provisional),
  black_ownership_pct: s(te.black_ownership_pct),
  bee_level: s(te.bee_level),
  head_office: te.head_office ?? "",
  in_project_province: te.in_project_province ?? "",
  consulting_engineering_firm: te.consulting_engineering_firm ?? "",
  tax_reference: te.tax_reference ?? "",
});

const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 38, padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 13, fontFamily: "inherit", background: "#FFFFFF", color: "#16233B" };
const label: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#16233B", fontWeight: 600, flex: "1 1 200px", minWidth: 0 };
const hint: React.CSSProperties = { fontSize: 11, color: "#6B6758", fontWeight: 400 };
const grid: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 };

export function SubcontractingPlanForm({ tenderId, initial }: { tenderId: string; initial: SubcontractingPlan | null }) {
  const [mode, setMode] = useState<"" | "subcontract" | "waived_by_tender">(initial?.mode ?? "");
  const [rows, setRows] = useState<Row[]>(
    initial?.mode === "subcontract" && initial.targeted_enterprises.length > 0 ? initial.targeted_enterprises.map(toRow) : [{ ...EMPTY }],
  );
  const [quote, setQuote] = useState(initial?.waiver_quote ?? "");
  const [comments, setComments] = useState(initial?.comments ?? "");

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const payload = JSON.stringify({
    mode,
    waiver_quote: quote,
    comments,
    targeted_enterprises: rows.map((r) => ({ ...r, size: r.size || null, in_project_province: r.in_project_province || null, consulting_engineering_firm: r.consulting_engineering_firm || null })),
  });
  const total = rows.reduce((t, r) => t + (Number(r.pct_excl_provisional.replace(",", ".")) || 0), 0);

  return (
    <form action={saveSubcontractingPlan}>
      <input type="hidden" name="tender_id" value={tenderId} />
      <input type="hidden" name="plan" value={payload} />

      <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 6 }}>
        <legend style={{ fontSize: 13, fontWeight: 700, color: "#16233B", marginBottom: 6 }}>Your answer for this tender</legend>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#16233B" }}>
          <input type="radio" name="b7_mode" checked={mode === "subcontract"} onChange={() => setMode("subcontract")} style={{ width: 18, height: 18, marginTop: 1 }} />
          We will subcontract to Targeted Enterprises (fill in Form B7)
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#16233B" }}>
          <input type="radio" name="b7_mode" checked={mode === "waived_by_tender"} onChange={() => setMode("waived_by_tender")} style={{ width: 18, height: 18, marginTop: 1 }} />
          This tender&apos;s Book 1 says Form B7 is not required
        </label>
      </fieldset>

      {mode === "waived_by_tender" && (
        <label style={{ ...label, marginBottom: 10 }}>
          Quote the Book 1 text (Form B7 page, or the Tender Data clause)
          <span style={hint}>e.g. &quot;No sub-contracting requirement for all Entities and submission of form B7 is not required for this project&quot; - it is printed on the pack&apos;s checklist as the reason B7 is left out.</span>
          <textarea value={quote} onChange={(e) => setQuote(e.target.value)} rows={3} required style={{ ...input, minHeight: 70 }} />
        </label>
      )}

      {mode === "subcontract" && (
        <>
          {rows.map((r, i) => (
            <div key={i} style={{ border: "1px solid #E5E1D5", borderRadius: 10, padding: "12px 14px", marginBottom: 10, background: "#F6F5F1" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B" }}>Targeted Enterprise {i + 1}</div>
                {rows.length > 1 && (
                  <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#B91C1C", fontSize: 12, cursor: "pointer", padding: 0 }}>
                    Remove
                  </button>
                )}
              </div>
              <div style={grid}>
                <label style={label}>
                  Name
                  <input value={r.to_be_identified ? B7_TBC_NAME : r.name} disabled={r.to_be_identified} onChange={(e) => set(i, { name: e.target.value })} style={{ ...input, color: r.to_be_identified ? "#6B6758" : "#16233B" }} />
                </label>
                <label style={{ ...label, flex: "0 1 auto", flexDirection: "row", alignItems: "center", fontWeight: 400, alignSelf: "flex-end", minHeight: 38 }}>
                  <input type="checkbox" checked={r.to_be_identified} onChange={(e) => set(i, { to_be_identified: e.target.checked })} style={{ width: 18, height: 18 }} />
                  Not named yet - to be identified after award
                </label>
              </div>
              <div style={grid}>
                <label style={label}>
                  EME or QSE
                  <select value={r.size} onChange={(e) => set(i, { size: e.target.value as Row["size"] })} style={input}>
                    <option value="">Choose…</option>
                    <option value="EME">EME</option>
                    <option value="QSE">QSE</option>
                  </select>
                </label>
                <label style={label}>
                  B-BBEE status level
                  <select value={r.bee_level} onChange={(e) => set(i, { bee_level: e.target.value })} style={input}>
                    <option value="">Choose…</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((l) => (
                      <option key={l} value={String(l)}>Level {l}</option>
                    ))}
                  </select>
                </label>
                <label style={label}>
                  % black ownership
                  <input inputMode="decimal" value={r.black_ownership_pct} onChange={(e) => set(i, { black_ownership_pct: e.target.value })} placeholder="e.g. 100" style={input} />
                </label>
              </div>
              <div style={grid}>
                <label style={label}>
                  % of contract price performed by it
                  <input inputMode="decimal" value={r.pct_of_contract} onChange={(e) => set(i, { pct_of_contract: e.target.value })} style={input} />
                </label>
                <label style={label}>
                  % of contract price excl. provisional &amp; prime-cost sums
                  <span style={hint}>Incl. site supervision staff. This is the % SANRAL counts towards the minimum.</span>
                  <input inputMode="decimal" value={r.pct_excl_provisional} onChange={(e) => set(i, { pct_excl_provisional: e.target.value })} style={input} />
                </label>
              </div>
              <div style={grid}>
                <label style={label}>
                  Head office and other offices (address, contact numbers)
                  <input value={r.head_office} onChange={(e) => set(i, { head_office: e.target.value })} style={input} />
                </label>
                <label style={label}>
                  SARS tax reference number
                  <input value={r.tax_reference} onChange={(e) => set(i, { tax_reference: e.target.value })} style={input} />
                </label>
              </div>
              <div style={{ ...grid, marginBottom: 0 }}>
                <label style={label}>
                  Based in the project&apos;s province?
                  <select value={r.in_project_province} onChange={(e) => set(i, { in_project_province: e.target.value as Row["in_project_province"] })} style={input}>
                    <option value="">Not answered</option>
                    <option value="YES">Yes (attach proof of address)</option>
                    <option value="NO">No</option>
                  </select>
                </label>
                <label style={label}>
                  A Consulting Engineering Firm (Conditions of Contract, Clause 1)?
                  <select value={r.consulting_engineering_firm} onChange={(e) => set(i, { consulting_engineering_firm: e.target.value as Row["consulting_engineering_firm"] })} style={input}>
                    <option value="">Not answered</option>
                    <option value="YES">Yes</option>
                    <option value="NO">No</option>
                  </select>
                </label>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            {rows.length < B7_MAX_TES ? (
              <button type="button" onClick={() => setRows((rs) => [...rs, { ...EMPTY }])} style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, background: "#FFFFFF", color: "#16233B", border: "1px solid #E5E1D5", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Add another Targeted Enterprise
              </button>
            ) : (
              <span style={{ fontSize: 12, color: "#6B6758" }}>Form B7 holds at most {B7_MAX_TES}.</span>
            )}
            <span style={{ fontSize: 12, color: total >= B7_POLICY_MIN_PCT ? "#15803D" : "#B45309", fontWeight: 600 }}>Total (excl. provisional sums): {Math.round(total * 100) / 100}%</span>
          </div>
          <label style={{ ...label, marginBottom: 10 }}>
            Comments (printed on Form B7)
            <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} style={{ ...input, minHeight: 56 }} />
          </label>
        </>
      )}

      {mode && (
        <button type="submit" style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}>
          Save Form B7 answer
        </button>
      )}
    </form>
  );
}
