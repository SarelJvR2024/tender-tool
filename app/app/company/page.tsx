import { createClient } from "@/lib/supabase/server";
import { updateCompanyProfile } from "./actions";

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
};

type ExpiryStatus = {
  label: string;
  bg: string;
  color: string;
};

// Shared rule, driven directly by the real incident this page exists to
// prevent: the CLI engine flagging a COID Letter of Good Standing as
// "expired" on every generated tender because nobody had a clear view of
// the expiry date on file. >60 days out = current, <=60 days = renew soon,
// past = expired, no date on file = grey/unknown (never treated as expired).
function expiryStatus(expiry: string | null): ExpiryStatus {
  if (!expiry) {
    return { label: "Not on file", bg: "#F0EEE6", color: "#6B6758" };
  }
  const expiryDate = new Date(expiry);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysLeft = Math.ceil((expiryDate.getTime() - today.getTime()) / msPerDay);

  if (daysLeft < 0) return { label: "Expired", bg: "#FEE2E2", color: "#B91C1C" };
  if (daysLeft <= 60) return { label: "Renew soon", bg: "#FEF3C7", color: "#B45309" };
  return { label: "Current", bg: "#DCFCE7", color: "#15803D" };
}

export default async function CompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; error?: string; saved?: string }>;
}) {
  const { edit, error, saved } = await searchParams;
  const editing = edit === "1";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // RLS ("companies: members can select") returns only the signed-in user's
  // own company - this .single() read works the same regardless of tenant.
  const { data: company, error: loadError } = await supabase
    .from("companies")
    .select(
      "id, legal_name, csd_trading_name, cipc_registration_number, vat_number, income_tax_number, paye_number, csd_supplier_number, coid_registration_number, coid_letter_of_good_standing_number, coid_letter_of_good_standing_expiry, bee_level, black_ownership_pct, bee_procurement_recognition_pct, status, registered_address, postal_address, bank_name, bank_branch_code"
    )
    .single();

  const row = company as CompanyRow | null;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: "#F6F5F1" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", background: "#16233B", color: "#FFFFFF", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: "#D97706", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#16233B", flexShrink: 0 }}>T</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Tender Tool</div>
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)" }}>{user?.email}</div>
      </div>

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

        {row && error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
            Could not save: {error}
          </div>
        )}

        {row && (editing ? <EditForm company={row} /> : <ReadOnlyView company={row} />)}
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

function Badge({ status }: { status: ExpiryStatus }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: status.bg, color: status.color }}>
      {status.label}
    </span>
  );
}

function ReadOnlyView({ company }: { company: CompanyRow }) {
  const coidStatus = expiryStatus(company.coid_letter_of_good_standing_expiry);

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
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#16233B", marginBottom: 3 }}>COID Letter of Good Standing</div>
              <div style={{ fontSize: 12, color: "#6B6758" }}>
                No. {company.coid_letter_of_good_standing_number ?? "—"} &middot; Registration {company.coid_registration_number ?? "—"}
              </div>
              <div style={{ fontSize: 12, color: "#6B6758", marginTop: 2 }}>
                Expires {company.coid_letter_of_good_standing_expiry ? new Date(company.coid_letter_of_good_standing_expiry).toLocaleDateString() : "—"}
              </div>
            </div>
            <Badge status={coidStatus} />
          </div>
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
        </div>
      </Section>

      <Section title="BEE &amp; CIDB">
        <div style={fieldGrid}>
          <NumberInput name="bee_level" label="BEE level" defaultValue={company.bee_level} />
          <NumberInput name="black_ownership_pct" label="Black ownership %" defaultValue={company.black_ownership_pct} step="0.1" />
          <NumberInput name="bee_procurement_recognition_pct" label="BEE procurement recognition %" defaultValue={company.bee_procurement_recognition_pct} step="0.1" />
          <TextInput name="status" label="Status (e.g. QSE)" defaultValue={company.status} />
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
