"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { safeFileName } from "@/lib/safeFileName";
import { queueStandardCvs } from "@/lib/standardCvQueue";

/**
 * Self-service actions for the My CV page (0065: employee role). Every
 * action here resolves the signed-in user's OWN linked person id server-side
 * (people.linked_user_id = auth.uid()) - it is never taken from a form
 * field, so nothing a client sends can point one of these writes at someone
 * else's record. RLS (0065's "employee restricted to own person" RESTRICTIVE
 * policies) enforces the same boundary underneath this for any role, so this
 * is belt-and-suspenders, not the only check - but it's also what lets a
 * 'member'/'owner'/'admin' who happens to be linked to a person use this
 * same simple page for their own CV without the restriction applying to
 * them at all (they're not 'employee', so the RLS check is a no-op; this
 * function still only ever touches their own linked row).
 */
const BACK = "/my-cv";

function fail(message: string): never {
  redirect(`${BACK}?error=${encodeURIComponent(message)}`);
}

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

async function requireOwnPerson() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/my-cv");

  const { data: membership, error: membershipError } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (membershipError) throw new Error("Couldn't verify your company - try again.");
  if (!membership) redirect("/onboarding");

  const { data: person } = await supabase
    .from("people")
    .select("id")
    .eq("company_id", membership.company_id)
    .eq("linked_user_id", user.id)
    .maybeSingle();
  if (!person) fail("No roster record is linked to your account yet - ask an owner or admin to link one.");

  return { supabase, userId: user.id, companyId: membership.company_id as string, personId: person.id as string };
}

/** A deliberately small set of self-editable identity/qualification fields. */
export async function saveMyDetails(formData: FormData) {
  const { supabase, personId } = await requireOwnPerson();

  const row = {
    phone: str(formData, "phone"),
    email: str(formData, "email"),
    ecsa_level: str(formData, "ecsa_level"),
    ecsa_number: str(formData, "ecsa_number"),
    ecsa_expiry: str(formData, "ecsa_expiry"),
    sacpcmp_number: str(formData, "sacpcmp_number"),
    sacpcmp_expiry: str(formData, "sacpcmp_expiry"),
    highest_level: str(formData, "highest_level"),
    highest_description: str(formData, "highest_description"),
    highest_institution: str(formData, "highest_institution"),
    highest_graduated: str(formData, "highest_graduated"),
  };

  // .select("id").maybeSingle() here matters: PostgREST returns a 2xx with
  // `error: null` and zero rows affected when RLS's own "people: employee
  // restricted to own record" RESTRICTIVE policy (0077, using (... or id =
  // own_linked_person_id(company_id)), re-evaluated against the OLD row) no
  // longer matches - e.g. an owner/admin unlinking this person
  // (people.linked_user_id) or removing this user's own company_members row
  // between the My CV page loading and this submit. No destructive
  // consequence here (no file precedes this write), but still a real
  // silent-false-success ("saved" shown when nothing was written) - the same
  // "plain update twin" shape already fixed in company/actions.ts
  // updateCompanyProfile() and people/actions.ts savePerson(), never swept
  // into this self-service file until now (standing review, 2026-11-06).
  const { data: updated, error } = await supabase.from("people").update(row).eq("id", personId).select("id").maybeSingle();
  if (error || !updated) {
    console.error("people update failed (my-cv saveMyDetails)", error);
    fail("Your roster record is no longer linked to your account - refresh and try again.");
  }
  redirect(`${BACK}?saved=details`);
}

/** Same upload flow as app/app/people/actions.ts uploadCv - scoped to self. */
export async function uploadMyCv(formData: FormData) {
  const { supabase, userId, companyId, personId } = await requireOwnPerson();

  const mode = str(formData, "mode");
  const file = formData.get("file") as File | null;
  if (mode !== "as_is" && mode !== "ai_extract") fail("Choose how this CV should be used: as-is or AI-extract.");
  if (!file || file.size === 0) fail("Choose a CV file to upload.");

  const safeName = safeFileName(file.name);
  const storagePath = `${companyId}/people/${personId}/uploads/${randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("cv-documents")
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (uploadError) fail(`Could not upload file: ${uploadError.message}`);

  const { error: insertError } = await supabase.from("cv_uploads").insert({
    company_id: companyId,
    person_id: personId,
    storage_path: storagePath,
    original_filename: file.name,
    mode,
    status: mode === "as_is" ? "uploaded" : "extraction_requested",
    uploaded_by: userId,
  });
  if (insertError) fail(insertError.message);
  redirect(`${BACK}?saved=cv`);
}

/**
 * Confirm or correct an AI-extracted CV, same shape as
 * app/app/people/actions.ts applyCvExtraction but scoped to self and with
 * no project-adding step (kept deliberately small for this page - projects
 * stay something an owner/admin/member adds on the full People page).
 *
 * Also queues the same four standard (non-tender-specific) CV formats
 * applyCvExtraction() does, via the now-shared queueStandardCvs()
 * (app/lib/standardCvQueue.ts) - found missing here entirely (standing
 * solution-architect review, 2026-11-07): this function is the ONLY way an
 * employee using My CV self-service ever confirms their own extracted
 * fields, and apply_my_cv_extraction_checked()/apply_cv_extraction_checked()
 * both require review_status to still be 'pending_review', so once this
 * ran without queuing anything, nobody - not even an owner on the full
 * People page - could ever trigger it for that extraction again.
 */
export async function applyMyCvExtraction(formData: FormData) {
  const { supabase, userId, companyId, personId } = await requireOwnPerson();
  const extractionId = str(formData, "extraction_id");
  if (!extractionId) redirect(BACK);

  const { data: row, error: readError } = await supabase
    .from("cv_extraction_results")
    .select("id, person_id, review_status, proposed")
    .eq("id", extractionId)
    .maybeSingle();
  if (readError) fail(readError.message);
  if (!row || row.person_id !== personId) fail("That extraction result wasn't found for you.");
  if (row.review_status !== "pending_review") fail("These extracted fields were already saved or discarded.");

  const fields = ["name", "ecsa_level", "ecsa_number", "ecsa_date", "sacpcmp_number", "sacpcmp_date", "highest_level", "highest_description", "highest_institution", "highest_graduated"];
  const personUpdate: Record<string, string | null> = {};
  for (const key of fields) {
    if (formData.get(`use_${key}`) !== "on") continue;
    personUpdate[key] = str(formData, `f_${key}`);
  }
  if (Object.keys(personUpdate).length === 0) fail("Nothing was ticked. Tick the fields to save, or discard the extraction.");

  // Was two separate, unlocked writes here (people update, then marking the
  // extraction applied) with the SECOND one never re-checking review_status
  // in its own .eq() chain - a genuine two-concurrent-invocations race
  // (double-click, two tabs on the same pending review card), same shape as
  // app/app/people/actions.ts applyCvExtraction() (0123) and the exact thing
  // this file's own discardMyCvExtraction() already guards against below
  // (standing review, 2026-11-06) - the "apply" twin never got that same
  // guard until now. Moved into one locked SQL transaction
  // (apply_my_cv_extraction_checked, 0123): a second concurrent call for the
  // SAME extraction blocks on the row's own `for update` lock until the
  // first commits, then raises instead of silently re-applying. The zero-
  // rows-matched RLS-revocation race this replaced is still covered - the
  // RPC's own is_company_member() check inside the same lock catches it, as
  // a thrown error instead of a silent zero-row match.
  const { error } = await supabase.rpc("apply_my_cv_extraction_checked", {
    p_extraction_id: extractionId,
    p_person_id: personId,
    p_person_fields: personUpdate,
    p_applied_meta: { person_fields: Object.keys(personUpdate) },
  });
  if (error) {
    console.error("apply_my_cv_extraction_checked rpc failed", error);
    fail(error.message);
  }

  const queueError = await queueStandardCvs(supabase, companyId, personId, userId);
  if (queueError) fail("Fields saved, but your standard CVs could not be queued - try again. If it keeps happening, let us know.");
  redirect(`${BACK}?saved=extracted`);
}

export async function discardMyCvExtraction(formData: FormData) {
  const { supabase, userId, personId } = await requireOwnPerson();
  const extractionId = str(formData, "extraction_id");
  if (!extractionId) redirect(BACK);

  // Same shape as applyMyCvExtraction()'s mark-applied write above - checked
  // only `error` before, so a membership/link revocation mid-request (or
  // the row having moved on from 'pending_review' already) would silently
  // match zero rows while still redirecting as if the discard happened.
  const { data: discarded, error } = await supabase
    .from("cv_extraction_results")
    .update({ review_status: "discarded", reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq("id", extractionId)
    .eq("person_id", personId)
    .eq("review_status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error || !discarded) {
    console.error("cv_extraction_results discard failed (my-cv discardMyCvExtraction)", error);
    fail(error ? error.message : "That extraction result is no longer there to discard - refresh and try again.");
  }
  redirect(BACK);
}
