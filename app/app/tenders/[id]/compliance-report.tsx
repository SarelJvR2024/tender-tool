import Link from "next/link";
import { loadTenderCompliance } from "./compliance-data";
import { type ComplianceItem, type ComplianceStatus, type CompanyVault } from "@/lib/tenderCompliance";
import { classifyComplianceItem, type BidTaskStatus } from "./bid-task-status";
import { QuickBlockerDrawer } from "./quick-blocker-drawer";
import { VAULT_DRAWER_CONFIG } from "./quick-fix-config";
import { estimateSanralConventional, type Range } from "@/lib/sanralScoring";
import { DOCUMENT_TYPES, disciplineLabel, isScoreableEvidence, labelFor, type ExperienceItem } from "@/lib/experience";
import { acceptedDocTypes, describeRule, type ChosenRule, type EvaluationRules } from "@/lib/experienceEvidence";
import { matchLocality, type CompanyOffice, type LocalityRow } from "@/lib/locality";
import { formatDate } from "@/lib/dates";

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


const STATUS_STYLE: Record<ComplianceStatus, { label: string; className: string }> = {
  have: { label: "On file", className: "bg-success/10 text-success" },
  missing: { label: "Don't have", className: "bg-destructive/10 text-destructive" },
  check: { label: "Confirm by hand", className: "bg-warning/10 text-warning" },
};

// The Product promise's Verify/Provide/Fix grouping (app/AGENTS.md), applied
// to the required-documents list below via bid-task-status.ts's shared
// classifyComplianceItem(). Kept separate from STATUS_STYLE above, which
// still drives Key people & Locality's own have/missing/check chips -
// those haven't been migrated to this grouping yet.
const TASK_STYLE: Record<BidTaskStatus, { title: string; className: string }> = {
  fix: { title: "Fix", className: "bg-destructive/10 text-destructive" },
  provide: { title: "Provide", className: "bg-warning/10 text-warning" },
  verify: { title: "Verify", className: "bg-success/10 text-success" },
};

// Uses the var(--token) CSS-variable pattern (company/_components/ui.tsx's
// own established convention) rather than Tailwind className - too many
// spread call sites across this file to convert without a disproportionately
// large diff for a color-only pass (design-system color migration, batch 4).
const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

/**
 * One section per returned key, so the Tender Workspace's top-level tabs
 * (page.tsx, Phase 2 retab) can place each where it belongs (documents/
 * locality -> Compliance & Guard, people/experience -> Team & CVs,
 * score -> Overview) instead of one long fragment -
 * nothing here changed except the return shape; every read, every
 * computed value, every piece of JSX is identical to before this split.
 */
export type ComplianceReportSections = {
  documents: React.ReactNode;
  people: React.ReactNode;
  experience: React.ReactNode;
  locality: React.ReactNode;
  score: React.ReactNode | null;
};

export async function ComplianceReport({ tenderId }: { tenderId: string }): Promise<ComplianceReportSections | null> {
  const data = await loadTenderCompliance(tenderId);
  if (!data) return null;
  if (!data.mapped) {
    const family = data.family;
    return {
      documents: (
        <div style={card}>
          <SectionTitle title="Compliance check" />
          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
            Required documents are only mapped for SANRAL Conventional Consultant tenders so far
            {family ? ` - this one is "${family}"` : ""}. Other buyers each set their own returnable list, so
            nothing is claimed here until this tender&apos;s list has been read.
          </div>
        </div>
      ),
      people: null,
      experience: null,
      locality: null,
      score: null,
    };
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

  const tasks = docItems.map((item) => ({ item, task: classifyComplianceItem(item) }));
  const taskGroups: { status: BidTaskStatus; empty: string }[] = [
    { status: "fix", empty: "Nothing here would disqualify the bid." },
    { status: "provide", empty: "Nothing left for you to supply." },
    { status: "verify", empty: "Nothing left to verify." },
  ];
  const fixCount = tasks.filter((t) => t.task.status === "fix").length;

  const documents = (
    <div id="compliance-check" style={card}>
      <SectionTitle title="Compliance check - required documents" />
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 12 }}>
        SANRAL&apos;s returnable-documents list (Part T2.1) and mandatory administration criteria, checked against your
        company vault on the closing date. <strong>Fix</strong> items would disqualify the bid at Stage 2 if left as is.{" "}
        <strong>Provide</strong> items only you can supply. <strong>Verify</strong> items are already filled from your
        vault - just confirm them.
      </div>
      {fixCount > 0 && (
        <div className="border border-destructive/40 bg-destructive/10 text-destructive" style={{ borderRadius: 9, padding: "10px 14px", marginBottom: 12, fontSize: 12, fontWeight: 600 }}>
          {fixCount} requirement{fixCount === 1 ? "" : "s"} would disqualify this bid at Stage 2 - fix {fixCount === 1 ? "it" : "them"} before you submit.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {taskGroups.map((g) => {
          const rows = tasks.filter((t) => t.task.status === g.status);
          const st = TASK_STYLE[g.status];
          return (
            <div key={g.status} style={{ border: "1px solid var(--border)", borderRadius: 11, padding: "12px 14px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{st.title}</div>
                <CountBadge count={rows.length} className={st.className} />
              </div>
              {rows.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted-foreground)", paddingTop: 6 }}>{g.empty}</div>
              ) : (
                rows.map(({ item, task }) => <BidTaskRow key={item.key} item={item} task={task} tenderId={tenderId} company={company} />)
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const people = (
    <div id="key-people" style={card}>
      <SectionTitle title="Key people & CVs" />
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 10 }}>
          Whether each position is filled by someone <strong>your company has tagged</strong> as fitting that role (set on
          the person&apos;s People page - Tender Ready doesn&apos;t guess role fit), with the C3.1.11 minimums checked
          against the records on file as a cross-check, the CV on file and the tender-specific CV status.
        </div>
        {/* Whose C3.1.11 table the minimums come from - same banner pattern as the experience-evidence rule. */}
        <div
          className={
            ownMinimums && assumedPositions.length === 0
              ? "border border-border bg-card text-foreground"
              : "border border-warning/40 bg-warning/10 text-warning"
          }
          style={{ borderRadius: 9, padding: "9px 12px", margin: "0 0 10px", fontSize: 12 }}
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
                years for the RE). These will be replaced with this tender&apos;s own minimums once its Book 2/3 technical specification is read.
              </div>
              {keyPersonMinimums?.reason && <div style={{ marginTop: 3, color: "var(--muted-foreground)" }}>Last read: {keyPersonMinimums.reason}</div>}
            </>
          )}
        </div>
        {positionRows.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
            No key positions recorded for this tender yet - they come from the tender pack once it&apos;s created.
          </div>
        )}
        {positionRows.map((p) => {
          const minSt = STATUS_STYLE[p.min.status];
          const fitSt = STATUS_STYLE[p.fit.status];
          return (
            <div key={p.code} style={{ borderTop: "1px solid var(--border)", padding: "11px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>
                    {p.code}
                    {p.req?.position_description ? <span style={{ fontWeight: 500, color: "var(--muted-foreground)" }}> - {p.req.position_description}</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
                    {p.person
                      ? p.person.name
                      : p.suggested
                        ? `Not confirmed (suggested: ${p.suggested.name})`
                        : "No key person confirmed"}
                  </div>
                  {p.fit.roleTitle && <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>Role: {p.fit.roleTitle}</div>}
                  {p.min.requirement && (
                    <div style={{ fontSize: 11, color: p.min.source === "assumed" ? "var(--warning)" : "var(--muted-foreground)", marginTop: 2 }}>
                      {p.min.source === "assumed" ? "Assumed rule - needs: " : "Needs: "}
                      {p.min.requirement}
                    </div>
                  )}
                </div>
                <Chip
                  label={`Role fit: ${p.fit.status === "have" ? "tagged" : p.fit.status === "missing" ? "unfilled" : "confirm"}`}
                  className={fitSt.className}
                />
              </div>
              <div style={{ fontSize: 12, color: p.fit.status === "missing" ? "var(--destructive)" : "var(--foreground)", marginTop: 4 }}>{p.fit.detail}</div>
              {p.person && (
                <div style={{ fontSize: 11, color: p.min.status === "missing" ? "var(--destructive)" : "var(--muted-foreground)", marginTop: 3 }}>
                  Cross-check from records on file (minimum {minSt.label === "On file" ? "met" : minSt.label === "Don't have" ? "not met" : "unconfirmed"}): {p.min.detail}
                </div>
              )}
              {p.person && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {p.cv ? (
                    <Chip label={`CV on file (${p.cv.mode === "as_is" ? "Use as-is" : "AI-extract"})`} className="bg-success/10 text-success" />
                  ) : (
                    <Chip label="No CV uploaded" className="bg-destructive/10 text-destructive" />
                  )}
                  {p.tenderCv ? (
                    <Chip
                      label={`Tender CV: ${p.tenderCv.status}`}
                      className={p.tenderCv.status === "ready" ? "bg-success/10 text-success" : p.tenderCv.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}
                    />
                  ) : (
                    <Chip label="Tender CV not requested" className="bg-warning/10 text-warning" />
                  )}
                  <Chip
                    label={`${p.personProjects.length} project${p.personProjects.length === 1 ? "" : "s"} for Form B1/B2`}
                    className={p.personProjects.length >= 3 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}
                  />
                  {p.asg?.specialism_warning && <Chip label="Specialism not evidenced" className="bg-warning/10 text-warning" />}
                </div>
              )}
            </div>
          );
        })}
      </div>
  );

  const experienceSection = (
    <ExperienceSection available={experienceAvailable} error={experience.error} items={expItems} closingDate={closingDate} chosen={chosenRule} disciplines={experienceDisciplines} />
  );

  const locality = <LocalitySection rules={evaluationRules} offices={offices} />;

  const score = estimate ? (
    <ScoreEstimate
      estimate={estimate}
      beeLevel={(company?.bee_level as number | null) ?? null}
      beeProofValid={beeProofValid}
      qualityFromVault={qualitySystem !== null}
    />
  ) : null;

  return { documents, people, experience: experienceSection, locality, score };
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
      ? { className: "bg-success/10 text-success", label: "Clears threshold" }
      : estimate.outlook === "cannot_clear"
        ? { className: "bg-destructive/10 text-destructive", label: "Below threshold" }
        : { className: "bg-warning/10 text-warning", label: "Depends on unknowns" };
  const fmt = (r: Range) => (r.min === r.max ? `${r.min}` : `${r.min}-${r.max}`);

  return (
    <div id="score-estimate" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
        <SectionTitle title="Functionality score estimate" />
        <Chip label={outlookStyle.label} className={outlookStyle.className} />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 12 }}>
        SANRAL&apos;s published consultant scoring (Annexure A), applied to the people on this tender. Ranges, not a single
        number, wherever the input isn&apos;t known.
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "var(--foreground)" }}>{fmt(estimate.total)}</span>
        <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>of 100 · minimum {estimate.threshold} to reach price evaluation{estimate.thresholdSource === "assumed" ? " (assumed - not read from this tender)" : " (from this tender's documents)"}</span>
      </div>
      <RangeBar range={estimate.total} max={100} threshold={estimate.threshold} />
      <div style={{ fontSize: 12, color: "var(--foreground)", margin: "8px 0 12px" }}>{estimate.outlookText}</div>

      {rows.map((r) => (
        <div key={r.label} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>{r.label}</span>
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
              {fmt(r.range)} of {r.max} <span style={{ color: "var(--muted-foreground)" }}>· {r.note}</span>
            </span>
          </div>
          <RangeBar range={r.range} max={r.max} />
        </div>
      ))}

      {estimate.positions.some((p) => p.notes.length > 0) && (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 11, color: "var(--muted-foreground)" }}>
          {estimate.positions.flatMap((p) => p.notes.map((n, i) => <li key={`${p.positionCode}-${i}`}>{p.positionCode}: {n}</li>))}
        </ul>
      )}

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 10, fontSize: 12, color: "var(--muted-foreground)" }}>
        <strong style={{ color: "var(--foreground)" }}>After functionality:</strong> price (80 or 90 points) is scored against the lowest
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
      className={
        source === "tender_document"
          ? "border border-border bg-card text-foreground"
          : "border border-warning/40 bg-warning/10 text-warning"
      }
      style={{ borderRadius: 9, padding: "9px 12px", margin: "6px 0 10px", fontSize: 12 }}
    >
      <div style={{ fontWeight: 700, marginBottom: 2 }}>
        {source === "tender_document" ? "What this tender accepts as proof (read from its own document)" : "Assumed rule - this tender's own evidence rule hasn't been read yet"}
      </div>
      <div>{describeRule(rule)}{rule.scope ? ` - scope: ${rule.scope}` : ""}.</div>
      <div style={{ fontStyle: "italic", color: "var(--muted-foreground)", marginTop: 3, wordBreak: "break-word" }}>&ldquo;{rule.quote}&rdquo;</div>
      {source === "assumed" && (
        <div style={{ marginTop: 3 }}>
          This is SANRAL&apos;s Form B6 pattern, not a fact about this tender. It will be replaced with this tender&apos;s own
          rule once its evidence requirements are read from the document.
        </div>
      )}
      {chosen.otherRules > 0 && <div style={{ marginTop: 3 }}>The document states {chosen.otherRules} more experience rule(s) - check which one applies.</div>}
    </div>
  );
  if (!available) {
    return (
      <div id="company-experience" className="rounded-xl border border-dashed border-warning/40 bg-warning/10" style={{ padding: "18px 20px", marginBottom: 16 }}>
        <SectionTitle title="Company experience" />
        <div className="text-warning" style={{ fontSize: 12 }}>Couldn&apos;t read the Experience Library ({error}).</div>
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
          className={ok ? "bg-success/10 text-success" : qualifying.length > 0 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"}
        />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
        Tagged {disciplines.map((d) => disciplineLabel(d).toLowerCase()).join(" / ")} projects (the disciplines of this tender&apos;s key positions) in your Experience Library
        {rule.window_years ? ` completed within ${rule.window_years} years of` : " up to"}
        {closingDate ? ` ${(formatDate(closingDate) ?? "—")}` : " closing"}.
      </div>
      {ruleBox}
      {items.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--destructive)" }}>
          None tagged yet. <Link href="/experience" style={{ color: "var(--accent)", fontWeight: 600 }}>Add experience</Link>.
        </div>
      )}
      {items.map((i) => (
        <div key={i.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>{i.project_name}</div>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
              {labelFor(DOCUMENT_TYPES, i.document_type)}
              {i.client_name ? ` · ${i.client_name}` : ""}
              {i.completion_date ? ` · completed ${(formatDate(i.completion_date) ?? "—")}` : ""}
            </div>
          </div>
          {accepted.has(i.document_type) ? (
            isScoreableEvidence(i.document_type) && !i.performance_rating ? (
              <Chip label="Counts - rating not tagged" className="bg-warning/10 text-warning" />
            ) : (
              <Chip label={i.performance_rating ? `Counts - rated ${i.performance_rating}` : "Counts"} className="bg-success/10 text-success" />
            )
          ) : (
            <Chip label="Not accepted by this tender" className="bg-muted text-muted-foreground" />
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
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          This tender&apos;s document hasn&apos;t been read for locality rows yet, so office-location points aren&apos;t checked.
          {offices.length === 0 ? " No office locations on file either - add them on the Company page." : ""}
        </div>
      ) : (
        <>
          {(["specific_goals", "functionality"] as const).map((kind) => {
            const kindRows = rows.filter((r) => r.kind === kind);
            if (kindRows.length === 0) return null;
            const m = matchLocality(kindRows, offices);
            // "no_match" here is 0 points on a scoring row, not a compliance
            // failure (the one genuinely disqualifying locality case - a
            // missing MANDATORY local office - is its own separate row just
            // below, still correctly red). Painting a lost-points note the
            // same red as "would disqualify you" overstates it, so it gets
            // the same softer amber as "unconfirmed" rather than a new tone.
            const st = m.status === "matched" ? STATUS_STYLE.have : STATUS_STYLE.check;
            return (
              <div key={kind} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
                    {kind === "specific_goals" ? "Specific-goals points" : "Functionality criterion"}:{" "}
                    {kindRows.map((r) => `${r.area} ${r.points}${r.system ? ` (${r.system})` : ""}`).join(" · ")}
                  </span>
                  <Chip label={m.status === "matched" ? `${m.points} pts` : m.status === "no_match" ? "0 pts" : "Unknown"} className={st.className} />
                </div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 3 }}>{m.reason}</div>
              </div>
            );
          })}
          {mand && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "8px 0", fontSize: 12, color: "var(--destructive)" }}>
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
    <div style={{ position: "relative", height: 8, background: "var(--border)", borderRadius: 100 }}>
      <div style={{ position: "absolute", left: 0, width: `${lo}%`, top: 0, bottom: 0, background: "var(--foreground)", borderRadius: 100 }} />
      <div style={{ position: "absolute", left: `${lo}%`, width: `${Math.max(hi - lo, 0)}%`, top: 0, bottom: 0, background: "var(--foreground)", opacity: 0.25, borderRadius: 100 }} />
      {threshold !== undefined && (
        <div title={`Threshold ${threshold}`} style={{ position: "absolute", left: `${(threshold / max) * 100}%`, top: -3, bottom: -3, width: 2, background: "var(--accent)" }} />
      )}
    </div>
  );
}

function BidTaskRow({
  item,
  task,
  tenderId,
  company,
}: {
  item: ComplianceItem;
  task: ReturnType<typeof classifyComplianceItem>;
  tenderId: string;
  company: (CompanyVault & { id: string }) | null;
}) {
  const fixColor = task.status === "fix" ? "var(--destructive)" : "var(--warning)";
  // The Quick Blocker Resolver drawer (Sarel's own Batch 3 brief,
  // 2026-10-24) only replaces the plain Link for the compliance keys that
  // actually map to a real company-vault shape (quick-blocker-drawer.tsx's
  // own VAULT_DRAWER_CONFIG) - everything else keeps its existing Link to
  // /company, unchanged.
  const drawerConfig = company ? VAULT_DRAWER_CONFIG[item.key] : undefined;

  return (
    <div style={{ padding: "9px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "var(--foreground)", background: "var(--muted)", borderRadius: 100, padding: "2px 7px" }}>{item.form}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>{item.label}</span>
        {/* Fix rows already say "disqualifies" via the Fix column itself - no need to repeat MANDATORY there. */}
        {task.status !== "fix" && item.mandatory && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)" }}>MANDATORY</span>}
        {item.expiring && <Chip label="Renew soon" className="bg-warning/10 text-warning" />}
        {item.expiredCopy && <Chip label="Expired copy in pack - replace" className="bg-destructive/10 text-destructive" />}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 3, wordBreak: "break-word" }}>{task.reason}</div>
      <div style={{ marginTop: 5 }}>
        {task.confirmed ? (
          <Chip label="Confirmed" className="bg-success/10 text-success" />
        ) : drawerConfig && company ? (
          <QuickBlockerDrawer
            tenderId={tenderId}
            companyId={company.id}
            config={drawerConfig}
            currentValues={Object.fromEntries(
              drawerConfig.fields.map((f) => {
                const raw = (company as unknown as Record<string, string | number | null>)[f.name];
                return [f.name, raw === null || raw === undefined ? "" : String(raw)];
              }),
            )}
            triggerElement={<button type="button" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: fixColor }} />}
            triggerLabel={`${task.fixLabel} →`}
          />
        ) : (
          <Link href={task.fixHref} style={{ fontSize: 12, fontWeight: 600, color: fixColor }}>
            {task.fixLabel} →
          </Link>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <div style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)", marginBottom: 2 }}>{title}</div>;
}

function CountBadge({ count, className }: { count: number; className: string }) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, padding: "0 6px", borderRadius: 100, fontSize: 11, fontWeight: 700 }}>
      {count}
    </span>
  );
}

function Chip({ label, className }: { label: string; className: string }) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}
