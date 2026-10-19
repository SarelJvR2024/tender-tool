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

/**
 * System alerts (migration 0042): Sarel marks an engine/bridge failure
 * resolved once it is fixed (or reopens it). Same shape as the harness
 * review above: migration 0042 grants authenticated users UPDATE on only the
 * three resolution columns, and its RLS policy limits that to company owners
 * with resolved_by pinned to the signed-in user. Checked here too, since a
 * Server Action is reachable by direct POST. A resolved alert is never
 * reported again by engine/alerts/check_system_alerts.py; the same failure
 * happening later is recorded as a new alert.
 */
async function writeAlertResolution(formData: FormData, resolved: boolean) {
  const alertId = String(formData.get("alert_id") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 4000);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!alertId) redirect(`/admin?error=${encodeURIComponent("Missing system alert.")}#system-alerts`);

  const { data, error } = await supabase
    .from("system_alerts")
    .update(
      resolved
        ? { resolved_at: new Date().toISOString(), resolved_by: user.id, resolution_note: note || null }
        : { resolved_at: null, resolved_by: null, resolution_note: null },
    )
    .eq("id", alertId)
    .select("id");
  if (error) {
    // Reopening while the same failure already has a newer open alert hits
    // the one-open-alert-per-fingerprint index - say so plainly.
    const message = error.code === "23505"
      ? "This failure has happened again since and already has a newer open alert - review that one instead."
      : error.message;
    redirect(`/admin?error=${encodeURIComponent(message)}#system-alerts`);
  }
  if (!data || data.length === 0) {
    redirect(`/admin?error=${encodeURIComponent("Only a company owner can resolve system alerts.")}#system-alerts`);
  }
  revalidatePath("/admin");
}

export async function markSystemAlertResolved(formData: FormData) {
  await writeAlertResolution(formData, true);
}

export async function reopenSystemAlert(formData: FormData) {
  await writeAlertResolution(formData, false);
}

/**
 * Customer console (0064): toggling a company's is_test_company flag and
 * flipping a platform setting both go through a SECURITY DEFINER function
 * gated on is_platform_admin() rather than a table write, so neither needs
 * its own RLS policy on companies / platform_settings (see 0064's comment).
 */
export async function setTestCompany(formData: FormData) {
  const companyId = String(formData.get("company_id") ?? "");
  const isTest = formData.get("is_test") === "true";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!companyId) redirect(`/admin/customers?error=${encodeURIComponent("Missing company.")}`);

  const { error } = await supabase.rpc("platform_admin_set_test_company", { p_company_id: companyId, p_is_test: isTest });
  if (error) redirect(`/admin/customers?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/admin/customers");
}

export async function setPlatformSetting(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  const value = formData.get("value") === "true";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!key) redirect(`/admin/settings?error=${encodeURIComponent("Missing setting.")}`);

  const { error } = await supabase.rpc("platform_admin_set_setting", { p_key: key, p_value: value });
  if (error) redirect(`/admin/settings?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/admin/settings");
}
