"use client";

import { useMemo, useState } from "react";
import { estimateSanralConventional, type Range, type SanralPositionInput, type SanralProject } from "@/lib/sanralScoring";
import { CLIENT_POINTS, PROJECT_TYPE_MATRICES, SANRAL_POSITION_CODES, baseCode, matrixForPosition } from "@/lib/sanralMatrices";
import { OtherTools, ToolsHeader } from "../_components/ToolsHeader";

const CARD: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "20px 22px", boxSizing: "border-box" };
const LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#16233B", display: "block", marginBottom: 6 };
const INPUT: React.CSSProperties = { width: "100%", minHeight: 40, padding: "0 12px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 14, boxSizing: "border-box" };
const SUBCARD: React.CSSProperties = { background: "#F6F5F1", borderRadius: 10, padding: "14px 16px", marginBottom: 12 };

const CLIENT_TYPES = Object.keys(CLIENT_POINTS);
const MAX_PROJECTS = 3;

function rangeLabel(r: Range): string {
  return r.min === r.max ? `${r.min}` : `${r.min}-${r.max}`;
}

type ProjectDraft = { clientType: string; experienceType: string; startDate: string; endDate: string };

function emptyProject(): ProjectDraft {
  return { clientType: "", experienceType: "", startDate: "", endDate: "" };
}

export default function B6EstimatorClient() {
  const [positionCode, setPositionCode] = useState("PL");
  const [specialism, setSpecialism] = useState("");
  const [managerial, setManagerial] = useState(false);
  const [closingDate, setClosingDate] = useState("");
  const [qualitySystem, setQualitySystem] = useState<"iso" | "registered" | "in_house" | "none" | "">("");
  const [projects, setProjects] = useState<ProjectDraft[]>([emptyProject()]);

  const matrixKey = matrixForPosition(positionCode, specialism || null);
  const matrix = matrixKey ? PROJECT_TYPE_MATRICES[matrixKey] : null;
  const experienceTypes = matrix ? Object.keys(matrix.rows).filter((k) => k !== "NONE") : [];
  const isDesignSpecialist = baseCode(positionCode) === "DS";

  function updateProject(i: number, patch: Partial<ProjectDraft>) {
    setProjects((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  const estimate = useMemo(() => {
    if (!closingDate) return null;
    const usedProjects = projects.filter((p) => p.clientType || p.experienceType || p.startDate || p.endDate);
    const sanralProjects: SanralProject[] = usedProjects.map((p) => ({
      client_type: p.clientType || null,
      project_type: p.experienceType || null,
      position_code: positionCode,
      start_date: p.startDate || null,
      end_date: p.endDate || null,
    }));
    const position: SanralPositionInput = {
      positionCode,
      description: isDesignSpecialist ? specialism || null : null,
      managerial,
      tenderProjectType: null,
      person: sanralProjects.length > 0 ? { name: "You", projects: sanralProjects } : null,
    };
    return estimateSanralConventional({
      positions: [position],
      closingDate,
      qualitySystem: qualitySystem || null,
    });
  }, [closingDate, projects, positionCode, specialism, managerial, isDesignSpecialist, qualitySystem]);

  return (
    <div style={{ minHeight: "100vh", background: "#F6F5F1", fontFamily: "system-ui, sans-serif" }}>
      <ToolsHeader />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px 64px", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 8px" }}>SANRAL B6 functionality score estimator</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 24px", lineHeight: 1.5 }}>
          Estimates your likely functionality score for one SANRAL Conventional Consultant key position, using the
          real published scoring matrices (Book 1 Annexure A) - the same logic Tender Tool runs on a live tender.
          Nothing here is guessed: every component you don&apos;t give evidence for is shown as an honest range, not
          a single made-up number.
        </p>

        <div style={{ ...CARD, marginBottom: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={LABEL} htmlFor="position">Position you&apos;d be tendered for</label>
            <select id="position" value={positionCode} onChange={(e) => setPositionCode(e.target.value)} style={INPUT}>
              {SANRAL_POSITION_CODES.filter((c) => c.code !== "Undefined").map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} - {c.label}
                </option>
              ))}
            </select>
          </div>

          {isDesignSpecialist && (
            <div style={{ marginBottom: 16 }}>
              <label style={LABEL} htmlFor="specialism">Design specialism (e.g. &quot;Pavement and Materials&quot;, &quot;Structures&quot;)</label>
              <input id="specialism" type="text" value={specialism} onChange={(e) => setSpecialism(e.target.value)} style={INPUT} placeholder="Pavement and Materials" />
              {!matrix && specialism && (
                <p style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>
                  Book 1 doesn&apos;t publish a project-type matrix matching that description - project-type points will show as a 0-5 range.
                </p>
              )}
            </div>
          )}

          <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <input id="managerial" type="checkbox" checked={managerial} onChange={(e) => setManagerial(e.target.checked)} style={{ width: 16, height: 16 }} />
            <label htmlFor="managerial" style={{ fontSize: 13, color: "#16233B" }}>SANRAL treats this position as managerial on this tender</label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={LABEL} htmlFor="closing">Tender closing date</label>
            <input id="closing" type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} style={INPUT} />
            <p style={{ fontSize: 11, color: "#6B6758", marginTop: 6 }}>Needed to work out how recent each project is (Book 1&apos;s 10/15-year relevance rule).</p>
          </div>

          <div style={{ marginBottom: 4 }}>
            <label style={LABEL} htmlFor="qs">Quality system (Form B4)</label>
            <select id="qs" value={qualitySystem} onChange={(e) => setQualitySystem(e.target.value as typeof qualitySystem)} style={INPUT}>
              <option value="">Not sure / don&apos;t have evidence yet</option>
              <option value="iso">ISO-certified</option>
              <option value="registered">ISO submitted for registration</option>
              <option value="in_house">In-house QMS</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>

        <div style={{ ...CARD, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B", marginBottom: 4 }}>This person&apos;s most relevant past projects</div>
          <p style={{ fontSize: 12, color: "#6B6758", marginBottom: 14 }}>Form B1 counts up to 5; add up to {MAX_PROJECTS} here for a quick estimate.</p>

          {projects.map((p, i) => (
            <div key={i} style={SUBCARD}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#16233B", marginBottom: 10 }}>Project {i + 1}</div>

              <div style={{ marginBottom: 10 }}>
                <label style={LABEL} htmlFor={`client-${i}`}>Client type</label>
                <select id={`client-${i}`} value={p.clientType} onChange={(e) => updateProject(i, { clientType: e.target.value })} style={INPUT}>
                  <option value="">Not sure</option>
                  {CLIENT_TYPES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={LABEL} htmlFor={`type-${i}`}>Type of work on this project</label>
                {experienceTypes.length > 0 ? (
                  <select id={`type-${i}`} value={p.experienceType} onChange={(e) => updateProject(i, { experienceType: e.target.value })} style={INPUT}>
                    <option value="">Not sure</option>
                    {experienceTypes.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                ) : (
                  <input id={`type-${i}`} type="text" value={p.experienceType} onChange={(e) => updateProject(i, { experienceType: e.target.value })} style={INPUT} placeholder="Pick a position above to see Book 1's own project-type list" />
                )}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={LABEL} htmlFor={`start-${i}`}>Start date</label>
                  <input id={`start-${i}`} type="date" value={p.startDate} onChange={(e) => updateProject(i, { startDate: e.target.value })} style={INPUT} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={LABEL} htmlFor={`end-${i}`}>End date (blank if ongoing)</label>
                  <input id={`end-${i}`} type="date" value={p.endDate} onChange={(e) => updateProject(i, { endDate: e.target.value })} style={INPUT} />
                </div>
              </div>
            </div>
          ))}

          {projects.length < MAX_PROJECTS && (
            <button
              type="button"
              onClick={() => setProjects((prev) => [...prev, emptyProject()])}
              style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, border: "1px solid #16233B", background: "#FFFFFF", color: "#16233B", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              + Add another project
            </button>
          )}
        </div>

        {!closingDate ? (
          <div style={CARD}>
            <p style={{ fontSize: 13, color: "#6B6758", margin: 0 }}>Pick a tender closing date above to see your estimate.</p>
          </div>
        ) : estimate ? (
          <div style={CARD}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B", marginBottom: 14 }}>Estimated functionality score</div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#16233B", padding: "6px 0", borderBottom: "1px solid #F0EEE6" }}>
              <span>Technical (key person)</span>
              <span style={{ fontWeight: 700 }}>{rangeLabel(estimate.technical)} / 30</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#16233B", padding: "6px 0", borderBottom: "1px solid #F0EEE6" }}>
              <span>Management (key person)</span>
              <span style={{ fontWeight: 700 }}>{rangeLabel(estimate.management)} / 15</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#16233B", padding: "6px 0", borderBottom: "1px solid #F0EEE6" }}>
              <span>Quality system (Form B4)</span>
              <span style={{ fontWeight: 700 }}>{rangeLabel(estimate.qualitySystem)} / 10</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#16233B", padding: "6px 0", borderBottom: "1px solid #F0EEE6" }}>
              <span>Past performance (Form B6)</span>
              <span style={{ fontWeight: 700 }}>{rangeLabel(estimate.pastPerformance)} / 15</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#16233B", padding: "6px 0" }}>
              <span>Workplan appropriateness (Form C2.4)</span>
              <span style={{ fontWeight: 700 }}>{rangeLabel(estimate.workplan)} / 30</span>
            </div>

            <div style={{ background: "#F6F5F1", borderRadius: 8, padding: "14px 16px", marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16 }}>
                <span style={{ fontWeight: 700, color: "#16233B" }}>Total</span>
                <span style={{ fontWeight: 700, color: "#16233B" }}>{rangeLabel(estimate.total)} / 100</span>
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  color: estimate.outlook === "clears" ? "#15803D" : estimate.outlook === "cannot_clear" ? "#B91C1C" : "#B45309",
                }}
              >
                {estimate.outlookText}
              </div>
            </div>

            {estimate.notes.length > 0 && (
              <ul style={{ margin: "14px 0 0", padding: "0 0 0 18px", fontSize: 12, color: "#6B6758", lineHeight: 1.6 }}>
                {estimate.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <OtherTools except="/tools/b6-estimator" />

        <p style={{ fontSize: 11, color: "#6B6758", marginTop: 24, lineHeight: 1.5 }}>
          Source: SANRAL R.396-010-2025/1F Book 1, Tender Data C.3.11 Stage 3 and Annexure A (the published consultant
          tender evaluation scoring for Conventional projects) - the one SANRAL evaluation method detailed enough to
          estimate before closing. This estimates ONE key position; a real tender scores every key position and
          averages across them. Workplan appropriateness (30 pts) depends on every other bidder&apos;s hours and is
          always shown as the full range. Not a submission, not legal or technical advice, and not SANRAL&apos;s own
          scoring tool.
        </p>
      </main>
    </div>
  );
}
