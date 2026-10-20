import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/dates";
import { fetchCompanyReadiness } from "@/lib/companyReadinessData";
import { SiteNav } from "../_components/SiteNav";
import { PageHeader } from "@/components/tt/page-header";
import { StatCard } from "@/components/tt/stat-card";
import { StatusBadge, type TenderStatus } from "@/components/tt/status-badge";
import { DeadlineChip } from "@/components/tt/deadline-chip";
import { EmptyState } from "@/components/tt/empty-state";
import { BidReadinessCard } from "@/components/tt/bid-readiness-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

// This page depends on the signed-in user's session (via RLS) on every
// request, so it can't be prerendered - "instant = false" is Next.js 16's
// Cache Components escape hatch for a route that must block on real,
// per-request data.
export const instant = false;

type TenderRow = {
  id: string;
  contract_no: string | null;
  nra_reference: string | null;
  description: string | null;
  closing_date: string | null;
  source: string | null;
  family: string | null;
  tender_packs: { status: string }[];
};

/**
 * Pack-completeness for this list, not a pipeline stage - keeps the
 * original wording in every case (StatusBadge's own default label for
 * each variant differs: "ready" defaults to "Ready", "in-progress" to
 * "In progress") so the migration doesn't quietly change user-facing copy.
 */
function statusFor(tender: TenderRow): { variant: TenderStatus; label: string } {
  const pack = tender.tender_packs?.[0];
  if (!pack) return { variant: "needs-docs", label: "Needs documents" };
  if (pack.status === "confirmed" || pack.status === "filled") {
    return { variant: "ready", label: "Complete" };
  }
  return { variant: "in-progress", label: "Needs your input" };
}

export default async function DashboardPage() {
  const supabase = await createClient();

  // tender_packs only comes back for the signed-in user's own company, via RLS -
  // this query shape works the same regardless of which company is asking.
  const [{ data: tenders, error }, readiness] = await Promise.all([
    supabase
      .from("tenders")
      .select("id, contract_no, nra_reference, description, closing_date, source, family, tender_packs(status)")
      .order("closing_date", { ascending: true }),
    fetchCompanyReadiness(supabase),
  ]);

  if (error) console.error("tenders select failed for dashboard", error);

  const rows = (tenders ?? []) as unknown as TenderRow[];
  const completeCount = rows.filter((t) => statusFor(t).variant === "ready").length;
  const needsInputCount = rows.length - completeCount;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteNav active="dashboard" />

      <div className="mx-auto w-full max-w-[1240px] flex-1 px-8 py-6">
        <PageHeader
          className="mb-5"
          title="Tenders"
          actions={
            <Link href="/tenders/new" className={buttonVariants({ variant: "accent", size: "lg", className: "min-h-10 whitespace-nowrap" })}>
              Load a tender manually
            </Link>
          }
        />

        {error && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Couldn&apos;t load tenders - try refreshing. If it keeps happening, let us know.
          </div>
        )}

        <BidReadinessCard result={readiness} className="mb-5" />

        <div className="mb-5 grid grid-cols-3 gap-3">
          <StatCard label="Tenders tracked" value={rows.length} />
          <StatCard label="Packs complete" value={completeCount} tone="success" />
          <StatCard label="Not yet complete" value={needsInputCount} tone="warning" />
        </div>

        {/* Each tender is its own flex-wrap row rather than a fixed-column
            grid - this is the first screen after login, checked constantly
            on a phone, and a rigid grid here had no mobile fallback at all. */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {rows.length === 0 && !error && (
            <EmptyState
              icon={FolderOpen}
              title="No tenders yet"
              description={
                <>
                  Check the{" "}
                  <Link href="/discovery" className="font-medium text-foreground underline underline-offset-2">
                    Discovery
                  </Link>{" "}
                  feed for open SANRAL tenders, or{" "}
                  <Link href="/tenders/new" className="font-medium text-foreground underline underline-offset-2">
                    load one manually
                  </Link>{" "}
                  if you already have the documents.
                </>
              }
            />
          )}
          {rows.map((t, i) => {
            const st = statusFor(t);
            const left = daysUntil(t.closing_date);
            return (
              <Link
                key={t.id}
                href={`/tenders/${t.id}`}
                className={`flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-inherit no-underline hover:bg-muted/50 ${i > 0 ? "border-t border-border" : ""}`}
              >
                <div className="min-w-0 flex-1 basis-64">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs font-semibold text-foreground">{t.contract_no ?? "(no reference)"}</span>
                    {t.source === "manual" && (
                      <Badge variant="secondary">{t.family ? "Loaded manually" : "Loaded manually - analysing"}</Badge>
                    )}
                  </div>
                  {t.nra_reference && <div className="mt-px text-xs text-muted-foreground">{t.nra_reference}</div>}
                  <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <StatusBadge status={st.variant}>{st.label}</StatusBadge>
                  <div className="text-xs text-foreground">{t.closing_date ? new Date(t.closing_date).toLocaleDateString() : "-"}</div>
                  {left !== null && <DeadlineChip daysLeft={left} />}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
