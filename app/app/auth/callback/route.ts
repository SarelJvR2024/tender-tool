import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Exchanges the OAuth provider's one-time code for a Supabase session.
 * Standard PKCE callback handler - Google/Microsoft redirect here after
 * the user approves sign-in, see app/login/page.tsx.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
