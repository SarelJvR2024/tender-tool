import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client, for use inside "use client" components.
 * Reads the public URL/anon key - safe to ship to the browser, RLS policies
 * (see supabase/migrations/0001_init_schema.sql) are what actually enforce
 * tenant isolation, not keeping this key secret.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
