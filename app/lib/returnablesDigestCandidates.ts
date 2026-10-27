// "Pack Incomplete / Returnables Checklist" digest - Phase 6 of the
// Admin Command Center / notification brief (Sarel's own explicit spec,
// 2026-10-27): once a tender a company is tracking enters the 3-5
// BUSINESS day window before closing, and at least one MANDATORY
// returnable is missing, expired or unverified, send one nudge naming
// exactly what's outstanding.
//
// "Mandatory" here means the real, already-existing concept this schema
// tracks for each family - never a second, invented notion of "important":
//   - SANRAL Conventional (lib/tenderCompliance.ts): ComplianceItem.mandatory,
//     the actual Stage 2 "Mandatory Administration Criteria" that disqualify
//     a bid (CSD registration, COID Letter of Good Standing, Form of Offer)
//   - General/non-SANRAL (lib/generalTender.ts): ManifestReturnable.strength
//     === "required", requirements.py's own reading of which returnables
//     this tender's documents actually ask for
// A tender whose family maps to neither (confirmed by reading
// app/tenders/[id]/page.tsx's own isSanralFamily/isGeneralFamily checks -
// e.g. "RRM Consultant Tender", or a manually loaded tender with no family
// set) has no mandatory-item concept anywhere in this codebase yet, so this
// module reports mapped:false and the script sends nothing for it - the
// same "not mapped yet" honesty compliance-data.ts's own loadTenderCompliance()
// already uses, not a guess.
//
// "Missing, expired, or unverified" = ComplianceStatus !== "have": both
// families already collapse "not on file" and "expired/lapses before
// closing" into "missing", and "check" (can't confirm from what's on file)
// is the real "unverified" state - no separate expiry math needed here.
//
// Deliberately only computes the mandatory-item result, not the full
// compliance report (positions, score estimate, experience matching, role
// fit): those feed only NON-mandatory items this digest never reports, so
// recomputing them here would be pure waste and extra service-role-safe
// surface for zero behavioural difference - see NEUTRAL_SANRAL_EXTRAS'
// own comment for exactly which SANRAL inputs that is and why it's safe.
import type { SupabaseClient } from "@supabase/supabase-js";
import { SANRAL_CONVENTIONAL_FAMILY, COMPANY_VAULT_COLUMNS, sanralConventionalDocumentChecks, type CompanyVault } from "./tenderCompliance.ts";
import { GENERAL_FAMILY, GENERAL_COMPANY_COLUMNS, checkReturnable, type GeneralCompany, type RequirementManifest, type TenderAnswer } from "./generalTender.ts";

export const RETURNABLES_DIGEST_MIN_BUSINESS_DAYS = 3;
export const RETURNABLES_DIGEST_MAX_BUSINESS_DAYS = 5;

export type ReturnablesWindowTenderRow = {
  id: string;
  contract_no: string | null;
  description: string | null;
  title: string | null;
  closing_date: string | null;
  family: string | null;
  document_requirements: unknown;
  tender_packs: { company_id: string }[];
};

export type ReturnablesWindowCandidate = {
  tender: ReturnablesWindowTenderRow;
  companyId: string;
  businessDaysLeft: number;
};

/**
 * Every (tender, company) whose tender closes within the 3-5 BUSINESS day
 * window - one entry PER COMPANY actually tracking it via tender_packs, not
 * one per tender (the same "a tender is one shared row, several unrelated
 * companies may each have their own pack against it" fix
 * deadlineReminderCandidates() already applies - see that function's own
 * comment for the real bug this avoids repeating).
 *
 * businessDaysBetweenFn is injected rather than imported (same reasoning
 * lib/deadlineReminders.ts's own header gives: this file needs to import
 * cleanly under a direct `node --experimental-strip-types` run with no
 * bundler, and an injected function keeps the window logic trivially
 * unit-testable without a live clock).
 */
export function returnablesWindowCandidates(
  tenderRows: ReturnablesWindowTenderRow[],
  todayStr: string,
  businessDaysBetweenFn: (startDateStr: string, endDateStr: string) => number,
): ReturnablesWindowCandidate[] {
  const out: ReturnablesWindowCandidate[] = [];
  for (const tender of tenderRows) {
    if (!tender.closing_date) continue;
    const businessDaysLeft = businessDaysBetweenFn(todayStr, tender.closing_date.slice(0, 10));
    if (businessDaysLeft < RETURNABLES_DIGEST_MIN_BUSINESS_DAYS || businessDaysLeft > RETURNABLES_DIGEST_MAX_BUSINESS_DAYS) continue;
    for (const companyId of (tender.tender_packs ?? []).map((p) => p.company_id).filter(Boolean)) {
      out.push({ tender, companyId, businessDaysLeft });
    }
  }
  return out;
}

export type ReturnablesMissingResult = {
  /** false = this tender's family has no mandatory-item concept mapped yet (see this file's own header) - nothing to check, and nothing sent; never reported as "all clear". */
  mapped: boolean;
  missingLabels: string[];
  /** Jump-link id on the real Tender Workspace page (app/tenders/[id]) this family's checklist renders under - compliance-report.tsx's #compliance-check, or general-workspace.tsx's #general-documents. */
  workspaceAnchor: "compliance-check" | "general-documents";
};

// The SANRAL mandatory items (CSD/A7, COID/A20, Form of Offer/C1.1.1) only
// ever read `company`, `closingDate`, `provenance` and `hasPack` - confirmed
// by reading sanralConventionalDocumentChecks() itself. Every other input
// that function takes (financial capture, briefing task, experience,
// evidence, authority letter) feeds ONLY non-mandatory items this digest
// filters out afterward, so passing real values for them here would compute
// results this digest never reports - these neutral/unused values are
// honest, not a corner cut.
const NEUTRAL_SANRAL_EXTRAS = {
  financialCaptureStatus: null,
  briefingTask: null,
  experience: null,
  experienceAvailable: false,
  evidence: null,
  authorityLetter: undefined,
} as const;

/** Explicit company_id/tender_id filters throughout, never relying on RLS - same service-role-safe pattern lib/complianceDigestCandidates.ts's own header documents for the identical reason (a service-role caller has no signed-in user, so RLS can't scope it for us). */
export async function returnablesMissingMandatoryItems(
  supabase: SupabaseClient,
  tender: { id: string; family: string | null; closing_date: string | null; document_requirements: unknown },
  companyId: string,
): Promise<ReturnablesMissingResult> {
  if (tender.family === SANRAL_CONVENTIONAL_FAMILY) {
    const [{ data: company }, { data: pack }] = await Promise.all([
      supabase.from("companies").select(COMPANY_VAULT_COLUMNS).eq("id", companyId).maybeSingle(),
      supabase.from("tender_packs").select("id").eq("tender_id", tender.id).eq("company_id", companyId).maybeSingle(),
    ]);
    const packId = (pack?.id as string | undefined) ?? null;
    const provenance = packId
      ? (((await supabase.from("field_provenance").select("field_key, status").eq("tender_pack_id", packId)).data ?? []) as { field_key: string; status: string }[])
      : [];
    const items = sanralConventionalDocumentChecks({
      company: (company as unknown as CompanyVault | null) ?? null,
      closingDate: tender.closing_date,
      provenance,
      hasPack: !!packId,
      ...NEUTRAL_SANRAL_EXTRAS,
    });
    const missing = items.filter((i) => i.mandatory && i.status !== "have");
    return { mapped: true, missingLabels: missing.map((i) => `${i.form} ${i.label}`), workspaceAnchor: "compliance-check" };
  }

  if (tender.family !== GENERAL_FAMILY) {
    return { mapped: false, missingLabels: [], workspaceAnchor: "general-documents" };
  }

  const [{ data: company }, { data: pack }, { data: answerRows }] = await Promise.all([
    supabase.from("companies").select(`${COMPANY_VAULT_COLUMNS}, ${GENERAL_COMPANY_COLUMNS}`).eq("id", companyId).maybeSingle(),
    supabase.from("tender_packs").select("document_requirements").eq("tender_id", tender.id).eq("company_id", companyId).maybeSingle(),
    supabase.from("tender_answers").select("field_key, value, storage_path, original_filename, updated_at").eq("tender_id", tender.id).eq("company_id", companyId),
  ]);
  // Own private-document reading takes priority over the shared manifest,
  // same resolution rule general-workspace.tsx itself uses.
  const manifest = ((pack?.document_requirements ?? tender.document_requirements) as RequirementManifest | null) ?? null;
  if (!manifest) return { mapped: false, missingLabels: [], workspaceAnchor: "general-documents" };

  const answers = (answerRows ?? []) as TenderAnswer[];
  const jvAnswer = answers.find((a) => a.field_key === "bidding_as_jv")?.value ?? null;
  const biddingAsJv = jvAnswer === null ? null : jvAnswer === "yes";
  const checks = manifest.returnables.map((r) => checkReturnable(r, (company as unknown as GeneralCompany | null) ?? null, tender.closing_date, answers, biddingAsJv));
  const missing = checks.filter((c) => c.strength === "required" && c.status !== "have");
  return { mapped: true, missingLabels: missing.map((c) => c.label), workspaceAnchor: "general-documents" };
}
