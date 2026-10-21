"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ADMIN_NAV_ITEM, EMPLOYEE_NAV_ITEMS, NAV_ITEMS, isNavItemActive } from "./nav-items";

export function AppSidebar({ isPlatformAdmin, isEmployee }: { isPlatformAdmin: boolean; isEmployee: boolean }) {
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
      <SidebarFooter />
    </Sidebar>
  );
}
