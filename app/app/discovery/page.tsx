import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_components/AppShell";
import { ScrollFade } from "../_components/ScrollFade";
import { loadDisciplineTaxonomy, taxonomyLabel } from "@/lib/disciplineTaxonomy";
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

// "needs_review" groups assess_tender.py's "possible" and "needs_review" verdicts -
// both mean "a human should look at this", just at different confidence levels
// (see assess_fit()'s docstring/logic in engine/discovery/assess_tender.py).
function matchesFilter(verdict: string, filter: VerdictFilter): boolean {
  if (filter === "all" || filter === "changed") return true;
  if (filter === "reassessed") return false; // handled on the row (isDowngraded)
  if (filter === "needs_review") return verdict === "possible" || verdict === "needs_review";
  return verdict === filter;
}

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
  searchParams: Promise<{ verdict?: string; error?: string }>;
}) {
  const { verdict: verdictParam, error: actionError } = await searchParams;
  const activeFilter: VerdictFilter = FILTERS.some((f) => f.key === verdictParam)
    ? (verdictParam as VerdictFilter)
    : "all";

  try {
    return await renderDiscovery(activeFilter, actionError);
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

async function renderDiscovery(activeFilter: VerdictFilter, actionError: string | undefined) {
  const supabase = await createClient();
  const taxonomy = await loadDisciplineTaxonomy(supabase); // category labels (0040)

  // Scoped to the signed-in user's company via RLS (is_company_member) -
  // this query shape works the same regardless of which company is asking.
  const [{ data: opportunities, error }, { data: packRows }, { data: labelRows }] = await Promise.all([
    supabase
      .from("discovered_opportunities")
      .select(`id, contract_number, buyer, title, closing_date, categories, verdict, reasons, document_urls, first_seen, score_outlook, tender_id, source, ocid, listing_sources, province, tender_type, briefing, listing_status, etenders_category, etenders_category_check, ${DOWNGRADE_COLUMNS}`)
      .order("first_seen", { ascending: false }),
    // RLS: this company's own packs - which re-assessed tenders it is working on.
    supabase.from("tender_packs").select("tender_id, pipeline_stage"),
    supabase.rpc("company_member_labels"),
  ]);
  if (error) console.error("discovered_opportunities select failed", error);
  const { data: { user } } = await supabase.auth.getUser();
  const stageByTender = new Map<string, string>();
  for (const p of (packRows ?? []) as { tender_id: string; pipeline_stage: string | null }[]) {
    if (p.pipeline_stage && ACTIVE_PURSUIT_STAGES.includes(p.pipeline_stage)) stageByTender.set(p.tender_id, p.pipeline_stage);
  }
  const labels = new Map<string, string>();
  for (const r of (labelRows ?? []) as { user_id: string; label: string }[]) labels.set(r.user_id, r.label);
  const whoAcknowledged = (id: string | null) => (!id ? null : id === user?.id ? "you" : labels.get(id) ?? "a former member");

  // A downgrade nobody has marked seen yet comes first (the order is otherwise newest found first).
  const rows = ((opportunities ?? []) as unknown as OpportunityRow[])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(isOpenDowngrade(b.r)) - Number(isOpenDowngrade(a.r)) || a.i - b.i)
    .map(({ r }) => r);
  const openDowngrades = rows.filter(isOpenDowngrade);
  const openPursued = openDowngrades.filter((r) => r.tender_id && stageByTender.has(r.tender_id));

  // Listing changes on these tenders (public listing facts, readable by any
  // signed-in user - 0051). Chunked so the in.() list stays a sane URL length.
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

  const counts: Record<VerdictFilter, number> = {
    all: rows.length,
    strong_fit: rows.filter((r) => r.verdict === "strong_fit").length,
    needs_review: rows.filter((r) => r.verdict === "possible" || r.verdict === "needs_review").length,
    not_a_fit: rows.filter((r) => r.verdict === "not_a_fit").length,
    changed: rows.filter((r) => changesFor(r).length > 0).length,
    reassessed: rows.filter(isDowngraded).length,
  };

  const visibleRows = rows.filter((r) =>
    activeFilter === "reassessed"
      ? isDowngraded(r)
      : matchesFilter(r.verdict, activeFilter) && (activeFilter !== "changed" || changesFor(r).length > 0),
  );

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

        {openDowngrades.length > 0 && (
          <div
            className={cn(
              "mb-4 rounded-lg border px-4 py-3 text-sm",
              openPursued.length ? "border-destructive/20 bg-destructive/10 text-destructive" : "border-warning/30 bg-warning/10 text-warning",
            )}
          >
            <strong>
              &#9888; {openDowngrades.length} tender{openDowngrades.length === 1 ? " is" : "s are"} no longer as good a fit as when
              {openDowngrades.length === 1 ? " it was" : " they were"} found
            </strong>
            {openPursued.length > 0 && <> - including {openPursued.length} you are working on</>}.{" "}
            {openDowngrades.length === 1 ? "It was" : "They were"} scored again (usually because your company profile changed) and came out
            worse. {openDowngrades.length === 1 ? "It is" : "Each is"} flagged below until someone in your company marks it as seen.{" "}
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
                    className={cn(
                      "flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                      isActive ? "bg-background/20 text-background" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {counts[f.key]}
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

        <div className="flex flex-col gap-2.5">
          {visibleRows.length === 0 && !error && (
            <div className="rounded-lg border border-border bg-card">
              <EmptyState
                icon={Inbox}
                title={activeFilter !== "all" ? "Nothing matches this filter" : "Nothing scored yet"}
                description={
                  activeFilter !== "all"
                    ? "Try \"All\" to see everything scored so far."
                    : "The daily scan checks every open tender against your company profile automatically, or you can load a tender you've already found with the button above."
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
                </div>

                {/* Right rail on desktop (fixed width, right-aligned);
                    full-width and left-aligned once it wraps to its own line
                    on a phone, where a fixed 180px rail would otherwise sit
                    stuck on the left with empty space beside it
                    (design-system audit fix, 2026-10-21: Tailwind responsive
                    classes, not a hand-rolled <style> media query). */}
                <div className="flex-1 basis-full text-left sm:flex-none sm:basis-[180px] sm:text-right">
                  <div className="mb-0.5 text-[11px] text-muted-foreground">Closes</div>
                  <div className="mb-2.5 text-sm font-semibold text-foreground">
                    {o.closing_date ? new Date(o.closing_date).toLocaleString("en-ZA", SAST_DATETIME) : "-"}
                  </div>
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
      </div>
    </AppShell>
  );
}
