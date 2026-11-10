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

  const { data: membership, error: membershipError } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) throw new Error("Couldn't verify your company - try again.");
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

  // .select("id").maybeSingle() matters here exactly as it does on
  // company/officeActions.ts's deleteCompanyOffice() (Finding 322, same bug
  // class): "tender_comments: authors delete their own notes" (0033) is
  // USING-only (is_company_member(company_id) and author_id = auth.uid()),
  // re-evaluated against the row at delete time - so a membership-revoked-
  // mid-request race makes a zero-row-match delete indistinguishable from a
  // real one by `error` alone. Without this check, a delete silently
  // blocked by RLS still redirected to #activity with no ?error, telling the
  // user the note was gone when it was not.
  const { data: deleted, error } = await supabase
    .from("tender_comments")
    .delete()
    .eq("id", commentId)
    .eq("author_id", userId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("tender_comments delete failed", error);
    redirect(`${back}?error=${encodeURIComponent("Could not delete the note - try again. If it keeps happening, let us know.")}#activity`);
  }
  if (!deleted) {
    redirect(`${back}?error=${encodeURIComponent("That note is no longer there - it may have already been removed. Refresh and try again.")}#activity`);
  }

  revalidatePath(back);
  redirect(`${back}#activity`);
}
