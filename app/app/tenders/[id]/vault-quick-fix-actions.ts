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

// Unlike every other requireCompanyId() in this codebase (swept for this
// exact shape in b002f4e, 2026-11-06), this one takes a caller-supplied
// companyId to cross-check against the signed-in user's real membership -
// a different enough signature that sweep's grep missed it. It used to
// discard the company_members read's own `error`, so a transient read
// failure was indistinguishable from "not actually a member" and surfaced
// the wrong, non-actionable message. Still fails closed either way (no
// security gap), but now the two cases are told apart - standing review,
// 2026-11-07.
async function requireCompanyId(companyId: string): Promise<{ ok: true; companyId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in to this company." };
  const { data: membership, error: membershipError } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (membershipError) {
    console.error("company_members read failed (vault quick fix requireCompanyId)", membershipError);
    return { ok: false, error: "Couldn't verify your company - try again." };
  }
  if (!membership) return { ok: false, error: "Not signed in to this company." };
  return { ok: true, companyId };
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
  const verified = await requireCompanyId(companyId);
  if (!verified.ok) return { ok: false, error: verified.error };

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);

  const { update, error: validationError } = buildCompanyUpdate(formData);
  if (validationError) return { ok: false, error: validationError };
  if (Object.keys(update).length === 0) return { ok: false, error: "Nothing to save." };

  const supabase = await createClient();
  // .select("id").maybeSingle() matters here exactly as it does on every
  // sibling plain update in this codebase (company/actions.ts
  // updateCompanyProfile(), uploadVaultDocument(), etc.): PostgREST returns
  // a 2xx with `error: null` and zero rows affected when RLS's own `using
  // (is_company_member(id))` (0001, re-evaluated against the OLD row) no
  // longer matches - e.g. another admin's removeMember() (0114) revoking
  // this user's own company_members row between requireCompanyId() above
  // and this write - indistinguishable from a real update by `error` alone.
  // This file's own requireCompanyId() re-checks membership synchronously,
  // but that check and this write are not atomic, so the same race window
  // every sibling file's fix closes is open here too (standing review,
  // 2026-11-07).
  const { data: updated, error } = await supabase.from("companies").update(update).eq("id", verified.companyId).select("id").maybeSingle();
  if (error || !updated) {
    console.error("companies update failed (vault quick fix)", error);
    return {
      ok: false,
      error: error
        ? "Could not save - try again. If it keeps happening, let us know."
        : "Your company record is no longer there - refresh and try again.",
    };
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
  const verified = await requireCompanyId(companyId);
  if (!verified.ok) return { ok: false, error: verified.error };
  if (!file || file.size === 0) return { ok: false, error: "Choose a file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File is larger than 4.4 MB - scan it at a lower resolution or compress the PDF." };
  }
  const verifiedCompanyId = verified.companyId;

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

  // .select("id").maybeSingle() here matters exactly as it does on
  // company/actions.ts's own uploadVaultDocument(), which this function is
  // a copy of: without it, the same membership-revoked-mid-request race
  // (0114) leaves the just-uploaded file orphaned AND deletes the still-
  // referenced previous file below regardless - worse than a plain orphan,
  // since the row ends up pointing at a file that no longer exists. This
  // copy never got the fix uploadVaultDocument() already has (standing
  // review, 2026-11-07).
  //
  // `.eq(column, previousPath)` (or `.is(column, null)`) below is a SECOND,
  // separate race fix carried over from uploadVaultDocument() too (standing
  // review, 2026-11-09) - a storage one, not an RLS one: two near-
  // simultaneous COID uploads (the drawer's own retry-on-timeout, or two
  // tabs) both read the same `previousPath` before either writes, and
  // without this filter both updates would unconditionally succeed -
  // whichever commits last wins the row, orphaning the other request's own
  // new file forever. Scoping the update to only succeed if `column` still
  // holds the value this request read reuses the zero-rows handling right
  // below, which already cleans up this request's own new upload.
  let updateQuery = supabase.from("companies").update({ [column]: storagePath }).eq("id", verifiedCompanyId);
  updateQuery = previousPath === null ? updateQuery.is(column, null) : updateQuery.eq(column, previousPath);
  const { data: updated, error } = await updateQuery.select("id").maybeSingle();
  if (error || !updated) {
    console.error("companies update failed for vault document (coid quick fix)", error);
    await supabase.storage.from(VAULT_BUCKET).remove([storagePath]);
    return { ok: false, error: "Could not save this document - try again. If it keeps happening, let us know." };
  }
  if (previousPath) await supabase.storage.from(VAULT_BUCKET).remove([previousPath]);

  revalidatePath("/company");
  revalidatePath(`/tenders/${tenderId}`);
  return { ok: true };
}
