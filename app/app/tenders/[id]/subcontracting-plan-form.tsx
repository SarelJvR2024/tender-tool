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

const inputClass = "box-border w-full min-h-[38px] rounded-lg border border-border bg-card px-2.5 py-2 font-sans text-[13px] text-foreground";
const labelClass = "flex min-w-0 flex-[1_1_200px] flex-col gap-1 text-xs font-semibold text-foreground";
const hintClass = "text-[11px] font-normal text-muted-foreground";
const gridClass = "flex flex-wrap gap-2.5";

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

      <fieldset className="m-0 mb-3 flex flex-col gap-1.5 border-none p-0">
        <legend className="mb-1.5 text-[13px] font-bold text-foreground">Your answer for this tender</legend>
        <label className="flex items-start gap-2 text-[13px] text-foreground">
          <input type="radio" name="b7_mode" checked={mode === "subcontract"} onChange={() => setMode("subcontract")} className="mt-px size-[18px]" />
          We will subcontract to Targeted Enterprises (fill in Form B7)
        </label>
        <label className="flex items-start gap-2 text-[13px] text-foreground">
          <input type="radio" name="b7_mode" checked={mode === "waived_by_tender"} onChange={() => setMode("waived_by_tender")} className="mt-px size-[18px]" />
          This tender&apos;s Book 1 says Form B7 is not required
        </label>
      </fieldset>

      {mode === "waived_by_tender" && (
        <label className={`${labelClass} mb-2.5`}>
          Quote the Book 1 text (Form B7 page, or the Tender Data clause)
          <span className={hintClass}>e.g. &quot;No sub-contracting requirement for all Entities and submission of form B7 is not required for this project&quot; - it is printed on the pack&apos;s checklist as the reason B7 is left out.</span>
          <textarea value={quote} onChange={(e) => setQuote(e.target.value)} rows={3} required className={`${inputClass} min-h-[70px]`} />
        </label>
      )}

      {mode === "subcontract" && (
        <>
          {rows.map((r, i) => (
            <div key={i} className="mb-2.5 rounded-[10px] border border-border bg-card px-3.5 py-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[13px] font-bold text-foreground">Targeted Enterprise {i + 1}</div>
                {rows.length > 1 && (
                  <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="cursor-pointer border-none bg-transparent p-0 text-xs text-destructive">
                    Remove
                  </button>
                )}
              </div>
              <div className={gridClass}>
                <label className={labelClass}>
                  Name
                  <input value={r.to_be_identified ? B7_TBC_NAME : r.name} disabled={r.to_be_identified} onChange={(e) => set(i, { name: e.target.value })} className={`${inputClass} ${r.to_be_identified ? "text-muted-foreground" : "text-foreground"}`} />
                </label>
                <label className={`${labelClass} min-h-[38px] flex-[0_1_auto] flex-row items-center self-end font-normal`}>
                  <input type="checkbox" checked={r.to_be_identified} onChange={(e) => set(i, { to_be_identified: e.target.checked })} className="size-[18px]" />
                  Not named yet - to be identified after award
                </label>
              </div>
              <div className={gridClass}>
                <label className={labelClass}>
                  EME or QSE
                  <select value={r.size} onChange={(e) => set(i, { size: e.target.value as Row["size"] })} className={inputClass}>
                    <option value="">Choose…</option>
                    <option value="EME">EME</option>
                    <option value="QSE">QSE</option>
                  </select>
                </label>
                <label className={labelClass}>
                  B-BBEE status level
                  <select value={r.bee_level} onChange={(e) => set(i, { bee_level: e.target.value })} className={inputClass}>
                    <option value="">Choose…</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((l) => (
                      <option key={l} value={String(l)}>Level {l}</option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  % black ownership
                  <input inputMode="decimal" value={r.black_ownership_pct} onChange={(e) => set(i, { black_ownership_pct: e.target.value })} placeholder="e.g. 100" className={inputClass} />
                </label>
              </div>
              <div className={gridClass}>
                <label className={labelClass}>
                  % of contract price performed by it
                  <input inputMode="decimal" value={r.pct_of_contract} onChange={(e) => set(i, { pct_of_contract: e.target.value })} className={inputClass} />
                </label>
                <label className={labelClass}>
                  % of contract price excl. provisional &amp; prime-cost sums
                  <span className={hintClass}>Incl. site supervision staff. This is the % SANRAL counts towards the minimum.</span>
                  <input inputMode="decimal" value={r.pct_excl_provisional} onChange={(e) => set(i, { pct_excl_provisional: e.target.value })} className={inputClass} />
                </label>
              </div>
              <div className={gridClass}>
                <label className={labelClass}>
                  Head office and other offices (address, contact numbers)
                  <input value={r.head_office} onChange={(e) => set(i, { head_office: e.target.value })} className={inputClass} />
                </label>
                <label className={labelClass}>
                  SARS tax reference number
                  <input value={r.tax_reference} onChange={(e) => set(i, { tax_reference: e.target.value })} className={inputClass} />
                </label>
              </div>
              <div className={`${gridClass} mb-0`}>
                <label className={labelClass}>
                  Based in the project&apos;s province?
                  <select value={r.in_project_province} onChange={(e) => set(i, { in_project_province: e.target.value as Row["in_project_province"] })} className={inputClass}>
                    <option value="">Not answered</option>
                    <option value="YES">Yes (attach proof of address)</option>
                    <option value="NO">No</option>
                  </select>
                </label>
                <label className={labelClass}>
                  A Consulting Engineering Firm (Conditions of Contract, Clause 1)?
                  <select value={r.consulting_engineering_firm} onChange={(e) => set(i, { consulting_engineering_firm: e.target.value as Row["consulting_engineering_firm"] })} className={inputClass}>
                    <option value="">Not answered</option>
                    <option value="YES">Yes</option>
                    <option value="NO">No</option>
                  </select>
                </label>
              </div>
            </div>
          ))}
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2.5">
            {rows.length < B7_MAX_TES ? (
              <button type="button" onClick={() => setRows((rs) => [...rs, { ...EMPTY }])} className="min-h-9 cursor-pointer rounded-lg border border-border bg-card px-3.5 text-xs font-semibold text-foreground">
                Add another Targeted Enterprise
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">Form B7 holds at most {B7_MAX_TES}.</span>
            )}
            <span className={`text-xs font-semibold ${total >= B7_POLICY_MIN_PCT ? "text-success" : "text-warning"}`}>Total (excl. provisional sums): {Math.round(total * 100) / 100}%</span>
          </div>
          <label className={`${labelClass} mb-2.5`}>
            Comments (printed on Form B7)
            <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} className={`${inputClass} min-h-[56px]`} />
          </label>
        </>
      )}

      {mode && (
        <button type="submit" className="min-h-10 cursor-pointer rounded-lg border-none bg-foreground px-4 text-sm font-semibold text-white">
          Save Form B7 answer
        </button>
      )}
    </form>
  );
}
