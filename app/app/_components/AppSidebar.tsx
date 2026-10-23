"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Lock, User, CreditCard, ChevronsUpDown } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import { ADMIN_NAV_ITEM, EMPLOYEE_NAV_ITEMS, NAV_ITEMS, isNavItemActive } from "./nav-items";

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
        {!isEmployee && (
          <DropdownMenuItem render={<Link href="/billing" />}>
            <CreditCard />
            Billing
          </DropdownMenuItem>
        )}
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
  const items = isEmployee ? EMPLOYEE_NAV_ITEMS : isPlatformAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

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
        <SidebarMenu className="gap-1 px-2">
          {items.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  render={<Link href={item.href} />}
                  isActive={active}
                  tooltip={item.badge ? `${item.label} (${item.badge})` : item.label}
                  className="min-h-11 md:min-h-9"
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
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarAccountMenu userEmail={userEmail} companyName={companyName} isEmployee={isEmployee} />
      </SidebarFooter>
    </Sidebar>
  );
}
