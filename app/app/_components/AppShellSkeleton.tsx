import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Static stand-in for AppShell, used only inside loading.tsx files.
 *
 * AppShell is an async server component that reads cookies() and makes live
 * Supabase calls (auth, notifications, subscription) - correct for the real
 * page, but wrong for a loading boundary: Next's Cache Components treats
 * loading.tsx as something it should be able to prerender as static shell
 * chrome, and a dynamic API read inside it throws at build/dev time
 * ("Route couldn't be rendered statically because it used `cookies`" /
 * equivalent Date.now()-during-prerender errors - reproduced across
 * /pipeline, /company, /billing, /people, /experience, /tenders/new and
 * others). A loading state showing "the user's real notification count"
 * makes no sense anyway - it's a placeholder shown before that data exists.
 *
 * This renders only the sidebar/topbar CHROME shape (no data, no auth, no
 * cookies), so every loading.tsx can import a component that behaves
 * identically to AppShell visually without doing any of its work.
 */
export function AppShellSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Skeleton className="size-7 shrink-0 rounded-md" />
            <Skeleton className="h-4 w-28 group-data-[collapsible=icon]:hidden" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div className="flex flex-col gap-1 px-2 pt-1">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full shrink-0 rounded-md" />
            ))}
          </div>
        </SidebarContent>
        <SidebarFooter />
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3">
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <Skeleton className="h-9 max-w-80 flex-1 rounded-lg" />
          <div className="ml-auto flex items-center gap-1">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <Skeleton className="size-9 shrink-0 rounded-full" />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
