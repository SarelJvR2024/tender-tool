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
 * Does NOT redirect a member away from /onboarding anymore (it used to) -
 * the 5-step wizard (app/AGENTS.md "Auth + onboarding") keeps gathering
 * compliance/people/preference data at /onboarding?step=2..5 for a while
 * after step 1 already created the company and its company_members row, so
 * "membership exists" can no longer mean "onboarding is done, send them to
 * /dashboard". /onboarding/page.tsx itself decides what to show a member
 * who lands there (the bid-readiness end screen by default).
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
    // spec v3 Batch 1: /toolkit is the new signed-in Tools home (see
    // nav-items.ts). Added here, not left to inherit the pre-existing gap
    // that /billing, /analytics, /sanral-schedules and /market-intelligence
    // already have (reachable unauthenticated - AppShell itself just
    // renders empty state for a null user rather than redirecting) - that
    // gap predates this change and is out of scope for this batch, but a
    // brand-new route shouldn't ship with it.
    path.startsWith("/toolkit");

  if (!user && guarded) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && guarded) {
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
  ],
};
