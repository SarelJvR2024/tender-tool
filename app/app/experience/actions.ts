"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { DOCUMENT_TYPES, DISCIPLINES, SERVICE_STAGES, CLIENT_TYPES, PERFORMANCE_RATINGS } from "@/lib/experience";

/**
 * Company experience library (0012_experience_items.sql). Two separate steps,
 * per Sarel's own wording: CAPTURE (captureExperience - upload a reference
 * letter / completion certificate / etc., or record a project with no
 * document yet) and TAGGING (saveExperienceTags - a human states what the
 * evidence shows). RLS (is_company_member) enforces tenant isolation; these
 * actions only supply company_id for the insert check, same as
 * people/actions.ts.
 *
 * Upload follows people/actions.ts uploadCv exactly: private bucket, path
 * "<company_id>/experience/<uuid>-<filename>", path stored, not the file.
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

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const DOC_TYPE_VALUES = DOCUMENT_TYPES.map((d) => d.value);
const DISCIPLINE_VALUES = DISCIPLINES.map((d) => d.value) as string[];
const STAGE_VALUES = SERVICE_STAGES.map((s) => s.value) as string[];
const RATING_VALUES = PERFORMANCE_RATINGS.map((r) => r.value);

async function uploadFile(companyId: string, file: File) {
  const supabase = await createClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${companyId}/experience/${randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("experience-documents")
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  return { storagePath, error: error?.message ?? null };
}

const err = (path: string, msg: string) => `${path}?error=${encodeURIComponent(msg)}`;

/** Step 1 - capture. Sends the user straight on to step 2 (tagging). */
export async function captureExperience(formData: FormData) {
  const { companyId, userId } = await requireCompanyId();
  const supabase = await createClient();

  const projectName = str(formData, "project_name");
  const documentType = oneOf(str(formData, "document_type"), DOC_TYPE_VALUES);
  const file = formData.get("file") as File | null;
  const hasFile = !!file && file.size > 0;

  if (!projectName) redirect(err("/experience", "Give the project a name, as the client's document names it."));
  if (!documentType) redirect(err("/experience", "Choose what kind of document this is."));
  if (documentType !== "project_record" && !hasFile) {
    redirect(err("/experience", "Attach the document, or choose \"Project record (no document yet)\"."));
  }

  let storagePath: string | null = null;
  if (hasFile) {
    const up = await uploadFile(companyId, file!);
    if (up.error) redirect(err("/experience", `Could not upload file: ${up.error}`));
    storagePath = up.storagePath;
  }

  const { data, error } = await supabase
    .from("experience_items")
    .insert({
      company_id: companyId,
      project_name: projectName,
      document_type: documentType,
      storage_path: storagePath,
      original_filename: hasFile ? file!.name : null,
      uploaded_by: userId,
    })
    .select("id")
    .single();
  if (error) redirect(err("/experience", error.message));

  revalidatePath("/experience");
  redirect(`/experience/${data!.id}?captured=1`);
}

/** Step 2 - tagging. Editable any time; sets tagged_at so the item counts in matches. */
export async function saveExperienceTags(formData: FormData) {
  const { companyId, userId } = await requireCompanyId();
  const supabase = await createClient();

  const id = str(formData, "id");
  if (!id) redirect("/experience");
  const back = `/experience/${id}`;

  const projectName = str(formData, "project_name");
  const documentType = oneOf(str(formData, "document_type"), DOC_TYPE_VALUES);
  const disciplines = formData.getAll("disciplines").map(String).filter((d) => DISCIPLINE_VALUES.includes(d));
  const stages = formData.getAll("service_stages").map(String).filter((s) => STAGE_VALUES.includes(s));
  const valueRaw = str(formData, "value_rm");
  const value = valueRaw === null ? null : Number(valueRaw);

  if (!projectName) redirect(err(back, "Project name can't be empty."));
  if (!documentType) redirect(err(back, "Choose what kind of document this is."));
  if (disciplines.length === 0) {
    redirect(err(back, "Pick at least one discipline - it's what tenders are matched on."));
  }
  if (value !== null && Number.isNaN(value)) redirect(err(back, "Value must be a number (R millions)."));

  const update: Record<string, unknown> = {
    project_name: projectName,
    document_type: documentType,
    client_name: str(formData, "client_name"),
    contract_number: str(formData, "contract_number"),
    client_type: oneOf(str(formData, "client_type"), CLIENT_TYPES),
    disciplines,
    project_type: str(formData, "project_type"),
    scope_summary: str(formData, "scope_summary"),
    service_stages: stages,
    value_rm: value,
    start_date: str(formData, "start_date"),
    completion_date: str(formData, "completion_date"),
    performance_rating: oneOf(str(formData, "performance_rating"), RATING_VALUES),
    reference_contact_name: str(formData, "reference_contact_name"),
    reference_contact_phone: str(formData, "reference_contact_phone"),
    reference_contact_email: str(formData, "reference_contact_email"),
    notes: str(formData, "notes"),
    tagged_at: new Date().toISOString(),
    tagged_by: userId,
  };

  // Optional: attach (or replace) the document, e.g. a reference letter that
  // arrived after the project was first recorded with no document.
  const file = formData.get("file") as File | null;
  let replacedPath: string | null = null;
  if (file && file.size > 0) {
    const { data: existing } = await supabase.from("experience_items").select("storage_path").eq("id", id).maybeSingle();
    replacedPath = existing?.storage_path ?? null;
    const up = await uploadFile(companyId, file);
    if (up.error) redirect(err(back, `Could not upload file: ${up.error}`));
    update.storage_path = up.storagePath;
    update.original_filename = file.name;
  }

  const { error } = await supabase.from("experience_items").update(update).eq("id", id);
  if (error) redirect(err(back, error.message));
  if (replacedPath) {
    await supabase.storage.from("experience-documents").remove([replacedPath]);
  }

  revalidatePath("/experience");
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}

export async function deleteExperience(formData: FormData) {
  await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "id");
  if (!id) redirect("/experience");

  const { data } = await supabase.from("experience_items").select("storage_path").eq("id", id).maybeSingle();
  await supabase.from("experience_items").delete().eq("id", id);
  if (data?.storage_path) {
    await supabase.storage.from("experience-documents").remove([data.storage_path]);
  }
  revalidatePath("/experience");
  redirect("/experience");
}
