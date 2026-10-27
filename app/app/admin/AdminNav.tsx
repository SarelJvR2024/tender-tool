import Link from "next/link";

export type AdminNavKey =
  | "alerts" | "customers" | "notifications" | "settings" | "taxonomy"
  | "discovered-opportunities" | "requirement-extractions" | "telemetry" | "billing" | "tenders";

const ADMIN_NAV_ITEMS: { key: AdminNavKey; href: string; label: string }[] = [
  { key: "alerts", href: "/admin", label: "Alerts & harness results" },
  { key: "customers", href: "/admin/customers", label: "Customers" },
  { key: "tenders", href: "/admin/tenders", label: "Tender catalog" },
  { key: "telemetry", href: "/admin/telemetry", label: "Telemetry" },
  { key: "billing", href: "/admin/billing", label: "Billing" },
  { key: "notifications", href: "/admin/notifications", label: "Notifications" },
  { key: "settings", href: "/admin/settings", label: "Settings" },
  { key: "taxonomy", href: "/admin/taxonomy", label: "Discipline list" },
  { key: "discovered-opportunities", href: "/admin/discovered-opportunities", label: "Discovered opportunities" },
  { key: "requirement-extractions", href: "/admin/requirement-extractions", label: "Quality Scout" },
];

/**
 * Shared breadcrumb row for every /admin/* page. Each admin page used to
 * hand-roll this same row of links, one hardcoded copy per file - which is
 * exactly how /admin/taxonomy ended up stuck with only 2 of the 6 links
 * (and its own, different muted color and spacing) while the other 5 pages
 * each independently grew a new link as each new admin screen landed: every
 * one of them needed editing by hand, and one was always missed. Same fix
 * as ToolsHeader (app/app/tools/_components/ToolsHeader.tsx) for the public
 * tool pages' near-identical duplicated header - one shared list, one place
 * to add the next admin page.
 *
 * Color-token migration (2026-10-21): was raw inline-CSSProperties (navy
 * #16233B for the active item, gold #D97706 for every link) - now
 * text-foreground/text-accent, blue not gold, matching every other
 * migrated nav in the app. Each item wrapped in its own min-h-11 flex
 * item (was bare inline text with no padding) for a real touch target.
 */
export function AdminNav({ active }: { active: AdminNavKey }) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px]">
      {ADMIN_NAV_ITEMS.map((item) =>
        item.key === active ? (
          <span key={item.key} className="flex min-h-11 items-center font-semibold text-foreground">
            {item.label}
          </span>
        ) : (
          <Link key={item.key} href={item.href} className="flex min-h-11 items-center font-semibold text-accent no-underline">
            {item.label}
          </Link>
        ),
      )}
    </div>
  );
}
