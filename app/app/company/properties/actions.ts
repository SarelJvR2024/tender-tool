"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { MAX_UPLOAD_BYTES, VAULT_BUCKET } from "@/lib/vaultDocuments";
import { OWNERSHIP_BASES, SAPOA_GRADES, isPropertyDocumentType } from "@/lib/properties";
import { PROVINCES } from "@/lib/locality";
import { safeFileName } from "@/lib/safeFileName";

// Buildings offered to lease (0050 company_properties / property_documents).
// RLS (is_company_member) + the 0050 same-company trigger gate every write.

const BACK = "/company/properties";

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

function num(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

function triState(formData: FormData, key: string): boolean | null {
  const v = formData.get(key);
  return v === "yes" ? true : v === "no" ? false : null;
}

export async function saveProperty(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "property_id");
  const anchor = id ? `#prop-${id}` : "#add";
  const label = str(formData, "label");
  if (!label) fail("Give the building a name you'll recognise (e.g. \"Main Road offices, Joubertina\").", anchor);
  const basis = str(formData, "ownership_basis");
  if (basis && !OWNERSHIP_BASES.some((b) => b.value === basis)) fail("Unknown ownership basis.", anchor);
  const grade = str(formData, "sapoa_grade");
  if (grade && !(SAPOA_GRADES as readonly string[]).includes(grade)) fail("SAPOA grade must be P, A, B or C.", anchor);
  const province = str(formData, "province");
  if (province && !(PROVINCES as readonly string[]).includes(province)) fail("Unknown province.", anchor);

  const row = {
    company_id: companyId,
    label,
    physical_address: str(formData, "physical_address"),
    erf_number: str(formData, "erf_number"),
    town: str(formData, "town"),
    local_municipality: str(formData, "local_municipality"),
    province,
    ownership_basis: basis,
    registered_owner: str(formData, "registered_owner"),
    title_deed_number: str(formData, "title_deed_number"),
    gross_lettable_area_m2: num(formData, "gross_lettable_area_m2"),
    parking_bays_covered: num(formData, "parking_bays_covered"),
    parking_bays_open: num(formData, "parking_bays_open"),
    sapoa_grade: grade,
    ground_floor_space: triState(formData, "ground_floor_space"),
    wheelchair_accessible: triState(formData, "wheelchair_accessible"),
    notes: str(formData, "notes"),
  };
  let propertyId = id;
  if (id) {
    // .select("id").maybeSingle() matters: PostgREST returns a 2xx with
    // `error: null` and zero rows affected when RLS's own `using
    // (is_company_member(company_id))` no longer matches - e.g. this user's
    // own company_members row being removed between page load and this
    // write - indistinguishable from a real update by `error` alone. Same
    // shape, same fix, as app/company/actions.ts uploadVaultDocument().
    const { data, error } = await supabase.from("company_properties").update(row).eq("id", id).select("id").maybeSingle();
    if (error) fail(error.message, anchor);
    if (!data) fail("That building is no longer there - it may have been removed. Refresh and try again.", "#add");
  } else {
    const { data, error } = await supabase.from("company_properties").insert(row).select("id").single();
    if (error) fail(error.message, anchor);
    propertyId = data.id as string;
  }
  revalidatePath(BACK);
  redirect(`${BACK}?saved=1#prop-${propertyId}`);
}

export async function deleteProperty(formData: FormData) {
  await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "property_id");
  if (!id) redirect(BACK);
  const { data: docs } = await supabase.from("property_documents").select("storage_path").eq("property_id", id);
  // .select("id").maybeSingle() matters here even more than on an update:
  // without it, a zero-row-match delete (the same RLS race as above - this
  // user's own company_members row removed between the `docs` read and this
  // delete) is indistinguishable from a real one by `error` alone, and the
  // code below would go on to destroy the building's still-referenced
  // documents from storage while the building row itself survives untouched.
  const { data: deleted, error } = await supabase.from("company_properties").delete().eq("id", id).select("id").maybeSingle();
  if (error) {
    console.error("company_properties delete failed", error);
    fail("Could not delete this building - try again. If it keeps happening, let us know.");
  }
  if (!deleted) {
    fail("That building is no longer there - it may have been removed. Refresh and try again.");
  }
  const paths = (docs ?? []).map((d) => d.storage_path).filter(Boolean) as string[];
  if (paths.length) await supabase.storage.from(VAULT_BUCKET).remove(paths);
  revalidatePath(BACK);
  redirect(`${BACK}?saved=removed`);
}

/** Add / replace one document for a building (one row per type per building). */
export async function savePropertyDocument(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const propertyId = str(formData, "property_id");
  const type = formData.get("document_type");
  if (!propertyId || !isPropertyDocumentType(type)) fail("Unknown document.");
  const anchor = `#prop-${propertyId}`;

  const { data: existing } = await supabase
    .from("property_documents")
    .select("id, storage_path")
    .eq("property_id", propertyId)
    .eq("document_type", type)
    .maybeSingle();

  const row: Record<string, unknown> = {
    company_id: companyId,
    property_id: propertyId,
    document_type: type,
    reference_number: str(formData, "reference_number"),
    issued_on: str(formData, "issued_on"),
    valid_until: str(formData, "valid_until"),
  };

  let newPath: string | null = null;
  const file = formData.get("file") as File | null;
  if (file && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) fail("File is larger than 4.4 MB - scan it at a lower resolution or compress the PDF.", anchor);
    const safeName = safeFileName(file.name);
    newPath = `${companyId}/properties/${propertyId}/${type}/${randomUUID()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from(VAULT_BUCKET).upload(newPath, file, { contentType: file.type || "application/octet-stream" });
    if (upErr) {
      console.error("property document upload failed", file.name, upErr);
      fail(`Could not upload ${file.name} - try again. If it keeps happening, let us know.`, anchor);
    }
    row.storage_path = newPath;
    row.original_filename = file.name;
  }

  // .select("id").maybeSingle() on the update branch matters: PostgREST
  // returns a 2xx with `error: null` and zero rows affected when RLS's own
  // `using (is_company_member(company_id))` (0050, re-evaluated against the
  // OLD row) no longer matches - e.g. this user's own company_members row
  // being removed between the `existing` read above and this write -
  // indistinguishable from a real update by `error` alone. Without this
  // check, that race left a newly-uploaded file orphaned AND unconditionally
  // deleted the still-referenced previous file below regardless.
  let saveError: { message: string } | null = null;
  if (existing) {
    const { data, error } = await supabase.from("property_documents").update(row).eq("id", existing.id).select("id").maybeSingle();
    saveError = error ?? (data ? null : { message: "This document's building record is no longer there - it may have been removed. Refresh and try again." });
  } else {
    const { error } = await supabase.from("property_documents").insert(row);
    saveError = error;
  }
  if (saveError) {
    if (newPath) await supabase.storage.from(VAULT_BUCKET).remove([newPath]);
    fail(saveError.message, anchor);
  }
  if (newPath && existing?.storage_path) await supabase.storage.from(VAULT_BUCKET).remove([existing.storage_path]);
  revalidatePath(BACK);
  redirect(`${BACK}?saved=doc${anchor}`);
}
