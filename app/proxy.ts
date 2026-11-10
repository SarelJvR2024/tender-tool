import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { IMPERSONATION_COOKIE } from "@/lib/impersonation";

/**
 * Refreshes the Supabase session cookie on every request, redirects
 * signed-out users away from every app route below (the standard Supabase
 * SSR pattern - without it, session cookies expire silently and users get
 * logged out at unpredictable times), and routes a signed-in user to
 * wherever they actually belong: /onboarding if they have no company yet
 * (company_members has no row for them - see
 * supabase/migrations/0003_onboarding.sql). Every other route is untouched.
 *
 * Does NOT redirect a member away from /onboarding itself - that decision
 * is left to /onboarding/page.tsx, which knows the difference between its
 * two real screens (spec v3 Batch 3: Screen 1 creates the company, Screen 2
 * is the optional "add documents" step right after) and sends a member
 * anywhere else straight to /dashboard.
 *
 * Finding 356, standing review pass 2026-11-10: the company_members check
 * below always authenticates against the REAL signed-in user's own `sb-*`
 * cookies, by design - correct, and NOT the already-documented impersonation
 * session-refresh gap (that one is about the impersonated session's OWN
 * tokens going stale, a separate problem in lib/supabase/server.ts). But
 * during an active "View Tenant Workspace" impersonation session (Admin
 * Command Center Phase 4), the real signed-in user IS the platform admin -
 * and platform_admins (migration 0043) is deliberately "Not a customer
 * role - a company owner is NOT a platform admin", so a dedicated admin
 * account genuinely has no company_members row of its own. With no guard
 * here, that force-redirected EVERY guarded request made while
 * impersonating (i.e. every page "View Tenant Workspace" exists to let an
 * admin view) to /onboarding - which itself renders via the swapped-in
 * IMPERSONATED session (lib/supabase/server.ts's createClient(), unlike
 * this middleware, DOES honor the tt_impersonation cookie) and, once the
 * target company's own onboarding is already done, redirects straight back
 * to the original guarded path - an infinite redirect loop, breaking
 * impersonation entirely for any admin account with no company of its own.
 * Skipped here while impersonating: the identity this check cares about is
 * the real admin's, who is never the one being onboarded; the impersonated
 * session's own onboarding state needs no re-check - platform_admin_start_
 * impersonation() only ever targets a company that already has a member.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const guarded =
    path.startsWith("/dashboard") ||
    path.startsWith("/onboarding") ||
    path.startsWith("/tenders") ||
    path.startsWith("/pipeline") ||
    path.startsWith("/discovery") ||
    path.startsWith("/company") ||
    path.startsWith("/people") ||
    path.startsWith("/experience") ||
    path.startsWith("/admin") ||
    path.startsWith("/my-cv") ||
    // spec v3 Batch 1: /toolkit is the signed-in Tools home (see
    // nav-items.ts). The other four below closed a pre-existing gap found
    // while reviewing that batch's PR.
    path.startsWith("/toolkit") ||
    path.startsWith("/analytics") ||
    path.startsWith("/billing") ||
    path.startsWith("/market-intelligence") ||
    path.startsWith("/sanral-schedules");

  if (!user && guarded) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const impersonating = Boolean(request.cookies.get(IMPERSONATION_COOKIE)?.value);

  if (user && guarded && !impersonating) {
    const { data: membership } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership && !path.startsWith("/onboarding")) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/tenders/:path*",
    "/pipeline/:path*",
    "/discovery/:path*",
    "/company/:path*",
    "/people/:path*",
    "/experience/:path*",
    "/admin/:path*",
    "/my-cv/:path*",
    "/toolkit/:path*",
    "/analytics/:path*",
    "/billing/:path*",
    "/market-intelligence/:path*",
    "/sanral-schedules/:path*",
  ],
};
