"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { BEE_PROOF_TYPES, MAX_UPLOAD_BYTES, VAULT_BUCKET, VAULT_DOCUMENTS, isVaultDocumentKind } from "@/lib/vaultDocuments";
import { COMPANY_DOCUMENT_TYPES, GUIDELINE_MAX_CHARS, isCompanyDocumentType, isDocumentTemplateMode } from "@/lib/companyDocuments";
import { safeFileName } from "@/lib/safeFileName";

/**
 * Fields the edit form is allowed to write. Deliberately excludes any bank
 * account number field - account numbers live only in the restricted
 * bank_accounts table (0050, owners/admins only; 0001's own instruction),
 * never on companies, and this action must not add one here.
 * bank_confirmation_letter_valid_until is a generated column (0014) and must
 * never be written either.
 */
const TEXT_FIELDS = [
  "legal_name",
  "csd_trading_name",
  "cipc_registration_number",
  "vat_number",
  "income_tax_number",
  "paye_number",
  "csd_supplier_number",
  "coid_registration_number",
  "coid_letter_of_good_standing_number",
  "registered_address",
  "postal_address",
  "bank_name",
  "bank_branch_code",
  "status",
  "sars_tcs_pin",
  "pi_insurance_insurer",
  "pi_insurance_policy_number",
  "iso_9001_certificate_number",
  // SANRAL Form B3 head office (form-field audit 2026-10-18)
  "head_office",
] as const;

const DATE_FIELDS = [
  "coid_letter_of_good_standing_expiry",
  "sars_tcs_pin_expiry",
  "pi_insurance_expiry",
  "iso_9001_expiry",
  "bank_confirmation_letter_date",
  "bee_proof_expiry",
] as const;

const NUMERIC_FIELDS = [
  "bee_level",
  "black_ownership_pct",
  "bee_procurement_recognition_pct",
  "pi_insurance_cover_zar",
  // Form B3 counts: blank = null (not recorded), never 0 - see 0057.
  "other_offices",
  "ecsa_registered_staff_count",
  "sacpcmp_registered_staff_count",
  "total_employees",
  "typical_jv_share_pct",
] as const;

// Integer columns: a fractional count is refused rather than sent to Postgres.
const INTEGER_FIELDS = new Set(["other_offices", "ecsa_registered_staff_count", "sacpcmp_registered_staff_count", "total_employees", "bee_level"]);

const BEE_PROOF_VALUES = BEE_PROOF_TYPES.map((t) => t.value) as string[];

// Matches companies_how_we_work_length (0030).
const HOW_WE_WORK_MAX_CHARS = 10000;

/**
 * Updates the signed-in user's company row. RLS's "companies: members can
 * update" policy (is_company_member(id)) gates this, so a plain client
 * update - no RPC needed - is correct and safe here.
 */
export async function updateCompanyProfile(companyId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const update: Record<string, string | number | boolean | null> = {};

  for (const field of TEXT_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const trimmed = (raw as string).trim();
    update[field] = trimmed === "" ? null : trimmed;
  }

  for (const field of DATE_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const trimmed = (raw as string).trim();
    update[field] = trimmed === "" ? null : trimmed;
  }

  for (const field of NUMERIC_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const trimmed = (raw as string).trim();
    const n = trimmed === "" ? null : Number(trimmed);
    if (n !== null && (!Number.isFinite(n) || n < 0 || (INTEGER_FIELDS.has(field) && !Number.isInteger(n)))) {
      redirect(`/company?edit=1&error=${encodeURIComponent(`"${field.replace(/_/g, " ")}" must be a ${INTEGER_FIELDS.has(field) ? "whole " : ""}number of 0 or more.`)}`);
    }
    update[field] = n;
  }

  // "How we work" (0030): the company's own words, stored as typed - only the
  // browser's CRLF line endings are normalised and the ends trimmed. Never
  // rewritten or summarised (docs/specs/Company-Voice-Audit.md).
  const howWeWork = formData.get("how_we_work");
  if (howWeWork !== null) {
    const text = (howWeWork as string).replace(/\r\n?/g, "\n").trim();
    if (text.length > HOW_WE_WORK_MAX_CHARS) {
      redirect(
        `/company?edit=1&error=${encodeURIComponent(`"How we work" is ${text.length} characters - keep it under ${HOW_WE_WORK_MAX_CHARS}.`)}`,
      );
    }
    update.how_we_work = text === "" ? null : text;
  }

  // Tri-state: "" = not stated (null), never silently "not certified".
  const iso = formData.get("iso_9001_certified");
  if (iso !== null) update.iso_9001_certified = iso === "yes" ? true : iso === "no" ? false : null;

  const proof = formData.get("bee_proof_type");
  if (proof !== null) update.bee_proof_type = BEE_PROOF_VALUES.includes(proof as string) ? (proof as string) : null;

  const { error } = await supabase.from("companies").update(update).eq("id", companyId);

  if (error) {
    console.error("companies update failed", error);
    redirect(`/company?error=${encodeURIComponent("Could not save your company profile - try again. If it keeps happening, let us know.")}`);
  }

  revalidatePath("/company");
  redirect("/company?saved=1");
}

/**
 * Upload (or replace) the copy of one vault document. Same shape as
 * experience/actions.ts uploadFile: private bucket, path prefixed with the
 * company id (storage RLS in 0014 checks that prefix), path stored on the
 * row, previous copy removed only after the row points at the new one.
 */
export async function uploadVaultDocument(companyId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const kind = formData.get("kind") as string | null;
  if (!isVaultDocumentKind(kind)) redirect(`/company?error=${encodeURIComponent("Unknown document type.")}`);
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect(`/company?error=${encodeURIComponent("Choose a file to upload.")}`);
  if (file.size > MAX_UPLOAD_BYTES) {
    redirect(`/company?error=${encodeURIComponent("File is larger than 4.4 MB - scan it at a lower resolution or compress the PDF.")}`);
  }

  const column = VAULT_DOCUMENTS[kind].column;
  const { data: existing } = await supabase.from("companies").select(column).eq("id", companyId).maybeSingle();
  const previousPath = ((existing as Record<string, string | null> | null)?.[column] as string | null) ?? null;

  const safeName = safeFileName(file.name);
  const storagePath = `${companyId}/vault/${kind}/${randomUUID()}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (upErr) {
    console.error("vault document upload failed", file.name, upErr);
    redirect(`/company?error=${encodeURIComponent(`Could not upload ${file.name} - try again. If it keeps happening, let us know.`)}`);
  }

  const { error } = await supabase.from("companies").update({ [column]: storagePath }).eq("id", companyId);
  if (error) {
    console.error("companies update failed for vault document", error);
    await supabase.storage.from(VAULT_BUCKET).remove([storagePath]);
    redirect(`/company?error=${encodeURIComponent("Could not save this document - try again. If it keeps happening, let us know.")}`);
  }
  if (previousPath) await supabase.storage.from(VAULT_BUCKET).remove([previousPath]);

  revalidatePath("/company");
  redirect("/company?saved=doc");
}

/**
 * Saves the company's choice for one letter/document type (0037,
 * company_document_templates) - the same two-way choice as the CV upload's
 * "use as-is" / "AI-extract" (people/actions.ts uploadCv):
 *
 *   uploaded      - the company's own file, used as-is every time this document
 *                   is needed. A new file replaces the previous one; switching
 *                   back to "uploaded" without a new file keeps the one on file.
 *   ai_guideline  - the company's own wording with {{field}} marks, stored
 *                   exactly as typed (only CRLF -> LF and trimmed, same as
 *                   how_we_work). The engine fills the marks and nothing else.
 *
 * Both are kept on the row when the mode switches, so nothing is lost. RLS
 * ("company_document_templates: tenant isolation") and the company-documents
 * storage prefix policy (0014) gate the writes.
 */
export async function saveDocumentTemplate(companyId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const back: (msg: string) => never = (msg) => redirect(`/company?error=${encodeURIComponent(msg)}#letters`);
  const documentType = formData.get("document_type");
  if (!isCompanyDocumentType(documentType)) back("Unknown document type.");
  const type = COMPANY_DOCUMENT_TYPES.find((t) => t.key === documentType)!;
  const mode = formData.get("mode");
  if (!isDocumentTemplateMode(mode)) back(`Choose how the ${type.label.toLowerCase()} should be made: upload your own, or generate it from your guideline.`);

  const { data: existing } = await supabase
    .from("company_document_templates")
    .select("storage_path, original_filename, guideline")
    .eq("company_id", companyId)
    .eq("document_type", type.key)
    .maybeSingle();

  const row: Record<string, unknown> = {
    company_id: companyId,
    document_type: type.key,
    mode,
    storage_path: existing?.storage_path ?? null,
    original_filename: existing?.original_filename ?? null,
    guideline: existing?.guideline ?? null,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  let uploadedPath: string | null = null;
  if (mode === "uploaded") {
    const file = formData.get("file") as File | null;
    if (file && file.size > 0) {
      if (file.size > MAX_UPLOAD_BYTES) back("File is larger than 4.4 MB - save it at a lower resolution or compress the PDF.");
      const safeName = safeFileName(file.name);
      uploadedPath = `${companyId}/templates/${type.key}/${randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from(VAULT_BUCKET)
        .upload(uploadedPath, file, { contentType: file.type || "application/octet-stream" });
      if (upErr) {
        console.error("company document template upload failed", file.name, upErr);
        back(`Could not upload ${file.name} - try again. If it keeps happening, let us know.`);
      }
      row.storage_path = uploadedPath;
      row.original_filename = file.name;
    } else if (!existing?.storage_path) {
      back(`Choose your own ${type.label.toLowerCase()} file to upload.`);
    }
  } else {
    const text = String(formData.get("guideline") ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) back(`Write your guideline for the ${type.label.toLowerCase()} - your own wording, with {{fields}} where the tender's details go.`);
    if (text.length > GUIDELINE_MAX_CHARS) back(`The guideline is ${text.length} characters - keep it under ${GUIDELINE_MAX_CHARS}.`);
    row.guideline = text;
  }

  const { error } = await supabase.from("company_document_templates").upsert(row, { onConflict: "company_id,document_type" });
  if (error) {
    console.error("company_document_templates upsert failed", error);
    if (uploadedPath) await supabase.storage.from(VAULT_BUCKET).remove([uploadedPath]);
    back("Could not save this template - try again. If it keeps happening, let us know.");
  }
  if (uploadedPath && existing?.storage_path) await supabase.storage.from(VAULT_BUCKET).remove([existing.storage_path]);

  revalidatePath("/company");
  redirect("/company?saved=letter#letters");
}
