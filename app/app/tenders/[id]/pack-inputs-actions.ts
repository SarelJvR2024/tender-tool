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

  const { data: membership, error: membershipError } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) throw new Error("Couldn't verify your company - try again.");
  if (!membership) redirect("/onboarding");
  return { companyId: membership.company_id as string, userId: user.id };
}

/**
 * "Start a pack for this tender" - the company's tender_packs row (0001),
 * which everything else on the Tender Workspace hangs off. Idempotent: the
 * (company_id, tender_id) unique constraint means a second click is a no-op.
 *
 * UX audit 2026-10-23, item 4: this used to end with
 * `redirect(`/tenders/${tenderId}`)` on success - a redirect back to the
 * EXACT url the form was already on. Confirmed live (production DB) that
 * the upsert itself worked every time; the page just kept showing "No
 * tender pack exists yet" after the click, with no error, because Next's
 * router treats a Server Action's redirect to the current path as already
 * there and skips re-fetching it, so the stale pre-mutation render stayed
 * on screen. `revalidatePath` alone - the same "mutate, stay put" pattern
 * confirmPositionPerson below already uses - is enough: the form's own
 * submission already re-renders this page, now with fresh data.
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
  const [
    { data: current, error: currentErr },
    { data: req, error: reqErr },
    { data: tags, error: tagsErr },
    { data: ppl, error: pplErr },
  ] = await Promise.all([
    supabase.from("tender_pack_assignments").select("candidate_scores").eq("tender_pack_id", tenderPackId).eq("position_code", positionCode).maybeSingle(),
    supabase.from("tender_requirements").select("position_description").eq("tender_id", tenderId).eq("position_code", positionCode).eq("is_alternate", false).maybeSingle(),
    supabase.from("person_role_eligibility").select("person_id, role_code, notes"),
    supabase.from("people").select("id").eq("company_id", companyId),
  ]);
  // Standing review, 2026-11-06: 4th sweep blind spot - array/tuple
  // Promise.all destructures never match "const { data" either (a "["
  // sits between "const" and "{"). Only feeds `sugg` (a convenience
  // suggestion, never the confirmed write) - same self-correcting shape
  // already traced for this function's own upsert below. Logged.
  if (currentErr) console.error("tender_pack_assignments select failed for confirmPositionPerson suggestion", currentErr);
  if (reqErr) console.error("tender_requirements select failed for confirmPositionPerson suggestion", reqErr);
  if (tagsErr) console.error("person_role_eligibility select failed for confirmPositionPerson suggestion", tagsErr);
  if (pplErr) console.error("people select failed for confirmPositionPerson suggestion", pplErr);
  const candidateScores = (current?.candidate_scores as CandidateScore[] | null | undefined) ?? null;
  const sugg = suggestForPosition({
    positionCode,
    description: (req?.position_description as string | null | undefined) ?? null,
    candidateScores,
    tags: (tags ?? []) as RoleTag[],
    peopleIds: new Set((ppl ?? []).map((p) => p.id as string)),
  });
  const suggestedFields = sugg.suggestion
    ? { suggested_person_id: sugg.suggestion.id, suggested_score: sugg.suggestion.score, suggested_rationale: sugg.suggestion.why }
    : {};
  // Finding 469 (standing solution-architect review, 2026-11-12):
  // tender_pack_assignments.specialism_warning (0001) is a real scalar
  // column - read verbatim by compliance-report.tsx's own "Specialism not
  // evidenced" chip, by process_pack_jobs.py's pack_suggestions_positions()
  // (which feeds run_forms_pipeline.py's ACTIONS_TO_SIGN.md "Specialism
  // judgment call" note) and by process_cv_jobs.py (which feeds
  // generate_cv.py's own bold warning paragraph on the tender-specific CV
  // cover page that is "the one [document] that goes into the actual
  // submitted pack" per that file's own comment). This action is the ONLY
  // place in the app that writes a position's confirmed_person_id, and
  // until now it never wrote specialism_warning at all - sync_position_
  // suggestions() (process_pack_jobs.py) only ever writes candidate_scores/
  // scored_at, never this scalar column either. So every real confirmation
  // left specialism_warning at its schema default (false) forever, no
  // matter what the actually-confirmed person's own candidate_scores entry
  // said - the whole "specialism not evidenced" feature (keyword-overlap
  // scoring, matched/missing evidence, three separate downstream
  // consumers) was silently dead for every real assignment; it only ever
  // read true via two manual CLI tools (engine/seed_supabase_company.py,
  // engine/pack/bridge_selftest.py), never a live confirmation. Fixed by
  // looking the just-confirmed person up in this same candidate_scores
  // ranking and carrying their own specialism_warning across - false (the
  // column's own existing default) when the person was never scored, or
  // when the position is being cleared (personId null).
  const confirmedCandidate = personId ? candidateScores?.find((c) => c.person_id === personId) ?? null : null;

  // Logging only, no behavioral branch changed - found via the TS-sweep's
  // own grep blind spot: a bare `await supabase....upsert(...)` with no
  // destructuring at all, not even `error`, never matched the sweep's
  // "const { data" pattern (standing review, 2026-11-06). Traced the real
  // consequence rather than assuming severity from the shape: everything
  // downstream of this write - the allConfirmed/confirmed sets computed a
  // few lines below, the tender_packs.status flip that follows, AND
  // engine/pack/process_pack_jobs.py's own "unassigned" gate at pack-
  // generation time - all RE-READ tender_pack_assignments.confirmed_person_id
  // fresh from the DB rather than trusting this call succeeded, so a
  // silently-failed upsert here degrades to "the click did nothing, DB
  // state is unchanged" (self-correcting on the next genuine attempt),
  // never to a false-confirmed/false-cleared state surviving into the
  // actual pack-generation gate.
  const { error: assignError } = await supabase
    .from("tender_pack_assignments")
    .upsert(
      {
        tender_pack_id: tenderPackId,
        position_code: positionCode,
        confirmed_person_id: personId || null,
        specialism_warning: !!confirmedCandidate?.specialism_warning,
        ...suggestedFields,
      },
      { onConflict: "tender_pack_id,position_code" },
    );
  if (assignError) console.error("tender_pack_assignments upsert failed for confirmPositionPerson", assignError);

  const [{ data: reqRows, error: reqRowsErr }, { data: asgRows, error: asgRowsErr }] = await Promise.all([
    supabase.from("tender_requirements").select("position_code").eq("tender_id", tenderId).eq("is_alternate", false),
    supabase.from("tender_pack_assignments").select("position_code, confirmed_person_id").eq("tender_pack_id", tenderPackId),
  ]);
  // Same 4th blind spot, same self-correcting shape as above - only feeds
  // allConfirmed/tender_packs.status, display-only (comment below). Logged.
  if (reqRowsErr) console.error("tender_requirements select failed for confirmPositionPerson allConfirmed", reqRowsErr);
  if (asgRowsErr) console.error("tender_pack_assignments select failed for confirmPositionPerson allConfirmed", asgRowsErr);
  const required = new Set([
    ...(reqRows ?? []).map((r) => r.position_code as string),
    ...(asgRows ?? []).map((a) => a.position_code as string),
  ]);
  const confirmed = new Set((asgRows ?? []).filter((a) => a.confirmed_person_id).map((a) => a.position_code as string));
  const allConfirmed = required.size > 0 && [...required].every((c) => confirmed.has(c));

  // Logging only, no behavioral branch changed - same TS-sweep grep blind
  // spot as the upsert above. tender_packs.status is display-only in this
  // app (app/lib/dashboardStats.ts's readiness check, the page.tsx badge) -
  // the real pack-generation gate (confirm_pack.py/process_pack_jobs.py)
  // is driven entirely by tender_pack_assignments.confirmed_person_id, read
  // fresh at generation time, never by this flag - so a silently-failed
  // flip here is a stale badge, not a false-confirmed gate.
  if (allConfirmed && pack.status === "suggested") {
    const { error: confirmError } = await supabase
      .from("tender_packs")
      .update({ status: "confirmed", confirmed_by: userId, confirmed_at: new Date().toISOString() })
      .eq("id", tenderPackId);
    if (confirmError) console.error("tender_packs status->confirmed update failed", confirmError);
  } else if (!allConfirmed && pack.status !== "suggested") {
    const { error: unconfirmError } = await supabase.from("tender_packs").update({ status: "suggested", confirmed_by: null, confirmed_at: null }).eq("id", tenderPackId);
    if (unconfirmError) console.error("tender_packs status->suggested update failed", unconfirmError);
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
    // Finding 423: the file above already made it into the tender-documents
    // bucket at `storagePath` - if record_tender_document() then fails (a
    // transient error, or its own "start a pack before uploading templates"/
    // tender-not-found checks, each reachable independently of this upload
    // itself having succeeded), nothing else in this repo ever points at or
    // sweeps that object again: orphaned in storage forever. Same
    // clean-up-on-failure discipline every other upload-then-insert action in
    // this codebase already follows (e.g. people/actions.ts's uploadCv(),
    // Finding 422) - this file's own template upload never picked it up,
    // because it isn't named `actions.ts` and so sat outside that sweep's own
    // file glob.
    await supabase.storage.from(TENDER_TEMPLATE_BUCKET).remove([storagePath]);
    fail("Could not save this template - try again. If it keeps happening, let us know.");
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}?saved=template#tender-templates`);
}
