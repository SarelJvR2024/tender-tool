"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildCompanyUpdate } from "@/lib/companyProfileUpdate";
import { sendTransactionalEmail } from "@/lib/resendEmail";
import { welcomeEmail } from "@/lib/emailTemplates";
import { siteUrl } from "@/lib/siteUrl";

/**
 * Onboarding's own actions (spec v3 §3: two short screens, not a 6-step
 * wizard - see app/AGENTS.md "Auth + onboarding" for the full history).
 * This file used to hold five more of these, one per old wizard step
 * (compliance fields, office location, people/CVs, notification
 * preferences, plan selection). All five are gone, not because that data
 * stopped mattering, but because every one of them already has a real,
 * non-onboarding home a company can fill in on its own time: compliance
 * fields and savings baseline in Company vault (CompanyIdentitySection.tsx,
 * BeeCidbSection.tsx, SavingsBaselineSection.tsx - same buildCompanyUpdate
 * this file still uses below), office location
 * (app/company/officeActions.ts), people/CVs (app/people/actions.ts),
 * the daily digest toggle (app/company/Notifications.tsx), and plan
 * selection (Billing, already reachable any time via the trial that starts
 * automatically on company creation - migration 0078). None of that needed
 * rebuilding; it only needed to stop being a forced sequential gate before
 * Home.
 */

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

/** Screen 1: creates the company (the one privileged path - see 0003_onboarding.sql) and saves trading name / registration number in the same step. */
export async function createCompanyBasics(formData: FormData) {
  const legalName = str(formData, "legal_name");
  if (!legalName) {
    redirect(`/onboarding?step=1&error=${encodeURIComponent("Company legal name is required.")}`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: companyId, error } = await supabase.rpc("create_company_and_join", { p_legal_name: legalName });
  if (error) {
    console.error("create_company_and_join rpc failed", error);
    redirect(`/onboarding?step=1&error=${encodeURIComponent("Could not create your company - try again. If it keeps happening, let us know.")}`);
  }

  // Trading name / registration number are optional on this same screen -
  // both are already-existing companies columns (buildCompanyUpdate), just
  // saved right after the row is created.
  const { update } = buildCompanyUpdate(formData);
  if (Object.keys(update).length > 0) {
    const { error: updateError } = await supabase.from("companies").update(update).eq("id", companyId);
    if (updateError) console.error("companies update failed after create (onboarding screen 1)", updateError);
  }

  // Welcome email - sent once, here, since this is the one moment a company
  // (and its trial, via the companies_start_trial trigger - migration 0078)
  // is actually created. Never blocks/fails onboarding: a Resend outage or
  // missing RESEND_API_KEY (lib/resendEmail.ts logs and no-ops) must never
  // stop someone from reaching Screen 2.
  if (user.email) {
    try {
      const { subject, html, text } = welcomeEmail({ companyName: legalName, appUrl: await siteUrl() });
      await sendTransactionalEmail({ to: user.email, subject, html, text });
    } catch (e) {
      console.error("Welcome email failed (non-fatal)", e);
    }
  }

  revalidatePath("/onboarding");
  redirect("/onboarding?step=2");
}
