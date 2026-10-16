"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/**
 * Tenant check, same pattern as app/app/people/actions.ts's own
 * requireCompanyId - each actions.ts file keeps its own copy rather than a
 * shared lib, matching the rest of this codebase's convention.
 */
async function requireCompanyId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) redirect("/onboarding");
  return membership.company_id as string;
}

/**
 * "Generate tender-specific CV" (Tender Workspace page) - integration point B
 * from Sarel's own direction (2026-10-16): for a key person already confirmed
 * on this tender's position (tender_pack_assignments.confirmed_person_id),
 * request the tender-customized CV with the requirement-matching cover page.
 *
 * Only ever records a request (generated_cvs, status 'requested') - the web
 * app cannot run engine/cv/generate_cv.py itself (no Python/LibreOffice on
 * Vercel). engine/cv/process_cv_jobs.py fulfills it out-of-band and builds
 * the cover page straight from this same tender_pack_assignments row's own
 * suggested_score/suggested_rationale (suggest_pack.py's own scoring, already
 * stored at confirm time) - never a new matcher.
 */
export async function requestTenderCv(formData: FormData) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const tenderId = formData.get("tender_id") as string | null;
  const tenderPackId = formData.get("tender_pack_id") as string | null;
  const positionCode = formData.get("position_code") as string | null;
  const personId = formData.get("person_id") as string | null;
  const format = (formData.get("format") as string | null) ?? "sanral_keyperson";
  const detail = (formData.get("detail") as string | null) ?? "summary";

  if (!tenderId) redirect("/tenders");
  if (!tenderPackId || !positionCode || !personId) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("Confirm a key person for this position before generating a tender-specific CV.")}`);
  }

  const { error } = await supabase.from("generated_cvs").insert({
    company_id: companyId,
    person_id: personId,
    tender_id: tenderId,
    tender_pack_id: tenderPackId,
    position_code: positionCode,
    format,
    detail,
    status: "requested",
    requested_by: user?.id ?? null,
  });
  if (error) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}`);
}

/**
 * "Looks right" affordance on an assumed_default field_provenance row.
 *
 * field_provenance has no reviewed_at (or similar) column yet, so there is
 * nowhere to persist a human's "I checked this, it's fine" signal. This is a
 * deliberate v1 simplification (see Tender Workspace build task, 2026-10-16):
 * wiring a real review state needs a small migration (e.g.
 * `alter table field_provenance add column reviewed_at timestamptz`, plus an
 * RLS-safe update policy) that's out of scope here. For now this action is a
 * no-op so the button has somewhere to call without lying about persistence.
 *
 * TODO(reviewed_at): once that column exists, make this an authenticated
 * update of the matching field_provenance row (by tender_pack_id + field_key)
 * and revalidate the tender workspace page.
 */
export async function markFieldReviewed(fieldKey: string): Promise<void> {
  void fieldKey; // kept in the signature for when reviewed_at lands - see TODO above.
}
