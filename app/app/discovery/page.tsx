import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_components/AppShell";
import { ScrollFade } from "../_components/ScrollFade";
import { expandDisciplines, loadDisciplineTaxonomy, taxonomyLabel } from "@/lib/disciplineTaxonomy";
import { pursueOpportunity } from "./actions";
import {
  CHANGE_LABELS,
  changeTone,
  groupByOcid,
  listingSourceLabels,
  type ListingChange,
  type ListingSource,
} from "@/lib/listingChanges";
import { DowngradeFlag } from "./downgrade-flag";
import {
  ACTIVE_PURSUIT_STAGES,
  DOWNGRADE_COLUMNS,
  isDowngraded,
  isOpenDowngrade,
  verdictLabel,
  type Downgrade,
} from "@/lib/discoveryReassessment";
import { EmptyState } from "@/components/tt/empty-state";
import { ErrorState } from "@/components/tt/error-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Inbox } from "lucide-react";
import { canLoadMore, COUNTABLE_FILTERS, hasMore, nextShow, parseShowParam, verdictQuerySpec } from "@/lib/discoveryPagination";
import { closingCountdown } from "@/lib/dates";
import { fetchCompanyReadiness } from "@/lib/companyReadinessData";
import { buildDoneHistory, pricingCategoriesFor, pricingSegmentKey, similarTendersBefore } from "@/lib/opportunityInsights";
import { MIN_SAMPLE, benchmark, loadSegment, segmentsFor, type Benchmark } from "@/lib/marketPricing";
import { formatRand } from "@/lib/dealEconomics";
import { OpportunityPreferencesPanel } from "./OpportunityPreferencesPanel";
import { hasNoTaggedDisciplines } from "@/lib/disciplineTaggingNudge";

// Column list for the scope/pricing-model/value-band record (migration 0060,
// engine/discovery/tender_enrichment.py). Honestly rare today: that script is
// never invoked by the production discovery fan-out (checked - nothing in
// engine/discovery/*.py calls it outside its own test), so this map is empty
// for almost every row. Shown only when a row genuinely has one - never
// faked. Wiring the enrichment script into the pipeline is a Python/engine
// change, outside this PR's own ground rule (see docs/specs/System-Status.md).
const SCOPE_RECORD_COLUMNS = "tender_id, scope_summary, scope_source, pricing_model, value_band, value_band_basis, confidence";
type ScopeRecord = {
  tender_id: string;
  scope_summary: string | null;
  scope_source: string | null;
  pricing_model: string | null;
  value_band: string | null;
  value_band_basis: string;
  confidence: string;
};
const PRICING_MODEL_LABEL: Record<string, string> = {
  lump_sum: "Lump sum",
  schedule_of_rates: "Schedule of rates",
  boq_based: "Bill of quantities",
  cost_reimbursable: "Cost reimbursable",
  remeasurement: "Remeasurement",
  time_based: "Time-based",
};

// Hard cap on distinct market-pricing lookups (lib/marketPricing.ts's
// loadSegment) per page render, keyed by discipline mix rather than by row.
// Pagination (lib/discoveryPagination.ts, PR #123) already bounds how many
// cards can be in `visibleRows` at once (MAX_SHOW=300, default PAGE_SIZE=30)
// - well under this cap - so in practice this rarely if ever binds anymore.
// Kept anyway as a correct, now-largely-redundant-but-harmless belt-and-
// braces cap: removing a cap just because it stopped being the active
// constraint is how caps quietly disappear, and a distinct-discipline-mix
// count could in principle still exceed it even with row count bounded.
// Exactly the interaction PR #123's own AGENTS.md entry predicted, not a bug
// to "fix" here.
const MAX_PRICING_LOOKUPS = 40;

// Reads the signed-in user's company via RLS on every request (same reasoning
// as app/app/dashboard/page.tsx) - can't be prerendered.
export const instant = false;

type DocumentUrl = { url: string | null; title: string | null };

type OpportunityRow = Downgrade & {
  id: string;
  contract_number: string | null;
  buyer: string | null;
  title: string | null;
  closing_date: string | null;
  categories: string[] | null;
  verdict: string;
  reasons: string[] | null;
  document_urls: DocumentUrl[] | null;
  first_seen: string;
  // engine/discovery/score_outlook.py's result (migration 0013) - null for
  // rows assessed before it existed.
  score_outlook: { estimable?: string; summary?: string[] } | null;
  // 0024: the tender this opportunity became (pursued, or loaded manually).
  tender_id: string | null;
  source: string | null;
  // 0051: where it is listed + the listing's own facts (gov_sources.py).
  ocid: string | null;
  listing_sources: ListingSource[] | null;
  province: string | null;
  tender_type: string | null;
  briefing: { date?: string | null; compulsory?: boolean | null; venue?: string | null } | null;
  listing_status: string | null;
  // 0054 (audit O1): the buyer's own eTenders category - a cross-check on
  // `categories`, never used for the verdict. Null = not read.
  etenders_category: string | null;
  etenders_category_check: { status: "agrees" | "differs" | "generic" | "unmapped"; note: string; matching_categories: string[] } | null;
};

// Design-system audit fix (2026-10-21): soft-tint token classes, not stale hex.
const XREF_STYLE: Record<string, { label: string; chipClass: string }> = {
  agrees: { label: "agrees", chipClass: "bg-success/10 text-success" },
  differs: { label: "differs - check", chipClass: "bg-warning/10 text-warning" },
  generic: { label: "catch-all bucket", chipClass: "bg-muted text-muted-foreground" },
  unmapped: { label: "not cross-referenced yet", chipClass: "bg-muted text-muted-foreground" },
};

type VerdictFilter = "all" | "strong_fit" | "needs_review" | "not_a_fit" | "changed" | "reassessed";

const FILTERS: { key: VerdictFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "strong_fit", label: "Strong fit" },
  { key: "needs_review", label: "Needs review" },
  { key: "not_a_fit", label: "Not a fit" },
  // Tenders whose listing changed since it was found: cancelled, closing
  // date moved, addendum listed... (tender_listing_changes, 0051).
  { key: "changed", label: "Changed" },
  // 0055: a re-assessment made the verdict worse (still flagged or already seen).
  { key: "reassessed", label: "Re-assessed" },
];

const SAST_DATE: Intl.DateTimeFormatOptions = { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric" };
const SAST_DATETIME: Intl.DateTimeFormatOptions = { ...SAST_DATE, hour: "2-digit", minute: "2-digit" };

// Design-system audit fix (2026-10-21): soft-tint token classes, not stale hex.
function verdictChip(verdict: string): { label: string; chipClass: string } {
  switch (verdict) {
    case "strong_fit":
      return { label: "Strong fit", chipClass: "bg-success/10 text-success" };
    case "possible":
      return { label: "Possible", chipClass: "bg-warning/10 text-warning" };
    case "needs_review":
      return { label: "Needs review", chipClass: "bg-warning/10 text-warning" };
    case "not_a_fit":
      return { label: "Not a fit", chipClass: "bg-destructive/10 text-destructive" };
    case "closed":
      return { label: "Closed", chipClass: "bg-muted text-muted-foreground" };
    default:
      return { label: verdict, chipClass: "bg-muted text-muted-foreground" };
  }
}

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ verdict?: string; error?: string; show?: string }>;
}) {
  const { verdict: verdictParam, error: actionError, show: showParam } = await searchParams;
  const activeFilter: VerdictFilter = FILTERS.some((f) => f.key === verdictParam)
    ? (verdictParam as VerdictFilter)
    : "all";
  // Scaling fix (see lib/discoveryPagination.ts): a growing "show" window
  // instead of fetching this company's entire scored history on every load.
  const show = parseShowParam(showParam);

  try {
    return await renderDiscovery(activeFilter, actionError, show);
  } catch (e) {
    console.error("discovery page failed to load", e);
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
          <ErrorState
            action={
              <Link href="/discovery" className={buttonVariants({ variant: "outline", className: "min-h-11" })}>
                Retry
              </Link>
            }
          />
        </div>
      </AppShell>
    );
  }
}

// Applies the verdictQuerySpec() predicate (lib/discoveryPagination.ts) to a
// discovered_opportunities query builder. Kept as one tiny function so the
// main row query and every count query build their WHERE clause from the
// exact same pure mapping - no risk of the two drifting apart.
function withVerdictSpec<Q extends { eq: (c: string, v: string) => Q; in: (c: string, v: string[]) => Q; not: (c: string, op: string, v: null) => Q }>(
  query: Q,
  filter: VerdictFilter,
): Q {
  const spec = verdictQuerySpec(filter);
  if (spec.kind === "eq") return query.eq(spec.column, spec.value);
  if (spec.kind === "in") return query.in(spec.column, spec.values);
  if (spec.kind === "not_null") return query.not(spec.column, "is", null);
  return query;
}

async function renderDiscovery(activeFilter: VerdictFilter, actionError: string | undefined, show: number) {
  const supabase = await createClient();
  const taxonomy = await loadDisciplineTaxonomy(supabase); // category labels (0040)

  // Scaling fix (Sarel, 2026-10-23: "filtering tenders is going to be
  // critical with the load" - see lib/discoveryPagination.ts's own module
  // comment for the full root-cause writeup and the marketPricing.ts/PR #111
  // precedent). discovered_opportunities accumulates one row per OCDS
  // release ever scored against this company, forever - this used to
  // `.select()` that whole table, unbounded, on every load. Now: a growing
  // `.range(0, show)` window (fetching show+1 to know if "Load more" should
  // show), the verdict filter tabs pushed into the query itself (`eq`/`in`
  // on the indexed `verdict` column, or `downgraded_from is not null` for
  // Re-assessed - a real column predicate, not a JS scan), and the per-tab
  // counts as their own {count:"exact", head:true} queries (no row data
  // transferred) rather than scanning the full in-memory array.
  let opportunityQuery = supabase
    .from("discovered_opportunities")
    .select(`id, contract_number, buyer, title, closing_date, categories, verdict, reasons, document_urls, first_seen, score_outlook, tender_id, source, ocid, listing_sources, province, tender_type, briefing, listing_status, etenders_category, etenders_category_check, ${DOWNGRADE_COLUMNS}`)
    .order("first_seen", { ascending: false })
    .order("id", { ascending: false }); // deterministic tiebreak only - not an indexed column, just keeps "top N" stable across requests
  opportunityQuery = withVerdictSpec(opportunityQuery, activeFilter);

  const [
    { data: opportunities, error },
    { data: packRows },
    { data: labelRows },
    { data: openDowngradeRows, count: openDowngradeTotal, error: openDowngradeError },
    readiness,
    { data: pursuedHistoryRows, error: pursuedHistoryError },
    { data: experienceDisciplineRows, error: experienceDisciplineError },
  ] = await Promise.all([
    opportunityQuery.range(0, show), // show+1 rows: the "fetch one extra" trick, see hasMore()
    // RLS: this company's own packs - which re-assessed tenders it is working on.
    supabase.from("tender_packs").select("tender_id, pipeline_stage"),
    supabase.rpc("company_member_labels"),
    // The "no longer as good a fit" banner needs an ACCURATE count across the
    // company's full history, not just this page - downgraded_from/
    // downgrade_acknowledged_at are real columns, so this is a real,
    // separately-scoped query (never the full table: only ever-downgraded,
    // not-yet-acknowledged rows, which in practice stays small - these are
    // exactly the rows someone still needs to act on). count:"exact" is
    // accurate even past PostgREST's 1000-row *data* cap (same Content-Range
    // "0-999/39536" behaviour marketPricing.ts's own fix found - the count is
    // never truncated, only the row data is); the row data itself is capped
    // at 200 for the "N you are working on" sub-count below, with an honest
    // "+" shown if a company somehow has more open downgrades than that.
    supabase
      .from("discovered_opportunities")
      .select("tender_id", { count: "exact" })
      .not("downgraded_from", "is", null)
      .is("downgrade_acknowledged_at", null)
      .range(0, 199),
    // Opportunities card enrichment (PR #120, Sarel's live feedback 2026-10-
    // 22): company-wide bid-readiness score, reused as-is from Home/Company
    // vault - called once per page render, not once per card, since there is
    // no per-tender compliance requirement to check against before a tender
    // is pursued.
    fetchCompanyReadiness(supabase),
    // "Done N similar tenders before" (PR #120) needs this company's FULL
    // pursued history, not the paginated/filtered `rows` window above (PR
    // #123's own scaling fix, see lib/discoveryPagination.ts) - feeding the
    // windowed rows into buildDoneHistory() would silently undercount
    // history matches for any company with more pursued history than
    // whatever's currently loaded. Mirrors app/app/pipeline/page.tsx's own
    // identical fix after PR #123: a company's own pursued pipeline is
    // naturally small (one row per OCDS release that became a REAL tender
    // via pursue_discovered_opportunity(), which always backfills tender_id
    // - verified across migrations 0018/0024/0051, same reasoning as
    // pipeline/page.tsx's own comment on this exact query), unlike the full
    // scored-opportunity table this page itself must paginate - so it gets
    // its own small, targeted, un-paginated query instead of needing
    // pagination of its own.
    supabase
      .from("discovered_opportunities")
      .select("tender_id, buyer, categories")
      .not("tender_id", "is", null),
    // Task item 3 (app/AGENTS.md): the "needs review because we don't know
    // your disciplines yet" nudge - see lib/disciplineTaggingNudge.ts's own
    // header comment for the exact engine condition this mirrors
    // (profile_from_company_rows()'s known_disciplines). RLS-scoped to this
    // company's own experience_items, same table app/app/experience/page.tsx
    // already reads - no new table, no scoring change.
    supabase.from("experience_items").select("tagged_at, disciplines"),
  ]);
  if (error) console.error("discovered_opportunities select failed", error);
  if (openDowngradeError) console.error("open-downgrade banner count failed", openDowngradeError);
  if (pursuedHistoryError) console.error("pursued-history select failed (done-before history)", pursuedHistoryError);
  if (experienceDisciplineError) console.error("experience_items select failed (discipline-tagging nudge)", experienceDisciplineError);
  const noTaggedDisciplines = hasNoTaggedDisciplines((experienceDisciplineRows ?? []) as { tagged_at: string | null; disciplines: string[] | null }[]);
  const { data: { user } } = await supabase.auth.getUser();
  const stageByTender = new Map<string, string>();
  // Any stage at all (not just ACTIVE_PURSUIT_STAGES) - "done before" needs
  // to know about submitted/won/lost tenders too, not just ones still being
  // actively worked.
  const stageByTenderAnyStage = new Map<string, string>();
  for (const p of (packRows ?? []) as { tender_id: string; pipeline_stage: string | null }[]) {
    if (!p.pipeline_stage) continue;
    stageByTenderAnyStage.set(p.tender_id, p.pipeline_stage);
    if (ACTIVE_PURSUIT_STAGES.includes(p.pipeline_stage)) stageByTender.set(p.tender_id, p.pipeline_stage);
  }
  // "Done N similar tenders before" (see the pursuedHistoryRows query above
  // for why this is its own dedicated, un-paginated query rather than the
  // windowed `rows` below).
  const doneHistory = buildDoneHistory(
    ((pursuedHistoryRows ?? []) as { tender_id: string; buyer: string | null; categories: string[] | null }[]).map((r) => ({
      tenderId: r.tender_id,
      buyer: r.buyer,
      categories: r.categories,
    })),
    stageByTenderAnyStage,
  );
  const labels = new Map<string, string>();
  for (const r of (labelRows ?? []) as { user_id: string; label: string }[]) labels.set(r.user_id, r.label);
  const whoAcknowledged = (id: string | null) => (!id ? null : id === user?.id ? "you" : labels.get(id) ?? "a former member");

  const fetchedRows = (opportunities ?? []) as unknown as OpportunityRow[];
  const moreBeyondWindow = hasMore(fetchedRows.length, show);
  // A downgrade nobody has marked seen yet comes first within this window
  // (the order is otherwise newest-found-first) - same bump as before,
  // just now scoped to the loaded window rather than the full table: an
  // open downgrade older than whatever's currently loaded on the "All" tab
  // won't visually float to the top the way it used to when everything was
  // fetched at once. That's fine, not a silent loss - the banner above is
  // computed from its own full-history, un-paginated count (openDowngradeCount,
  // below) so it always tells the truth about how many exist, and its "Show
  // re-assessed tenders" link goes to the Re-assessed tab, which IS a real
  // full-history filter (downgraded_from is not null, pushed into the
  // query itself) with its own "Load more" - so every open downgrade is
  // always reachable, just not always on the very first screen of "All".
  const rows = fetchedRows
    .slice(0, show)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(isOpenDowngrade(b.r)) - Number(isOpenDowngrade(a.r)) || a.i - b.i)
    .map(({ r }) => r);

  const openDowngradeTenderIds = new Set(((openDowngradeRows ?? []) as { tender_id: string | null }[]).map((r) => r.tender_id).filter((id): id is string => !!id));
  const openDowngradeCount = openDowngradeTotal ?? openDowngradeTenderIds.size;
  const openDowngradeCountTruncated = openDowngradeCount > 200 && (openDowngradeRows ?? []).length >= 200;
  let openPursuedCount = 0;
  for (const id of openDowngradeTenderIds) if (stageByTender.has(id)) openPursuedCount++;

  // Per-tab counts: one cheap {count:"exact", head:true} query per countable
  // filter, run in parallel - never a full-table scan. "changed" has no
  // count here (see below); "all"'s count is likewise a real query, not
  // `rows.length`, since `rows` is only the current window. Kicked off here
  // (depends on nothing computed from `rows`) so it runs concurrently with
  // the listing-changes lookup just below, not after it.
  const countEntriesPromise = Promise.all(
    COUNTABLE_FILTERS.map(async (f) => {
      let q = supabase.from("discovered_opportunities").select("id", { count: "exact", head: true });
      q = withVerdictSpec(q, f);
      const { count, error: countError } = await q;
      if (countError) console.error(`discovered_opportunities count failed for filter=${f}`, countError);
      return [f, count ?? 0] as const;
    }),
  );

  // Listing changes on these tenders (public listing facts, readable by any
  // signed-in user - 0051). Scoped to this window's ocids only now that the
  // window itself is bounded (item 5: falls out for free from pagination,
  // no separate work needed) - chunked so the in.() list stays a sane URL
  // length regardless.
  const ocids = [...new Set(rows.map((r) => r.ocid).filter((o): o is string => !!o))];
  const changeRows: ListingChange[] = [];
  for (let i = 0; i < ocids.length; i += 150) {
    const { data } = await supabase
      .from("tender_listing_changes")
      .select("id, ocid, change_type, summary, evidence_url, source_timestamp, detected_at")
      .in("ocid", ocids.slice(i, i + 150));
    changeRows.push(...((data ?? []) as ListingChange[]));
  }
  const changesByOcid = groupByOcid(changeRows);
  const changesFor = (r: OpportunityRow) => (r.ocid ? changesByOcid.get(r.ocid) ?? [] : []);

  // "Changed" is the one tab that genuinely can't reduce to a WHERE clause
  // (it needs tender_listing_changes, which isn't a column on this row) -
  // an honest, scoped limitation (see app/AGENTS.md): it only ever searches
  // whatever window is currently loaded, not this company's full history.
  // Computed without an extra query only when that tab is actually active;
  // counts[] below is null for "changed" otherwise rather than a fake number.
  const changedVisible = activeFilter === "changed" ? rows.filter((r) => changesFor(r).length > 0) : rows;

  const countEntries = await countEntriesPromise;
  const counts: Record<VerdictFilter, number | null> = { changed: activeFilter === "changed" ? changedVisible.length : null } as Record<VerdictFilter, number | null>;
  for (const [f, c] of countEntries) counts[f] = c;

  const visibleRows = activeFilter === "changed" ? changedVisible : rows;

  // Scope/pricing-model/value-band record (0060) for tenders this company has
  // already pursued - per already-pursued row, not history-wide, so it's
  // unaffected by the pagination fix: scoped to the current visibleRows
  // window the same way the listing-changes lookup above is. Batched +
  // chunked the same way, never one query per card.
  const pursuedTenderIds = [...new Set(visibleRows.map((r) => r.tender_id).filter((id): id is string => !!id))];
  const scopeRows: ScopeRecord[] = [];
  for (let i = 0; i < pursuedTenderIds.length; i += 150) {
    const { data } = await supabase.from("tender_scope_records").select(SCOPE_RECORD_COLUMNS).in("tender_id", pursuedTenderIds.slice(i, i + 150));
    scopeRows.push(...((data ?? []) as ScopeRecord[]));
  }
  const scopeByTenderId = new Map(scopeRows.map((r) => [r.tender_id, r]));

  // Market pricing range ("something more indicative than just the tender",
  // Sarel 2026-10-22) - reuses the EXISTING MIN_SAMPLE-gated benchmark system
  // (lib/marketPricing.ts, already live on the Tender Workspace's own Market
  // tab) rather than tender_scope_records.value_band, which is unpopulated
  // today (see SCOPE_RECORD_COLUMNS comment above). Deduped by discipline mix
  // and capped at MAX_PRICING_LOOKUPS real queries - operates on whatever
  // cards are in the CURRENT visibleRows window, which is fine: pagination
  // (PR #123) already means fewer cards per page than before, so this cap
  // will rarely if ever bind now (see the MAX_PRICING_LOOKUPS comment above -
  // a correct, now-largely-redundant-but-harmless interaction, not something
  // to "fix"). All-buyers segment only (not buyer-specific): a per-buyer
  // lookup would multiply the dedup key space by every distinct buyer name
  // on the page, defeating the cap.
  const pricingSegments = new Map<string, string[]>();
  for (const o of visibleRows) {
    const cats = pricingCategoriesFor(o.categories);
    if (cats.length === 0) continue;
    const expanded = expandDisciplines(taxonomy, cats);
    const key = pricingSegmentKey(expanded);
    if (!pricingSegments.has(key) && pricingSegments.size >= MAX_PRICING_LOOKUPS) continue;
    pricingSegments.set(key, expanded);
  }
  const pricingByKey = new Map<string, Benchmark>();
  await Promise.all(
    [...pricingSegments.entries()].map(async ([key, expanded]) => {
      const segs = segmentsFor({ buyerLabel: "", isSanral: false, categories: expanded, categoryLabel: "" });
      const allBuyersSeg = segs.find((s) => s.key === "all");
      if (!allBuyersSeg) return;
      const { rows: segRows } = await loadSegment(supabase, allBuyersSeg);
      const b = benchmark(segRows);
      if (b.contractSize.n >= MIN_SAMPLE) pricingByKey.set(key, b);
    }),
  );
  const pricingFor = (o: OpportunityRow): Benchmark | null => {
    const cats = pricingCategoriesFor(o.categories);
    if (cats.length === 0) return null;
    return pricingByKey.get(pricingSegmentKey(expandDisciplines(taxonomy, cats))) ?? null;
  };

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-80">
            <h1 className="mb-1 font-display text-xl font-medium text-foreground sm:text-2xl">Opportunities</h1>
            <p className="text-sm text-muted-foreground">
              Government tenders - national, provincial, municipal and state-owned buyers - scored against your company
              profile. Read daily from National Treasury&apos;s eTenders portal (every buyer that publishes there) plus
              SANRAL, Eskom, Transnet and the City of Cape Town&apos;s own sites, with cancellations, moved closing dates
              and addenda tracked. Not covered: private-sector work, and municipal notices that never reach eTenders
              or one of those sites.
            </p>
          </div>
          {/* A tender that isn't in this feed (SANRAL's own portal, a forwarded
              RFQ, a buyer not on eTenders) - migration 0024. */}
          <Link href="/tenders/new" className={buttonVariants({ variant: "outline", className: "min-h-11 shrink-0 whitespace-nowrap" })}>
            Found one elsewhere? Load it manually
          </Link>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Couldn&apos;t load discovered opportunities - try refreshing. If it keeps happening, let us know.
          </div>
        )}
        {actionError && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {actionError}
          </div>
        )}

        {/* Opportunity preferences (preview) - Sarel's own live feedback,
            this session: "add options to set the opportunity preferences
            for a company" + the SANRAL case. A new, additive section - the
            filter-tab bar and everything below it is untouched. See
            OpportunityPreferencesPanel.tsx's own header comment for why this
            is a preview, not the real saved feature. */}
        <OpportunityPreferencesPanel taxonomy={taxonomy} />

        {noTaggedDisciplines && (
          // Task item 3: honest, zero-schema nudge - the real reason a
          // brand-new company (or one that hasn't tagged any Experience
          // Library items yet) sees "Needs review" on tenders that don't
          // clearly match or not-match (see disciplineTaggingNudge.ts).
          <div className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            Your Experience Library has no tagged disciplines yet, so we can&apos;t yet tell which tenders are really
            your kind of work - that&apos;s why some show as &quot;Needs review&quot; rather than a tighter match either
            way. <Link href="/experience" className="font-semibold text-foreground underline">Tag your past projects</Link> to
            get sharper results.
          </div>
        )}

        {openDowngradeCount > 0 && (
          <div
            className={cn(
              "mb-4 rounded-lg border px-4 py-3 text-sm",
              openPursuedCount ? "border-destructive/20 bg-destructive/10 text-destructive" : "border-warning/30 bg-warning/10 text-warning",
            )}
          >
            <strong>
              &#9888; {openDowngradeCountTruncated ? `${openDowngradeCount}+` : openDowngradeCount} tender{openDowngradeCount === 1 ? " is" : "s are"} no longer as good a fit as when
              {openDowngradeCount === 1 ? " it was" : " they were"} found
            </strong>
            {openPursuedCount > 0 && (
              <> - including {openPursuedCount}
                {openDowngradeCountTruncated ? "+" : ""} you are working on</>
            )}.{" "}
            {openDowngradeCount === 1 ? "It was" : "They were"} scored again (usually because your company profile changed) and came out
            worse. {openDowngradeCount === 1 ? "It is" : "Each is"} flagged below until someone in your company marks it as seen.{" "}
            <a href="/discovery?verdict=reassessed" className="font-semibold text-foreground">Show re-assessed tenders</a>
          </div>
        )}

        <div className="relative mb-5">
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
            {FILTERS.map((f) => {
              const isActive = f.key === activeFilter;
              return (
                <a
                  key={f.key}
                  href={f.key === "all" ? "/discovery" : `/discovery?verdict=${f.key}`}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold no-underline",
                    isActive ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground",
                  )}
                >
                  {f.label}
                  <span
                    title={counts[f.key] === null ? "Only counted while this tab is open - see the note below" : undefined}
                    className={cn(
                      "flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                      isActive ? "bg-background/20 text-background" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {counts[f.key] ?? "–"}
                  </span>
                </a>
              );
            })}
          </div>
          {/* Same unmarked-horizontal-scroll issue as the pipeline board: once
              the filter chips overflow (any viewport narrower than they are),
              nothing hints there's more to the right. */}
          <ScrollFade fadeColor="244, 245, 247" minWidthToHide={900} />
        </div>

        {activeFilter === "changed" && (
          // Honest, scoped limitation (task item 4 / app/AGENTS.md): Changed
          // needs a cross-reference against tender_listing_changes, which
          // isn't a column on discovered_opportunities, so it can't be an
          // indexed WHERE clause the way Re-assessed now is. It only ever
          // searches whatever window is loaded below, not this company's
          // full scored history - "Load more" extends how far back it looks.
          <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
            Showing listing changes found among the {Math.min(show, rows.length)} most recently discovered tenders only - older
            history isn&apos;t scanned yet. Click &quot;Load more&quot; below to check further back.
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {visibleRows.length === 0 && !error && (
            <div className="rounded-lg border border-border bg-card">
              <EmptyState
                icon={Inbox}
                title={activeFilter !== "all" ? "Nothing matches this filter" : "Nothing scored yet"}
                description={
                  activeFilter === "changed"
                    ? "No listing changes among the tenders loaded so far - try \"Load more\" to check further back."
                    : activeFilter !== "all"
                      ? "Try \"All\" to see everything scored so far."
                      : // Task item 4 (app/AGENTS.md): sharpened for the real
                        // daily-cadence timing gap (.github/workflows/daily-
                        // discovery.yml, scheduled 02:45 UTC) - a company
                        // created between runs can see an empty feed for up
                        // to ~24h, which is expected, not broken. Honest
                        // about the cadence rather than implying anything
                        // instant or on-demand (no on-demand scan exists or
                        // is safe to add blind - see app/AGENTS.md).
                        "The daily scan checks every open tender against your company profile automatically - it runs once a day, overnight. If you just signed up or changed your company profile, your first results land after tonight's run, not immediately. You can also load a tender you've already found with the button above."
                }
              />
            </div>
          )}
          {visibleRows.map((o) => {
            const chip = verdictChip(o.verdict);
            const docs = (o.document_urls ?? []).filter((d) => d.url);
            const changes = changesFor(o);
            const facts = [o.province, o.tender_type].filter(Boolean).join(" · ");
            const pursuingStage = o.tender_id ? stageByTender.get(o.tender_id) ?? null : null;
            const open = isOpenDowngrade(o);
            const countdown = closingCountdown(o.closing_date);
            const similar = similarTendersBefore({ tenderId: o.tender_id, buyer: o.buyer, categories: o.categories }, doneHistory);
            const pricing = pricingFor(o);
            const scope = o.tender_id ? scopeByTenderId.get(o.tender_id) ?? null : null;
            return (
              <div
                key={o.id}
                id={`opp-${o.id}`}
                className={cn(
                  "flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-3.5 sm:p-4.5",
                  open ? (pursuingStage ? "border-2 border-destructive" : "border-2 border-warning") : "border-border",
                )}
              >
                <div className="min-w-0 flex-1 basis-80">
                  {open && (
                    <DowngradeFlag
                      opportunityId={o.id}
                      verdict={o.verdict}
                      downgrade={o}
                      pursuingStage={pursuingStage}
                      returnTo={activeFilter === "all" ? "/discovery" : `/discovery?verdict=${activeFilter}`}
                      acknowledgedByLabel={null}
                    />
                  )}
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-foreground">
                      {o.contract_number || "(no reference number)"}
                    </span>
                    {o.source === "manual" && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground">Loaded manually</span>
                    )}
                    {o.source !== "manual" &&
                      listingSourceLabels(o.listing_sources, o.source).map((label) => (
                        <span key={label} title="Where this tender is listed" className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground">
                          {label}
                        </span>
                      ))}
                    {changes.some((c) => c.change_type === "cancelled") && (
                      <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-[11px] font-bold text-destructive">Cancelled</span>
                    )}
                    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold", chip.chipClass)}>
                      {chip.label}
                    </span>
                    {isDowngraded(o) && (
                      <span
                        title="The verdict this tender had before it was re-assessed"
                        className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground line-through"
                      >
                        was {verdictLabel(o.downgraded_from)}
                      </span>
                    )}
                    {/* On a phone, the matching button in the right rail sits
                        below badges, a title, reasons and a "how it's
                        scored" box - a lot to scroll past for the one action
                        that matters. A compact copy up here, next to the
                        verdict chip, keeps it reachable without scrolling. */}
                    {o.verdict !== "closed" && !changes.some((c) => c.change_type === "cancelled") && (
                      <form action={pursueOpportunity} className="ml-auto">
                        <input type="hidden" name="opportunity_id" value={o.id} />
                        <button
                          type="submit"
                          className="min-h-11 whitespace-nowrap rounded-full bg-primary px-3 text-[11px] font-semibold text-primary-foreground"
                        >
                          {o.tender_id ? "Open in workspace" : "Prepare this tender"}
                        </button>
                      </form>
                    )}
                  </div>
                  <div className="mb-0.5 text-sm font-semibold text-foreground">
                    {o.title || "(untitled)"}
                  </div>
                  <div className="mb-1.5 text-xs text-muted-foreground">
                    {o.buyer || "(unknown buyer)"}
                    {facts && <span> · {facts}</span>}
                  </div>
                  {o.briefing?.date && (
                    <div className={cn("mb-1.5 text-xs", o.briefing.compulsory ? "font-semibold text-warning" : "text-muted-foreground")}>
                      {o.briefing.compulsory ? "Compulsory briefing" : "Briefing"}: {new Date(o.briefing.date).toLocaleString("en-ZA", SAST_DATETIME)}
                      {o.briefing.venue && <span className="font-normal text-muted-foreground"> · {o.briefing.venue.slice(0, 120)}</span>}
                    </div>
                  )}

                  {/* What changed on the listing since it was found (0051). Most
                      urgent first; the full list folds away past three. */}
                  {changes.length > 0 && (
                    <div className="my-1 flex flex-col gap-1">
                      {changes.slice(0, 3).map((c) => {
                        const tone = changeTone(c.change_type);
                        return (
                          <div key={c.id} className={cn("rounded-lg px-2.5 py-1.5 text-xs break-words", tone.chipClass)}>
                            <strong>{CHANGE_LABELS[c.change_type] ?? c.change_type}</strong>: {c.summary}
                            {c.evidence_url && (
                              <>
                                {" "}
                                <a href={c.evidence_url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                                  source ↗
                                </a>
                              </>
                            )}
                          </div>
                        );
                      })}
                      {changes.length > 3 && (
                        <details className="text-xs text-foreground">
                          <summary className="min-h-8 cursor-pointer content-center">{changes.length - 3} more change{changes.length - 3 === 1 ? "" : "s"}</summary>
                          <ul className="mt-1 list-disc pl-4.5">
                            {changes.slice(3).map((c) => (
                              <li key={c.id} className="mb-0.5 break-words">
                                <strong>{CHANGE_LABELS[c.change_type] ?? c.change_type}</strong>: {c.summary}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}

                  {(o.categories ?? []).length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {(o.categories ?? []).map((c) => (
                        <span key={c} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {c.startsWith("uncategorized") ? c.replace(/_/g, " ") : taxonomyLabel(taxonomy, c)}
                        </span>
                      ))}
                    </div>
                  )}

                  {o.etenders_category && (
                    // The buyer's own pick on eTenders, as a cross-reference
                    // only - Tender Ready's categories (above) drive the fit.
                    <div title={o.etenders_category_check?.note ?? undefined} className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>Buyer&apos;s eTenders category: <span className="font-semibold text-foreground">{o.etenders_category}</span></span>
                      {o.etenders_category_check && XREF_STYLE[o.etenders_category_check.status] && (
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", XREF_STYLE[o.etenders_category_check.status].chipClass)}>
                          {XREF_STYLE[o.etenders_category_check.status].label}
                        </span>
                      )}
                      {o.etenders_category_check?.status === "differs" && o.etenders_category_check.matching_categories.length > 0 && (
                        <span>
                          (on Tender Ready&apos;s list that is {o.etenders_category_check.matching_categories.slice(0, 3).map((c) => taxonomyLabel(taxonomy, c)).join(", ")})
                        </span>
                      )}
                    </div>
                  )}

                  {(o.reasons ?? []).length > 0 && (
                    <ul className="list-disc pl-4.5 text-xs text-muted-foreground">
                      {(o.reasons ?? []).map((r, i) => (
                        <li key={i} className="mb-0.5">
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}

                  {isDowngraded(o) && !open && (
                    <DowngradeFlag
                      opportunityId={o.id}
                      verdict={o.verdict}
                      downgrade={o}
                      pursuingStage={pursuingStage}
                      returnTo="/discovery"
                      acknowledgedByLabel={whoAcknowledged(o.downgrade_acknowledged_by)}
                    />
                  )}

                  {/* Fit (above) answers "is this our kind of work"; this answers
                      "how would we be scored" - kept visibly separate on purpose. */}
                  {(o.score_outlook?.summary ?? []).length > 0 && (
                    <div className="mt-2 rounded-lg border border-border bg-card px-3 py-2">
                      <div className="mb-0.5 text-[11px] font-bold text-foreground">How it&apos;s scored</div>
                      <ul className="list-disc pl-4 text-xs text-muted-foreground">
                        {(o.score_outlook?.summary ?? []).map((line, i) => (
                          <li key={i} className="mb-0.5">
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* "Done N similar tenders before" / market pricing range
                      (Sarel's live feedback, 2026-10-22). "Done before" needs
                      this company's FULL pursued history (doneHistory, above
                      - a dedicated un-paginated query), never the paginated
                      `rows` window, so a company with more history than
                      what's currently loaded is never silently undercounted. */}
                  {(similar || pricing) && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {similar && (
                        <span
                          title={`${similar.sameBuyerCount > 0 ? `${similar.sameBuyerCount} with this same buyer. ` : ""}Stages reached: ${similar.stages.join(", ")}.`}
                          className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent"
                        >
                          Done {similar.count} similar tender{similar.count === 1 ? "" : "s"} before
                          {similar.wonCount > 0 && ` · won ${similar.wonCount}`}
                        </span>
                      )}
                      {pricing && (
                        <span
                          title={`Across ${pricing.contractSize.n} comparable awarded tenders in this discipline (all buyers) - a size range, not a price to bid.`}
                          className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
                        >
                          Market size range: {formatRand(pricing.contractSize.p25)} - {formatRand(pricing.contractSize.p75)} (median {formatRand(pricing.contractSize.median)})
                        </span>
                      )}
                    </div>
                  )}

                  {scope && (scope.scope_summary || scope.pricing_model || scope.value_band) && (
                    <div className="mb-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground">
                      {scope.scope_summary && <div className="mb-0.5 text-foreground">{scope.scope_summary.slice(0, 220)}</div>}
                      <div className="flex flex-wrap gap-x-3">
                        {scope.pricing_model && <span>Pricing model: {PRICING_MODEL_LABEL[scope.pricing_model] ?? scope.pricing_model}</span>}
                        {scope.value_band && <span>Estimated value: {scope.value_band}</span>}
                      </div>
                      {scope.confidence === "heuristic" && <div className="mt-0.5 text-[10px]">Keyword-matched from the listing text, not document-confirmed - treat as a starting point.</div>}
                    </div>
                  )}
                </div>

                {/* Right rail on desktop (fixed width, right-aligned);
                    full-width and left-aligned once it wraps to its own line
                    on a phone, where a fixed 180px rail would otherwise sit
                    stuck on the left with empty space beside it
                    (design-system audit fix, 2026-10-21: Tailwind responsive
                    classes, not a hand-rolled <style> media query). */}
                <div className="flex-1 basis-full text-left sm:flex-none sm:basis-[180px] sm:text-right">
                  <div className="mb-0.5 text-[11px] text-muted-foreground">Closes</div>
                  <div className="mb-0.5 text-sm font-semibold text-foreground">
                    {o.closing_date ? new Date(o.closing_date).toLocaleString("en-ZA", SAST_DATETIME) : "-"}
                  </div>
                  {countdown ? (
                    <div className={cn("mb-2.5 text-xs font-semibold", countdown.urgent ? "text-destructive" : "text-muted-foreground")}>
                      {countdown.text}
                    </div>
                  ) : (
                    <div className="mb-2.5" />
                  )}
                  {/* Company-wide bid readiness, not a per-tender compliance
                      check - see the fetchCompanyReadiness() comment above
                      for why no per-tender requirement exists to check
                      against before a tender is pursued. */}
                  <Link
                    href="/company"
                    title={
                      readiness.blockers.length === 0
                        ? "All tracked compliance criteria are met"
                        : `${readiness.blockers.length} outstanding item${readiness.blockers.length === 1 ? "" : "s"}: ${readiness.blockers.slice(0, 3).map((b) => b.label).join(", ")}`
                    }
                    className="mb-2.5 block text-xs font-semibold text-muted-foreground no-underline hover:text-foreground"
                  >
                    Company profile {readiness.percent}% ready
                  </Link>
                  {/* Into the Tender Workspace: what this tender needs, the questions
                      only you can answer, and a generated pack (migration 0018). */}
                  {o.verdict !== "closed" && !changes.some((c) => c.change_type === "cancelled") && (
                    <form action={pursueOpportunity} className="mb-2.5">
                      <input type="hidden" name="opportunity_id" value={o.id} />
                      <button type="submit" className="min-h-11 w-full whitespace-nowrap rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground sm:w-auto">
                        {o.tender_id ? "Open in workspace" : "Prepare this tender"}
                      </button>
                    </form>
                  )}
                  {docs.length === 0 && (
                    <div className="text-xs text-muted-foreground">{o.source === "manual" ? "Documents uploaded by you" : "No document URL on file"}</div>
                  )}
                  {docs.map((d, i) => (
                    <a key={i} href={d.url!} target="_blank" rel="noopener noreferrer" className="mb-1 block text-xs font-semibold text-accent no-underline">
                      {d.title || "View document"} ↗
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {canLoadMore(show, moreBeyondWindow) && (
          <div className="mt-4 flex justify-center">
            <a
              href={`/discovery?verdict=${activeFilter}&show=${nextShow(show)}`}
              className={buttonVariants({ variant: "outline", className: "min-h-11" })}
            >
              Load more
            </a>
          </div>
        )}
        {!canLoadMore(show, moreBeyondWindow) && moreBeyondWindow && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Showing the {show} most recent matches - narrow with a filter tab above to see further back.
          </p>
        )}
      </div>
    </AppShell>
  );
}
