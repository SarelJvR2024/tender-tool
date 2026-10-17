"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isPipelineStage } from "@/lib/pipeline";

/**
 * Moves one tender to a pipeline stage for the signed-in user's company
 * (tender_packs.pipeline_stage, migration 0021). Upserts on
 * (company_id, tender_id): a SANRAL feed tender this company hasn't touched
 * yet has no tender_packs row, so its first move creates one (status left at
 * its 'suggested' default - the key-person confirm gate is untouched).
 * stage_changed_at / submitted_at are stamped by the DB trigger, not here.
 */
export async function moveTenderStage(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) redirect("/onboarding");

  const tenderId = formData.get("tender_id");
  const stage = formData.get("stage");
  if (typeof tenderId !== "string" || !tenderId || !isPipelineStage(stage)) {
    redirect(`/pipeline?error=${encodeURIComponent("Unknown tender or stage.")}`);
  }

  const { error } = await supabase
    .from("tender_packs")
    .upsert(
      { company_id: membership.company_id as string, tender_id: tenderId, pipeline_stage: stage },
      { onConflict: "company_id,tender_id" }
    );
  if (error) redirect(`/pipeline?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/pipeline");
  revalidatePath(`/tenders/${tenderId}`);
  redirect("/pipeline");
}
