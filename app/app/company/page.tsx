import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/dates";
import { computeBidReadiness, type ReadinessResult } from "@/lib/readiness";
import { fetchAllRows } from "@/lib/supabasePaging";
import { statusFor } from "@/lib/documentExpiry";
import { COMPANY_EXPIRY_FIELDS } from "@/lib/notifications";
import { BidReadinessCard } from "@/components/tt/bid-readiness-card";
import { PageHeader } from "@/components/tt/page-header";
import { buttonVariants } from "@/components/ui/button";
import { DocumentExpiryOverview } from "./DocumentExpiryOverview";
import type { CompanyDocumentTemplateRow } from "@/lib/companyDocuments";
import { VAULT_BUCKET, VAULT_DOCUMENTS, vaultDocumentOnFile, type VaultDocumentKind } from "@/lib/vaultDocuments";
import { AppShell } from "../_components/AppShell";
import { OfficeLocations } from "./OfficeLocations";
import { Notifications } from "./Notifications";
import { CompanySubNav, type CompanySubNavItem } from "./_components/CompanySubNav";
import { ReadOnlyView } from "./_components/ReadOnlyView";
import { EditForm } from "./_components/EditForm";
import { RegisterLinks } from "./_components/RegisterLinks";
import { LettersSection } from "./_components/LettersSection";
import { VaultProgressSummary } from "./_components/VaultProgressSummary";
import { Banner } from "./_components/shared";
import type { CompanyRow, DocUrls } from "./types";

// Depends on the signed-in user's session/company row on every request
// (via RLS), same reason as dashboard/page.tsx - can't be prerendered.
export const instant = false;

export default async function CompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; error?: string; saved?: string }>;
}) {
  const { edit, error, saved } = await searchParams;
  const editing = edit === "1";

  const supabase = await createClient();

  // RLS ("companies: members can select") returns only the signed-in user's
  // own company - this .single() read works the same regardless of tenant.
  const { data: company, error: loadError } = await supabase
    .from("companies")
    .select(
      "id, legal_name, csd_trading_name, cipc_registration_number, vat_number, income_tax_number, paye_number, csd_supplier_number, coid_registration_number, coid_letter_of_good_standing_number, coid_letter_of_good_standing_expiry, bee_level, black_ownership_pct, bee_procurement_recognition_pct, status, registered_address, postal_address, bank_name, bank_branch_code, coid_letter_document_path, cidb_grading, cidb_expiry, cidb_document_path, cidb_registration_number, cidb_contractor_name, bee_entity_name, bank_confirmation_bank_name, bank_confirmation_account_holder, iso_9001_certified_entity_name, sars_tcs_pin, sars_tcs_pin_expiry, sars_tcs_pin_document_path, pi_insurance_insurer, pi_insurance_policy_number, pi_insurance_cover_zar, pi_insurance_expiry, pi_insurance_document_path, iso_9001_certified, iso_9001_certificate_number, iso_9001_expiry, iso_9001_document_path, bank_confirmation_letter_date, bank_confirmation_letter_valid_until, bank_confirmation_letter_path, bee_proof_type, bee_proof_expiry, bee_proof_document_path, how_we_work, head_office, other_offices, ecsa_registered_staff_count, sacpcmp_registered_staff_count, total_employees, typical_jv_share_pct, savings_baseline_hours_per_tender, savings_baseline_hourly_cost_zar"
    )
    .single();

  if (loadError) console.error("companies select failed", loadError);

  const row = company as CompanyRow | null;

  // Short-lived signed links to the uploaded copies (private bucket), same
  // 10-minute pattern as experience/page.tsx.
  const docUrls: DocUrls = {};
  if (row && !editing) {
    const kinds = (Object.keys(VAULT_DOCUMENTS) as VaultDocumentKind[]).filter((k) => !!row[VAULT_DOCUMENTS[k].column]);
    const results = await Promise.all(
      kinds.map((k) => supabase.storage.from(VAULT_BUCKET).createSignedUrl(row[VAULT_DOCUMENTS[k].column] as string, 600)),
    );
    results.forEach((r, i) => {
      if (r.data?.signedUrl) docUrls[kinds[i]] = r.data.signedUrl;
    });
  }

  // The company's own letters/documents (0037): one row per document type it
  // has set up. A type with no row is "not set up".
  const templates: Record<string, CompanyDocumentTemplateRow> = {};
  const templateUrls: Record<string, string> = {};
  let templatesError = false;
  if (row && !editing) {
    const { data: tplRows, error: tplError } = await supabase
      .from("company_document_templates")
      .select("id, document_type, mode, storage_path, original_filename, guideline, updated_at")
      .eq("company_id", row.id);
    if (tplError) {
      console.error("company_document_templates select failed", tplError);
      templatesError = true;
    }
    for (const t of (tplRows ?? []) as CompanyDocumentTemplateRow[]) templates[t.document_type] = t;
    const withFiles = Object.values(templates).filter((t) => t.storage_path);
    const signed = await Promise.all(
      withFiles.map((t) => supabase.storage.from(VAULT_BUCKET).createSignedUrl(t.storage_path as string, 600)),
    );
    signed.forEach((r, i) => {
      if (r.data?.signedUrl) templateUrls[withFiles[i].document_type] = r.data.signedUrl;
    });
  }

  // Directors register, registrations, buildings, bank accounts (0050) - each
  // on its own page; only counts here. RLS scopes every count to this company
  // (bank accounts: owners/admins only, so members see 0 here).
  const registerCounts = { principals: 0, registrations: 0, properties: 0 };
  let registerCountsError = false;
  if (row && !editing) {
    const [a, b, c] = await Promise.all([
      supabase.from("company_principals").select("id", { count: "exact", head: true }),
      supabase.from("held_registrations").select("id", { count: "exact", head: true }),
      supabase.from("company_properties").select("id", { count: "exact", head: true }),
    ]);
    if (a.error) console.error("company_principals count failed", a.error);
    if (b.error) console.error("held_registrations count failed", b.error);
    if (c.error) console.error("company_properties count failed", c.error);
    registerCountsError = Boolean(a.error || b.error || c.error);
    registerCounts.principals = a.count ?? 0;
    registerCounts.registrations = b.count ?? 0;
    registerCounts.properties = c.count ?? 0;
  }

  // Bid readiness (header badge) - reuses the row already fetched above plus
  // registerCounts.principals; only cv_uploads/experience_items need their
  // own query. Scoring itself lives in lib/readiness.ts (pure, unit-tested),
  // and this page's own cv_uploads read is now paginated the same way
  // lib/companyReadinessData.ts's fetchCompanyReadiness() reads it for the
  // dashboard/onboarding end screen (Finding 250) - so the two can no longer
  // silently disagree once a company's cv_uploads history passes 1000 rows.
  //
  // people(id, name) is the one new query VaultProgressSummary needs (Sarel's
  // own live feedback tonight: "people uploaded and missing docs per
  // person") - cv_uploads itself was already being read for the readiness
  // score above; this just keeps the per-person_id Set instead of
  // discarding it once the count is taken, so the summary card below can't
  // compute a different answer than the score it sits next to.
  let readiness: ReadinessResult | null = null;
  let peopleRows: { id: string; name: string }[] = [];
  let peopleWithCvIds = new Set<string>();
  let readinessInputsError = false;
  if (row && !editing) {
    const [
      cvUploads,
      { count: experienceCount, error: experienceError },
      { data: peopleData, error: peopleError },
    ] = await Promise.all([
      // Paginated, not a plain `.select()` - the same db-max-rows fix
      // lib/companyReadinessData.ts's own fetchCompanyReadiness() already
      // applies to this exact table/column for the dashboard and onboarding
      // end screen (its own comment: cv_uploads grows forever, no retention,
      // so a long-lived company can pass PostgREST's 1000-row cap). This
      // page had its OWN separate, unpaginated cv_uploads query - despite
      // the comment above claiming parity with the other two surfaces via
      // "see lib/companyReadinessData.ts" - so a company past that row count
      // could get a silently LOWER bid-readiness score here than on
      // dashboard/discovery, and VaultProgressSummary could list real
      // people as "missing a CV" who already have one (standing review,
      // 2026-11-09, Finding 250).
      fetchAllRows<{ person_id: string }>((from, to) => supabase.from("cv_uploads").select("person_id").range(from, to), 20_000),
      supabase.from("experience_items").select("id", { count: "exact", head: true }),
      supabase.from("people").select("id, name").order("name", { ascending: true }),
    ]);
    if (cvUploads.error) console.error("cv_uploads select failed (company)", cvUploads.error);
    if (experienceError) console.error("experience_items count failed (company)", experienceError);
    if (peopleError) console.error("people select failed (company)", peopleError);
    readinessInputsError = Boolean(cvUploads.error || experienceError || peopleError);
    peopleRows = (peopleData ?? []) as { id: string; name: string }[];
    peopleWithCvIds = new Set(cvUploads.rows.map((r) => r.person_id));
    readiness = computeBidReadiness({
      legalName: row.legal_name,
      csdSupplierNumber: row.csd_supplier_number,
      taxPin: row.sars_tcs_pin,
      taxPinExpiry: row.sars_tcs_pin_expiry,
      taxPinDocumentPath: row.sars_tcs_pin_document_path,
      beeLevel: row.bee_level,
      beeProofExpiry: row.bee_proof_expiry,
      beeProofDocumentPath: row.bee_proof_document_path,
      cidbGrading: row.cidb_grading,
      cidbExpiry: row.cidb_expiry,
      cidbDocumentPath: row.cidb_document_path,
      bankConfirmationValidUntil: row.bank_confirmation_letter_valid_until,
      bankConfirmationLetterPath: row.bank_confirmation_letter_path,
      bankConfirmationLetterDate: row.bank_confirmation_letter_date,
      principalCount: registerCounts.principals,
      peopleWithCvCount: peopleWithCvIds.size,
      experienceProjectCount: experienceCount ?? 0,
    });
  }
  const peopleMissingCv = peopleRows.filter((p) => !peopleWithCvIds.has(p.id));

  // Document count for VaultProgressSummary - the same 7 VAULT_DOCUMENTS
  // kinds ComplianceDocumentsSection already renders one row per, using that
  // same component's own "on file" rule (lib/vaultDocuments.ts's
  // vaultDocumentOnFile() - a document was uploaded OR the matching text/
  // level/date field was typed in) rather than a second, path-only rule that
  // used to silently disagree with the compliance section rendered directly
  // below it on this same page (standing review, 2026-11-09, Finding 249).
  const documentsTotal = Object.keys(VAULT_DOCUMENTS).length;
  const documentsOnFile = row
    ? (Object.keys(VAULT_DOCUMENTS) as VaultDocumentKind[]).filter((k) => vaultDocumentOnFile(k, row)).length
    : 0;

  // Sub-nav completion ticks - reuses already-computed signals only
  // (lib/readiness.ts's criteria, lib/documentExpiry.ts's statusFor), never
  // a new completeness rule invented for the nav itself. Sections with no
  // existing single-criterion signal (size/offices, how-we-work, bank
  // details' plain fields, registers, letters, offices) simply get no tick
  // rather than a guessed one.
  const satisfied = (key: string) => readiness?.criteria.find((c) => c.key === key)?.satisfied ?? false;
  const identityComplete = readiness ? satisfied("company_basics") && satisfied("csd") : undefined;
  const beeCidbComplete = readiness ? satisfied("bee") && satisfied("cidb") : undefined;
  const complianceDocumentsComplete = row
    ? COMPANY_EXPIRY_FIELDS.every(
        (f) => statusFor(daysUntil((row as unknown as Record<string, string | null>)[f.field])) === "valid",
      )
    : undefined;

  // Grouped into three clusters so a first-time user's sub-nav reads as "what
  // every tender needs" vs "team & experience" vs "other company info",
  // instead of one flat 12-item list (Sarel's own live feedback: the
  // sections "feel intimidating for an initial user"). Grouping only
  // reorders/labels existing items - no new section, href or signal.
  const subNavItems: CompanySubNavItem[] = [
    { href: "#document-expiry", label: "Expiry", group: "Required for every tender" },
    { href: "#compliance-documents", label: "Documents", complete: complianceDocumentsComplete, group: "Required for every tender" },
    { href: "#company-identity", label: "Identity", complete: identityComplete, group: "Required for every tender" },
    { href: "#bee-cidb", label: "B-BBEE & CIDB", complete: beeCidbComplete, group: "Required for every tender" },
    { href: "#bank-details", label: "Bank details", complete: satisfied("bank_confirmation"), group: "Required for every tender" },
    { href: "/people", label: "People", complete: satisfied("people_cvs"), group: "Team & experience" },
    { href: "/experience", label: "Experience", complete: satisfied("experience"), group: "Team & experience" },
    { href: "#registers", label: "Registers", group: "Team & experience" },
    { href: "#size-offices", label: "Size & offices", group: "Other company info" },
    { href: "#savings-baseline", label: "Time & cost saved", group: "Other company info" },
    { href: "#how-we-work", label: "How we work", group: "Other company info" },
    { href: "#notifications", label: "Notifications", group: "Other company info" },
    { href: "#letters", label: "Letters", group: "Other company info" },
    { href: "#offices", label: "Offices", group: "Other company info" },
  ];

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1200px] flex-1 px-8 py-6">
        <PageHeader
          className="mb-5"
          title="Company profile & document vault"
          actions={
            row && !editing ? (
              <a href="/company?edit=1" className={buttonVariants({ variant: "accent", size: "lg", className: "min-h-10" })}>
                Edit
              </a>
            ) : undefined
          }
        />

        <div className="flex flex-col gap-4">
          {readiness && <BidReadinessCard result={readiness} size="compact" />}

          {row && !editing && (
            <VaultProgressSummary
              documentsOnFile={documentsOnFile}
              documentsTotal={documentsTotal}
              peopleTotal={peopleRows.length}
              peopleWithCv={peopleWithCvIds.size}
              peopleMissingCv={peopleMissingCv}
            />
          )}

          {(loadError || !row) && (
            <Banner tone="destructive">
              {loadError ? "Couldn't load your company profile - try refreshing. If it keeps happening, let us know." : "Could not load your company profile."}
            </Banner>
          )}

          {row && !editing && (templatesError || registerCountsError || readinessInputsError) && (
            <Banner tone="destructive">
              Some of your company details (people, registers or letters) couldn&apos;t be loaded - the counts and checklist above may be incomplete. Try refreshing.
            </Banner>
          )}

          {row && !editing && saved === "1" && <Banner tone="success">Company profile updated.</Banner>}
          {row && !editing && saved === "letter" && <Banner tone="success">Letter set-up saved.</Banner>}
          {row && !editing && saved === "doc" && <Banner tone="success">Document uploaded.</Banner>}
          {row && error && <Banner tone="destructive">Could not save: {error}</Banner>}

          {row &&
            (editing ? (
              <EditForm company={row} />
            ) : (
              <div className="flex flex-col gap-6 lg:flex-row">
                <CompanySubNav items={subNavItems} />
                <div className="flex min-w-0 flex-1 flex-col gap-6">
                  <DocumentExpiryOverview companyId={row.id} />
                  <ReadOnlyView company={row} docUrls={docUrls} />
                  {saved === "digest" && <Banner tone="success">Email preference updated.</Banner>}
                  <Notifications />
                  <RegisterLinks counts={registerCounts} />
                  <LettersSection companyId={row.id} templates={templates} urls={templateUrls} />
                  {saved === "office" && <Banner tone="success">Office locations updated.</Banner>}
                  <OfficeLocations />
                </div>
              </div>
            ))}
        </div>
      </div>
    </AppShell>
  );
}
