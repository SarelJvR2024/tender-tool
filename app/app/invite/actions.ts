"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * Accept a /invite/<token> link (0065 company_invites). All the real work -
 * checking the token, joining company_members, linking people.linked_user_id
 * - happens inside redeem_company_invite() (SECURITY DEFINER), so a direct
 * client read of company_invites is never needed; this action only calls
 * the RPC and turns its result/error into a redirect.
 */
export async function acceptInvite(formData: FormData) {
  const token = (formData.get("token") as string | null)?.trim();
  if (!token) redirect("/dashboard");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const { error } = await supabase.rpc("redeem_company_invite", { p_token: token });
  if (error) {
    redirect(`/invite/${token}?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/dashboard?joined=1");
}
