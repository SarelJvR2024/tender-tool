import { documentStatus } from "@/lib/dates";
import { BANK_LETTER_RENEW_SOON_DAYS } from "@/lib/vaultDocuments";
import { CompanyIdentitySection } from "./CompanyIdentitySection";
import { SizeOfficesSection } from "./SizeOfficesSection";
import { SavingsBaselineSection } from "./SavingsBaselineSection";
import { HowWeWorkSection } from "./HowWeWorkSection";
import { ComplianceDocumentsSection } from "./ComplianceDocumentsSection";
import { BeeCidbSection } from "./BeeCidbSection";
import { BankDetailsSection } from "./BankDetailsSection";
import { NotStated, SummaryChip } from "./shared";
import type { CompanyRow, DocUrls } from "../types";

export function ReadOnlyView({ company, docUrls }: { company: CompanyRow; docUrls: DocUrls }) {
  // At-a-glance vault health, same idea as the Tender Workspace's summary
  // chips - this page tracks exactly the 6 documents a tender's compliance
  // check reads, so "is anything about to bite me" should be answerable
  // before reading all 6 rows below, not just color-coded within each one.
  // Real bug, 2026-10-29: every call here used to pass expiryStatus() the
  // expiry date alone, with no check for whether a file was actually
  // attached - so an uploaded COID letter with no expiry date yet rolled up
  // into "not on file" here too, same bug as ComplianceDocumentsSection's
  // own per-row status (see lib/dates.ts's documentStatus() header comment).
  const isoStatus =
    company.iso_9001_certified === true
      ? documentStatus(company.iso_9001_document_path !== null, company.iso_9001_expiry)
      : company.iso_9001_certified === false
        ? NotStated("Not certified")
        : NotStated("Not stated");
  const docStatuses = [
    documentStatus(company.coid_letter_document_path !== null, company.coid_letter_of_good_standing_expiry),
    documentStatus(
      company.sars_tcs_pin_document_path !== null || !!company.sars_tcs_pin || !!company.sars_tcs_pin_expiry,
      company.sars_tcs_pin_expiry,
    ),
    documentStatus(company.pi_insurance_document_path !== null || !!company.pi_insurance_policy_number, company.pi_insurance_expiry),
    isoStatus,
    documentStatus(
      company.bank_confirmation_letter_path !== null || !!company.bank_confirmation_letter_date,
      company.bank_confirmation_letter_valid_until,
      BANK_LETTER_RENEW_SOON_DAYS,
    ),
    documentStatus(company.bee_proof_document_path !== null || !!company.bee_level, company.bee_proof_expiry),
  ];
  const expiredCount = docStatuses.filter((s) => s.tone === "destructive").length;
  // "Needs date verification" (warning tone) and genuine "Renew soon"
  // (also warning tone, from documentStatus()/expiryStatus()) share one
  // tone deliberately - both mean "look at this document", the chip label
  // just can't distinguish them at the rollup level without re-deriving
  // which one it is per document; that's fine here, the per-row badges
  // below already say exactly which.
  const renewSoonCount = docStatuses.filter((s) => s.tone === "warning").length;
  const notOnFileCount = docStatuses.filter((s) => s.tone === "muted").length;
  const allGood = expiredCount === 0 && renewSoonCount === 0 && notOnFileCount === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {expiredCount > 0 && <SummaryChip count={expiredCount} label={expiredCount === 1 ? "document expired" : "documents expired"} tone="destructive" />}
        {renewSoonCount > 0 && <SummaryChip count={renewSoonCount} label="need attention" tone="warning" />}
        {notOnFileCount > 0 && <SummaryChip count={notOnFileCount} label="not on file" tone="muted" />}
        {allGood && <SummaryChip count={docStatuses.length} label="documents current" tone="success" />}
      </div>

      <CompanyIdentitySection company={company} />
      <SizeOfficesSection company={company} />
      <SavingsBaselineSection company={company} />
      <HowWeWorkSection company={company} />
      <ComplianceDocumentsSection company={company} docUrls={docUrls} />
      <BeeCidbSection company={company} />
      <BankDetailsSection company={company} />
    </div>
  );
}
