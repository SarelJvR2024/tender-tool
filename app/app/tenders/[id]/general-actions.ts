"use server";

// Server actions for the non-SANRAL tender preparation card
// (general-workspace.tsx). Kept apart from actions.ts so this flow and the
// SANRAL pack work being built concurrently don't edit the same file.

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MAX_UPLOAD_BYTES, VAULT_BUCKET } from "@/lib/vaultDocuments";
import { UPLOAD_PREFIX, type RequirementManifest } from "@/lib/generalTender";

async function requireMember() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) redirect("/onboarding");
  return { supabase, userId: user.id, companyId: membership.company_id as string };
}

const back = (tenderId: string, q = "") => `/tenders/${tenderId}${q}#general-preparation`;

/**
 * Saves every answer on the "Questions only you can answer" form in one go.
 * Only keys the tender's own manifest asks for are accepted (an arbitrary
 * field_key can't be smuggled in), and company-level SBD 1 facts (telephone,
 * cellphone, e-mail, CIDB grading) are written to the company so the next
 * tender already has them.
 */
export async function saveGeneralAnswers(formData: FormData) {
  const { supabase, userId, companyId } = await requireMember();
  const tenderId = formData.get("tender_id") as string | null;
  if (!tenderId) redirect("/dashboard");

  const { data: tender } = await supabase.from("tenders").select("document_requirements").eq("id", tenderId).maybeSingle();
  const manifest = (tender?.document_requirements as RequirementManifest | null) ?? null;
  if (!manifest) redirect(back(tenderId, `?error=${encodeURIComponent("This tender's documents haven't been read yet.")}`));

  const rows: { company_id: string; tender_id: string; field_key: string; value: string; answered_by: string }[] = [];
  const cleared: string[] = [];
  for (const q of manifest.questions) {
    const raw = formData.get(`q:${q.key}`);
    if (raw === null) continue;
    const value = String(raw).trim();
    if (q.type === "yes_no" && value !== "" && value !== "yes" && value !== "no") continue;
    if (value === "") cleared.push(q.key);
    else rows.push({ company_id: companyId, tender_id: tenderId, field_key: q.key, value: value.slice(0, 2000), answered_by: userId });
  }

  const companyUpdate: Record<string, string | null> = {};
  for (const f of manifest.company_fields) {
    const raw = formData.get(`c:${f.column}`);
    if (raw === null) continue;
    companyUpdate[f.column] = String(raw).trim().slice(0, 200) || null;
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("tender_answers").upsert(rows, { onConflict: "company_id,tender_id,field_key" });
    if (error) redirect(back(tenderId, `?error=${encodeURIComponent(error.message)}`));
  }
  if (cleared.length > 0) {
    await supabase.from("tender_answers").delete().eq("company_id", companyId).eq("tender_id", tenderId).in("field_key", cleared).is("storage_path", null);
  }
  if (Object.keys(companyUpdate).length > 0) {
    const { error } = await supabase.from("companies").update(companyUpdate).eq("id", companyId);
    if (error) redirect(back(tenderId, `?error=${encodeURIComponent(error.message)}`));
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(back(tenderId, "?saved=answers"));
}

/** A supporting document the vault has no field for, uploaded for THIS tender. */
export async function uploadTenderDocument(formData: FormData) {
  const { supabase, userId, companyId } = await requireMember();
  const tenderId = formData.get("tender_id") as string | null;
  const key = formData.get("returnable_key") as string | null;
  if (!tenderId) redirect("/dashboard");
  if (!key || !/^[a-z0-9_]{2,40}$/.test(key)) redirect(back(tenderId, `?error=${encodeURIComponent("Unknown document.")}`));

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect(back(tenderId, `?error=${encodeURIComponent("Choose a file to upload.")}`));
  if (file.size > MAX_UPLOAD_BYTES) {
    redirect(back(tenderId, `?error=${encodeURIComponent("File is larger than 4.4 MB - scan it at a lower resolution or compress the PDF.")}`));
  }

  const fieldKey = UPLOAD_PREFIX + key;
  const { data: existing } = await supabase
    .from("tender_answers")
    .select("storage_path")
    .eq("company_id", companyId)
    .eq("tender_id", tenderId)
    .eq("field_key", fieldKey)
    .maybeSingle();

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${companyId}/tenders/${tenderId}/${randomUUID()}-${safeName}`;
  const { error: upErr } = await supabase.storage.from(VAULT_BUCKET).upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (upErr) redirect(back(tenderId, `?error=${encodeURIComponent(`Could not upload file: ${upErr.message}`)}`));

  const { error } = await supabase.from("tender_answers").upsert(
    { company_id: companyId, tender_id: tenderId, field_key: fieldKey, storage_path: storagePath, original_filename: file.name, value: null, answered_by: userId },
    { onConflict: "company_id,tender_id,field_key" },
  );
  if (error) {
    await supabase.storage.from(VAULT_BUCKET).remove([storagePath]);
    redirect(back(tenderId, `?error=${encodeURIComponent(error.message)}`));
  }
  const previous = (existing?.storage_path as string | null | undefined) ?? null;
  if (previous && previous !== storagePath) await supabase.storage.from(VAULT_BUCKET).remove([previous]);

  revalidatePath(`/tenders/${tenderId}`);
  redirect(back(tenderId, "?saved=doc"));
}

/** Queue a job for engine/general/process_general_jobs.py (RLS: insert only, status 'requested'). */
async function requestJob(formData: FormData, kind: "extract_requirements" | "generate_pack") {
  const { supabase, userId, companyId } = await requireMember();
  const tenderId = formData.get("tender_id") as string | null;
  if (!tenderId) redirect("/dashboard");
  const { data: pack } = await supabase.from("tender_packs").select("id").eq("tender_id", tenderId).maybeSingle();
  const { error } = await supabase.from("tender_engine_jobs").insert({
    company_id: companyId,
    tender_id: tenderId,
    tender_pack_id: (pack?.id as string | undefined) ?? null,
    kind,
    requested_by: userId,
  });
  // 23505 = one already open (unique partial index) - that's fine, it's queued.
  if (error && error.code !== "23505") redirect(back(tenderId, `?error=${encodeURIComponent(error.message)}`));
  revalidatePath(`/tenders/${tenderId}`);
  redirect(back(tenderId, kind === "generate_pack" ? "?saved=pack" : "?saved=extract"));
}

export async function requestRequirementsExtraction(formData: FormData) {
  return requestJob(formData, "extract_requirements");
}

export async function requestGeneralPack(formData: FormData) {
  return requestJob(formData, "generate_pack");
}
