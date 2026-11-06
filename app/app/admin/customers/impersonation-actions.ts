"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { mintTargetSession, setImpersonationCookie, clearImpersonationCookie, readImpersonationCookie } from "@/lib/impersonation";

/**
 * "View Tenant Workspace" (Admin Command Center Phase 4). Both Server
 * Actions here use `createClient({ bypassImpersonation: true })` - this is
 * inherently "the real admin's own identity" territory (starting or ending
 * a session), never something that should run under an already-active
 * impersonation session (which, in practice, can't reach this page at all -
 * /admin/layout.tsx's own is_platform_admin() guard already locks out
 * anyone signed in as an ordinary company member, impersonated or not).
 */
export async function startImpersonation(formData: FormData) {
  const companyId = String(formData.get("company_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const supabase = await createClient({ bypassImpersonation: true });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!companyId) redirect(`/admin/customers?error=${encodeURIComponent("Missing company.")}`);

  const { data, error } = await supabase.rpc("platform_admin_start_impersonation", {
    p_company_id: companyId,
    p_reason: reason || "Admin Diagnostics",
  });
  if (error || !data?.[0]) {
    console.error("platform_admin_start_impersonation rpc failed", error);
    redirect(`/admin/customers?error=${encodeURIComponent("Could not start impersonation - try again. If it keeps happening, let us know.")}`);
  }
  const { audit_log_id, target_email } = data[0];

  const minted = await mintTargetSession(target_email);
  if (!minted.ok) {
    // The audit row was already opened before we knew session minting would
    // fail - close it now rather than leave an open row for a session that
    // never actually started, which would misrepresent "an impersonation
    // happened" when nothing was ever viewed. Logged, not surfaced: the
    // admin is about to see minted.error regardless, and this is best-effort
    // audit-log cleanup, not something to layer a second error message onto.
    const { error: closeOnFailError } = await supabase.rpc("platform_admin_end_impersonation", { p_audit_log_id: audit_log_id });
    if (closeOnFailError) console.error("platform_admin_end_impersonation failed while cleaning up a failed mint", closeOnFailError);
    redirect(`/admin/customers?error=${encodeURIComponent(minted.error)}`);
  }

  await setImpersonationCookie({ auditLogId: audit_log_id, accessToken: minted.accessToken, refreshToken: minted.refreshToken });
  redirect("/dashboard");
}

/**
 * Guardrail 4's own wording asks for a redirect to "/admin/customers/[id]" -
 * this codebase has no such route (a company's own detail view is the
 * expand panel on /admin/customers itself, not a separate page - see
 * CustomerRow.tsx). Adapted faithfully to what actually exists:
 * ?company=<id> on the real listing page, which auto-expands that one row
 * (see page.tsx/CustomerRow.tsx) - lands the admin back on that exact
 * company's own context, same intent, no fabricated route.
 */
export async function endImpersonation() {
  const cookiePayload = await readImpersonationCookie();
  await clearImpersonationCookie();

  if (cookiePayload) {
    const supabase = await createClient({ bypassImpersonation: true });
    // Neither read below is re-checked by anything downstream of this
    // function (the session itself already ended above, by clearing the one
    // cookie that carried it - this is audit-trail bookkeeping only), so a
    // transient failure on either is logged, not surfaced: the admin still
    // gets a correct "you're out" redirect either way, just without the
    // row's own ended_at necessarily set or the ?company= row highlighted.
    const { data, error: readError } = await supabase
      .from("impersonation_audit_logs")
      .select("target_company_id")
      .eq("id", cookiePayload.auditLogId)
      .maybeSingle();
    if (readError) console.error("impersonation_audit_logs read failed while ending impersonation", readError);
    const { error: endError } = await supabase.rpc("platform_admin_end_impersonation", { p_audit_log_id: cookiePayload.auditLogId });
    if (endError) console.error("platform_admin_end_impersonation failed while ending impersonation", endError);
    if (data?.target_company_id) {
      redirect(`/admin/customers?company=${data.target_company_id}`);
    }
  }
  redirect("/admin/customers");
}
