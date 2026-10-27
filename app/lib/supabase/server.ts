import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { IMPERSONATION_COOKIE, type ImpersonationCookiePayload } from "../impersonation";

/**
 * Server-side Supabase client, for use in Server Components, Route Handlers,
 * and Server Actions. Reads/writes the session via Next's cookie store so
 * the user stays logged in across requests. The try/catch around cookie
 * writes is required, not defensive clutter: a Server Component can call
 * this and attempt to set a cookie, which Next.js rejects outside a Route
 * Handler or Server Action - middleware.ts is what actually refreshes the
 * session cookie in that case.
 *
 * Impersonation (Admin Command Center Phase 4, 2026-10-27): when the
 * tt_impersonation cookie is present, this returns a client hydrated with
 * the TARGET user's own session instead of the admin's - every existing
 * caller of createClient() (which is to say, nearly every page and Server
 * Action in this app) therefore renders exactly as that company member
 * would see it, with zero per-page changes. The admin's own `sb-*` auth
 * cookies are never read or touched on this path - lib/impersonation.ts's
 * own header explains why that is the whole point. This function cannot
 * itself verify the impersonation audit row is still open (that would mean
 * a DB round trip on every single request this app makes) - the cookie's
 * own short, fixed max-age (IMPERSONATION_MAX_AGE_SECONDS) is the bound;
 * app/_components/ImpersonationBanner.tsx is what actually re-confirms the
 * open row, from the admin's OWN real session, for display - which is
 * exactly what `{ bypassImpersonation: true }` is for: skip the swap
 * entirely and always return the real signed-in session's own client,
 * regardless of any impersonation cookie.
 */
export async function createClient(options?: { bypassImpersonation?: boolean }) {
  const cookieStore = await cookies();

  const impersonationRaw = options?.bypassImpersonation ? undefined : cookieStore.get(IMPERSONATION_COOKIE)?.value;
  if (impersonationRaw) {
    try {
      const payload = JSON.parse(impersonationRaw) as ImpersonationCookiePayload;
      if (payload.accessToken && payload.refreshToken) {
        const impersonated = createSupabaseJsClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );
        await impersonated.auth.setSession({ access_token: payload.accessToken, refresh_token: payload.refreshToken });
        return impersonated;
      }
    } catch {
      // Malformed/tampered cookie - fall through to the admin's own real session below, never trusted.
    }
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component - middleware.ts refreshes the
            // session instead. Safe to ignore here.
          }
        },
      },
    }
  );
}
