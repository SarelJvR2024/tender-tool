import Link from "next/link";
import { Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/dates";
import { GENERAL_FAMILY } from "@/lib/generalTender";
import { SANRAL_CONVENTIONAL_FAMILY } from "@/lib/tenderCompliance";
import { IN_PROGRESS_STAGES, NEXT_STAGES, OUTCOME_FIELD_KEYS, PIPELINE_STAGES, PREVIOUS_STAGE, STAGE_META, type PipelineStage } from "@/lib/pipeline";
import { AppShell } from "../_components/AppShell";
import { ScrollFade } from "../_components/ScrollFade";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { moveTenderStage } from "./actions";
import { derivedSector, ECONOMICS_COLUMNS, formatRand, toNumber, type PackEconomics, type PriceSector } from "@/lib/dealEconomics";
import { loadDisciplineTaxonomy, type DisciplineTaxonomy } from "@/lib/disciplineTaxonomy";
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
  tender_packs: ({ pipeline_stage: PipelineStage; stage_changed_at: string; submitted_at: string | null } & PackEconomics)[];
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
  family: string | null;
  outcome: Outcome;
  readiness: number | null;
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
      .select(`id, contract_no, title, description, buyer, closing_date, family, status, ocid, tender_packs(pipeline_stage, stage_changed_at, submitted_at, ${ECONOMICS_COLUMNS})`)
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
    // This company's real, saved Opportunity preferences (migration 0087,
    // company_tender_preferences, set from the /discovery panel) -
    // hide_sanral_board gates the "found" column's own shared SANRAL feed
    // below. RLS (is_company_member(company_id)) already scopes this to at
    // most one row with no explicit company_id filter needed. Degrades to
    // "no preference saved" (board stays visible, today's behavior) rather
    // than failing the page - covers both a genuine read error and, until
    // Sarel applies 0087 live, the table not existing yet.
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
      // Task item 4 (app/AGENTS.md): hide_sanral_board (migration 0087,
      // company_tender_preferences) - a company that's said it doesn't do
      // SANRAL/road-construction work doesn't get this shared,
      // un-tenant-scoped board shown to it by default. Every remaining
      // branch of this `if (!pack)` guard is for a non-general family (the
      // GENERAL_FAMILY case already `continue`d above), i.e. exactly the
      // SANRAL-conventional board this preference is about.
      if (hideSanralBoard) continue;
    }
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
      defaultSector: derivedSector(
        t.family,
        categoriesByKey.get(`id:${t.id}`) ?? (t.ocid ? categoriesByKey.get(`ocid:${t.ocid}`) : undefined) ?? (t.contract_no ? categoriesByKey.get(`no:${t.contract_no}`) : undefined)
      ),
      family: t.family,
      outcome: outcomeByTender.get(t.id) ?? EMPTY_OUTCOME,
      readiness: null,
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
  const readinessScores = await Promise.all(
    biddingCards.map(async (c) => {
      try {
        if (c.family === SANRAL_CONVENTIONAL_FAMILY) {
          const snap = await loadPackReviewSnapshot(c.id);
          return snap.mapped ? computeTenderReadiness(snap.sections).score : null;
        }
        if (c.family === GENERAL_FAMILY) {
          const snap = await loadGeneralPackReviewSnapshot(c.id);
          return snap.mapped ? computeTenderReadiness(snap.sections).score : null;
        }
      } catch (e) {
        console.error("readiness score failed for pipeline card", c.id, e);
      }
      return null;
    }),
  );
  biddingCards.forEach((c, i) => {
    c.readiness = readinessScores[i];
  });

  const byStage = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, [] as Card[]])) as Record<PipelineStage, Card[]>;
  for (const c of cards) byStage[c.stage].push(c);
  // Open work sorts by what closes next; outcomes by most recent first.
  for (const s of ["submitted", "won", "lost"] as const) {
    byStage[s].sort((a, b) => (b.stageChangedAt ?? "").localeCompare(a.stageChangedAt ?? ""));
  }

  const submittedToDate = cards.filter((c) => c.submittedAt).length;

  // Header strip (item 4): active bids (Discovered + Assessing & building,
  // i.e. not yet at an outcome), total value being bid (sum of this
  // company's own submitted_price_zar across those same active cards - the
  // only "value" this app tracks, same field the card itself shows),
  // submitted this month (submitted_at's calendar month = now's), win rate
  // (Awarded / (Awarded + Lost), the only two outcomes that exist).
  const activeCards = IN_PROGRESS_STAGES.flatMap((s) => byStage[s]);
  const activeBids = activeCards.length;
  const totalValueBeingBid = activeCards.reduce((sum, c) => sum + (toNumber(c.economics?.submitted_price_zar) ?? 0), 0);
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
                        <th className="px-3 py-2 font-medium">Client</th>
                        <th className="px-3 py-2 font-medium">Stage</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                        <th className="px-3 py-2 font-medium">Closing</th>
                        <th className="px-3 py-2 font-medium">Owner</th>
                        <th className="px-3 py-2 font-medium">Readiness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cards.map((c) => {
                        const left = daysUntil(c.closingDate);
                        const meta = STAGE_META[c.stage];
                        const owner = c.economics?.submitted_by_person_id ? peopleById.get(c.economics.submitted_by_person_id) : null;
                        return (
                          <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                            <td className="px-3 py-2">
                              <Link href={`/tenders/${c.id}`} className="font-semibold text-foreground no-underline hover:underline">
                                {c.contractNo ?? c.title}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{c.buyer}</td>
                            <td className="px-3 py-2">
                              <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.chipClass)}>{meta.label}</span>
                            </td>
                            <td className="px-3 py-2 text-foreground">{formatRand(toNumber(c.economics?.submitted_price_zar))}</td>
                            <td className={cn("px-3 py-2", closingColorClass(left, c.closingDate))}>{c.closingDate ? shortDate(c.closingDate) : "-"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{owner ?? "-"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{c.readiness !== null ? `${c.readiness}%` : "-"}</td>
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
                    return (
                      <Link
                        key={c.id}
                        href={`/tenders/${c.id}`}
                        className="rounded-lg border border-border bg-card p-3 text-inherit no-underline hover:bg-muted/50"
                      >
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-foreground">{c.contractNo ?? c.title}</span>
                          <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.chipClass)}>{meta.label}</span>
                        </div>
                        <div className="mb-1 text-xs text-muted-foreground">{c.buyer}</div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="font-semibold text-foreground">{formatRand(toNumber(c.economics?.submitted_price_zar))}</span>
                          <span className={closingColorClass(left, c.closingDate)}>{c.closingDate ? shortDate(c.closingDate) : "No closing date"}</span>
                          {owner && <span className="text-muted-foreground">Owner: {owner}</span>}
                          {c.readiness !== null && <span className="text-muted-foreground">Readiness: {c.readiness}%</span>}
                        </div>
                      </Link>
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
  const left = daysUntil(card.closingDate);
  const open = card.stage === "found" || card.stage === "bidding";
  const back = PREVIOUS_STAGE[card.stage];
  const owner = card.economics?.submitted_by_person_id ? people.find((p) => p.id === card.economics!.submitted_by_person_id)?.name ?? null : null;

  let dateLine: { text: string; className: string };
  if (!open) {
    const when = card.stage === "submitted" ? card.submittedAt : card.stageChangedAt;
    dateLine = {
      text: `${card.stage === "submitted" ? "Submitted" : STAGE_META[card.stage].label} ${shortDate(when)}`,
      className: "text-muted-foreground",
    };
  } else if (left === null) {
    dateLine = { text: "No closing date", className: "text-muted-foreground" };
  } else if (isPast(card.closingDate)) {
    // Usually means it was handed in and just needs moving to Submitted.
    dateLine = { text: `Closed ${shortDate(card.closingDate)}`, className: "text-destructive" };
  } else {
    dateLine = { text: `Closes ${shortDate(card.closingDate)} · ${left} day${left === 1 ? "" : "s"} left`, className: closingColorClass(left, card.closingDate) };
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <Link href={`/tenders/${card.id}`} className="block text-inherit no-underline">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          {card.contractNo && <span className="font-mono text-[11px] font-semibold break-words text-foreground">{card.contractNo}</span>}
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
        <div className="mb-0.5 line-clamp-3 text-sm font-semibold text-foreground">{card.title}</div>
        <div className="mb-1 text-xs text-muted-foreground">{card.buyer}</div>
        <div className={cn("text-[11px] font-semibold", dateLine.className)}>{dateLine.text}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {card.economics?.submitted_price_zar != null && (
            <span className="text-[11px] font-semibold text-foreground">{formatRand(toNumber(card.economics.submitted_price_zar))}</span>
          )}
          {card.readiness !== null && (
            <span
              title="Readiness score"
              className={cn(
                "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                card.readiness === 100 ? "bg-success/15 text-success" : card.readiness >= 50 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive",
              )}
            >
              {card.readiness}%
            </span>
          )}
          {owner && (
            <span
              title={`Owner: ${owner}`}
              className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-foreground"
            >
              {initials(owner)}
            </span>
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

      {/* Outcome (item 4): winning company/price, bidders, reason lost -
          see outcome-form.tsx for why these live in tender_answers. */}
      <OutcomeForm tenderId={card.id} stage={card.stage} outcome={card.outcome} />

      {/* Price & credit (items 26/27): from Bidding on, once a pack row exists. */}
      {card.stage !== "found" && (
        <EconomicsForm
          tenderId={card.id}
          economics={card.economics}
          people={people}
          defaultSector={card.defaultSector}
          taxonomy={taxonomy}
          prompt={!open && card.economics?.submitted_price_zar == null}
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
