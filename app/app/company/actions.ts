"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { BEE_PROOF_TYPES, MAX_UPLOAD_BYTES, VAULT_BUCKET, VAULT_DOCUMENTS, isVaultDocumentKind } from "@/lib/vaultDocuments";

/**
 * Fields the edit form is allowed to write. Deliberately excludes any bank
 * account number field - this schema never stores one (see 0001's comment
 * on the companies table) and this action must not add one back in.
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
] as const;

const BEE_PROOF_VALUES = BEE_PROOF_TYPES.map((t) => t.value) as string[];

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
    update[field] = trimmed === "" ? null : Number(trimmed);
  }

  // Tri-state: "" = not stated (null), never silently "not certified".
  const iso = formData.get("iso_9001_certified");
  if (iso !== null) update.iso_9001_certified = iso === "yes" ? true : iso === "no" ? false : null;

  const proof = formData.get("bee_proof_type");
  if (proof !== null) update.bee_proof_type = BEE_PROOF_VALUES.includes(proof as string) ? (proof as string) : null;

  const { error } = await supabase.from("companies").update(update).eq("id", companyId);

  if (error) {
    redirect(`/company?error=${encodeURIComponent(error.message)}`);
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

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${companyId}/vault/${kind}/${randomUUID()}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (upErr) redirect(`/company?error=${encodeURIComponent(`Could not upload file: ${upErr.message}`)}`);

  const { error } = await supabase.from("companies").update({ [column]: storagePath }).eq("id", companyId);
  if (error) {
    await supabase.storage.from(VAULT_BUCKET).remove([storagePath]);
    redirect(`/company?error=${encodeURIComponent(error.message)}`);
  }
  if (previousPath) await supabase.storage.from(VAULT_BUCKET).remove([previousPath]);

  revalidatePath("/company");
  redirect("/company?saved=doc");
}
