"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { MAX_UPLOAD_BYTES, VAULT_BUCKET } from "@/lib/vaultDocuments";
import { GENDERS, PRINCIPAL_DOCUMENT_KINDS, PRINCIPAL_ROLES, RACES, isPrincipalDocumentKind, isValidSaId } from "@/lib/principals";

// Directors & shareholders register (0050). RLS (is_company_member) enforces
// tenancy and the 0050 triggers refuse cross-company links and >100 %
// ownership; company_id is supplied only to satisfy the with-check.
//
// POPIA: error messages never echo a submitted value (an ID number must not
// end up in a URL, a log line or browser history).

const BACK = "/company/principals";

async function requireCompanyId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  return membership.company_id as string;
}

function fail(message: string, anchor = ""): never {
  redirect(`${BACK}?error=${encodeURIComponent(message)}${anchor}`);
}

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

function triState(formData: FormData, key: string): boolean | null {
  const v = formData.get(key);
  return v === "yes" ? true : v === "no" ? false : null;
}

// Trigger messages are written for people (0050); Postgres' own constraint
// messages are not, so map the known ones. Anything else (a genuine
// unexpected error, not one of this trigger's own deliberate messages) is
// never shown raw - the trigger's own text never echoes a submitted value
// either way (this file's own POPIA rule above), but an unrelated Postgres
// error could still name an internal column/table.
function friendly(message: string): string {
  if (message.includes("more than 100")) return message.replace(/^.*?company_principals: /, "");
  if (message.includes("company_principals_check")) return "A director with no shares can't have a shareholding - choose \"Director and shareholder\".";
  if (message.includes("id_number")) return "The ID number must be 13 digits.";
  if (message.includes("ownership_pct")) return "Shareholding must be between 0 and 100 %.";
  // Not logging `message` itself here - this file's own POPIA rule above is
  // that a submitted value must never end up in a log line, and an
  // unrecognised Postgres error is exactly the case this function can't
  // already prove is safe to echo.
  console.error("company_principals write failed with an unrecognised error (message withheld, see POPIA rule above)");
  return "Could not save this person - try again. If it keeps happening, let us know.";
}

export async function savePrincipal(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  const id = str(formData, "principal_id");
  const anchor = id ? `#p-${id}` : "#add";
  const role = str(formData, "role");
  if (!PRINCIPAL_ROLES.some((r) => r.value === role)) fail("Choose the person's role.", anchor);
  const holderType = str(formData, "holder_type") === "juristic_person" ? "juristic_person" : "natural_person";
  const fullName = str(formData, "full_name");
  if (!fullName) fail("Enter the full name as on the CIPC record.", anchor);

  const idNumber = str(formData, "id_number")?.replace(/\s+/g, "") ?? null;
  if (idNumber && !isValidSaId(idNumber)) fail("That ID number isn't a valid 13-digit South African ID number (check digit).", anchor);
  const race = str(formData, "race");
  if (race && !RACES.some((r) => r.value === race)) fail("Unknown race group.", anchor);
  const gender = str(formData, "gender");
  if (gender && !GENDERS.some((g) => g.value === gender)) fail("Unknown gender.", anchor);
  const pctRaw = str(formData, "ownership_pct");
  const ownership = pctRaw === null ? null : Number(pctRaw.replace(",", "."));
  if (ownership !== null && (Number.isNaN(ownership) || ownership < 0 || ownership > 100)) fail("Shareholding must be between 0 and 100 %.", anchor);
  if (role === "director" && ownership) fail("A director with no shares can't have a shareholding - choose \"Director and shareholder\".", anchor);

  const natural = holderType === "natural_person";
  const row = {
    company_id: companyId,
    role,
    holder_type: holderType,
    full_name: fullName,
    position: str(formData, "position"),
    executive: triState(formData, "executive"),
    appointed_on: str(formData, "appointed_on"),
    person_id: str(formData, "person_id"),
    id_number: natural ? idNumber : null,
    passport_number: natural ? str(formData, "passport_number") : null,
    nationality: natural ? str(formData, "nationality") : null,
    sa_citizen: natural ? triState(formData, "sa_citizen") : null,
    date_of_birth: natural ? str(formData, "date_of_birth") : null,
    gender: natural ? gender : null,
    race: natural ? race : null,
    disability: natural ? triState(formData, "disability") : null,
    military_veteran: natural ? triState(formData, "military_veteran") : null,
    entity_registration_number: natural ? null : str(formData, "entity_registration_number"),
    ownership_pct: role === "director" ? null : ownership,
    certified_id_on: natural ? str(formData, "certified_id_on") : null,
    popia_consent_on: str(formData, "popia_consent_on"),
    notes: str(formData, "notes"),
  };

  // An empty ID field on an edit keeps the number on file (the edit form
  // never receives the full number); "remove" clears it explicitly.
  const update: Record<string, unknown> = { ...row };
  if (id && natural && !idNumber && formData.get("clear_id_number") !== "1") delete update.id_number;

  const { error } = id
    ? await supabase.from("company_principals").update(update).eq("id", id)
    : await supabase.from("company_principals").insert(row);
  if (error) fail(friendly(error.message), anchor);

  revalidatePath(BACK);
  redirect(`${BACK}?saved=1${anchor}`);
}

export async function deletePrincipal(formData: FormData) {
  await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "principal_id");
  if (!id) redirect(BACK);
  const { data: existing } = await supabase
    .from("company_principals")
    .select("certified_id_path, disability_proof_path")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("company_principals").delete().eq("id", id);
  if (error) {
    console.error("company_principals delete failed");
    fail("Could not delete this person - try again. If it keeps happening, let us know.");
  }
  // Personal documents go with the person (POPIA: don't keep what has no purpose).
  const paths = [existing?.certified_id_path, existing?.disability_proof_path].filter(Boolean) as string[];
  if (paths.length) await supabase.storage.from(VAULT_BUCKET).remove(paths);
  revalidatePath(BACK);
  redirect(`${BACK}?saved=removed`);
}

/** Certified ID copy or disability proof for one principal - Document Vault upload pattern (0014). */
export async function uploadPrincipalDocument(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "principal_id");
  const kind = formData.get("kind");
  if (!id || !isPrincipalDocumentKind(kind)) fail("Unknown document.");
  const anchor = `#p-${id}`;
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) fail("Choose a file to upload.", anchor);
  if (file.size > MAX_UPLOAD_BYTES) fail("File is larger than 4.4 MB - scan it at a lower resolution or compress the PDF.", anchor);

  const spec = PRINCIPAL_DOCUMENT_KINDS[kind];
  const { data: existing } = await supabase.from("company_principals").select(spec.pathColumn).eq("id", id).maybeSingle();
  if (!existing) fail("That person is not in your register.", anchor);
  const previous = (existing as Record<string, string | null>)[spec.pathColumn] ?? null;

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${companyId}/principals/${id}/${kind}/${randomUUID()}-${safeName}`;
  const { error: upErr } = await supabase.storage.from(VAULT_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (upErr) {
    console.error("principal document upload failed", file.name);
    fail(`Could not upload ${file.name} - try again. If it keeps happening, let us know.`, anchor);
  }

  const update: Record<string, string | null> = { [spec.pathColumn]: path, [spec.nameColumn]: file.name };
  if (kind === "certified_id") update.certified_id_on = str(formData, "certified_id_on");
  const { error } = await supabase.from("company_principals").update(update).eq("id", id);
  if (error) {
    await supabase.storage.from(VAULT_BUCKET).remove([path]);
    fail(friendly(error.message), anchor);
  }
  if (previous) await supabase.storage.from(VAULT_BUCKET).remove([previous]);
  revalidatePath(BACK);
  redirect(`${BACK}?saved=doc${anchor}`);
}
