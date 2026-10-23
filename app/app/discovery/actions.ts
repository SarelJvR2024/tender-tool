"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

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
    if (error) console.error("pursue_discovered_opportunity rpc failed", error);
    redirect(`/discovery?error=${encodeURIComponent(error ? "Could not open this tender - try again. If it keeps happening, let us know." : "Could not open this tender.")}`);
  }
  redirect(`/tenders/${tenderId as string}#general-preparation`);
}

/**
 * "Mark as seen" on a re-assessed (downgraded) Discovery entry (migration
 * 0055). acknowledge_discovery_downgrade() checks membership and records who
 * and when - the 0048 accept pattern; discovered_opportunities itself has no
 * client update policy. The banner then becomes a small "was ..." marker.
 */
export async function acknowledgeDowngrade(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const opportunityId = formData.get("opportunity_id") as string | null;
  const raw = (formData.get("return_to") as string | null) ?? "/discovery";
  // Only back to our own pages (never an open redirect).
  const back = /^\/(discovery|tenders\/[0-9a-f-]{36})(\?[^#]*)?$/.test(raw) ? raw : "/discovery";
  if (!opportunityId) redirect(back);

  const { error } = await supabase.rpc("acknowledge_discovery_downgrade", { p_opportunity_id: opportunityId });
  const sep = back.includes("?") ? "&" : "?";
  if (error) {
    console.error("acknowledge_discovery_downgrade rpc failed", error);
    redirect(`${back}${sep}error=${encodeURIComponent("Could not mark this as seen - try again. If it keeps happening, let us know.")}`);
  }
  revalidatePath("/discovery");
  revalidatePath("/pipeline");
  if (back.startsWith("/tenders/")) revalidatePath(back.split("?")[0]);
  redirect(back.startsWith("/discovery") ? `${back}#opp-${opportunityId}` : `${back}#intake`);
}

export type OpportunityInterestMarker = "interested" | "declined" | null;

/**
 * Add/remove one of this company's own free-text tags on a Discovery row
 * (migration 0088, Sarel's own live feedback on /discovery, 2026-10-22).
 * Same reasoning as acknowledgeDowngrade above: discovered_opportunities has
 * no client update policy (0004 - "service-role written"), so this goes
 * through set_opportunity_tag(), a SECURITY DEFINER function that checks
 * is_company_member() itself and does the add/remove + normalisation
 * server-side. Called directly from OpportunityQuickActions inside
 * startTransition() - same "tap it, it persists" shape as
 * tenders/[id]/task-status-button.tsx - not a <form action>, so failures are
 * logged, not surfaced inline; a failed tag write just leaves the chip
 * unchanged on the next render; consistent with every other inline control in
 * this codebase (task-status-button.tsx, task-assignee-select.tsx).
 */
export async function setOpportunityTag(opportunityId: string, tag: string, action: "add" | "remove") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("set_opportunity_tag", {
    p_opportunity_id: opportunityId,
    p_tag: tag,
    p_action: action,
  });
  if (error) {
    console.error("set_opportunity_tag rpc failed", error);
    return;
  }
  revalidatePath("/discovery");
}

/**
 * Set (or clear, with null) this company's quick interest/decline mark on a
 * Discovery row (migration 0088). Same shape as setOpportunityTag above -
 * set_opportunity_interest() is the SECURITY DEFINER write path, since
 * discovered_opportunities itself still has no client update policy.
 */
export async function setOpportunityInterest(opportunityId: string, marker: OpportunityInterestMarker) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("set_opportunity_interest", {
    p_opportunity_id: opportunityId,
    p_marker: marker,
  });
  if (error) {
    console.error("set_opportunity_interest rpc failed", error);
    return;
  }
  revalidatePath("/discovery");
}
