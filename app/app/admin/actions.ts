"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * Spec item 31's "mark reviewed": Sarel's record that a test-company run's
 * generated documents were looked at and are correct. Writes only the three
 * review columns - migration 0022 grants authenticated users UPDATE on just
 * those, and its RLS policy (0043) limits that to platform admins
 * with reviewed_by pinned to the signed-in user. Checked here too, since a
 * Server Action is reachable by direct POST.
 */
async function writeReview(formData: FormData, reviewed: boolean) {
  const runId = String(formData.get("run_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!runId) redirect(`/admin?error=${encodeURIComponent("Missing harness run.")}`);

  const { data, error } = await supabase
    .from("admin_harness_runs")
    .update(
      reviewed
        ? { reviewed_at: new Date().toISOString(), reviewed_by: user.id, review_note: note || null }
        : { reviewed_at: null, reviewed_by: null, review_note: null },
    )
    .eq("id", runId)
    .select("id");
  if (error) redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  // RLS filters a non-owner's update down to zero rows rather than erroring.
  if (!data || data.length === 0) {
    redirect(`/admin?error=${encodeURIComponent("Only a Tender Tool platform admin can review harness runs.")}`);
  }
  revalidatePath("/admin");
}

export async function markHarnessRunReviewed(formData: FormData) {
  await writeReview(formData, true);
}

export async function clearHarnessRunReview(formData: FormData) {
  await writeReview(formData, false);
}
