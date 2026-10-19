import { createClient } from "@/lib/supabase/server";
import { expiryStatus, type StatusChip } from "@/lib/dates";
import { saveDocumentTemplate, updateCompanyProfile, uploadVaultDocument } from "./actions";
import {
  COMPANY_DOCUMENT_TYPES,
  GUIDELINE_MAX_CHARS,
  unknownGuidelineFields,
  type CompanyDocumentTemplateRow,
  type CompanyDocumentType,
} from "@/lib/companyDocuments";
import {
  BANK_LETTER_RENEW_SOON_DAYS,
  BEE_PROOF_TYPES,
  VAULT_BUCKET,
  VAULT_DOCUMENTS,
  beeProofLabel,
  filenameFromPath,
  type VaultDocumentKind,
} from "@/lib/vaultDocuments";
import { SiteNav } from "../_components/SiteNav";
import { OfficeLocations } from "./OfficeLocations";

// Depends on the signed-in user's session/company row on every request
// (via RLS), same reason as dashboard/page.tsx - can't be prerendered.
export const instant = false;

type CompanyRow = {
  id: string;
  legal_name: string | null;
  csd_trading_name: string | null;
  cipc_registration_number: string | null;
  vat_number: string | null;
  income_tax_number: string | null;
  paye_number: string | null;
  csd_supplier_number: string | null;
  coid_registration_number: string | null;
  coid_letter_of_good_standing_number: string | null;
  coid_letter_of_good_standing_expiry: string | null;
  bee_level: number | null;
  black_ownership_pct: number | null;
  bee_procurement_recognition_pct: number | null;
  status: string | null;
  registered_address: string | null;
  postal_address: string | null;
  bank_name: string | null;
  bank_branch_code: string | null;
  // 0014_vault_compliance_documents.sql
  coid_letter_document_path: string | null;
  cidb_grading: string | null; // 0018_general_tender_preparation.sql
  // 0063_onboarding_document_scan.sql (completes the CIDB vault slot - see that migration's header)
  cidb_expiry: string | null;
  cidb_document_path: string | null;
  sars_tcs_pin: string | null;
  sars_tcs_pin_expiry: string | null;
  sars_tcs_pin_document_path: string | null;
  pi_insurance_insurer: string | null;
  pi_insurance_policy_number: string | null;
  pi_insurance_cover_zar: number | null;
  pi_insurance_expiry: string | null;
  pi_insurance_document_path: string | null;
  iso_9001_certified: boolean | null;
  iso_9001_certificate_number: string | null;
  iso_9001_expiry: string | null;
  iso_9001_document_path: string | null;
  bank_confirmation_letter_date: string | null;
  bank_confirmation_letter_valid_until: string | null; // generated: letter date + 3 months
  bank_confirmation_letter_path: string | null;
  bee_proof_type: string | null;
  bee_proof_expiry: string | null;
  bee_proof_document_path: string | null;
  // 0030_company_how_we_work.sql
  how_we_work: string | null;
  // 0001 columns the SANRAL pack writes into Form B3 / C.1.2.3 - editable here
  // since the 2026-10-18 form-field audit (before, only a seed could set them,
  // and a new company's DB default 0 went onto Form B3 as fact). Directors for
  // C.1.2.3 come from the directors register (/company/principals, 0050).
  head_office: string | null;
  other_offices: number | null;
  ecsa_registered_staff_count: number | null;
  sacpcmp_registered_staff_count: number | null;
  total_employees: number | null;
  typical_jv_share_pct: number | null;
};

type DocUrls = Partial<Record<VaultDocumentKind, string>>;

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
      "id, legal_name, csd_trading_name, cipc_registration_number, vat_number, income_tax_number, paye_number, csd_supplier_number, coid_registration_number, coid_letter_of_good_standing_number, coid_letter_of_good_standing_expiry, bee_level, black_ownership_pct, bee_procurement_recognition_pct, status, registered_address, postal_address, bank_name, bank_branch_code, coid_letter_document_path, cidb_grading, cidb_expiry, cidb_document_path, sars_tcs_pin, sars_tcs_pin_expiry, sars_tcs_pin_document_path, pi_insurance_insurer, pi_insurance_policy_number, pi_insurance_cover_zar, pi_insurance_expiry, pi_insurance_document_path, iso_9001_certified, iso_9001_certificate_number, iso_9001_expiry, iso_9001_document_path, bank_confirmation_letter_date, bank_confirmation_letter_valid_until, bank_confirmation_letter_path, bee_proof_type, bee_proof_expiry, bee_proof_document_path, how_we_work, head_office, other_offices, ecsa_registered_staff_count, sacpcmp_registered_staff_count, total_employees, typical_jv_share_pct"
    )
    .single();

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
  if (row && !editing) {
    const { data: tplRows } = await supabase
      .from("company_document_templates")
      .select("id, document_type, mode, storage_path, original_filename, guideline, updated_at")
      .eq("company_id", row.id);
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
  if (row && !editing) {
    const [a, b, c] = await Promise.all([
      supabase.from("company_principals").select("id", { count: "exact", head: true }),
      supabase.from("held_registrations").select("id", { count: "exact", head: true }),
      supabase.from("company_properties").select("id", { count: "exact", head: true }),
    ]);
    registerCounts.principals = a.count ?? 0;
    registerCounts.registrations = b.count ?? 0;
    registerCounts.properties = c.count ?? 0;
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: "#F6F5F1" }}>
      <SiteNav active="company" />

      <div style={{ flex: 1, padding: "20px 16px 40px", maxWidth: 900, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16233B", margin: 0 }}>Company profile &amp; document vault</h1>
          {row && !editing && (
            <a
              href="/company?edit=1"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44, padding: "0 18px", borderRadius: 9, background: "#D97706", color: "#FFFFFF", fontSize: 14, fontWeight: 600, textDecoration: "none", boxSizing: "border-box" }}
            >
              Edit
            </a>
          )}
        </div>

        {(loadError || !row) && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", fontSize: 13, color: "#B91C1C" }}>
            Could not load your company profile{loadError ? `: ${loadError.message}` : "."}
          </div>
        )}

        {row && !editing && saved === "1" && (
          <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#15803D" }}>
            Company profile updated.
          </div>
        )}

        {row && !editing && saved === "letter" && (
          <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#15803D" }}>
            Letter set-up saved.
          </div>
        )}

        {row && !editing && saved === "doc" && (
          <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#15803D" }}>
            Document uploaded.
          </div>
        )}

        {row && error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
            Could not save: {error}
          </div>
        )}

        {row && (editing ? <EditForm company={row} /> : <ReadOnlyView company={row} docUrls={docUrls} />)}

        {row && !editing && <RegisterLinks counts={registerCounts} />}

        {row && !editing && <LettersSection companyId={row.id} templates={templates} urls={templateUrls} />}

        {/* Office locations (0015) - self-contained, its own forms. */}
        {row && !editing && saved === "office" && (
          <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#15803D" }}>
            Office locations updated.
          </div>
        )}
        {row && !editing && <OfficeLocations />}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "16px 18px", marginBottom: 14 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: "#9A9684", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 12px" }}>{title}</h2>
      {children}
    </div>
  );
}

const fieldGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
};

function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#9A9684", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: "#16233B", fontWeight: 500 }}>
        {value === null || value === undefined || value === "" ? (
          <span style={{ color: "#C7C3B5" }}>Not on file</span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

function Badge({ status }: { status: StatusChip }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: status.bg, color: status.color }}>
      {status.label}
    </span>
  );
}

function SummaryChip({ count, label, bg, color }: { count: number; label: string; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color }}>
      {count} {label}
    </span>
  );
}

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

function NotStated({ label }: { label: string }): StatusChip {
  return { label, bg: "#F0EEE6", color: "#6B6758" };
}

function ReadOnlyView({ company, docUrls }: { company: CompanyRow; docUrls: DocUrls }) {
  const isoStatus: StatusChip =
    company.iso_9001_certified === true
      ? expiryStatus(company.iso_9001_expiry)
      : company.iso_9001_certified === false
        ? NotStated({ label: "Not certified" })
        : NotStated({ label: "Not stated" });
  const insuranceCover =
    company.pi_insurance_cover_zar !== null ? `R ${Number(company.pi_insurance_cover_zar).toLocaleString("en-ZA")}` : "—";

  // At-a-glance vault health, same idea as the Tender Workspace's summary
  // chips - this page tracks exactly the 6 documents a tender's compliance
  // check reads, so "is anything about to bite me" should be answerable
  // before reading all 6 rows below, not just color-coded within each one.
  const docStatuses = [
    expiryStatus(company.coid_letter_of_good_standing_expiry),
    company.sars_tcs_pin || company.sars_tcs_pin_expiry ? expiryStatus(company.sars_tcs_pin_expiry) : NotStated({ label: "Not on file" }),
    expiryStatus(company.pi_insurance_expiry),
    isoStatus,
    expiryStatus(company.bank_confirmation_letter_valid_until, BANK_LETTER_RENEW_SOON_DAYS),
    expiryStatus(company.bee_proof_expiry),
  ];
  const expiredCount = docStatuses.filter((s) => s.color === "#B91C1C").length;
  const renewSoonCount = docStatuses.filter((s) => s.color === "#B45309").length;
  const notOnFileCount = docStatuses.filter((s) => s.color === "#6B6758").length;
  const allGood = expiredCount === 0 && renewSoonCount === 0 && notOnFileCount === 0;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {expiredCount > 0 && <SummaryChip count={expiredCount} label={expiredCount === 1 ? "document expired" : "documents expired"} bg="#FEE2E2" color="#B91C1C" />}
        {renewSoonCount > 0 && <SummaryChip count={renewSoonCount} label="renewing soon" bg="#FEF3C7" color="#B45309" />}
        {notOnFileCount > 0 && <SummaryChip count={notOnFileCount} label="not on file" bg="#F0EEE6" color="#6B6758" />}
        {allGood && <SummaryChip count={docStatuses.length} label="documents current" bg="#DCFCE7" color="#15803D" />}
      </div>

      <Section title="Company identity">
        <div style={fieldGrid}>
          <Field label="Legal name" value={company.legal_name} />
          <Field label="CSD trading name" value={company.csd_trading_name} />
          <Field label="CIPC registration number" value={company.cipc_registration_number} />
          <Field label="VAT number" value={company.vat_number} />
          <Field label="Income tax number" value={company.income_tax_number} />
          <Field label="PAYE number" value={company.paye_number} />
          <Field label="CSD supplier number" value={company.csd_supplier_number} />
          <Field label="Registered address" value={company.registered_address} />
          <Field label="Postal address" value={company.postal_address} />
        </div>
      </Section>

      <Section title="Size &amp; offices (SANRAL Form B3)">
        <div style={fieldGrid}>
          <Field label="Head office (city/town)" value={company.head_office} />
          <Field label="Other offices (number)" value={company.other_offices} />
          <Field label="ECSA-registered professionals" value={company.ecsa_registered_staff_count} />
          <Field label="SACPCMP-registered professionals" value={company.sacpcmp_registered_staff_count} />
          <Field label="Total employees" value={company.total_employees} />
          <Field label="% share of JV agreement (usual)" value={company.typical_jv_share_pct} />
        </div>
        <div style={{ fontSize: 11, color: "#9A9684", marginTop: 10 }}>
          Written into SANRAL&apos;s Form B3. Blank means not recorded - the pack leaves it blank and lists it, never a 0.
        </div>
      </Section>

      <Section title="How we work">
        {company.how_we_work ? (
          <div style={{ fontSize: 14, color: "#16233B", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {company.how_we_work}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#6B6758", lineHeight: 1.5 }}>
            Not written yet. Describe who you are and how you actually approach a tender or project, in your own
            words - your real methodology, not a template.{" "}
            <a href="/company?edit=1" style={{ color: "#D97706", fontWeight: 600, textDecoration: "none" }}>
              Add it
            </a>
          </div>
        )}
        <div style={{ fontSize: 11, color: "#9A9684", marginTop: 10 }}>
          Kept for any part of a tender that needs your own description - used word-for-word, never rewritten by AI.
        </div>
      </Section>

      <Section title="Compliance documents">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <DocumentRow
            companyId={company.id}
            kind="coid"
            title="COID Letter of Good Standing"
            lines={[
              `No. ${company.coid_letter_of_good_standing_number ?? "—"} · Registration ${company.coid_registration_number ?? "—"}`,
              `Expires ${fmtDate(company.coid_letter_of_good_standing_expiry)}`,
            ]}
            status={expiryStatus(company.coid_letter_of_good_standing_expiry)}
            path={company.coid_letter_document_path}
            url={docUrls.coid}
          />
          <DocumentRow
            companyId={company.id}
            kind="cidb"
            title="CIDB registration / grading"
            lines={[`Grading ${company.cidb_grading ?? "—"}`, `Expires ${fmtDate(company.cidb_expiry)}`]}
            status={company.cidb_grading || company.cidb_expiry ? expiryStatus(company.cidb_expiry) : NotStated({ label: "Not on file" })}
            path={company.cidb_document_path}
            url={docUrls.cidb}
          />
          <DocumentRow
            companyId={company.id}
            kind="sars_tcs_pin"
            title="SARS Tax Compliance Status PIN"
            lines={[`PIN ${company.sars_tcs_pin ?? "—"}`, `Expires ${fmtDate(company.sars_tcs_pin_expiry)}`]}
            status={company.sars_tcs_pin || company.sars_tcs_pin_expiry ? expiryStatus(company.sars_tcs_pin_expiry) : NotStated({ label: "Not on file" })}
            path={company.sars_tcs_pin_document_path}
            url={docUrls.sars_tcs_pin}
          />
          <DocumentRow
            companyId={company.id}
            kind="pi_insurance"
            title="Professional indemnity insurance"
            lines={[
              `${company.pi_insurance_insurer ?? "Insurer —"} · Policy ${company.pi_insurance_policy_number ?? "—"}`,
              `Cover ${insuranceCover} · Expires ${fmtDate(company.pi_insurance_expiry)}`,
            ]}
            status={expiryStatus(company.pi_insurance_expiry)}
            path={company.pi_insurance_document_path}
            url={docUrls.pi_insurance}
          />
          <DocumentRow
            companyId={company.id}
            kind="iso_9001"
            title="ISO 9001 quality management certificate"
            lines={[
              company.iso_9001_certified === true
                ? `Certified${company.iso_9001_certificate_number ? ` · Certificate ${company.iso_9001_certificate_number}` : ""}`
                : company.iso_9001_certified === false
                  ? "Not ISO 9001 certified (SANRAL B4: in-house QMS scores 5 of 10)"
                  : "Certification not stated yet",
              company.iso_9001_certified === true ? `Expires ${fmtDate(company.iso_9001_expiry)}` : "",
            ].filter(Boolean)}
            status={isoStatus}
            path={company.iso_9001_document_path}
            url={docUrls.iso_9001}
          />
          <DocumentRow
            companyId={company.id}
            kind="bank_letter"
            title="Bank confirmation letter"
            lines={[
              `Dated ${fmtDate(company.bank_confirmation_letter_date)}`,
              `Usable until ${fmtDate(company.bank_confirmation_letter_valid_until)} (3 months from its date)`,
            ]}
            status={expiryStatus(company.bank_confirmation_letter_valid_until, BANK_LETTER_RENEW_SOON_DAYS)}
            path={company.bank_confirmation_letter_path}
            url={docUrls.bank_letter}
          />
          <DocumentRow
            companyId={company.id}
            kind="bee_proof"
            title="B-BBEE proof"
            lines={[
              `${beeProofLabel(company.bee_proof_type) ?? "Proof type not recorded"} · Level ${company.bee_level ?? "—"}${company.status ? ` (${company.status})` : ""}`,
              `Expires ${fmtDate(company.bee_proof_expiry)}`,
            ]}
            status={expiryStatus(company.bee_proof_expiry)}
            path={company.bee_proof_document_path}
            url={docUrls.bee_proof}
          />
        </div>
        <div style={{ fontSize: 11, color: "#9A9684", marginTop: 10 }}>
          Uploads up to 4.4 MB each (PDF, Word or image). A QSE or EME sworn affidavit is recorded as B-BBEE proof, but check
          each tender&apos;s own rule: SANRAL&apos;s Form A12 asks for a SANAS verification certificate and accepts an affidavit
          only from an EME with annual revenue under R1.8 million.
        </div>
      </Section>

      <Section title="BEE &amp; CIDB">
        <div style={fieldGrid}>
          <Field label="BEE level" value={company.bee_level} />
          <Field label="Black ownership %" value={company.black_ownership_pct} />
          <Field label="BEE procurement recognition %" value={company.bee_procurement_recognition_pct} />
          <Field label="Status" value={company.status} />
        </div>
      </Section>

      <Section title="Bank details">
        <div style={fieldGrid}>
          <Field label="Bank name" value={company.bank_name} />
          <Field label="Branch code" value={company.bank_branch_code} />
        </div>
        <div style={{ fontSize: 11, color: "#9A9684", marginTop: 10 }}>
          The account number itself is kept on the restricted{" "}
          <a href="/company/bank-accounts" style={{ color: "#D97706", fontWeight: 600, textDecoration: "none" }}>
            Bank accounts
          </a>{" "}
          page (owners and admins only). Generated documents still print &quot;WITHHELD&quot; - it is copied onto a form by hand.
        </div>
      </Section>
    </div>
  );
}

function RegisterLinks({ counts }: { counts: { principals: number; registrations: number; properties: number } }) {
  const items = [
    {
      href: "/company/principals",
      title: "Directors & shareholders",
      detail: counts.principals
        ? `${counts.principals} on the register - IDs, ownership by group, certified ID copies`
        : "Not started - tenders ask for every director's certified ID and the ownership split",
    },
    {
      href: "/company/registrations",
      title: "Registrations, licences & accreditations",
      detail: counts.registrations
        ? `${counts.registrations} held by the company or its people - PSIRA, SETA, permits, councils`
        : "PSIRA, SETA accreditation, waste permits, HPCSA, SACAP ... - with expiry reminders",
    },
    { href: "/company/bank-accounts", title: "Bank accounts", detail: "Restricted - owners and admins only" },
    { href: "/company/team", title: "Team", detail: "Add teammates, assign roles, invite someone as a restricted employee" },
    { href: "/company/document-scan", title: "Bulk document scan", detail: "Drop in a folder of compliance documents - AI sorts and pre-fills them, you confirm each one" },
    {
      href: "/company/properties",
      title: "Buildings you lease to government",
      detail: counts.properties ? `${counts.properties} building${counts.properties === 1 ? "" : "s"} on file` : "Only for lease / office-accommodation tenders",
    },
  ];
  return (
    <Section title="Directors, registrations &amp; property">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {items.map((i) => (
          <a
            key={i.href}
            href={i.href}
            style={{ display: "block", border: "1px solid #E5E1D5", borderRadius: 9, padding: "10px 12px", textDecoration: "none", minHeight: 44, boxSizing: "border-box" }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "#16233B" }}>{i.title} →</div>
            <div style={{ fontSize: 12, color: "#6B6758", marginTop: 3, lineHeight: 1.4 }}>{i.detail}</div>
          </a>
        ))}
      </div>
    </Section>
  );
}

function EditForm({ company }: { company: CompanyRow }) {
  const updateWithId = updateCompanyProfile.bind(null, company.id);

  return (
    <form action={updateWithId}>
      <Section title="Company identity">
        <div style={fieldGrid}>
          <TextInput name="legal_name" label="Legal name" defaultValue={company.legal_name} required />
          <TextInput name="csd_trading_name" label="CSD trading name" defaultValue={company.csd_trading_name} />
          <TextInput name="cipc_registration_number" label="CIPC registration number" defaultValue={company.cipc_registration_number} />
          <TextInput name="vat_number" label="VAT number" defaultValue={company.vat_number} />
          <TextInput name="income_tax_number" label="Income tax number" defaultValue={company.income_tax_number} />
          <TextInput name="paye_number" label="PAYE number" defaultValue={company.paye_number} />
          <TextInput name="csd_supplier_number" label="CSD supplier number" defaultValue={company.csd_supplier_number} />
          <TextInput name="registered_address" label="Registered address" defaultValue={company.registered_address} textarea />
          <TextInput name="postal_address" label="Postal address" defaultValue={company.postal_address} textarea />
        </div>
      </Section>

      <Section title="Size &amp; offices (SANRAL Form B3)">
        <div style={fieldGrid}>
          <TextInput name="head_office" label="Head office (city/town)" defaultValue={company.head_office} />
          <NumberInput name="other_offices" label="Other offices (number)" defaultValue={company.other_offices} step="1" />
          <NumberInput name="ecsa_registered_staff_count" label="ECSA-registered professionals" defaultValue={company.ecsa_registered_staff_count} step="1" />
          <NumberInput name="sacpcmp_registered_staff_count" label="SACPCMP-registered professionals" defaultValue={company.sacpcmp_registered_staff_count} step="1" />
          <NumberInput name="total_employees" label="Total employees" defaultValue={company.total_employees} step="1" />
          <NumberInput name="typical_jv_share_pct" label="% share of JV agreement (usual; 100 when bidding alone)" defaultValue={company.typical_jv_share_pct} step="0.1" />
        </div>
        <div style={{ fontSize: 11, color: "#9A9684", marginTop: 10 }}>Leave blank if you don&apos;t know - blank is never written as 0.</div>
      </Section>

      <Section title="How we work">
        <label htmlFor="how_we_work" style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#16233B", marginBottom: 5 }}>
          Who you are and how you approach a tender, in your own words
        </label>
        <div style={{ fontSize: 12, color: "#6B6758", lineHeight: 1.5, marginBottom: 8 }}>
          Your real methodology, what you are known for, how you run a project - written the way you would say it.
          Tender Tool reproduces this exactly as written; it never rewrites or pads it.
        </div>
        <textarea
          id="how_we_work"
          name="how_we_work"
          defaultValue={company.how_we_work ?? ""}
          rows={10}
          maxLength={10000}
          style={{ width: "100%", boxSizing: "border-box", minHeight: 180, padding: "10px 12px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 14, fontFamily: "inherit", lineHeight: 1.5, resize: "vertical" }}
        />
        <div style={{ fontSize: 11, color: "#9A9684", marginTop: 6 }}>Up to 10 000 characters.</div>
      </Section>

      <Section title="Compliance documents">
        <div style={fieldGrid}>
          <TextInput name="coid_registration_number" label="COID registration number" defaultValue={company.coid_registration_number} />
          <TextInput name="coid_letter_of_good_standing_number" label="COID Letter of Good Standing number" defaultValue={company.coid_letter_of_good_standing_number} />
          <DateInput name="coid_letter_of_good_standing_expiry" label="COID Letter of Good Standing expiry" defaultValue={company.coid_letter_of_good_standing_expiry} />
          <TextInput name="sars_tcs_pin" label="SARS Tax Compliance Status PIN" defaultValue={company.sars_tcs_pin} />
          <DateInput name="sars_tcs_pin_expiry" label="SARS TCS PIN expiry" defaultValue={company.sars_tcs_pin_expiry} />
          <TextInput name="pi_insurance_insurer" label="Professional indemnity insurer" defaultValue={company.pi_insurance_insurer} />
          <TextInput name="pi_insurance_policy_number" label="PI policy number" defaultValue={company.pi_insurance_policy_number} />
          <NumberInput name="pi_insurance_cover_zar" label="PI limit of indemnity (R)" defaultValue={company.pi_insurance_cover_zar} />
          <DateInput name="pi_insurance_expiry" label="PI policy expiry (period to)" defaultValue={company.pi_insurance_expiry} />
          <SelectInput
            name="iso_9001_certified"
            label="ISO 9001 certified?"
            defaultValue={company.iso_9001_certified === true ? "yes" : company.iso_9001_certified === false ? "no" : ""}
            options={[
              { value: "", label: "Not stated" },
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
          />
          <TextInput name="iso_9001_certificate_number" label="ISO 9001 certificate number" defaultValue={company.iso_9001_certificate_number} />
          <DateInput name="iso_9001_expiry" label="ISO 9001 certificate expiry" defaultValue={company.iso_9001_expiry} />
          <DateInput name="bank_confirmation_letter_date" label="Bank confirmation letter date" defaultValue={company.bank_confirmation_letter_date} />
        </div>
      </Section>

      <Section title="BEE &amp; CIDB">
        <div style={fieldGrid}>
          <NumberInput name="bee_level" label="BEE level" defaultValue={company.bee_level} />
          <NumberInput name="black_ownership_pct" label="Black ownership %" defaultValue={company.black_ownership_pct} step="0.1" />
          <NumberInput name="bee_procurement_recognition_pct" label="BEE procurement recognition %" defaultValue={company.bee_procurement_recognition_pct} step="0.1" />
          <TextInput name="status" label="Status (e.g. QSE)" defaultValue={company.status} />
          <SelectInput
            name="bee_proof_type"
            label="B-BBEE proof held"
            defaultValue={company.bee_proof_type ?? ""}
            options={[{ value: "", label: "Not recorded" }, ...BEE_PROOF_TYPES.map((t) => ({ value: t.value, label: t.label }))]}
          />
          <DateInput name="bee_proof_expiry" label="B-BBEE proof expiry" defaultValue={company.bee_proof_expiry} />
        </div>
      </Section>

      <Section title="Bank details">
        <div style={fieldGrid}>
          <TextInput name="bank_name" label="Bank name" defaultValue={company.bank_name} />
          <TextInput name="bank_branch_code" label="Branch code" defaultValue={company.bank_branch_code} />
        </div>
        <div style={{ fontSize: 11, color: "#9A9684", marginTop: 10 }}>
          Account numbers are not collected here - they go on the restricted Bank accounts page (owners and admins only).
        </div>
      </Section>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="submit"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44, padding: "0 20px", borderRadius: 9, background: "#D97706", color: "#FFFFFF", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer", boxSizing: "border-box" }}
        >
          Save changes
        </button>
        <a
          href="/company"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44, padding: "0 20px", borderRadius: 9, background: "#FFFFFF", border: "1px solid #E5E1D5", color: "#16233B", fontSize: 14, fontWeight: 600, textDecoration: "none", boxSizing: "border-box" }}
        >
          Cancel
        </a>
      </div>
    </form>
  );
}

function TextInput({
  name,
  label,
  defaultValue,
  required,
  textarea,
}: {
  name: string;
  label: string;
  defaultValue: string | null;
  required?: boolean;
  textarea?: boolean;
}) {
  const style: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    minHeight: 44,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #E5E1D5",
    fontSize: 14,
    fontFamily: "inherit",
  };
  return (
    <div>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#16233B", marginBottom: 5 }}>{label}</label>
      {textarea ? (
        <textarea name={name} defaultValue={defaultValue ?? ""} rows={2} style={{ ...style, resize: "vertical" }} />
      ) : (
        <input name={name} defaultValue={defaultValue ?? ""} required={required} style={style} />
      )}
    </div>
  );
}

function DateInput({ name, label, defaultValue }: { name: string; label: string; defaultValue: string | null }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#16233B", marginBottom: 5 }}>{label}</label>
      <input
        type="date"
        name={name}
        defaultValue={defaultValue ?? ""}
        style={{ width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 14, fontFamily: "inherit" }}
      />
    </div>
  );
}

function NumberInput({
  name,
  label,
  defaultValue,
  step,
}: {
  name: string;
  label: string;
  defaultValue: number | null;
  step?: string;
}) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#16233B", marginBottom: 5 }}>{label}</label>
      <input
        type="number"
        step={step ?? "1"}
        name={name}
        defaultValue={defaultValue ?? ""}
        style={{ width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 14, fontFamily: "inherit" }}
      />
    </div>
  );
}

function SelectInput({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#16233B", marginBottom: 5 }}>{label}</label>
      <select
        name={name}
        defaultValue={defaultValue}
        style={{ width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 14, fontFamily: "inherit", background: "#FFFFFF" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// One vault document: its tracked facts, an expiry badge (same Badge as the
// original COID row), a link to the uploaded copy, and an upload/replace form.
function DocumentRow({
  companyId,
  kind,
  title,
  lines,
  status,
  path,
  url,
}: {
  companyId: string;
  kind: VaultDocumentKind;
  title: string;
  lines: string[];
  status: StatusChip;
  path: string | null;
  url: string | undefined;
}) {
  const upload = uploadVaultDocument.bind(null, companyId);
  const filename = filenameFromPath(path);
  return (
    <div style={{ borderTop: "1px solid #F0EEE6", padding: "12px 0" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#16233B", marginBottom: 3 }}>{title}</div>
          {lines.map((l, i) => (
            <div key={i} style={{ fontSize: 12, color: "#6B6758", marginTop: i ? 2 : 0, wordBreak: "break-word" }}>
              {l}
            </div>
          ))}
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {filename ? (
              url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#D97706", fontWeight: 600, textDecoration: "none", wordBreak: "break-all" }}>
                  {filename}
                </a>
              ) : (
                <span style={{ color: "#6B6758" }}>{filename}</span>
              )
            ) : (
              <span style={{ color: "#C7C3B5" }}>No copy uploaded</span>
            )}
          </div>
        </div>
        <Badge status={status} />
      </div>
      <form action={upload} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <input type="hidden" name="kind" value={kind} />
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          aria-label={`Upload ${title}`}
          style={{ fontSize: 12, color: "#16233B", maxWidth: "100%" }}
        />
        <button
          type="submit"
          style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, background: "#FFFFFF", border: "1px solid #E5E1D5", color: "#16233B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          {filename ? "Replace" : "Upload"}
        </button>
      </form>
    </div>
  );
}

// The company's own letters/documents (0037). One card per document type:
// its state, and the same two-way choice the CV upload offers (people/[id]
// page: "AI-extract" / "Use as-is") - here "Upload your own" (used as-is) or
// "Generate from your guideline" (your own wording, {{fields}} filled in, no
// other wording added). Nothing set up = "Not set up": the pack leaves the
// document out and says so - it never uses another company's wording.
function LettersSection({
  companyId,
  templates,
  urls,
}: {
  companyId: string;
  templates: Record<string, CompanyDocumentTemplateRow>;
  urls: Record<string, string>;
}) {
  return (
    <div id="letters">
      <Section title="Letters &amp; documents">
        <div style={{ fontSize: 13, color: "#6B6758", lineHeight: 1.5, marginBottom: 4 }}>
          Letters a tender needs from your company. For each one, upload your own (it is used exactly as uploaded,
          every time) or write the guideline it should be generated from - your own wording, with{" "}
          <code style={{ fontSize: 12 }}>{"{{fields}}"}</code> where the tender&apos;s details go. Tender Tool fills
          only those fields; it never adds or rewrites wording. Until you choose, the letter is left out of your
          packs and marked &quot;not set up&quot;.
        </div>
        {COMPANY_DOCUMENT_TYPES.map((t) => (
          <LetterCard key={t.key} companyId={companyId} type={t} row={templates[t.key] ?? null} url={urls[t.key]} />
        ))}
      </Section>
    </div>
  );
}

function LetterCard({
  companyId,
  type,
  row,
  url,
}: {
  companyId: string;
  type: CompanyDocumentType;
  row: CompanyDocumentTemplateRow | null;
  url: string | undefined;
}) {
  const save = saveDocumentTemplate.bind(null, companyId);
  const status = !row
    ? { label: "Not set up", bg: "#FEF3C7", color: "#B45309" }
    : row.mode === "uploaded"
      ? { label: "Your own upload - used as-is", bg: "#DCFCE7", color: "#15803D" }
      : { label: "Generated from your guideline", bg: "#DCFCE7", color: "#15803D" };
  const unknown = row?.guideline ? unknownGuidelineFields(type, row.guideline) : [];
  const fieldStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #E5E1D5",
    fontSize: 13,
    fontFamily: "inherit",
    lineHeight: 1.5,
    resize: "vertical",
  };
  return (
    <div style={{ borderTop: "1px solid #F0EEE6", padding: "14px 0 6px", marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, maxWidth: 600 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#16233B", marginBottom: 3 }}>{type.label}</div>
          <div style={{ fontSize: 12, color: "#6B6758" }}>{type.usedFor}</div>
          {row?.mode === "uploaded" && row.original_filename && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#D97706", fontWeight: 600, textDecoration: "none", wordBreak: "break-all" }}>
                  {row.original_filename}
                </a>
              ) : (
                <span style={{ color: "#6B6758" }}>{row.original_filename}</span>
              )}
            </div>
          )}
          {!row && (
            <div style={{ fontSize: 12, color: "#B45309", marginTop: 4 }}>
              Left out of your packs until you upload your own or write a guideline below.
            </div>
          )}
        </div>
        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: status.bg, color: status.color, whiteSpace: "nowrap" }}>
          {status.label}
        </span>
      </div>

      {unknown.length > 0 && (
        <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "8px 12px", marginTop: 10, fontSize: 12, color: "#B91C1C" }}>
          Your guideline uses {unknown.map((u) => `{{${u}}}`).join(", ")}, which {unknown.length === 1 ? "isn't a field" : "aren't fields"} Tender
          Tool knows - {unknown.length === 1 ? "it prints" : "they print"} as [UNKNOWN FIELD] until corrected.
        </div>
      )}

      <form action={save} style={{ marginTop: 12 }}>
        <input type="hidden" name="document_type" value={type.key} />
        <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 13, color: "#16233B", maxWidth: 320 }}>
            <input type="radio" name="mode" value="uploaded" defaultChecked={row?.mode === "uploaded"} required style={{ marginTop: 3 }} />
            <span>
              <strong>Upload your own</strong> - your real letter, used exactly as uploaded every time, no AI
              involvement at all.
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 13, color: "#16233B", maxWidth: 320 }}>
            <input type="radio" name="mode" value="ai_guideline" defaultChecked={row?.mode === "ai_guideline"} style={{ marginTop: 3 }} />
            <span>
              <strong>Generate from your guideline</strong> - your own wording below, with this tender&apos;s details
              filled into the fields you mark.
            </span>
          </label>
        </div>

        <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#16233B", marginBottom: 5 }}>
          Your file (for &quot;Upload your own&quot;){row?.storage_path ? " - leave empty to keep the one on file" : ""}
        </label>
        <input
          type="file"
          name="file"
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          aria-label={`Upload your own ${type.label.toLowerCase()}`}
          style={{ fontSize: 12, color: "#16233B", maxWidth: "100%", marginBottom: 12 }}
        />

        <label htmlFor={`guideline_${type.key}`} style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#16233B", marginBottom: 5 }}>
          Your guideline (for &quot;Generate from your guideline&quot;)
        </label>
        <textarea
          id={`guideline_${type.key}`}
          name="guideline"
          rows={7}
          maxLength={GUIDELINE_MAX_CHARS}
          defaultValue={row?.guideline ?? ""}
          placeholder={`Your own wording, e.g. ${type.example}`}
          style={fieldStyle}
        />
        <div style={{ fontSize: 11, color: "#9A9684", margin: "6px 0 12px", lineHeight: 1.6 }}>
          Fields you can mark:{" "}
          {type.fields.map((f, i) => (
            <span key={f.key}>
              <code style={{ fontSize: 11, color: "#16233B" }}>{`{{${f.key}}}`}</code> {f.label}
              {i < type.fields.length - 1 ? " · " : ""}
            </span>
          ))}
          . A blank line starts a new paragraph; a line starting &quot;# &quot; is a heading. A field with nothing
          on file prints as [NOT ON FILE] and is added to the sign-off checklist.
        </div>
        <button
          type="submit"
          style={{ minHeight: 44, padding: "0 18px", borderRadius: 10, background: "#D97706", color: "#FFFFFF", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" }}
        >
          Save
        </button>
      </form>
    </div>
  );
}
