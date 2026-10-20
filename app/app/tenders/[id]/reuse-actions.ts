"use server";

// "Start from a previous submission" (feature item 9) - see
// app/lib/pastSubmissionReuse.ts for what is and isn't carried over, and why.

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { buildReusePlan } from "@/lib/pastSubmissionReuse";
import { confirmPositionPerson } from "./pack-inputs-actions";

const back = (tenderId: string, q: string) => `/tenders/${tenderId}${q}#reuse-past`;

export async function applyPastSubmission(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  const companyId = membership.company_id as string;

  const tenderId = formData.get("tender_id") as string | null;
  const sourceId = formData.get("source_tender_id") as string | null;
  if (!tenderId) redirect("/dashboard");
  if (!sourceId) redirect(back(tenderId, `?error=${encodeURIComponent("Choose a previous tender to start from.")}`));

  // Rebuilt here from the database, not taken from the preview the browser saw.
  const plan = await buildReusePlan(supabase, tenderId, sourceId);
  if (!plan) redirect(back(tenderId, `?error=${encodeURIComponent("That tender can't be used as a starting point for this one.")}`));

  if (plan.answers.copy.length > 0) {
    // ignoreDuplicates: an answer typed on this tender between the preview
    // and this click is never overwritten.
    const { error } = await supabase.from("tender_answers").upsert(
      plan.answers.copy.map((a) => ({ company_id: companyId, tender_id: tenderId, field_key: a.key, value: a.value, answered_by: user.id })),
      { onConflict: "company_id,tender_id,field_key", ignoreDuplicates: true },
    );
    if (error) {
      console.error("tender_answers upsert failed for reuse", error);
      redirect(back(tenderId, `?error=${encodeURIComponent("Could not copy those answers - try again. If it keeps happening, let us know.")}`));
    }
  }

  // Positions go through the same action the Key positions dropdown uses, so
  // the pack's confirmed status (confirm_pack.py's gate) is recomputed by the
  // one piece of code that owns it. Clicking "Use these" on the preview is the
  // human confirmation; the person who clicked is recorded as confirmed_by.
  if (plan.targetPackId) {
    for (const p of plan.positions.copy) {
      await confirmPositionPerson(tenderId, plan.targetPackId, p.code, p.personId);
    }
  }

  revalidatePath(`/tenders/${tenderId}`);
  redirect(back(tenderId, `?saved=reuse&reused=${plan.answers.copy.length}.${plan.positions.copy.length}`));
}
