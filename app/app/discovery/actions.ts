"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * "Prepare this tender": turns a discovered eTenders opportunity into a
 * Tender Workspace tender via pursue_discovered_opportunity() (migration
 * 0018) - creates or reuses the shared tenders row (by OCDS ocid), this
 * company's tender_pack, and queues the requirements-extraction job that reads
 * the tender's own documents. The function checks membership itself.
 */
export async function pursueOpportunity(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const opportunityId = formData.get("opportunity_id") as string | null;
  if (!opportunityId) redirect("/discovery");

  const { data: tenderId, error } = await supabase.rpc("pursue_discovered_opportunity", { p_opportunity_id: opportunityId });
  if (error || !tenderId) {
    redirect(`/discovery?error=${encodeURIComponent(error?.message ?? "Could not open this tender.")}`);
  }
  redirect(`/tenders/${tenderId as string}#general-preparation`);
}
