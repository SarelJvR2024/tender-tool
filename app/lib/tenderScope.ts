/**
 * Shared display helper for tender_scope_records (migration 0060,
 * engine/discovery/tender_enrichment.py) - specifically, whether a row's
 * AI-extracted scope_summary is still flagged as unverified.
 *
 * engine/discovery/scope_llm.py's own mandatory generate -> review -> revise
 * loop (per docs/specs/AI-Call-Quality-Standard.md) runs up to 3 self-review
 * passes, plus its own programmatic verify_evidence_quotes() check on top of
 * the model's self-check. When a real issue is still there after the last
 * pass, or a quote fails the programmatic check, the row is NOT thrown away -
 * the best draft found is kept - but the standard explicitly requires it not
 * be "silently shipped as if it passed its own check". There is deliberately
 * no dedicated boolean column for this (tender_enrichment.py's own
 * "scope_summary" docstring section explains why: no schema change for this
 * task); instead the fact is stamped into the one free-text `source_note`
 * column as the literal substring "NEEDS HUMAN REVIEW" - see
 * tender_enrichment.py's `enrich()`/`run()` and scope_llm.py's
 * `extract_scope_summary_llm()` for exactly how/when it's written.
 *
 * Before this existed, neither real reader of scope_summary -
 * app/app/discovery/page.tsx's own SCOPE_RECORD_COLUMNS list nor
 * app/app/tenders/[id]/page.tsx's own "Scope & pricing" card query - selected
 * source_note at all, so a flagged, unverified AI summary rendered with
 * exactly the same visual confidence as a verified one. One shared helper
 * here (rather than each page re-implementing the same substring check, the
 * exact drift shape Finding 310/pack-review-logic.ts's own header comment
 * already warns about) is the fix; each page still does its own select/read,
 * this only classifies the result.
 */
export function scopeNeedsHumanReview(sourceNote: string | null | undefined): boolean {
  return !!sourceNote && sourceNote.includes("NEEDS HUMAN REVIEW");
}
