/**
 * Pure logic for CvCompare's own "Tailored (this tender)" pick - extracted
 * the same way position-cv-jobs-logic.ts sits beside page.tsx, so this is
 * testable without a live Supabase client.
 *
 * Why this exists: CvCompare's own `generated_cvs` query picked the newest
 * row by `requested_at` - when a request was MADE, not when it finished.
 * The real pack builder (engine/pack/process_pack_jobs.py's own
 * `cv_download_target()`, called from `gather()`'s CV loop) picks the
 * newest row by `completed_at` among ready rows that actually have a
 * `storage_path_pdf` - a generated CV with no PDF conversion is skipped
 * there entirely, falling back to the person's as-is upload instead; this
 * function mirrors that exact rule.
 *
 * Concrete failure this closes: a person's tailored CV is requested twice
 * for the same position - once "detailed" (more content, takes longer to
 * generate), then shortly after once "summary" (quicker). The summary job,
 * requested SECOND, finishes FIRST. CvCompare's own `requested_at`-ordered
 * query showed the summary one (requested most recently) as "the tailored
 * CV going into this pack" - but the real pack builder, ordering by
 * `completed_at`, picks whichever one finished LAST, which by then is the
 * detailed one. The preview and the real pack silently disagreed on which
 * CV variant the company was actually about to submit.
 */

export type TailoredCvRow = {
  id: string;
  storage_path_docx: string | null;
  storage_path_pdf: string | null;
  format: string;
  detail: string;
  completed_at: string | null;
};

/**
 * Among this position+person's own `status='ready'` rows, the one the real
 * pack builder would actually embed - the newest by `completed_at` among
 * those with a real `storage_path_pdf` (a ready row whose PDF conversion
 * never produced a path is never used by the real pack, so it is never
 * shown here as "the tailored CV" either - `null` in that case, same as
 * "not generated yet", not a docx-only row the pack would silently skip).
 */
export function pickTailoredCv<T extends TailoredCvRow>(rows: T[]): T | null {
  const withPdf = rows.filter((r) => r.storage_path_pdf);
  if (withPdf.length === 0) return null;
  return withPdf.reduce((latest, r) => ((r.completed_at ?? "") > (latest.completed_at ?? "") ? r : latest));
}
