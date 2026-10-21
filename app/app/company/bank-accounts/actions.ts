"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Bank accounts (0050 bank_accounts) - owners and admins only, enforced by
// RLS (tt_is_company_admin). No message here ever contains an account number.

const BACK = "/company/bank-accounts";
const ACCOUNT_TYPES = ["cheque", "current", "savings", "transmission", "other"];

async function requireCompanyId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("company_members").select("company_id, role").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  if (membership.role !== "owner" && membership.role !== "admin") fail("Only an owner or admin of the company can manage bank accounts.");
  return membership.company_id as string;
}

function fail(message: string): never {
  redirect(`${BACK}?error=${encodeURIComponent(message)}`);
}

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

export async function saveBankAccount(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "account_id");
  const principalId = str(formData, "principal_id");
  const number = str(formData, "account_number")?.replace(/[\s-]/g, "") ?? null;
  if (number !== null && !/^[0-9]{6,16}$/.test(number)) fail("The account number must be 6 to 16 digits.");
  if (!id && !number) fail("Enter the account number.");
  const bankName = str(formData, "bank_name");
  const holder = str(formData, "account_holder");
  if (!bankName || !holder) fail("Enter the bank and the account holder's name.");
  const type = str(formData, "account_type");
  if (type && !ACCOUNT_TYPES.includes(type)) fail("Unknown account type.");

  const row: Record<string, unknown> = {
    company_id: companyId,
    principal_id: principalId,
    bank_name: bankName,
    branch_name: str(formData, "branch_name"),
    branch_code: str(formData, "branch_code"),
    account_holder: holder,
    account_type: type,
    opened_on: str(formData, "opened_on"),
  };
  // Empty on an edit = keep the number on file (the form never echoes it).
  if (number) row.account_number = number;

  const { error } = id
    ? await supabase.from("bank_accounts").update(row).eq("id", id)
    : await supabase.from("bank_accounts").insert(row);
  if (error) {
    const known = error.message.includes("bank_accounts_one_") || error.message.includes("account_number");
    // Not logging error.message itself for the unknown case - this file's
    // own rule above is that no message here ever contains an account
    // number, and an unrecognised Postgres error is exactly the case this
    // function can't already prove is safe to echo or log.
    if (!known) console.error("bank_accounts write failed with an unrecognised error (message withheld, see rule above)");
    fail(
      error.message.includes("bank_accounts_one_")
        ? "There is already an account on file for this holder - edit that one."
        : error.message.includes("account_number")
          ? "The account number must be 6 to 16 digits."
          : "Could not save this bank account - try again. If it keeps happening, let us know.",
    );
  }
  revalidatePath(BACK);
  redirect(`${BACK}?saved=1`);
}

export async function deleteBankAccount(formData: FormData) {
  await requireCompanyId();
  const supabase = await createClient();
  const id = str(formData, "account_id");
  if (!id) redirect(BACK);
  const { error } = await supabase.from("bank_accounts").delete().eq("id", id);
  if (error) {
    console.error("bank_accounts delete failed");
    fail("Could not delete this bank account - try again. If it keeps happening, let us know.");
  }
  revalidatePath(BACK);
  redirect(`${BACK}?saved=removed`);
}
