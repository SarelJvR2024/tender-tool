"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/**
 * Tenant check, same pattern as actions.ts's own requireCompanyId - each
 * actions.ts-shaped file in this directory keeps its own copy (repo
 * convention, see pack-inputs-actions.ts's own header comment).
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
 * "I've reviewed this" on the Pack Review card (pack-review.tsx) - the one
 * durable signal the pre-compile review step needs (pack_review_confirmations,
 * migration 0059). The snapshot itself (pack-review-data.ts) is always
 * recomputed live; this just upserts one row per (company, tender) recording
 * that a named human looked at it. requestSubmissionPack() (actions.ts)
 * requires this row to exist before it will queue a pack.
 */
export async function confirmPackReview(formData: FormData) {
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
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("Could not save this review - try again. If it keeps happening, let us know.")}#pack-review`);
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(`/tenders/${tenderId}?saved=pack_review#pack-review`);
}
