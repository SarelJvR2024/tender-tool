"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

const MAX_NOTE_LENGTH = 4000; // tender_comments.body check constraint (0033)

/** Same tenant check as actions.ts's own requireCompanyId (per-file copy, the codebase's convention). */
async function requireMember() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) redirect("/onboarding");
  return { supabase, userId: user.id, companyId: membership.company_id as string };
}

/** "Notes & activity" card: add a plain-text note to this tender (tender_comments, 0033). */
export async function addTenderComment(formData: FormData) {
  const { supabase, userId, companyId } = await requireMember();
  const tenderId = formData.get("tender_id") as string | null;
  const body = ((formData.get("body") as string | null) ?? "").trim();

  if (!tenderId) redirect("/tenders");
  const back = `/tenders/${tenderId}`;
  if (!body) redirect(`${back}?error=${encodeURIComponent("A note can't be empty.")}#activity`);
  if (body.length > MAX_NOTE_LENGTH) {
    redirect(`${back}?error=${encodeURIComponent(`A note can be at most ${MAX_NOTE_LENGTH} characters.`)}#activity`);
  }

  const { error } = await supabase.from("tender_comments").insert({
    company_id: companyId,
    tender_id: tenderId,
    author_id: userId,
    body,
  });
  if (error) {
    console.error("tender_comments insert failed", error);
    redirect(`${back}?error=${encodeURIComponent("Could not save the note - try again. If it keeps happening, let us know.")}#activity`);
  }

  revalidatePath(back);
  redirect(`${back}#activity`);
}

/** Delete one of your own notes. RLS (0033) refuses anyone else's; there is no edit. */
export async function deleteTenderComment(formData: FormData) {
  const { supabase, userId } = await requireMember();
  const tenderId = formData.get("tender_id") as string | null;
  const commentId = formData.get("comment_id") as string | null;
  if (!tenderId) redirect("/tenders");
  const back = `/tenders/${tenderId}`;
  if (!commentId) redirect(`${back}#activity`);

  const { error } = await supabase.from("tender_comments").delete().eq("id", commentId).eq("author_id", userId);
  if (error) {
    console.error("tender_comments delete failed", error);
    redirect(`${back}?error=${encodeURIComponent("Could not delete the note - try again. If it keeps happening, let us know.")}#activity`);
  }

  revalidatePath(back);
  redirect(`${back}#activity`);
}
