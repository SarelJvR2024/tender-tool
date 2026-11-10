"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkPlan, parsePlan } from "@/lib/sanralB7";

/**
 * Save / clear the company's own answer to SANRAL Form B7 for this tender
 * (tender_subcontracting_plans, migration 0056). Invalid answers are refused
 * with the same errors the pack builder would give (app/lib/sanralB7.ts =
 * engine/sanral_b7.py), so a saved plan is always one the form can take.
 */

async function requireMember() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership, error: membershipError } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (membershipError) throw new Error("Couldn't verify your company - try again.");
  if (!membership) redirect("/onboarding");
  return { companyId: membership.company_id as string, userId: user.id };
}

export async function saveSubcontractingPlan(formData: FormData) {
  const { companyId, userId } = await requireMember();
  const tenderId = formData.get("tender_id") as string | null;
  if (!tenderId) redirect("/tenders");
  const back = (q: string) => redirect(`/tenders/${tenderId}?${q}#form-b7`);

  let raw: unknown = null;
  try {
    raw = JSON.parse((formData.get("plan") as string | null) ?? "null");
  } catch {
    raw = null;
  }
  const plan = parsePlan(raw);
  if (!plan) back(`error=${encodeURIComponent("Choose whether you will subcontract or the tender waives Form B7.")}`);
  const { errors } = checkPlan(plan);
  if (errors.length > 0) back(`error=${encodeURIComponent(`Form B7 not saved: ${errors.join("; ")}.`)}`);

  const supabase = await createClient();
  const { error } = await supabase.from("tender_subcontracting_plans").upsert(
    {
      company_id: companyId,
      tender_id: tenderId,
      mode: plan!.mode,
      waiver_quote: plan!.waiver_quote,
      targeted_enterprises: plan!.targeted_enterprises,
      comments: plan!.comments,
      answered_by: userId,
    },
    { onConflict: "company_id,tender_id" },
  );
  if (error) {
    console.error("tender_subcontracting_plans upsert failed", error);
    back(`error=${encodeURIComponent("Could not save Form B7 - try again. If it keeps happening, let us know.")}`);
  }

  revalidatePath(`/tenders/${tenderId}`);
  back("saved=b7");
}

export async function clearSubcontractingPlan(formData: FormData) {
  const { companyId } = await requireMember();
  const tenderId = formData.get("tender_id") as string | null;
  if (!tenderId) redirect("/tenders");
  const supabase = await createClient();
  // Finding 324 (standing review): same "plain delete twin discards a
  // zero-row RLS match" bug as Findings 322/323 and their siblings -
  // "tender_subcontracting_plans: tenant isolation" (0056) is `using
  // (is_company_member(company_id))`, the identical USING-only,
  // re-evaluated-at-write-time shape, so a membership revoked mid-request
  // makes this delete match zero rows with `error: null`. The "Clear this
  // answer" button (subcontracting-plan.tsx) only renders when a plan is
  // already saved (`{answered && (...)}`), so a zero-row match here is the
  // race, not a legitimate "nothing to clear" click. Pre-fix, this still
  // redirected "?saved=b7" unconditionally, telling the company its Form B7
  // answer was cleared when the old plan/waiver was still on file, silently
  // stale for engine/pack/process_pack_jobs.py's own B7 gate until the page
  // is reloaded.
  const { data: deletedPlan, error } = await supabase
    .from("tender_subcontracting_plans")
    .delete()
    .eq("company_id", companyId)
    .eq("tender_id", tenderId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("tender_subcontracting_plans delete failed", error);
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("Could not clear Form B7 - try again. If it keeps happening, let us know.")}#form-b7`);
  }
  if (!deletedPlan) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("This Form B7 answer is no longer there - refresh and try again.")}#form-b7`);
  }
  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}?saved=b7#form-b7`);
}
