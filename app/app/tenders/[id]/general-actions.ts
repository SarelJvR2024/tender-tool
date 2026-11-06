"use server";

// Server actions for the non-SANRAL tender preparation card
// (general-workspace.tsx). Kept apart from actions.ts so this flow and the
// SANRAL pack work being built concurrently don't edit the same file.

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { safeFileName } from "@/lib/safeFileName";
import { MAX_UPLOAD_BYTES, VAULT_BUCKET } from "@/lib/vaultDocuments";
import { UPLOAD_PREFIX, type RequirementManifest } from "@/lib/generalTender";
import { advanceFoundToAssessing } from "@/lib/pipeline";
import { loadGeneralPackReviewSnapshot } from "./general-pack-review-data";
import { computeTenderReadiness } from "./tender-readiness";

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
    if (error) {
      console.error("tender_answers upsert failed", error);
      redirect(back(tenderId, `?error=${encodeURIComponent("Could not save your answers - try again. If it keeps happening, let us know.")}`));
    }
  }
  if (cleared.length > 0) {
    await supabase.from("tender_answers").delete().eq("company_id", companyId).eq("tender_id", tenderId).in("field_key", cleared).is("storage_path", null);
  }
  if (Object.keys(companyUpdate).length > 0) {
    const { error } = await supabase.from("companies").update(companyUpdate).eq("id", companyId);
    if (error) {
      console.error("companies update failed for general answers", error);
      redirect(back(tenderId, `?error=${encodeURIComponent("Answers saved, but your company details could not be updated - try again. If it keeps happening, let us know.")}`));
    }
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

  const safeName = safeFileName(file.name);
  const storagePath = `${companyId}/tenders/${tenderId}/${randomUUID()}-${safeName}`;
  const { error: upErr } = await supabase.storage.from(VAULT_BUCKET).upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (upErr) {
    console.error("tender document upload failed", file.name, upErr);
    redirect(back(tenderId, `?error=${encodeURIComponent(`Could not upload ${file.name} - try again. If it keeps happening, let us know.`)}`));
  }

  const { error } = await supabase.from("tender_answers").upsert(
    { company_id: companyId, tender_id: tenderId, field_key: fieldKey, storage_path: storagePath, original_filename: file.name, value: null, answered_by: userId },
    { onConflict: "company_id,tender_id,field_key" },
  );
  if (error) {
    console.error("tender_answers upsert failed for document", error);
    await supabase.storage.from(VAULT_BUCKET).remove([storagePath]);
    redirect(back(tenderId, `?error=${encodeURIComponent("Could not save this document - try again. If it keeps happening, let us know.")}`));
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
  const { supabase, companyId } = await requireMember();
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
    // Standing review finding, 2026-11-06: "Submit button: disabled while
    // any Fix item is open" (app/AGENTS.md, prompt 9 part 2) was only ever
    // built as general-workspace.tsx's own button `disabled` attribute -
    // never re-checked here, in the one place that actually queues the
    // job, or in request_general_job_checked() (0115), which only checks
    // billing quota. A direct POST to this Server Action (bypassing the
    // disabled button) could request a pack with a real, disqualifying Fix
    // item still open. Re-reads the exact same cached snapshot the button's
    // own disabledReason computes - fails closed (blocks) rather than open
    // when it can't be checked, same reasoning as requestSubmissionPack()'s
    // identical fix, same pass.
    const generalReviewSnapshot = await loadGeneralPackReviewSnapshot(tenderId);
    if (!generalReviewSnapshot.mapped) {
      redirect(back(tenderId, `?error=${encodeURIComponent("Couldn't check this tender's compliance readiness just now - try again.")}`));
    }
    const fixCount = computeTenderReadiness(generalReviewSnapshot.sections).fix.length;
    if (fixCount > 0) {
      redirect(back(tenderId, `?error=${encodeURIComponent(`Fix ${fixCount} item${fixCount === 1 ? "" : "s"} first - see the Pack review above.`)}`));
    }
  }
  const { data: pack } = await supabase.from("tender_packs").select("id").eq("tender_id", tenderId).maybeSingle();
  // Billing (0083/0115): company_can_request_pack()'s own quota logic
  // (generate_pack only - extract_requirements has never been quota-gated)
  // is checked and the job inserted in ONE locked transaction via
  // request_general_job_checked() - a separate check-then-insert here
  // raced two concurrent requests past the same cap, reproduced and fixed
  // 2026-11-04, same pattern as 0113/0114. Still tolerant of "one already
  // open" the same way (on conflict do nothing inside the function, not a
  // 23505 caught here) - a null return means nothing new was queued
  // because one already was, not an error.
  const { error } = await supabase.rpc("request_general_job_checked", {
    p_company_id: companyId,
    p_tender_id: tenderId,
    p_tender_pack_id: (pack?.id as string | undefined) ?? null,
    p_kind: kind,
  });
  if (error) {
    console.error("request_general_job_checked failed", error);
    redirect(back(tenderId, `?error=${encodeURIComponent(error.message || "Could not queue this job - try again. If it keeps happening, let us know.")}`));
  }
  // Pipeline board (0021): asking for a pack means we're bidding.
  if (kind === "generate_pack" && pack?.id) {
    await advanceFoundToAssessing(supabase, pack.id as string);
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
 * Inline "signatory capacity missing" fix (Sarel's own brief, 2026-10-31):
 * writes the one field (people.signatory_capacity, e.g. "Director") that
 * engine/general/fill_flat_pdf.py sources SBD 4's designation footer, SBD
 * 9's position footer and Form of Offer's capacity field from - confirmed
 * live against Clevapp's own DBSA RFP165/2026 pack, where this one empty
 * field accounted for the entire gap against Mzansi's seeded demo data.
 * Deliberately does NOT re-queue a pack_generation_jobs row itself: that
 * costs this company's monthly pack-generation allowance
 * (company_can_request_pack) and needs a fresh "I've reviewed this"
 * confirmation (requestJob's own generate_pack gate above) - an inline save
 * silently spending either would be a real, undisclosed cost, not a "quick"
 * fix. The existing "Generate a new pack" button (this same tab) is what
 * actually picks the saved value up.
 */
export async function saveSignatoryCapacity(formData: FormData) {
  const { supabase, companyId } = await requireMember();
  const tenderId = formData.get("tender_id") as string | null;
  const personId = formData.get("person_id") as string | null;
  const capacity = (formData.get("signatory_capacity") as string | null)?.trim() || null;
  if (!tenderId || !personId) redirect("/dashboard");

  const { error } = await supabase
    .from("people")
    .update({ signatory_capacity: capacity })
    .eq("id", personId)
    .eq("company_id", companyId);
  if (error) {
    console.error("people signatory_capacity update failed", error);
    redirect(back(tenderId, `?error=${encodeURIComponent("Could not save signatory capacity - try again. If it keeps happening, let us know.")}`));
  }
  revalidatePath(`/tenders/${tenderId}`);
  redirect(back(tenderId, "?saved=signatory"));
}

/**
 * Remove one of this company's private documents from a shared tender (0032):
 * the row and its file. With others left, the tender is re-read without it;
 * with none left, this company goes back to the shared reading (its private
 * copy of the requirements is cleared, since it may quote the removed file).
 */
export async function removePrivateTenderDocument(formData: FormData) {
  const { supabase, companyId } = await requireMember();
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
  if (error) {
    console.error("tender_private_documents delete failed", error);
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("Could not remove this document - try again. If it keeps happening, let us know.")}#private-documents`);
  }
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
    // 0115: same atomic checked-insert as requestJob() - extract_requirements
    // has no quota gate either way, but this keeps every real pack_generation_jobs
    // insert behind the one shared path instead of a third hand-rolled copy.
    const { error: jobErr } = await supabase.rpc("request_general_job_checked", {
      p_company_id: companyId, p_tender_id: tenderId, p_tender_pack_id: pack.id as string,
      p_kind: "extract_requirements",
    });
    if (jobErr) {
      console.error("request_general_job_checked failed after removing private document", jobErr);
      redirect(`/tenders/${tenderId}?error=${encodeURIComponent("Document removed, but the re-read could not be queued - try again. If it keeps happening, let us know.")}#private-documents`);
    }
  }
  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}#private-documents`);
}
