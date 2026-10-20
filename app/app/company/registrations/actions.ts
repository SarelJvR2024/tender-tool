"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { MAX_UPLOAD_BYTES, VAULT_BUCKET } from "@/lib/vaultDocuments";
import { KIND_LABELS, parseHolder, type RegistrationScope } from "@/lib/registrations";
import { safeFileName } from "@/lib/safeFileName";

// Held registrations (0050). The 0050 trigger is the authority on scope
// (company / person / both), stored_in types, and same-company holders; these
// actions only shape the row and turn its messages into plain ones.

const BACK = "/company/registrations";

async function requireCompanyId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  return membership.company_id as string;
}

function fail(message: string, anchor = ""): never {
  redirect(`${BACK}?error=${encodeURIComponent(message.replace(/^held_registrations: /, ""))}${anchor}`);
}

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

export async function saveHeldRegistration(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "held_id");
  const anchor = id ? `#r-${id}` : "#add";
  const typeId = str(formData, "registration_type_id");
  if (!typeId) fail("Choose the registration type.", anchor);
  const holder = parseHolder(str(formData, "holder"));
  if (!holder) fail("Choose who holds it.", anchor);

  const row = {
    company_id: companyId,
    registration_type_id: typeId,
    ...holder,
    registration_number: str(formData, "registration_number"),
    category: str(formData, "category"),
    issued_by: str(formData, "issued_by"),
    issued_on: str(formData, "issued_on"),
    expiry_date: str(formData, "expiry_date"),
    certified_on: str(formData, "certified_on"),
    notes: str(formData, "notes"),
  };

  let heldId = id;
  if (id) {
    const { error } = await supabase.from("held_registrations").update(row).eq("id", id);
    if (error) fail(error.message, anchor);
  } else {
    const { data, error } = await supabase.from("held_registrations").insert(row).select("id").single();
    if (error) fail(error.message, anchor);
    heldId = data.id as string;
  }

  // Optional certificate copy, same upload pattern as the Document Vault (0014).
  const file = formData.get("file") as File | null;
  if (file && file.size > 0 && heldId) {
    if (file.size > MAX_UPLOAD_BYTES) fail("File is larger than 4.4 MB - scan it at a lower resolution or compress the PDF.", `#r-${heldId}`);
    const { data: existing } = await supabase.from("held_registrations").select("storage_path").eq("id", heldId).maybeSingle();
    const safeName = safeFileName(file.name);
    const path = `${companyId}/registrations/${heldId}/${randomUUID()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from(VAULT_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (upErr) {
      console.error("held registration certificate upload failed", file.name, upErr);
      fail(`Saved, but ${file.name} could not be uploaded - try again. If it keeps happening, let us know.`, `#r-${heldId}`);
    }
    const { error } = await supabase.from("held_registrations").update({ storage_path: path, original_filename: file.name }).eq("id", heldId);
    if (error) {
      await supabase.storage.from(VAULT_BUCKET).remove([path]);
      fail(error.message, `#r-${heldId}`);
    }
    if (existing?.storage_path) await supabase.storage.from(VAULT_BUCKET).remove([existing.storage_path]);
  }

  revalidatePath(BACK);
  redirect(`${BACK}?saved=1#r-${heldId}`);
}

export async function deleteHeldRegistration(formData: FormData) {
  await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "held_id");
  if (!id) redirect(BACK);
  const { data: existing } = await supabase.from("held_registrations").select("storage_path").eq("id", id).maybeSingle();
  const { error } = await supabase.from("held_registrations").delete().eq("id", id);
  if (error) {
    console.error("held_registrations delete failed", error);
    fail("Could not delete this registration - try again. If it keeps happening, let us know.");
  }
  if (existing?.storage_path) await supabase.storage.from(VAULT_BUCKET).remove([existing.storage_path]);
  revalidatePath(BACK);
  redirect(`${BACK}?saved=removed`);
}

/**
 * A company adds a registration type the shared catalog doesn't have yet.
 * It is private to the company (owner_company_id); the shared catalog is
 * maintained by Tender Tool (service role), like discipline_categories.
 */
export async function addRegistrationType(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const label = str(formData, "label");
  if (!label) fail("Name the registration.", "#catalog");
  const scope = str(formData, "scope") as RegistrationScope | null;
  if (!scope || !["company", "person", "both"].includes(scope)) fail("Say whether the company, a person, or either holds it.", "#catalog");
  const kind = str(formData, "kind") ?? "registration";
  if (!Object.prototype.hasOwnProperty.call(KIND_LABELS, kind)) fail("Unknown kind.", "#catalog");
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([0-9])/, "r_$1")
      .slice(0, 50) || "registration";
  const { error } = await supabase.from("registration_types").insert({
    slug,
    label,
    issuing_body: str(formData, "issuing_body"),
    scope,
    kind,
    owner_company_id: companyId,
    asked_for_by: str(formData, "asked_for_by"),
  });
  if (error) {
    if (!error.message.includes("registration_types_company_slug")) console.error("registration_types insert failed", error);
    fail(error.message.includes("registration_types_company_slug")
      ? "You already added a registration with that name."
      : "Could not add this registration type - try again. If it keeps happening, let us know.", "#catalog");
  }
  revalidatePath(BACK);
  redirect(`${BACK}?saved=type#add`);
}
