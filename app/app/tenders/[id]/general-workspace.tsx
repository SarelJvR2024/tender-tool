import Link from "next/link";
import { FileText } from "lucide-react";
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
import { OcrNotice } from "./ocr-notice";
import { PackChecklist, checklistOf } from "./pack-checklist";
import { PrivateDocuments, type PrivateDoc } from "./private-documents";
import { GeneralPackReview, MatchStrengthBadge } from "./general-pack-review";
import { loadGeneralPackReviewSnapshot } from "./general-pack-review-data";
import { computeTenderReadiness } from "./tender-readiness";
import { formatDate, formatDateTime, type StatusChip } from "@/lib/dates";
import { RequirementRow } from "@/components/tt/requirement-row";
import { QuickBlockerDrawer } from "./quick-blocker-drawer";
import { VAULT_DRAWER_CONFIG } from "./quick-fix-config";

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

// These 4 reusable CSSProperties constants use the var(--token) CSS-variable
// pattern (company/_components/ui.tsx's own established convention) rather
// than Tailwind className - too many spread call sites across this file to
// convert without a disproportionately large diff for a color-only pass
// (design-system color migration, batch 4, app/AGENTS.md).
const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };
const STATUS_STYLE: Record<ComplianceStatus, { label: string; className: string }> = {
  have: { label: "On file", className: "bg-success/10 text-success" },
  missing: { label: "Don't have", className: "bg-destructive/10 text-destructive" },
  check: { label: "Confirm by hand", className: "bg-warning/10 text-warning" },
};

// Requirements & Compliance tab brief (2026-10-25): the same have/missing/
// check meaning as STATUS_STYLE above, but RequirementRow's own 3 clean,
// unambiguous states for a vault-document check specifically - "have" is
// genuinely done (never re-labelled "Verify" the way bid-task-status.ts's
// separate Fix/Provide/Verify grouping would), "missing" is a real blocker,
// "check" is the one state that genuinely needs a human to confirm an
// uncertain match. tone "accent" renders blue (--accent, Trust Blue) via
// ChipBadge - matches the brief's own "Verification Needed: blue badge" ask.
const REQUIREMENT_STATUS_CHIP: Record<ComplianceStatus, StatusChip> = {
  have: { label: "Compliant (On File)", tone: "success" },
  missing: { label: "Action Required (Missing)", tone: "destructive" },
  check: { label: "Verification Needed", tone: "accent" },
};
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 38, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, fontFamily: "inherit", background: "var(--card)", color: "var(--foreground)" };
const primaryBtn: React.CSSProperties = { minHeight: 40, padding: "0 16px", borderRadius: 8, background: "var(--primary)", color: "var(--primary-foreground)", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" };
const secondaryBtn: React.CSSProperties = { minHeight: 34, padding: "0 12px", borderRadius: 8, background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };

// Mirrors lib/generalTender.ts's JOB_STATUS_STYLE semantics (queued/working
// -> warning, ready -> success, failed -> destructive) as Tailwind classes -
// kept local rather than changing that shared hex-based export, which
// intake-card.tsx still reads directly (its own JOB_BADGE_CLASS, batch 2).
const JOB_BADGE_CLASS: Record<string, string> = {
  requested: "bg-warning/10 text-warning",
  generating: "bg-warning/10 text-warning",
  ready: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
};

type Person = PersonCredentialFields & { id: string; name: string; signatory_capacity: string | null; role: string | null };

/**
 * One section per returned key, so the Tender Workspace's top-level tabs
 * (page.tsx, Phase 2 retab) can place each where it belongs (overview ->
 * Overview, documents/questions -> Compliance & Guard, people -> Team &
 * CVs, pack -> Pack compiler) instead of this component's own internal tab
 * bar - nothing here changed except the
 * return shape; every read, every computed value, every piece of JSX is
 * identical to before this split. "overview" is "What this tender needs"
 * (manifest/forms/scoring summary) plus the private-documents card - the
 * part that used to be mounted above this component's own WorkspaceTabs,
 * always visible, never buried.
 */
export type GeneralWorkspaceSections = {
  overview: React.ReactNode;
  documents: React.ReactNode;
  questions: React.ReactNode;
  people: React.ReactNode | null;
  pack: React.ReactNode;
  badges: { docsMissing: number; needAnswer: number; peopleGaps: number; generalFixCount: number };
};

export async function GeneralTenderWorkspace({ tenderId, saved = null }: { tenderId: string; saved?: string | null }): Promise<GeneralWorkspaceSections | null> {
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
    const overview = (
      <>
      {privateCard}
      <div id="general-preparation" style={card}>
        <SectionTitle title="Tender preparation" />
        {savedNote && <SavedBanner text={savedNote} />}
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 10 }}>
          What this tender needs is read from <strong>its own documents</strong> - every buyer sets its own
          forms and returnable list (some use National Treasury&apos;s SBD forms, municipalities the MBD twin, ESKOM its own).
          Nothing is listed here until those documents have been read.
        </div>
        {extractJob && extractJob.status !== "ready" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--foreground)" }}>
            <Chip label={JOB_STATUS_STYLE[extractJob.status].label} className={JOB_BADGE_CLASS[extractJob.status]} />
            {extractJob.status === "failed"
              ? <span style={{ color: "var(--destructive)" }}>Couldn&apos;t read the documents: {extractJob.error_message}</span>
              : <span>Reading {docUrls.length} published document{docUrls.length === 1 ? "" : "s"}{privateDocs.length > 0 ? ` and ${privateDocs.length} private one${privateDocs.length === 1 ? "" : "s"}` : ""} - requested {(formatDateTime(extractJob.requested_at) ?? "—")}.</span>}
          </div>
        ) : null}
        {(!extractJob || extractJob.status === "failed") && (
          <form action={requestRequirementsExtraction} style={{ marginTop: 10 }}>
            <input type="hidden" name="tender_id" value={tenderId} />
            <button type="submit" style={primaryBtn} disabled={docUrls.length === 0 && privateDocs.length === 0}>
              {extractJob ? "Try reading the documents again" : "Read this tender's documents"}
            </button>
            {docUrls.length === 0 && privateDocs.length === 0 && (
              <div style={{ fontSize: 11, color: "var(--destructive)", marginTop: 6 }}>
                No document links are on file for this tender{isShared ? " - add your own copy under Your private documents above" : ""}.
              </div>
            )}
          </form>
        )}
      </div>
      </>
    );
    // QA finding, 2026-10-26: this used to be a bare `people: null`, which the
    // Team & CVs tab (page.tsx) renders as `{generalSections?.people}` with
    // nothing else guaranteed to fill that tab for a general-family tender
    // (no ComplianceReport, and no key-positions card until positions exist)
    // - so the tab could render completely empty with zero explanation. Key
    // positions, registrations and experience requirements are read off this
    // tender's own documents (see the comment above), so there is a genuine,
    // honest reason nothing can show yet - say it, and point at the one
    // action (Overview tab) that unblocks it, rather than leaving a blank tab.
    const peopleBlocked = (
      <div id="general-people" style={card}>
        <SectionTitle title="Key people & requirements" />
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          {extractJob && extractJob.status === "failed"
            ? "Couldn't read this tender's documents, so key positions, registrations and experience requirements aren't known yet."
            : extractJob
              ? "Still reading this tender's documents - key positions, registrations and experience requirements will appear here once that finishes."
              : "Key positions, registrations and experience requirements are read from this tender's own documents, which haven't been read yet."}{" "}
          <a href="#general-preparation" style={{ color: "var(--accent)", fontWeight: 600 }}>
            See Overview to read the documents
          </a>
          .
        </div>
      </div>
    );
    return { overview, documents: null, questions: null, people: peopleBlocked, pack: null, badges: { docsMissing: 0, needAnswer: 0, peopleGaps: 0, generalFixCount: 0 } };
  }

  // ----- supporting documents -----
  const jvAnswer = answers.find((a) => a.field_key === "bidding_as_jv")?.value ?? null;
  const returnables = manifest.returnables.map((r) => checkReturnable(r, company, closingDate, answers, jvAnswer === null ? null : jvAnswer === "yes"));
  const qStates = questionStates(manifest.questions, answers, company);
  const cStates = companyFieldStates(manifest.company_fields, company);
  const needAnswer = qStates.filter((s) => !s.answered && !s.q.optional).length + cStates.filter((s) => !s.answered && !s.f.optional).length;
  // Verify/Provide/Fix (app/AGENTS.md): same gate as SANRAL's submission-pack.tsx,
  // reusing the exact same cached snapshot GeneralPackReview itself reads.
  const generalReviewSnapshot = await loadGeneralPackReviewSnapshot(tenderId);
  const generalFixCount = generalReviewSnapshot.mapped ? computeTenderReadiness(generalReviewSnapshot.sections).fix.length : 0;
  const generalDisabledReason = generalFixCount > 0 ? `Fix ${generalFixCount} item${generalFixCount === 1 ? "" : "s"} first - see the Pack review above` : null;
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

  // Per-section "still outstanding" counts for the tab bar itself - Sarel's
  // own live feedback, item 5: "add a summary of how much is still needed
  // per section ... always displayed." The tab bar is always visible even
  // while another tab is open, so a badge there (not just inside the tab's
  // own content) is what actually stays "always displayed".
  const peopleSectionVisible = roleRowsForTender.length > 0 || personRegs.length > 0 || !!chosen || locRows.length > 0 || !!mandatory;
  const regGaps = personRegs.filter((pr) => {
    const holders = holdersOf(pr.body);
    return holders.filter((p) => !p.expiry || validityAtClosing(p.expiry, closingDate).status === "have").length === 0;
  }).length;
  const roleGaps = roleRowsForTender.filter(({ tagged }) => tagged.length === 0).length;
  const peopleGaps = regGaps + roleGaps;

  // Per-section content for the tabs below - each of these was already
  // being rendered unconditionally before tabs existed; only which one is
  // VISIBLE at a time changed (see workspace-tabs.tsx).
  const documentsTabContent = (
    <div id="general-documents" style={card}>
      <SectionTitle title="Supporting documents" />
      {manifest.documents.length > 0 && (
        <details style={{ marginBottom: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>
            All {manifest.documents.length} tender document{manifest.documents.length === 1 ? "" : "s"} read
            {privateDocs.length > 0 ? ` (plus ${privateDocs.length} of your own private document${privateDocs.length === 1 ? "" : "s"})` : ""}
          </summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--muted-foreground)" }}>
            {manifest.documents.map((d, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                {d.name}
                {d.unreadable ? <span style={{ color: "var(--destructive)" }}> - couldn&apos;t be read ({d.unreadable})</span> : null}
                {d.ocr ? <span> - read via OCR</span> : null}
              </li>
            ))}
          </ul>
          {privateCard && (
            <div style={{ marginTop: 6 }}>
              {/* Plain <a>, not next/link's <Link>: this jumps to #private-documents,
                  which WorkspaceTabs registers under a DIFFERENT tab (Overview) than
                  this component's own (Compliance). WorkspaceTabs switches tabs by
                  listening for the native `hashchange` event - which a same-page
                  history.pushState navigation (what <Link> does for a hash-only href)
                  never fires, so a <Link> here would silently fail to switch tabs
                  while an ordinary anchor click still does (QA finding, 2026-10-26). */}
              <a href="#private-documents" style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>
                See your private documents above
              </a>
            </div>
          )}
        </details>
      )}
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 8 }}>
        Each one is named in this tender&apos;s documents (hover the row for the exact words). Checked against your{" "}
        <Link href="/company" style={{ color: "var(--accent)", fontWeight: 600 }}>company vault</Link> on the closing date; anything the vault has no
        place for can be uploaded for this tender only.
      </div>
      {returnables.length === 0 && (() => {
        // QA finding, 2026-10-26: this used to be a flat "No supporting
        // documents named in the readable text" with no explanation and no
        // way forward - indistinguishable from "this tender genuinely asks
        // for nothing" even when the real cause is that none of the
        // documents could actually be read (manifest.documents[].unreadable
        // - a real, already-captured per-document fact, just never
        // surfaced here). Give the real reason, and the same retry action
        // the pre-manifest state above offers, instead of a dead end.
        const unreadableDocs = manifest.documents.filter((d) => d.unreadable);
        const allUnreadable = manifest.documents.length > 0 && unreadableDocs.length === manifest.documents.length;
        return (
          <div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: allUnreadable ? 8 : 0 }}>
              {allUnreadable
                ? `None of this tender's ${manifest.documents.length} document${manifest.documents.length === 1 ? "" : "s"} could actually be read (${unreadableDocs[0].unreadable}${unreadableDocs.length > 1 ? `, and ${unreadableDocs.length - 1} more` : ""}) - that's why nothing is listed, not because this tender asks for nothing.`
                : "No supporting documents named in the readable text."}
            </div>
            {allUnreadable && (
              <form action={requestRequirementsExtraction}>
                <input type="hidden" name="tender_id" value={tenderId} />
                <button type="submit" style={secondaryBtn}>Try reading the documents again</button>
                {isShared && (
                  <a href="#private-documents" style={{ marginLeft: 10, fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>
                    Or upload a clearer copy
                  </a>
                )}
              </form>
            )}
          </div>
        );
      })()}
      {returnables.map((r) => {
        // Requirements & Compliance tab brief: RequirementRow (quote
        // provenance, already built for the demo page) wired in here for
        // real, plus the Quick Blocker Resolver drawer for a "missing" item
        // whose vault kind VAULT_DRAWER_CONFIG actually covers (csd/tax/
        // bbbee/coid/bank/insurance - cidb has no drawer entry, same gap
        // compliance-report.tsx's own BidTaskRow already lives with, falls
        // back to the plain upload/vault-link block below).
        const drawerConfig = r.vault ? VAULT_DRAWER_CONFIG[r.vault] : undefined;
        return (
          <div key={r.key}>
            <RequirementRow
              label={r.label}
              labelSuffix={r.strength === "mentioned" ? <span className="font-medium text-muted-foreground"> - mentioned, may not be required</span> : undefined}
              detail={r.detail}
              quote={r.quote}
              fromOcr={r.from_ocr}
              status={REQUIREMENT_STATUS_CHIP[r.status]}
              trailing={
                <>
                  {r.expiring && <Chip label="Renew soon" className="bg-warning/10 text-warning" />}
                  {/* Only meaningful on "check" (Verification Needed) - confidence is about how
                      confidently the requirement text itself was extracted, not whether the
                      company's own data satisfies it, so it's suppressed for "missing" to avoid
                      the exact "Fix ... Strong match" contradiction this brief named. */}
                  <MatchStrengthBadge confidence={r.confidence} reason={r.confidenceReason} hideWhenBlocking={r.status !== "check"} />
                </>
              }
            />
            {r.status === "missing" && drawerConfig && company && (
              <div style={{ marginTop: -6, marginBottom: 8 }}>
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
                  triggerElement={<button type="button" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--destructive)" }} />}
                  triggerLabel="Resolve in Vault →"
                />
              </div>
            )}
            {(r.uploadable || r.vaultLink) && r.status !== "have" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                {r.uploadable && (
                  <form action={uploadTenderDocument} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input type="hidden" name="tender_id" value={tenderId} />
                    <input type="hidden" name="returnable_key" value={r.key} />
                    <input type="file" name="file" required accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" aria-label={`Upload ${r.label}`} style={{ fontSize: 12, color: "var(--foreground)", maxWidth: "100%" }} />
                    <button type="submit" style={secondaryBtn}>{r.upload ? "Replace" : "Upload for this tender"}</button>
                  </form>
                )}
                {/* Only a plain Link now when no drawer covers this item (missing) or it's
                    "check" (Verification Needed, which never gets the drawer - that's for
                    resolving a real gap, not confirming an uncertain match). */}
                {r.vaultLink && !(r.status === "missing" && drawerConfig) && (
                  <Link href="/company" style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>Fix in the vault</Link>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const questionsTabContent = (
    <div id="general-questions" style={card}>
      <SectionTitle title="Questions only you can answer" />
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 10 }}>
        Only what this tender&apos;s forms ask that isn&apos;t already on file. Company details are saved for next
        time; anything left blank is never guessed.
      </div>
      {qStates.length === 0 && cStates.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>This tender&apos;s forms need nothing beyond what&apos;s on file.</div>
      ) : (
        <form action={saveGeneralAnswers}>
          <input type="hidden" name="tender_id" value={tenderId} />
          {cStates.length > 0 && (
            <>
              <SubTitle text="Company details (asked once)" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 6 }}>
                {cStates.map(({ f, value }) => (
                  <label key={f.key} style={{ display: "block" }} title={f.help}>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>
                      {f.label}{f.optional ? <span style={{ fontWeight: 400, color: "var(--muted-foreground)" }}> (optional)</span> : null}
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
                <div key={q.key} style={{ borderTop: "1px solid var(--border)", padding: "9px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0, flex: "1 1 300px" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>{q.label}</div>
                      <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>{q.help}</div>
                    </div>
                    {answered ? <Chip label="Answered" className="bg-success/10 text-success" /> : q.optional ? <Chip label="Optional" className="bg-muted text-muted-foreground" /> : <Chip label="Needs your answer" className="bg-warning/10 text-warning" />}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {q.type === "yes_no" && (
                      <div style={{ display: "flex", gap: 14, fontSize: 13, color: "var(--foreground)" }}>
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
                      <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 4 }}>
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
  );

  const peopleTabContent = (
    <div id="general-people" style={card}>
      <SectionTitle title="People, experience and locality" />
      {personRegs.length > 0 && (
        <>
          <SubTitle text="Professional registrations this tender asks for" />
          {personRegs.map((pr) => {
            const holders = holdersOf(pr.body);
            const valid = holders.filter((p) => !p.expiry || validityAtClosing(p.expiry, closingDate).status === "have");
            // Kept as their own specific labels (not the generic Compliant/
            // Action Required/Verification Needed 3-state vocabulary) -
            // "Lapses before closing" is real, useful information that
            // vocabulary would flatten away, and this isn't an instance of
            // the brief's contradictory-copy problem.
            const status: StatusChip =
              valid.length > 0
                ? { label: "On file", tone: "success" }
                : holders.length > 0
                  ? { label: "Lapses before closing", tone: "warning" }
                  : { label: "Not on file", tone: "destructive" };
            return (
              <RequirementRow
                key={pr.body}
                label={`${pr.body} registration (${REGISTRATION_BODY_INFO[pr.body].name})`}
                detail={
                  holders.length > 0
                    ? `On file: ${holders.map((p) => `${p.name}${p.category ? ` (${p.category})` : ""}${p.expiry ? `, valid to ${p.expiry}` : ", renewal date not on file"}`).join("; ")}`
                    : `Nobody has a ${pr.body} registration on file - add it on the person's page (it shows there now that this tender asks for it)${isCatalogBody(pr.body) ? " or under Company > Registrations" : ""}.`
                }
                quote={pr.quote}
                fromOcr={pr.from_ocr}
                status={status}
                trailing={<MatchStrengthBadge confidence={pr.confidence} reason={pr.confidence_reason} hideWhenBlocking={holders.length === 0} />}
              />
            );
          })}
        </>
      )}
      {roleRowsForTender.length > 0 && (
        <>
          <SubTitle text="Roles this tender names" />
          {roleRowsForTender.map(({ mr, role, tagged }) => (
            <RequirementRow
              key={mr.role_code}
              label={role?.title ?? mr.role_code}
              detail={tagged.length > 0 ? `Tagged for this role: ${tagged.map((p) => p.name).join(", ")}` : "Nobody tagged for this role yet - tag CVs on the People page."}
              quote={mr.quote}
              fromOcr={mr.from_ocr}
              status={tagged.length > 0 ? { label: "Someone tagged", tone: "success" } : { label: "Nobody tagged", tone: "destructive" }}
              trailing={<MatchStrengthBadge confidence={mr.confidence} reason={mr.confidence_reason} hideWhenBlocking={tagged.length === 0} />}
            />
          ))}
        </>
      )}
      {chosen && (
        <>
          <SubTitle text="Company experience this tender accepts" />
          <div style={{ fontSize: 12, color: "var(--foreground)", marginBottom: 4 }}>
            {describeRule(chosen.rule)}{chosen.rule.scope ? ` - scope: ${chosen.rule.scope}` : ""}.
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontStyle: "italic", marginBottom: 6, wordBreak: "break-word" }}>&ldquo;{chosen.rule.quote}&rdquo;</div>
          {experience?.error && <div style={{ fontSize: 12, color: "var(--warning)" }}>Couldn&apos;t read the Experience Library ({experience.error}).</div>}
          {evidenceEval && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", flex: "1 1 280px" }}>
                {evidenceEval.qualifying} item(s) in your <Link href="/experience" style={{ color: "var(--accent)", fontWeight: 600 }}>Experience Library</Link> count
                {experience && experience.items.length > evidenceEval.qualifying ? `; ${experience.items.length - evidenceEval.qualifying} more are a document type this tender doesn't accept` : ""}.
                {" "}Similar scope is for you to judge - all disciplines are counted here.
                {experience?.items.filter((i) => acceptedDocTypes(chosen.rule).has(i.document_type)).slice(0, 5).map((i) => (
                  <div key={i.id} style={{ fontSize: 11, color: "var(--muted-foreground)" }}>- {i.project_name} ({labelFor(DOCUMENT_TYPES, i.document_type)})</div>
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
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--muted-foreground)" }}>
                <span style={{ flex: "1 1 280px" }}>{locRows.map((r) => `${r.area} ${r.points}`).join(" · ")} - {m.reason}</span>
                <Chip {...st} label={m.status === "matched" ? `${m.points} pts` : m.status === "no_match" ? "0 pts" : "Unknown"} />
              </div>
            );
          })()}
          {mandatory && (
            <div style={{ fontSize: 12, color: "var(--destructive)", marginTop: 6 }}>
              <strong>Mandatory:</strong> a local office in {mandatory.area}{mandatory.disqualifies ? " - non-responsive without one" : ""}.{" "}
              {matchLocality([{ area: mandatory.area, level: "municipality", province: null, points: 0, system: null, kind: "specific_goals" }], offices).status === "matched" ? "You have one on file." : "None on file."}
            </div>
          )}
        </>
      )}
    </div>
  );

  const packTabContent = (
    <>
      {/* Pack review: confirm everything above before compiling (the
          general-tender equivalent of SANRAL's pack-review.tsx, 0059). */}
      <GeneralPackReview tenderId={tenderId} />

      <div id="general-pack" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <SectionTitle title="Submission pack" />
          {latestPack && <Chip label={JOB_STATUS_STYLE[latestPack.status].label} className={JOB_BADGE_CLASS[latestPack.status]} />}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 10 }}>
          One ordered PDF: contents page, the forms filled from your data and answers, a completion guide for every form that has to be
          done by hand, your vault documents, this tender&apos;s uploads, accepted experience evidence and the CVs of the people tagged for its
          roles. Built by Tender Ready&apos;s document engine (it can&apos;t run in the browser), so it appears here a minute or two after you ask.
        </div>
        {needAnswer > 0 && (
          <div style={{ fontSize: 12, color: "var(--warning)", marginBottom: 8 }}>
            {needAnswer} question{needAnswer === 1 ? "" : "s"} still unanswered - you can still generate a draft; those fields are left blank and listed.
          </div>
        )}
        {(!latestPack || latestPack.status === "ready" || latestPack.status === "failed") && (
          <form action={requestGeneralPack}>
            <input type="hidden" name="tender_id" value={tenderId} />
            <button
              type="submit"
              disabled={!!generalDisabledReason}
              title={generalDisabledReason ?? undefined}
              style={{ ...primaryBtn, ...(generalDisabledReason ? { background: "var(--muted-foreground)", cursor: "not-allowed" } : {}) }}
            >
              {latestPack ? "Generate a new pack" : "Generate submission pack"}
            </button>
            {/* title= (hover) doesn't reach touch devices - same reason as visible text. */}
            {generalDisabledReason && (
              <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 6 }}>{generalDisabledReason}</div>
            )}
          </form>
        )}
        {packJobs.map((j) => {
          const st = JOB_STATUS_STYLE[j.status];
          return (
            <div key={j.id} style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--muted-foreground)" }}>
                <span>Requested {(formatDateTime(j.requested_at) ?? "—")}</span>
                <Chip label={st.label} className={JOB_BADGE_CLASS[j.status]} />
                {j.page_count ? <span>{j.page_count} pages</span> : null}
                {j.storage_path_pdf && signed[j.storage_path_pdf] && <a href={signed[j.storage_path_pdf]} style={{ color: "var(--accent)", fontWeight: 600 }}>Download PDF</a>}
                {Object.entries(j.output_files ?? {}).map(([name, p]) => signed[p] ? <a key={name} href={signed[p]} style={{ color: "var(--accent)", fontWeight: 600 }}>{name}</a> : null)}
              </div>
              {j.error_message && <div style={{ fontSize: 12, color: "var(--destructive)", marginTop: 4 }}>{j.error_message}</div>}
              {j === latestPack && j.manifest && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted-foreground)" }}>
                  {(j.manifest.by_hand ?? []).length > 0 && (
                    <>
                      <div style={{ fontWeight: 700, color: "var(--warning)", marginBottom: 2 }}>Still to do by hand ({j.manifest.by_hand!.length})</div>
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
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>
          Signature, date and prices are never typed in for you.{" "}
          {answerByKey.get("total_bid_price")?.value ? "Your total bid price answer is written on SBD 1." : ""}
        </div>
      </div>
    </>
  );

  const overview = (
    <>
      {privateCard}
      {/* 1. What this tender needs */}
      <div id="general-preparation" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <SectionTitle title="What this tender needs" />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {needAnswer > 0 ? <Chip label={`${needAnswer} to answer`} className="bg-warning/10 text-warning" /> : <Chip label="All questions answered" className="bg-success/10 text-success" />}
            {docsMissing > 0 && <Chip label={`${docsMissing} document${docsMissing === 1 ? "" : "s"} missing`} className="bg-destructive/10 text-destructive" />}
          </div>
        </div>
        {savedNote && <SavedBanner text={savedNote} />}
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 10 }}>
          Read from{" "}
          {/* Plain <a>, not <Link> - same cross-tab hashchange reason as the
              #private-documents link above (this points into the Compliance tab). */}
          <a href="#general-documents" style={{ color: "var(--accent)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
            <FileText style={{ width: 12, height: 12 }} />
            {manifest.documents.length} {readingIsPrivate ? "" : "published "}document{manifest.documents.length === 1 ? "" : "s"}
          </a>
          {readingIsPrivate ? ` (including your ${privateDocs.length} private one${privateDocs.length === 1 ? "" : "s"})` : ""}
          {tender.buyer ? ` by ${tender.buyer}` : ""} on {(formatDate(manifest.extracted_at) ?? "—")}.{" "}
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
          <div className="border border-warning/40 bg-warning/10 text-warning" style={{ borderRadius: 9, padding: "9px 12px", marginBottom: 12, fontSize: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>What Tender Ready can&apos;t do for this tender</div>
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
                <div key={f.code} style={{ borderTop: "1px solid var(--border)", padding: "8px 0", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: "1 1 300px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <FormTag text={f.label} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>{f.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 3 }}>{f.reason}</div>
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
              <div key={b.key} style={{ borderTop: "1px solid var(--border)", padding: "7px 0", fontSize: 12, color: "var(--foreground)", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ minWidth: 0, flex: "1 1 280px", wordBreak: "break-word" }}>
                  {b.label}{b.document && b.document !== b.label ? <span style={{ color: "var(--muted-foreground)" }}> - in {b.document}</span> : null}
                  {b.overlay && <span style={{ display: "block", color: "var(--muted-foreground)", marginTop: 2 }}>{b.reason}</span>}
                </span>
                {b.overlay ? <Chip label="Typed onto the PDF" className="bg-success/10 text-success" /> : <Chip label="Complete by hand" className="bg-warning/10 text-warning" />}
              </div>
            ))}
          </>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, fontSize: 12, color: "var(--muted-foreground)" }}>
          {manifest.scoring.preference_system.system && manifest.scoring.preference_system.system !== "not_found" && (
            <Chip label={`Preference: ${manifest.scoring.preference_system.system}`} className="bg-muted text-foreground" />
          )}
          {manifest.scoring.functionality.threshold ? <Chip label={`Functionality minimum ${manifest.scoring.functionality.threshold}`} className="bg-muted text-foreground" /> : null}
          {manifest.cidb && <Chip label={`CIDB ${manifest.cidb.grading}`} className="bg-muted text-foreground" />}
          {manifest.briefing?.compulsory && <Chip label="Compulsory briefing" className="bg-destructive/10 text-destructive" />}
        </div>
      </div>
    </>
  );

  return {
    overview,
    documents: documentsTabContent,
    questions: questionsTabContent,
    people: peopleSectionVisible ? peopleTabContent : null,
    pack: packTabContent,
    badges: { docsMissing, needAnswer, peopleGaps, generalFixCount },
  };
}

function SectionTitle({ title }: { title: string }) {
  return <div style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)", marginBottom: 2 }}>{title}</div>;
}

function SubTitle({ text }: { text: string }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", margin: "12px 0 4px" }}>{text}</div>;
}

// Sarel's own live feedback: "the tags in the standard forms section should
// be standard sizes" - the old version was auto-width, so "SBD 1" and
// "SBD 6.1" rendered as visibly different-width pills in the same list.
// minWidth + centered text gives every form code the same footprint
// regardless of how many characters it has.
function FormTag({ text }: { text: string }) {
  return (
    <span
      style={{
        fontFamily: "monospace",
        fontSize: 10,
        fontWeight: 700,
        color: "var(--foreground)",
        background: "var(--muted)",
        borderRadius: 100,
        padding: "2px 7px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 56,
        textAlign: "center",
      }}
    >
      {text}
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

function SavedBanner({ text }: { text: string }) {
  return (
    <div className="border border-success/40 bg-success/10 text-success" style={{ borderRadius: 9, padding: "8px 12px", margin: "6px 0 10px", fontSize: 12, fontWeight: 600 }}>
      {text}
    </div>
  );
}
