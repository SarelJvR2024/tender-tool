"use server";

// Tender Workspace "Quick Blocker Resolver" drawer (Sarel's own Batch 3
// brief, 2026-10-24): narrow, non-redirecting write paths for the company
// vault fields the drawer edits in place, so a tender workspace session
// never has to leave the page to fix a compliance blocker. Reuses the
// exact same validation/shaping (buildCompanyUpdate) and storage-upload
// logic (uploadVaultDocument's own, for COID) the full /company page
// already uses - two write paths for the same columns would risk drifting
// on what's allowed, exactly the "never a second number/writer that could
// disagree" rule this app already follows everywhere.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { buildCompanyUpdate } from "@/lib/companyProfileUpdate";
import { MAX_UPLOAD_BYTES, VAULT_BUCKET, VAULT_DOCUMENTS } from "@/lib/vaultDocuments";
import { safeFileName } from "@/lib/safeFileName";

async function requireCompanyId(companyId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).eq("company_id", companyId).maybeSingle();
  return membership ? companyId : null;
}

/**
 * Saves a handful of plain-text/number/date company fields (CSD number,
 * SARS Tax PIN, CIDB-adjacent dates, insurance figures, B-BBEE levels, ...)
 * from the drawer's own focused form - never a full company-profile submit.
 * buildCompanyUpdate() only touches keys actually present in the FormData,
 * so a one-field drawer produces a true partial update, same guarantee the
 * full /company edit form already relies on.
 */
export async function saveVaultQuickFields(
  tenderId: string,
  companyId: string,
  fields: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const verifiedCompanyId = await requireCompanyId(companyId);
  if (!verifiedCompanyId) return { ok: false, error: "Not signed in to this company." };

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);

  const { update, error: validationError } = buildCompanyUpdate(formData);
  if (validationError) return { ok: false, error: validationError };
  if (Object.keys(update).length === 0) return { ok: false, error: "Nothing to save." };

  const supabase = await createClient();
  const { error } = await supabase.from("companies").update(update).eq("id", verifiedCompanyId);
  if (error) {
    console.error("companies update failed (vault quick fix)", error);
    return { ok: false, error: "Could not save - try again. If it keeps happening, let us know." };
  }

  revalidatePath("/company");
  revalidatePath(`/tenders/${tenderId}`);
  return { ok: true };
}

/**
 * Direct-to-column document upload - COID only (lib/vaultDocuments.ts's own
 * VAULT_KIND_TO_DOCUMENT_KIND deliberately excludes it: no AI classifier
 * entry exists for COID, so there is no review step to bypass here, unlike
 * the other 6 vault kinds). Same bucket/path/replace-previous-copy logic as
 * app/company/actions.ts's own uploadVaultDocument, just returning instead
 * of redirecting so the drawer can show a real success state in place.
 */
export async function uploadCoidQuickFix(
  tenderId: string,
  companyId: string,
  file: File,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const verifiedCompanyId = await requireCompanyId(companyId);
  if (!verifiedCompanyId) return { ok: false, error: "Not signed in to this company." };
  if (!file || file.size === 0) return { ok: false, error: "Choose a file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File is larger than 4.4 MB - scan it at a lower resolution or compress the PDF." };
  }

  const supabase = await createClient();
  const column = VAULT_DOCUMENTS.coid.column;
  const { data: existing } = await supabase.from("companies").select(column).eq("id", verifiedCompanyId).maybeSingle();
  const previousPath = ((existing as Record<string, string | null> | null)?.[column] as string | null) ?? null;

  const safeName = safeFileName(file.name);
  const storagePath = `${verifiedCompanyId}/vault/coid/${randomUUID()}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (upErr) {
    console.error("vault document upload failed (coid quick fix)", file.name, upErr);
    return { ok: false, error: `Could not upload ${file.name} - try again. If it keeps happening, let us know.` };
  }

  const { error } = await supabase.from("companies").update({ [column]: storagePath }).eq("id", verifiedCompanyId);
  if (error) {
    console.error("companies update failed for vault document (coid quick fix)", error);
    await supabase.storage.from(VAULT_BUCKET).remove([storagePath]);
    return { ok: false, error: "Could not save this document - try again. If it keeps happening, let us know." };
  }
  if (previousPath) await supabase.storage.from(VAULT_BUCKET).remove([previousPath]);

  revalidatePath("/company");
  revalidatePath(`/tenders/${tenderId}`);
  return { ok: true };
}
