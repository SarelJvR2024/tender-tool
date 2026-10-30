import Link from "next/link";
import { Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { closingCountdown, daysUntil, formatClosingDateTime } from "@/lib/dates";
import { GENERAL_FAMILY } from "@/lib/generalTender";
import { SANRAL_CONVENTIONAL_FAMILY } from "@/lib/tenderCompliance";
import { IN_PROGRESS_STAGES, NEXT_STAGES, OUTCOME_FIELD_KEYS, PIPELINE_STAGES, PREVIOUS_STAGE, STAGE_META, type PipelineStage } from "@/lib/pipeline";
import { AppShell } from "../_components/AppShell";
import { ScrollFade } from "../_components/ScrollFade";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { moveTenderStage } from "./actions";
import { derivedSector, ECONOMICS_COLUMNS, formatRand, toNumber, type PackEconomics, type PriceSector } from "@/lib/dealEconomics";
import { loadDisciplineTaxonomy, taxonomyLabel, type DisciplineTaxonomy } from "@/lib/disciplineTaxonomy";
import { EconomicsForm, type CreditPerson } from "./economics-form";
import { OutcomeForm, type Outcome } from "./outcome-form";
import { loadPackReviewSnapshot } from "../tenders/[id]/pack-review-data";
import { loadGeneralPackReviewSnapshot } from "../tenders/[id]/general-pack-review-data";
import { computeTenderReadiness } from "../tenders/[id]/tender-readiness";
import { StatCard } from "@/components/tt/stat-card";
import { EmptyState } from "@/components/tt/empty-state";
import { ErrorState } from "@/components/tt/error-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { packHealthStatusFromReadiness, primaryActionLabel, type PackHealth } from "@/lib/pipelineCardHelpers";

// Pack health (item 2, Sarel's own ask: "replace all '-' dashes"): derived
// ONLY from computeTenderReadiness()'s own real Fix/Provide/Verify counts
// (prompt 9) - the exact same classification the tender workspace's own
// header score and the Disqualification guard use, never a second,
// independently-computed "readiness". The status-from-score/fixCount logic
// and the "Action" link's label are pure functions, extracted to
// lib/pipelineCardHelpers.ts so they have a test file (this file is a server
// component page, which can't itself be unit-tested).
const PACK_HEALTH_STYLE: Record<PackHealth["status"], { label: (h: PackHealth) => string; chipClass: string }> = {
  not_started: { label: () => "Workspace not started - click to begin", chipClass: "border border-dashed border-muted-foreground/30 bg-transparent text-muted-foreground" },
  blocked: { label: (h) => `Blocked - ${h.fixCount} mandatory item${h.fixCount === 1 ? "" : "s"}`, chipClass: "border-destructive/20 bg-destructive/10 text-destructive" },
  in_progress: { label: (h) => `In progress - ${h.totalCount - h.confirmedCount} pending`, chipClass: "border-warning/20 bg-warning/10 text-warning" },
  ready: { label: () => "Pack ready", chipClass: "border-success/30 bg-success/15 text-success" },
};

// Submission method (migration 0090, Sarel's own "physical submission
// logistics" brief) - real, already-stored per pack, never guessed.
const SUBMISSION_TYPE_LABEL: Record<string, string> = {
  physical_box: "Physical box",
  etenders_portal: "eTenders portal",
  email: "Email",
  other_digital: "Other digital",
};

// Reads the signed-in user's company via RLS on every request (same reasoning
// as app/app/dashboard/page.tsx) - can't be prerendered.
export const instant = false;

type TenderRow = {
  id: string;
  contract_no: string | null;
  title: string | null;
  description: string | null;
  buyer: string | null;
  closing_date: string | null;
  family: string | null;
  status: string;
  ocid: string | null;
  // Only this company's own pack comes back, via RLS (one per company per tender).
  tender_packs: ({ pipeline_stage: PipelineStage; stage_changed_at: string; submitted_at: string | null; submission_type: string | null } & PackEconomics)[];
};

type Card = {
  id: string;
  stage: PipelineStage;
  contractNo: string | null;
  title: string;
  buyer: string;
  closingDate: string | null;
  stageChangedAt: string | null;
  submittedAt: string | null;
  verdict: string | null;
  // 0055: the verdict before a re-assessment made it worse (null = never downgraded).
  wasVerdict: string | null;
  downgradeOpen: boolean;
  economics: PackEconomics | null;
  defaultSector: PriceSector | null;
  category: string | null;
  family: string | null;
  outcome: Outcome;
  packHealth: PackHealth | null;
  submissionType: string | null;
};

// Same chip vocabulary as app/app/discovery/page.tsx's verdictChip() -
// design-system audit fix (2026-10-21): soft-tint token classes, not stale hex.
const VERDICT_CHIP: Record<string, { label: string; chipClass: string }> = {
  strong_fit: { label: "Strong fit", chipClass: "border-success/20 bg-success/10 text-success" },
  possible: { label: "Possible", chipClass: "border-warning/20 bg-warning/10 text-warning" },
  needs_review: { label: "Needs review", chipClass: "border-warning/20 bg-warning/10 text-warning" },
  not_a_fit: { label: "Not a fit", chipClass: "border-destructive/20 bg-destructive/10 text-destructive" },
};

const ACTION_LABEL: Record<PipelineStage, string> = {
  found: "Back to found",
  bidding: "Start bidding",
  submitted: "Mark submitted",
  won: "Won",
  lost: "Lost",
};

// Fit, specific to what each stage means (STAGE_META's hint) rather than one
// generic "Nothing here" repeated five times - flagged in the whole-app UI review.
const EMPTY_COPY: Record<PipelineStage, string> = {
  found: "Nothing found yet - tenders you decide to pursue from Discovery land here.",
  bidding: "Nothing being prepared right now - move a tender here once you start bidding.",
  submitted: "Nothing handed in yet - submitted bids wait here for an outcome.",
  won: "No wins logged yet - they'll show up here.",
  lost: "Nothing here - long may it stay that way.",
};

// Exact-time check (a tender closing at 12:00 today is closed by 12:01),
// unlike daysUntil()'s whole-day count.
function isPast(d: string | null): boolean {
  return !!d && new Date(d).getTime() < Date.now();
}

function shortDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "-";
}

// Item 6 (Sarel's own ask): "an explicit right-hand action button on each
// row" instead of relying on the whole card/row being a click target.
function primaryAction(card: Card): { label: string; href: string } {
  return { label: primaryActionLabel(card.stage, card.packHealth), href: `/tenders/${card.id}` };
}

function PackHealthBadge({ health }: { health: PackHealth | null }) {
  if (!health) return <span className="text-muted-foreground">-</span>;
  const style = PACK_HEALTH_STYLE[health.status];
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", style.chipClass)}>{style.label(health)}</span>
      {health.totalCount > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {health.score}% ready ({health.confirmedCount}/{health.totalCount} returnables)
        </span>
      )}
    </div>
  );
}

// Card spec (item 4): "closing date with colour (red < 3d, amber < 7d)" -
// design-system audit fix (2026-10-21): a token class, not a literal hex.
export function closingColorClass(left: number | null, closingDate: string | null): string {
  if (left === null) return "text-muted-foreground";
  if (isPast(closingDate)) return "text-destructive";
  if (left < 3) return "text-destructive";
  if (left < 7) return "text-warning";
  return "text-muted-foreground";
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  try {
    return await renderPipeline(supabase, actionError);
  } catch (e) {
    console.error("pipeline page failed to load", e);
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6">
          <ErrorState
            action={
              <Link href="/pipeline" className={buttonVariants({ variant: "outline", className: "min-h-11" })}>
                Retry
              </Link>
            }
          />
        </div>
      </AppShell>
    );
  }
}

async function renderPipeline(supabase: Awaited<ReturnType<typeof createClient>>, actionError: string | undefined) {
  const [{ data: tenders, error }, { data: opportunities }, { data: peopleRows }, { data: outcomeRows }, { data: preferencesRow, error: preferencesError }] = await Promise.all([
    supabase
      .from("tenders")
      .select(`id, contract_no, title, description, buyer, closing_date, family, status, ocid, tender_packs(pipeline_stage, stage_changed_at, submitted_at, submission_type, ${ECONOMICS_COLUMNS})`)
      .order("closing_date", { ascending: true }),
    // Discovery's fit verdict, where this tender came from the scored feed.
    // Scaling fix (see app/lib/discoveryPagination.ts's module comment for
    // the root-cause writeup): discovered_opportunities accumulates one row
    // per OCDS release ever scored against this company, forever, but this
    // lookup only ever needs rows that became one of THIS company's own
    // tenders (matched below by tender_id/ocid/contract_number against the
    // `tenders` rows already loaded above) - every such row has `tender_id`
    // set (pursue_discovered_opportunity() always backfills it the moment a
    // tender is pursued, confirmed in migrations 0024/0051), so narrowing to
    // `tender_id is not null` drops only opportunities nothing here reads,
    // never one this page's matching still needs.
    supabase.from("discovered_opportunities").select("ocid, contract_number, tender_id, verdict, categories, downgraded_from, downgrade_acknowledged_at").not("tender_id", "is", null),
    // Who can get credit for a submission (item 26, migration 0034): the
    // company's people roster, same list the task assignee picker uses.
    supabase.from("people").select("id, name").order("name"),
    // Outcome facts (item 4) - tender_answers' own outcome:* keys, see
    // recordOutcomeAndMoveStage (pipeline/actions.ts) for why this table.
    supabase.from("tender_answers").select("tender_id, field_key, value").in("field_key", Object.values(OUTCOME_FIELD_KEYS)),
    // This company's real, saved Opportunity preferences (migration 0088,
    // company_tender_preferences, set from the /discovery panel) -
    // hide_sanral_board gates the "found" column's own shared SANRAL feed
    // below. RLS (is_company_member(company_id)) already scopes this to at
    // most one row with no explicit company_id filter needed. Degrades to
    // "no preference saved" (board stays visible, today's behavior) rather
    // than failing the page - covers both a genuine read error and, until
    // Sarel applies 0088 live, the table not existing yet.
    supabase.from("company_tender_preferences").select("hide_sanral_board").maybeSingle(),
  ]);
  if (preferencesError) console.error("company_tender_preferences select failed", preferencesError);
  const hideSanralBoard = (preferencesRow as { hide_sanral_board: boolean } | null)?.hide_sanral_board ?? false;
  const people = (peopleRows ?? []) as CreditPerson[];
  const peopleById = new Map(people.map((p) => [p.id, p.name]));
  const taxonomy = await loadDisciplineTaxonomy(supabase);

  if (error) console.error("tenders select failed for pipeline board", error);

  const outcomeByTender = new Map<string, Outcome>();
  for (const a of (outcomeRows ?? []) as { tender_id: string; field_key: string; value: string | null }[]) {
    const o = outcomeByTender.get(a.tender_id) ?? { winningCompany: null, winningPriceZar: null, biddersCount: null, reasonLost: null };
    if (a.field_key === OUTCOME_FIELD_KEYS.winningCompany) o.winningCompany = a.value;
    else if (a.field_key === OUTCOME_FIELD_KEYS.winningPriceZar) o.winningPriceZar = a.value;
    else if (a.field_key === OUTCOME_FIELD_KEYS.biddersCount) o.biddersCount = a.value;
    else if (a.field_key === OUTCOME_FIELD_KEYS.reasonLost) o.reasonLost = a.value;
    outcomeByTender.set(a.tender_id, o);
  }
  const EMPTY_OUTCOME: Outcome = { winningCompany: null, winningPriceZar: null, biddersCount: null, reasonLost: null };

  const verdictByKey = new Map<string, string>();
  const downgradeByKey = new Map<string, { was: string; open: boolean }>();
  const categoriesByKey = new Map<string, string[]>();
  for (const o of (opportunities ?? []) as { ocid: string | null; contract_number: string | null; tender_id: string | null; verdict: string; categories: string[] | null; downgraded_from: string | null; downgrade_acknowledged_at: string | null }[]) {
    for (const key of [o.ocid && `ocid:${o.ocid}`, o.contract_number && `no:${o.contract_number}`, o.tender_id && `id:${o.tender_id}`]) {
      if (!key) continue;
      verdictByKey.set(key, o.verdict);
      if (o.downgraded_from) downgradeByKey.set(key, { was: o.downgraded_from, open: !o.downgrade_acknowledged_at });
      if (o.categories?.length) categoriesByKey.set(key, o.categories);
    }
  }

  const cards: Card[] = [];
  for (const t of (tenders ?? []) as unknown as TenderRow[]) {
    const pack = t.tender_packs?.[0];
    if (!pack) {
      // No pack yet: only the shared SANRAL feed (what Tenders lists) counts as
      // "found", and only while still open. A general tender without our pack
      // was pursued by another company - not ours to show.
      if (t.family === GENERAL_FAMILY || t.status !== "open") continue;
      if (isPast(t.closing_date)) continue;
      // Task item 4 (app/AGENTS.md): hide_sanral_board (migration 0088,
      // company_tender_preferences) - a company that's said it doesn't do
      // SANRAL/road-construction work doesn't get this shared,
      // un-tenant-scoped board shown to it by default. Every remaining
      // branch of this `if (!pack)` guard is for a non-general family (the
      // GENERAL_FAMILY case already `continue`d above), i.e. exactly the
      // SANRAL-conventional board this preference is about.
      if (hideSanralBoard) continue;
    }
    const defaultSector = derivedSector(
      t.family,
      categoriesByKey.get(`id:${t.id}`) ?? (t.ocid ? categoriesByKey.get(`ocid:${t.ocid}`) : undefined) ?? (t.contract_no ? categoriesByKey.get(`no:${t.contract_no}`) : undefined)
    );
    cards.push({
      id: t.id,
      stage: pack?.pipeline_stage ?? "found",
      contractNo: t.contract_no,
      title: t.title || t.description || "(untitled)",
      buyer: t.buyer || (t.family && t.family !== GENERAL_FAMILY ? "SANRAL" : "(unknown buyer)"),
      closingDate: t.closing_date,
      stageChangedAt: pack?.stage_changed_at ?? null,
      submittedAt: pack?.submitted_at ?? null,
      verdict: (t.ocid && verdictByKey.get(`ocid:${t.ocid}`)) || (t.contract_no && verdictByKey.get(`no:${t.contract_no}`)) || null,
      wasVerdict: ((t.ocid && downgradeByKey.get(`ocid:${t.ocid}`)) || (t.contract_no && downgradeByKey.get(`no:${t.contract_no}`)) || null)?.was ?? null,
      downgradeOpen: !!((t.ocid && downgradeByKey.get(`ocid:${t.ocid}`)) || (t.contract_no && downgradeByKey.get(`no:${t.contract_no}`)) || null)?.open,
      economics: pack ?? null,
      defaultSector,
      // Real taxonomy label (0040) when Discovery's own classifier matched
      // this tender to a discipline - never a guessed/invented category for
      // a tender with no real match (e.g. every SANRAL-seeded row, which has
      // no discovered_opportunities row at all).
      category: defaultSector ? taxonomyLabel(taxonomy, defaultSector) : null,
      family: t.family,
      outcome: outcomeByTender.get(t.id) ?? EMPTY_OUTCOME,
      packHealth: null,
      submissionType: pack?.submission_type ?? null,
    });
  }

  // Readiness score (item 4's card spec) - bounded to "Assessing & building"
  // cards only, the one stage it's actually relevant to (Found hasn't started
  // a pack; Submitted/Awarded/Lost are already past needing it). Same cached
  // snapshot the tender workspace's own header score reads (prompt 9) - never
  // re-derived, and never computed for every card on the board, since a full
  // Pack Review read is real, multi-query Supabase cost per tender (same N+1
  // concern already flagged for Home's own "specific next step", see
  // "Home cockpit" above).
  const biddingCards = cards.filter((c) => c.stage === "bidding");
  const NOT_STARTED: PackHealth = { status: "not_started", score: 0, confirmedCount: 0, totalCount: 0, fixCount: 0 };
  const packHealths = await Promise.all(
    biddingCards.map(async (c): Promise<PackHealth | null> => {
      try {
        // snap.mapped === false means something distinct per family - for
        // SANRAL it can't actually happen here (c.family already gates the
        // call), but for GENERAL it means "no document_requirements manifest
        // extracted yet" (general-pack-review-data.ts), a real, reachable
        // state for a tender a user has already moved to 'bidding' before
        // extraction finishes. That used to fall through to `readiness =
        // null` and render the bare "-" this whole feature exists to
        // replace, with the Action link silently defaulting to "Continue
        // workspace" - found 2026-10-30, re-reviewing PR #172 the pass after
        // it merged. Treated the same as a 'found'-stage card below: real,
        // known information ("not started"), not a blank to leave unstyled.
        if (c.family === SANRAL_CONVENTIONAL_FAMILY) {
          const snap = await loadPackReviewSnapshot(c.id);
          if (!snap.mapped) return NOT_STARTED;
          const readiness = computeTenderReadiness(snap.sections);
          const status = packHealthStatusFromReadiness(readiness.score, readiness.fix.length);
          return { status, score: readiness.score, confirmedCount: readiness.confirmedCount, totalCount: readiness.totalCount, fixCount: readiness.fix.length };
        } else if (c.family === GENERAL_FAMILY) {
          const snap = await loadGeneralPackReviewSnapshot(c.id);
          if (!snap.mapped) return NOT_STARTED;
          const readiness = computeTenderReadiness(snap.sections);
          const status = packHealthStatusFromReadiness(readiness.score, readiness.fix.length);
          return { status, score: readiness.score, confirmedCount: readiness.confirmedCount, totalCount: readiness.totalCount, fixCount: readiness.fix.length };
        }
      } catch (e) {
        console.error("readiness score failed for pipeline card", c.id, e);
      }
      return null;
    }),
  );
  biddingCards.forEach((c, i) => {
    c.packHealth = packHealths[i];
  });
  // "Workspace not started" (item 2's own wording) - a tender still at
  // 'found' hasn't begun pack compilation at all, which IS itself real,
  // known information - not a missing value to leave blank.
  for (const c of cards) {
    if (c.stage === "found") c.packHealth = NOT_STARTED;
  }

  const byStage = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, [] as Card[]])) as Record<PipelineStage, Card[]>;
  for (const c of cards) byStage[c.stage].push(c);
  // Open work sorts by what closes next; outcomes by most recent first.
  for (const s of ["submitted", "won", "lost"] as const) {
    byStage[s].sort((a, b) => (b.stageChangedAt ?? "").localeCompare(a.stageChangedAt ?? ""));
  }

  const submittedToDate = cards.filter((c) => c.submittedAt).length;

  // Header strip (item 4): active bids (Discovered + Assessing & building,
  // i.e. not yet at an outcome), total value being bid, submitted this month
  // (submitted_at's calendar month = now's), win rate (Awarded / (Awarded +
  // Lost), the only two outcomes that exist).
  const activeCards = IN_PROGRESS_STAGES.flatMap((s) => byStage[s]);
  const activeBids = activeCards.length;
  // Deliberately a WIDER set than activeCards (Sarel's own ask: "accurately
  // sums active (unsubmitted/submitted) bid values") - a submitted bid is
  // still real money on the table until won/lost, so it belongs in this
  // VALUE sum even though it's correctly excluded from the "Active bids"
  // COUNT above (lib/pipeline.ts's own IN_PROGRESS_STAGES comment: a
  // submitted bid is "handed in... not active work" for THAT stat - a
  // different question from "how much are we waiting to hear back on").
  const valueCards = [...activeCards, ...byStage.submitted];
  const totalValueBeingBid = valueCards.reduce((sum, c) => sum + (toNumber(c.economics?.submitted_price_zar) ?? 0), 0);
  const now = new Date();
  const submittedThisMonth = cards.filter((c) => {
    if (!c.submittedAt) return false;
    const d = new Date(c.submittedAt);
    return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
  }).length;
  const decided = byStage.won.length + byStage.lost.length;
  const winRate = decided === 0 ? null : Math.round((byStage.won.length / decided) * 100);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="mb-1 font-display text-xl font-medium text-foreground sm:text-2xl">Bids</h1>
          <Link href="/pipeline/pricing" className="min-h-11 content-center text-sm font-semibold text-accent no-underline hover:underline">
            Pricing history →
          </Link>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Every tender you&apos;re tracking, by stage. Open a card for its workspace; move it on when something changes.
        </p>

        {(error || actionError) && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error ? "Couldn't load tenders - try refreshing. If it keeps happening, let us know." : actionError}
          </div>
        )}

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Active bids" value={activeBids} />
          <StatCard label="Total value being bid" value={formatRand(totalValueBeingBid)} />
          <StatCard label="Submitted this month" value={submittedThisMonth} />
          <StatCard label="Win rate" value={winRate === null ? "-" : `${winRate}%`} tone={winRate !== null && winRate >= 50 ? "success" : "default"} />
        </div>
        <p className="-mt-3 mb-5 text-xs text-muted-foreground">
          {submittedToDate} submitted to date · {byStage.won.length} won · {byStage.lost.length} lost
        </p>

        {/* Board + List (item 4's "list-view toggle") - the List tab promised
            when this became a real Tabs component (app/AGENTS.md "App
            shell") lands here, reading the exact same `cards` array, not a
            second query. */}
        <Tabs defaultValue="board">
          <TabsList className="mb-3">
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
          </TabsList>

          <TabsContent value="list">
            {cards.length === 0 ? (
              <div className="rounded-lg border border-border bg-card">
                <EmptyState icon={Inbox} title="Nothing tracked yet" description="Tenders you decide to pursue from Opportunities land here." />
              </div>
            ) : (
              <>
                {/* Desktop/tablet: a real table. Mobile: a stacked card list -
                    a squeezed 7-column table cuts content off on a phone
                    (design-system audit fix, 2026-10-21). */}
                <div className="hidden overflow-hidden rounded-lg border border-border md:block">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Tender</th>
                        <th className="px-3 py-2 font-medium">Stage</th>
                        <th className="px-3 py-2 font-medium">Pack health</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                        <th className="px-3 py-2 font-medium">Closing</th>
                        <th className="px-3 py-2 font-medium">Owner</th>
                        <th className="px-3 py-2 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cards.map((c) => {
                        const left = daysUntil(c.closingDate);
                        const meta = STAGE_META[c.stage];
                        const owner = c.economics?.submitted_by_person_id ? peopleById.get(c.economics.submitted_by_person_id) : null;
                        const countdown = closingCountdown(c.closingDate);
                        const action = primaryAction(c);
                        return (
                          <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                            <td className="px-3 py-2">
                              <Link href={`/tenders/${c.id}`} className="font-semibold text-foreground no-underline hover:underline">
                                {c.title}
                              </Link>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                <span>{c.buyer}</span>
                                {c.contractNo && <span className="font-mono">{c.contractNo}</span>}
                                {c.category && <span className="rounded-full bg-muted px-1.5 py-0.5 font-semibold">{c.category}</span>}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.chipClass)}>{meta.label}</span>
                            </td>
                            <td className="px-3 py-2">
                              <PackHealthBadge health={c.packHealth} />
                            </td>
                            <td className="px-3 py-2 text-foreground">{formatRand(toNumber(c.economics?.submitted_price_zar))}</td>
                            <td className="px-3 py-2">
                              {c.closingDate ? (
                                <>
                                  <div className={cn("font-semibold", closingColorClass(left, c.closingDate))}>{countdown?.text ?? shortDate(c.closingDate)}</div>
                                  <div className="text-[10px] text-muted-foreground">{formatClosingDateTime(c.closingDate)}</div>
                                  {c.submissionType && <div className="text-[10px] text-muted-foreground">{SUBMISSION_TYPE_LABEL[c.submissionType] ?? c.submissionType}</div>}
                                </>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{owner ?? "-"}</td>
                            <td className="px-3 py-2">
                              <Link href={action.href} className="font-semibold text-accent no-underline hover:underline">
                                {action.label}
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-2 md:hidden">
                  {cards.map((c) => {
                    const left = daysUntil(c.closingDate);
                    const meta = STAGE_META[c.stage];
                    const owner = c.economics?.submitted_by_person_id ? peopleById.get(c.economics.submitted_by_person_id) : null;
                    const countdown = closingCountdown(c.closingDate);
                    const action = primaryAction(c);
                    return (
                      <div key={c.id} className="rounded-lg border border-border bg-card p-3">
                        <Link href={`/tenders/${c.id}`} className="block text-inherit no-underline">
                          <div className="mb-1 flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold text-foreground">{c.title}</span>
                            <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.chipClass)}>{meta.label}</span>
                          </div>
                          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{c.buyer}</span>
                            {c.contractNo && <span className="font-mono">{c.contractNo}</span>}
                            {c.category && <span className="rounded-full bg-muted px-1.5 py-0.5 font-semibold">{c.category}</span>}
                          </div>
                          <div className="mb-1">
                            <PackHealthBadge health={c.packHealth} />
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <span className="font-semibold text-foreground">{formatRand(toNumber(c.economics?.submitted_price_zar))}</span>
                            {c.closingDate ? (
                              <span className={cn("font-semibold", closingColorClass(left, c.closingDate))}>{countdown?.text ?? shortDate(c.closingDate)}</span>
                            ) : (
                              <span className="text-muted-foreground">No closing date</span>
                            )}
                            {c.submissionType && <span className="text-muted-foreground">{SUBMISSION_TYPE_LABEL[c.submissionType] ?? c.submissionType}</span>}
                            {owner && <span className="text-muted-foreground">Owner: {owner}</span>}
                          </div>
                        </Link>
                        <Link href={action.href} className="mt-2 block text-xs font-semibold text-accent no-underline hover:underline">
                          {action.label}
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="board">
            {/* Stacked card list on mobile/tablet (every column full-width,
                one after another); only becomes horizontally-scrolling
                columns from lg up, where there's room for 5 side by side
                without cutting content off (design-system audit fix,
                2026-10-21 - was a fixed 5-column grid at every width). */}
            <div className="relative">
              <div className="flex flex-col gap-3 lg:flex-row lg:overflow-x-auto lg:pb-2" style={{ WebkitOverflowScrolling: "touch" }}>
                {PIPELINE_STAGES.map((stage) => {
                  const meta = STAGE_META[stage];
                  const column = byStage[stage];
                  return (
                    <section key={stage} className="rounded-xl border border-border bg-card p-2.5 lg:min-w-[220px] lg:flex-1">
                      <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
                        <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", meta.chipClass)}>{meta.label}</span>
                        <span className="text-xs font-semibold text-muted-foreground">{column.length}</span>
                      </div>
                      <div className="px-1 py-1.5 text-[11px] text-muted-foreground">{meta.hint}</div>

                      <div className="flex flex-col gap-2">
                        {column.length === 0 && (
                          <div className="rounded-lg border border-dashed border-border px-2 py-3.5 text-center text-xs text-muted-foreground">
                            {EMPTY_COPY[stage]}
                          </div>
                        )}
                        {column.map((c) => (
                          <TenderCard key={c.id} card={c} people={people} taxonomy={taxonomy} />
                        ))}
                      </div>

                      {stage === "found" && (
                        <Link href="/discovery" className="block min-h-11 content-center px-1 pt-2 text-xs font-semibold text-accent no-underline hover:underline">
                          Find more in Opportunities →
                        </Link>
                      )}
                    </section>
                  );
                })}
              </div>
              {/* Right-edge fade: only relevant once columns actually sit
                  side by side (lg and up) - below that, the board is a
                  plain vertical stack with nothing to scroll past. */}
              <div className="hidden lg:block">
                <ScrollFade fadeColor="255, 255, 255" minWidthToHide={1180} />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

// "Owner avatar" (item 4's card spec): the same submitted_by_person_id
// ("credit for the submission", items 26/27) EconomicsForm already writes -
// no separate "bid owner" concept exists or was invented; this is that same
// fact, just also shown as a small avatar on the card face.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function TenderCard({ card, people, taxonomy }: { card: Card; people: CreditPerson[]; taxonomy: DisciplineTaxonomy }) {
  const verdict = card.verdict ? VERDICT_CHIP[card.verdict] : null;
  const open = card.stage === "found" || card.stage === "bidding";
  const back = PREVIOUS_STAGE[card.stage];
  const owner = card.economics?.submitted_by_person_id ? people.find((p) => p.id === card.economics!.submitted_by_person_id)?.name ?? null : null;
  const price = toNumber(card.economics?.submitted_price_zar);
  const action = primaryAction(card);
  const countdown = closingCountdown(card.closingDate);

  let dateLine: { text: string; className: string };
  if (!open) {
    const when = card.stage === "submitted" ? card.submittedAt : card.stageChangedAt;
    dateLine = {
      text: `${card.stage === "submitted" ? "Submitted" : STAGE_META[card.stage].label} ${shortDate(when)}`,
      className: "text-muted-foreground",
    };
  } else if (!card.closingDate) {
    dateLine = { text: "No closing date", className: "text-muted-foreground" };
  } else if (isPast(card.closingDate)) {
    // Usually means it was handed in and just needs moving to Submitted.
    dateLine = { text: `Closed ${shortDate(card.closingDate)}`, className: "text-destructive" };
  } else {
    // closingCountdown() (lib/dates.ts) is the one shared "N days/hours left"
    // helper every page that shows a countdown already uses - never a second,
    // locally-drifted copy (that exact drift was a real, already-fixed bug
    // here once: see that function's own header comment).
    dateLine = { text: countdown?.text ?? shortDate(card.closingDate), className: closingColorClass(daysUntil(card.closingDate), card.closingDate) };
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <Link href={`/tenders/${card.id}`} className="block text-inherit no-underline">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          {verdict && <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", verdict.chipClass)}>{verdict.label}</span>}
          {card.wasVerdict && (
            <span
              title="Re-assessed: the Discovery verdict got worse since this tender was found - see its Discovery entry"
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                card.downgradeOpen ? "border-destructive/20 bg-destructive/10 text-destructive" : "border-border bg-card text-muted-foreground",
              )}
            >
              {card.downgradeOpen ? "⚠ " : ""}Re-assessed · was {VERDICT_CHIP[card.wasVerdict]?.label ?? card.wasVerdict}
            </span>
          )}
        </div>
        {/* Item 1 (Sarel's own ask): the human title leads, not the raw
            reference code - the subtitle line below carries client/
            reference/category instead of the title slot. */}
        <div className="mb-0.5 line-clamp-3 text-sm font-semibold text-foreground">{card.title}</div>
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{card.buyer}</span>
          {card.contractNo && <span className="font-mono">{card.contractNo}</span>}
          {card.category && <span className="rounded-full bg-muted px-1.5 py-0.5 font-semibold">{card.category}</span>}
        </div>
        <div className={cn("text-[11px] font-semibold", dateLine.className)}>{dateLine.text}</div>
        {open && card.closingDate && !isPast(card.closingDate) && (
          <div className="text-[10px] text-muted-foreground">
            {formatClosingDateTime(card.closingDate)}
            {card.submissionType && ` · ${SUBMISSION_TYPE_LABEL[card.submissionType] ?? card.submissionType}`}
          </div>
        )}
        <div className="mt-1.5">
          <PackHealthBadge health={card.packHealth} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {price != null ? (
            <span className="text-[11px] font-semibold text-foreground">{formatRand(price)}</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Unpriced</span>
          )}
          {owner ? (
            <span className="inline-flex min-w-0 items-center gap-1" title={`Owner: ${owner}`}>
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-foreground">
                {initials(owner)}
              </span>
              <span className="max-w-20 truncate text-[10px] text-muted-foreground">{owner}</span>
            </span>
          ) : (
            card.stage !== "found" && (
              <a href={`#econ-${card.id}`} className="text-[10px] font-semibold text-accent no-underline hover:underline">
                + Assign lead
              </a>
            )
          )}
        </div>
      </Link>

      {card.stage !== "submitted" && (NEXT_STAGES[card.stage].length > 0 || back) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
          {NEXT_STAGES[card.stage].map((next) => (
            <StageButton key={next} tenderId={card.id} stage={next} primary />
          ))}
          {back && <StageButton tenderId={card.id} stage={back} />}
        </div>
      )}
      {card.stage === "submitted" && back && (
        <div className="mt-2.5 border-t border-border pt-2">
          <StageButton tenderId={card.id} stage={back} />
        </div>
      )}

      {/* Item 6: an explicit, labelled action - not just "the whole card is
          a link" (which stays true too, for anyone who clicks the title). */}
      <Link href={action.href} className="mt-2.5 block min-h-7 text-xs font-semibold text-accent no-underline hover:underline">
        {action.label}
      </Link>

      {/* Outcome (item 4): winning company/price, bidders, reason lost -
          see outcome-form.tsx for why these live in tender_answers. */}
      <OutcomeForm tenderId={card.id} stage={card.stage} outcome={card.outcome} />

      {/* Price & credit (items 26/27): from Bidding on, once a pack row exists.
          toggleLabel covers item 5's "Unpriced"/"+ Assign lead" asks when
          BOTH are missing; the standalone "+ Assign lead" link above covers
          the case where a price exists but no owner yet (that combination
          has no single existing toggle-label slot to reuse). */}
      {card.stage !== "found" && (
        <EconomicsForm
          tenderId={card.id}
          economics={card.economics}
          people={people}
          defaultSector={card.defaultSector}
          taxonomy={taxonomy}
          prompt={!open && card.economics?.submitted_price_zar == null}
          toggleLabel={price === null && !owner ? "Unpriced · + Assign lead" : undefined}
        />
      )}
    </div>
  );
}

function StageButton({ tenderId, stage, primary = false }: { tenderId: string; stage: PipelineStage; primary?: boolean }) {
  const label = primary ? ACTION_LABEL[stage] : "← Back";
  // The forward action gets the 44px minimum every primary button in this
  // app uses (it's tapped once per card, repeatedly down a scrolling
  // column); "Back" is a lighter secondary control but still keeps a real
  // 44px tap target, just a visually smaller one (design-system audit fix,
  // 2026-10-21: every button on this screen meets the touch-target minimum,
  // not only the primary one).
  const toneClass = primary
    ? stage === "won"
      ? "border border-success/30 bg-success/15 text-success"
      : stage === "lost"
        ? "border border-destructive/20 bg-destructive/10 text-destructive"
        : "bg-primary text-primary-foreground"
    : "bg-transparent text-muted-foreground hover:text-foreground";
  return (
    <form action={moveTenderStage}>
      <input type="hidden" name="tender_id" value={tenderId} />
      <input type="hidden" name="stage" value={stage} />
      <button
        type="submit"
        title={primary ? undefined : `Move back to ${STAGE_META[stage].label}`}
        className={cn(
          "min-h-11 cursor-pointer rounded-lg px-3.5 text-xs font-semibold",
          toneClass,
        )}
      >
        {label}
      </button>
    </form>
  );
}
