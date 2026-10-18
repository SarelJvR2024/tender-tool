import Link from "next/link";
import { loadTenderCompliance } from "./compliance-data";
import { type ComplianceItem, type ComplianceStatus } from "@/lib/tenderCompliance";
import { estimateSanralConventional, type Range } from "@/lib/sanralScoring";
import { DOCUMENT_TYPES, disciplineLabel, isScoreableEvidence, labelFor, type ExperienceItem } from "@/lib/experience";
import { acceptedDocTypes, describeRule, type ChosenRule, type EvaluationRules } from "@/lib/experienceEvidence";
import { matchLocality, type CompanyOffice, type LocalityRow } from "@/lib/locality";

/**
 * Compliance check + score estimate for one tender (Sarel, 2026-10-16: "once
 * a company wants to pursue a specific tender... clearly highlight what
 * documents the company has and doesn't have, and also in terms of CVs and
 * experience"). Lives on the Tender Workspace page, not its own page.
 *
 * Self-contained server component (does its own reads, via RLS) so the
 * workspace page only mounts it - the page itself is being extended by
 * other work concurrently. The reads live in compliance-data.ts
 * (loadTenderCompliance, cached per request) so the submission-pack card can
 * gate on the same gaps. Rules and their evidence: app/lib/tenderCompliance.ts,
 * app/lib/sanralScoring.ts, docs/specs/Tender-Evaluation-Engine-Audit.md.
 */


const STATUS_STYLE: Record<ComplianceStatus, { label: string; bg: string; color: string }> = {
  have: { label: "On file", bg: "#DCFCE7", color: "#15803D" },
  missing: { label: "Don't have", bg: "#FEE2E2", color: "#B91C1C" },
  check: { label: "Confirm by hand", bg: "#FEF3C7", color: "#B45309" },
};

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

export async function ComplianceReport({ tenderId }: { tenderId: string }) {
  const data = await loadTenderCompliance(tenderId);
  if (!data) return null;
  if (!data.mapped) {
    const family = data.family;
    return (
      <div style={card}>
        <SectionTitle title="Compliance check" />
        <div style={{ fontSize: 12, color: "#6B6758" }}>
          Required documents are only mapped for SANRAL Conventional Consultant tenders so far
          {family ? ` - this one is "${family}"` : ""}. Other buyers each set their own returnable list, so
          nothing is claimed here until this tender&apos;s list has been read.
        </div>
      </div>
    );
  }

  const {
    closingDate,
    evaluationRules,
    offices,
    company,
    docItems,
    positionRows,
    estimate,
    experience,
    expItems,
    experienceAvailable,
    experienceDisciplines,
    chosenRule,
    keyPersonMinimums,
    qualitySystem,
    beeProofValid,
  } = data;
  const ownMinimums = keyPersonMinimums?.source === "tender_document" ? keyPersonMinimums : null;
  const assumedPositions = positionRows.filter((p) => p.min.source === "assumed").map((p) => p.code);

  const groups: { status: ComplianceStatus; title: string; empty: string }[] = [
    { status: "missing", title: "Don't have", empty: "Nothing required is missing." },
    { status: "check", title: "Confirm by hand", empty: "Nothing left to confirm." },
    { status: "have", title: "On file", empty: "Nothing confirmed on file yet." },
  ];
  const mandatoryFailing = docItems.filter((i) => i.mandatory && i.status === "missing").length;

  return (
    <>
      {/* Required documents */}
      <div id="compliance-check" style={card}>
        <SectionTitle title="Compliance check - required documents" />
        <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 12 }}>
          SANRAL&apos;s returnable-documents list (Part T2.1) and mandatory administration criteria, checked against your
          company vault on the closing date. &quot;Confirm by hand&quot; means something on file needs a detail added (an
          expiry date, the proof type) or a step only you can confirm - not that you don&apos;t have it.
        </div>
        {mandatoryFailing > 0 && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#B91C1C", fontWeight: 600 }}>
            {mandatoryFailing} mandatory requirement{mandatoryFailing === 1 ? "" : "s"} not met - the tender would be disqualified at Stage 2.
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {groups.map((g) => {
            const rows = docItems.filter((i) => i.status === g.status);
            const st = STATUS_STYLE[g.status];
            return (
              <div key={g.status} style={{ border: "1px solid #E5E1D5", borderRadius: 11, padding: "12px 14px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B" }}>{g.title}</div>
                  <CountBadge count={rows.length} bg={st.bg} color={st.color} />
                </div>
                {rows.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#9A9684", paddingTop: 6 }}>{g.empty}</div>
                ) : (
                  rows.map((i) => <DocRow key={i.key} item={i} />)
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Key people & CVs */}
      <div id="key-people" style={card}>
        <SectionTitle title="Key people & CVs" />
        <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
          Whether each position is filled by someone <strong>your company has tagged</strong> as fitting that role (set on
          the person&apos;s People page - Tender Tool doesn&apos;t guess role fit), with the C3.1.11 minimums checked
          against the records on file as a cross-check, the CV on file and the tender-specific CV status.
        </div>
        {/* Whose C3.1.11 table the minimums come from - same banner pattern as the experience-evidence rule. */}
        <div
          style={{
            background: ownMinimums && assumedPositions.length === 0 ? "#F6F5F1" : "#FEF3C7",
            border: `1px solid ${ownMinimums && assumedPositions.length === 0 ? "#E5E1D5" : "#F5D08A"}`,
            borderRadius: 9,
            padding: "9px 12px",
            margin: "0 0 10px",
            fontSize: 12,
            color: ownMinimums && assumedPositions.length === 0 ? "#16233B" : "#92400E",
          }}
        >
          {ownMinimums ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Minimum requirements read from this tender&apos;s own C3.1.11 table</div>
              <div>
                {ownMinimums.rows.length} position row{ownMinimums.rows.length === 1 ? "" : "s"} read from {evaluationRules?.source_document ?? "the tender document"}.
                {assumedPositions.length > 0 &&
                  ` ${assumedPositions.join(", ")} ha${assumedPositions.length === 1 ? "s" : "ve"} no row in it - for ${assumedPositions.length === 1 ? "that position" : "those"} the R.396-010-2025/1F minimum is used and marked "Assumed rule".`}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Assumed rule - this tender&apos;s own C3.1.11 minimum-requirements table hasn&apos;t been read</div>
              <div>
                The minimums below are R.396-010-2025/1F&apos;s table (Book 2/3, C3-14/C3-15), not a fact about this tender - other SANRAL
                tenders set different registrations and years (N.011-010-2027-1F wants Pr Eng only for the Contract Engineer and 10-15
                years for the RE). Run engine/seed_tender_evaluation_rules.py with this tender&apos;s Book 2/3 to replace them.
              </div>
              {keyPersonMinimums?.reason && <div style={{ marginTop: 3, color: "#6B6758" }}>Last read: {keyPersonMinimums.reason}</div>}
            </>
          )}
        </div>
        {positionRows.length === 0 && (
          <div style={{ fontSize: 12, color: "#9A9684" }}>
            No key positions recorded for this tender yet - they come from the tender pack once it&apos;s created.
          </div>
        )}
        {positionRows.map((p) => {
          const minSt = STATUS_STYLE[p.min.status];
          const fitSt = STATUS_STYLE[p.fit.status];
          return (
            <div key={p.code} style={{ borderTop: "1px solid #F0EEE6", padding: "11px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B" }}>
                    {p.code}
                    {p.req?.position_description ? <span style={{ fontWeight: 500, color: "#6B6758" }}> - {p.req.position_description}</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: "#4B5563", marginTop: 2 }}>
                    {p.person
                      ? p.person.name
                      : p.suggested
                        ? `Not confirmed (suggested: ${p.suggested.name})`
                        : "No key person confirmed"}
                  </div>
                  {p.fit.roleTitle && <div style={{ fontSize: 11, color: "#9A9684", marginTop: 2 }}>Role: {p.fit.roleTitle}</div>}
                  {p.min.requirement && (
                    <div style={{ fontSize: 11, color: p.min.source === "assumed" ? "#B45309" : "#9A9684", marginTop: 2 }}>
                      {p.min.source === "assumed" ? "Assumed rule - needs: " : "Needs: "}
                      {p.min.requirement}
                    </div>
                  )}
                </div>
                <Chip
                  label={`Role fit: ${p.fit.status === "have" ? "tagged" : p.fit.status === "missing" ? "unfilled" : "confirm"}`}
                  bg={fitSt.bg}
                  color={fitSt.color}
                />
              </div>
              <div style={{ fontSize: 12, color: p.fit.status === "missing" ? "#B91C1C" : "#16233B", marginTop: 4 }}>{p.fit.detail}</div>
              {p.person && (
                <div style={{ fontSize: 11, color: p.min.status === "missing" ? "#B91C1C" : "#6B6758", marginTop: 3 }}>
                  Cross-check from records on file (minimum {minSt.label === "On file" ? "met" : minSt.label === "Don't have" ? "not met" : "unconfirmed"}): {p.min.detail}
                </div>
              )}
              {p.person && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {p.cv ? (
                    <Chip label={`CV on file (${p.cv.mode === "as_is" ? "use as-is" : "AI extract"})`} bg="#DCFCE7" color="#15803D" />
                  ) : (
                    <Chip label="No CV uploaded" bg="#FEE2E2" color="#B91C1C" />
                  )}
                  {p.tenderCv ? (
                    <Chip
                      label={`Tender CV: ${p.tenderCv.status}`}
                      bg={p.tenderCv.status === "ready" ? "#DCFCE7" : p.tenderCv.status === "failed" ? "#FEE2E2" : "#FEF3C7"}
                      color={p.tenderCv.status === "ready" ? "#15803D" : p.tenderCv.status === "failed" ? "#B91C1C" : "#B45309"}
                    />
                  ) : (
                    <Chip label="Tender CV not requested" bg="#FEF3C7" color="#B45309" />
                  )}
                  <Chip
                    label={`${p.personProjects.length} project${p.personProjects.length === 1 ? "" : "s"} for Form B1/B2`}
                    bg={p.personProjects.length >= 3 ? "#DCFCE7" : "#FEF3C7"}
                    color={p.personProjects.length >= 3 ? "#15803D" : "#B45309"}
                  />
                  {p.asg?.specialism_warning && <Chip label="Specialism not evidenced" bg="#FEF3C7" color="#B45309" />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Company experience (Experience Library) */}
      <ExperienceSection available={experienceAvailable} error={experience.error} items={expItems} closingDate={closingDate} chosen={chosenRule} disciplines={experienceDisciplines} />

      {/* Locality (office locations vs the tender's own locality rows) */}
      <LocalitySection rules={evaluationRules} offices={offices} />

      {/* Score estimate */}
      {estimate && (
        <ScoreEstimate
          estimate={estimate}
          beeLevel={(company?.bee_level as number | null) ?? null}
          beeProofValid={beeProofValid}
          qualityFromVault={qualitySystem !== null}
        />
      )}
    </>
  );
}

function ScoreEstimate({
  estimate,
  beeLevel,
  beeProofValid,
  qualityFromVault,
}: {
  estimate: ReturnType<typeof estimateSanralConventional>;
  beeLevel: number | null;
  beeProofValid: boolean;
  qualityFromVault: boolean;
}) {
  const rows: { label: string; range: Range; max: number; note: string }[] = [
    { label: "Technical experience (B1)", range: estimate.technical, max: 30, note: "From key people's project history" },
    { label: "Management ability (B2)", range: estimate.management, max: 15, note: "From key people's clients" },
    { label: "Quality system (B4)", range: estimate.qualitySystem, max: 10, note: qualityFromVault ? "ISO 9001 certificate in your vault" : "Set ISO 9001 in the vault" },
    { label: "Past performance (B6)", range: estimate.pastPerformance, max: 15, note: "From your Experience Library" },
    { label: "Workplan hours (C2.4)", range: estimate.workplan, max: 30, note: "Depends on other bidders" },
  ];
  const outlookStyle =
    estimate.outlook === "clears"
      ? { bg: "#DCFCE7", color: "#15803D", label: "Clears threshold" }
      : estimate.outlook === "cannot_clear"
        ? { bg: "#FEE2E2", color: "#B91C1C", label: "Below threshold" }
        : { bg: "#FEF3C7", color: "#B45309", label: "Depends on unknowns" };
  const fmt = (r: Range) => (r.min === r.max ? `${r.min}` : `${r.min}-${r.max}`);

  return (
    <div id="score-estimate" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
        <SectionTitle title="Functionality score estimate" />
        <Chip label={outlookStyle.label} bg={outlookStyle.bg} color={outlookStyle.color} />
      </div>
      <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 12 }}>
        SANRAL&apos;s published consultant scoring (Annexure A), applied to the people on this tender. Ranges, not a single
        number, wherever the input isn&apos;t known.
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "#16233B" }}>{fmt(estimate.total)}</span>
        <span style={{ fontSize: 12, color: "#6B6758" }}>of 100 · minimum {estimate.threshold} to reach price evaluation</span>
      </div>
      <RangeBar range={estimate.total} max={100} threshold={estimate.threshold} />
      <div style={{ fontSize: 12, color: "#16233B", margin: "8px 0 12px" }}>{estimate.outlookText}</div>

      {rows.map((r) => (
        <div key={r.label} style={{ borderTop: "1px solid #F0EEE6", padding: "8px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{r.label}</span>
            <span style={{ fontSize: 12, color: "#4B5563" }}>
              {fmt(r.range)} of {r.max} <span style={{ color: "#9A9684" }}>· {r.note}</span>
            </span>
          </div>
          <RangeBar range={r.range} max={r.max} />
        </div>
      ))}

      {estimate.positions.some((p) => p.notes.length > 0) && (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 11, color: "#6B6758" }}>
          {estimate.positions.flatMap((p) => p.notes.map((n, i) => <li key={`${p.positionCode}-${i}`}>{p.positionCode}: {n}</li>))}
        </ul>
      )}

      <div style={{ borderTop: "1px solid #F0EEE6", marginTop: 10, paddingTop: 10, fontSize: 12, color: "#6B6758" }}>
        <strong style={{ color: "#16233B" }}>After functionality:</strong> price (80 or 90 points) is scored against the lowest
        acceptable bid, so it can&apos;t be estimated before closing. Specific goals at SANRAL follow the B-BBEE level table
        {beeLevel
          ? ` - level ${beeLevel} on file gives ${beeLevel === 1 ? "the full 10 of 10 (90/10) or 20 of 20 (80/20)" : "points per SANRAL's table"}${
              beeProofValid
                ? " (proof on file is valid at closing - R.396's Form A12 asks for a SANAS verification certificate, and takes an affidavit only from an EME under R1.8m: see the B-BBEE row)"
                : ", once valid proof with an expiry after closing is in the vault (R.396's Form A12 asks for a SANAS verification certificate; an affidavit only from an EME under R1.8m)"
            }`
          : " - no level on file, so 0"}.
      </div>
    </div>
  );
}

function ExperienceSection({
  available,
  error,
  items,
  closingDate,
  chosen,
  disciplines,
}: {
  available: boolean;
  error: string | null;
  items: ExperienceItem[];
  closingDate: string | null;
  chosen: ChosenRule;
  disciplines: string[];
}) {
  const { rule, source } = chosen;
  const ruleBox = (
    <div
      style={{
        background: source === "tender_document" ? "#F6F5F1" : "#FEF3C7",
        border: `1px solid ${source === "tender_document" ? "#E5E1D5" : "#F5D08A"}`,
        borderRadius: 9,
        padding: "9px 12px",
        margin: "6px 0 10px",
        fontSize: 12,
        color: source === "tender_document" ? "#16233B" : "#92400E",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 2 }}>
        {source === "tender_document" ? "What this tender accepts as proof (read from its own document)" : "Assumed rule - this tender's own evidence rule hasn't been read yet"}
      </div>
      <div>{describeRule(rule)}{rule.scope ? ` - scope: ${rule.scope}` : ""}.</div>
      <div style={{ fontStyle: "italic", color: "#6B6758", marginTop: 3, wordBreak: "break-word" }}>&ldquo;{rule.quote}&rdquo;</div>
      {source === "assumed" && (
        <div style={{ marginTop: 3 }}>
          This is SANRAL&apos;s Form B6 pattern, not a fact about this tender. Run engine/seed_tender_evaluation_rules.py on
          the tender document to replace it.
        </div>
      )}
      {chosen.otherRules > 0 && <div style={{ marginTop: 3 }}>The document states {chosen.otherRules} more experience rule(s) - check which one applies.</div>}
    </div>
  );
  if (!available) {
    return (
      <div id="company-experience" style={{ ...card, background: "#FFFBEB", border: "1px dashed #F5D08A" }}>
        <SectionTitle title="Company experience" />
        <div style={{ fontSize: 12, color: "#92400E" }}>Couldn&apos;t read the Experience Library ({error}).</div>
        {ruleBox}
      </div>
    );
  }
  const accepted = acceptedDocTypes(rule);
  const qualifying = items.filter((i) => accepted.has(i.document_type));
  const need = rule.projects_required ?? 0;
  const ok = need > 0 && qualifying.length >= need;
  return (
    <div id="company-experience" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <SectionTitle title="Company experience" />
        <Chip
          label={need ? `${qualifying.length} of ${need} qualifying` : `${qualifying.length} qualifying`}
          bg={ok ? "#DCFCE7" : qualifying.length > 0 ? "#FEF3C7" : "#FEE2E2"}
          color={ok ? "#15803D" : qualifying.length > 0 ? "#B45309" : "#B91C1C"}
        />
      </div>
      <div style={{ fontSize: 12, color: "#6B6758" }}>
        Tagged {disciplines.map((d) => disciplineLabel(d).toLowerCase()).join(" / ")} projects (the disciplines of this tender&apos;s key positions) in your Experience Library
        {rule.window_years ? ` completed within ${rule.window_years} years of` : " up to"}
        {closingDate ? ` ${new Date(closingDate).toLocaleDateString()}` : " closing"}.
      </div>
      {ruleBox}
      {items.length === 0 && (
        <div style={{ fontSize: 12, color: "#B91C1C" }}>
          None tagged yet. <Link href="/experience" style={{ color: "#D97706", fontWeight: 600 }}>Add experience</Link>.
        </div>
      )}
      {items.map((i) => (
        <div key={i.id} style={{ borderTop: "1px solid #F0EEE6", padding: "8px 0", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{i.project_name}</div>
            <div style={{ fontSize: 11, color: "#6B6758" }}>
              {labelFor(DOCUMENT_TYPES, i.document_type)}
              {i.client_name ? ` · ${i.client_name}` : ""}
              {i.completion_date ? ` · completed ${new Date(i.completion_date).toLocaleDateString()}` : ""}
            </div>
          </div>
          {accepted.has(i.document_type) ? (
            isScoreableEvidence(i.document_type) && !i.performance_rating ? (
              <Chip label="Counts - rating not tagged" bg="#FEF3C7" color="#B45309" />
            ) : (
              <Chip label={i.performance_rating ? `Counts - rated ${i.performance_rating}` : "Counts"} bg="#DCFCE7" color="#15803D" />
            )
          ) : (
            <Chip label="Not accepted by this tender" bg="#F0EEE6" color="#6B6758" />
          )}
        </div>
      ))}
    </div>
  );
}

function LocalitySection({ rules, offices }: { rules: EvaluationRules | null; offices: CompanyOffice[] }) {
  const rows = (rules?.locality?.rows ?? []) as LocalityRow[];
  const mand = rules?.locality?.mandatory_local_office ?? null;
  // Nothing to say when the tender's rules have been read and it has no
  // locality rows (SANRAL scores specific goals on the B-BBEE table only).
  if (rules && rows.length === 0 && !mand) return null;
  return (
    <div id="locality" style={card}>
      <SectionTitle title="Office location (locality)" />
      {!rules ? (
        <div style={{ fontSize: 12, color: "#6B6758" }}>
          This tender&apos;s document hasn&apos;t been read for locality rows yet, so office-location points aren&apos;t checked.
          {offices.length === 0 ? " No office locations on file either - add them on the Company page." : ""}
        </div>
      ) : (
        <>
          {(["specific_goals", "functionality"] as const).map((kind) => {
            const kindRows = rows.filter((r) => r.kind === kind);
            if (kindRows.length === 0) return null;
            const m = matchLocality(kindRows, offices);
            const st = m.status === "matched" ? STATUS_STYLE.have : m.status === "no_match" ? STATUS_STYLE.missing : STATUS_STYLE.check;
            return (
              <div key={kind} style={{ borderTop: "1px solid #F0EEE6", padding: "8px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>
                    {kind === "specific_goals" ? "Specific-goals points" : "Functionality criterion"}:{" "}
                    {kindRows.map((r) => `${r.area} ${r.points}${r.system ? ` (${r.system})` : ""}`).join(" · ")}
                  </span>
                  <Chip label={m.status === "matched" ? `${m.points} pts` : m.status === "no_match" ? "0 pts" : "Unknown"} bg={st.bg} color={st.color} />
                </div>
                <div style={{ fontSize: 12, color: "#4B5563", marginTop: 3 }}>{m.reason}</div>
              </div>
            );
          })}
          {mand && (
            <div style={{ borderTop: "1px solid #F0EEE6", padding: "8px 0", fontSize: 12, color: "#B91C1C" }}>
              <strong>Mandatory:</strong> a local office in {mand.area}
              {mand.disqualifies ? " - non-responsive without one" : ""}.{" "}
              {matchLocality([{ area: mand.area, level: "municipality", province: null, points: 0, system: null, kind: "specific_goals" }], offices).status === "matched"
                ? "You have an office there on file."
                : "No office there on file."}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RangeBar({ range, max, threshold }: { range: Range; max: number; threshold?: number }) {
  const lo = Math.max(0, Math.min(100, (range.min / max) * 100));
  const hi = Math.max(0, Math.min(100, (range.max / max) * 100));
  return (
    <div style={{ position: "relative", height: 8, background: "#F0EEE6", borderRadius: 100 }}>
      <div style={{ position: "absolute", left: 0, width: `${lo}%`, top: 0, bottom: 0, background: "#16233B", borderRadius: 100 }} />
      <div style={{ position: "absolute", left: `${lo}%`, width: `${Math.max(hi - lo, 0)}%`, top: 0, bottom: 0, background: "#16233B", opacity: 0.25, borderRadius: 100 }} />
      {threshold !== undefined && (
        <div title={`Threshold ${threshold}`} style={{ position: "absolute", left: `${(threshold / max) * 100}%`, top: -3, bottom: -3, width: 2, background: "#D97706" }} />
      )}
    </div>
  );
}

function DocRow({ item }: { item: ComplianceItem }) {
  return (
    <div style={{ padding: "9px 0", borderTop: "1px solid #F0EEE6" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "#16233B", background: "#F0EEE6", borderRadius: 100, padding: "2px 7px" }}>{item.form}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{item.label}</span>
        {item.mandatory && <span style={{ fontSize: 10, fontWeight: 700, color: "#B91C1C" }}>MANDATORY</span>}
        {item.expiring && <Chip label="Renew soon" bg="#FEF3C7" color="#B45309" />}
        {item.expiredCopy && <Chip label="Expired copy in pack - replace" bg="#FEE2E2" color="#B91C1C" />}
      </div>
      <div style={{ fontSize: 12, color: "#4B5563", marginTop: 3, wordBreak: "break-word" }}>{item.detail}</div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>{title}</div>;
}

function CountBadge({ count, bg, color }: { count: number; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, padding: "0 6px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: bg, color }}>
      {count}
    </span>
  );
}

function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}
