"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { OFFICE_KINDS, OFFICE_PROOF_TYPES, PROVINCES } from "@/lib/locality";

/**
 * Company office locations (migration 0015 company_offices) - structured
 * province / district / local municipality so locality rows in tenders can
 * be matched (Sarel, 2026-10-16: "office location sometimes counts for
 * scoring"). RLS (is_company_member) is what enforces tenancy; company_id is
 * only supplied to satisfy the insert's with-check.
 */
async function requireCompanyId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  return membership.company_id as string;
}

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

function fail(message: string): never {
  redirect(`/company?error=${encodeURIComponent(message)}#offices`);
}

export async function saveCompanyOffice(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();

  const id = str(formData, "office_id");
  const province = str(formData, "province");
  if (!province || !(PROVINCES as readonly string[]).includes(province)) fail("Choose the office's province.");
  const officeKind = str(formData, "office_kind") ?? "branch";
  if (!OFFICE_KINDS.some((k) => k.value === officeKind)) fail("Unknown office type.");
  const proofType = str(formData, "proof_type");
  if (proofType && !OFFICE_PROOF_TYPES.some((k) => k.value === proofType)) fail("Unknown proof type.");

  const row = {
    company_id: companyId,
    label: str(formData, "label"),
    office_kind: officeKind,
    province,
    district_municipality: str(formData, "district_municipality"),
    local_municipality: str(formData, "local_municipality"),
    town: str(formData, "town"),
    street_address: str(formData, "street_address"),
    proof_type: proofType,
    proof_date: str(formData, "proof_date"),
    notes: str(formData, "notes"),
  };

  const { error } = id
    ? await supabase.from("company_offices").update(row).eq("id", id)
    : await supabase.from("company_offices").insert(row);
  if (error) fail(error.message);

  revalidatePath("/company");
  redirect("/company?saved=office#offices");
}

export async function deleteCompanyOffice(formData: FormData) {
  await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "office_id");
  if (!id) redirect("/company");
  const { error } = await supabase.from("company_offices").delete().eq("id", id);
  if (error) fail(error.message);
  revalidatePath("/company");
  redirect("/company?saved=office#offices");
}
