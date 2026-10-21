"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/**
 * "Accept the document's date" on the "This tender has been updated" card.
 * The tender-update watch never applies a date the buyer's listing doesn't
 * show (0039); a person can, after checking the addendum. Everything - who may
 * accept (a company working on this tender), the writes (tenders, every
 * company's milestone, Discovery rows - the same ones the watch's automatic
 * path makes) and the record of who accepted it and when - is done by
 * accept_tender_update_date() (0048) in one transaction, so nothing here can
 * half-apply it.
 */
export async function acceptTenderUpdateDate(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenderId = formData.get("tender_id") as string | null;
  const documentId = formData.get("watched_document_id") as string | null;
  const change = formData.get("change") as string | null;
  if (!tenderId) redirect("/tenders");
  if (!documentId || (change !== "closing_date" && change !== "briefing")) {
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("Nothing to accept.")}#tender-updates`);
  }

  const { error } = await supabase.rpc("accept_tender_update_date", {
    p_watched_document_id: documentId,
    p_change: change,
  });
  if (error) {
    console.error("accept_tender_update_date rpc failed", error);
    redirect(`/tenders/${tenderId}?error=${encodeURIComponent("Could not accept this update - try again. If it keeps happening, let us know.")}#tender-updates`);
  }

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/discovery");
  revalidatePath("/pipeline");
  redirect(`/tenders/${tenderId}#tender-updates`);
}
