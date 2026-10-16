"use server";

/**
 * "Looks right" affordance on an assumed_default field_provenance row.
 *
 * field_provenance has no reviewed_at (or similar) column yet, so there is
 * nowhere to persist a human's "I checked this, it's fine" signal. This is a
 * deliberate v1 simplification (see Tender Workspace build task, 2026-10-16):
 * wiring a real review state needs a small migration (e.g.
 * `alter table field_provenance add column reviewed_at timestamptz`, plus an
 * RLS-safe update policy) that's out of scope here. For now this action is a
 * no-op so the button has somewhere to call without lying about persistence.
 *
 * TODO(reviewed_at): once that column exists, make this an authenticated
 * update of the matching field_provenance row (by tender_pack_id + field_key)
 * and revalidate the tender workspace page.
 */
export async function markFieldReviewed(fieldKey: string): Promise<void> {
  void fieldKey; // kept in the signature for when reviewed_at lands - see TODO above.
}
