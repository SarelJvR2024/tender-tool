"use client";

import { useMemo, useState } from "react";
import { CIDB_CLASSES_OF_WORK, CIDB_GRADING_TABLE, requiredGradeForValue } from "@/lib/cidbGrading";
import { OtherTools, ToolsHeader } from "../_components/ToolsHeader";

const CARD: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "20px 22px", boxSizing: "border-box" };
const LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#16233B", display: "block", marginBottom: 6 };
const INPUT: React.CSSProperties = { width: "100%", minHeight: 40, padding: "0 12px", borderRadius: 8, border: "1px solid #E3E6EA", fontSize: 14, boxSizing: "border-box" };

function formatZar(n: number): string {
  return "R" + n.toLocaleString("en-ZA");
}

export default function CidbGradeClient() {
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

  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", fontFamily: "system-ui, sans-serif" }}>
      <ToolsHeader />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px 64px", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 8px" }}>CIDB grade calculator</h1>
        <p style={{ fontSize: 13, color: "#5B6472", margin: "0 0 24px", lineHeight: 1.5 }}>
          Looks up the CIDB (Construction Industry Development Board) contractor grade a tender&apos;s value requires. The
          grade-to-value bands are the same for every class of construction work (GB, CE, EB, EP, ME, SB, SC) - only
          the grade you actually hold in a given class differs.
        </p>

        <div style={{ ...CARD, marginBottom: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={LABEL} htmlFor="value">Contract/tender value (Rand, incl. VAT)</label>
            <input id="value" type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} style={INPUT} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={LABEL} htmlFor="class">Class of construction work</label>
            <select id="class" value={classOfWork} onChange={(e) => setClassOfWork(e.target.value)} style={INPUT}>
              {CIDB_CLASSES_OF_WORK.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} - {c.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={LABEL} htmlFor="held">Grade you hold in this class (optional)</label>
            <select id="held" value={heldGrade} onChange={(e) => setHeldGrade(e.target.value)} style={INPUT}>
              <option value="">- not sure / don&apos;t have one -</option>
              {CIDB_GRADING_TABLE.map((b) => (
                <option key={b.grade} value={b.grade}>
                  Grade {b.grade}{classOfWork}
                </option>
              ))}
            </select>
          </div>

          {required === null ? (
            <p style={{ color: "#B91C1C", fontSize: 13 }}>Enter a valid, non-negative contract value.</p>
          ) : (
            <div style={{ background: "#FFFFFF", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 4 }}>Minimum grade required</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#16233B" }}>
                Grade {required}{classOfWork}
              </div>
              {heldGradeNum !== null && (
                <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: sufficient ? "#15803D" : "#B91C1C" }}>
                  {sufficient
                    ? `Grade ${heldGradeNum}${classOfWork} is sufficient to tender for this contract.`
                    : `Grade ${heldGradeNum}${classOfWork} is not sufficient - this contract needs at least Grade ${required}${classOfWork}.`}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={CARD}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B", marginBottom: 10 }}>CIDB grading table</div>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#5B6472" }}>
                <th style={{ padding: "4px 0" }}>Grade</th>
                <th style={{ padding: "4px 0" }}>Tender value range</th>
              </tr>
            </thead>
            <tbody>
              {CIDB_GRADING_TABLE.map((b) => {
                const isRequired = required === b.grade;
                return (
                  <tr key={b.grade} style={{ borderTop: "1px solid #ECEEF1", fontWeight: isRequired ? 700 : 400, color: isRequired ? "#D97706" : "#16233B" }}>
                    <td style={{ padding: "6px 0" }}>{b.grade}</td>
                    <td style={{ padding: "6px 0" }}>
                      {formatZar(b.minValue)} {b.maxValue === null ? "and above" : `- ${formatZar(b.maxValue)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <OtherTools except="/tools/cidb-grade" />

        <p style={{ fontSize: 11, color: "#5B6472", marginTop: 24, lineHeight: 1.5 }}>
          Source: cidb Standard for Contractor Grading Designation (Construction Industry Development Board Act 38 of
          2000, Regulations) - the published Register of Contractors grading-vs-value table. This tool answers
          &quot;what grade does a contract of this value require&quot;; it does not calculate what grade your own
          track record would earn you (the &quot;potential grading&quot; rules in reg 11/17) - that&apos;s a CIDB
          Register of Contractors application.
        </p>
      </main>
    </div>
  );
}
