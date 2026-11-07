import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  if (user && guarded) {
    const { data: membership, error: membershipError } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", user.id)
      .maybeSingle();

    // A transient read failure here (membershipError truthy) must never be
    // treated the same as a genuine "no company yet" - this read runs on
    // EVERY request to every guarded route, so without this check a single
    // Supabase hiccup would force-redirect an already-onboarded user away
    // from whatever page they actually asked for and onto /onboarding's
    // own Screen 1 ("create your company"). migration 0116's unique
    // constraint means actually submitting that screen would just fail
    // safely with a friendly error rather than create a duplicate company -
    // but the redirect itself is still the wrong, confusing destination for
    // a legitimate member hit by nothing more than a blip. On a failed
    // read, fall through and let the request reach its real destination
    // unchanged; that page's own reads (or onboarding/page.tsx's own,
    // separately-guarded read if they land there anyway) decide what to
    // show, same as this check already leaves every OTHER failure mode to
    // the destination page.
    if (membershipError) {
      console.error("proxy: company_members read failed", membershipError);
    } else if (!membership && !path.startsWith("/onboarding")) {
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
