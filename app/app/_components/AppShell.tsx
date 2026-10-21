import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getNotifications } from "@/lib/notifications";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";

/**
 * Replaces SiteNav (the old navy top bar every signed-in page mounted) with
 * a collapsible sidebar + topbar app shell. Same mounting pattern as
 * SiteNav - each page wraps its own content in <AppShell> rather than this
 * living in a Next.js layout.tsx, so this migration stays a page-by-page
 * content change, not a directory restructure. See app/AGENTS.md ("App
 * shell") for the full reasoning, including the Home vs Bids IA decision.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ data: { user } }, cookieStore] = await Promise.all([supabase.auth.getUser(), cookies()]);

  let isPlatformAdmin = false;
  let isEmployee = false;
  let companyName: string | null = null;
  let notifications: Awaited<ReturnType<typeof getNotifications>> = [];
  let notificationsError = false;

  if (user) {
    // getNotifications is allowed to fail on its own (a bad expiry date, a
    // transient Supabase read) without taking down the rest of the shell -
    // every signed-in page renders through AppShell, so an unguarded
    // rejection here used to break the whole page, not just the bell.
    const [{ data: adminData }, { data: membership }, { data: company }, notificationsResult] = await Promise.all([
      supabase.rpc("is_platform_admin"),
      // 'employee' (migration 0067) only ever sees Home + My CV - see
      // nav-items.ts's own EMPLOYEE_NAV_ITEMS comment for why.
      supabase.from("company_members").select("role").eq("user_id", user.id).maybeSingle(),
      supabase.from("companies").select("legal_name, csd_trading_name").maybeSingle(),
      getNotifications(supabase).catch((error) => {
        console.error("Failed to load notifications", error);
        return null;
      }),
    ]);
    isPlatformAdmin = adminData === true;
    isEmployee = membership?.role === "employee";
    companyName = (company?.csd_trading_name || company?.legal_name) ?? null;
    notifications = notificationsResult ?? [];
    notificationsError = notificationsResult === null;
  }

  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar isPlatformAdmin={isPlatformAdmin} isEmployee={isEmployee} />
      <SidebarInset>
        <TopBar
          userEmail={user?.email ?? null}
          companyName={companyName}
          isPlatformAdmin={isPlatformAdmin}
          isEmployee={isEmployee}
          notifications={notifications}
          notificationsError={notificationsError}
        />
        <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
