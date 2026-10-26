"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { DispatchStatus, SubmissionType } from "@/lib/dispatchTriage";

/**
 * Tender Command Center (Sarel's own brief, 2026-10-24): writes for
 * migration 0090's submission-logistics columns on tender_packs. Existing
 * RLS ("tender_packs: tenant isolation") already scopes every write here to
 * this company's own pack - no new policy needed, same as every other
 * tender_packs field this app already writes (pipeline_stage, status, ...).
 */

async function requireMember() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  return { companyId: membership.company_id as string };
}

const SUBMISSION_TYPES: SubmissionType[] = ["physical_box", "etenders_portal", "email", "other_digital"];
const DISPATCH_STATUSES: DispatchStatus[] = ["not_ready", "compiling", "print_ready", "printed_and_bound", "out_for_delivery", "submitted_and_receipted"];

/**
 * Full logistics form (Pack compiler tab): how this company will actually
 * submit this tender, and its own print/transit time estimates.
 */
export async function saveSubmissionLogistics(formData: FormData) {
  const { companyId } = await requireMember();
  const tenderId = formData.get("tender_id") as string | null;
  if (!tenderId) redirect("/tenders");
  const back = (q: string) => redirect(`/tenders/${tenderId}?${q}#pack-compiler`);

  const submissionType = formData.get("submission_type") as string | null;
  if (!submissionType || !SUBMISSION_TYPES.includes(submissionType as SubmissionType)) {
    back(`error=${encodeURIComponent("Choose a valid submission type.")}`);
  }
  const printHours = Number(formData.get("estimated_print_hours"));
  const transitHours = Number(formData.get("estimated_transit_hours"));
  if (!Number.isFinite(printHours) || printHours < 0 || !Number.isFinite(transitHours) || transitHours < 0) {
    back(`error=${encodeURIComponent("Print and transit hours must be real, non-negative numbers.")}`);
  }
  const deliveryLocation = ((formData.get("delivery_location") as string | null) ?? "").trim() || null;
  const courierContact = ((formData.get("courier_contact") as string | null) ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("tender_packs")
    .update({
      submission_type: submissionType,
      delivery_location: deliveryLocation,
      estimated_print_hours: printHours,
      estimated_transit_hours: transitHours,
      courier_contact: courierContact,
    })
    .eq("tender_id", tenderId)
    .eq("company_id", companyId);
  if (error) {
    console.error("tender_packs logistics update failed", error);
    back(`error=${encodeURIComponent("Could not save submission logistics - try again. If it keeps happening, let us know.")}`);
  }

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/dashboard");
  back("saved=logistics");
}

/**
 * Inline "advance to the next dispatch stage" - same tap-to-advance shape as
 * tender_tasks' own advanceTaskStatus (actions.ts), called directly from a
 * client component via startTransition(), not a <form> submit. Called from
 * both the Tender Workspace (Pack compiler tab) and the Dashboard's Lane C,
 * so it takes tenderId explicitly for revalidatePath rather than assuming
 * one page.
 */
export async function advanceDispatchStatus(tenderPackId: string, tenderId: string, currentStatus: DispatchStatus) {
  const { companyId } = await requireMember();
  const supabase = await createClient();

  const idx = DISPATCH_STATUSES.indexOf(currentStatus);
  const next = DISPATCH_STATUSES[Math.min(idx + 1, DISPATCH_STATUSES.length - 1)];

  const { error } = await supabase
    .from("tender_packs")
    .update({ dispatch_status: next })
    .eq("id", tenderPackId)
    .eq("company_id", companyId);
  if (error) console.error("tender_packs dispatch_status advance failed", error);

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/dashboard");
}
