import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getNotifications } from "@/lib/notifications";
import { isDemoCompany } from "@/lib/demoCompany";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { DemoBanner } from "@/components/tt/demo-banner";

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
  let companyName: string | null = null;
  let notifications: Awaited<ReturnType<typeof getNotifications>> = [];
  let isDemo = false;

  if (user) {
    const [{ data: adminData }, { data: company }, notificationRows] = await Promise.all([
      supabase.rpc("is_platform_admin"),
      supabase.from("companies").select("id, legal_name, csd_trading_name").maybeSingle(),
      getNotifications(supabase),
    ]);
    isPlatformAdmin = adminData === true;
    companyName = (company?.csd_trading_name || company?.legal_name) ?? null;
    notifications = notificationRows;
    // "Demo company" (app/AGENTS.md): the one seeded demo/trial company gets
    // a small banner so sample data is never mistaken for a real vault - see
    // lib/demoCompany.ts for why this is a static allowlist, not a new column.
    isDemo = isDemoCompany(company?.id as string | undefined);
  }

  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar isPlatformAdmin={isPlatformAdmin} />
      <SidebarInset>
        <TopBar userEmail={user?.email ?? null} companyName={companyName} isPlatformAdmin={isPlatformAdmin} notifications={notifications} />
        <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
          {isDemo && <DemoBanner />}
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
