import { Home, Compass, Gavel, Vault, Users, GraduationCap, Wrench, ShieldCheck, FileUser, CreditCard, BarChart3, TrendingUp, type LucideIcon } from "lucide-react";

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
// Phase 2 completion pass (2026-10-23, Sarel's own review against the real
// production deploy): grouped into 4 labelled sections (Core workspace /
// Intelligence / Assets & library / Settings) - this exact grouping
// superseded an earlier same-day 3-group-plus-bottom-section pass once
// Sarel reviewed the real thing and asked for Company vault to sit with the
// other everyday-workspace items, Toolkit to sit with the reference
// material it actually is, and Billing to be its own labelled group rather
// than a bottom-section special case. Each item is defined once below and
// shared between the flat NAV_ITEMS (CommandPalette's own search list - a
// command palette has no use for section headers) and the grouped
// NAV_GROUPS (AppSidebar) - one definition per destination, so the two
// lists can't silently drift apart on label/icon/href.
const DASHBOARD: NavItem = { href: "/dashboard", label: "Dashboard", icon: Home };
const OPPORTUNITIES: NavItem = { href: "/discovery", label: "Opportunities", icon: Compass };
const BID_PIPELINE: NavItem = { href: "/pipeline", label: "Bid pipeline", icon: Gavel };
const COMPANY_VAULT: NavItem = { href: "/company", label: "Company vault", icon: Vault };
const PEOPLE_CVS: NavItem = { href: "/people", label: "People & CVs", icon: Users };
const EXPERIENCE: NavItem = { href: "/experience", label: "Experience", icon: GraduationCap };
const MARKET_INTELLIGENCE: NavItem = { href: "/market-intelligence", label: "Market intelligence", icon: TrendingUp };
const TOOLKIT: NavItem = { href: "/toolkit", label: "Toolkit", icon: Wrench };
const ANALYTICS: NavItem = { href: "/analytics", label: "Analytics", icon: BarChart3 };
const BILLING: NavItem = { href: "/billing", label: "Billing", icon: CreditCard };

export const NAV_ITEMS: NavItem[] = [
  DASHBOARD,
  OPPORTUNITIES,
  BID_PIPELINE,
  COMPANY_VAULT,
  MARKET_INTELLIGENCE,
  TOOLKIT,
  ANALYTICS,
  BILLING,
  PEOPLE_CVS,
  EXPERIENCE,
];

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Core workspace", items: [DASHBOARD, OPPORTUNITIES, BID_PIPELINE, COMPANY_VAULT] },
  { label: "Intelligence", items: [MARKET_INTELLIGENCE, ANALYTICS] },
  { label: "Assets & library", items: [PEOPLE_CVS, EXPERIENCE, TOOLKIT] },
  { label: "Settings", items: [BILLING] },
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

/** /tenders/* drills down from Home; every other item matches its own prefix (so /pipeline/pricing still highlights Bids). "Tools" points at /toolkit (spec v3 O03), not the public /tools catalogue those same calculators also render on. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname.startsWith("/dashboard") || pathname.startsWith("/tenders");
  return pathname === href || pathname.startsWith(`${href}/`);
}
