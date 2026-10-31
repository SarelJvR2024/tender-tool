import Link from "next/link";
import { FolderOpen, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/dates";
import { AppShell } from "../_components/AppShell";
import { fetchCompanyReadiness } from "@/lib/companyReadinessData";
import { getNotifications } from "@/lib/notifications";
import { IN_PROGRESS_STAGES } from "@/lib/pipeline";
import { computeDashboardStats, stageOf } from "@/lib/dashboardStats";
import { loadDocumentExpiryOverview, type DocumentExpiryStatus } from "@/lib/documentExpiry";
import type { StatusChip } from "@/lib/dates";
import { fetchSavingsCounterSummary } from "@/lib/savingsCounterData";
import { fetchAllRows } from "@/lib/supabasePaging";
import { loadDispatchCards, type ActiveBidInput } from "@/lib/dispatchDashboard";
import { SavingsCounterCard } from "@/components/tt/savings-counter-card";
import { PageHeader } from "@/components/tt/page-header";
import { StatCard } from "@/components/tt/stat-card";
import { DeadlineChip } from "@/components/tt/deadline-chip";
import { EmptyState } from "@/components/tt/empty-state";
import { ErrorState } from "@/components/tt/error-state";
import { BidReadinessCard } from "@/components/tt/bid-readiness-card";
import { NextBestActionCard, type NextBestAction } from "@/components/tt/next-best-action-card";
import { SetupChecklistCard, type SetupChecklistItem } from "@/components/tt/setup-checklist-card";
import { CriticalDispatchBanner, NeedsDecisionLane, UrgentActionsLane, DispatchLane, RadarSection } from "@/components/tt/command-center";
import { buttonVariants } from "@/components/ui/button";
import { ChipBadge } from "../company/_components/shared";

// This page depends on the signed-in user's session (via RLS) on every
// request, so it can't be prerendered - "instant = false" is Next.js 16's
// Cache Components escape hatch for a route that must block on real,
// per-request data.
export const instant = false;

const ACTION_WINDOW_DAYS = 7;
// "tenders" (migration 0001: "Shared across every company - not
// tenant-scoped") is unbounded and grows every day the discovery pipeline
// runs - a plain .select() with no .range() silently truncates at
// PostgREST's own 1000-row response cap once the shared table passes that
// size (same bug class as PR #111's marketPricing.ts fix - "silently
// reading a 2.5% sample, not the real table"). Paginated with the same
// fetchAllRows() helper; 20,000 is headroom above any plausible current row
// count, not a measurement - revisit upward if the table ever grows past it.
const TENDERS_FETCH_CAP = 20_000;

type PackJoin = {
  id: string;
  status: string;
  pipeline_stage: string;
  submission_type: string;
  delivery_location: string | null;
  estimated_print_hours: number;
  estimated_transit_hours: number;
  dispatch_status: string;
  courier_contact: string | null;
};

type TenderRow = {
  id: string;
  contract_no: string | null;
  nra_reference: string | null;
  description: string | null;
  buyer: string | null;
  closing_date: string | null;
  briefing_date: string | null;
  briefing_time: string | null;
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

// Vault & Compliance Health / Team & CV Bench widgets (Sarel's own ask) -
// the same 4-state vocabulary lib/documentExpiry.ts's own statusFor()
// already computes, just painted as a ChipBadge instead of this page's own
// (currently unused for this) tone pairs.
const VAULT_STATUS_CHIP: Record<DocumentExpiryStatus, StatusChip> = {
  valid: { label: "Valid", tone: "success" },
  expiring_soon: { label: "Expiring soon", tone: "warning" },
  expired: { label: "Expired", tone: "destructive" },
  missing: { label: "Missing", tone: "muted" },
};

const VERDICT_LABEL: Record<string, string> = { strong_fit: "Strong fit", possible: "Possible", needs_review: "Needs review" };
const VERDICT_TONE: Record<string, string> = {
  strong_fit: "border-success/20 bg-success/10 text-success",
  possible: "border-warning/20 bg-warning/10 text-warning",
  needs_review: "border-warning/20 bg-warning/10 text-warning",
};

// Phase 2 targeted polish (2026-10-23): the greeting prefers csd_trading_name
// already (below) - this only fires when a company has none on file and
// falls back to its registered legal_name, which almost always carries a SA
// entity-type suffix ("Reviewer Civils (Pty) Ltd") that reads badly in
// "Good evening, ...". Strips one recognised suffix word (optionally
// parenthesised) at a time from the end until none remain - display only,
// never stored, never used for matching (lib/onboardingScan.ts's own
// normalizeCompanyName() is the separate, comparison-oriented version of
// this same idea, used to judge whether two names refer to the same
// company, not to shorten one for display).
const COMPANY_NAME_SUFFIX = /[,]?\s*\(?(pty\.?|proprietary|ltd\.?|limited|cc|close\s+corporation|inc\.?|incorporated|co\.?|company)\)?\.?$/i;
function shortCompanyName(name: string): string {
  let s = name.trim();
  for (let i = 0; i < 6; i++) {
    const next = s.replace(COMPANY_NAME_SUFFIX, "").trim();
    if (next === s || next.length === 0) break;
    s = next;
  }
  return s || name.trim();
}

function greetingFor(date: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", hour: "numeric", hour12: false }).format(date),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ docsProcessing?: string }>;
}) {
  const supabase = await createClient();
  const { docsProcessing } = await searchParams;

  // Every read below is a real Supabase round-trip that can genuinely fail
  // (network blip, RLS/session hiccup) - a thrown error here used to crash
  // the whole page with no way back. Caught once, at the top, rather than
  // per-query: the "tenders" query's own {error} field (checked separately
  // below, unchanged) is a softer, partial failure the rest of the page can
  // still render around; a thrown exception from any OTHER read means there
  // is nothing honest left to show, so the whole page falls back to a
  // friendly retry instead of Next's generic error boundary.
  try {
    return await renderDashboard(supabase, docsProcessing === "1");
  } catch (e) {
    console.error("dashboard failed to load", e);
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[1240px] flex-1 px-8 py-6">
          <ErrorState
            action={
              <Link href="/dashboard" className={buttonVariants({ variant: "outline", className: "min-h-11" })}>
                Retry
              </Link>
            }
          />
        </div>
      </AppShell>
    );
  }
}

async function renderDashboard(supabase: Awaited<ReturnType<typeof createClient>>, docsProcessing: boolean) {
  // tenders/tender_packs only come back for the signed-in user's own company,
  // via RLS - this query shape works the same regardless of which company
  // is asking. Same for discovered_opportunities/companies below.
  const [{ rows: tenders, error }, readiness, notifications, { data: opportunities }, { data: companyRow }, savingsSummary, documentExpiryRows, { data: peopleRows }] = await Promise.all([
    fetchAllRows<TenderRow>(
      (from, to) =>
        supabase
          .from("tenders")
          .select(
            "id, contract_no, nra_reference, description, buyer, closing_date, briefing_date, briefing_time, source, family, tender_packs(id, status, pipeline_stage, submission_type, delivery_location, estimated_print_hours, estimated_transit_hours, dispatch_status, courier_contact)",
          )
          .order("closing_date", { ascending: true })
          .range(from, to),
      TENDERS_FETCH_CAP,
    ),
    fetchCompanyReadiness(supabase),
    getNotifications(supabase),
    supabase
      .from("discovered_opportunities")
      .select("id, contract_number, buyer, title, closing_date, verdict")
      .is("tender_id", null)
      .in("verdict", ["strong_fit", "possible", "needs_review"])
      .order("first_seen", { ascending: false })
      .limit(5),
    supabase.from("companies").select("legal_name, csd_trading_name, savings_baseline_hours_per_tender, savings_baseline_hourly_cost_zar").maybeSingle(),
    fetchSavingsCounterSummary(supabase),
    // Vault & Compliance Health / Team & CV Bench widgets (below) - the
    // SAME real rows the Company vault's own "Document expiry" overview
    // already computes (lib/documentExpiry.ts), not a second, possibly-
    // disagreeing read. Was only loaded for isNewCompany before; now always,
    // since both new widgets need it regardless of whether this is a new
    // company.
    loadDocumentExpiryOverview(supabase),
    // Was a head:true count-only query; now also carries signatory_capacity
    // so the setup checklist's "signatory on file" item (below) doesn't need
    // its own extra round trip - same rows, one more column.
    supabase.from("people").select("id, signatory_capacity"),
  ]);

  if (error) console.error("tenders select failed for dashboard", error);

  const rows = tenders as unknown as TenderRow[];
  const opportunityRows = (opportunities ?? []) as OpportunityRow[];
  const peopleCount = peopleRows?.length ?? 0;
  const hasSignatoryCapacity = (peopleRows ?? []).some((p: { signatory_capacity: string | null }) => !!p.signatory_capacity);

  // See lib/dashboardStats.ts's own header for why this can't just filter
  // `rows` directly in place: `rows` is every tender in the shared,
  // not-tenant-scoped `tenders` table, not this company's own list.
  const { myRows, activeBidsCount, packsReadyCount, closingThisWeekCount } = computeDashboardStats(rows, ACTION_WINDOW_DAYS);
  const documentsExpiringCount = notifications.filter((n) => n.kind === "document").length;

  // Tender Command Center (Sarel's own brief, 2026-10-24): every active bid
  // (pipeline_stage still 'found'/'bidding' - IN_PROGRESS_STAGES, same
  // definition the "Active bids" stat card above already uses), classified
  // by lib/dispatchDashboard.ts into the brief's own 4 triage buckets. This
  // replaces the old flat "Closing soon" list and the "deadline" half of
  // Next Best Action - both were a weaker version of the same "what's
  // urgent" question this now answers directly, with a real physical-
  // submission cutoff instead of just the tender's own closing date.
  const activeBids: ActiveBidInput[] = myRows
    // myRows is already "has a real tender_packs row" - t.tender_packs[0]
    // below is never undefined for these.
    .filter((t) => (IN_PROGRESS_STAGES as readonly string[]).includes(stageOf(t)))
    .map((t) => {
      const pack = t.tender_packs[0];
      return {
        tenderId: t.id,
        tenderPackId: pack.id,
        contractNo: t.contract_no,
        description: t.description,
        buyer: t.buyer,
        closingDate: t.closing_date,
        family: t.family,
        briefingDate: t.briefing_date,
        briefingTime: t.briefing_time,
        submissionType: pack.submission_type as ActiveBidInput["submissionType"],
        deliveryLocation: pack.delivery_location,
        estimatedPrintHours: pack.estimated_print_hours,
        estimatedTransitHours: pack.estimated_transit_hours,
        dispatchStatus: pack.dispatch_status as ActiveBidInput["dispatchStatus"],
        courierContact: pack.courier_contact,
        pipelineStage: stageOf(t) as ActiveBidInput["pipelineStage"],
      };
    });
  const dispatchCards = await loadDispatchCards(activeBids, supabase);
  const criticalCards = dispatchCards.filter((c) => c.bucket === "critical");

  // Next best action: now only the fallback for when nothing is dispatch-
  // critical - an expiring document, else a new matching opportunity. The
  // "deadline" case is gone - CriticalDispatchBanner/UrgentActionsLane/
  // NeedsDecisionLane below answer that question more thoroughly (a real
  // print-cutoff, not just the tender's own closing date).
  let nextBestAction: NextBestAction = { kind: "none" };
  if (criticalCards.length === 0) {
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

  const companyName = companyRow?.csd_trading_name ?? (companyRow?.legal_name ? shortCompanyName(companyRow.legal_name) : null);

  // Empty-state setup checklist: a brand-new company (nothing tracked yet,
  // AND a readiness score low enough that it clearly hasn't finished the
  // basics - 50 is the same "accent vs warning" boundary BidReadinessCard's
  // own ring color already uses) gets a fast, 5-item "get set up" checklist
  // instead of a sparse "Closing soon" section with nothing in it. Composed
  // entirely from facts this app already computes - nothing new invented:
  // company_basics/csd/bee are existing readiness.criteria; the tax PIN
  // check reuses lib/documentExpiry.ts's own COMPANY_EXPIRY_FIELDS scan
  // (only "on file or not", same as the other 4 items - its 30-day
  // expiring-soon window doesn't apply here); the CV check reuses
  // ReadinessResult's own peopleWithCvCount count, just against a lower bar
  // (>=1) than the 10-point criterion's own >=2.
  const isNewCompany = myRows.length === 0 && readiness.percent < 50;
  let setupChecklistItems: SetupChecklistItem[] = [];
  if (isNewCompany) {
    const taxRow = documentExpiryRows.find((r) => r.label === "SARS Tax Compliance PIN");
    const basics = readiness.criteria.find((c) => c.key === "company_basics");
    const csd = readiness.criteria.find((c) => c.key === "csd");
    const bee = readiness.criteria.find((c) => c.key === "bee");
    setupChecklistItems = [
      { key: "company_basics", label: "Company profile completed", done: basics?.satisfied ?? false, href: basics?.href ?? "/company#company-identity" },
      { key: "csd", label: "CSD number on file", done: csd?.satisfied ?? false, href: csd?.href ?? "/company#company-identity" },
      { key: "bee", label: "B-BBEE certificate on file", done: bee?.satisfied ?? false, href: bee?.href ?? "/company#bee-cidb" },
      { key: "tax_pin", label: "Tax clearance (SARS TCS PIN) on file", done: !!taxRow && taxRow.status !== "missing", href: "/company#compliance-documents" },
      { key: "people_cvs", label: "At least one person with a CV uploaded", done: readiness.peopleWithCvCount >= 1, href: "/people" },
      {
        // The engine signs SBD 4/SBD 9/Form of Offer off whichever person has
        // people.signatory_capacity set (e.g. "Director") - with none set, a
        // real pack's own prefill score silently drops (confirmed live
        // against Clevapp's real DBSA RFP165/2026 pack, 2026-10-31: 1/26 vs
        // Mzansi demo data's 4/26, purely from this one field being empty).
        // Same "on file or not" shape as the other items here.
        key: "signatory_capacity",
        label: "A signatory's capacity/position on file (e.g. Director)",
        done: hasSignatoryCapacity,
        href: "/people",
      },
      {
        key: "savings_baseline",
        label: "Your time/cost baseline confirmed (for the savings counter)",
        // There's no separate "confirmed" flag - the two columns are always
        // non-null with real defaults (0085) - so this reads as "done" once
        // either default (20 hours, R450) has been changed to the
        // company's own real number, same spirit as the other items here
        // ("on file" rather than merely "has a value").
        done: companyRow?.savings_baseline_hours_per_tender !== 20 || companyRow?.savings_baseline_hourly_cost_zar !== 450,
        href: "/company#savings-baseline",
      },
    ];
  }

  // Vault & Compliance Health / Team & CV Bench (Sarel's own ask) - split
  // from the SAME documentExpiryRows the Company vault page already shows,
  // by the id prefix loadDocumentExpiryOverview() already gives each row
  // (company:* for the 7 vault documents, person:* for per-person ECSA/
  // SACPCMP registrations - "only shown once someone has one on file",
  // same as the vault page itself). Never a second, independently-computed
  // status for either.
  const vaultRows = documentExpiryRows.filter((r) => r.id.startsWith("company:"));
  const personExpiryRows = documentExpiryRows.filter((r) => r.id.startsWith("person:"));
  const vaultValidCount = vaultRows.filter((r) => r.status === "valid").length;
  const vaultNeedsAttention = vaultRows.length - vaultValidCount;
  const vaultCompliancePct = vaultRows.length === 0 ? 100 : Math.round((vaultValidCount / vaultRows.length) * 100);

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
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>Couldn&apos;t load tenders - try refreshing. If it keeps happening, let us know.</span>
            <Link href="/dashboard" className={buttonVariants({ variant: "outline", size: "sm", className: "min-h-11 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 sm:min-h-9" })}>
              Retry
            </Link>
          </div>
        )}

        {docsProcessing && (
          <div className="mb-5 rounded-lg border border-info/20 bg-info/10 px-4 py-3 text-sm text-info">
            Your documents are being processed in the background. We&apos;ll alert you when they&apos;re ready to review.
          </div>
        )}

        <div className="mb-5 grid gap-3 lg:grid-cols-2">
          <BidReadinessCard result={readiness} />
          <NextBestActionCard action={nextBestAction} />
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Active bids" value={activeBidsCount} />
          <StatCard label="Packs ready" value={packsReadyCount} tone={packsReadyCount > 0 ? "success" : "default"} />
          <StatCard label="Closing this week" value={closingThisWeekCount} tone={closingThisWeekCount > 0 ? "warning" : "default"} />
          <StatCard label="Documents expiring" value={documentsExpiringCount} tone={documentsExpiringCount > 0 ? "destructive" : "default"} />
        </div>

        <div className="mb-5 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-sm font-medium text-foreground">Vault &amp; compliance health</h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                  vaultNeedsAttention === 0 ? "border-success/20 bg-success/10 text-success" : "border-warning/20 bg-warning/10 text-warning"
                }`}
              >
                {vaultCompliancePct}% compliant{vaultNeedsAttention > 0 ? ` · ${vaultNeedsAttention} need${vaultNeedsAttention === 1 ? "s" : ""} attention` : ""}
              </span>
            </div>
            {vaultRows.length === 0 ? (
              <div className="text-xs text-muted-foreground">No compliance documents tracked yet.</div>
            ) : (
              <div className="flex flex-col">
                {vaultRows.map((r) => (
                  <Link key={r.id} href={r.href} className="flex items-center justify-between gap-2 border-t border-border py-2 text-inherit no-underline first:border-t-0 hover:bg-muted/50">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{r.label}</span>
                    <ChipBadge status={VAULT_STATUS_CHIP[r.status]} />
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-sm font-medium text-foreground">Team &amp; CV bench</h2>
              <Link href="/people" className="text-xs font-semibold text-accent no-underline hover:underline">
                View team →
              </Link>
            </div>
            <div className="text-xs text-foreground">
              <span className="font-semibold">{peopleCount ?? 0}</span> team profile{(peopleCount ?? 0) === 1 ? "" : "s"} ·{" "}
              <span className="font-semibold">{readiness.peopleWithCvCount}</span> with a CV on file
            </div>
            {personExpiryRows.length > 0 ? (
              <div className="mt-2 flex flex-col">
                {personExpiryRows.map((r) => (
                  <Link key={r.id} href={r.href} className="flex items-center justify-between gap-2 border-t border-border py-2 text-inherit no-underline first:border-t-0 hover:bg-muted/50">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{r.label}</span>
                    <ChipBadge status={VAULT_STATUS_CHIP[r.status]} />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-muted-foreground">No ECSA/SACPCMP registrations on file need attention.</div>
            )}
            <Link href="/people" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3 min-h-9 w-full" })}>
              Upload a CV
            </Link>
          </div>
        </div>

        <div className="mb-5">
          <SavingsCounterCard summary={savingsSummary} />
        </div>

        {isNewCompany ? (
          // New-company setup checklist (app/AGENTS.md "Home cockpit"): takes
          // over this whole section - the unmissable, actionable version of
          // "nothing here yet" for a company with essentially no data on
          // file, replacing the generic empty-state-plus-top-3-blockers below
          // (same facts, one focused checklist instead of two overlapping
          // "things to fix" lists).
          <div className="mb-5 flex flex-col gap-3">
            <SetupChecklistCard items={setupChecklistItems} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/discovery" className={buttonVariants({ variant: "accent", className: "min-h-11 flex-1" })}>
                Browse opportunities
              </Link>
              <Link href="/tenders/new" className={buttonVariants({ variant: "outline", className: "min-h-11 flex-1" })}>
                Load a tender I already have
              </Link>
            </div>
          </div>
        ) : myRows.length === 0 && !error ? (
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
          <div className="mb-5 flex flex-col gap-5">
            {/* Tender Command Center (Sarel's own brief, 2026-10-24) - Zone 1 */}
            <CriticalDispatchBanner cards={criticalCards} />

            {/* Zone 2: the 3 operational lanes */}
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <h2 className="mb-2 font-display text-base font-medium text-foreground">Needs decision</h2>
                <NeedsDecisionLane cards={dispatchCards} />
              </div>
              <div>
                <h2 className="mb-2 font-display text-base font-medium text-foreground">Urgent actions &amp; blocked items</h2>
                <UrgentActionsLane cards={dispatchCards} />
              </div>
              <div>
                <h2 className="mb-2 font-display text-base font-medium text-foreground">Dispatch &amp; delivery</h2>
                <DispatchLane cards={dispatchCards} />
              </div>
            </div>

            {/* Zone 3: Radar / can wait */}
            <RadarSection cards={dispatchCards} />
          </div>
        )}

        <div>
          <h2 className="mb-2 font-display text-lg font-medium text-foreground">New opportunities for you</h2>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {opportunityRows.length === 0 && (
              <EmptyState icon={Search} title="No new opportunities yet" description="No new matching opportunities right now - check back soon." />
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
