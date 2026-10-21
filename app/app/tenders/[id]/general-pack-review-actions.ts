"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/**
 * Tenant check, same pattern as pack-review-actions.ts's own requireCompanyId
 * (repo convention - each actions.ts-shaped file in this directory keeps its
 * own copy, see pack-inputs-actions.ts's own header comment).
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
  return { companyId: membership.company_id as string, userId: user.id };
}

/**
 * "I've reviewed this" on the general-tender Pack Review card
 * (general-pack-review.tsx) - the non-SANRAL equivalent of
 * pack-review-actions.ts's confirmPackReview(). Writes to the SAME
 * pack_review_confirmations table (migration 0059): its schema is just
 * (company_id, tender_id), not SANRAL-specific, so it is reused as-is rather
 * than adding a parallel table. Kept as its own action (not a call into
 * pack-review-actions.ts) only because the redirect anchor differs
 * (#general-pack-review vs #pack-review) and that file is SANRAL-only by
 * convention - the row it writes is identical either way.
 * requestGeneralPack() (general-actions.ts) requires this row to exist
 * before it will queue a general pack job.
 */
export async function confirmGeneralPackReview(formData: FormData) {
  const { companyId, userId } = await requireCompanyId();
  const supabase = await createClient();

  const tenderId = formData.get("tender_id") as string | null;
  if (!tenderId) redirect("/tenders");

  const { error } = await supabase.from("pack_review_confirmations").upsert(
    { company_id: companyId, tender_id: tenderId, reviewed_at: new Date().toISOString(), reviewed_by: userId },
    { onConflict: "company_id,tender_id" },
  );
  if (error) {
    console.error("pack_review_confirmations upsert failed", error);
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("Could not save this review - try again. If it keeps happening, let us know.")}#general-pack-review`);
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}?saved=general_pack_review#general-pack-review`);
}
