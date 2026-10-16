"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

/**
 * Every write here goes through the signed-in user's own Supabase client, so
 * RLS (people/projects: tenant isolation, see supabase/migrations/0001_init_schema.sql)
 * is what actually enforces that a person can only be read or written by someone
 * who is a member of that person's company - this file does not re-implement that
 * check, it just needs company_id to satisfy the "with check" clause on insert.
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
  return membership.company_id as string;
}

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

/**
 * Insert or update one person. id="new" (or empty) creates a new row.
 * Only the real columns on `people` (supabase/migrations/0001_init_schema.sql) are
 * written - no invented fields. years_experience is deliberately NOT accepted here:
 * it's computed from qualifications.initial_graduated at the point it's needed
 * (see engine/pack_generator/suggest_pack.py years_experience_at), never stored.
 */
export async function savePerson(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!name) {
    redirect(`/people/${id ?? "new"}?error=name_required`);
  }

  const row = {
    company_id: companyId,
    name,
    id_number: str(formData, "id_number"),
    description: str(formData, "description"),
    role: str(formData, "role"),
    signatory_capacity: str(formData, "signatory_capacity"),
    phone: str(formData, "phone"),
    email: str(formData, "email"),
    ecsa_level: str(formData, "ecsa_level"),
    ecsa_number: str(formData, "ecsa_number"),
    ecsa_date: str(formData, "ecsa_date"),
    sacpcmp_number: str(formData, "sacpcmp_number"),
    sacpcmp_date: str(formData, "sacpcmp_date"),
    highest_level: str(formData, "highest_level"),
    highest_description: str(formData, "highest_description"),
    highest_institution: str(formData, "highest_institution"),
    highest_graduated: str(formData, "highest_graduated"),
    initial_description: str(formData, "initial_description"),
    initial_institution: str(formData, "initial_institution"),
    initial_graduated: str(formData, "initial_graduated"),
  };

  let personId = id;
  if (!id || id === "new") {
    const { data, error } = await supabase.from("people").insert(row).select("id").single();
    if (error) redirect(`/people/new?error=${encodeURIComponent(error.message)}`);
    personId = data!.id;
  } else {
    const { error } = await supabase.from("people").update(row).eq("id", id);
    if (error) redirect(`/people/${id}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/people");
  redirect(`/people/${personId}`);
}

export async function deletePerson(formData: FormData) {
  await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "id");
  if (!id) redirect("/people");

  await supabase.from("people").delete().eq("id", id);
  revalidatePath("/people");
  redirect("/people");
}

/**
 * Reference/project history for one person - the live equivalent of
 * key_people[].projects in config/klipcorp_profile.json. The `projects` table
 * already models this (0001_init_schema.sql), so this is additive, not a new
 * data model.
 */
export async function saveProject(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  const personId = str(formData, "person_id");
  const clientAndNumber = str(formData, "client_and_number");
  if (!personId) redirect("/people");
  if (!clientAndNumber) redirect(`/people/${personId}?error=project_client_required`);

  const valueRaw = str(formData, "value_rm");
  const row = {
    company_id: companyId,
    person_id: personId,
    client_and_number: clientAndNumber,
    client_type: str(formData, "client_type"),
    project_type: str(formData, "project_type"),
    position_code: str(formData, "position_code"),
    position_held: str(formData, "position_held"),
    value_rm: valueRaw ? Number(valueRaw) : null,
    contact_name: str(formData, "contact_name"),
    contact_phone: str(formData, "contact_phone"),
    contact_email: str(formData, "contact_email"),
    start_date: str(formData, "start_date"),
    end_date: str(formData, "end_date"),
    contact_match_confidence: str(formData, "contact_match_confidence"),
    source_note: str(formData, "source_note"),
  };

  const { error } = await supabase.from("projects").insert(row);
  if (error) redirect(`/people/${personId}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}`);
}

export async function deleteProject(formData: FormData) {
  await requireCompanyId();
  const supabase = await createClient();
  const projectId = str(formData, "project_id");
  const personId = str(formData, "person_id");
  if (!projectId || !personId) redirect("/people");

  await supabase.from("projects").delete().eq("id", projectId);
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}`);
}

/**
 * CV upload - the "upload once, never recapture" flow (docs/specs/Tender-Tool-
 * Competitor-Feature-Deep-Dive.md). Two modes, per Sarel's own direction
 * (2026-10-16):
 *
 *   as_is       - the uploaded file IS the submission attachment. No AI
 *                 involvement at all - recorded in cv_uploads and nothing else
 *                 happens. (See the spec's "Use as-is option" paragraph.)
 *   ai_extract  - queues field extraction (cv_uploads.status =
 *                 'extraction_requested' - the actual extraction step is not
 *                 built yet, see engine/cv/README.md "What's genuinely not done
 *                 yet") AND immediately queues the standard (non-tender-
 *                 specific) CV formats for pre-generation (generated_cvs rows,
 *                 status 'requested'), so they're sitting there ready to view
 *                 any time someone looks at this person, not generated lazily
 *                 on first view. Actual generation happens out-of-band - see
 *                 engine/cv/process_cv_jobs.py and its README section on why
 *                 (Vercel can't run Python/LibreOffice) - this action only
 *                 ever records the request, never blocks on a result.
 *
 * Storage path convention: "<company_id>/people/<person_id>/uploads/<uuid>-
 * <filename>" under the private 'cv-documents' bucket (0008_cv_uploads.sql),
 * same "path in storage, not the file itself" pattern as
 * companies.logo_storage_path.
 */
const STANDARD_CV_FORMATS = ["sanral_keyperson", "world_bank"] as const;
const STANDARD_CV_DETAILS = ["summary", "detailed"] as const;

export async function uploadCv(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const personId = str(formData, "person_id");
  const mode = str(formData, "mode");
  const file = formData.get("file") as File | null;

  if (!personId) redirect("/people");
  if (mode !== "as_is" && mode !== "ai_extract") {
    redirect(`/people/${personId}?error=${encodeURIComponent("Choose how this CV should be used: as-is or AI-extract.")}`);
  }
  if (!file || file.size === 0) {
    redirect(`/people/${personId}?error=${encodeURIComponent("Choose a CV file to upload.")}`);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${companyId}/people/${personId}/uploads/${randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("cv-documents")
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (uploadError) {
    redirect(`/people/${personId}?error=${encodeURIComponent(`Could not upload file: ${uploadError.message}`)}`);
  }

  const { error: insertError } = await supabase.from("cv_uploads").insert({
    company_id: companyId,
    person_id: personId,
    storage_path: storagePath,
    original_filename: file.name,
    mode,
    status: mode === "as_is" ? "uploaded" : "extraction_requested",
    uploaded_by: user?.id ?? null,
  });
  if (insertError) {
    redirect(`/people/${personId}?error=${encodeURIComponent(insertError.message)}`);
  }

  if (mode === "ai_extract") {
    const standardJobs = STANDARD_CV_FORMATS.flatMap((format) =>
      STANDARD_CV_DETAILS.map((detail) => ({
        company_id: companyId,
        person_id: personId,
        format,
        detail,
        status: "requested" as const,
        requested_by: user?.id ?? null,
      }))
    );
    const { error: jobsError } = await supabase.from("generated_cvs").insert(standardJobs);
    if (jobsError) {
      redirect(`/people/${personId}?error=${encodeURIComponent(`CV uploaded, but could not queue standard formats: ${jobsError.message}`)}`);
    }
  }

  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}`);
}

/**
 * Which tender roles this person's CV qualifies them for - set by the
 * company, by hand (Sarel, 2026-10-16: "companies need to specify which
 * sanral roles a persons cv fits"). Writes person_role_eligibility (0016):
 * the submitted checkbox set replaces the person's current tags. RLS checks
 * the person belongs to the caller's company.
 */
export async function saveRoleEligibility(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const personId = str(formData, "person_id");
  if (!personId) redirect("/people");
  const wanted = new Set(formData.getAll("role_code").map((v) => String(v)).filter(Boolean));

  const { data: current, error: readError } = await supabase
    .from("person_role_eligibility")
    .select("role_code")
    .eq("person_id", personId);
  if (readError) redirect(`/people/${personId}?error=${encodeURIComponent(readError.message)}`);
  const have = new Set((current ?? []).map((r) => r.role_code as string));

  const toRemove = [...have].filter((c) => !wanted.has(c));
  const toAdd = [...wanted].filter((c) => !have.has(c));

  if (toRemove.length > 0) {
    const { error } = await supabase.from("person_role_eligibility").delete().eq("person_id", personId).in("role_code", toRemove);
    if (error) redirect(`/people/${personId}?error=${encodeURIComponent(error.message)}`);
  }
  if (toAdd.length > 0) {
    const { error } = await supabase.from("person_role_eligibility").insert(
      toAdd.map((role_code) => ({ company_id: companyId, person_id: personId, role_code, tagged_by: user?.id ?? null }))
    );
    if (error) redirect(`/people/${personId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}?roles_saved=1`);
}
