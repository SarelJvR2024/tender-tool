"use client";

import { useMemo, useState } from "react";
import { CIDB_CLASSES_OF_WORK, CIDB_GRADING_TABLE, requiredGradeForValue } from "@/lib/cidbGrading";
import { OtherTools, ToolsHeader } from "../_components/ToolsHeader";

// Design-system migration (2026-10-21): was raw inline-CSSProperties with
// hardcoded hex (navy #16233B, muted #5B6472, border #E3E6EA, red #B91C1C,
// green #15803D, amber #D97706) - now Tailwind + tokens. The two status
// colors carry real semantic meaning and are mapped by meaning, not 1:1 hex
// swap: "sufficient" -> text-success, "not suffiencient"/invalid input ->
// text-destructive. The grading table's "this is the row you need" highlight
// isn't a pass/fail verdict (the fail case is the whole "not sufficient"
// sentence above it, already destructive) - it's a plain callout, so it
// reads text-accent, the one highlight color this system reserves for
// exactly that job. Inputs/selects bumped to min-h-11 (44px touch target).
const CARD = "rounded-xl border border-border bg-card p-5";
const LABEL = "mb-1.5 block text-xs font-semibold text-foreground";
const INPUT = "min-h-11 w-full rounded-lg border border-border px-3 text-sm";

// A plain `n.toLocaleString("en-ZA")` caused a real, reproducible hydration
// mismatch: this page is static-prerendered (built once on the server),
// and Node's own ICU data formats "en-ZA" with a comma ("R200,000") while
// every browser's full ICU data formats it with the correct SA
// space-separated grouping ("R200 000") - so React discarded and
// re-rendered the whole tree on first load. Formatting the space-separated
// grouping by hand sidesteps the server/client ICU disagreement entirely.
function formatZar(n: number): string {
  return "R" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// `embedded` (spec v3 O03): see DeadlineCalculatorClient's own comment -
// same shared-component pattern, so the signed-in /toolkit route and the
// public /tools page can never calculate different answers.
export default function CidbGradeClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [value, setValue] = useState<string>("9000000");
  const [classOfWork, setClassOfWork] = useState("CE");
  const [heldGrade, setHeldGrade] = useState<string>("");

  const numericValue = Number(value);
  const required = useMemo(
    () => (Number.isFinite(numericValue) ? requiredGradeForValue(numericValue) : null),
    [numericValue]
  );
  const heldGradeNum = heldGrade === "" ? null : Number(heldGrade);
  const sufficient = heldGradeNum !== null && required !== null ? heldGradeNum >= required : null;

  const body = (
    <>
      {!embedded && <h1 className="mb-2 font-display text-[22px] font-bold text-foreground">CIDB grade calculator</h1>}
      <p className="mb-6 text-[13px] leading-relaxed text-muted-foreground">
        Looks up the CIDB (Construction Industry Development Board) contractor grade a tender&apos;s value requires. The
        grade-to-value bands are the same for every class of construction work (GB, CE, EB, EP, ME, SB, SC) - only
        the grade you actually hold in a given class differs.
      </p>

      <div className={`${CARD} mb-5`}>
        <div className="mb-4">
          <label className={LABEL} htmlFor="value">Contract/tender value (Rand, incl. VAT)</label>
          <input id="value" type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} className={INPUT} />
        </div>

        <div className="mb-4">
          <label className={LABEL} htmlFor="class">Class of construction work</label>
          <select id="class" value={classOfWork} onChange={(e) => setClassOfWork(e.target.value)} className={INPUT}>
            {CIDB_CLASSES_OF_WORK.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} - {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className={LABEL} htmlFor="held">Grade you hold in this class (optional)</label>
          <select id="held" value={heldGrade} onChange={(e) => setHeldGrade(e.target.value)} className={INPUT}>
            <option value="">- not sure / don&apos;t have one -</option>
            {CIDB_GRADING_TABLE.map((b) => (
              <option key={b.grade} value={b.grade}>
                Grade {b.grade}{classOfWork}
              </option>
            ))}
          </select>
        </div>

        {required === null ? (
          <p className="text-[13px] text-destructive">Enter a valid, non-negative contract value.</p>
        ) : (
          <div className="rounded-lg bg-card px-4 py-3.5">
            <div className="mb-1 text-xs text-muted-foreground">Minimum grade required</div>
            <div className="text-xl font-bold text-foreground">
              Grade {required}{classOfWork}
            </div>
            {heldGradeNum !== null && (
              <div className={`mt-2.5 text-[13px] font-semibold ${sufficient ? "text-success" : "text-destructive"}`}>
                {sufficient
                  ? `Grade ${heldGradeNum}${classOfWork} is sufficient to tender for this contract.`
                  : `Grade ${heldGradeNum}${classOfWork} is not sufficient - this contract needs at least Grade ${required}${classOfWork}.`}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={CARD}>
        <div className="mb-2.5 text-[13px] font-bold text-foreground">CIDB grading table</div>
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[320px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3">Grade</th>
                <th className="py-1">Tender value range</th>
              </tr>
            </thead>
            <tbody>
              {CIDB_GRADING_TABLE.map((b) => {
                const isRequired = required === b.grade;
                return (
                  <tr
                    key={b.grade}
                    className={`border-t border-border ${isRequired ? "font-bold text-accent" : "font-normal text-foreground"}`}
                  >
                    <td className="py-1.5 pr-3">{b.grade}</td>
                    <td className="py-1.5 whitespace-nowrap">
                      {formatZar(b.minValue)} {b.maxValue === null ? "and above" : `- ${formatZar(b.maxValue)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!embedded && <OtherTools except="/tools/cidb-grade" />}

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        Source: cidb Standard for Contractor Grading Designation (Construction Industry Development Board Act 38 of
        2000, Regulations) - the published Register of Contractors grading-vs-value table. This tool answers
        &quot;what grade does a contract of this value require&quot;; it does not calculate what grade your own
        track record would earn you (the &quot;potential grading&quot; rules in reg 11/17) - that&apos;s a CIDB
        Register of Contractors application.
      </p>
    </>
  );

  if (embedded) {
    return <div className="mx-auto w-full max-w-[640px]">{body}</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <ToolsHeader />
      <main className="mx-auto max-w-[640px] px-4 pt-8 pb-16">{body}</main>
    </div>
  );
}
