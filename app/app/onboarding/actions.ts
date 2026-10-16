"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * Server Action backing the onboarding form. Calls the create_company_and_join
 * RPC (supabase/migrations/0003_onboarding.sql) rather than inserting into
 * companies/company_members directly - neither table grants a client insert
 * policy, by design (see 0001's comment on companies).
 */
export async function createCompany(formData: FormData) {
  const legalName = (formData.get("legal_name") as string | null)?.trim();

  if (!legalName) {
    redirect("/onboarding?error=name_required");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("create_company_and_join", { p_legal_name: legalName });
  if (error) {
    redirect(`/onboarding?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/dashboard");
}
