"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

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

  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
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

  const { error } = await supabase.from("people").update(row).eq("id", personId);
  if (error) fail(error.message);
  redirect(`${BACK}?saved=details`);
}

/** Same upload flow as app/app/people/actions.ts uploadCv - scoped to self. */
export async function uploadMyCv(formData: FormData) {
  const { supabase, userId, companyId, personId } = await requireOwnPerson();

  const mode = str(formData, "mode");
  const file = formData.get("file") as File | null;
  if (mode !== "as_is" && mode !== "ai_extract") fail("Choose how this CV should be used: as-is or AI-extract.");
  if (!file || file.size === 0) fail("Choose a CV file to upload.");

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
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
 */
export async function applyMyCvExtraction(formData: FormData) {
  const { supabase, userId, personId } = await requireOwnPerson();
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

  const { error } = await supabase.from("people").update({ ...personUpdate, updated_at: new Date().toISOString() }).eq("id", personId);
  if (error) fail(`Could not save: ${error.message}`);

  const { error: markError } = await supabase
    .from("cv_extraction_results")
    .update({ review_status: "applied", reviewed_by: userId, reviewed_at: new Date().toISOString(), applied: { person_fields: Object.keys(personUpdate) } })
    .eq("id", extractionId);
  if (markError) fail(`Saved, but couldn't mark the extraction reviewed: ${markError.message}`);

  redirect(`${BACK}?saved=extracted`);
}

export async function discardMyCvExtraction(formData: FormData) {
  const { supabase, userId, personId } = await requireOwnPerson();
  const extractionId = str(formData, "extraction_id");
  if (!extractionId) redirect(BACK);

  const { error } = await supabase
    .from("cv_extraction_results")
    .update({ review_status: "discarded", reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq("id", extractionId)
    .eq("person_id", personId)
    .eq("review_status", "pending_review");
  if (error) fail(error.message);
  redirect(BACK);
}
