"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { DOCUMENT_TYPES, SERVICE_STAGES, CLIENT_TYPES, PERFORMANCE_RATINGS, disciplineSlug } from "@/lib/experience";
import { safeFileName } from "@/lib/safeFileName";

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
const STAGE_VALUES = SERVICE_STAGES.map((s) => s.value) as string[];
const RATING_VALUES = PERFORMANCE_RATINGS.map((r) => r.value);

async function uploadFile(companyId: string, file: File) {
  const supabase = await createClient();
  const safeName = safeFileName(file.name);
  const storagePath = `${companyId}/experience/${randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("experience-documents")
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (error) console.error("experience document upload failed", file.name, error);
  return { storagePath, error: error ? true : false };
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
    if (up.error) redirect(err("/experience", `Could not upload ${file!.name} - try again. If it keeps happening, let us know.`));
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
  if (error) {
    console.error("experience_items insert failed", error);
    redirect(err("/experience", "Could not save this project - try again. If it keeps happening, let us know."));
  }

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
  // Ticked tags (suggested or the item's own) plus any typed in "Other
  // disciplines" - not limited to the suggested 7 (migration 0036).
  const typed = (str(formData, "other_disciplines") ?? "").split(",");
  const disciplines = Array.from(
    new Set([...formData.getAll("disciplines").map(String), ...typed].map((d) => disciplineSlug(d)).filter((d): d is string => !!d)),
  );
  const stages = formData.getAll("service_stages").map(String).filter((s) => STAGE_VALUES.includes(s));
  const valueRaw = str(formData, "value_rm");
  const value = valueRaw === null ? null : Number(valueRaw);

  if (!projectName) redirect(err(back, "Project name can't be empty."));
  if (!documentType) redirect(err(back, "Choose what kind of document this is."));
  if (disciplines.length === 0) {
    redirect(err(back, "Pick at least one discipline - it's what tenders are matched on."));
  }
  // Found 2026-10-30: this only ever rejected NaN, never a negative number -
  // the same gap people/actions.ts's saveProject() had for the identical
  // unit (R millions, same column convention per 0012_experience_items.sql's
  // own comment). This value feeds engine/narrative/build_prompt.py's
  // "R{value_rm}m" text in a real customer-facing AI narrative, and the
  // match_experience() RPC's >= filter (0012) - a negative value would read
  // as broken in the narrative and corrupt that filter's own comparison.
  if (value !== null && (Number.isNaN(value) || value < 0)) redirect(err(back, "Value must be a number of 0 or more (R millions)."));

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
    if (up.error) redirect(err(back, `Could not upload ${file.name} - try again. If it keeps happening, let us know.`));
    update.storage_path = up.storagePath;
    update.original_filename = file.name;
  }

  const { error } = await supabase.from("experience_items").update(update).eq("id", id);
  if (error) {
    console.error("experience_items update failed", error);
    redirect(err(back, "Could not save these tags - try again. If it keeps happening, let us know."));
  }
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

/**
 * Offer one of the company's own experience tags (0036 - not on the shared
 * list) to Sarel for the SHARED discipline list (audit O2, 0054
 * discipline_category_suggestions). Files a PENDING suggestion only - nothing
 * is added to the list until a platform admin approves it on
 * /admin/taxonomy. RLS: members suggest for their own company only; the
 * table's trigger refuses a slug already on the list and an example item
 * that isn't this company's.
 */
export async function suggestSharedCategory(formData: FormData) {
  const { companyId, userId } = await requireCompanyId();
  const itemId = str(formData, "item_id");
  const slug = (str(formData, "slug") ?? "").toLowerCase();
  const back = itemId ? `/experience/${itemId}` : "/experience";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(slug)) redirect(err(back, `"${slug}" isn't a tag that can be suggested.`));
  const supabase = await createClient();
  const { error } = await supabase.from("discipline_category_suggestions").insert({
    company_id: companyId,
    slug,
    label: str(formData, "label") ?? slug.replace(/_/g, " "),
    suggested_parent_slug: str(formData, "parent_slug"),
    note: str(formData, "note"),
    example_item_id: itemId,
    suggested_by: userId,
  });
  if (error) {
    const known = error.code === "23505" || error.message.includes("already on the shared list");
    if (!known) console.error("discipline_category_suggestions insert failed", error);
    const msg =
      error.code === "23505"
        ? "Your company has already suggested this tag - it is waiting for review."
        : error.message.includes("already on the shared list")
          ? "That tag is already on the shared list."
          : "Could not suggest this tag - try again. If it keeps happening, let us know.";
    redirect(err(back, msg));
  }
  revalidatePath(back);
  redirect(`${back}?suggested=1`);
}

export async function withdrawSuggestion(formData: FormData) {
  await requireCompanyId();
  const id = str(formData, "id");
  const itemId = str(formData, "item_id");
  const back = itemId ? `/experience/${itemId}` : "/experience";
  const supabase = await createClient();
  const { error } = await supabase.from("discipline_category_suggestions").delete().eq("id", id ?? "").eq("status", "pending");
  if (error) {
    console.error("discipline_category_suggestions delete failed", error);
    redirect(err(back, "Could not withdraw this suggestion - try again. If it keeps happening, let us know."));
  }
  revalidatePath(back);
  redirect(back);
}
