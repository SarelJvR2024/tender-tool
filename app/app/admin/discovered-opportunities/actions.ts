"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const PAGE = "/admin/discovered-opportunities";

/**
 * Sarel's confidence override (scope addition, 2026-10-19): "I then need to
 * review and help improve the confidence levels." A plain correction + note
 * on one discovered_opportunities row (0072's
 * platform_admin_override_opportunity_confidence) - never recomputed over by
 * the engine, since the computed number lives in a different table entirely
 * (discovered_opportunity_requirements). Clearing uses the same action with
 * an empty level field.
 */
export async function overrideOpportunityConfidence(formData: FormData) {
  const opportunityId = String(formData.get("opportunity_id") ?? "");
  const levelRaw = String(formData.get("level") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!opportunityId) redirect(`${PAGE}?error=${encodeURIComponent("Missing opportunity.")}`);

  let level: number | null = null;
  if (levelRaw !== "") {
    const n = Number(levelRaw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      redirect(`${PAGE}?error=${encodeURIComponent("Confidence override must be a number between 0 and 100.")}`);
    }
    level = Math.round(n);
  }

  const { error } = await supabase.rpc("platform_admin_override_opportunity_confidence", {
    p_opportunity_id: opportunityId,
    p_override_level: level,
    p_note: note || null,
  });
  if (error) {
    console.error("platform_admin_override_opportunity_confidence rpc failed", error);
    redirect(`${PAGE}?error=${encodeURIComponent("Could not save this override - try again. If it keeps happening, let us know.")}`);
  }
  revalidatePath(PAGE);
}
