import { expiryStatus } from "@/lib/dates";
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
  const isoStatus =
    company.iso_9001_certified === true
      ? expiryStatus(company.iso_9001_expiry)
      : company.iso_9001_certified === false
        ? NotStated("Not certified")
        : NotStated("Not stated");
  const docStatuses = [
    expiryStatus(company.coid_letter_of_good_standing_expiry),
    company.sars_tcs_pin || company.sars_tcs_pin_expiry ? expiryStatus(company.sars_tcs_pin_expiry) : NotStated("Not on file"),
    expiryStatus(company.pi_insurance_expiry),
    isoStatus,
    expiryStatus(company.bank_confirmation_letter_valid_until, BANK_LETTER_RENEW_SOON_DAYS),
    expiryStatus(company.bee_proof_expiry),
  ];
  const expiredCount = docStatuses.filter((s) => s.tone === "destructive").length;
  const renewSoonCount = docStatuses.filter((s) => s.tone === "warning").length;
  const notOnFileCount = docStatuses.filter((s) => s.tone === "muted").length;
  const allGood = expiredCount === 0 && renewSoonCount === 0 && notOnFileCount === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {expiredCount > 0 && <SummaryChip count={expiredCount} label={expiredCount === 1 ? "document expired" : "documents expired"} tone="destructive" />}
        {renewSoonCount > 0 && <SummaryChip count={renewSoonCount} label="renewing soon" tone="warning" />}
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
