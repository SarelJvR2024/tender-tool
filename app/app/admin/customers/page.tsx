import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { AdminNav } from "../AdminNav";
import { StatCard } from "@/components/tt/stat-card";
import { computeBidReadiness } from "@/lib/readiness";
import { daysUntil } from "@/lib/dates";
import CustomerRow, { type Customer, type CustomerMember } from "./CustomerRow";
import { impersonationConfigured } from "@/lib/impersonation";

// Reads per-request session/DB data (RPCs gated by is_platform_admin, 0064) -
// same escape hatch as ../page.tsx.
export const instant = false;

type CompanyOverviewRow = {
  id: string;
  legal_name: string;
  csd_trading_name: string | null;
  csd_supplier_number: string | null;
  is_test_company: boolean;
  created_at: string;
  member_count: number;
  people_count: number;
  tenders_pursued_count: number;
  active_tenders_count: number;
  last_activity_at: string | null;
  plan_tier: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
};

type ReadinessDataRow = {
  legal_name: string | null;
  csd_supplier_number: string | null;
  sars_tcs_pin: string | null;
  sars_tcs_pin_expiry: string | null;
  bee_level: number | null;
  bee_proof_expiry: string | null;
  cidb_grading: string | null;
  cidb_expiry: string | null;
  bank_confirmation_letter_valid_until: string | null;
  principal_count: number;
  people_with_cv_count: number;
  experience_project_count: number;
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
export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<{ error?: string; company?: string }> }) {
  const { error: actionError, company: autoOpenCompanyId } = await searchParams;
  const supabase = await createClient();

  const [{ data: companies, error }, { count: tendersTrackedCount }] = await Promise.all([
    supabase.rpc("platform_admin_companies"),
    supabase.from("tenders").select("id", { count: "exact", head: true }),
  ]);
  if (error) console.error("platform_admin_companies rpc failed", error);
  const rows = (companies ?? []) as CompanyOverviewRow[];

  const [memberLists, readinessRows] = await Promise.all([
    Promise.all(rows.map((c) => supabase.rpc("platform_admin_company_members", { p_company_id: c.id }))),
    Promise.all(rows.map((c) => supabase.rpc("platform_admin_company_readiness_data", { p_company_id: c.id }))),
  ]);

  const customers: Customer[] = rows.map((c, i) => {
    const members = (memberLists[i].data ?? []) as CustomerMember[];
    const r = (readinessRows[i].data?.[0] ?? null) as ReadinessDataRow | null;
    const readiness = r
      ? computeBidReadiness({
          legalName: r.legal_name,
          csdSupplierNumber: r.csd_supplier_number,
          taxPin: r.sars_tcs_pin,
          taxPinExpiry: r.sars_tcs_pin_expiry,
          beeLevel: r.bee_level,
          beeProofExpiry: r.bee_proof_expiry,
          cidbGrading: r.cidb_grading,
          cidbExpiry: r.cidb_expiry,
          bankConfirmationValidUntil: r.bank_confirmation_letter_valid_until,
          principalCount: r.principal_count,
          peopleWithCvCount: r.people_with_cv_count,
          experienceProjectCount: r.experience_project_count,
        })
      : null;
    const primaryContact = members.find((m) => m.role === "owner")?.email ?? members[0]?.email ?? null;
    const trialDaysRemaining = c.subscription_status === "trialing" ? daysUntil(c.trial_ends_at) : null;
    return { ...c, members, readinessPercent: readiness?.percent ?? null, readinessCriteria: readiness?.criteria ?? null, primaryContact, trialDaysRemaining };
  });

  const testCount = customers.filter((c) => c.is_test_company).length;
  const trialCount = customers.filter((c) => !c.is_test_company && c.subscription_status === "trialing").length;
  const payingCount = customers.filter((c) => !c.is_test_company && c.subscription_status === "active").length;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1100px] p-4 sm:p-6 md:px-8 md:py-6">
        <AdminNav active="customers" />

        <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">Customers</h1>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Every company signed up to Tender Ready, with how many people they&apos;ve added and tenders they&apos;ve started.{" "}
          {customers.length} compan{customers.length === 1 ? "y" : "ies"}
          {testCount > 0 ? ` (${testCount} marked as test)` : ""}.
        </p>

        <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <StatCard label="Registered companies" value={customers.length} />
          <StatCard label="Active trials" value={trialCount} tone="warning" />
          <StatCard label="Paying subscribers" value={payingCount} tone="success" />
          <StatCard label="Tenders tracked platform-wide" value={tendersTrackedCount ?? 0} tone="muted" />
        </div>

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
            <CustomerRow key={c.id} customer={c} defaultOpen={c.id === autoOpenCompanyId} impersonationAvailable={impersonationConfigured()} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
