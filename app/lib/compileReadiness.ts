/**
 * "Can our engine actually interpret and compile this" signal for a
 * discovered-but-not-yet-pursued opportunity (Sarel, 2026-10-19 admin review
 * ask). Used by /admin/discovered-opportunities.
 *
 * What this honestly can and can't tell you: a discovered opportunity has NO
 * uploaded/downloaded documents yet - that only happens once a company
 * "pursues" it (pursue_discovered_opportunity, migrations 0024/0051) and goes
 * through intake (engine/intake/classify_tender.py), which is where the real
 * compile-readiness check lives: open each document, detect whether a
 * workbook is a known SANRAL Technical Submission family
 * (engine/fingerprint.py detect_family on its actual sheet set), diff it
 * against the stored baseline, and check which of the required returnable
 * documents (C.1.1.1, C.1.2.3, A-Forms, Financial workbook) were uploaded.
 * NONE of that can run here - there is nothing downloaded to open.
 *
 * So this function does NOT fake that check. It looks only at what Discovery
 * already recorded about the release (document_urls, categories, reasons,
 * score_outlook, source - see migrations 0004/0013/0051) and reports one of
 * three honest states:
 *
 *   "flagged"         - something about the listing itself looks wrong or
 *                        incomplete BEFORE any document is even opened (no
 *                        documents listed, a SANRAL release with nothing to
 *                        click through to, a category the taxonomy never
 *                        matched, or a scorer that recorded nothing at all).
 *                        A human should look at this one specifically.
 *   "needs_documents"  - nothing looks obviously wrong, but whether the
 *                        engine can actually fill this tender is genuinely
 *                        unknown until the documents are downloaded and
 *                        opened at intake. This is the default, honest
 *                        answer for the common case.
 *   "looks_ready"      - on top of "needs_documents", at least one listed
 *                        document's title/filename matches a known SANRAL
 *                        Technical/Financial Submission workbook naming
 *                        pattern. This is a filename guess, not a real
 *                        fingerprint check (that needs the file open) - it
 *                        raises confidence, it does not confirm anything.
 */

export type CompileReadinessStatus = "flagged" | "needs_documents" | "looks_ready";

export type DocumentUrlLike = { url?: string | null; title?: string | null };

export type CompileReadinessInput = {
  source?: string | null;
  document_urls?: DocumentUrlLike[] | null;
  categories?: string[] | null;
  reasons?: string[] | null;
  score_outlook?: unknown;
};

export type CompileReadiness = {
  status: CompileReadinessStatus;
  label: string;
  /** One sentence per reason the status landed where it did - shown verbatim in the UI. */
  detail: string[];
};

export const COMPILE_READINESS_LABEL: Record<CompileReadinessStatus, string> = {
  flagged: "Flagged",
  needs_documents: "Needs documents downloaded",
  looks_ready: "Looks ready",
};

// Loose filename/title hints for a SANRAL Technical or Financial Submission
// workbook, same documents classify_tender.py's classify_workbook() actually
// opens and checks via engine/fingerprint.py detect_family(). This is only
// ever a text match on a title/URL string - it cannot see the real sheet set.
const SANRAL_WORKBOOK_HINTS = [
  /technical\s+submission/i,
  /financial\s+submission/i,
  /\bC\s*2\.4\b/i,
  /\.xlsm(?:$|[?#])/i,
];

function hasUsableDocuments(docs: DocumentUrlLike[]): boolean {
  return docs.some((d) => (d.url && d.url.trim()) || (d.title && d.title.trim()));
}

function isRecognizedCategory(categories: string[]): boolean {
  return categories.length > 0 && !categories.every((c) => c.startsWith("uncategorized"));
}

/** Pure classifier - no network, no Supabase. Safe to run in a server component render loop. */
export function assessCompileReadiness(input: CompileReadinessInput): CompileReadiness {
  const docs = (input.document_urls ?? []).filter((d): d is DocumentUrlLike => !!d);
  const categories = input.categories ?? [];
  const reasons = input.reasons ?? [];
  const flags: string[] = [];

  if (!hasUsableDocuments(docs)) {
    flags.push("No documents are listed for this release at all - there is nothing yet for the engine to read.");
  }
  if (input.source === "sanral") {
    flags.push(
      "SANRAL source: SANRAL's own site gates the real files behind a form, so these links may not be direct " +
        "document downloads even when present - check manually before assuming anything is fetchable.",
    );
  }
  if (!isRecognizedCategory(categories)) {
    flags.push("No category/discipline the taxonomy recognises was matched for this release.");
  }
  if (reasons.length === 0 && (input.score_outlook === null || input.score_outlook === undefined)) {
    flags.push("The discovery scorer recorded no fit reasons and no score outlook for this release.");
  }

  if (flags.length > 0) {
    return { status: "flagged", label: COMPILE_READINESS_LABEL.flagged, detail: flags };
  }

  const looksLikeKnownWorkbook = docs.some(
    (d) => SANRAL_WORKBOOK_HINTS.some((re) => re.test(d.title ?? "") || re.test(d.url ?? "")),
  );
  if (looksLikeKnownWorkbook) {
    return {
      status: "looks_ready",
      label: COMPILE_READINESS_LABEL.looks_ready,
      detail: [
        "A listed document's title or filename matches a known SANRAL Technical/Financial Submission workbook " +
          "naming pattern - likely fingerprint-matchable once downloaded, but this is a filename guess, not a real " +
          "open-and-check. That only happens at intake, once a company pursues this tender.",
      ],
    };
  }

  return {
    status: "needs_documents",
    label: COMPILE_READINESS_LABEL.needs_documents,
    detail: [
      "Documents are listed and nothing looks wrong yet, but whether the engine can actually compile this tender " +
        "is genuinely unknown until the documents are downloaded and opened at intake (workbook family fingerprint " +
        "match, required-document detection - engine/intake/classify_tender.py). Nothing here can tell you that in advance.",
    ],
  };
}

/**
 * Numeric/banded confidence ("can we fully build/compile this one") - Sarel's
 * scope addition on top of the status above: "indicate the confidence level,
 * I then need to review and help improve the confidence levels." This is NOT
 * a separate guess - it is the same signals assessCompileReadiness() already
 * looked at, PLUS the real extraction engine/discovery/opportunity_requirements.py
 * writes once a release's documents are downloaded and actually opened
 * (discovered_opportunity_requirements, migration 0072).
 *
 * Weights are deliberately small and named, listed here so they can be
 * sanity-checked line by line rather than trusted as a black box:
 *
 *   BASE                          20   every opportunity starts here
 *   +10  hasDocuments             at least one document is listed/downloaded
 *   +10  recognizedCategory       taxonomy matched a real category
 *   +10  hasScoringSignal         the scorer recorded reasons or an outlook
 *   +35  routeSanralFamilyMatched requirements extraction found a SANRAL
 *                                 workbook of a KNOWN family (real, not guessed)
 *   +15  routeGeneral             requirements extraction ran and found a
 *                                 general (non-SANRAL) route - a real answer,
 *                                 just a shallower one (see compileReadiness.ts's
 *                                 header / the migration's comment on why a
 *                                 general tender gets no itemised list here)
 *   +20  fingerprintOk            the SANRAL workbook matches the stored
 *                                 baseline exactly - sanral_fill can run
 *   -40  fingerprintBad           the workbook MISMATCHES the baseline or
 *                                 could not even be fingerprinted - the real
 *                                 pack run would stop on this
 *   -10  per missing required doc, capped at -30
 *   -25  unreadableDocument       a workbook/doc could not be opened at all
 *   -15  failedDownload           at least one document for this release
 *                                 failed to download
 *
 * Capped at 40 when requirements have never been extracted (documents not
 * downloaded/classified yet) - everything above is then only a listing-level
 * guess, never allowed to read as "high confidence".
 */

export type RequirementsStatus = "not_downloaded" | "extracted";

export type RequirementsExtraction = {
  status: RequirementsStatus;
  route?: "sanral" | "general" | null;
  family?: string | null;
  fingerprint_status?: "ok" | "mismatch" | "no_baseline" | "error" | null;
  missing?: string[] | null;
  unreadable_documents?: string[] | null;
  failed_downloads?: number | null;
};

export type ConfidenceBand = "low" | "medium" | "high";

export type CompileConfidence = {
  level: number; // 0-100
  band: ConfidenceBand;
  /** One sentence per signal that moved the number - shown verbatim in the UI, in order applied. */
  basis: string[];
};

const CONFIDENCE_BASE = 20;
const NOT_DOWNLOADED_CAP = 40;
const MISSING_DOC_PENALTY = -10;
const MISSING_DOC_PENALTY_CAP = -30;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function assessCompileConfidence(
  input: CompileReadinessInput,
  requirements?: RequirementsExtraction | null,
): CompileConfidence {
  const docs = (input.document_urls ?? []).filter((d): d is DocumentUrlLike => !!d);
  const categories = input.categories ?? [];
  const reasons = input.reasons ?? [];
  let level = CONFIDENCE_BASE;
  const basis: string[] = [`Base 20/100 - every opportunity starts here.`];

  if (hasUsableDocuments(docs)) {
    level += 10;
    basis.push("+10: at least one document is listed for this release.");
  } else {
    basis.push("+0: no documents are listed for this release at all.");
  }
  if (isRecognizedCategory(categories)) {
    level += 10;
    basis.push("+10: the taxonomy recognised this release's category.");
  } else {
    basis.push("+0: no category the taxonomy recognises was matched.");
  }
  if (reasons.length > 0 || (input.score_outlook !== null && input.score_outlook !== undefined)) {
    level += 10;
    basis.push("+10: the discovery scorer recorded fit reasons or a score outlook.");
  } else {
    basis.push("+0: the scorer recorded nothing for this release.");
  }

  if (!requirements || requirements.status !== "extracted") {
    level = Math.min(level, NOT_DOWNLOADED_CAP);
    basis.push(
      `Capped at ${NOT_DOWNLOADED_CAP}/100: requirements have not been extracted yet (documents not downloaded) - ` +
        "route, template family and fingerprint are all unknown, so this is a listing-level guess only.",
    );
  } else {
    if (requirements.route === "sanral" && requirements.family) {
      level += 35;
      basis.push(`+35: requirements extraction found a recognised SANRAL workbook family ('${requirements.family}').`);
    } else if (requirements.route === "general") {
      level += 15;
      basis.push("+15: requirements extraction ran and classified this as a general (non-SANRAL) tender.");
    } else {
      basis.push("+0: requirements extraction ran but found nothing to route on (no classifiable workbook/form).");
    }

    if (requirements.fingerprint_status === "ok") {
      level += 20;
      basis.push("+20: the workbook matches the stored template baseline exactly.");
    } else if (requirements.fingerprint_status === "mismatch" || requirements.fingerprint_status === "error") {
      level -= 40;
      basis.push(
        `-40: the workbook ${requirements.fingerprint_status === "mismatch" ? "does not match" : "could not be checked against"} ` +
          "the stored template baseline - a real pack run would stop here.",
      );
    }

    const missingCount = requirements.missing?.length ?? 0;
    if (missingCount > 0) {
      const penalty = Math.max(MISSING_DOC_PENALTY_CAP, MISSING_DOC_PENALTY * missingCount);
      level += penalty;
      basis.push(`${penalty}: ${missingCount} required document(s) are missing (${requirements.missing!.join(", ")}).`);
    }
    if ((requirements.unreadable_documents?.length ?? 0) > 0) {
      level -= 25;
      basis.push(`-25: ${requirements.unreadable_documents!.length} document(s) could not be opened at all.`);
    }
    if ((requirements.failed_downloads ?? 0) > 0) {
      level -= 15;
      basis.push(`-15: ${requirements.failed_downloads} document download(s) for this release failed.`);
    }
  }

  level = clamp(Math.round(level), 0, 100);
  const band: ConfidenceBand = level >= 70 ? "high" : level >= 40 ? "medium" : "low";
  return { level, band, basis };
}

/** Sarel's correction always wins over the computed number when present - never silently recomputed over. */
export function effectiveConfidence(
  computed: CompileConfidence,
  override: { level: number | null | undefined; note?: string | null } | null | undefined,
): { level: number; band: ConfidenceBand; isOverridden: boolean; note: string | null } {
  if (override && override.level !== null && override.level !== undefined) {
    const level = clamp(override.level, 0, 100);
    const band: ConfidenceBand = level >= 70 ? "high" : level >= 40 ? "medium" : "low";
    return { level, band, isOverridden: true, note: override.note ?? null };
  }
  return { level: computed.level, band: computed.band, isOverridden: false, note: null };
}
