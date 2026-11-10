"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { safeFileName } from "@/lib/safeFileName";

/**
 * Cover letter / methodology statement generator (migration 0087). Same
 * request/fulfil shape as requestTenderCv/requestSubmissionPack in
 * ./actions.ts: the web app cannot run the real generation step (an LLM call
 * plus python-docx), so this only ever records a 'requested' row.
 * engine/narrative/process_narrative_jobs.py claims and fulfils it
 * out-of-band, including the mechanical anti-collusion uniqueness check
 * against every other company's draft for the same tender.
 */

const NARRATIVE_BUCKET = "narrative-documents";
// Same reasoning as app/lib/vaultDocuments.ts's own MAX_UPLOAD_BYTES - Server
// Actions run as a Vercel Function, body hard-capped at 4.5MB (next.config.ts).
const MAX_FINAL_UPLOAD_BYTES = 4.4 * 1024 * 1024;

const VALID_KINDS = new Set(["cover_letter", "methodology"]);
const VALID_LENGTHS = new Set(["concise", "standard", "thorough"]);
const VALID_DETAILS = new Set(["high_level", "detailed", "highly_technical"]);
const VALID_VISUALS = new Set(["plain", "structured", "visual_rich"]);
const VALID_COLORS = new Set(["navy", "charcoal", "forest", "burgundy", "slate"]);

/**
 * Tenant check, same pattern as app/app/tenders/[id]/actions.ts's own
 * requireCompanyId - each actions.ts file keeps its own copy rather than a
 * shared lib, matching the rest of this codebase's convention.
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
  return membership.company_id as string;
}

export async function requestNarrativeDocument(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const tenderId = formData.get("tender_id") as string | null;
  if (!tenderId) redirect("/tenders");
  function fail(msg: string): never {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent(msg)}#narrative-documents`);
  }

  const kind = formData.get("kind") as string | null;
  if (!kind || !VALID_KINDS.has(kind)) fail("Choose cover letter or methodology statement.");

  const styleLength = (formData.get("style_length") as string | null) ?? "standard";
  const styleDetail = (formData.get("style_detail") as string | null) ?? "detailed";
  const styleVisual = (formData.get("style_visual") as string | null) ?? "structured";
  const styleColor = (formData.get("style_color") as string | null) ?? "navy";
  if (
    !VALID_LENGTHS.has(styleLength) ||
    !VALID_DETAILS.has(styleDetail) ||
    !VALID_VISUALS.has(styleVisual) ||
    !VALID_COLORS.has(styleColor)
  ) {
    fail("Something went wrong with the style options - try again.");
  }
  const userGuidance = ((formData.get("user_guidance") as string | null) ?? "").trim() || null;

  // Duplicate-request guard, same reasoning as requestTenderCv/
  // requestSubmissionPack in ./actions.ts - nothing else stops a user (or a
  // double click) queueing the same document twice.
  const { data: pending } = await supabase
    .from("narrative_documents")
    .select("id")
    .eq("company_id", companyId)
    .eq("tender_id", tenderId)
    .eq("kind", kind)
    .in("status", ["requested", "generating"])
    .limit(1)
    .maybeSingle();
  if (pending) {
    fail("A document of this kind is already being generated for this tender - check back shortly.");
  }

  const { error } = await supabase.from("narrative_documents").insert({
    company_id: companyId,
    tender_id: tenderId,
    kind,
    user_guidance: userGuidance,
    style_length: styleLength,
    style_detail: styleDetail,
    style_visual: styleVisual,
    style_color: styleColor,
    status: "requested",
    requested_by: user?.id ?? null,
  });
  if (error) {
    console.error("narrative_documents insert failed", error);
    fail("Could not request this document - try again. If it keeps happening, let us know.");
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}#narrative-documents`);
}

/**
 * The human-finishing step this whole feature exists for (Sarel, 2026-10-22,
 * and migration 0087's own header comment): the AI draft is a starting
 * point, never the final word - export to Word, edit it as the company's
 * own, upload the real final version back. Once set, final_storage_path -
 * not generated_storage_path - is what anything downstream should use.
 */
export async function uploadNarrativeFinal(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const docId = formData.get("narrative_document_id") as string | null;
  const tenderId = formData.get("tender_id") as string | null;
  if (!docId || !tenderId) redirect("/tenders");
  function fail(msg: string): never {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent(msg)}#narrative-documents`);
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) fail("Choose the edited Word document to upload.");
  if (!/\.docx?$/i.test(file.name)) fail("Upload a Word document (.doc or .docx).");
  if (file.size > MAX_FINAL_UPLOAD_BYTES) {
    fail("That file is too large - this usually means embedded images; try saving a smaller copy.");
  }

  // The row must be this company's own, same belt-and-suspenders check as
  // every other per-row action in this directory (RLS backs this up too,
  // but a clear message here is friendlier than a generic failure).
  const { data: row } = await supabase
    .from("narrative_documents")
    .select("id, final_storage_path")
    .eq("id", docId)
    .eq("company_id", companyId)
    .eq("tender_id", tenderId)
    .maybeSingle();
  if (!row) fail("That document wasn't found.");
  const previousFinalPath = (row.final_storage_path as string | null | undefined) ?? null;

  const safeName = safeFileName(file.name);
  // Fixed, deterministic path (no random suffix) so re-uploading a
  // correction replaces the same object rather than accumulating copies.
  const storagePath = `${companyId}/tenders/${tenderId}/${docId}/final-${safeName}`;

  const { error: uploadError } = await supabase.storage.from(NARRATIVE_BUCKET).upload(storagePath, file, {
    contentType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (uploadError) fail(`Could not upload file: ${uploadError.message}`);

  // .select("id").maybeSingle() matters here exactly as it does on every
  // sibling plain `narrative_documents`/company-scoped update elsewhere in
  // this codebase: PostgREST returns a 2xx with `error: null` and zero rows
  // affected when RLS's own `using (is_company_member(company_id))` (0087,
  // re-evaluated against the OLD row) no longer matches - e.g. a membership
  // revoked between the `row` check above and this write - indistinguishable
  // from a real update by `error` alone. Without this check the file above
  // is uploaded to storage (overwriting the fixed, deterministic path) but
  // the row's own final_* columns never actually change to match - a silent
  // mismatch, not just a silent no-op (standing review, 2026-11-07).
  const { data: updated, error: updateError } = await supabase
    .from("narrative_documents")
    .update({
      final_storage_path: storagePath,
      final_original_filename: file.name,
      final_uploaded_at: new Date().toISOString(),
      final_uploaded_by: user?.id ?? null,
    })
    .eq("id", docId)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    fail(updateError
      ? `Uploaded, but couldn't save it against the document: ${updateError.message}`
      : "That document is no longer there - it may have been removed. Refresh and try again.");
  }

  // Clean up the PREVIOUS final upload once the row genuinely points at the
  // new one - same "fetch old path before, upload new, delete old only
  // after the DB write that points at the new one succeeds" discipline
  // every other file-replace action in this codebase follows (e.g.
  // general-actions.ts's uploadTenderDocument, company/actions.ts's vault
  // upload). storagePath is deterministic (filename-based, not a random
  // suffix) specifically so a re-upload under the SAME filename overwrites
  // the same object via `upsert: true` above - but a re-upload under a
  // DIFFERENT filename (the normal case: the company downloads the draft,
  // edits it in Word, and saves/re-uploads it under its own new name) built
  // a genuinely different storagePath and, before this fix, never removed
  // the old one - an orphaned final document silently left in the
  // `narrative-documents` bucket forever, every single time someone
  // corrected a final upload under a new filename, with nothing upstream
  // ever referencing or cleaning it up again. Found in a standing review
  // pass, 2026-11-10.
  if (previousFinalPath && previousFinalPath !== storagePath) {
    await supabase.storage.from(NARRATIVE_BUCKET).remove([previousFinalPath]);
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}#narrative-documents`);
}
