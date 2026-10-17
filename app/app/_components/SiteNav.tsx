import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type NavKey = "dashboard" | "pipeline" | "discovery" | "company" | "people" | "experience" | "admin";

const NAV_ITEMS: { key: NavKey; href: string; label: string }[] = [
  { key: "dashboard", href: "/dashboard", label: "Tenders" },
  { key: "pipeline", href: "/pipeline", label: "Pipeline" },
  { key: "discovery", href: "/discovery", label: "Discovery" },
  { key: "company", href: "/company", label: "Company" },
  { key: "people", href: "/people", label: "People" },
  { key: "experience", href: "/experience", label: "Experience" },
];

// Shared top bar for every signed-in page. Before this, each page (dashboard,
// discovery, company, people, tenders/[id], people/[id], admin) built its own
// copy of the navy header, and none of them linked to any other section -
// the only way to move around the app was typing a URL, or a single
// "<- Back to X" link on detail pages. This renders the logo once and a
// persistent tab row so every screen can reach every other screen directly.
export async function SiteNav({ active }: { active: NavKey }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isOwner = false;
  if (user) {
    const { data: membership } = await supabase
      .from("company_members")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    isOwner = membership?.role === "owner";
  }

  // Admin is a diagnostic tool for the company owner (see
  // supabase/migrations/0005_admin_harness_results.sql) - RLS already hides
  // its data from everyone else, but surfacing the tab only for owners avoids
  // sending other members to a page that will just look confusingly empty.
  const items: { key: NavKey; href: string; label: string }[] = isOwner
    ? [...NAV_ITEMS, { key: "admin", href: "/admin", label: "Admin" }]
    : NAV_ITEMS;

  return (
    <div style={{ background: "#16233B", color: "#FFFFFF" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "13px 16px",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/dashboard"
          style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "#FFFFFF", flexShrink: 0 }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "#D97706",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 13,
              color: "#16233B",
              flexShrink: 0,
            }}
          >
            T
          </div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Tender Tool</div>
        </Link>
        {user?.email && (
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.65)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 220,
            }}
          >
            {user.email}
          </div>
        )}
      </div>
      <nav
        style={{
          display: "flex",
          gap: 2,
          padding: "0 6px",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          borderTop: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                // 14px top/bottom padding + ~16px line height clears the
                // 44px touch-target minimum (same convention as the 44px
                // minHeight buttons on company/page.tsx).
                padding: "14px 16px",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
                color: isActive ? "#D97706" : "rgba(255,255,255,0.75)",
                borderBottom: isActive ? "2px solid #D97706" : "2px solid transparent",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
