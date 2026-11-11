/**
 * Pure logic for page.tsx's own "Key positions" card - extracted the same
 * way won-project-sync-logic.ts sits beside actions.ts, so this is testable
 * without a live Supabase client (none exists in this environment - see
 * System-Status.md's "no live Supabase project" gap).
 */

export type GeneratedCvJobRow = { id: string; position_code: string | null; person_id: string };

/**
 * Which `generated_cvs` job rows belong to the CURRENTLY confirmed person
 * for this position - not every row that merely carries this position's
 * code.
 *
 * Why this exists: page.tsx's own "Key positions" card used to list every
 * generated_cvs row matching a position's code
 * (`generatedCvs.filter((g) => g.position_code === code)`), with no
 * person_id check at all - the exact "stale reassignment" shape
 * won-project-sync-logic.ts's own staleSyncedProjectRows() already fixed
 * for `projects` rows (QA-Edge-Case-Findings.md, 2026-10-19), and
 * compliance-data.ts's CV lookup also had (Finding 400, PR #243, not yet
 * merged) - found independently here, a third, previously undocumented
 * site of the same shape. engine/pack/process_pack_jobs.py's own real
 * CV-gathering loop (build_submission_pack(), the "g for g in gen if
 * g['position_code'] == p['code'] and g['person_id'] == pid" line) already
 * requires both; this UI list never did.
 *
 * Concrete failure: position PL is confirmed for Henning, whose tailored
 * CV finishes generating ('ready', with real storage paths). PL is then
 * reassigned to Jane. The Key Positions card still shows Jane confirmed,
 * but the CV-jobs list underneath her row still lists Henning's own
 * "ready" job - complete with working Word/PDF download links - with
 * nothing on screen distinguishing whose CV it actually is. A reviewer
 * reading "ready" + download links next to Jane's name has a real reason
 * to believe Jane's own tailored CV already exists and download/attach the
 * wrong person's CV by hand. (The actual pack BUILD is unaffected either
 * way - process_pack_jobs.py's own loop already re-matches by person_id -
 * this is a human-facing display bug, not a document-content bug.)
 */
export function cvJobsForPosition<T extends GeneratedCvJobRow>(
  generatedCvs: T[],
  positionCode: string,
  confirmedPersonId: string | null,
): T[] {
  if (!confirmedPersonId) return [];
  return generatedCvs.filter((g) => g.position_code === positionCode && g.person_id === confirmedPersonId);
}
