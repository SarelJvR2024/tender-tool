import { SHORT_ACTION_FOR_FORM, type ComplianceItem } from "@/lib/tenderCompliance";

/**
 * The Product promise's own 3-way grouping (app/AGENTS.md): every bid task is
 * Verify (AI already filled this - just confirm it), Provide (only the user
 * can supply it - not a disqualification risk) or Fix (a disqualification
 * risk - red, with a reason and a fix action). This is the first screen to
 * actually implement that grouping; see "Verify/Provide/Fix grouping" in
 * app/AGENTS.md for why 3-4 different ad hoc status vocabularies existed
 * here before this (pack-review-logic.ts's 5-way ReviewStatus,
 * compliance-report.tsx's own "On file/Confirm by hand/Don't have", this
 * page's "Already confirmed/Please review/Needs your input" cards, and the
 * key-people section's un-grouped chips) and which of those this file
 * replaces first.
 */
export type BidTaskStatus = "verify" | "provide" | "fix";

export type BidTask = {
  status: BidTaskStatus;
  /** Only meaningful when status is "verify" - true once the AI-filled fact
   * is actually confirmed (ComplianceStatus "have"), false while it still
   * needs a look (ComplianceStatus "check"). */
  confirmed: boolean;
  label: string;
  reason: string;
  fixLabel: string;
  fixHref: string;
};

// Where fixing each doc item's own key actually happens - Company vault's
// real anchors (app/app/company/page.tsx's own Section ids) for anything
// that lives in the vault, a same-page anchor for anything tied to this
// tender itself (the briefing task, pack generation/pricing).
const FIX_HREF_FOR_KEY: Record<string, string> = {
  csd: "/company#compliance-documents",
  coid: "/company#compliance-documents",
  tax: "/company#compliance-documents",
  insurance: "/company#compliance-documents",
  quality_system: "/company#compliance-documents",
  authority: "/company#compliance-documents",
  bbbee: "/company#bee-cidb",
  bank: "/company#bank-details",
  past_performance: "/experience",
  briefing: "#tasks-milestones",
  hours: "#submission-pack",
  form_of_offer: "#submission-pack",
  declarations: "#submission-pack",
};

/**
 * Reclassifies one SANRAL compliance doc item (lib/tenderCompliance.ts's own
 * "have"/"missing"/"check" status plus its existing `mandatory` flag -
 * nothing new read or computed) into Verify/Provide/Fix:
 *
 * - mandatory and not yet confirmed (status "missing" OR "check") - a real
 *   disqualification risk by this data's own definition ("failing it
 *   disqualifies") - Fix, regardless of whether the item is outright
 *   missing or just unconfirmed.
 * - not mandatory and missing - something only the user can supply, with no
 *   disqualification risk - Provide.
 * - everything else (confirmed, or an optional item still needing a human
 *   look) - Verify.
 */
export function classifyComplianceItem(item: ComplianceItem): BidTask {
  const status: BidTaskStatus =
    item.mandatory && item.status !== "have" ? "fix" : item.status === "missing" ? "provide" : "verify";
  return {
    status,
    confirmed: item.status === "have",
    label: item.label,
    reason: item.detail,
    fixLabel: SHORT_ACTION_FOR_FORM[item.form] ?? `Review ${item.form}`,
    fixHref: FIX_HREF_FOR_KEY[item.key] ?? "#compliance-check",
  };
}
