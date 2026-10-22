import { Home, Compass, Gavel, Vault, Users, GraduationCap, Wrench, ShieldCheck, Zap, FileUser, CreditCard, BarChart3, TrendingUp, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; badge?: string };

// "Home" (was "Tenders") and "Bids" are deliberately two different pages, not
// a rename of one into the other - see app/AGENTS.md ("App shell" section)
// for why, confirmed with Sarel before building this. Pipeline's board lives
// at /pipeline under the "Bids" label; /tenders/[id] and /tenders/new are
// drill-downs from Home, not their own nav destination.
//
// "SANRAL schedules" (prompt 10, item 2: "make the SANRAL automation a
// clearly visible, premium feature") carried a small badge naming the
// market segment it serves - fixed 2026-10-22 (caught reviewing PR #96):
// the badge read "Roads & Civils", a name the Tender-Ready-Claude-Spec_v1.md
// positioning rules explicitly forbid anywhere user-facing ("Never use the
// name 'Roads & Civils'") - a different, earlier session already flagged
// this exact phrase as a stale/confused brief term, not a real product name
// (see the "4-tier scheme" entry below). Removed rather than replaced with
// another invented segment name - "SANRAL schedules" already says what the
// feature is without one.
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/discovery", label: "Opportunities", icon: Compass },
  { href: "/pipeline", label: "Bids", icon: Gavel },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/market-intelligence", label: "Market intelligence", icon: TrendingUp },
  { href: "/sanral-schedules", label: "SANRAL schedules", icon: Zap },
  { href: "/company", label: "Company vault", icon: Vault },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/people", label: "People & CVs", icon: Users },
  { href: "/experience", label: "Experience", icon: GraduationCap },
  { href: "/tools", label: "Tools", icon: Wrench },
];

export const ADMIN_NAV_ITEM: NavItem = { href: "/admin", label: "Admin", icon: ShieldCheck };

// An 'employee' (migration 0067) only ever gets this - their own CV and
// documents, nothing about the company's tenders, pricing or other people.
// Matches the RESTRICTIVE RLS policies that same migration adds; this nav
// swap is cosmetic (RLS already blocks the data), but showing a link to a
// page that would come back empty is confusing, so every other item is left
// off entirely rather than shown and silently failing.
export const EMPLOYEE_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/my-cv", label: "My CV", icon: FileUser },
];

/** /tenders/* drills down from Home; every other item matches its own prefix (so /pipeline/pricing still highlights Bids). */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname.startsWith("/dashboard") || pathname.startsWith("/tenders");
  return pathname === href || pathname.startsWith(`${href}/`);
}
