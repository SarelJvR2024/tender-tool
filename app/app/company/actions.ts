"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { MAX_UPLOAD_BYTES, VAULT_BUCKET, VAULT_DOCUMENTS, isVaultDocumentKind } from "@/lib/vaultDocuments";
import { COMPANY_DOCUMENT_TYPES, GUIDELINE_MAX_CHARS, isCompanyDocumentType, isDocumentTemplateMode } from "@/lib/companyDocuments";
import { safeFileName } from "@/lib/safeFileName";
import { buildCompanyUpdate } from "@/lib/companyProfileUpdate";

/**
 * Updates the signed-in user's company row. RLS's "companies: members can
 * update" policy (is_company_member(id)) gates this, so a plain client
 * update - no RPC needed - is correct and safe here. Field validation/shaping
 * is shared with the onboarding wizard's compliance step - see
 * lib/companyProfileUpdate.ts.
 */
export async function updateCompanyProfile(companyId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { update, error: validationError } = buildCompanyUpdate(formData);
  if (validationError) {
    redirect(`/company?edit=1&error=${encodeURIComponent(validationError)}`);
  }

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
