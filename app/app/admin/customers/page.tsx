import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../../_components/SiteNav";
import CustomerRow, { type Customer, type CustomerMember } from "./CustomerRow";

// Reads per-request session/DB data (RPCs gated by is_platform_admin, 0064) -
// same escape hatch as ../page.tsx.
export const instant = false;

type CompanyOverviewRow = {
  id: string;
  legal_name: string;
  csd_trading_name: string | null;
  is_test_company: boolean;
  created_at: string;
  member_count: number;
  people_count: number;
  tenders_pursued_count: number;
  last_activity_at: string | null;
};

// Super admin portal, part 1 (0064): every company using the tool, who's on
// it, and how much they've actually done with it - the thing an "Admin"
// section without it can't answer. Issue review lives at /admin itself
// (system alerts + harness results); /admin/settings is the other half.
export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const { data: companies, error } = await supabase.rpc("platform_admin_companies");
  const rows = (companies ?? []) as CompanyOverviewRow[];

  const memberLists = await Promise.all(
    rows.map((c) => supabase.rpc("platform_admin_company_members", { p_company_id: c.id })),
  );

  const customers: Customer[] = rows.map((c, i) => ({
    ...c,
    members: (memberLists[i].data ?? []) as CustomerMember[],
  }));

  const testCount = customers.filter((c) => c.is_test_company).length;

  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <SiteNav active="admin" />

      <div style={{ padding: "24px 32px", maxWidth: 1000, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: 14, fontSize: 13, marginBottom: 12 }}>
          <Link href="/admin" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Alerts &amp; harness results</Link>
          <span style={{ color: "#16233B", fontWeight: 600 }}>Customers</span>
          <Link href="/admin/settings" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Settings</Link>
          <Link href="/admin/taxonomy" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Discipline list</Link>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Customers</h1>
        <p style={{ fontSize: 13, color: "#5B6472", margin: "0 0 16px" }}>
          Every company signed up to Tender Tool, with how many people they&apos;ve added and tenders they&apos;ve started.{" "}
          {customers.length} compan{customers.length === 1 ? "y" : "ies"}
          {testCount > 0 ? ` (${testCount} marked as test)` : ""}.
        </p>

        {(error || actionError) && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            {error ? `Could not load customers: ${error.message}` : actionError}
          </div>
        )}

        <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 11, overflow: "hidden" }}>
          {customers.length === 0 && !error && (
            <div style={{ padding: "24px 18px", fontSize: 13, color: "#5B6472" }}>No companies have signed up yet.</div>
          )}
          {customers.map((c) => (
            <CustomerRow key={c.id} customer={c} />
          ))}
        </div>
      </div>
    </div>
  );
}
