"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MAX_UPLOAD_BYTES } from "@/lib/vaultDocuments";
import { TENDER_TEMPLATE_BUCKET, TENDER_TEMPLATES, isTenderTemplateType } from "@/lib/tenderTemplates";
import { suggestForPosition, type CandidateScore } from "@/lib/positionSuggestions";
import type { RoleTag } from "@/lib/tenderRoles";

/**
 * The two inputs the SANRAL submission pack needs from a person before
 * engine/pack/process_pack_jobs.py can build it: who fills each key position
 * (tender_pack_assignments.confirmed_person_id) and the tender's blank
 * templates (tender_documents, 'tender-documents' bucket). Kept out of
 * actions.ts so the two can change independently.
 */

async function requireCompanyId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) redirect("/onboarding");
  return { companyId: membership.company_id as string, userId: user.id };
}

/**
 * "Start a pack for this tender" - the company's tender_packs row (0001),
 * which everything else on the Tender Workspace hangs off. Idempotent: the
 * (company_id, tender_id) unique constraint means a second click is a no-op.
 */
export async function startTenderPack(formData: FormData) {
  const { companyId } = await requireCompanyId();
  const supabase = await createClient();
  const tenderId = formData.get("tender_id") as string | null;
  if (!tenderId) redirect("/tenders");

  const { error } = await supabase
    .from("tender_packs")
    .upsert({ company_id: companyId, tender_id: tenderId }, { onConflict: "company_id,tender_id", ignoreDuplicates: true });
  if (error) {
    console.error("tender_packs upsert failed", error);
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("Could not start this pack - try again. If it keeps happening, let us know.")}`);
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}`);
}

/**
 * Confirm (or clear, with personId null) who fills one key position on THIS
 * tender - tender_pack_assignments.confirmed_person_id, the field the pack
 * bridge feeds into confirm_pack.py's human-confirmation gate. Same inline
 * "pick it, it persists" shape as reassignTenderTask (task-assignee-select.tsx).
 *
 * Then keeps tender_packs.status honest: 'confirmed' (with who and when)
 * once every position the tender lists has a confirmed person, back to
 * 'suggested' as soon as one doesn't. A 'filled' pack stays 'filled' while
 * every position is still confirmed.
 */
export async function confirmPositionPerson(
  tenderId: string,
  tenderPackId: string,
  positionCode: string,
  personId: string | null,
) {
  const { companyId, userId } = await requireCompanyId();
  const supabase = await createClient();

  // RLS already scopes both reads to this company; checking explicitly turns
  // a stale or tampered id into a no-op instead of a confusing FK error.
  const { data: pack } = await supabase
    .from("tender_packs")
    .select("id, status")
    .eq("id", tenderPackId)
    .eq("tender_id", tenderId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!pack) return;
  if (personId) {
    const { data: person } = await supabase.from("people").select("id").eq("id", personId).eq("company_id", companyId).maybeSingle();
    if (!person) return;
  }

  // Record what the page was suggesting at this moment next to the choice,
  // so pack_selections.yaml (process_pack_jobs.py) says "suggested X,
  // confirmed Y" honestly. Recomputed here from the stored ranking - the same
  // suggestForPosition() the card uses - never taken from the browser.
  const [{ data: current }, { data: req }, { data: tags }, { data: ppl }] = await Promise.all([
    supabase.from("tender_pack_assignments").select("candidate_scores").eq("tender_pack_id", tenderPackId).eq("position_code", positionCode).maybeSingle(),
    supabase.from("tender_requirements").select("position_description").eq("tender_id", tenderId).eq("position_code", positionCode).eq("is_alternate", false).maybeSingle(),
    supabase.from("person_role_eligibility").select("person_id, role_code, notes"),
    supabase.from("people").select("id").eq("company_id", companyId),
  ]);
  const sugg = suggestForPosition({
    positionCode,
    description: (req?.position_description as string | null | undefined) ?? null,
    candidateScores: (current?.candidate_scores as CandidateScore[] | null | undefined) ?? null,
    tags: (tags ?? []) as RoleTag[],
    peopleIds: new Set((ppl ?? []).map((p) => p.id as string)),
  });
  const suggestedFields = sugg.suggestion
    ? { suggested_person_id: sugg.suggestion.id, suggested_score: sugg.suggestion.score, suggested_rationale: sugg.suggestion.why }
    : {};

  await supabase
    .from("tender_pack_assignments")
    .upsert(
      { tender_pack_id: tenderPackId, position_code: positionCode, confirmed_person_id: personId || null, ...suggestedFields },
      { onConflict: "tender_pack_id,position_code" },
    );

  const [{ data: reqRows }, { data: asgRows }] = await Promise.all([
    supabase.from("tender_requirements").select("position_code").eq("tender_id", tenderId).eq("is_alternate", false),
    supabase.from("tender_pack_assignments").select("position_code, confirmed_person_id").eq("tender_pack_id", tenderPackId),
  ]);
  const required = new Set([
    ...(reqRows ?? []).map((r) => r.position_code as string),
    ...(asgRows ?? []).map((a) => a.position_code as string),
  ]);
  const confirmed = new Set((asgRows ?? []).filter((a) => a.confirmed_person_id).map((a) => a.position_code as string));
  const allConfirmed = required.size > 0 && [...required].every((c) => confirmed.has(c));

  if (allConfirmed && pack.status === "suggested") {
    await supabase
      .from("tender_packs")
      .update({ status: "confirmed", confirmed_by: userId, confirmed_at: new Date().toISOString() })
      .eq("id", tenderPackId);
  } else if (!allConfirmed && pack.status !== "suggested") {
    await supabase.from("tender_packs").update({ status: "suggested", confirmed_by: null, confirmed_at: null }).eq("id", tenderPackId);
  }

  revalidatePath(`/tenders/${tenderId}`);
}

/**
 * Upload one of the tender's blank SANRAL templates (downloaded by hand from
 * SANRAL's reCAPTCHA-gated site) as THIS company's own copy: to the
 * 'tender-documents' bucket under private/<company>/<tender>/templates/<type>/
 * (readable only by this company's members, 0032's private scheme) and into
 * tender_documents via record_tender_document() (0025, 0045), which registers
 * or replaces only this company's copy. Since 0045 nothing a company uploads
 * is used for, or visible to, any other company: the upload could be the
 * company's own filled-in workbook (POPIA-Security-Audit.md "Shared
 * templates"). Replacing uploads a new file and repoints the row.
 */
export async function uploadTenderTemplate(formData: FormData) {
  const { companyId } = await requireCompanyId();
  const supabase = await createClient();

  const tenderId = formData.get("tender_id") as string | null;
  const docType = formData.get("doc_type") as string | null;
  if (!tenderId) redirect("/tenders");
  const fail = (msg: string) => redirect(`/tenders/${tenderId}?error=${encodeURIComponent(msg)}#tender-templates`);
  if (!isTenderTemplateType(docType)) fail("Unknown template type.");
  const template = TENDER_TEMPLATES[docType as keyof typeof TENDER_TEMPLATES];

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) fail("Choose a file to upload.");
  if (file!.size > MAX_UPLOAD_BYTES) fail("File is larger than 4.4 MB - SANRAL's own templates are about 2 MB; check this is the right file.");
  const ext = (file!.name.split(".").pop() ?? "").toLowerCase();
  // The engines open these by format: the workbooks as .xlsm (raw XML, macros
  // kept), the returnable forms as .docx (fill_docx_forms.py). A PDF or .doc
  // copy can't be filled, so it's refused here rather than failing in the pack.
  if (ext !== template.extension) fail(`${template.label} must be the .${template.extension} file SANRAL issued (got .${ext || "?"}).`);

  // The object name carries no part of the uploader's file name (0043); the
  // original name is kept on the row, shown only to this company.
  const storagePath = `private/${companyId}/${tenderId}/templates/${docType}/${randomUUID()}.${template.extension}`;
  const { error: upErr } = await supabase.storage
    .from(TENDER_TEMPLATE_BUCKET)
    .upload(storagePath, file!, { contentType: file!.type || "application/octet-stream" });
  if (upErr) {
    console.error("tender template upload failed", file!.name, upErr);
    fail(`Could not upload ${file!.name} - try again. If it keeps happening, let us know.`);
  }

  const { error } = await supabase.rpc("record_tender_document", {
    p_tender_id: tenderId,
    p_doc_type: docType,
    p_storage_path: storagePath,
    p_original_filename: file!.name,
  });
  if (error) {
    console.error("record_tender_document rpc failed", error);
    fail("Could not save this template - try again. If it keeps happening, let us know.");
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}?saved=template#tender-templates`);
}
