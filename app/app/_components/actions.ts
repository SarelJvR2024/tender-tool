"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { clearImpersonationCookie, readImpersonationCookie } from "@/lib/impersonation";

// Used by AppSidebar's own account menu (moved here from the topbar in the
// Phase 2 nav restructure, 2026-10-23) - there was no way to sign out
// anywhere in the app before this (found by a live walkthrough, 2026-10-19).
//
// Finding 357 (standing review pass, 2026-11-10): this used to call plain
// createClient() (no bypass) - which, whenever the tt_impersonation cookie
// is present, swaps in the IMPERSONATED client (lib/supabase/server.ts): a
// throwaway, non-cookie-backed supabase-js instance (persistSession: false,
// no @supabase/ssr cookie sync at all - see lib/impersonation.ts's own
// header). Calling .auth.signOut() on THAT client never touches the real
// admin's own sb-* cookies, nor the tt_impersonation cookie itself - so
// clicking "Sign out" (AppSidebar's account menu, rendered on every
// signed-in page regardless of impersonation state) while impersonating
// silently signed out nothing real: both the admin's actual session and the
// open impersonation session survived the redirect to /login, and the next
// person on that browser would silently inherit the still-live impersonated
// session for up to IMPERSONATION_MAX_AGE_SECONDS. Fixed: always sign out
// the REAL signed-in identity (bypassImpersonation: true), and close out any
// open impersonation session (audit row + cookie) first - the same
// bookkeeping endImpersonation() (impersonation-actions.ts) already does on
// its own "Exit impersonation" path. Signing out should always end
// impersonation too, never leave it dangling.
export async function signOut() {
  const supabase = await createClient({ bypassImpersonation: true });

  const impersonation = await readImpersonationCookie();
  if (impersonation) {
    const { error } = await supabase.rpc("platform_admin_end_impersonation", { p_audit_log_id: impersonation.auditLogId });
    if (error) console.error("platform_admin_end_impersonation failed while signing out", error);
    await clearImpersonationCookie();
  }

  await supabase.auth.signOut();
  redirect("/login");
}
