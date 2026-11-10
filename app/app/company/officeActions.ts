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
  const { data: membership, error: membershipError } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (membershipError) throw new Error("Couldn't verify your company - try again.");
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

  if (id) {
    // .select("id").maybeSingle() matters: PostgREST returns a 2xx with
    // `error: null` and zero rows affected when RLS's own "company_offices:
    // tenant isolation" (0015, using (is_company_member(company_id))) no
    // longer matches - e.g. this user's own company_members row being
    // removed between page load and this write - indistinguishable from a
    // real update by `error` alone. Same shape, same fix, as this app's own
    // saveProperty()/savePrincipal()/saveHeldRegistration()/saveBankAccount()
    // (standing review, 2026-11-07) - this file's own plain update twin was
    // never swept for it until now.
    const { data, error } = await supabase.from("company_offices").update(row).eq("id", id).select("id").maybeSingle();
    if (error) {
      console.error("company_offices update failed", error);
      fail("Could not save this office - try again. If it keeps happening, let us know.");
    }
    if (!data) fail("That office is no longer there - it may have been removed. Refresh and try again.");
  } else {
    const { error } = await supabase.from("company_offices").insert(row);
    if (error) {
      console.error("company_offices insert failed", error);
      fail("Could not save this office - try again. If it keeps happening, let us know.");
    }
  }

  revalidatePath("/company");
  redirect("/company?saved=office#offices");
}

export async function deleteCompanyOffice(formData: FormData) {
  await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "office_id");
  if (!id) redirect("/company");
  // .select("id").maybeSingle() matters here exactly as it does on the
  // update branch above (see its own comment): "company_offices: tenant
  // isolation" (0015) is USING-only and re-evaluated against the row at
  // delete time, so the same membership-revoked-mid-request race makes a
  // zero-row-match delete indistinguishable from a real one by `error`
  // alone. This delete branch was missed when the update branch above was
  // swept for this (standing review, 2026-11-07) - without the check, a
  // delete silently blocked by RLS still redirected with `saved=office`,
  // telling the user the office was removed when it was not.
  const { data: deleted, error } = await supabase.from("company_offices").delete().eq("id", id).select("id").maybeSingle();
  if (error) {
    console.error("company_offices delete failed", error);
    fail("Could not delete this office - try again. If it keeps happening, let us know.");
  }
  if (!deleted) {
    fail("That office is no longer there - it may have been removed. Refresh and try again.");
  }
  revalidatePath("/company");
  redirect("/company?saved=office#offices");
}
