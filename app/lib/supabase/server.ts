import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client, for use in Server Components, Route Handlers,
 * and Server Actions. Reads/writes the session via Next's cookie store so
 * the user stays logged in across requests. The try/catch around cookie
 * writes is required, not defensive clutter: a Server Component can call
 * this and attempt to set a cookie, which Next.js rejects outside a Route
 * Handler or Server Action - middleware.ts is what actually refreshes the
 * session cookie in that case.
 */
export async function createClient() {
  const cookieStore = await cookies();

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
