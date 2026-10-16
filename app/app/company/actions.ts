"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * Fields the edit form is allowed to write. Deliberately excludes any bank
 * account number field - this schema never stores one (see 0001's comment
 * on the companies table) and this action must not add one back in.
 */
const TEXT_FIELDS = [
  "legal_name",
  "csd_trading_name",
  "cipc_registration_number",
  "vat_number",
  "income_tax_number",
  "paye_number",
  "csd_supplier_number",
  "coid_registration_number",
  "coid_letter_of_good_standing_number",
  "registered_address",
  "postal_address",
  "bank_name",
  "bank_branch_code",
  "status",
] as const;

const DATE_FIELDS = ["coid_letter_of_good_standing_expiry"] as const;

const NUMERIC_FIELDS = [
  "bee_level",
  "black_ownership_pct",
  "bee_procurement_recognition_pct",
] as const;

/**
 * Updates the signed-in user's company row. RLS's "companies: members can
 * update" policy (is_company_member(id)) gates this, so a plain client
 * update - no RPC needed - is correct and safe here.
 */
export async function updateCompanyProfile(companyId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const update: Record<string, string | number | null> = {};

  for (const field of TEXT_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const trimmed = (raw as string).trim();
    update[field] = trimmed === "" ? null : trimmed;
  }

  for (const field of DATE_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const trimmed = (raw as string).trim();
    update[field] = trimmed === "" ? null : trimmed;
  }

  for (const field of NUMERIC_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const trimmed = (raw as string).trim();
    update[field] = trimmed === "" ? null : Number(trimmed);
  }

  const { error } = await supabase.from("companies").update(update).eq("id", companyId);

  if (error) {
    redirect(`/company?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/company");
  redirect("/company?saved=1");
}
