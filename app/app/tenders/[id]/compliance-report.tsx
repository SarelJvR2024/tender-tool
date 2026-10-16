import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  SANRAL_CONVENTIONAL_FAMILY,
  checkMinimumRequirement,
  sanralConventionalDocumentChecks,
  COMPANY_VAULT_COLUMNS,
  beeProofValidAtClosing,
  qualitySystemFromVault,
  type CompanyVault,
  type ComplianceItem,
  type ComplianceStatus,
  type PersonFacts,
} from "@/lib/tenderCompliance";
import { estimateSanralConventional, pastPerformanceFromExperience, type Range, type SanralProject } from "@/lib/sanralScoring";
import { DOCUMENT_TYPES, findMatchingExperience, isScoreableEvidence, labelFor, type ExperienceItem } from "@/lib/experience";

/**
 * Compliance check + score estimate for one tender (Sarel, 2026-10-16: "once
 * a company wants to pursue a specific tender... clearly highlight what
 * documents the company has and doesn't have, and also in terms of CVs and
 * experience"). Lives on the Tender Workspace page, not its own page.
 *
 * Self-contained server component (does its own reads, via RLS) so the
 * workspace page only mounts it - the page itself is being extended by
 * other work concurrently. Rules and their evidence: app/lib/tenderCompliance.ts,
 * app/lib/sanralScoring.ts, docs/specs/Tender-Evaluation-Engine-Audit.md.
 */

type Requirement = { position_code: string; position_description: string | null; managerial: boolean; is_alternate: boolean };
type Assignment = { position_code: string; confirmed_person_id: string | null; suggested_person_id: string | null; specialism_warning: boolean };
type PersonRow = PersonFacts & { id: string };
type ProjectRow = SanralProject & { person_id: string };
type CvUpload = { person_id: string; mode: "as_is" | "ai_extract"; original_filename: string; created_at: string };
type GeneratedCvRow = { position_code: string | null; status: string };

const STATUS_STYLE: Record<ComplianceStatus, { label: string; bg: string; color: string }> = {
  have: { label: "On file", bg: "#DCFCE7", color: "#15803D" },
  missing: { label: "Don't have", bg: "#FEE2E2", color: "#B91C1C" },
  check: { label: "Confirm by hand", bg: "#FEF3C7", color: "#B45309" },
};

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

export async function ComplianceReport({ tenderId }: { tenderId: string }) {
  const supabase = await createClient();

  const { data: tender } = await supabase.from("tenders").select("id, closing_date, family").eq("id", tenderId).maybeSingle();
  if (!tender) return null;
  const closingDate = (tender.closing_date as string | null) ?? null;
  const family = (tender.family as string | null) ?? null;

  if (family !== SANRAL_CONVENTIONAL_FAMILY) {
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

  const [{ data: company }, { data: pack }, { data: requirementRows }, { data: financial }, { data: briefing }] = await Promise.all([
    supabase
      .from("companies")
      .select(COMPANY_VAULT_COLUMNS)
      .maybeSingle(),
    supabase.from("tender_packs").select("id").eq("tender_id", tenderId).maybeSingle(),
    supabase.from("tender_requirements").select("position_code, position_description, managerial, is_alternate").eq("tender_id", tenderId),
    supabase.from("financial_captures").select("status").eq("tender_id", tenderId).maybeSingle(),
    supabase.from("tender_tasks").select("status, due_date").eq("tender_id", tenderId).eq("kind", "briefing").maybeSingle(),
  ]);

  const packId = (pack?.id as string | undefined) ?? null;
  let provenance: { field_key: string; status: string }[] = [];
  let assignments: Assignment[] = [];
  if (packId) {
    const [{ data: prov }, { data: asg }] = await Promise.all([
      supabase.from("field_provenance").select("field_key, status").eq("tender_pack_id", packId),
      supabase
        .from("tender_pack_assignments")
        .select("position_code, confirmed_person_id, suggested_person_id, specialism_warning")
        .eq("tender_pack_id", packId)
        .order("position_code", { ascending: true }),
    ]);
    provenance = (prov ?? []) as typeof provenance;
    assignments = (asg ?? []) as Assignment[];
  }

  const requirements = ((requirementRows ?? []) as Requirement[]).filter((r) => !r.is_alternate);
  // Positions: the tender's own requirement rows when seeded; otherwise the
  // pack's assignment rows (seed_supabase_company.py writes those from the
  // CLI pack, while tender_requirements isn't seeded by anything yet).
  const positionCodes = Array.from(new Set([...requirements.map((r) => r.position_code), ...assignments.map((a) => a.position_code)]));

  const personIds = Array.from(
    new Set(assignments.flatMap((a) => [a.confirmed_person_id, a.suggested_person_id]).filter((x): x is string => !!x)),
  );
  let people: PersonRow[] = [];
  let projects: ProjectRow[] = [];
  let cvUploads: CvUpload[] = [];
  let generatedCvs: GeneratedCvRow[] = [];
  if (personIds.length > 0) {
    const [{ data: ppl }, { data: prj }, { data: cvs }, { data: gen }] = await Promise.all([
      supabase.from("people").select("id, name, ecsa_level, ecsa_number, initial_graduated").in("id", personIds),
      supabase.from("projects").select("person_id, client_type, project_type, position_code, start_date, end_date").in("person_id", personIds),
      supabase.from("cv_uploads").select("person_id, mode, original_filename, created_at").in("person_id", personIds).order("created_at", { ascending: false }),
      supabase.from("generated_cvs").select("position_code, status").eq("tender_id", tenderId),
    ]);
    people = (ppl ?? []) as PersonRow[];
    projects = (prj ?? []) as ProjectRow[];
    cvUploads = (cvs ?? []) as CvUpload[];
    generatedCvs = (gen ?? []) as GeneratedCvRow[];
  }

  // Company experience (Experience Library, migration 0012): SANRAL B6 asks
  // for completed projects "of similar scope" in the last 10 years. Every
  // tender in this family is SANRAL roads consulting, so "similar scope" is
  // read as the roads_civil discipline tag - stated in the UI, not hidden.
  const companyId = (company?.id as string | undefined) ?? null;
  const asOf = closingDate ? closingDate.slice(0, 10) : undefined;
  const experience = companyId
    ? await findMatchingExperience(supabase, companyId, { disciplines: ["roads_civil"], completedWithinYears: 10, asOf })
    : { items: [] as ExperienceItem[], error: "No company record." };
  const experienceAvailable = experience.error === null;
  const expItems = experience.items;
  const experienceSummary = {
    qualifyingCount: expItems.length,
    scoreableCount: expItems.filter((i) => isScoreableEvidence(i.document_type)).length,
    ratedCount: expItems.filter((i) => isScoreableEvidence(i.document_type) && !!i.performance_rating).length,
  };

  const vault = (company as unknown as CompanyVault | null) ?? null;
  const qualitySystem = qualitySystemFromVault(vault, closingDate);
  const beeProofValid = beeProofValidAtClosing(vault, closingDate);
  const docItems = sanralConventionalDocumentChecks({
    company: vault,
    closingDate,
    provenance,
    hasPack: !!packId,
    financialCaptureStatus: (financial?.status as "draft" | "complete" | undefined) ?? null,
    briefingTask: (briefing as { status: string; due_date: string | null } | null) ?? null,
    experience: experienceSummary,
    experienceAvailable,
  });

  const personById = new Map(people.map((p) => [p.id, p]));
  const positionRows = positionCodes.map((code) => {
    const req = requirements.find((r) => r.position_code === code) ?? null;
    const asg = assignments.find((a) => a.position_code === code) ?? null;
    const person = asg?.confirmed_person_id ? personById.get(asg.confirmed_person_id) ?? null : null;
    const suggested = !person && asg?.suggested_person_id ? personById.get(asg.suggested_person_id) ?? null : null;
    const min = checkMinimumRequirement(code, person, closingDate);
    const cv = person ? cvUploads.find((c) => c.person_id === person.id) ?? null : null;
    const tenderCv = generatedCvs.find((g) => g.position_code === code) ?? null;
    const personProjects = person ? projects.filter((p) => p.person_id === person.id) : [];
    return { code, req, asg, person, suggested, min, cv, tenderCv, personProjects };
  });

  const estimate =
    closingDate && positionRows.length > 0
      ? estimateSanralConventional({
          closingDate,
          positions: positionRows.map((p) => ({
            positionCode: p.code,
            description: p.req?.position_description ?? null,
            managerial: p.req ? p.req.managerial : null,
            tenderProjectType: null, // SETUP row 9 isn't stored in the schema - see sanralScoring.ts
            person: p.person ? { name: p.person.name, projects: p.personProjects } : null,
          })),
          pastPerformance: experienceAvailable ? pastPerformanceFromExperience(expItems) : null,
          qualitySystem,
        })
      : null;

  const groups: { status: ComplianceStatus; title: string; empty: string }[] = [
    { status: "missing", title: "Don't have", empty: "Nothing required is missing." },
    { status: "check", title: "Confirm by hand", empty: "Nothing left to confirm." },
    { status: "have", title: "On file", empty: "Nothing confirmed on file yet." },
  ];
  const mandatoryFailing = docItems.filter((i) => i.mandatory && i.status === "missing").length;

  return (
    <>
      {/* Required documents */}
      <div style={card}>
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
      <div style={card}>
        <SectionTitle title="Key people & CVs" />
        <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
          Each key position against SANRAL&apos;s minimum requirements (C3.1.11), with the CV on file and the
          tender-specific CV status.
        </div>
        {positionRows.length === 0 && (
          <div style={{ fontSize: 12, color: "#9A9684" }}>
            No key positions recorded for this tender yet - they come from the tender pack once it&apos;s created.
          </div>
        )}
        {positionRows.map((p) => {
          const minSt = STATUS_STYLE[p.min.status];
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
                  {p.min.requirement && <div style={{ fontSize: 11, color: "#9A9684", marginTop: 2 }}>Needs: {p.min.requirement}</div>}
                </div>
                <Chip label={`Minimum: ${minSt.label === "On file" ? "met" : minSt.label === "Don't have" ? "not met" : "unconfirmed"}`} bg={minSt.bg} color={minSt.color} />
              </div>
              <div style={{ fontSize: 12, color: p.min.status === "missing" ? "#B91C1C" : "#6B6758", marginTop: 4 }}>{p.min.detail}</div>
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
      <ExperienceSection available={experienceAvailable} error={experience.error} items={expItems} closingDate={closingDate} />

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
    <div style={card}>
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
                ? " (proof on file is valid at closing - certificate or sworn affidavit both count)"
                : ", once valid proof (certificate or QSE/EME sworn affidavit) with an expiry after closing is in the vault"
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
}: {
  available: boolean;
  error: string | null;
  items: ExperienceItem[];
  closingDate: string | null;
}) {
  if (!available) {
    return (
      <div style={{ ...card, background: "#FFFBEB", border: "1px dashed #F5D08A" }}>
        <SectionTitle title="Company experience" />
        <div style={{ fontSize: 12, color: "#92400E" }}>
          Couldn&apos;t read the Experience Library ({error}). SANRAL scores past performance (Form B6, 15 points) on 3
          completed projects of similar scope in the last 10 years, evidenced by rated reference letters or CIDB PSP
          reports.
        </div>
      </div>
    );
  }
  const scoreable = items.filter((i) => isScoreableEvidence(i.document_type));
  const ok = scoreable.length >= 3;
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <SectionTitle title="Company experience" />
        <Chip
          label={`${scoreable.length} of 3 for Form B6`}
          bg={ok ? "#DCFCE7" : scoreable.length > 0 ? "#FEF3C7" : "#FEE2E2"}
          color={ok ? "#15803D" : scoreable.length > 0 ? "#B45309" : "#B91C1C"}
        />
      </div>
      <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 8 }}>
        Tagged roads &amp; civil projects in your Experience Library completed within 10 years of
        {closingDate ? ` ${new Date(closingDate).toLocaleDateString()}` : " closing"}. SANRAL&apos;s Form B6 scores reference
        letters and CIDB performance reports; other evidence proves the project but doesn&apos;t score.
      </div>
      {items.length === 0 && (
        <div style={{ fontSize: 12, color: "#B91C1C" }}>
          None tagged yet. <Link href="/experience" style={{ color: "#D97706", fontWeight: 600 }}>Add experience</Link> - without
          it, B6 falls back to the sworn affidavit at &apos;Adequate&apos;.
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
          {isScoreableEvidence(i.document_type) ? (
            i.performance_rating ? (
              <Chip label={`Rated ${i.performance_rating}`} bg="#DCFCE7" color="#15803D" />
            ) : (
              <Chip label="Rating not tagged" bg="#FEF3C7" color="#B45309" />
            )
          ) : (
            <Chip label="Doesn't score for B6" bg="#F0EEE6" color="#6B6758" />
          )}
        </div>
      ))}
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
