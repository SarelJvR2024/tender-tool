"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isPipelineStage } from "@/lib/pipeline";
import { isPriceSector, parsePercent, parseRand } from "@/lib/dealEconomics";

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
  if (error) {
    console.error("tender_packs upsert failed for pipeline stage", error);
    redirect(`/pipeline?error=${encodeURIComponent("Could not move this tender - try again. If it keeps happening, let us know.")}`);
  }

  revalidatePath("/pipeline");
  revalidatePath(`/tenders/${tenderId}`);
  redirect("/pipeline");
}

/**
 * Records (or corrects) the company's own submitted price, who gets credit
 * for the submission, and any commission tied to that person (items 26/27,
 * migration 0034) on this company's tender_packs row. Editable any time:
 * the final price often differs from the first figure captured. A blank
 * price clears it. The credited person must be in this company (0034's
 * trigger re-checks that). Only offered once a pack row exists (bidding or
 * later), so this is an update, never an insert.
 */
export async function saveTenderEconomics(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) redirect("/onboarding");

  const back = formData.get("return_to") === "pricing" ? "/pipeline/pricing" : "/pipeline";
  const fail: (msg: string) => never = (msg) => redirect(`${back}?error=${encodeURIComponent(msg)}`);

  const tenderId = formData.get("tender_id");
  if (typeof tenderId !== "string" || !tenderId) fail("Unknown tender.");

  const price = parseRand(formData.get("price"));
  if (price === null) fail("Submitted price must be a rand amount, e.g. 1 250 000 or 1250000.00.");

  const kind = formData.get("commission_kind");
  const commissionRaw = formData.get("commission_value");
  let commissionPercent: number | null = null;
  let commissionAmount: number | null = null;
  if (kind === "percent") {
    const p = parsePercent(commissionRaw);
    if (p === null) fail("Commission percentage must be between 0 and 100.");
    commissionPercent = p ?? null;
  } else if (kind === "amount") {
    const a = parseRand(commissionRaw);
    if (a === null) fail("Commission amount must be a rand amount.");
    commissionAmount = a ?? null;
  }

  const personId = formData.get("person_id");
  const sector = formData.get("sector");
  const text = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const { data, error } = await supabase
    .from("tender_packs")
    .update({
      submitted_price_zar: price ?? null,
      submitted_price_incl_vat: formData.get("incl_vat") !== "excl",
      submitted_by_person_id: typeof personId === "string" && personId ? personId : null,
      commission_percent: commissionPercent,
      commission_amount_zar: commissionAmount,
      commission_note: text("commission_note"),
      price_sector: isPriceSector(sector) ? sector : null,
      price_note: text("price_note"),
      price_recorded_at: new Date().toISOString(),
    })
    .eq("company_id", membership.company_id as string)
    .eq("tender_id", tenderId as string)
    .select("id");
  if (error) {
    console.error("tender_packs update failed for tender economics", error);
    fail("Could not save this pricing - try again. If it keeps happening, let us know.");
  }
  if (!data || data.length === 0) fail("This tender isn't on your pipeline yet - start bidding on it first.");

  revalidatePath("/pipeline");
  revalidatePath("/pipeline/pricing");
  redirect(back);
}
