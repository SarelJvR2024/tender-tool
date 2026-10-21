"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { buildCompanyUpdate } from "@/lib/companyProfileUpdate";
import { PROVINCES, OFFICE_KINDS } from "@/lib/locality";
import { safeFileName } from "@/lib/safeFileName";
import { sendTransactionalEmail } from "@/lib/resendEmail";
import { welcomeEmail } from "@/lib/emailTemplates";
import { siteUrl } from "@/lib/siteUrl";

/**
 * The 5-step onboarding wizard's own actions - thin, redirect-to-the-next-
 * step wrappers around the SAME tables, columns and validation the rest of
 * the app already uses (buildCompanyUpdate for companies, the same
 * company_offices/people/cv_uploads shapes saveCompanyOffice/savePerson/
 * uploadCv write), not a parallel data model. They're separate functions
 * from those, not the literal same ones, only because every existing action
 * in this codebase ends with a hardcoded `redirect()` to its own page
 * (/company, /people/[id]) - reusing them as-is would bounce a wizard step
 * straight out of the wizard. See app/AGENTS.md ("Auth + onboarding").
 */

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

/** Step 1: creates the company (the one privileged path - see 0003_onboarding.sql) and saves trading name / registration number in the same step. */
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

  // Trading name / registration number are optional on this same step - both
  // are already-existing companies columns (buildCompanyUpdate), just saved
  // right after the row is created rather than left for step 2.
  const { update } = buildCompanyUpdate(formData);
  if (Object.keys(update).length > 0) {
    const { error: updateError } = await supabase.from("companies").update(update).eq("id", companyId);
    if (updateError) console.error("companies update failed after create (onboarding step 1)", updateError);
  }

  // Welcome email - sent once, here, since this is the one moment a company
  // (and its trial, via the companies_start_trial trigger - migration 0078)
  // is actually created. Never blocks/fails the wizard: a Resend outage or
  // missing RESEND_API_KEY (lib/resendEmail.ts logs and no-ops) must never
  // stop someone from completing onboarding.
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

/** Step 2: compliance fields - CSD number, SARS tax PIN + expiry, B-BBEE level + proof expiry. Same columns/validation as the company edit form (buildCompanyUpdate). */
export async function saveComplianceStep(companyId: string, formData: FormData) {
  const supabase = await createClient();
  const { update, error: validationError } = buildCompanyUpdate(formData);
  if (validationError) {
    redirect(`/onboarding?step=2&error=${encodeURIComponent(validationError)}`);
  }
  const { error } = await supabase.from("companies").update(update).eq("id", companyId);
  if (error) {
    console.error("companies update failed (onboarding step 2)", error);
    redirect(`/onboarding?step=2&error=${encodeURIComponent("Could not save - try again. If it keeps happening, let us know.")}`);
  }
  revalidatePath("/onboarding");
  redirect("/onboarding?step=3");
}

/** Step 3: one office location - same company_offices columns/validation as app/company/officeActions.ts saveCompanyOffice. */
export async function saveOfficeStep(companyId: string, formData: FormData) {
  const supabase = await createClient();

  const province = str(formData, "province");
  if (!province || !(PROVINCES as readonly string[]).includes(province)) {
    redirect(`/onboarding?step=3&error=${encodeURIComponent("Choose the office's province.")}`);
  }
  const officeKind = str(formData, "office_kind") ?? "branch";
  if (!OFFICE_KINDS.some((k) => k.value === officeKind)) {
    redirect(`/onboarding?step=3&error=${encodeURIComponent("Unknown office type.")}`);
  }

  const { error } = await supabase.from("company_offices").insert({
    company_id: companyId,
    label: str(formData, "label"),
    office_kind: officeKind,
    province,
    district_municipality: str(formData, "district_municipality"),
    local_municipality: str(formData, "local_municipality"),
    town: str(formData, "town"),
  });
  if (error) {
    console.error("company_offices insert failed (onboarding step 3)", error);
    redirect(`/onboarding?step=3&error=${encodeURIComponent("Could not save this office - try again. If it keeps happening, let us know.")}`);
  }
  revalidatePath("/onboarding");
  redirect("/onboarding?step=3");
}

/** Step 4: add one person (name + role) - a subset of people/actions.ts savePerson's row shape; the rest of that row stays null, filled in later on their People page. */
export async function addPersonStep(companyId: string, formData: FormData) {
  const supabase = await createClient();

  const name = str(formData, "name");
  if (!name) {
    redirect(`/onboarding?step=4&error=${encodeURIComponent("Enter a name.")}`);
  }

  const { error } = await supabase.from("people").insert({
    company_id: companyId,
    name,
    role: str(formData, "role"),
  });
  if (error) {
    console.error("people insert failed (onboarding step 4)", error);
    redirect(`/onboarding?step=4&error=${encodeURIComponent("Could not save this person - try again. If it keeps happening, let us know.")}`);
  }
  revalidatePath("/onboarding");
  redirect("/onboarding?step=4");
}

/** Step 4 (optional): attach a CV to a person just added - same storage bucket/path shape and "as_is" mode as people/actions.ts uploadCv, just without that action's redirect to /people/[id]. */
export async function uploadPersonCvStep(companyId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const personId = str(formData, "person_id");
  const file = formData.get("file") as File | null;
  if (!personId || !file || file.size === 0) {
    redirect(`/onboarding?step=4&error=${encodeURIComponent("Choose a CV file to upload.")}`);
  }

  const safeName = safeFileName(file.name);
  const storagePath = `${companyId}/people/${personId}/uploads/${randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("cv-documents")
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (uploadError) {
    console.error("cv upload failed (onboarding step 4)", file.name, uploadError);
    redirect(`/onboarding?step=4&error=${encodeURIComponent(`Could not upload ${file.name} - try again. If it keeps happening, let us know.`)}`);
  }

  const { error: insertError } = await supabase.from("cv_uploads").insert({
    company_id: companyId,
    person_id: personId,
    storage_path: storagePath,
    original_filename: file.name,
    mode: "as_is",
    status: "uploaded",
    uploaded_by: user?.id ?? null,
  });
  if (insertError) {
    console.error("cv_uploads insert failed (onboarding step 4)", insertError);
    redirect(`/onboarding?step=4&error=${encodeURIComponent("Could not save this CV - try again. If it keeps happening, let us know.")}`);
  }
  revalidatePath("/onboarding");
  redirect("/onboarding?step=4");
}

/** Step 5: the only real field this step has today (preferred buyers / value range don't exist yet - see app/AGENTS.md) - same RPC app/company/digestActions.ts setDailyDigestOptIn calls. */
export async function saveNotificationStep(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const optIn = formData.get("opt_in") === "true";
  const { error } = await supabase.rpc("set_my_daily_digest_opt_in", { p_opt_in: optIn });
  if (error) {
    console.error("set_my_daily_digest_opt_in rpc failed (onboarding step 5)", error);
    redirect(`/onboarding?step=5&error=${encodeURIComponent("Could not save your email preference - try again. If it keeps happening, let us know.")}`);
  }
  revalidatePath("/onboarding");
  redirect("/onboarding?step=6");
}
