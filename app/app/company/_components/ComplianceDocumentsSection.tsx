import { expiryStatus } from "@/lib/dates";
import { BANK_LETTER_RENEW_SOON_DAYS, beeProofLabel } from "@/lib/vaultDocuments";
import { DocumentRow } from "./DocumentRow";
import { NotStated, VaultSection, fmtDate } from "./shared";
import type { CompanyRow, DocUrls } from "../types";

export function ComplianceDocumentsSection({ company, docUrls }: { company: CompanyRow; docUrls: DocUrls }) {
  const isoStatus = company.iso_9001_certified === true
    ? expiryStatus(company.iso_9001_expiry)
    : company.iso_9001_certified === false
      ? NotStated("Not certified")
      : NotStated("Not stated");
  const insuranceCover =
    company.pi_insurance_cover_zar !== null ? `R ${Number(company.pi_insurance_cover_zar).toLocaleString("en-ZA")}` : "—";

  return (
    <VaultSection id="compliance-documents" title="Compliance documents">
      <div className="flex flex-col">
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
          lines={[
            `Grading ${company.cidb_grading ?? "—"}`,
            `Expires ${fmtDate(company.cidb_expiry)}`,
            [
              company.cidb_registration_number ? `Reg. no. ${company.cidb_registration_number}` : null,
              company.cidb_contractor_name ? `Contractor name on certificate: ${company.cidb_contractor_name}` : null,
            ].filter(Boolean).join(" · "),
          ].filter(Boolean)}
          status={company.cidb_grading || company.cidb_expiry ? expiryStatus(company.cidb_expiry) : NotStated("Not on file")}
          path={company.cidb_document_path}
          url={docUrls.cidb}
        />
        <DocumentRow
          companyId={company.id}
          kind="sars_tcs_pin"
          title="SARS Tax Compliance Status PIN"
          lines={[`PIN ${company.sars_tcs_pin ?? "—"}`, `Expires ${fmtDate(company.sars_tcs_pin_expiry)}`]}
          status={company.sars_tcs_pin || company.sars_tcs_pin_expiry ? expiryStatus(company.sars_tcs_pin_expiry) : NotStated("Not on file")}
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
            company.iso_9001_certified_entity_name ? `Certified entity on certificate: ${company.iso_9001_certified_entity_name}` : "",
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
            [
              company.bank_confirmation_bank_name ? `Bank: ${company.bank_confirmation_bank_name}` : null,
              company.bank_confirmation_account_holder ? `Account holder: ${company.bank_confirmation_account_holder}` : null,
            ].filter(Boolean).join(" · "),
          ].filter(Boolean)}
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
            company.bee_entity_name ? `Entity name on certificate: ${company.bee_entity_name}` : "",
          ].filter(Boolean)}
          status={expiryStatus(company.bee_proof_expiry)}
          path={company.bee_proof_document_path}
          url={docUrls.bee_proof}
        />
      </div>
      <div className="mt-2.5 text-xs text-muted-foreground">
        PDF, Word or an image, up to 25 MB each - except the COID letter above, which is capped at 4.4 MB. A QSE or EME sworn
        affidavit is recorded as B-BBEE proof, but check each tender&apos;s own rule: SANRAL&apos;s Form A12 asks for a SANAS
        verification certificate and accepts an affidavit only from an EME with annual revenue under R1.8 million.
      </div>
    </VaultSection>
  );
}
