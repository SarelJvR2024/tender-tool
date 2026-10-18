import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_VAULT_COLUMNS, validityAtClosing, type ComplianceStatus } from "@/lib/tenderCompliance";
import { CATALOG_BODIES, REGISTRATION_BODY_INFO, bodyKeys, catalogSlug, isCatalogBody, isColumnBody, isRequiredBody, type PersonCredentialFields } from "@/lib/personCredentials";
import {
  FORM_STATUS_STYLE,
  GENERAL_COMPANY_COLUMNS,
  GENERAL_ENGINE,
  JOB_COLUMNS,
  JOBS_TABLE,
  JOB_STATUS_STYLE,
  PACK_BUCKET,
  checkReturnable,
  companyFieldStates,
  questionStates,
  type EngineJob,
  type GeneralCompany,
  type RequirementManifest,
  type TenderAnswer,
} from "@/lib/generalTender";
import { describeRule, evaluateEvidence, acceptedDocTypes, type EvaluationRules } from "@/lib/experienceEvidence";
import { DOCUMENT_TYPES, findMatchingExperience, labelFor } from "@/lib/experience";
import { COMPANY_OFFICE_COLUMNS, matchLocality, type CompanyOffice, type LocalityRow } from "@/lib/locality";
import { TENDER_ROLE_COLUMNS, type RoleTag, type TenderRole } from "@/lib/tenderRoles";
import { requestGeneralPack, requestRequirementsExtraction, saveGeneralAnswers, uploadTenderDocument } from "./general-actions";
import { OcrNotice, OCR_TAG } from "./ocr-notice";
import { PackChecklist, checklistOf } from "./pack-checklist";
import { PrivateDocuments, type PrivateDoc } from "./private-documents";

/**
 * Non-SANRAL tender preparation (Sarel, 2026-10-16: "keep working on
 * automating the non-SANRAL tender preparation and the UI for capturing info
 * needed for the tender"). Mounted on the Tender Workspace for tenders whose
 * family is GENERAL_FAMILY, in place of the SANRAL compliance report.
 *
 *  1. What THIS tender needs - read from its own documents
 *     (tenders.document_requirements, engine/general/requirements.py).
 *  2. Supporting documents - each checked against the vault, or uploaded for
 *     this tender when the vault has no field for it.
 *  3. Questions only a person can answer - only the ones this tender's forms
 *     need; company-level facts are saved to the company, asked once.
 *  4. Key people, experience, locality - the same generic checks the SANRAL
 *     report uses (role tags, experience_matches(), matchLocality()).
 *  5. Generate the pack - a request for engine/general/process_general_jobs.py.
 */

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };
const STATUS_STYLE: Record<ComplianceStatus, { label: string; bg: string; color: string }> = {
  have: { label: "On file", bg: "#DCFCE7", color: "#15803D" },
  missing: { label: "Don't have", bg: "#FEE2E2", color: "#B91C1C" },
  check: { label: "Confirm by hand", bg: "#FEF3C7", color: "#B45309" },
};
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 38, padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 13, fontFamily: "inherit", background: "#FFFFFF", color: "#16233B" };
const primaryBtn: React.CSSProperties = { minHeight: 40, padding: "0 16px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" };
const secondaryBtn: React.CSSProperties = { minHeight: 34, padding: "0 12px", borderRadius: 8, background: "#FFFFFF", border: "1px solid #E5E1D5", color: "#16233B", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };

type Person = PersonCredentialFields & { id: string; name: string; signatory_capacity: string | null; role: string | null };

export async function GeneralTenderWorkspace({ tenderId, saved = null }: { tenderId: string; saved?: string | null }) {
  const supabase = await createClient();
  const { data: tender } = await supabase
    .from("tenders")
    .select("id, contract_no, description, buyer, closing_date, document_urls, document_requirements, evaluation_rules, owner_company_id")
    .eq("id", tenderId)
    .maybeSingle();
  if (!tender) return null;
  // A shared tender (found by Discovery) can carry this company's own private
  // documents (0032); when it does, this company's reading of the tender is
  // on its tender_packs row and wins over the shared one.
  const isShared = !tender.owner_company_id;
  const [{ data: ownPack }, { data: privateRows }] = await Promise.all([
    supabase.from("tender_packs").select("id, company_id, document_requirements, intake").eq("tender_id", tenderId).maybeSingle(),
    isShared
      ? supabase.from("tender_private_documents").select("id, title, storage_path, created_at").eq("tender_id", tenderId).order("created_at")
      : Promise.resolve({ data: [] as PrivateDoc[] }),
  ]);
  const privateDocs = (privateRows ?? []) as PrivateDoc[];
  const privateRead = new Set(((ownPack?.intake as { private_documents?: string[] } | null)?.private_documents ?? []) as string[]);
  const readingIsPrivate = !!ownPack?.document_requirements && privateDocs.length > 0 && privateDocs.every((d) => privateRead.has(d.id));
  const manifest = ((ownPack?.document_requirements ?? tender.document_requirements) as RequirementManifest | null) ?? null;
  const closingDate = (tender.closing_date as string | null) ?? null;
  const docUrls = ((tender.document_urls as { url: string | null; title: string | null }[] | null) ?? []).filter((d) => d.url);

  const [{ data: companyRow }, { data: answerRows }, { data: jobRows }, { data: peopleRows }, { data: roleRows }, { data: tagRows }, { data: officeRows }] =
    await Promise.all([
      supabase.from("companies").select(`${COMPANY_VAULT_COLUMNS}, ${GENERAL_COMPANY_COLUMNS}`).maybeSingle(),
      supabase.from("tender_answers").select("field_key, value, storage_path, original_filename, updated_at").eq("tender_id", tenderId),
      supabase.from(JOBS_TABLE).select(JOB_COLUMNS).eq("engine", GENERAL_ENGINE).eq("tender_id", tenderId).order("requested_at", { ascending: false }).limit(10),
      supabase.from("people").select("id, name, signatory_capacity, role, sacnasp_category, sacnasp_number, sacnasp_expiry, sagc_category, sagc_number, sagc_expiry").order("name"),
      supabase.from("tender_roles").select(TENDER_ROLE_COLUMNS),
      supabase.from("person_role_eligibility").select("person_id, role_code, notes"),
      supabase.from("company_offices").select(COMPANY_OFFICE_COLUMNS),
    ]);
  const company = (companyRow as unknown as GeneralCompany | null) ?? null;
  const answers = (answerRows ?? []) as TenderAnswer[];
  const jobs = (jobRows ?? []) as EngineJob[];
  const people = (peopleRows ?? []) as Person[];
  const roles = (roleRows ?? []) as TenderRole[];
  const tags = (tagRows ?? []) as RoleTag[];
  const offices = (officeRows ?? []) as CompanyOffice[];
  const extractJob = jobs.find((j) => j.kind === "extract_requirements") ?? null;
  const packJobs = jobs.filter((j) => j.kind === "generate_pack");

  const savedNote =
    saved === "answers" ? "Answers saved." : saved === "doc" ? "Document uploaded." : saved === "pack" ? "Pack requested - it appears below when ready." : saved === "extract" ? "Requested - the tender's documents are being read." : null;

  const privateCard =
    isShared && ownPack ? (
      <PrivateDocuments tenderId={tenderId} companyId={ownPack.company_id as string} docs={privateDocs} readingIsPrivate={readingIsPrivate} />
    ) : null;

  if (!manifest) {
    return (
      <>
      {privateCard}
      <div id="general-preparation" style={card}>
        <SectionTitle title="Tender preparation" />
        {savedNote && <SavedBanner text={savedNote} />}
        <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
          This isn&apos;t a SANRAL tender, so what it needs is read from <strong>its own documents</strong> - every buyer sets its own
          forms and returnable list (some use National Treasury&apos;s SBD forms, municipalities the MBD twin, ESKOM its own).
          Nothing is listed here until those documents have been read.
        </div>
        {extractJob && extractJob.status !== "ready" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "#16233B" }}>
            <Chip {...JOB_STATUS_STYLE[extractJob.status]} />
            {extractJob.status === "failed"
              ? <span style={{ color: "#B91C1C" }}>Couldn&apos;t read the documents: {extractJob.error_message}</span>
              : <span>Reading {docUrls.length} published document{docUrls.length === 1 ? "" : "s"}{privateDocs.length > 0 ? ` and ${privateDocs.length} private one${privateDocs.length === 1 ? "" : "s"}` : ""} - requested {new Date(extractJob.requested_at).toLocaleString()}.</span>}
          </div>
        ) : null}
        {(!extractJob || extractJob.status === "failed") && (
          <form action={requestRequirementsExtraction} style={{ marginTop: 10 }}>
            <input type="hidden" name="tender_id" value={tenderId} />
            <button type="submit" style={primaryBtn} disabled={docUrls.length === 0 && privateDocs.length === 0}>
              {extractJob ? "Try reading the documents again" : "Read this tender's documents"}
            </button>
            {docUrls.length === 0 && privateDocs.length === 0 && (
              <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 6 }}>
                No document links are on file for this tender{isShared ? " - add your own copy under Your private documents above" : ""}.
              </div>
            )}
          </form>
        )}
      </div>
      </>
    );
  }

  // ----- supporting documents -----
  const jvAnswer = answers.find((a) => a.field_key === "bidding_as_jv")?.value ?? null;
  const returnables = manifest.returnables.map((r) => checkReturnable(r, company, closingDate, answers, jvAnswer === null ? null : jvAnswer === "yes"));
  const qStates = questionStates(manifest.questions, answers, company);
  const cStates = companyFieldStates(manifest.company_fields, company);
  const needAnswer = qStates.filter((s) => !s.answered && !s.q.optional).length + cStates.filter((s) => !s.answered && !s.f.optional).length;
  const docsMissing = returnables.filter((r) => r.status === "missing").length;
  const autoForms = manifest.forms.filter((f) => f.status === "auto");
  const byHandForms = manifest.forms.filter((f) => f.status === "by_hand");
  const typedForms = manifest.forms.filter((f) => f.status === "overlay");

  // ----- per-person registrations the tender requires (0040) -----
  const personRegs = (manifest.person_registrations ?? []).filter((pr) => isRequiredBody(pr.body));
  // Catalog bodies (0050 held_registrations: SACAP, SACPLAN, SACQSP, SACPVP,
  // PSIRA) - read only when this tender asks for one of them.
  type HeldRow = { person_id: string | null; principal_id: string | null; registration_number: string | null; category: string | null; expiry_date: string | null; registration_types: { slug: string } };
  const askedCatalog = personRegs.filter((pr) => isCatalogBody(pr.body)).map((pr) => catalogSlug(pr.body as (typeof CATALOG_BODIES)[number]));
  const { data: heldRows } = askedCatalog.length
    ? await supabase
        .from("held_registrations")
        .select("person_id, principal_id, registration_number, category, expiry_date, registration_types!inner(slug)")
        .in("registration_types.slug", askedCatalog)
    : { data: [] };
  const held = (heldRows ?? []) as unknown as HeldRow[];
  /** Who holds a required body: {name, category, expiry} - people columns (SACNASP/SAGC) or catalog rows. */
  const holdersOf = (body: string): { name: string; category: string | null; expiry: string | null }[] => {
    if (isColumnBody(body)) {
      const k = bodyKeys(body);
      return people.filter((p) => p[k.number] || p[k.category]).map((p) => ({ name: p.name, category: p[k.category] ?? null, expiry: p[k.expiry] ?? null }));
    }
    if (!isCatalogBody(body)) return [];
    return held
      .filter((h) => h.registration_types.slug === catalogSlug(body))
      .map((h) => ({
        name: h.person_id ? people.find((p) => p.id === h.person_id)?.name ?? "a person" : h.principal_id ? "a director / shareholder" : "the company",
        category: h.category,
        expiry: h.expiry_date,
      }));
  };

  // ----- key people -----
  const roleRowsForTender = manifest.roles.map((mr) => {
    const role = roles.find((r) => r.code === mr.role_code) ?? null;
    const tagged = tags.filter((t) => t.role_code === mr.role_code).map((t) => people.find((p) => p.id === t.person_id)).filter((p): p is Person => !!p);
    return { mr, role, tagged };
  });

  // ----- experience (the tender's own rule; never SANRAL's B6 here) -----
  // The shared tender's stored rules - unless this company's own reading
  // (with its private documents) is in use: that one is the fuller read.
  const rules = readingIsPrivate ? null : ((tender.evaluation_rules as EvaluationRules | null) ?? null);
  const evidenceRules = (rules?.experience_evidence?.rules?.length ? rules.experience_evidence.rules : manifest.experience_evidence.rules) ?? [];
  const chosen = evidenceRules.length > 0 ? { rule: evidenceRules[0], source: "tender_document" as const, otherRules: evidenceRules.length - 1 } : null;
  const experience = chosen && company?.id
    ? await findMatchingExperience(supabase, company.id, {
        ...(chosen.rule.window_years ? { completedWithinYears: chosen.rule.window_years } : {}),
        ...(closingDate ? { asOf: closingDate.slice(0, 10) } : {}),
      })
    : null;
  const evidenceEval = chosen && experience && !experience.error ? evaluateEvidence(chosen, experience.items, false) : null;

  // ----- locality -----
  const locRows = ((rules?.locality?.rows?.length ? rules.locality.rows : manifest.locality.rows) ?? []) as LocalityRow[];
  const mandatory = rules?.locality?.mandatory_local_office ?? manifest.locality.mandatory_local_office;

  // ----- pack downloads -----
  const latestPack = packJobs[0] ?? null;
  const signed: Record<string, string> = {};
  const paths = packJobs.flatMap((j) => [j.storage_path_pdf, ...Object.values(j.output_files ?? {})]).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const res = await Promise.all(paths.map((p) => supabase.storage.from(PACK_BUCKET).createSignedUrl(p, 600)));
    res.forEach((r, i) => { if (r.data?.signedUrl) signed[paths[i]] = r.data.signedUrl; });
  }
  const answerByKey = new Map(answers.map((a) => [a.field_key, a]));

  return (
    <>
      {privateCard}
      {/* 1. What this tender needs */}
      <div id="general-preparation" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <SectionTitle title="What this tender needs" />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {needAnswer > 0 ? <Chip label={`${needAnswer} to answer`} bg="#FEF3C7" color="#B45309" /> : <Chip label="All questions answered" bg="#DCFCE7" color="#15803D" />}
            {docsMissing > 0 && <Chip label={`${docsMissing} document${docsMissing === 1 ? "" : "s"} missing`} bg="#FEE2E2" color="#B91C1C" />}
          </div>
        </div>
        {savedNote && <SavedBanner text={savedNote} />}
        <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
          Read from {manifest.documents.length} {readingIsPrivate ? "" : "published "}document{manifest.documents.length === 1 ? "" : "s"}
          {readingIsPrivate ? ` (including your ${privateDocs.length} private one${privateDocs.length === 1 ? "" : "s"})` : ""}
          {tender.buyer ? ` by ${tender.buyer}` : ""} on {new Date(manifest.extracted_at).toLocaleDateString()}.{" "}
          {manifest.form_suite === "MBD"
            ? "This buyer uses the municipal MBD forms (same fields as National Treasury's SBD forms)."
            : manifest.form_suite === "SBD"
              ? "This buyer uses National Treasury's SBD forms."
              : manifest.document_depth && manifest.document_depth !== "full_document"
                ? "No SBD/MBD standard forms were found - but only an advert or partial document was read, so that isn't known yet (see below)."
                : manifest.documents.some((d) => d.unreadable)
                  ? "No SBD/MBD standard forms were found in the documents that could be read (some couldn't - see below)."
                  : "This buyer uses no SBD/MBD standard forms - only its own."}
        </div>

        {manifest.gaps.length > 0 && (
          <div style={{ background: "#FEF3C7", border: "1px solid #F5D08A", borderRadius: 9, padding: "9px 12px", marginBottom: 12, fontSize: 12, color: "#92400E" }}>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>What Tender Tool can&apos;t do for this tender</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {manifest.gaps.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          </div>
        )}
        <OcrNotice documents={manifest.documents} />

        {manifest.forms.length > 0 && (
          <>
            <SubTitle text={`Standard forms (${autoForms.length} filled for you, ${typedForms.length > 0 ? `${typedForms.length} typed onto the buyer's PDF, ` : ""}${byHandForms.length} by hand)`} />
            {manifest.forms.map((f) => {
              const st = FORM_STATUS_STYLE[f.status];
              return (
                <div key={f.code} style={{ borderTop: "1px solid #F0EEE6", padding: "8px 0", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: "1 1 300px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <FormTag text={f.label} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{f.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#4B5563", marginTop: 3 }}>{f.reason}</div>
                  </div>
                  <Chip {...st} />
                </div>
              );
            })}
          </>
        )}

        {manifest.buyer_forms.length > 0 && (
          <>
            <SubTitle text="The buyer's own forms" />
            {manifest.buyer_forms.map((b) => (
              <div key={b.key} style={{ borderTop: "1px solid #F0EEE6", padding: "7px 0", fontSize: 12, color: "#16233B", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ minWidth: 0, flex: "1 1 280px", wordBreak: "break-word" }}>
                  {b.label}{b.document && b.document !== b.label ? <span style={{ color: "#9A9684" }}> - in {b.document}</span> : null}
                  {b.overlay && <span style={{ display: "block", color: "#4B5563", marginTop: 2 }}>{b.reason}</span>}
                </span>
                {b.overlay ? <Chip label="Typed onto the PDF" bg="#DCFCE7" color="#15803D" /> : <Chip label="Complete by hand" bg="#FEF3C7" color="#B45309" />}
              </div>
            ))}
          </>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, fontSize: 12, color: "#4B5563" }}>
          {manifest.scoring.preference_system.system && manifest.scoring.preference_system.system !== "not_found" && (
            <Chip label={`Preference: ${manifest.scoring.preference_system.system}`} bg="#F0EEE6" color="#16233B" />
          )}
          {manifest.scoring.functionality.threshold ? <Chip label={`Functionality minimum ${manifest.scoring.functionality.threshold}`} bg="#F0EEE6" color="#16233B" /> : null}
          {manifest.cidb && <Chip label={`CIDB ${manifest.cidb.grading}`} bg="#F0EEE6" color="#16233B" />}
          {manifest.briefing?.compulsory && <Chip label="Compulsory briefing" bg="#FEE2E2" color="#B91C1C" />}
        </div>
      </div>

      {/* 2. Supporting documents */}
      <div id="general-documents" style={card}>
        <SectionTitle title="Supporting documents" />
        <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 8 }}>
          Each one is named in this tender&apos;s documents (hover the row for the exact words). Checked against your{" "}
          <Link href="/company" style={{ color: "#D97706", fontWeight: 600 }}>company vault</Link> on the closing date; anything the vault has no
          place for can be uploaded for this tender only.
        </div>
        {returnables.length === 0 && <div style={{ fontSize: 12, color: "#9A9684" }}>No supporting documents named in the readable text.</div>}
        {returnables.map((r) => {
          const st = STATUS_STYLE[r.status];
          return (
            <div key={r.key} title={r.quote} style={{ borderTop: "1px solid #F0EEE6", padding: "10px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ minWidth: 0, flex: "1 1 280px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>
                    {r.label}
                    {r.strength === "mentioned" && <span style={{ fontWeight: 500, color: "#9A9684" }}> - mentioned, may not be required</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#4B5563", marginTop: 2 }}>{r.detail}</div>
                  <div style={{ fontSize: 11, color: "#9A9684", fontStyle: "italic", marginTop: 2, wordBreak: "break-word" }}>{r.from_ocr ? OCR_TAG : ""}&ldquo;{r.quote.slice(0, 160)}{r.quote.length > 160 ? "…" : ""}&rdquo;</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {r.expiring && <Chip label="Renew soon" bg="#FEF3C7" color="#B45309" />}
                  <Chip {...st} />
                </div>
              </div>
              {(r.uploadable || r.vaultLink) && r.status !== "have" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                  {r.uploadable && (
                    <form action={uploadTenderDocument} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <input type="hidden" name="tender_id" value={tenderId} />
                      <input type="hidden" name="returnable_key" value={r.key} />
                      <input type="file" name="file" required accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" aria-label={`Upload ${r.label}`} style={{ fontSize: 12, color: "#16233B", maxWidth: "100%" }} />
                      <button type="submit" style={secondaryBtn}>{r.upload ? "Replace" : "Upload for this tender"}</button>
                    </form>
                  )}
                  {r.vaultLink && <Link href="/company" style={{ fontSize: 12, color: "#D97706", fontWeight: 600 }}>Fix in the vault</Link>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 3. Questions only you can answer */}
      <div id="general-questions" style={card}>
        <SectionTitle title="Questions only you can answer" />
        <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
          Only what this tender&apos;s forms ask that isn&apos;t already on file. Company details are saved to your company, so the next tender
          has them. Anything left blank is left blank on the form and listed as &quot;by hand&quot; in the pack - never guessed.
        </div>
        {qStates.length === 0 && cStates.length === 0 ? (
          <div style={{ fontSize: 12, color: "#9A9684" }}>This tender&apos;s forms need nothing beyond what&apos;s on file.</div>
        ) : (
          <form action={saveGeneralAnswers}>
            <input type="hidden" name="tender_id" value={tenderId} />
            {cStates.length > 0 && (
              <>
                <SubTitle text="Company details (asked once)" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 6 }}>
                  {cStates.map(({ f, value }) => (
                    <label key={f.key} style={{ display: "block" }} title={f.help}>
                      <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>
                        {f.label}{f.optional ? <span style={{ fontWeight: 400, color: "#9A9684" }}> (optional)</span> : null}
                      </span>
                      <input name={`c:${f.column}`} defaultValue={value ?? ""} style={input} type={f.column === "email" ? "email" : "text"} />
                    </label>
                  ))}
                </div>
              </>
            )}
            {Array.from(new Set(qStates.map((s) => s.q.group))).map((group) => (
              <div key={group}>
                <SubTitle text={group} />
                {qStates.filter((s) => s.q.group === group).map(({ q, value, answered, defaultValue }) => (
                  <div key={q.key} style={{ borderTop: "1px solid #F0EEE6", padding: "9px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0, flex: "1 1 300px" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{q.label}</div>
                        <div style={{ fontSize: 11, color: "#6B6758", marginTop: 2 }}>{q.help}</div>
                      </div>
                      {answered ? <Chip label="Answered" bg="#DCFCE7" color="#15803D" /> : q.optional ? <Chip label="Optional" bg="#F0EEE6" color="#6B6758" /> : <Chip label="Needs your answer" bg="#FEF3C7" color="#B45309" />}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      {q.type === "yes_no" && (
                        <div style={{ display: "flex", gap: 14, fontSize: 13, color: "#16233B" }}>
                          {(["no", "yes"] as const).map((v) => (
                            <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32 }}>
                              <input type="radio" name={`q:${q.key}`} value={v} defaultChecked={(value ?? defaultValue) === v} />
                              {v === "yes" ? "Yes" : "No"}
                            </label>
                          ))}
                        </div>
                      )}
                      {q.type === "text" && <input name={`q:${q.key}`} defaultValue={value ?? ""} style={{ ...input, maxWidth: 420 }} />}
                      {q.type === "person" && (
                        <select name={`q:${q.key}`} defaultValue={value ?? ""} style={{ ...input, maxWidth: 420 }}>
                          <option value="">Choose who signs…</option>
                          {people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}{p.signatory_capacity ? ` - ${p.signatory_capacity}` : " - no signatory capacity on file"}
                            </option>
                          ))}
                        </select>
                      )}
                      {q.type === "person" && value && !people.find((p) => p.id === value)?.signatory_capacity && (
                        <div style={{ fontSize: 11, color: "#B45309", marginTop: 4 }}>
                          This person has no signatory capacity on file - add it on their People page so SBD 1 / SBD 4 can show it.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ marginTop: 12 }}>
              <button type="submit" style={primaryBtn}>Save answers</button>
            </div>
          </form>
        )}
      </div>

      {/* 4. Key people, experience, locality */}
      {(roleRowsForTender.length > 0 || personRegs.length > 0 || chosen || locRows.length > 0 || mandatory) && (
        <div id="general-people" style={card}>
          <SectionTitle title="People, experience and locality" />
          {personRegs.length > 0 && (
            <>
              <SubTitle text="Professional registrations this tender asks for" />
              {personRegs.map((pr) => {
                const holders = holdersOf(pr.body);
                const valid = holders.filter((p) => !p.expiry || validityAtClosing(p.expiry, closingDate).status === "have");
                const st = valid.length > 0 ? STATUS_STYLE.have : holders.length > 0 ? STATUS_STYLE.check : STATUS_STYLE.missing;
                return (
                  <div key={pr.body} title={pr.quote} style={{ borderTop: "1px solid #F0EEE6", padding: "8px 0", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: "1 1 280px" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{pr.body} registration ({REGISTRATION_BODY_INFO[pr.body].name})</div>
                      <div style={{ fontSize: 12, color: "#4B5563" }}>
                        {holders.length > 0
                          ? `On file: ${holders.map((p) => `${p.name}${p.category ? ` (${p.category})` : ""}${p.expiry ? `, valid to ${p.expiry}` : ", renewal date not on file"}`).join("; ")}`
                          : `Nobody has a ${pr.body} registration on file - add it on the person's page (it shows there now that this tender asks for it)${isCatalogBody(pr.body) ? " or under Company > Registrations" : ""}.`}
                      </div>
                      <div style={{ fontSize: 11, color: "#9A9684", fontStyle: "italic", wordBreak: "break-word" }}>{pr.from_ocr ? OCR_TAG : ""}&ldquo;{pr.quote.slice(0, 150)}…&rdquo;</div>
                    </div>
                    <Chip {...st} label={valid.length > 0 ? "On file" : holders.length > 0 ? "Lapses before closing" : "Not on file"} />
                  </div>
                );
              })}
            </>
          )}
          {roleRowsForTender.length > 0 && (
            <>
              <SubTitle text="Roles this tender names" />
              {roleRowsForTender.map(({ mr, role, tagged }) => (
                <div key={mr.role_code} title={mr.quote} style={{ borderTop: "1px solid #F0EEE6", padding: "8px 0", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: "1 1 280px" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{role?.title ?? mr.role_code}</div>
                    <div style={{ fontSize: 12, color: "#4B5563" }}>
                      {tagged.length > 0 ? `Tagged for this role: ${tagged.map((p) => p.name).join(", ")}` : "Nobody tagged for this role yet - tag CVs on the People page."}
                    </div>
                    <div style={{ fontSize: 11, color: "#9A9684", fontStyle: "italic", wordBreak: "break-word" }}>{mr.from_ocr ? OCR_TAG : ""}&ldquo;{mr.quote.slice(0, 150)}…&rdquo;</div>
                  </div>
                  <Chip {...(tagged.length > 0 ? STATUS_STYLE.have : STATUS_STYLE.missing)} label={tagged.length > 0 ? "Someone tagged" : "Nobody tagged"} />
                </div>
              ))}
            </>
          )}
          {chosen && (
            <>
              <SubTitle text="Company experience this tender accepts" />
              <div style={{ fontSize: 12, color: "#16233B", marginBottom: 4 }}>
                {describeRule(chosen.rule)}{chosen.rule.scope ? ` - scope: ${chosen.rule.scope}` : ""}.
              </div>
              <div style={{ fontSize: 11, color: "#6B6758", fontStyle: "italic", marginBottom: 6, wordBreak: "break-word" }}>&ldquo;{chosen.rule.quote}&rdquo;</div>
              {experience?.error && <div style={{ fontSize: 12, color: "#92400E" }}>Couldn&apos;t read the Experience Library ({experience.error}).</div>}
              {evidenceEval && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, color: "#4B5563", flex: "1 1 280px" }}>
                    {evidenceEval.qualifying} item(s) in your <Link href="/experience" style={{ color: "#D97706", fontWeight: 600 }}>Experience Library</Link> count
                    {experience && experience.items.length > evidenceEval.qualifying ? `; ${experience.items.length - evidenceEval.qualifying} more are a document type this tender doesn't accept` : ""}.
                    {" "}Similar scope is for you to judge - all disciplines are counted here.
                    {experience?.items.filter((i) => acceptedDocTypes(chosen.rule).has(i.document_type)).slice(0, 5).map((i) => (
                      <div key={i.id} style={{ fontSize: 11, color: "#6B6758" }}>- {i.project_name} ({labelFor(DOCUMENT_TYPES, i.document_type)})</div>
                    ))}
                  </div>
                  <Chip {...STATUS_STYLE[evidenceEval.status]} />
                </div>
              )}
            </>
          )}
          {(locRows.length > 0 || mandatory) && (
            <>
              <SubTitle text="Office location" />
              {locRows.length > 0 && (() => {
                const m = matchLocality(locRows, offices);
                const st = m.status === "matched" ? STATUS_STYLE.have : m.status === "no_match" ? STATUS_STYLE.missing : STATUS_STYLE.check;
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 12, color: "#4B5563" }}>
                    <span style={{ flex: "1 1 280px" }}>{locRows.map((r) => `${r.area} ${r.points}`).join(" · ")} - {m.reason}</span>
                    <Chip {...st} label={m.status === "matched" ? `${m.points} pts` : m.status === "no_match" ? "0 pts" : "Unknown"} />
                  </div>
                );
              })()}
              {mandatory && (
                <div style={{ fontSize: 12, color: "#B91C1C", marginTop: 6 }}>
                  <strong>Mandatory:</strong> a local office in {mandatory.area}{mandatory.disqualifies ? " - non-responsive without one" : ""}.{" "}
                  {matchLocality([{ area: mandatory.area, level: "municipality", province: null, points: 0, system: null, kind: "specific_goals" }], offices).status === "matched" ? "You have one on file." : "None on file."}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 5. Generate the pack */}
      <div id="general-pack" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <SectionTitle title="Submission pack" />
          {latestPack && <Chip {...JOB_STATUS_STYLE[latestPack.status]} />}
        </div>
        <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
          One ordered PDF: contents page, the forms filled from your data and answers, a completion guide for every form that has to be
          done by hand, your vault documents, this tender&apos;s uploads, accepted experience evidence and the CVs of the people tagged for its
          roles. Built by Tender Tool&apos;s document engine (it can&apos;t run in the browser), so it appears here a minute or two after you ask.
        </div>
        {needAnswer > 0 && (
          <div style={{ fontSize: 12, color: "#B45309", marginBottom: 8 }}>
            {needAnswer} question{needAnswer === 1 ? "" : "s"} still unanswered - you can still generate a draft; those fields are left blank and listed.
          </div>
        )}
        {(!latestPack || latestPack.status === "ready" || latestPack.status === "failed") && (
          <form action={requestGeneralPack}>
            <input type="hidden" name="tender_id" value={tenderId} />
            <button type="submit" style={primaryBtn}>{latestPack ? "Generate a new pack" : "Generate submission pack"}</button>
          </form>
        )}
        {packJobs.map((j) => {
          const st = JOB_STATUS_STYLE[j.status];
          return (
            <div key={j.id} style={{ borderTop: "1px solid #F0EEE6", marginTop: 10, paddingTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "#6B6758" }}>
                <span>Requested {new Date(j.requested_at).toLocaleString()}</span>
                <Chip {...st} />
                {j.page_count ? <span>{j.page_count} pages</span> : null}
                {j.storage_path_pdf && signed[j.storage_path_pdf] && <a href={signed[j.storage_path_pdf]} style={{ color: "#D97706", fontWeight: 600 }}>Download PDF</a>}
                {Object.entries(j.output_files ?? {}).map(([name, p]) => signed[p] ? <a key={name} href={signed[p]} style={{ color: "#D97706", fontWeight: 600 }}>{name}</a> : null)}
              </div>
              {j.error_message && <div style={{ fontSize: 12, color: "#B91C1C", marginTop: 4 }}>{j.error_message}</div>}
              {j === latestPack && j.manifest && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#4B5563" }}>
                  {(j.manifest.by_hand ?? []).length > 0 && (
                    <>
                      <div style={{ fontWeight: 700, color: "#B45309", marginBottom: 2 }}>Still to do by hand ({j.manifest.by_hand!.length})</div>
                      <ul style={{ margin: "0 0 6px", paddingLeft: 18 }}>
                        {j.manifest.by_hand!.slice(0, 12).map((b, i) => <li key={i}>{b.title} - {b.reason}</li>)}
                      </ul>
                    </>
                  )}
                  <PackChecklist rows={checklistOf(j.manifest)} />
                </div>
              )}
            </div>
          );
        })}
        <div style={{ fontSize: 11, color: "#9A9684", marginTop: 10 }}>
          Signature, date and prices are never typed in for you.{" "}
          {answerByKey.get("total_bid_price")?.value ? "Your total bid price answer is written on SBD 1." : ""}
        </div>
      </div>
    </>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>{title}</div>;
}

function SubTitle({ text }: { text: string }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: "#16233B", margin: "12px 0 4px" }}>{text}</div>;
}

function FormTag({ text }: { text: string }) {
  return <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "#16233B", background: "#F0EEE6", borderRadius: 100, padding: "2px 7px" }}>{text}</span>;
}

function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function SavedBanner({ text }: { text: string }) {
  return (
    <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "8px 12px", margin: "6px 0 10px", fontSize: 12, color: "#15803D", fontWeight: 600 }}>
      {text}
    </div>
  );
}
