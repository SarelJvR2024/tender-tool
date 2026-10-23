import type { StatusChip } from "@/lib/dates";
import { expiryStatus, formatDate } from "@/lib/dates";
import { BANK_LETTER_RENEW_SOON_DAYS, beeProofLabel } from "@/lib/vaultDocuments";
import type { VaultDocumentKind } from "@/lib/vaultDocuments";
import { ComplianceDocumentsView } from "./ComplianceDocumentsView";
import { NotStated } from "./shared";
import type { CompanyRow, DocUrls } from "../types";

export type ComplianceDocEntry = {
  kind: VaultDocumentKind;
  title: string;
  /** Full detail, shown line by line in card view. */
  lines: string[];
  /** One-line summary for a compact table row - always lines[0] (each kind's own most identifying fact). */
  detail: string;
  /** Raw expiry/valid-until date, for the table view's own Expires column - null when the document has no date yet. */
  expiry: string | null;
  status: StatusChip;
  path: string | null;
  url: string | undefined;
};

export function ComplianceDocumentsSection({ company, docUrls }: { company: CompanyRow; docUrls: DocUrls }) {
  const isoStatus = company.iso_9001_certified === true
    ? expiryStatus(company.iso_9001_expiry)
    : company.iso_9001_certified === false
      ? NotStated("Not certified")
      : NotStated("Not stated");
  const insuranceCover =
    company.pi_insurance_cover_zar !== null ? `R ${Number(company.pi_insurance_cover_zar).toLocaleString("en-ZA")}` : "—";

  const coidLines = [
    `No. ${company.coid_letter_of_good_standing_number ?? "—"} · Registration ${company.coid_registration_number ?? "—"}`,
    `Expires ${fmtDate(company.coid_letter_of_good_standing_expiry)}`,
  ];
  const cidbLines = [
    `Grading ${company.cidb_grading ?? "—"}`,
    `Expires ${fmtDate(company.cidb_expiry)}`,
    [
      company.cidb_registration_number ? `Reg. no. ${company.cidb_registration_number}` : null,
      company.cidb_contractor_name ? `Contractor name on certificate: ${company.cidb_contractor_name}` : null,
    ].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const sarsLines = [`PIN ${company.sars_tcs_pin ?? "—"}`, `Expires ${fmtDate(company.sars_tcs_pin_expiry)}`];
  const piLines = [
    `${company.pi_insurance_insurer ?? "Insurer —"} · Policy ${company.pi_insurance_policy_number ?? "—"}`,
    `Cover ${insuranceCover} · Expires ${fmtDate(company.pi_insurance_expiry)}`,
  ];
  const isoLines = [
    company.iso_9001_certified === true
      ? `Certified${company.iso_9001_certificate_number ? ` · Certificate ${company.iso_9001_certificate_number}` : ""}`
      : company.iso_9001_certified === false
        ? "Not ISO 9001 certified (SANRAL B4: in-house QMS scores 5 of 10)"
        : "Certification not stated yet",
    company.iso_9001_certified === true ? `Expires ${fmtDate(company.iso_9001_expiry)}` : "",
    company.iso_9001_certified_entity_name ? `Certified entity on certificate: ${company.iso_9001_certified_entity_name}` : "",
  ].filter(Boolean);
  const bankLines = [
    `Dated ${fmtDate(company.bank_confirmation_letter_date)}`,
    `Usable until ${fmtDate(company.bank_confirmation_letter_valid_until)} (3 months from its date)`,
    [
      company.bank_confirmation_bank_name ? `Bank: ${company.bank_confirmation_bank_name}` : null,
      company.bank_confirmation_account_holder ? `Account holder: ${company.bank_confirmation_account_holder}` : null,
    ].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const beeLines = [
    `${beeProofLabel(company.bee_proof_type) ?? "Proof type not recorded"} · Level ${company.bee_level ?? "—"}${company.status ? ` (${company.status})` : ""}`,
    `Expires ${fmtDate(company.bee_proof_expiry)}`,
    company.bee_entity_name ? `Entity name on certificate: ${company.bee_entity_name}` : "",
  ].filter(Boolean);

  const entries: ComplianceDocEntry[] = [
    {
      kind: "coid",
      title: "COID Letter of Good Standing",
      lines: coidLines,
      detail: coidLines[0],
      expiry: company.coid_letter_of_good_standing_expiry,
      status: expiryStatus(company.coid_letter_of_good_standing_expiry),
      path: company.coid_letter_document_path,
      url: docUrls.coid,
    },
    {
      kind: "cidb",
      title: "CIDB registration / grading",
      lines: cidbLines,
      detail: cidbLines[0],
      expiry: company.cidb_expiry,
      status: company.cidb_grading || company.cidb_expiry ? expiryStatus(company.cidb_expiry) : NotStated("Not on file"),
      path: company.cidb_document_path,
      url: docUrls.cidb,
    },
    {
      kind: "sars_tcs_pin",
      title: "SARS Tax Compliance Status PIN",
      lines: sarsLines,
      detail: sarsLines[0],
      expiry: company.sars_tcs_pin_expiry,
      status: company.sars_tcs_pin || company.sars_tcs_pin_expiry ? expiryStatus(company.sars_tcs_pin_expiry) : NotStated("Not on file"),
      path: company.sars_tcs_pin_document_path,
      url: docUrls.sars_tcs_pin,
    },
    {
      kind: "pi_insurance",
      title: "Professional indemnity insurance",
      lines: piLines,
      detail: piLines[0],
      expiry: company.pi_insurance_expiry,
      status: expiryStatus(company.pi_insurance_expiry),
      path: company.pi_insurance_document_path,
      url: docUrls.pi_insurance,
    },
    {
      kind: "iso_9001",
      title: "ISO 9001 quality management certificate",
      lines: isoLines,
      detail: isoLines[0],
      expiry: company.iso_9001_certified === true ? company.iso_9001_expiry : null,
      status: isoStatus,
      path: company.iso_9001_document_path,
      url: docUrls.iso_9001,
    },
    {
      kind: "bank_letter",
      title: "Bank confirmation letter",
      lines: bankLines,
      detail: bankLines[0],
      expiry: company.bank_confirmation_letter_valid_until,
      status: expiryStatus(company.bank_confirmation_letter_valid_until, BANK_LETTER_RENEW_SOON_DAYS),
      path: company.bank_confirmation_letter_path,
      url: docUrls.bank_letter,
    },
    {
      kind: "bee_proof",
      title: "B-BBEE proof",
      lines: beeLines,
      detail: beeLines[0],
      expiry: company.bee_proof_expiry,
      status: expiryStatus(company.bee_proof_expiry),
      path: company.bee_proof_document_path,
      url: docUrls.bee_proof,
    },
  ];

  return <ComplianceDocumentsView companyId={company.id} entries={entries} />;
}

const fmtDate = (d: string | null) => (d ? (formatDate(d) ?? "—") : "—");
