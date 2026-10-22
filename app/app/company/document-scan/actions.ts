"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { VAULT_BUCKET } from "@/lib/vaultDocuments";
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
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
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
// form data, never trusted as-is).
function backTo(formData: FormData): string {
  const v = str(formData, "return_to");
  return v && v.startsWith("/") && !v.startsWith("//") ? v : BACK;
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

async function markApplied(supabase: SupabaseClient, resultId: string, userId: string | null, applied: Record<string, unknown>) {
  await supabase.from("onboarding_document_results").update({
    review_status: "applied", applied, reviewed_by: userId, reviewed_at: new Date().toISOString(),
  }).eq("id", resultId);
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
  const { supabase, companyId, userId } = await requireCompanyId();
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

  const { error } = await supabase.from("companies").update(update).eq("id", companyId);
  if (error) {
    console.error("companies update failed for onboarding document", error);
    await supabase.storage.from(VAULT_BUCKET).remove([destPath]);
    fail("Could not file this document - try again. If it keeps happening, let us know.");
  }
  await supabase.storage.from(ONBOARDING_BUCKET).remove([upload!.storage_path]);
  await markApplied(supabase, resultId!, userId, { table: "companies", column: docColumn, fields: appliedFields });
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
  const { supabase, companyId, userId } = await requireCompanyId();
  const resultId = str(formData, "result_id");
  if (!resultId) fail("Missing document.");
  const result = await loadPendingResult(supabase, companyId, resultId!);
  if (result.document_kind !== "experience_reference_letter") fail("Wrong document type for this action.");
  const upload = result.onboarding_uploads;
  if (!upload) fail("The uploaded file for this document is missing.");

  const clientName = ticked(formData, "client_name") ? str(formData, "f_client_name") : null;
  const contractNumber = ticked(formData, "contract_number") ? str(formData, "f_contract_number") : null;
  const projectName = contractNumber || clientName || upload!.original_filename;

  const destPath = `${companyId}/experience/${randomUUID()}-${safeFileName(upload!.original_filename)}`;
  const copyErr = await copyBetweenBuckets(supabase, ONBOARDING_BUCKET, upload!.storage_path, "experience-documents", destPath, "application/octet-stream");
  if (copyErr) fail(copyErr);

  const row = {
    company_id: companyId,
    project_name: projectName,
    document_type: "reference_letter" as const,
    storage_path: destPath,
    original_filename: upload!.original_filename,
    client_name: clientName,
    contract_number: contractNumber,
    value_rm: ticked(formData, "project_value_rm") ? num(formData, "f_project_value_rm") : null,
    completion_date: ticked(formData, "completion_date") ? str(formData, "f_completion_date") : null,
    reference_contact_name: ticked(formData, "referee_name") ? str(formData, "f_referee_name") : null,
    reference_contact_phone: ticked(formData, "referee_phone") ? str(formData, "f_referee_phone") : null,
    reference_contact_email: ticked(formData, "referee_email") ? str(formData, "f_referee_email") : null,
    uploaded_by: userId,
  };
  const { data: inserted, error } = await supabase.from("experience_items").insert(row).select("id").single();
  if (error) {
    console.error("experience_items insert failed for onboarding document", error);
    await supabase.storage.from("experience-documents").remove([destPath]);
    fail("Could not file this document - try again. If it keeps happening, let us know.");
  }
  await supabase.storage.from(ONBOARDING_BUCKET).remove([upload!.storage_path]);
  await markApplied(supabase, resultId!, userId, { table: "experience_items", id: inserted!.id });
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

  const { error } = await supabase.from("company_principals").update({
    certified_id_path: destPath, certified_id_filename: upload!.original_filename, certified_id_on: new Date().toISOString().slice(0, 10),
  }).eq("id", principalId);
  if (error) {
    await supabase.storage.from(VAULT_BUCKET).remove([destPath]);
    fail(error.message);
  }
  await supabase.storage.from(ONBOARDING_BUCKET).remove([upload!.storage_path]);
  await markApplied(supabase, resultId!, null, { table: "company_principals", id: principalId, column: "certified_id_path" });
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
  const { supabase, companyId, userId } = await requireCompanyId();
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

  const { data: cvUpload, error } = await supabase.from("cv_uploads").insert({
    company_id: companyId, person_id: personId, storage_path: destPath, original_filename: upload!.original_filename,
    mode: "ai_extract", status: "extraction_requested", uploaded_by: userId,
  }).select("id").single();
  if (error) {
    console.error("cv_uploads insert failed for onboarding document", error);
    await supabase.storage.from("cv-documents").remove([destPath]);
    fail("Could not file this CV - try again. If it keeps happening, let us know.");
  }
  await supabase.storage.from(ONBOARDING_BUCKET).remove([upload!.storage_path]);
  await markApplied(supabase, resultId!, userId, { handed_off_to: "cv_uploads", id: cvUpload!.id });
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
  await supabase.from("onboarding_document_results").update({ review_status: "skipped" }).eq("id", result.id);
  const back = backTo(formData);
  revalidatePath(back);
  redirect(`${back}?saved=skipped`);
}

export async function discardOnboardingDocument(formData: FormData) {
  const { supabase, companyId } = await requireCompanyId();
  const resultId = str(formData, "result_id");
  if (!resultId) fail("Missing document.");
  const result = await loadPendingResult(supabase, companyId, resultId!);
  const upload = result.onboarding_uploads;
  await supabase.from("onboarding_document_results").update({ review_status: "discarded" }).eq("id", result.id);
  if (upload?.storage_path) await supabase.storage.from(ONBOARDING_BUCKET).remove([upload.storage_path]);
  const back = backTo(formData);
  revalidatePath(back);
  redirect(`${back}?saved=discarded`);
}
