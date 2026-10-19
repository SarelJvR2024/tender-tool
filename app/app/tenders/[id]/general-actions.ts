"use server";

// Server actions for the non-SANRAL tender preparation card
// (general-workspace.tsx). Kept apart from actions.ts so this flow and the
// SANRAL pack work being built concurrently don't edit the same file.

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MAX_UPLOAD_BYTES, VAULT_BUCKET } from "@/lib/vaultDocuments";
import { GENERAL_ENGINE, JOBS_TABLE, UPLOAD_PREFIX, type RequirementManifest } from "@/lib/generalTender";
import { advanceFoundToBidding } from "@/lib/pipeline";

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

  // This company's own reading (0032: private documents on a shared tender) wins over the shared one.
  const [{ data: tender }, { data: ownPack }] = await Promise.all([
    supabase.from("tenders").select("document_requirements").eq("id", tenderId).maybeSingle(),
    supabase.from("tender_packs").select("document_requirements").eq("tender_id", tenderId).eq("company_id", companyId).maybeSingle(),
  ]);
  const manifest = ((ownPack?.document_requirements ?? tender?.document_requirements) as RequirementManifest | null) ?? null;
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

/** Queue a job for engine/general/process_general_jobs.py: a pack_generation_jobs
 * row with engine 'general' - the one queue every engine shares (0026). RLS:
 * insert only, status 'requested'.
 *
 * generate_pack additionally requires a pack_review_confirmations row
 * (migration 0059, reused as-is - general-pack-review.tsx / -actions.ts) -
 * the same confirm-before-compile gate requestSubmissionPack() (actions.ts)
 * already applies to SANRAL packs, extended here per the standing QA
 * finding that general tenders had no equivalent review step. Additive to
 * every existing check above (missing documents/answers still just produce
 * a draft with blanks, by design) - this only blocks an UNREVIEWED compile.
 */
async function requestJob(formData: FormData, kind: "extract_requirements" | "generate_pack") {
  const { supabase, userId, companyId } = await requireMember();
  const tenderId = formData.get("tender_id") as string | null;
  if (!tenderId) redirect("/dashboard");
  if (kind === "generate_pack") {
    const { data: reviewRow } = await supabase
      .from("pack_review_confirmations")
      .select("reviewed_at")
      .eq("tender_id", tenderId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!reviewRow?.reviewed_at) {
      redirect(back(tenderId, `?error=${encodeURIComponent("Review the full Pack Review list above and click \"I've reviewed this\" before generating a pack.")}`));
    }
  }
  const { data: pack } = await supabase.from("tender_packs").select("id").eq("tender_id", tenderId).maybeSingle();
  const { error } = await supabase.from(JOBS_TABLE).insert({
    engine: GENERAL_ENGINE,
    company_id: companyId,
    tender_id: tenderId,
    tender_pack_id: (pack?.id as string | undefined) ?? null,
    kind,
    requested_by: userId,
  });
  // 23505 = one already open (unique partial index) - that's fine, it's queued.
  if (error && error.code !== "23505") redirect(back(tenderId, `?error=${encodeURIComponent(error.message)}`));
  // Pipeline board (0021): asking for a pack means we're bidding.
  if (kind === "generate_pack" && pack?.id) {
    await advanceFoundToBidding(supabase, pack.id as string);
    revalidatePath("/pipeline");
  }
  revalidatePath(`/tenders/${tenderId}`);
  redirect(back(tenderId, kind === "generate_pack" ? "?saved=pack" : "?saved=extract"));
}

export async function requestRequirementsExtraction(formData: FormData) {
  return requestJob(formData, "extract_requirements");
}

export async function requestGeneralPack(formData: FormData) {
  return requestJob(formData, "generate_pack");
}

/**
 * Remove one of this company's private documents from a shared tender (0032):
 * the row and its file. With others left, the tender is re-read without it;
 * with none left, this company goes back to the shared reading (its private
 * copy of the requirements is cleared, since it may quote the removed file).
 */
export async function removePrivateTenderDocument(formData: FormData) {
  const { supabase, userId, companyId } = await requireMember();
  const tenderId = formData.get("tender_id") as string | null;
  const docId = formData.get("document_id") as string | null;
  if (!tenderId || !docId) redirect("/dashboard");
  const { data: doc } = await supabase
    .from("tender_private_documents")
    .select("id, storage_path")
    .eq("id", docId)
    .eq("company_id", companyId)
    .eq("tender_id", tenderId)
    .maybeSingle();
  if (!doc) redirect(`/tenders/${tenderId}#private-documents`);
  const { error } = await supabase.from("tender_private_documents").delete().eq("id", doc.id as string);
  if (error) redirect(`/tenders/${tenderId}?error=${encodeURIComponent(error.message)}#private-documents`);
  await supabase.storage.from("tender-documents").remove([doc.storage_path as string]);

  const { count } = await supabase
    .from("tender_private_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("tender_id", tenderId);
  const { data: pack } = await supabase.from("tender_packs").select("id").eq("tender_id", tenderId).eq("company_id", companyId).maybeSingle();
  if (pack && (count ?? 0) === 0) {
    await supabase.from("tender_packs").update({ document_requirements: null, intake: null }).eq("id", pack.id as string);
  } else if (pack) {
    const { error: jobErr } = await supabase.from(JOBS_TABLE).insert({
      engine: GENERAL_ENGINE, company_id: companyId, tender_id: tenderId, tender_pack_id: pack.id as string,
      kind: "extract_requirements", requested_by: userId,
    });
    if (jobErr && jobErr.code !== "23505") redirect(`/tenders/${tenderId}?error=${encodeURIComponent(jobErr.message)}#private-documents`);
  }
  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}#private-documents`);
}
