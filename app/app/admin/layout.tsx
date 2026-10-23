import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Every /admin/* page assumed Postgres RLS (is_platform_admin(), migration
 * 0043) was gate enough on its own - it isn't. RLS only makes a non-admin's
 * own queries come back empty; the page itself still renders normally (an
 * empty "Alerts & harness results" shell, an empty customer list, ...), so a
 * signed-in company account that guesses or bookmarks /admin sees a real,
 * if blank, internal page instead of being turned away. UX audit
 * 2026-10-23, item 5: confirmed live with a non-admin account. One guard
 * here, in the shared segment layout, covers every current and future
 * /admin/* page - the same "one shared place, not six hand-rolled copies"
 * fix AdminNav's own header comment already called for.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) notFound();

  return <>{children}</>;
}
