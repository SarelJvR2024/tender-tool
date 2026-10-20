"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * The "Email notifications" toggle on /company (migration 0073). Calls
 * set_my_daily_digest_opt_in() rather than a plain `.update()` on
 * company_members - that RPC is scoped to the signed-in user's own row by
 * auth.uid() server-side, so there is no company_id/user_id for this action
 * to pass (and nothing here that could be pointed at someone else's row).
 * Same per-user scoping pattern the rest of this codebase uses for narrow
 * self-service writes (see that migration's own comment on why this is an
 * RPC, not a new RLS update policy on the whole table).
 */
export async function setDailyDigestOptIn(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const optIn = formData.get("opt_in") === "true";

  const { error } = await supabase.rpc("set_my_daily_digest_opt_in", { p_opt_in: optIn });
  if (error) {
    console.error("set_my_daily_digest_opt_in rpc failed", error);
    redirect(`/company?error=${encodeURIComponent("Could not update your email preference - try again. If it keeps happening, let us know.")}#notifications`);
  }

  revalidatePath("/company");
  redirect("/company?saved=digest#notifications");
}
