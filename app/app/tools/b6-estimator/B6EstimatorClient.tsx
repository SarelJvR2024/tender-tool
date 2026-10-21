"use client";

import { useMemo, useState } from "react";
import { estimateSanralConventional, type Range, type SanralPositionInput, type SanralProject } from "@/lib/sanralScoring";
import { CLIENT_POINTS, PROJECT_TYPE_MATRICES, SANRAL_POSITION_CODES, baseCode, matrixForPosition } from "@/lib/sanralMatrices";
import { OtherTools, ToolsHeader } from "../_components/ToolsHeader";

// Design-system migration (2026-10-21): raw inline-CSSProperties ->
// Tailwind + tokens. The outlook line is a real 3-way verdict (clears /
// borderline / cannot clear), mapped by meaning: "clears" -> text-success,
// "cannot_clear" -> text-destructive, the in-between "possible" case ->
// text-warning (same amber used for the matrix-not-found note, which is
// also a real warning, not an error). Per-project subcards gained a border
// (bg-card alone gave no visual separation against the outer card, also
// white) so the project list reads as distinct rows on a phone.
const CARD = "rounded-xl border border-border bg-card p-5";
const LABEL = "mb-1.5 block text-xs font-semibold text-foreground";
const INPUT = "min-h-11 w-full rounded-lg border border-border px-3 text-sm";
const SUBCARD = "mb-3 rounded-lg border border-border bg-card px-4 py-3.5";

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

  const outlookTone =
    estimate?.outlook === "clears" ? "text-success" : estimate?.outlook === "cannot_clear" ? "text-destructive" : "text-warning";

  return (
    <div className="min-h-screen bg-background">
      <ToolsHeader />

      <main className="mx-auto max-w-[640px] px-4 pt-8 pb-16">
        <h1 className="mb-2 font-display text-[22px] font-bold text-foreground">SANRAL B6 functionality score estimator</h1>
        <p className="mb-6 text-[13px] leading-relaxed text-muted-foreground">
          Estimates your likely functionality score for one SANRAL Conventional Consultant key position, using the
          real published scoring matrices (Book 1 Annexure A) - the same logic Tender Ready runs on a live tender.
          Nothing here is guessed: every component you don&apos;t give evidence for is shown as an honest range, not
          a single made-up number.
        </p>

        <div className={`${CARD} mb-5`}>
          <div className="mb-4">
            <label className={LABEL} htmlFor="position">Position you&apos;d be tendered for</label>
            <select id="position" value={positionCode} onChange={(e) => setPositionCode(e.target.value)} className={INPUT}>
              {SANRAL_POSITION_CODES.filter((c) => c.code !== "Undefined").map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} - {c.label}
                </option>
              ))}
            </select>
          </div>

          {isDesignSpecialist && (
            <div className="mb-4">
              <label className={LABEL} htmlFor="specialism">Design specialism (e.g. &quot;Pavement and Materials&quot;, &quot;Structures&quot;)</label>
              <input id="specialism" type="text" value={specialism} onChange={(e) => setSpecialism(e.target.value)} className={INPUT} placeholder="Pavement and Materials" />
              {!matrix && specialism && (
                <p className="mt-1.5 text-[11px] text-warning">
                  Book 1 doesn&apos;t publish a project-type matrix matching that description - project-type points will show as a 0-5 range.
                </p>
              )}
            </div>
          )}

          <div className="mb-4 flex min-h-11 items-center gap-2">
            <input id="managerial" type="checkbox" checked={managerial} onChange={(e) => setManagerial(e.target.checked)} className="size-5" />
            <label htmlFor="managerial" className="text-[13px] text-foreground">SANRAL treats this position as managerial on this tender</label>
          </div>

          <div className="mb-4">
            <label className={LABEL} htmlFor="closing">Tender closing date</label>
            <input id="closing" type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} className={INPUT} />
            <p className="mt-1.5 text-[11px] text-muted-foreground">Needed to work out how recent each project is (Book 1&apos;s 10/15-year relevance rule).</p>
          </div>

          <div>
            <label className={LABEL} htmlFor="qs">Quality system (Form B4)</label>
            <select id="qs" value={qualitySystem} onChange={(e) => setQualitySystem(e.target.value as typeof qualitySystem)} className={INPUT}>
              <option value="">Not sure / don&apos;t have evidence yet</option>
              <option value="iso">ISO-certified</option>
              <option value="registered">ISO submitted for registration</option>
              <option value="in_house">In-house QMS</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>

        <div className={`${CARD} mb-5`}>
          <div className="mb-1 text-[13px] font-bold text-foreground">This person&apos;s most relevant past projects</div>
          <p className="mb-3.5 text-xs text-muted-foreground">Form B1 counts up to 5; add up to {MAX_PROJECTS} here for a quick estimate.</p>

          {projects.map((p, i) => (
            <div key={i} className={SUBCARD}>
              <div className="mb-2.5 text-xs font-bold text-foreground">Project {i + 1}</div>

              <div className="mb-2.5">
                <label className={LABEL} htmlFor={`client-${i}`}>Client type</label>
                <select id={`client-${i}`} value={p.clientType} onChange={(e) => updateProject(i, { clientType: e.target.value })} className={INPUT}>
                  <option value="">Not sure</option>
                  {CLIENT_TYPES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="mb-2.5">
                <label className={LABEL} htmlFor={`type-${i}`}>Type of work on this project</label>
                {experienceTypes.length > 0 ? (
                  <select id={`type-${i}`} value={p.experienceType} onChange={(e) => updateProject(i, { experienceType: e.target.value })} className={INPUT}>
                    <option value="">Not sure</option>
                    {experienceTypes.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                ) : (
                  <input id={`type-${i}`} type="text" value={p.experienceType} onChange={(e) => updateProject(i, { experienceType: e.target.value })} className={INPUT} placeholder="Pick a position above to see Book 1's own project-type list" />
                )}
              </div>

              <div className="flex flex-col gap-2.5 sm:flex-row">
                <div className="flex-1">
                  <label className={LABEL} htmlFor={`start-${i}`}>Start date</label>
                  <input id={`start-${i}`} type="date" value={p.startDate} onChange={(e) => updateProject(i, { startDate: e.target.value })} className={INPUT} />
                </div>
                <div className="flex-1">
                  <label className={LABEL} htmlFor={`end-${i}`}>End date (blank if ongoing)</label>
                  <input id={`end-${i}`} type="date" value={p.endDate} onChange={(e) => updateProject(i, { endDate: e.target.value })} className={INPUT} />
                </div>
              </div>
            </div>
          ))}

          {projects.length < MAX_PROJECTS && (
            <button
              type="button"
              onClick={() => setProjects((prev) => [...prev, emptyProject()])}
              className="min-h-11 rounded-lg border border-foreground bg-card px-3.5 text-[13px] font-semibold text-foreground"
            >
              + Add another project
            </button>
          )}
        </div>

        {!closingDate ? (
          <div className={CARD}>
            <p className="text-[13px] text-muted-foreground">Pick a tender closing date above to see your estimate.</p>
          </div>
        ) : estimate ? (
          <div className={CARD}>
            <div className="mb-3.5 text-[13px] font-bold text-foreground">Estimated functionality score</div>

            <div className="flex justify-between border-b border-border py-1.5 text-[13px] text-foreground">
              <span>Technical (key person)</span>
              <span className="font-bold">{rangeLabel(estimate.technical)} / 30</span>
            </div>
            <div className="flex justify-between border-b border-border py-1.5 text-[13px] text-foreground">
              <span>Management (key person)</span>
              <span className="font-bold">{rangeLabel(estimate.management)} / 15</span>
            </div>
            <div className="flex justify-between border-b border-border py-1.5 text-[13px] text-foreground">
              <span>Quality system (Form B4)</span>
              <span className="font-bold">{rangeLabel(estimate.qualitySystem)} / 10</span>
            </div>
            <div className="flex justify-between border-b border-border py-1.5 text-[13px] text-foreground">
              <span>Past performance (Form B6)</span>
              <span className="font-bold">{rangeLabel(estimate.pastPerformance)} / 15</span>
            </div>
            <div className="flex justify-between py-1.5 text-[13px] text-foreground">
              <span>Workplan appropriateness (Form C2.4)</span>
              <span className="font-bold">{rangeLabel(estimate.workplan)} / 30</span>
            </div>

            <div className="mt-3.5 rounded-lg bg-card px-4 py-3.5">
              <div className="flex justify-between text-base">
                <span className="font-bold text-foreground">Total</span>
                <span className="font-bold text-foreground">{rangeLabel(estimate.total)} / 100</span>
              </div>
              <div className={`mt-2.5 text-[13px] font-semibold ${outlookTone}`}>{estimate.outlookText}</div>
            </div>

            {estimate.notes.length > 0 && (
              <ul className="mt-3.5 list-disc pl-[18px] text-xs leading-relaxed text-muted-foreground">
                {estimate.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <OtherTools except="/tools/b6-estimator" />

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
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
