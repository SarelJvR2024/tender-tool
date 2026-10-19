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
