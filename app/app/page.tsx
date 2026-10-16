import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Reads the session cookie on every request to decide where to redirect -
// Next.js 16's Cache Components model otherwise tries to prerender this at
// build time, which can't work (there's no session yet). "instant = false"
// is the documented escape hatch for a route that must block on real,
// per-request data instead of being prerendered or streamed.
export const instant = false;

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user ? "/dashboard" : "/login");
}
