"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/**
 * Tenant check, same pattern as app/app/people/actions.ts's own
 * requireCompanyId - each actions.ts file keeps its own copy rather than a
 * shared lib, matching the rest of this codebase's convention.
 */
async function requireCompanyId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) redirect("/onboarding");
  return membership.company_id as string;
}

/**
 * "Generate tender-specific CV" (Tender Workspace page) - integration point B
 * from Sarel's own direction (2026-10-16): for a key person already confirmed
 * on this tender's position (tender_pack_assignments.confirmed_person_id),
 * request the tender-customized CV with the requirement-matching cover page.
 *
 * Only ever records a request (generated_cvs, status 'requested') - the web
 * app cannot run engine/cv/generate_cv.py itself (no Python/LibreOffice on
 * Vercel). engine/cv/process_cv_jobs.py fulfills it out-of-band and builds
 * the cover page straight from this same tender_pack_assignments row's own
 * suggested_score/suggested_rationale (suggest_pack.py's own scoring, already
 * stored at confirm time) - never a new matcher.
 */
export async function requestTenderCv(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const tenderId = formData.get("tender_id") as string | null;
  const tenderPackId = formData.get("tender_pack_id") as string | null;
  const positionCode = formData.get("position_code") as string | null;
  const personId = formData.get("person_id") as string | null;
  const format = (formData.get("format") as string | null) ?? "sanral_keyperson";
  const detail = (formData.get("detail") as string | null) ?? "summary";

  if (!tenderId) redirect("/tenders");
  if (!tenderPackId || !positionCode || !personId) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("Confirm a key person for this position before generating a tender-specific CV.")}`);
  }

  const { error } = await supabase.from("generated_cvs").insert({
    company_id: companyId,
    person_id: personId,
    tender_id: tenderId,
    tender_pack_id: tenderPackId,
    position_code: positionCode,
    format,
    detail,
    status: "requested",
    requested_by: user?.id ?? null,
  });
  if (error) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}`);
}

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

/**
 * Tender task/deadline timeline (Tender Workspace page, alongside the
 * readiness report per the build task's own requirement). Standard
 * milestones (closing/briefing/clarification/submission) and manual tasks
 * live in the same table (tender_tasks, migration 0009) - this action only
 * ever inserts a manual one: free-text description + due date, no fixed
 * dropdown of task types, per the explicit spec requirement ("this must NOT
 * be a fixed enum of anticipated task types"). kind/is_standard are left at
 * their defaults (null/false) - only the auto-seed path below sets kind.
 */
export async function addTenderTask(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const tenderId = formData.get("tender_id") as string | null;
  const description = (formData.get("description") as string | null)?.trim();
  const dueDate = (formData.get("due_date") as string | null) || null;

  if (!tenderId) redirect("/tenders");
  if (!description) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("A task needs a description.")}`);
  }

  const { error } = await supabase.from("tender_tasks").insert({
    company_id: companyId,
    tender_id: tenderId,
    description,
    due_date: dueDate,
    created_by: user?.id ?? null,
  });
  if (error) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}`);
}

const TASK_STATUSES = ["not_started", "in_progress", "done"] as const;
export type TenderTaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Inline status advance ("not started" -> "in progress" -> "done"), the real
 * persisted equivalent of review-button.tsx's pattern (same tap-a-button-to-
 * advance shape, but this one actually writes - tender_tasks.status exists,
 * unlike field_provenance.reviewed_at which review-button.tsx is stuck
 * without).
 */
export async function advanceTaskStatus(taskId: string, tenderId: string, currentStatus: TenderTaskStatus) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  const idx = TASK_STATUSES.indexOf(currentStatus);
  const next = TASK_STATUSES[Math.min(idx + 1, TASK_STATUSES.length - 1)];

  await supabase
    .from("tender_tasks")
    .update({ status: next })
    .eq("id", taskId)
    .eq("company_id", companyId);

  revalidatePath(`/tenders/${tenderId}`);
}

/**
 * Idempotent auto-seed of the one standard milestone whose date is already
 * known elsewhere (tenders.closing_date) - briefing/clarification/submission
 * stay manual-entry-only until their dates are actually extracted somewhere
 * (see migration 0009's header comment). Uses upsert + ignoreDuplicates
 * against the partial unique index on (company_id, tender_id, kind) so two
 * concurrent page views can't both insert a duplicate closing-milestone row
 * - no select-then-insert race.
 */
export async function ensureClosingMilestone(tenderId: string, closingDate: string | null) {
  if (!closingDate) return;
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  await supabase.from("tender_tasks").upsert(
    {
      company_id: companyId,
      tender_id: tenderId,
      description: "Tender closes",
      due_date: closingDate.slice(0, 10),
      kind: "closing",
      is_standard: true,
    },
    { onConflict: "company_id,tender_id,kind", ignoreDuplicates: true }
  );
}
