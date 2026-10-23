import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safeRedirect";
import { NextResponse } from "next/server";

/**
 * Exchanges the OAuth provider's one-time code for a Supabase session.
 * Standard PKCE callback handler - Google/Microsoft redirect here after
 * the user approves sign-in, see app/login/page.tsx.
 *
 * `next` had no validation at all here before - login/signup's own
 * nextParam() filters it before ever reaching the OAuth redirectTo URL
 * this route is called with, but a redirect SINK trusting only an
 * upstream caller's filter (rather than checking its own input) is the
 * same gap this project already avoids elsewhere (path-traversal checks,
 * POPIA-Security-Audit.md) - this is the one place that actually issues
 * the redirect right after a real sign-in succeeds, so it validates for
 * itself. QA pass, 2026-10-23.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"), "/dashboard");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
