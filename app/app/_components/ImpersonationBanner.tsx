import { createClient } from "@/lib/supabase/server";
import { readImpersonationCookie } from "@/lib/impersonation";
import { endImpersonation } from "../admin/customers/impersonation-actions";

type OpenImpersonationRow = {
  id: string;
  target_company_name: string;
  target_user_email: string;
  started_at: string;
};

/**
 * The persistent "Admin Support Mode" banner (Admin Command Center Phase 4,
 * guardrail 2) - rendered once, in the root layout, so it is unavoidable on
 * every page while an impersonation session is open. Deliberately reads the
 * REAL admin's own session (`{ bypassImpersonation: true }`), never the
 * swapped-in target-user session every other Server Component on the page
 * gets - this is the one place in the app that needs to know "who is
 * actually driving this browser" rather than "who does this page render
 * as". No dismiss/close button separate from Exit - guardrail 2 asks for
 * the banner to stay visible for the whole session; a hideable banner
 * while still impersonating would defeat the one thing it exists to
 * prevent (an admin forgetting which account they're acting as).
 */
export async function ImpersonationBanner() {
  const cookiePayload = await readImpersonationCookie();
  if (!cookiePayload) return null;

  const supabase = await createClient({ bypassImpersonation: true });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null; // the real admin's own session cookie is gone/expired - nothing to confirm against

  const { data, error } = await supabase
    .from("impersonation_audit_logs")
    .select("id, target_company_name, target_user_email, started_at")
    .eq("id", cookiePayload.auditLogId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) {
    // Standing review, 2026-11-06: this used to fall straight through to
    // the same `if (!row) return null` as a genuinely-ended/stale session -
    // silently hiding the ONE reminder this banner exists to give
    // (guardrail 2: "an admin forgetting which account they're acting as")
    // exactly when a real, still-open impersonation session needs it most,
    // on a transient read failure. No target name/email to show (not in
    // the cookie, and this read is what would have supplied them) - shown
    // cautiously instead of silently, since a safety reminder must fail
    // loud, not open, on an error it can't tell apart from "fine".
    console.error("impersonation_audit_logs select failed (ImpersonationBanner)", error);
    return (
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-warning px-4 py-2 text-center text-[13px] font-semibold text-warning-foreground">
        <span>{"⚠️"} Admin Support Mode may still be active - couldn&apos;t confirm details just now. Refresh, or exit if unsure.</span>
        <form action={endImpersonation}>
          <button type="submit" className="min-h-7 rounded-md border border-current/40 bg-black/10 px-2.5 py-1 text-[12px] font-semibold hover:bg-black/20">
            Exit Impersonation
          </button>
        </form>
      </div>
    );
  }
  const row = data as OpenImpersonationRow | null;
  if (!row) return null; // row was ended/doesn't exist/isn't this admin's own - RLS already enforces is_platform_admin(), so a stale cookie just shows nothing

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-warning px-4 py-2 text-center text-[13px] font-semibold text-warning-foreground">
      <span>
        {"⚠️"} IMPERSONATING: {row.target_company_name} ({row.target_user_email}) | Admin Support Mode
      </span>
      <form action={endImpersonation}>
        <button type="submit" className="min-h-7 rounded-md border border-current/40 bg-black/10 px-2.5 py-1 text-[12px] font-semibold hover:bg-black/20">
          Exit Impersonation
        </button>
      </form>
    </div>
  );
}
