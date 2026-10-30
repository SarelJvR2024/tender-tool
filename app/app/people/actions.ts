"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { EXTRACTED_PERSON_FIELDS, ISO_DATE, type Proposal } from "@/lib/cvExtraction";
import { safeFileName } from "@/lib/safeFileName";

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
    // SANRAL Form B1 "employment" (0036). Only the form's own two answers are
    // stored; anything else is "not recorded".
    employment_status: ((v) => (v === "full_time_employee" || v === "not_full_time_employee" ? v : null))(
      str(formData, "employment_status"),
    ),
    phone: str(formData, "phone"),
    email: str(formData, "email"),
    ecsa_level: str(formData, "ecsa_level"),
    ecsa_number: str(formData, "ecsa_number"),
    ecsa_date: str(formData, "ecsa_date"),
    sacpcmp_number: str(formData, "sacpcmp_number"),
    sacpcmp_date: str(formData, "sacpcmp_date"),
    ecsa_expiry: str(formData, "ecsa_expiry"), // 0035
    sacpcmp_expiry: str(formData, "sacpcmp_expiry"), // 0035
    // 0040 - SACNASP / SAGC. The page always submits these inputs (visible
    // when held or asked for by a tender, else inside the closed "add another
    // registration" disclosure), so an empty value really is "not recorded".
    sacnasp_category: str(formData, "sacnasp_category"),
    sacnasp_number: str(formData, "sacnasp_number"),
    sacnasp_expiry: str(formData, "sacnasp_expiry"),
    sagc_category: str(formData, "sagc_category"),
    sagc_number: str(formData, "sagc_number"),
    sagc_expiry: str(formData, "sagc_expiry"),
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
    if (error) {
      console.error("people insert failed", error);
      redirect(`/people/new?error=${encodeURIComponent("Could not save this person - try again. If it keeps happening, let us know.")}`);
    }
    personId = data!.id;
  } else {
    const { error } = await supabase.from("people").update(row).eq("id", id);
    if (error) {
      console.error("people update failed", error);
      redirect(`/people/${id}?error=${encodeURIComponent("Could not save this person - try again. If it keeps happening, let us know.")}`);
    }
  }

  revalidatePath("/people");
  redirect(`/people/${personId}`);
}

/**
 * Deletes a person and everything held about them (POPIA s 14 / s 24 -
 * docs/specs/POPIA-Security-Audit.md). The rows go by cascade (projects, CV
 * uploads, generated CVs, extraction results, role tags; migration 0044 also
 * strips them from key-position rankings and signatory answers). Their CV
 * FILES are not rows - Storage only deletes a file through the Storage API -
 * so the uploaded and generated CVs are removed here first, from the paths
 * the rows record plus anything left in the person's own folder. Their
 * signatory_scopes (0061) go by the same person_id cascade.
 */
export async function deletePerson(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "id");
  if (!id) redirect("/people");

  const { data: person } = await supabase.from("people").select("id").eq("id", id).eq("company_id", companyId).maybeSingle();
  if (!person) redirect("/people");

  const [{ data: uploads }, { data: generated }] = await Promise.all([
    supabase.from("cv_uploads").select("storage_path").eq("person_id", id).eq("company_id", companyId),
    supabase.from("generated_cvs").select("storage_path_docx, storage_path_pdf").eq("person_id", id).eq("company_id", companyId),
  ]);
  const paths = new Set<string>();
  for (const u of uploads ?? []) if (u.storage_path) paths.add(u.storage_path as string);
  for (const g of generated ?? []) {
    if (g.storage_path_docx) paths.add(g.storage_path_docx as string);
    if (g.storage_path_pdf) paths.add(g.storage_path_pdf as string);
  }
  const folder = `${companyId}/people/${id}`;
  for (const sub of ["uploads", "generated"]) {
    const { data: files } = await supabase.storage.from("cv-documents").list(`${folder}/${sub}`, { limit: 1000 });
    for (const f of files ?? []) if (f.name) paths.add(`${folder}/${sub}/${f.name}`);
  }
  const own = [...paths].filter((p) => p.startsWith(`${companyId}/`));
  if (own.length > 0) {
    const { error: rmErr } = await supabase.storage.from("cv-documents").remove(own);
    if (rmErr) {
      console.error("cv-documents remove failed for person delete", id, rmErr);
      redirect(`/people/${id}?error=${encodeURIComponent("Could not remove this person's CV files - try again. If it keeps happening, let us know.")}`);
    }
  }

  // Registration certificates this person held (0050 held_registrations,
  // company-documents bucket): the rows cascade with the person, the files
  // don't - remove them first, same rule as the CVs above.
  const { data: regs } = await supabase.from("held_registrations").select("storage_path").eq("person_id", id).eq("company_id", companyId);
  const regPaths = (regs ?? []).map((r) => r.storage_path as string | null).filter((p): p is string => !!p && p.startsWith(`${companyId}/`));
  if (regPaths.length > 0) await supabase.storage.from("company-documents").remove(regPaths);

  const { error } = await supabase.from("people").delete().eq("id", id).eq("company_id", companyId);
  if (error) {
    console.error("people delete failed", error);
    redirect(`/people/${id}?error=${encodeURIComponent("Could not delete this person - try again. If it keeps happening, let us know.")}`);
  }
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
  // Found 2026-10-30: this field had NO validation at all (not even NaN or
  // negative) - unlike the sibling "add experience" form, which at least
  // rejects NaN. A garbage string silently became null on insert (JSON.
  // stringify(NaN) -> null), but a negative number passed straight through
  // and is written verbatim onto the person's real SANRAL Form B1/B2
  // experience row (engine/fill_tender.py/fill_conventional.py's
  // `wb.set_value(T, f"I{r}", pr["value_rm"])`) on an actual government bid.
  const value = valueRaw ? Number(valueRaw) : null;
  if (value !== null && (Number.isNaN(value) || value < 0)) {
    redirect(`/people/${personId}?error=${encodeURIComponent("Project value (R million) must be a number of 0 or more.")}`);
  }
  const row = {
    company_id: companyId,
    person_id: personId,
    client_and_number: clientAndNumber,
    client_type: str(formData, "client_type"),
    project_type: str(formData, "project_type"),
    position_code: str(formData, "position_code"),
    position_held: str(formData, "position_held"),
    value_rm: value,
    contact_name: str(formData, "contact_name"),
    contact_phone: str(formData, "contact_phone"),
    contact_email: str(formData, "contact_email"),
    start_date: str(formData, "start_date"),
    end_date: str(formData, "end_date"),
    contact_match_confidence: str(formData, "contact_match_confidence"),
    source_note: str(formData, "source_note"),
  };

  const { error } = await supabase.from("projects").insert(row);
  if (error) {
    console.error("projects insert failed", error);
    redirect(`/people/${personId}?error=${encodeURIComponent("Could not save this project - try again. If it keeps happening, let us know.")}`);
  }

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
 *                 'extraction_requested'). engine/cv/extract_cv_fields.py reads
 *                 the file and stores PROPOSED values (cv_extraction_results,
 *                 0023); the People page shows them for confirm/correct and
 *                 applyCvExtraction() below writes only what the person ticks.
 *                 The standard (non-tender-specific) CV formats are queued for
 *                 pre-generation (generated_cvs, 'requested') at that confirm
 *                 step, not here: until the fields are confirmed the record
 *                 they'd be built from is still empty or out of date.
 *                 Generation itself happens out-of-band - see
 *                 engine/cv/process_cv_jobs.py (Vercel can't run
 *                 Python/LibreOffice) - this file only records requests.
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

  const safeName = safeFileName(file.name);
  const storagePath = `${companyId}/people/${personId}/uploads/${randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("cv-documents")
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (uploadError) {
    console.error("cv upload failed", file.name, uploadError);
    redirect(`/people/${personId}?error=${encodeURIComponent(`Could not upload ${file.name} - try again. If it keeps happening, let us know.`)}`);
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
    console.error("cv_uploads insert failed", insertError);
    redirect(`/people/${personId}?error=${encodeURIComponent("Could not save this CV - try again. If it keeps happening, let us know.")}`);
  }

  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}`);
}

/**
 * Re-queue a failed CV extraction. UX audit re-review 2026-10-23, item 3:
 * a failed upload had no way back except deleting the person and starting
 * over - the file is still sitting in storage untouched, so there is no
 * need to ask for it again. Only moves a row that is actually
 * 'extraction_failed' and belongs to this company (RLS also enforces the
 * company scope on the update itself) - clears the old error and claim
 * timestamp and puts it back where extract_cv_fields.py's own queue picks
 * it up (status extraction_requested, same as a fresh upload).
 */
export async function retryCvExtraction(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  const uploadId = str(formData, "cv_upload_id");
  const personId = str(formData, "person_id");
  if (!uploadId || !personId) redirect("/people");

  const { error } = await supabase
    .from("cv_uploads")
    .update({ status: "extraction_requested", extraction_error: null, extraction_claimed_at: null, extraction_completed_at: null })
    .eq("id", uploadId)
    .eq("company_id", companyId)
    .eq("status", "extraction_failed");
  if (error) {
    console.error("cv_uploads retry update failed", error);
    redirect(`/people/${personId}?error=${encodeURIComponent("Could not retry this CV - try again. If it keeps happening, let us know.")}`);
  }

  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}`);
}

/**
 * Sarel's own live feedback: "on the add person, allow option to add a CV
 * and have AI read and capture all the information instead of the user
 * capturing it." The old /people/new was a full ~20-field blank form -
 * everything manually typed.
 *
 * This is still two of the SAME writes savePerson() and uploadCv() already
 * make (same `people` insert shape, same cv_uploads storage-path convention
 * and column values), not a parallel data model - they're a new function,
 * not a reuse of those two, only because both already end in their own
 * `redirect()` (which throws in a Server Action), so calling one then the
 * other in sequence isn't possible without factoring both apart first. That
 * refactor is a larger, riskier change to two already-working, already-
 * tested actions; duplicating the ~15 lines of insert logic here is the
 * smaller, safer change tonight.
 *
 * What this can't do: extract the person's NAME from the CV before the
 * `people` row exists. cv_uploads.person_id and cv_extraction_results.person_id
 * are both `not null references people(id)` (0008_cv_uploads.sql,
 * 0023_cv_extraction_results.sql) - nothing can be attached to a person who
 * doesn't exist yet. The generic company-level document-scan engine (Batch 2
 * tonight) classifies a "cv" document kind without needing a person first,
 * but deliberately extracts ZERO fields for it (lib/onboardingScan.ts:
 * `cv: []`) - name/qualification extraction is engine/cv/extract_cv_fields.py's
 * job alone, and that only ever runs against an already-existing
 * cv_uploads.person_id. So the one field a human must still type is the name
 * - not invented, just the smallest honest anchor needed to create the row at
 * all. Once the AI extraction comes back, the SAME confirm-or-correct review
 * card every existing person already gets (CvExtractionReview, this file's
 * applyCvExtraction()) lets the user correct that name to whatever the CV
 * itself says - the typed name is a starting point, not a committed fact.
 *
 * Making this fully CV-led (zero typing, including the name) needs either a
 * schema change (a nullable cv_uploads.person_id, or a new staging table for
 * an unconfirmed person) or an engine change (teaching the generic
 * classifier to also do name/field extraction, duplicating
 * extract_cv_fields.py's own job). Neither is built - UX audit re-review
 * 2026-10-23 asked for the typed-name requirement to go away for the
 * AI-extract case specifically, so instead of either of those: when a file
 * is chosen in ai_extract mode and no name was typed, this inserts a
 * clearly-labelled placeholder (never a guessed real name) to satisfy
 * `people.name not null`, exactly as the comment above already says the
 * review card does for a typed-then-corrected name - `name` is EXTRACTED_PERSON_FIELDS'
 * own first field (lib/cvExtraction.ts), so the real name proposed by
 * extract_cv_fields.py reaches this same confirm-or-correct step
 * (applyCvExtraction, below) and overwrites the placeholder once ticked.
 * Typing a name is still required for "Use as-is" (no AI step reads it) or
 * when no file is chosen at all (nothing will ever propose one).
 */
export async function createPersonWithCv(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const typedName = str(formData, "name");
  const file = formData.get("file") as File | null;
  const hasFile = !!file && file.size > 0;
  // Same "as-is vs AI-extract" choice uploadCv() already requires - AI
  // extraction must stay optional (Tender-Tool-Competitor-Feature-Deep-Dive.md,
  // "CVs: upload once, never recapture", the "Use as-is" option), not forced
  // just because this is the new CV-led path.
  const mode = str(formData, "mode") || "ai_extract";
  if (mode !== "as_is" && mode !== "ai_extract") {
    redirect(`/people/new?error=${encodeURIComponent("Choose how this CV should be used: as-is or AI-extract.")}`);
  }
  const canSkipName = hasFile && mode === "ai_extract";
  if (!typedName && !canSkipName) {
    redirect(`/people/new?error=${encodeURIComponent("Enter a name, or choose a CV for AI to read it from.")}`);
  }
  const name = typedName || "Pending CV review";

  // Same `people` insert shape as savePerson() for a new row - only name is
  // supplied here, everything else starts null and is filled in either by
  // the CV review card below or by editing the person's own page later.
  const { data, error: insertError2 } = await supabase
    .from("people")
    .insert({ company_id: companyId, name })
    .select("id")
    .single();
  if (insertError2) {
    console.error("people insert failed (createPersonWithCv)", insertError2);
    redirect(`/people/new?error=${encodeURIComponent("Could not save this person - try again. If it keeps happening, let us know.")}`);
  }
  const personId = data!.id as string;

  if (file && file.size > 0) {
    // Same storage-path convention and cv_uploads row shape as uploadCv()
    // above - this person just didn't exist yet when the file was chosen.
    const safeName = safeFileName(file.name);
    const storagePath = `${companyId}/people/${personId}/uploads/${randomUUID()}-${safeName}`;
    const { error: uploadError2 } = await supabase.storage
      .from("cv-documents")
      .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
    if (uploadError2) {
      console.error("cv upload failed (createPersonWithCv)", file.name, uploadError2);
      // The person record itself was saved fine - only the CV attach failed.
      // Land on their new page and say so, rather than losing the person too.
      redirect(`/people/${personId}?error=${encodeURIComponent(`${name} was added, but the CV couldn't be uploaded - try adding it again from this page.`)}`);
    }
    const { error: cvInsertError } = await supabase.from("cv_uploads").insert({
      company_id: companyId,
      person_id: personId,
      storage_path: storagePath,
      original_filename: file.name,
      mode,
      status: mode === "as_is" ? "uploaded" : "extraction_requested",
      uploaded_by: user?.id ?? null,
    });
    if (cvInsertError) {
      console.error("cv_uploads insert failed (createPersonWithCv)", cvInsertError);
      redirect(`/people/${personId}?error=${encodeURIComponent(`${name} was added, but the CV couldn't be saved - try adding it again from this page.`)}`);
    }
  }

  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}`);
}

/** Non-throwing core of one CV attach - shared by bulkUploadCvs() below so a
 * mid-batch failure doesn't abort files already processed. Same storage-path
 * convention and cv_uploads row shape as uploadCv()/createPersonWithCv()
 * above; not reused directly from them only because both end in their own
 * redirect(), which can't run per-file inside a loop. */
async function attachCvToPerson(
  supabase: SupabaseClient,
  companyId: string,
  userId: string | null,
  personId: string,
  file: File,
  mode: "as_is" | "ai_extract",
): Promise<string | null> {
  const safeName = safeFileName(file.name);
  const storagePath = `${companyId}/people/${personId}/uploads/${randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("cv-documents")
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (uploadError) {
    console.error("cv upload failed (bulkUploadCvs)", file.name, uploadError);
    return `Could not upload ${file.name}.`;
  }
  const { error: insertError } = await supabase.from("cv_uploads").insert({
    company_id: companyId,
    person_id: personId,
    storage_path: storagePath,
    original_filename: file.name,
    mode,
    status: mode === "as_is" ? "uploaded" : "extraction_requested",
    uploaded_by: userId,
  });
  if (insertError) {
    console.error("cv_uploads insert failed (bulkUploadCvs)", insertError);
    return `Could not save ${file.name}.`;
  }
  return null;
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Sarel's own live feedback: "allow bulk upload of all People CVs... or
 * bulk upload of people with their details." One screen, multiple files at
 * once (reuses the shared FileDropzone/uploadBatch pattern spec v3 Batch 2
 * established for company documents) - each file is assigned, per row in
 * the client UI, to either an existing person or a brand-new one (name
 * typed, same one-field minimum as createPersonWithCv() above and for the
 * exact same reason - a CV can't be AI-extracted before a person_id exists,
 * see that function's own comment). Every file still goes through the
 * SAME per-person AI-extraction review card as a single upload - this
 * function only creates/attaches, it never confirms or applies anything
 * extracted.
 *
 * Processes all assigned rows in one call and redirects ONCE at the end, to
 * /people with a summary - NOT per-file, since uploadCv()/createPersonWithCv()
 * above each throw their own redirect() and can't be called in a loop.
 * FormData shape, built by the client component: for i = 0..count-1,
 * `kind_<i>` is "existing" or "new", `file_<i>` is the File, and either
 * `person_id_<i>` (existing) or `name_<i>` (new) names the target.
 */
export async function bulkUploadCvs(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const count = Number(formData.get("count") ?? 0);
  // One as-is/AI-extract choice for the whole batch, same options
  // uploadCv()/createPersonWithCv() offer per file - AI extraction must stay
  // optional here too, not hardcoded just because this is a bulk action.
  const modeRaw = str(formData, "mode");
  const mode: "as_is" | "ai_extract" = modeRaw === "as_is" ? "as_is" : "ai_extract";
  let created = 0;
  let attached = 0;
  const errors: string[] = [];

  for (let i = 0; i < count; i++) {
    const kind = str(formData, `kind_${i}`);
    const file = formData.get(`file_${i}`) as File | null;
    if (!kind || !file || file.size === 0) continue;

    let personId: string | null = null;
    if (kind === "existing") {
      personId = str(formData, `person_id_${i}`);
      if (!personId) {
        errors.push(`${file.name}: no person chosen.`);
        continue;
      }
    } else if (kind === "new") {
      const name = str(formData, `name_${i}`);
      if (!name) {
        errors.push(`${file.name}: no name given for the new person.`);
        continue;
      }
      const { data, error: insertError } = await supabase.from("people").insert({ company_id: companyId, name }).select("id").single();
      if (insertError || !data) {
        console.error("people insert failed (bulkUploadCvs)", insertError);
        errors.push(`${file.name}: could not create ${name}.`);
        continue;
      }
      personId = data.id as string;
      created++;
    } else {
      continue;
    }

    const err = await attachCvToPerson(supabase, companyId, user?.id ?? null, personId!, file, mode);
    if (err) {
      errors.push(`${file.name}: ${err}`);
    } else {
      attached++;
    }
  }

  revalidatePath("/people");
  const summary = `${attached} CV${attached === 1 ? "" : "s"} uploaded${created > 0 ? `, ${created} new ${created === 1 ? "person" : "people"} added` : ""}${errors.length > 0 ? `. ${errors.length} failed: ${errors.join(" ")}` : ""}.`;
  redirect(`/people?bulk=${encodeURIComponent(summary)}`);
}

/**
 * Queue the four standard CV formats for one person, unless a set is already
 * waiting to be built (re-confirming twice shouldn't stack duplicate jobs).
 * Returns true on failure, null on success.
 */
async function queueStandardCvs(supabase: Awaited<ReturnType<typeof createClient>>, companyId: string, personId: string, userId: string | null) {
  const { data: pending } = await supabase
    .from("generated_cvs")
    .select("id")
    .eq("person_id", personId)
    .is("tender_id", null)
    .in("status", ["requested", "generating"])
    .limit(1);
  if ((pending ?? []).length > 0) return null;
  const standardJobs = STANDARD_CV_FORMATS.flatMap((format) =>
    STANDARD_CV_DETAILS.map((detail) => ({
      company_id: companyId,
      person_id: personId,
      format,
      detail,
      status: "requested" as const,
      requested_by: userId,
    }))
  );
  const { error } = await supabase.from("generated_cvs").insert(standardJobs);
  if (error) console.error("generated_cvs insert failed for standard CV queue", error);
  return error ? true : null;
}

/**
 * The confirm-or-correct step for an AI-extracted CV (cv_extraction_results,
 * 0023). The review card posts, per person field, `use_<field>` (ticked) and
 * `f_<field>` (the value as the reviewer left it - proposed, or corrected),
 * and per proposed project `p<i>_use` plus `p<i>_<column>`. Only ticked items
 * are written; nothing else on the person is touched. Projects are added with
 * contact_match_confidence 'unconfirmed' (a CV naming a referee is not a
 * confirmed performance report - same rule the manual form defaults to) and a
 * source_note saying where they came from.
 */
export async function applyCvExtraction(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const personId = str(formData, "person_id");
  const extractionId = str(formData, "extraction_id");
  if (!personId || !extractionId) redirect("/people");
  const back = (msg: string): never => redirect(`/people/${personId}?error=${encodeURIComponent(msg)}`);

  const { data: row, error: readError } = await supabase
    .from("cv_extraction_results")
    .select("id, person_id, review_status, proposed, cv_upload_id, cv_uploads(original_filename)")
    .eq("id", extractionId)
    .maybeSingle();
  if (readError) {
    console.error("cv_extraction_results select failed", readError);
    back("Could not load this extraction - try again. If it keeps happening, let us know.");
  }
  if (!row || row.person_id !== personId) back("That extraction result wasn't found for this person.");
  if (row!.review_status !== "pending_review") back("These extracted fields were already saved or discarded.");
  const proposal = row!.proposed as Proposal;
  const upload = row!.cv_uploads as unknown as { original_filename: string } | null;

  const personUpdate: Record<string, string | null> = {};
  const edited: string[] = [];
  for (const f of EXTRACTED_PERSON_FIELDS) {
    if (formData.get(`use_${f.key}`) !== "on") continue;
    const v = str(formData, `f_${f.key}`);
    if (f.key === "name" && !v) back("A ticked name can't be empty.");
    if (v && f.kind === "date" && !ISO_DATE.test(v)) back(`${f.label}: "${v}" isn't a date (yyyy-mm-dd).`);
    if (v && f.kind === "select" && !(f.options ?? []).includes(v)) back(`${f.label}: choose one of SANRAL's options.`);
    personUpdate[f.key] = v;
    if ((proposal.person?.[f.key]?.value ?? null) !== v) edited.push(f.key);
  }

  const today = new Date().toISOString().slice(0, 10);
  const sourceNote = `From CV "${upload?.original_filename ?? "upload"}" (AI-extracted, confirmed ${today})`;
  const projectRows: Record<string, string | number | null>[] = [];
  (proposal.projects ?? []).forEach((_, i) => {
    if (formData.get(`p${i}_use`) !== "on") return;
    const client = str(formData, `p${i}_client_and_number`);
    if (!client) back(`Project ${i + 1}: client and contract number can't be empty.`);
    const valueRaw = str(formData, `p${i}_value_rm`);
    const value = valueRaw ? Number(valueRaw) : null;
    if (value !== null && Number.isNaN(value)) back(`Project ${i + 1}: value must be a number (R million).`);
    const dates: Record<string, string | null> = {};
    for (const d of ["start_date", "end_date"]) {
      const v = str(formData, `p${i}_${d}`);
      if (v && !ISO_DATE.test(v)) back(`Project ${i + 1}: "${v}" isn't a date (yyyy-mm-dd).`);
      dates[d] = v;
    }
    projectRows.push({
      company_id: companyId,
      person_id: personId,
      client_and_number: client,
      position_held: str(formData, `p${i}_position_held`),
      value_rm: value,
      start_date: dates.start_date,
      end_date: dates.end_date,
      contact_name: str(formData, `p${i}_contact_name`),
      contact_phone: str(formData, `p${i}_contact_phone`),
      contact_email: str(formData, `p${i}_contact_email`),
      contact_match_confidence: "unconfirmed",
      source_note: sourceNote,
    });
  });

  if (Object.keys(personUpdate).length === 0 && projectRows.length === 0) {
    back("Nothing was ticked. Tick the fields to save, or discard the extraction.");
  }

  if (Object.keys(personUpdate).length > 0) {
    const { error } = await supabase.from("people").update({ ...personUpdate, updated_at: new Date().toISOString() }).eq("id", personId);
    if (error) {
      console.error("people update failed for CV extraction", error);
      back("Could not save the person's fields - try again. If it keeps happening, let us know.");
    }
  }
  if (projectRows.length > 0) {
    const { error } = await supabase.from("projects").insert(projectRows);
    if (error) {
      console.error("projects insert failed for CV extraction", error);
      back("Person fields saved, but the projects could not be added - try again. If it keeps happening, let us know.");
    }
  }

  const { error: markError } = await supabase
    .from("cv_extraction_results")
    .update({
      review_status: "applied",
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString(),
      applied: { person_fields: Object.keys(personUpdate), edited_fields: edited, projects_added: projectRows.length },
    })
    .eq("id", extractionId);
  if (markError) {
    console.error("cv_extraction_results update failed", markError);
    back("Saved, but the extraction couldn't be marked as reviewed - try again. If it keeps happening, let us know.");
  }

  const queueError = await queueStandardCvs(supabase, companyId, personId!, user?.id ?? null);
  revalidatePath(`/people/${personId}`);
  if (queueError) back("Fields saved, but the standard CV formats could not be queued - try again. If it keeps happening, let us know.");
  redirect(`/people/${personId}?cv_applied=${Object.keys(personUpdate).length}-${projectRows.length}`);
}

/** Reject an extraction outright: nothing is written to people/projects. */
export async function discardCvExtraction(formData: FormData) {
  await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const personId = str(formData, "person_id");
  const extractionId = str(formData, "extraction_id");
  if (!personId || !extractionId) redirect("/people");

  const { error } = await supabase
    .from("cv_extraction_results")
    .update({ review_status: "discarded", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() })
    .eq("id", extractionId)
    .eq("person_id", personId)
    .eq("review_status", "pending_review");
  if (error) {
    console.error("cv_extraction_results discard update failed", error);
    redirect(`/people/${personId}?error=${encodeURIComponent("Could not discard this extraction - try again. If it keeps happening, let us know.")}`);
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
  if (readError) {
    console.error("person_role_eligibility select failed", readError);
    redirect(`/people/${personId}?error=${encodeURIComponent("Could not load this person's role tags - try again. If it keeps happening, let us know.")}`);
  }
  const have = new Set((current ?? []).map((r) => r.role_code as string));

  const toRemove = [...have].filter((c) => !wanted.has(c));
  const toAdd = [...wanted].filter((c) => !have.has(c));

  if (toRemove.length > 0) {
    const { error } = await supabase.from("person_role_eligibility").delete().eq("person_id", personId).in("role_code", toRemove);
    if (error) {
      console.error("person_role_eligibility delete failed", error);
      redirect(`/people/${personId}?error=${encodeURIComponent("Could not save these role tags - try again. If it keeps happening, let us know.")}`);
    }
  }
  if (toAdd.length > 0) {
    const { error } = await supabase.from("person_role_eligibility").insert(
      toAdd.map((role_code) => ({ company_id: companyId, person_id: personId, role_code, tagged_by: user?.id ?? null }))
    );
    if (error) {
      console.error("person_role_eligibility insert failed", error);
      redirect(`/people/${personId}?error=${encodeURIComponent("Could not save these role tags - try again. If it keeps happening, let us know.")}`);
    }
  }

  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}?roles_saved=1`);
}

/**
 * Add a catalog registration (0050 held_registrations) to THIS person from
 * the People page - the block that appears only when a tender on the system
 * asks for that body (SACAP, SACPLAN, SACQSP, SACPVP, PSIRA; audit O4) or
 * the person already holds one. Same row /company/registrations writes; the
 * 0050 trigger checks scope and same-company holder.
 */
export async function addPersonCatalogRegistration(formData: FormData) {
  const companyId = await requireCompanyId();
  const personId = str(formData, "person_id");
  const slug = str(formData, "slug");
  const back = `/people/${personId}`;
  if (!personId || !slug) redirect(`${back}?error=${encodeURIComponent("Missing person or registration type.")}`);
  const supabase = await createClient();
  const { data: type } = await supabase
    .from("registration_types")
    .select("id")
    .eq("slug", slug!)
    .is("owner_company_id", null)
    .maybeSingle();
  if (!type) redirect(`${back}?error=${encodeURIComponent(`The registration type "${slug}" isn't in the catalog.`)}#registrations-asked`);
  const { error } = await supabase.from("held_registrations").insert({
    company_id: companyId,
    registration_type_id: type!.id,
    person_id: personId,
    registration_number: str(formData, "registration_number"),
    category: str(formData, "category"),
    expiry_date: str(formData, "expiry_date"),
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message.replace(/^held_registrations: /, ""))}#registrations-asked`);
  revalidatePath(back);
  redirect(`${back}#registrations-asked`);
}

/**
 * Signatory scopes (0061) - optional region/industry/discipline tags on a
 * signatory, used only to SUGGEST the right default on the per-tender
 * signatory selector (app/app/tenders/[id]/signatory-logic.ts). At least
 * one of region/industry_tag/discipline_tag must be set (the 0061 check
 * constraint also enforces this). Adding or removing a scope never affects
 * which signatories a company can CHOOSE for a tender - that list is
 * everyone with a signatory_capacity, unchanged by this table.
 */
export async function addSignatoryScope(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  const personId = str(formData, "person_id");
  if (!personId) redirect("/people");
  const back = `/people/${personId}#signatory-scope`;

  const region = str(formData, "region");
  const industryTag = str(formData, "industry_tag");
  const disciplineTag = str(formData, "discipline_tag");
  if (!region && !industryTag && !disciplineTag) {
    redirect(`${back.replace("#signatory-scope", "")}?error=${encodeURIComponent("Set a region and/or an industry/discipline for this scope.")}#signatory-scope`);
  }

  const { error } = await supabase.from("signatory_scopes").insert({
    company_id: companyId,
    person_id: personId,
    region,
    industry_tag: industryTag,
    discipline_tag: disciplineTag,
  });
  if (error) {
    console.error("signatory_scopes insert failed", error);
    redirect(`/people/${personId}?error=${encodeURIComponent("Could not save this scope - try again. If it keeps happening, let us know.")}#signatory-scope`);
  }
  revalidatePath(`/people/${personId}`);
  redirect(back);
}

export async function deleteSignatoryScope(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const personId = str(formData, "person_id");
  const scopeId = str(formData, "scope_id");
  if (!personId || !scopeId) redirect("/people");

  const { error } = await supabase.from("signatory_scopes").delete().eq("id", scopeId).eq("company_id", companyId);
  if (error) {
    console.error("signatory_scopes delete failed", error);
    redirect(`/people/${personId}?error=${encodeURIComponent("Could not delete this scope - try again. If it keeps happening, let us know.")}#signatory-scope`);
  }
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}#signatory-scope`);
}
