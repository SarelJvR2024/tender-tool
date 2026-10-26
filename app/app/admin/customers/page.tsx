import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { AdminNav } from "../AdminNav";
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
//
// Color-token migration (2026-10-21): was raw inline-CSSProperties
// throughout (navy #16233B, muted #5B6472, border #E3E6EA, error banner
// #FEE2E2/#FCA5A5/#B91C1C) - now Tailwind + tokens, same mapping as every
// other admin page in this pass.
export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const { data: companies, error } = await supabase.rpc("platform_admin_companies");
  if (error) console.error("platform_admin_companies rpc failed", error);
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
    <AppShell>
      <div className="mx-auto w-full max-w-[1000px] p-4 sm:p-6 md:px-8 md:py-6">
        <AdminNav active="customers" />

        <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">Customers</h1>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Every company signed up to Tender Ready, with how many people they&apos;ve added and tenders they&apos;ve started.{" "}
          {customers.length} compan{customers.length === 1 ? "y" : "ies"}
          {testCount > 0 ? ` (${testCount} marked as test)` : ""}.
        </p>

        {(error || actionError) && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            {error ? "Couldn't load customers - try refreshing. If it keeps happening, let us know." : actionError}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {customers.length === 0 && !error && (
            <div className="p-4.5 text-[13px] text-muted-foreground">No companies have signed up yet.</div>
          )}
          {customers.map((c) => (
            <CustomerRow key={c.id} customer={c} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
