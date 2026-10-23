"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Lock, User, ChevronsUpDown } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "./actions";
import { ADMIN_NAV_ITEM, EMPLOYEE_NAV_ITEMS, NAV_GROUPS, type NavItem, isNavItemActive } from "./nav-items";
import { cn } from "@/lib/utils";

function initialsOf(email: string | null): string {
  if (!email) return "?";
  return email.slice(0, 2).toUpperCase();
}

/**
 * Phase 2 nav restructure (2026-10-23): the account menu, previously only in
 * TopBar's own avatar button, moves here per Sarel's own brief ("User
 * Profile / Organization Switcher at the bottom of the sidebar"). Moved, not
 * duplicated - TopBar no longer renders its own copy. "Organization
 * switcher" itself isn't built: this product has no multi-org concept
 * anywhere in its data model (one user, one company, via company_members) -
 * a switcher with nothing real to switch between would be décor pretending
 * to be a feature, so this is Profile/Billing/Privacy/Sign out only, same
 * real destinations the old AvatarMenu had, plus Billing.
 */
function SidebarAccountMenu({
  userEmail,
  companyName,
  isEmployee,
}: {
  userEmail: string | null;
  companyName: string | null;
  isEmployee: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-md p-2 text-left text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        aria-label="Account menu"
      >
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
          {initialsOf(userEmail)}
        </div>
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <div className="truncate text-sm font-medium">{companyName ?? "Your company"}</div>
          <div className="truncate text-xs text-sidebar-foreground/70">{userEmail}</div>
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        {userEmail && <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{userEmail}</DropdownMenuLabel>}
        <DropdownMenuSeparator />
        {/* /company is RLS-blocked entirely for 'employee' (migration 0067) -
            /my-cv is their real self-service profile page instead. */}
        <DropdownMenuItem render={<Link href={isEmployee ? "/my-cv" : "/company"} />}>
          <User />
          Profile
        </DropdownMenuItem>
        {/* Billing moved to its own bottom-section link next to this menu
            (Phase 2 targeted polish, 2026-10-23) - no longer repeated here. */}
        <DropdownMenuItem render={<Link href="/privacy" />}>
          <Lock />
          Privacy
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem render={<button type="submit" className="w-full" />} variant="destructive">
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// One nav-item row's markup, shared between the grouped sections and the
// employee flat list - so "what a row looks like" can't drift between them.
function NavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavItemActive(pathname, item.href);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={item.href} />}
        isActive={active}
        tooltip={item.badge ? `${item.label} (${item.badge})` : item.label}
        className={cn(
          "min-h-11 md:min-h-9",
          // Phase 2 completion pass (2026-10-23): a crisp Interactive-Blue
          // fill for the active item, not the soft white hover-wash the
          // base component's own data-active styling otherwise shares with
          // hover - see globals.css's own --sidebar-active comment for why
          // this needs its own dedicated token rather than --accent itself.
          active && "data-active:bg-sidebar-active data-active:text-sidebar-active-foreground data-active:hover:bg-sidebar-active data-active:hover:text-sidebar-active-foreground",
        )}
      >
        <item.icon />
        <span>{item.label}</span>
        {item.badge && (
          <span className="ml-auto shrink-0 rounded-full bg-sidebar-primary/10 px-2 py-0.5 text-[10px] font-semibold text-sidebar-primary group-data-[collapsible=icon]:hidden">
            {item.badge}
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar({
  isPlatformAdmin,
  isEmployee,
  userEmail,
  companyName,
}: {
  isPlatformAdmin: boolean;
  isEmployee: boolean;
  userEmail: string | null;
  companyName: string | null;
}) {
  const pathname = usePathname();
  // Phase 2 completion pass (2026-10-23): 4 labelled groups (Core workspace /
  // Intelligence / Assets & library / Settings) - see nav-items.ts's own
  // comment for why this superseded the earlier same-day 3-group pass.
  // Platform admin's own "Admin" link joins Settings (administrative, same
  // as Billing) rather than a 5th group invented for one item. An
  // 'employee' (migration 0067) still gets the separate, un-grouped, 2-item
  // EMPLOYEE_NAV_ITEMS list - too few items for section headers to earn
  // their keep, and none of the 4 group labels fit "My CV" anyway.
  const groups = NAV_GROUPS.map((g) =>
    isPlatformAdmin && g.label === "Settings" ? { ...g, items: [...g.items, ADMIN_NAV_ITEM] } : g,
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
                T
              </div>
              <span className="font-display text-base font-semibold">Tender Ready</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {isEmployee ? (
          <SidebarMenu className="gap-1 px-2">
            {EMPLOYEE_NAV_ITEMS.map((item) => (
              <NavRow key={item.href} item={item} pathname={pathname} />
            ))}
          </SidebarMenu>
        ) : (
          groups.map((group) => (
            <SidebarGroup key={group.label}>
              {/* "Small uppercase label headers" (Phase 2 completion pass) -
                  uppercase/tracking added on top of SidebarGroupLabel's own
                  existing token-driven size/color (text-xs,
                  text-sidebar-foreground/70), not a new hardcoded color. */}
              <SidebarGroupLabel className="uppercase tracking-wider">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1 px-2">
                  {group.items.map((item) => (
                    <NavRow key={item.href} item={item} pathname={pathname} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))
        )}
      </SidebarContent>
      <SidebarFooter>
        {/* Billing is its own labelled "Settings" group above now (Phase 2
            completion pass) - no longer a special bottom-section link. */}
        <SidebarAccountMenu userEmail={userEmail} companyName={companyName} isEmployee={isEmployee} />
      </SidebarFooter>
    </Sidebar>
  );
}
