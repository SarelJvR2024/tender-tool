/**
 * Pure logic for syncWonProjectToTeam (actions.ts) - extracted the same way
 * pack-review-logic.ts sits beside actions.ts, so this is testable without
 * a live Supabase client (none exists in this environment - see
 * System-Status.md's "no live Supabase project" gap).
 */

export type ConfirmedAssignment = { position_code: string; confirmed_person_id: string };
export type SyncedProjectRow = { id: string; person_id: string; position_code: string };

/**
 * Which previously-synced `projects` rows for this tender pack no longer
 * match who is CURRENTLY confirmed for their position - reassigned to a
 * different person, or the position un-confirmed entirely.
 *
 * Why this exists: position-person-select.tsx has no pipeline_stage gate,
 * so a key person can be reassigned off a position after "Won - record the
 * completed project" has already synced once. The upsert that follows this
 * (onConflict person_id,source_tender_pack_id,position_code) only ever
 * inserts or updates the CURRENT person's row - a different person_id is a
 * different row, never an update to the old one - so without deleting the
 * stale row first, the previously-synced (now wrong) person keeps a
 * `projects` entry claiming they worked this project forever, with no
 * later sync ever correcting it. QA-Edge-Case-Findings.md, 2026-10-19
 * (fifteenth run).
 */
export function staleSyncedProjectRows(
  confirmed: ConfirmedAssignment[],
  existingSynced: SyncedProjectRow[],
): SyncedProjectRow[] {
  const currentPersonByPosition = new Map(confirmed.map((a) => [a.position_code, a.confirmed_person_id]));
  return existingSynced.filter((row) => currentPersonByPosition.get(row.position_code) !== row.person_id);
}

/**
 * Whether a pipeline-stage move (pipeline/actions.ts's moveTenderStage and
 * recordOutcomeAndMoveStage - the only two writers of tender_packs.
 * pipeline_stage, lib/pipeline.ts) must clear this tender pack's own
 * already-synced `projects` rows (syncWonProjectToTeam, 0065) before it
 * takes effect.
 *
 * Why this exists: syncWonProjectToTeam() is gated one-directionally - it
 * only ever checks "is this pack CURRENTLY won" before writing a person's
 * project history (actions.ts line ~545) - but nothing anywhere checks the
 * reverse: once a pack stops being 'won' (corrected back to 'submitted' via
 * the board's own "← Back" mis-click fixer, lib/pipeline.ts's
 * PREVIOUS_STAGE, or changed to 'lost' via OutcomeForm's own "Mark Lost"
 * button - recordOutcomeAndMoveStage lets either outcome overwrite the
 * other at any time, by design, "to correct it later" per its own header
 * comment), any rows that sync already wrote stay in `projects` forever,
 * with no later sync ever re-checking them (WonProjectCard itself only
 * renders `pipeline_stage === "won"`, so there is no UI path left to even
 * see, let alone fix, a stale row once the stage has moved on). Those rows
 * feed directly into `engine/cv/generate_cv.py`'s own project-history
 * section - so a reverted/overturned award keeps falsely claiming a
 * completed project on every confirmed team member's next generated CV,
 * indefinitely, including a CV actually submitted in a later tender's pack.
 *
 * The rule is the simple symmetric counterpart to `pipeline_stage !== "won"`
 * fail`-ing the sync one event earlier (actions.ts line ~545): once the
 * PREVIOUS stage was 'won' and the NEW stage is anything else, whatever was
 * synced for that stay-at-won is now stale and must be cleared - regardless
 * of which of the two real "leaving won" paths it took.
 */
export function shouldClearWonProjectSync(previousStage: string | null | undefined, nextStage: string): boolean {
  return previousStage === "won" && nextStage !== "won";
}
