import { createClient } from "@/lib/supabase/server";
import { expiryStatus, type StatusChip } from "@/lib/dates";
import { updateCompanyProfile, uploadVaultDocument } from "./actions";
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
      "id, legal_name, csd_trading_name, cipc_registration_number, vat_number, income_tax_number, paye_number, csd_supplier_number, coid_registration_number, coid_letter_of_good_standing_number, coid_letter_of_good_standing_expiry, bee_level, black_ownership_pct, bee_procurement_recognition_pct, status, registered_address, postal_address, bank_name, bank_branch_code, coid_letter_document_path, sars_tcs_pin, sars_tcs_pin_expiry, sars_tcs_pin_document_path, pi_insurance_insurer, pi_insurance_policy_number, pi_insurance_cover_zar, pi_insurance_expiry, pi_insurance_document_path, iso_9001_certified, iso_9001_certificate_number, iso_9001_expiry, iso_9001_document_path, bank_confirmation_letter_date, bank_confirmation_letter_valid_until, bank_confirmation_letter_path, bee_proof_type, bee_proof_expiry, bee_proof_document_path"
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

  return (
    <div>
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
          Uploads up to 4.4 MB each (PDF, Word or image). A QSE or EME sworn affidavit counts as valid B-BBEE proof, the
          same as a verification certificate.
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
          Account numbers are never stored in Tender Tool - generated documents are marked &quot;WITHHELD&quot; and completed manually.
        </div>
      </Section>
    </div>
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
          Account numbers are not collected here - this schema never stores one.
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
