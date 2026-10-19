"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadTenderCompliance, packReadiness, PACK_REQUIRED_TEMPLATES } from "./compliance-data";
import { loadB7State } from "./b7-data";
import { advanceFoundToBidding } from "@/lib/pipeline";

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
 * "Generate submission pack" (Tender Workspace). Records a request in
 * pack_generation_jobs (migration 0017) - same shape as requestTenderCv() -
 * that engine/pack/process_pack_jobs.py fulfils out-of-band by running the
 * real SANRAL fill engines and merging one ordered, page-numbered PDF.
 *
 * Gating is recomputed here from the compliance report's own data
 * (loadTenderCompliance), not trusted from the form:
 *   - hard stop: a required position with no confirmed key person, a missing
 *     blank template, SANRAL Form B7 applying with no answer from the company
 *     (b7-data.ts), or a pack already queued/generating - the bridge would
 *     only fail (or duplicate the work);
 *   - explicit review: a pack_review_confirmations row (migration 0059) -
 *     set by "I've reviewed this" on the Pack Review card (pack-review.tsx,
 *     pack-review-actions.ts) after looking at the full pre-compile list:
 *     company data, key positions/CVs, form answers, signature, documents,
 *     Form B7. Replaces the old single "acknowledge gaps" checkbox - Sarel,
 *     2026-10-18: show the full list first, confirm there, not a blind tick.
 *     The gaps shown at request time are still stored with the row.
 */
export async function requestSubmissionPack(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const tenderId = formData.get("tender_id") as string | null;
  const tenderPackId = formData.get("tender_pack_id") as string | null;
  if (!tenderId) redirect("/tenders");
  const fail = (msg: string) => redirect(`/tenders/${tenderId}?error=${encodeURIComponent(msg)}#submission-pack`);
  if (!tenderPackId) fail("Create and confirm a tender pack for this tender before generating a submission pack.");

  const readiness = packReadiness(await loadTenderCompliance(tenderId));
  if (readiness.unfilledPositions.length > 0) {
    fail(`Confirm a key person for ${readiness.unfilledPositions.join(", ")} before generating the pack.`);
  }

  const { data: docRows } = await supabase.from("tender_documents").select("doc_type").eq("tender_id", tenderId);
  const onFile = new Set((docRows ?? []).map((d) => d.doc_type as string));
  const missingTemplates = PACK_REQUIRED_TEMPLATES.filter((t) => !onFile.has(t));
  if (missingTemplates.length > 0) {
    fail(`This tender's blank SANRAL templates aren't uploaded yet (${missingTemplates.join(", ")}).`);
  }

  // SANRAL Form B7 (0056): same hard stop as an unconfirmed position - a B7
  // that applies (or can't be ruled out) is never generated blank.
  const b7 = await loadB7State(tenderId);
  if (b7.blocker) fail(b7.blocker);

  const { data: active } = await supabase
    .from("pack_generation_jobs")
    .select("id")
    .eq("tender_id", tenderId)
    .in("status", ["requested", "generating"])
    .limit(1);
  if (active && active.length > 0) fail("A submission pack is already queued for this tender.");

  const hasGaps =
    !readiness.checked ||
    readiness.mandatoryMissing.length + readiness.missing.length + readiness.toConfirm.length + b7.warnings.length > 0;

  // Pack review (0059): a human must have looked at the full pre-compile
  // list (pack-review.tsx) before a pack can be requested, gaps or not.
  const { data: reviewRow } = await supabase
    .from("pack_review_confirmations")
    .select("reviewed_at, reviewed_by")
    .eq("tender_id", tenderId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!reviewRow?.reviewed_at) {
    fail("Review the full Pack Review list above and click \"I've reviewed this\" before generating a pack.");
  }
  const acknowledged = true; // reaching here means the review row exists; kept as a named value for readiness_snapshot below.

  // Who signs this bid (form-field audit 2026-10-18): stored as the tender's
  // own answer, the same key the general flow uses; the pack bridge reads it
  // (engine/pack/process_pack_jobs.py). Only a person of this company with a
  // signatory capacity is accepted.
  const signatoryId = String(formData.get("signatory_person_id") ?? "").trim();
  if (signatoryId) {
    const { data: signer } = await supabase
      .from("people")
      .select("id")
      .eq("id", signatoryId)
      .eq("company_id", companyId)
      .not("signatory_capacity", "is", null)
      .maybeSingle();
    if (!signer) fail("Choose a signatory from your People page (someone with a signatory capacity).");
    const { error: ansErr } = await supabase.from("tender_answers").upsert(
      { company_id: companyId, tender_id: tenderId, field_key: "signatory_person_id", value: signatoryId, answered_by: user?.id ?? null },
      { onConflict: "company_id,tender_id,field_key" },
    );
    if (ansErr) fail(ansErr.message);
  }

  const { error } = await supabase.from("pack_generation_jobs").insert({
    company_id: companyId,
    tender_id: tenderId,
    tender_pack_id: tenderPackId,
    status: "requested",
    readiness_snapshot: {
      checked: readiness.checked,
      mandatory_missing: readiness.mandatoryMissing,
      missing: readiness.missing,
      to_confirm: readiness.toConfirm,
      unfilled_positions: readiness.unfilledPositions,
      form_b7: { status: b7.applies.status, reason: b7.applies.reason, plan_mode: b7.plan?.mode ?? null, warnings: b7.warnings },
    },
    acknowledged_gaps: hasGaps && acknowledged,
    // Audit copy of the review this request relied on (0059) - set once here, never updated afterwards.
    reviewed_at: reviewRow?.reviewed_at ?? null,
    reviewed_by: reviewRow?.reviewed_by ?? null,
    requested_by: user?.id ?? null,
  });
  if (error) fail(error.message);
  // Pipeline board (0021): asking for a pack means we're bidding.
  await advanceFoundToBidding(supabase, tenderPackId!);

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/pipeline");
  redirect(`/tenders/${tenderId}#submission-pack`);
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
  // Optional assignee (migration 0011) - who's responsible for this task.
  // "" from the dropdown's own placeholder option means "leave unassigned".
  const assignedTo = (formData.get("assigned_to") as string | null) || null;

  if (!tenderId) redirect("/tenders");
  if (!description) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("A task needs a description.")}`);
  }

  const { error } = await supabase.from("tender_tasks").insert({
    company_id: companyId,
    tender_id: tenderId,
    description,
    due_date: dueDate,
    assigned_to: assignedTo,
    created_by: user?.id ?? null,
  });
  if (error) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}`);
}

/**
 * Reassign (or unassign, via an empty personId) an existing task/milestone
 * row - the "reassign later" half of migration 0011's assigned_to column.
 * Same inline tap-to-update shape as advanceTaskStatus above: no redirect,
 * just a scoped update + revalidate, called from a client component.
 */
export async function reassignTenderTask(taskId: string, tenderId: string, personId: string | null) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  await supabase
    .from("tender_tasks")
    .update({ assigned_to: personId || null })
    .eq("id", taskId)
    .eq("company_id", companyId);

  revalidatePath(`/tenders/${tenderId}`);
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
  // (0048 made tender_tasks_standard_kind_idx a full unique index: as a
  // partial one, Postgres refused this on_conflict target and the upsert
  // silently created nothing.)
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

/**
 * Same auto-seed for the briefing milestone, from tenders.briefing_date
 * (0048 - written by the tender-update watch when an addendum moves the
 * briefing, or by a person accepting a document's briefing date). A company
 * that starts working on the tender after the addendum gets its own
 * "Briefing session" task on its first view. Existing rows are left alone
 * (the watch / accept_tender_update_date() move every company's).
 */
export async function ensureBriefingMilestone(tenderId: string, briefingDate: string | null, briefingTime: string | null) {
  if (!briefingDate) return;
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  await supabase.from("tender_tasks").upsert(
    {
      company_id: companyId,
      tender_id: tenderId,
      description: `Briefing session${briefingTime ? ` at ${briefingTime}` : ""}`,
      due_date: briefingDate.slice(0, 10),
      kind: "briefing",
      is_standard: true,
    },
    { onConflict: "company_id,tender_id,kind", ignoreDuplicates: true }
  );
}

const REMINDER_KINDS = ["submission", "opening"] as const;
export type TenderReminderKind = (typeof REMINDER_KINDS)[number];
function isReminderKind(v: unknown): v is TenderReminderKind {
  return typeof v === "string" && (REMINDER_KINDS as readonly string[]).includes(v);
}

/**
 * Submission deadline + bid opening reminders (migration 0065). Deliberately
 * NOT a kind dropdown on the generic "Add a task" form above (that form's
 * own free-text shape is an explicit spec decision, see 0009's header
 * comment) - this is its own compact "Submission & opening" mini-section
 * with two small forms, one per kind. Unlike the auto-seed helpers above
 * (ignoreDuplicates, never overwrite a human edit), this upsert always
 * overwrites: the person is explicitly setting or correcting their own
 * reminder, on the same (company_id, tender_id, kind) unique index (0009/
 * 0048) 'closing'/'briefing' already use.
 *
 * tender_tasks.due_date is a plain date column with no time field - a time
 * or venue detail (e.g. "at 10:00, Head Office") is folded into the
 * free-text, editable description, same pattern ensureBriefingMilestone
 * above already uses for the briefing time.
 */
export async function setTenderReminder(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  const tenderId = formData.get("tender_id") as string | null;
  const kindRaw = formData.get("kind") as string | null;
  const description = (formData.get("description") as string | null)?.trim();
  const dueDate = (formData.get("due_date") as string | null) || null;

  if (!tenderId) redirect("/tenders");
  if (!isReminderKind(kindRaw)) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("Unknown reminder type.")}#tasks-milestones`);
  }
  if (!description) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("A reminder needs a description.")}#tasks-milestones`);
  }
  if (!dueDate) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("A reminder needs a date.")}#tasks-milestones`);
  }

  const { error } = await supabase.from("tender_tasks").upsert(
    {
      company_id: companyId,
      tender_id: tenderId,
      description,
      due_date: dueDate,
      kind: kindRaw as TenderReminderKind,
      is_standard: true,
    },
    { onConflict: "company_id,tender_id,kind" },
  );
  if (error) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent(error.message)}#tasks-milestones`);
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}#tasks-milestones`);
}

/**
 * "Won - record the completed project" (migration 0065, feature 2). Once a
 * tender's pipeline_stage reaches 'won' (0021, set from /pipeline), this
 * records what the actually-completed project looked like on the won
 * tender_pack row (project_completed_at/value/note) and syncs it into each
 * confirmed key person's own project history - the same `projects` table
 * (0001) the People page's CV generation already reads - so the next CV
 * built for them includes it without anyone retyping it there.
 *
 * Re-running after a correction (a later, truer completion value) upserts on
 * (person_id, source_tender_pack_id, position_code) - 0065's own partial
 * unique index - so it updates the same synced rows instead of duplicating
 * them. A confirmed position with nobody assigned is simply skipped (there
 * is no person to sync to); the UI lists it as "Not confirmed" so that is
 * never a silent gap.
 */
export async function syncWonProjectToTeam(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  const tenderId = formData.get("tender_id") as string | null;
  const tenderPackId = formData.get("tender_pack_id") as string | null;
  if (!tenderId) redirect("/tenders");
  const fail = (msg: string) => redirect(`/tenders/${tenderId}?error=${encodeURIComponent(msg)}#won-project`);
  if (!tenderPackId) fail("Tender pack not found.");

  const completedAt = (formData.get("project_completed_at") as string | null) || null;
  if (!completedAt) fail("A completion date is required.");

  const valueRaw = (formData.get("project_completion_value_rm") as string | null)?.trim();
  let value: number | null = null;
  if (valueRaw) {
    value = Number(valueRaw);
    if (!Number.isFinite(value) || value < 0) fail("Completion value must be a positive number (R millions).");
  }
  const note = (formData.get("project_completion_note") as string | null)?.trim() || null;

  // Re-derive the gate from the DB, not the submitted fields - same
  // reasoning requestSubmissionPack above uses for its own hard stops.
  const { data: packRow, error: packErr } = await supabase
    .from("tender_packs")
    .select("id, tender_id, pipeline_stage")
    .eq("id", tenderPackId!)
    .eq("company_id", companyId)
    .maybeSingle();
  if (packErr) fail(packErr.message);
  if (!packRow || packRow.tender_id !== tenderId) fail("Tender pack not found.");
  if (packRow!.pipeline_stage !== "won") fail("This tender hasn't been marked Won on the pipeline board yet.");

  const { error: updErr } = await supabase
    .from("tender_packs")
    .update({
      project_completed_at: completedAt,
      project_completion_value_rm: value,
      project_completion_note: note,
    })
    .eq("id", tenderPackId!)
    .eq("company_id", companyId);
  if (updErr) fail(updErr.message);

  const [{ data: assignmentRows }, { data: tenderRow }, { data: reqRows }] = await Promise.all([
    supabase.from("tender_pack_assignments").select("position_code, confirmed_person_id").eq("tender_pack_id", tenderPackId!),
    supabase.from("tenders").select("contract_no, title").eq("id", tenderId!).maybeSingle(),
    supabase.from("tender_requirements").select("position_code, position_description").eq("tender_id", tenderId!),
  ]);

  const clientAndNumber = tenderRow?.contract_no || tenderRow?.title || "Tender";
  const descByCode = new Map(
    (reqRows ?? []).map((r) => [r.position_code as string, r.position_description as string | null]),
  );

  const confirmed = (assignmentRows ?? []).filter(
    (a): a is { position_code: string; confirmed_person_id: string } => !!a.confirmed_person_id,
  );
  if (confirmed.length > 0) {
    const rows = confirmed.map((a) => ({
      company_id: companyId,
      person_id: a.confirmed_person_id,
      client_and_number: clientAndNumber,
      position_code: a.position_code,
      position_held: descByCode.get(a.position_code) || a.position_code,
      value_rm: value,
      end_date: completedAt,
      source_tender_pack_id: tenderPackId,
    }));
    const { error: syncErr } = await supabase
      .from("projects")
      .upsert(rows, { onConflict: "person_id,source_tender_pack_id,position_code" });
    if (syncErr) fail(syncErr.message);

    // CV-feeding history lives on each person's own People page -
    // revalidate every synced person's page, same precedent as
    // app/app/people/actions.ts's saveProject revalidating "/people/<id>".
    for (const a of confirmed) revalidatePath(`/people/${a.confirmed_person_id}`);
  }

  revalidatePath("/people");
  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/pipeline");
  redirect(`/tenders/${tenderId}#won-project`);
}
