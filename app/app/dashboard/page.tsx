import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/dates";
import { AppShell } from "../_components/AppShell";
import { fetchCompanyReadiness } from "@/lib/companyReadinessData";
import { getNotifications } from "@/lib/notifications";
import { nextStepFor } from "@/lib/tenderNextStep";
import { ACTIVE_PURSUIT_STAGES } from "@/lib/discoveryReassessment";
import { PageHeader } from "@/components/tt/page-header";
import { StatCard } from "@/components/tt/stat-card";
import { StatusBadge, type TenderStatus } from "@/components/tt/status-badge";
import { DeadlineChip } from "@/components/tt/deadline-chip";
import { EmptyState } from "@/components/tt/empty-state";
import { BidReadinessCard } from "@/components/tt/bid-readiness-card";
import { NextBestActionCard, type NextBestAction } from "@/components/tt/next-best-action-card";
import { buttonVariants } from "@/components/ui/button";

// This page depends on the signed-in user's session (via RLS) on every
// request, so it can't be prerendered - "instant = false" is Next.js 16's
// Cache Components escape hatch for a route that must block on real,
// per-request data.
export const instant = false;

const CLOSING_SOON_WINDOW_DAYS = 14;
const ACTION_WINDOW_DAYS = 7;

type PackJoin = { status: string; pipeline_stage: string };

type TenderRow = {
  id: string;
  contract_no: string | null;
  nra_reference: string | null;
  description: string | null;
  closing_date: string | null;
  source: string | null;
  family: string | null;
  tender_packs: PackJoin[];
};

type OpportunityRow = {
  id: string;
  contract_number: string | null;
  buyer: string | null;
  title: string | null;
  closing_date: string | null;
  verdict: string;
};

const VERDICT_LABEL: Record<string, string> = { strong_fit: "Strong fit", possible: "Possible", needs_review: "Needs review" };
const VERDICT_TONE: Record<string, string> = {
  strong_fit: "border-success/20 bg-success/10 text-success",
  possible: "border-warning/20 bg-warning/10 text-warning",
  needs_review: "border-warning/20 bg-warning/10 text-warning",
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

function stageOf(tender: TenderRow): string {
  return tender.tender_packs?.[0]?.pipeline_stage ?? "found";
}

function greetingFor(date: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", hour: "numeric", hour12: false }).format(date),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const supabase = await createClient();

  // tenders/tender_packs only come back for the signed-in user's own company,
  // via RLS - this query shape works the same regardless of which company
  // is asking. Same for discovered_opportunities/companies below.
  const [{ data: tenders, error }, readiness, notifications, { data: opportunities }, { data: companyRow }] = await Promise.all([
    supabase
      .from("tenders")
      .select("id, contract_no, nra_reference, description, closing_date, source, family, tender_packs(status, pipeline_stage)")
      .order("closing_date", { ascending: true }),
    fetchCompanyReadiness(supabase),
    getNotifications(supabase),
    supabase
      .from("discovered_opportunities")
      .select("id, contract_number, buyer, title, closing_date, verdict")
      .is("tender_id", null)
      .in("verdict", ["strong_fit", "possible", "needs_review"])
      .order("first_seen", { ascending: false })
      .limit(5),
    supabase.from("companies").select("legal_name, csd_trading_name").maybeSingle(),
  ]);

  if (error) console.error("tenders select failed for dashboard", error);

  const rows = (tenders ?? []) as unknown as TenderRow[];
  const opportunityRows = (opportunities ?? []) as OpportunityRow[];

  const activeBidsCount = rows.filter((t) => ACTIVE_PURSUIT_STAGES.includes(stageOf(t))).length;
  const packsReadyCount = rows.filter((t) => statusFor(t).variant === "ready").length;
  const closingThisWeekCount = rows.filter((t) => {
    const left = daysUntil(t.closing_date);
    return left !== null && left >= 0 && left <= ACTION_WINDOW_DAYS;
  }).length;
  const documentsExpiringCount = notifications.filter((n) => n.kind === "document").length;

  // "Closing soon" timeline - the next 14 days of bids. Bounded and small by
  // construction, which matters: computing each row's specific next step
  // below runs the same real, multi-query compliance/pack-review load the
  // tender workspace itself pays, per tender - fine for a handful of rows,
  // not something to do for the full tender list.
  const closingSoon = rows.filter((t) => {
    const left = daysUntil(t.closing_date);
    return left !== null && left >= 0 && left <= CLOSING_SOON_WINDOW_DAYS;
  });
  const closingSoonSteps = await Promise.all(
    closingSoon.map((t) => nextStepFor(t.id, t.family, (t.tender_packs?.length ?? 0) > 0)),
  );

  // Next best action: the single most urgent thing, in priority order - a
  // near deadline with an incomplete pack, else an expiring document, else
  // a new matching opportunity. closingSoon is already sorted soonest-first
  // (the tenders query orders by closing_date), so the first match here is
  // also the most urgent one.
  let nextBestAction: NextBestAction = { kind: "none" };
  const urgentIndex = closingSoon.findIndex((t) => {
    const left = daysUntil(t.closing_date)!;
    return left <= ACTION_WINDOW_DAYS && statusFor(t).variant !== "ready";
  });
  if (urgentIndex !== -1) {
    const t = closingSoon[urgentIndex];
    const step = closingSoonSteps[urgentIndex];
    const left = daysUntil(t.closing_date)!;
    nextBestAction = {
      kind: "deadline",
      title: t.contract_no ?? t.description ?? "Tender",
      detail: `${left === 0 ? "Closes today" : `Closes in ${left} day${left === 1 ? "" : "s"}`} - ${step?.label ?? "Review compliance"}`,
      daysLeft: left,
      href: step?.href ?? `/tenders/${t.id}`,
    };
  } else {
    const doc = notifications.find((n) => n.kind === "document");
    if (doc) {
      nextBestAction = { kind: "document", title: doc.title, detail: doc.detail, daysLeft: doc.daysLeft, href: doc.href };
    } else if (opportunityRows[0]) {
      const o = opportunityRows[0];
      nextBestAction = {
        kind: "opportunity",
        title: o.contract_number ?? o.title ?? "New opportunity",
        detail: [o.buyer, o.title].filter(Boolean).join(" - ") || "A new tender worth a look",
        href: "/discovery",
      };
    }
  }

  const companyName = companyRow?.csd_trading_name ?? companyRow?.legal_name ?? null;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-8 py-6">
        <PageHeader
          className="mb-5"
          title={`${greetingFor(new Date())}${companyName ? `, ${companyName}` : ""}`}
          description="Here's where things stand."
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

        <div className="mb-5 grid gap-3 lg:grid-cols-2">
          <BidReadinessCard result={readiness} />
          <NextBestActionCard action={nextBestAction} />
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Active bids" value={activeBidsCount} />
          <StatCard label="Packs ready" value={packsReadyCount} tone="success" />
          <StatCard label="Closing this week" value={closingThisWeekCount} tone={closingThisWeekCount > 0 ? "warning" : "default"} />
          <StatCard label="Documents expiring" value={documentsExpiringCount} tone={documentsExpiringCount > 0 ? "destructive" : "default"} />
        </div>

        {rows.length === 0 && !error ? (
          <div className="mb-5 overflow-hidden rounded-lg border border-border bg-card">
            <EmptyState
              icon={FolderOpen}
              title="Let's get your first bid moving"
              description="You haven't tracked any tenders yet - finish a few onboarding gaps below, or go find something to bid on."
              action={
                <div className="flex w-full max-w-md flex-col gap-3">
                  {readiness.blockers.length > 0 && (
                    <ul className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-3 text-left">
                      {readiness.blockers.slice(0, 3).map((b) => (
                        <li key={b.key} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-foreground">{b.label}</span>
                          <Link href={b.href} className="shrink-0 text-xs font-medium text-accent hover:underline">
                            Fix
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Link href="/discovery" className={buttonVariants({ variant: "accent", className: "h-10 flex-1" })}>
                      Browse opportunities
                    </Link>
                    <Link href="/tenders/new" className={buttonVariants({ variant: "outline", className: "h-10 flex-1" })}>
                      Load a tender I already have
                    </Link>
                  </div>
                </div>
              }
            />
          </div>
        ) : (
          <div className="mb-5">
            <h2 className="mb-2 font-display text-lg font-medium text-foreground">Closing soon</h2>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {closingSoon.length === 0 && (
                <div className="px-5 py-6 text-sm text-muted-foreground">Nothing closing in the next {CLOSING_SOON_WINDOW_DAYS} days.</div>
              )}
              {closingSoon.map((t, i) => {
                const left = daysUntil(t.closing_date)!;
                const st = statusFor(t);
                const step = closingSoonSteps[i];
                const badgeText = st.variant === "ready" ? st.label : (step?.label ?? st.label);
                return (
                  <Link
                    key={t.id}
                    href={step?.href ?? `/tenders/${t.id}`}
                    className={`flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-inherit no-underline hover:bg-muted/50 ${i > 0 ? "border-t border-border" : ""}`}
                  >
                    <div className="min-w-0 flex-1 basis-64">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-foreground">{t.contract_no ?? "(no reference)"}</span>
                      </div>
                      {t.nra_reference && <div className="mt-px text-xs text-muted-foreground">{t.nra_reference}</div>}
                      <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <StatusBadge status={st.variant}>{badgeText}</StatusBadge>
                      <div className="text-xs text-foreground">{t.closing_date ? new Date(t.closing_date).toLocaleDateString() : "-"}</div>
                      <DeadlineChip daysLeft={left} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <h2 className="mb-2 font-display text-lg font-medium text-foreground">New opportunities for you</h2>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {opportunityRows.length === 0 && (
              <div className="px-5 py-6 text-sm text-muted-foreground">No new matching opportunities right now - check back soon.</div>
            )}
            {opportunityRows.map((o, i) => {
              const left = daysUntil(o.closing_date);
              return (
                <Link
                  key={o.id}
                  href="/discovery"
                  className={`flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-inherit no-underline hover:bg-muted/50 ${i > 0 ? "border-t border-border" : ""}`}
                >
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-foreground">{o.contract_number ?? "(no reference)"}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${VERDICT_TONE[o.verdict] ?? "border-border bg-muted text-muted-foreground"}`}>
                        {VERDICT_LABEL[o.verdict] ?? o.verdict}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{[o.buyer, o.title].filter(Boolean).join(" - ")}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {left !== null && <DeadlineChip daysLeft={left} />}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
