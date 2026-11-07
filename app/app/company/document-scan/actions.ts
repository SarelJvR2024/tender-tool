"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { VAULT_BUCKET } from "@/lib/vaultDocuments";
import { safeRedirectPath } from "@/lib/safeRedirect";
import { sastToday } from "@/lib/publicHolidays";
import {
  ONBOARDING_BUCKET,
  VAULT_DOCUMENT_COLUMN,
  VAULT_FIELD_COLUMNS,
  VAULT_SUBFOLDER,
  parseBeeLevel,
  safeFileName,
  type DocumentKind,
} from "@/lib/onboardingScan";

// Bulk onboarding document scan (migration 0063). The ONLY code that writes
// an AI-proposed onboarding document anywhere real - everything before this
// is a proposal (onboarding_document_results, review_status pending_review)
// nobody but a person's explicit Confirm has acted on. Mirrors
// app/app/people/actions.ts applyCvExtraction()'s own rule exactly: writes
// only what the reviewer ticked, and only on this one action.

const BACK = "/company/document-scan";
type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function requireCompanyId(): Promise<{ supabase: SupabaseClient; companyId: string; userId: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership, error: membershipError } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (membershipError) throw new Error("Couldn't verify your company - try again.");
  if (!membership) redirect("/onboarding");
  return { supabase, companyId: membership.company_id as string, userId: user.id };
}

function fail(message: string): never {
  redirect(`${BACK}?error=${encodeURIComponent(message)}`);
}

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

function num(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// Spec v3 Batch 4: a page embedding DocumentReviewCard somewhere other than
// /company/document-scan (e.g. /experience) can ask to be returned to
// instead, via a hidden return_to field alongside result_id - see
// review.tsx's own returnTo prop. Every existing caller omits it, so every
// existing redirect/revalidate target is unchanged. Only a same-origin
// relative path is honoured (an open-redirect guard - this is user-supplied
// form data, never trusted as-is) - see lib/safeRedirect.ts for why
// startsWith("/") alone (what this used to check) isn't enough.
function backTo(formData: FormData): string {
  return safeRedirectPath(str(formData, "return_to"), BACK);
}

/**
 * Registers one batch of already-uploaded files (the browser uploads
 * straight to the 'onboarding-documents' bucket first - see upload-form.tsx
 * - exactly like the manual tender load does for the 'tender-documents'
 * bucket, to stay under Vercel's 4.5 MB Server Action body cap). Each row
 * starts life as 'classification_requested'; engine/onboarding/
 * process_onboarding_jobs.py picks it up from there.
 */
export async function registerOnboardingBatch(input: {
  batchId: string;
  files: { storagePath: string; originalFilename: string }[];
}) {
  const { supabase, companyId, userId } = await requireCompanyId();
  if (!/^[0-9a-f-]{36}$/i.test(input.batchId)) return { error: "Invalid upload - start again." };
  const prefix = `${companyId}/`;
  const rows = input.files
    .filter((f) => f.storagePath.startsWith(prefix))
    .map((f) => ({
      company_id: companyId,
      batch_id: input.batchId,
      storage_path: f.storagePath,
      original_filename: f.originalFilename,
      status: "classification_requested" as const,
      uploaded_by: userId,
    }));
  if (rows.length === 0) return { error: "Choose at least one file to upload." };
  const { error } = await supabase.from("onboarding_uploads").insert(rows);
  if (error) {
    console.error("onboarding_uploads insert failed", error);
    return { error: "Could not register these uploads - try again. If it keeps happening, let us know." };
  }
  revalidatePath(BACK);
  return { ok: true, batchId: input.batchId };
}

async function copyBetweenBuckets(
  supabase: SupabaseClient,
  fromBucket: string,
  fromPath: string,
  toBucket: string,
  toPath: string,
  contentType: string,
): Promise<string | null> {
  const { data: blob, error: dlErr } = await supabase.storage.from(fromBucket).download(fromPath);
  if (dlErr || !blob) {
    console.error("onboarding document download failed", fromPath, dlErr);
    return "Could not read the uploaded file - try again. If it keeps happening, let us know.";
  }
  const { error: upErr } = await supabase.storage.from(toBucket).upload(toPath, blob, { contentType });
  if (upErr) {
    console.error("onboarding document copy-upload failed", toPath, upErr);
    return "Could not file the document - try again. If it keeps happening, let us know.";
  }
  return null;
}

type ResultRow = {
  id: string;
  company_id: string;
  onboarding_upload_id: string;
  document_kind: DocumentKind;
  fields: Record<string, { value: string | number | null; evidence: string | null; verified: boolean; warnings: string[] }>;
  review_status: string;
  onboarding_uploads: { storage_path: string; original_filename: string } | null;
};

async function loadPendingResult(supabase: SupabaseClient, companyId: string, resultId: string): Promise<ResultRow> {
  const { data: row, error } = await supabase
    .from("onboarding_document_results")
    .select("id, company_id, onboarding_upload_id, document_kind, fields, review_status, onboarding_uploads(storage_path, original_filename)")
    .eq("id", resultId)
    .maybeSingle();
  if (error) {
    console.error("onboarding_document_results select failed", error);
    fail("Could not load this document - try again. If it keeps happening, let us know.");
  }
  if (!row || row.company_id !== companyId) fail("That document wasn't found.");
  if (row.review_status !== "pending_review") fail("This document was already reviewed.");
  return row as unknown as ResultRow;
}

function ticked(formData: FormData, key: string): boolean {
  return formData.get(`use_${key}`) === "on";
}

// ---------------------------------------------------------------------------
// Vault-column kinds: cidb_registration, bbbee_certificate, sars_tax_clearance,
// bank_confirmation_letter, pi_insurance_certificate, iso_9001_certificate.
// Each maps ticked `fields` keys onto existing `companies` columns (see
// app/lib/vaultDocuments.ts for the document-path half of this table) and
// always files the document copy itself (filing a document and ticking a
// field are separate questions - the document is why you confirmed at all).
// ---------------------------------------------------------------------------

export async function confirmVaultDocument(formData: FormData) {
  const { supabase, companyId } = await requireCompanyId();
  const resultId = str(formData, "result_id");
  if (!resultId) fail("Missing document.");
  const result = await loadPendingResult(supabase, companyId, resultId!);
  const columns = VAULT_FIELD_COLUMNS[result.document_kind];
  const docColumn = VAULT_DOCUMENT_COLUMN[result.document_kind];
  if (!columns || !docColumn) fail("This document type isn't filed this way.");

  const update: Record<string, string | number | null | boolean> = {};
  const appliedFields: string[] = [];
  for (const [field, column] of Object.entries(columns)) {
    if (!ticked(formData, field)) continue;
    const raw = str(formData, `f_${field}`);
    update[column] = field === "bee_level" ? parseBeeLevel(raw) : raw;
    appliedFields.push(field);
  }
  if (result.document_kind === "bbbee_certificate" && ticked(formData, "bee_level")) {
    update.bee_level = parseBeeLevel(str(formData, "f_bee_level"));
  }
  if (result.document_kind === "iso_9001_certificate") {
    update.iso_9001_certified = true; // filing the certificate is the statement
  }

  const upload = result.onboarding_uploads;
  if (!upload) fail("The uploaded file for this document is missing.");
  const destPath = `${companyId}/vault/${VAULT_SUBFOLDER[result.document_kind]}/${randomUUID()}-${safeFileName(upload!.original_filename)}`;
  const copyErr = await copyBetweenBuckets(supabase, ONBOARDING_BUCKET, upload!.storage_path, VAULT_BUCKET, destPath, "application/octet-stream");
  if (copyErr) fail(copyErr);
  update[docColumn] = destPath;

  // Atomic lock-check-write (migration 0124, Finding 185): locks the
  // onboarding_document_results row, re-checks company membership/not-
  // employee and review_status = 'pending_review' under that lock, writes
  // only the ticked companies columns, and marks the row applied - all in
  // one transaction, so a second concurrent confirm for the SAME result
  // (double-click, two tabs) blocks on the row lock and then gets a clear
  // "already reviewed" error instead of silently re-filing. Replaces the
  // old unlocked companies.update() + markApplied() pair, which shared the
  // SAME race this file's siblings below fix the same way. The old
  // "membership revoked mid-request" race this comment used to describe is
  // now covered by this function's own is_company_member()/
  // is_employee_in_company() re-check, done fresh under the lock rather
  // than via PostgREST's RLS re-evaluation.
  const { error } = await supabase.rpc("apply_onboarding_vault_document_checked", {
    p_result_id: resultId!,
    p_updates: update,
    p_applied_meta: { table: "companies", column: docColumn, fields: appliedFields },
  });
  if (error) {
    console.error("apply_onboarding_vault_document_checked failed", error);
    await supabase.storage.from(VAULT_BUCKET).remove([destPath]);
    fail(error.message || "Could not file this document - try again. If it keeps happening, let us know.");
  }
  await supabase.storage.from(ONBOARDING_BUCKET).remove([upload!.storage_path]);
  const back = backTo(formData);
  revalidatePath(back);
  redirect(`${back}?saved=filed`);
}

// ---------------------------------------------------------------------------
// experience_reference_letter -> experience_items (0012). Captured, but
// left untagged (tagged_at null) on purpose - tagging (disciplines, project
// type, rating) is its own deliberate manual step per 0012's own design,
// not something this scan can honestly do from a reference letter alone.
// ---------------------------------------------------------------------------

export async function confirmExperienceReferenceLetter(formData: FormData) {
  const { supabase, companyId } = await requireCompanyId();
  const resultId = str(formData, "result_id");
  if (!resultId) fail("Missing document.");
  const result = await loadPendingResult(supabase, companyId, resultId!);
  if (result.document_kind !== "experience_reference_letter") fail("Wrong document type for this action.");
  const upload = result.onboarding_uploads;
  if (!upload) fail("The uploaded file for this document is missing.");

  const clientName = ticked(formData, "client_name") ? str(formData, "f_client_name") : null;
  const contractNumber = ticked(formData, "contract_number") ? str(formData, "f_contract_number") : null;
  const projectName = contractNumber || clientName || upload!.original_filename;

  // Found 2026-10-30: a third entry point into experience_items.value_rm
  // (0012) with the same gap app/app/experience/actions.ts's saveExperienceTags()
  // had before this session's own prior standing-review pass fixed it there -
  // num() here only ever rejected NaN, never a negative number, and this
  // bulk-onboarding review screen's own number input has no min either. Same
  // unit, same downstream readers (engine/narrative/build_prompt.py's real
  // customer-facing AI narrative text, 0012's match_experience() RPC >= filter) -
  // missed earlier because this is a different form (AI-proposed document
  // review, not the manual "add experience" form), not because it's a
  // different column.
  const valueRm = ticked(formData, "project_value_rm") ? num(formData, "f_project_value_rm") : null;
  if (valueRm !== null && valueRm < 0) fail("Project value (R million) must be a number of 0 or more.");

  const destPath = `${companyId}/experience/${randomUUID()}-${safeFileName(upload!.original_filename)}`;
  const copyErr = await copyBetweenBuckets(supabase, ONBOARDING_BUCKET, upload!.storage_path, "experience-documents", destPath, "application/octet-stream");
  if (copyErr) fail(copyErr);

  const row = {
    project_name: projectName,
    storage_path: destPath,
    original_filename: upload!.original_filename,
    client_name: clientName,
    contract_number: contractNumber,
    value_rm: valueRm,
    completion_date: ticked(formData, "completion_date") ? str(formData, "f_completion_date") : null,
    reference_contact_name: ticked(formData, "referee_name") ? str(formData, "f_referee_name") : null,
    reference_contact_phone: ticked(formData, "referee_phone") ? str(formData, "f_referee_phone") : null,
    reference_contact_email: ticked(formData, "referee_email") ? str(formData, "f_referee_email") : null,
  };
  // Atomic lock-check-write (migration 0124, Finding 185) - this is the
  // clearest, highest-severity instance: two concurrent confirms of the
  // SAME onboarding document used to both pass loadPendingResult()'s gate
  // and both INSERT, silently duplicating a real experience_items row (no
  // unique constraint on this table would have caught it). The RPC locks
  // the onboarding_document_results row, re-checks company membership/not-
  // employee and review_status under that lock, then performs the ONE
  // insert and marks the row applied in the same transaction.
  const { error } = await supabase.rpc("apply_onboarding_experience_letter_checked", {
    p_result_id: resultId!,
    p_row: row,
  });
  if (error) {
    console.error("apply_onboarding_experience_letter_checked failed", error);
    await supabase.storage.from("experience-documents").remove([destPath]);
    fail(error.message || "Could not file this document - try again. If it keeps happening, let us know.");
  }
  await supabase.storage.from(ONBOARDING_BUCKET).remove([upload!.storage_path]);
  const back = backTo(formData);
  revalidatePath(back);
  redirect(back === BACK ? `${back}?saved=filed#experience-items-note` : `${back}?saved=filed`);
}

// ---------------------------------------------------------------------------
// id_document -> company_principals.certified_id_path (0050). There is no
// way to know WHICH principal an ID document is for from the document
// alone, so the reviewer must pick one - never guessed, never auto-created.
// ---------------------------------------------------------------------------

export async function confirmIdDocument(formData: FormData) {
  const { supabase, companyId } = await requireCompanyId();
  const resultId = str(formData, "result_id");
  const principalId = str(formData, "principal_id");
  if (!resultId) fail("Missing document.");
  if (!principalId) fail("Choose which director/shareholder this ID belongs to before filing it.");
  const result = await loadPendingResult(supabase, companyId, resultId!);
  if (result.document_kind !== "id_document") fail("Wrong document type for this action.");
  const { data: principal } = await supabase.from("company_principals").select("id").eq("id", principalId).eq("company_id", companyId).maybeSingle();
  if (!principal) fail("That person isn't on your directors/shareholders register.");
  const upload = result.onboarding_uploads;
  if (!upload) fail("The uploaded file for this document is missing.");

  const destPath = `${companyId}/principals/${principalId}/${randomUUID()}-${safeFileName(upload!.original_filename)}`;
  const copyErr = await copyBetweenBuckets(supabase, ONBOARDING_BUCKET, upload!.storage_path, VAULT_BUCKET, destPath, "application/octet-stream");
  if (copyErr) fail(copyErr);

  // certified_id_on is a real date column certificationStatus() (lib/principals.ts)
  // measures "days ago" against for a compliance warning - new Date().toISOString()
  // is always UTC, so for the 00:00-01:59 SAST window every day (SAST = UTC+2, no
  // DST) a naive date-only stamp here silently recorded YESTERDAY's date, same
  // established naive-UTC-"today" bug class this codebase already fixed elsewhere
  // (lib/publicHolidays.ts's own sastToday() - standing review, 2026-11-06).
  //
  // Atomic lock-check-write (migration 0124, Finding 185): locks the
  // onboarding_document_results row, re-checks company membership/not-
  // employee, review_status = 'pending_review' and that this principal still
  // exists in this company, all under that lock, then writes the three
  // columns and marks the row applied - all in one transaction. Replaces the
  // old unlocked company_principals.update() + markApplied() pair (the old
  // "membership revoked mid-request" race this comment used to describe is
  // now covered by the RPC's own is_company_member()/is_employee_in_company()
  // re-check, done fresh under the lock).
  const { error } = await supabase.rpc("apply_onboarding_id_document_checked", {
    p_result_id: resultId!,
    p_principal_id: principalId!,
    p_dest_path: destPath,
    p_filename: upload!.original_filename,
    p_certified_on: sastToday(),
  });
  if (error) {
    await supabase.storage.from(VAULT_BUCKET).remove([destPath]);
    fail(error.message || "That person is no longer on your directors/shareholders register - it may have been removed. Refresh and try again.");
  }
  await supabase.storage.from(ONBOARDING_BUCKET).remove([upload!.storage_path]);
  const back = backTo(formData);
  revalidatePath(back);
  redirect(`${back}?saved=filed`);
}

// ---------------------------------------------------------------------------
// cv -> HANDOFF to the existing cv_uploads/extract_cv_fields.py pipeline
// (0008/0023) - never re-extracted here. This action's only job is to copy
// the file into 'cv-documents' and insert the exact row the People page's
// own upload form inserts; engine/cv/extract_cv_fields.py then takes over
// completely unchanged.
// ---------------------------------------------------------------------------

export async function confirmCvHandoff(formData: FormData) {
  const { supabase, companyId } = await requireCompanyId();
  const resultId = str(formData, "result_id");
  const personId = str(formData, "person_id");
  if (!resultId) fail("Missing document.");
  if (!personId) fail("Choose which person this CV belongs to before filing it.");
  const result = await loadPendingResult(supabase, companyId, resultId!);
  if (result.document_kind !== "cv") fail("Wrong document type for this action.");
  const { data: person } = await supabase.from("people").select("id").eq("id", personId).eq("company_id", companyId).maybeSingle();
  if (!person) fail("That person isn't on your People page.");
  const upload = result.onboarding_uploads;
  if (!upload) fail("The uploaded file for this document is missing.");

  const destPath = `${companyId}/people/${personId}/uploads/${randomUUID()}-${safeFileName(upload!.original_filename)}`;
  const copyErr = await copyBetweenBuckets(supabase, ONBOARDING_BUCKET, upload!.storage_path, "cv-documents", destPath, "application/octet-stream");
  if (copyErr) fail(copyErr);

  // Atomic lock-check-write (migration 0124, Finding 185) - the other real,
  // severe duplicate-row instance alongside confirmExperienceReferenceLetter()
  // above: two concurrent confirms of the SAME onboarding document used to
  // both pass loadPendingResult()'s gate and both INSERT, silently
  // duplicating a real cv_uploads row (no unique constraint on this table
  // would have caught it) and queuing a second real CV extraction. The RPC
  // locks the onboarding_document_results row, re-checks company
  // membership/not-employee, review_status, and that this person still
  // exists in this company, then performs the ONE insert and marks the row
  // applied in the same transaction.
  const { error } = await supabase.rpc("apply_onboarding_cv_handoff_checked", {
    p_result_id: resultId!,
    p_person_id: personId!,
    p_storage_path: destPath,
    p_original_filename: upload!.original_filename,
  });
  if (error) {
    console.error("apply_onboarding_cv_handoff_checked failed", error);
    await supabase.storage.from("cv-documents").remove([destPath]);
    fail(error.message || "Could not file this CV - try again. If it keeps happening, let us know.");
  }
  await supabase.storage.from(ONBOARDING_BUCKET).remove([upload!.storage_path]);
  const back = backTo(formData);
  revalidatePath(back);
  redirect(back === BACK ? `${back}?saved=handed-off#cv-handoff-note` : `${back}?saved=handed-off`);
}

// ---------------------------------------------------------------------------
// Never auto-filed: out of v1 scope (professional_registration_other) or
// genuinely unclassifiable (unknown). Explicitly acknowledged, never
// silently dropped - "skipped" keeps the upload file and the proposal
// around (shown as "needs manual review"), distinct from "discarded".
// ---------------------------------------------------------------------------

export async function skipOnboardingDocument(formData: FormData) {
  const { supabase, companyId } = await requireCompanyId();
  const resultId = str(formData, "result_id");
  if (!resultId) fail("Missing document.");
  const result = await loadPendingResult(supabase, companyId, resultId!);
  const back = backTo(formData);
  // .select("id").maybeSingle() here matters, same shape as
  // discardOnboardingDocument() right below (and confirmVaultDocument() /
  // confirmIdDocument() above) - pre-fix this checked nothing at all, not
  // even `error`: a membership-revoked-mid-request zero-row match on this
  // update still redirected with "saved=skipped" while the row stayed stuck
  // on "pending_review" - a silent false-success, not a destructive one
  // (no storage file is touched here), but the same dominant shape, found
  // sweeping this file's own siblings for the TS-side unprotected-read sweep
  // (standing review, 2026-11-06).
  //
  // .eq("review_status", "pending_review") here matters too (Finding 185,
  // 2026-11-07): without it, this single UPDATE statement would still match
  // and succeed even if the row had already moved on (applied, skipped
  // again, or discarded) by the time this request reaches the database -
  // e.g. a concurrent Confirm already filed the document and marked it
  // "applied" a moment ago, and this "Skip" (a double-click, or a second
  // browser tab left open on this same card) would silently overwrite that
  // back to "skipped", losing the fact that it was actually filed with no
  // error to either caller. A plain UPDATE with the right WHERE predicate is
  // already atomic in Postgres - no RPC/lock needed here, the same reasoning
  // discardCvExtraction()/discardMyCvExtraction() already used (standing
  // review, 2026-11-06).
  const { data: updated, error } = await supabase
    .from("onboarding_document_results")
    .update({ review_status: "skipped" })
    .eq("id", result.id)
    .eq("review_status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error || !updated) {
    console.error("onboarding_document_results skip update failed", error);
    fail("This document was already reviewed - refresh and try again.");
  }
  revalidatePath(back);
  redirect(`${back}?saved=skipped`);
}

export async function discardOnboardingDocument(formData: FormData) {
  const { supabase, companyId } = await requireCompanyId();
  const resultId = str(formData, "result_id");
  if (!resultId) fail("Missing document.");
  const result = await loadPendingResult(supabase, companyId, resultId!);
  const upload = result.onboarding_uploads;
  // .select("id").maybeSingle() here matters, same shape as
  // confirmVaultDocument()/confirmIdDocument() above: without it, a
  // membership-revoked-mid-request zero-row match on this update still let
  // the unconditional storage removal below destroy the upload's only copy,
  // while onboarding_document_results stayed stuck on "pending_review" with
  // nothing left to ever review (found re-reading this file end to end for
  // siblings of its own already-fixed functions, standing review,
  // 2026-11-06 - never swept before this pass).
  //
  // .eq("review_status", "pending_review") here matters too (Finding 185,
  // 2026-11-07), same reasoning as skipOnboardingDocument() above: without
  // it, a concurrent Confirm that already filed this document (and removed
  // the onboarding source file as part of filing it) racing this Discard
  // would still match and succeed, overwriting "applied" back to
  // "discarded" with no error - a confusing, wrong terminal state for a
  // document that was genuinely filed (the storage removal two lines below
  // is already a harmless no-op either way, since the source file is gone
  // once either path wins).
  const { data: updated, error } = await supabase
    .from("onboarding_document_results")
    .update({ review_status: "discarded" })
    .eq("id", result.id)
    .eq("review_status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error || !updated) {
    console.error("onboarding_document_results discard update failed", error);
    fail("This document was already reviewed - refresh and try again.");
  }
  if (upload?.storage_path) await supabase.storage.from(ONBOARDING_BUCKET).remove([upload.storage_path]);
  const back = backTo(formData);
  revalidatePath(back);
  redirect(`${back}?saved=discarded`);
}

/**
 * Re-queue a failed classification. UX audit re-review 2026-10-23, item 2:
 * a file that failed classification (process_onboarding_jobs.py ->
 * classification_failed) used to just vanish from this page - not counted
 * in "still being read", never shown in "To review" since no
 * onboarding_document_results row exists for it, no trace anywhere. The
 * file itself is untouched in storage, so there's no need to ask for it
 * again - just move it back where the worker picks it up.
 */
export async function retryOnboardingUpload(formData: FormData) {
  const { supabase, companyId } = await requireCompanyId();
  const uploadId = str(formData, "upload_id");
  if (!uploadId) fail("Missing document.");

  const { error } = await supabase
    .from("onboarding_uploads")
    .update({ status: "classification_requested", classification_error: null, classification_claimed_at: null, classification_completed_at: null })
    .eq("id", uploadId)
    .eq("company_id", companyId)
    .eq("status", "classification_failed");
  if (error) {
    console.error("onboarding_uploads retry update failed", error);
    fail("Could not retry this document - try again. If it keeps happening, let us know.");
  }

  const back = backTo(formData);
  revalidatePath(back);
  redirect(`${back}?saved=retrying`);
}
