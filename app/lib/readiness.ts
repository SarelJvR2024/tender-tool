import { daysUntil } from "./dates";

/**
 * Bid readiness: a single weighted score (0-100) for how ready a company is
 * to bid, computed from data this app already tracks - not a separate
 * "profile completeness" concept invented for this. Pure function, no
 * Supabase call inside it: every caller (dashboard, Company vault, the
 * onboarding end screen) fetches its own slice of real data and passes it
 * in here, so the scoring rule lives in exactly one place.
 *
 * "Renew soon" / "expired" use the same 14-day window and daysUntil() math
 * DeadlineChip and expiryStatus() already use elsewhere - this just applies
 * it as a hard 0, not a soft amber warning, because a bid-readiness score
 * exists specifically to say "this document won't actually hold up".
 */

const EXPIRING_WITHIN_DAYS = 14;

export type ReadinessInput = {
  /** Company basics (10) */
  legalName: string | null;
  /** CSD (15) - no expiry tracked in this schema, presence only */
  csdSupplierNumber: string | null;
  /** Tax compliance (15) */
  taxPin: string | null;
  taxPinExpiry: string | null;
  /**
   * Standing review, 2026-11-09 (Finding 240's own sibling, same pass):
   * optional, defaults to null for the one caller that can't supply it yet
   * (lib/customerRowData.ts's admin customer list - its RPC,
   * platform_admin_company_readiness_data() in migration 0098, doesn't
   * return this column; a schema change is left for a separate pass per
   * this track's own guardrail against direct-pushing migrations). Omitting
   * it only ever makes this criterion as strict as it already was, never
   * stricter - see hasPin below.
   */
  taxPinDocumentPath?: string | null;
  /** B-BBEE, valid and not expired (15) */
  beeLevel: number | null;
  beeProofExpiry: string | null;
  /** Same optional/null-default note as taxPinDocumentPath above. */
  beeProofDocumentPath?: string | null;
  /** CIDB (15) */
  cidbGrading: string | null;
  cidbExpiry: string | null;
  /** Same optional/null-default note as taxPinDocumentPath above. */
  cidbDocumentPath?: string | null;
  /** Bank confirmation letter (5) */
  bankConfirmationValidUntil: string | null;
  /** At least one principal (5) */
  principalCount: number;
  /** At least 2 people with a CV on file (10) */
  peopleWithCvCount: number;
  /** At least 3 experience projects (10) */
  experienceProjectCount: number;
};

export type BlockerReason = "missing" | "expired" | "expiring_soon";

export type Criterion = {
  key: string;
  label: string;
  weight: number;
  satisfied: boolean;
  /** Only set when not satisfied. */
  reason?: BlockerReason;
  /** Only set when the criterion is expiry-based and a date is on file. */
  daysLeft?: number | null;
  href: string;
};

export type ReadinessResult = {
  percent: number;
  criteria: Criterion[];
  /** Unsatisfied criteria, sorted by weight (highest first) - "top N fixes" is blockers.slice(0, N). */
  blockers: Criterion[];
  /**
   * Raw pass-through of the input this was scored from - no new computation,
   * just surfaced so a caller can apply its OWN threshold instead of the
   * scored criteria's (e.g. Home's new-company setup checklist wants "at
   * least 1 person with a CV", a lower bar than the `people_cvs` criterion's
   * own 2-person weight-10 threshold - both are real, honest reads of the
   * same count, just different bars for different purposes).
   */
  peopleWithCvCount: number;
};

/** Expired or expiring within 14 days counts as not-current - null (no date on file) is a separate "missing" case, not treated as expired. */
function expiryState(dateStr: string | null): { current: boolean; reason: BlockerReason | null; daysLeft: number | null } {
  const daysLeft = daysUntil(dateStr);
  if (daysLeft === null) return { current: false, reason: "missing", daysLeft: null };
  if (daysLeft < 0) return { current: false, reason: "expired", daysLeft };
  if (daysLeft <= EXPIRING_WITHIN_DAYS) return { current: false, reason: "expiring_soon", daysLeft };
  return { current: true, reason: null, daysLeft };
}

function presence(value: string | null): boolean {
  return !!value && value.trim() !== "";
}

export function computeBidReadiness(input: ReadinessInput): ReadinessResult {
  const criteria: Criterion[] = [];

  criteria.push({
    key: "company_basics",
    label: "Company legal name on file",
    weight: 10,
    satisfied: presence(input.legalName),
    reason: presence(input.legalName) ? undefined : "missing",
    href: "/company#company-identity",
  });

  criteria.push({
    key: "csd",
    label: "CSD supplier number",
    weight: 15,
    satisfied: presence(input.csdSupplierNumber),
    reason: presence(input.csdSupplierNumber) ? undefined : "missing",
    href: "/company#company-identity",
  });

  {
    // Standing review, 2026-11-09: "hasPin" used to be presence(taxPin) alone
    // - text only, blind to a genuinely-uploaded PIN letter. That's the
    // EXACT bug Finding 240 fixed for the dashboard checklist (and
    // lib/vaultDocuments.ts's sarsTcsPinOnFile() for the two Company vault
    // views): "on file" for this field is document OR PIN text OR expiry
    // date, not text alone. This criterion feeds the readiness PERCENT and
    // the "blockers" list shown on the dashboard, the Company page header
    // AND right next to ComplianceDocumentsSection.tsx on that same page -
    // the old narrower rule meant a company that had uploaded the letter
    // but not yet typed the PIN saw "SARS tax compliance PIN" as a top
    // blocker here while the vault section two inches below it, reading the
    // same row, already said "Needs date verification"/"On file". Mirrors
    // sarsTcsPinOnFile()'s exact three-way rule.
    const hasPin = presence(input.taxPin) || !!input.taxPinDocumentPath || !!input.taxPinExpiry;
    const expiry = expiryState(input.taxPinExpiry);
    const satisfied = hasPin && (expiry.current || input.taxPinExpiry === null);
    criteria.push({
      key: "tax_compliance",
      label: "SARS tax compliance PIN",
      weight: 15,
      satisfied,
      reason: satisfied ? undefined : !hasPin ? "missing" : expiry.reason ?? "missing",
      daysLeft: hasPin ? expiry.daysLeft : undefined,
      href: "/company#compliance-documents",
    });
  }

  {
    // Same fix, same reason: mirrors ComplianceDocumentsSection.tsx/
    // ReadOnlyView.tsx's own established bee_proof hasFile rule
    // (`bee_proof_document_path !== null || !!bee_level` - deliberately NOT
    // OR'd with the expiry date for this one field, matching those two
    // views exactly) instead of a narrower, independently-derived guess.
    const hasLevel = input.beeLevel !== null || !!input.beeProofDocumentPath;
    const expiry = expiryState(input.beeProofExpiry);
    const satisfied = hasLevel && (expiry.current || input.beeProofExpiry === null);
    criteria.push({
      key: "bee",
      label: "B-BBEE level (valid, not expired)",
      weight: 15,
      satisfied,
      reason: satisfied ? undefined : !hasLevel ? "missing" : expiry.reason ?? "missing",
      daysLeft: hasLevel ? expiry.daysLeft : undefined,
      href: "/company#bee-cidb",
    });
  }

  {
    // Same fix, same reason: mirrors ComplianceDocumentsSection.tsx's own
    // established cidb hasFile rule (`cidb_document_path !== null ||
    // !!cidb_grading || !!cidb_expiry` - the three-way OR, same shape as
    // sars_tcs_pin's) instead of a narrower, independently-derived guess.
    const hasGrading = presence(input.cidbGrading) || !!input.cidbDocumentPath || !!input.cidbExpiry;
    const expiry = expiryState(input.cidbExpiry);
    const satisfied = hasGrading && (expiry.current || input.cidbExpiry === null);
    criteria.push({
      key: "cidb",
      label: "CIDB grading",
      weight: 15,
      satisfied,
      reason: satisfied ? undefined : !hasGrading ? "missing" : expiry.reason ?? "missing",
      daysLeft: hasGrading ? expiry.daysLeft : undefined,
      href: "/company#bee-cidb",
    });
  }

  {
    const expiry = expiryState(input.bankConfirmationValidUntil);
    criteria.push({
      key: "bank_confirmation",
      label: "Bank confirmation letter",
      weight: 5,
      satisfied: expiry.current,
      reason: expiry.reason ?? undefined,
      daysLeft: expiry.daysLeft,
      href: "/company#bank-details",
    });
  }

  criteria.push({
    key: "principal",
    label: "At least one principal on file",
    weight: 5,
    satisfied: input.principalCount >= 1,
    reason: input.principalCount >= 1 ? undefined : "missing",
    href: "/company/principals",
  });

  criteria.push({
    key: "people_cvs",
    label: "At least 2 people with a CV on file",
    weight: 10,
    satisfied: input.peopleWithCvCount >= 2,
    reason: input.peopleWithCvCount >= 2 ? undefined : "missing",
    href: "/people",
  });

  criteria.push({
    key: "experience",
    label: "At least 3 experience projects",
    weight: 10,
    satisfied: input.experienceProjectCount >= 3,
    reason: input.experienceProjectCount >= 3 ? undefined : "missing",
    href: "/experience",
  });

  const percent = criteria.reduce((sum, c) => sum + (c.satisfied ? c.weight : 0), 0);
  const blockers = criteria.filter((c) => !c.satisfied).sort((a, b) => b.weight - a.weight);

  return { percent, criteria, blockers, peopleWithCvCount: input.peopleWithCvCount };
}
