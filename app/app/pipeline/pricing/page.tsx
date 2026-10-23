import type { ReactNode } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadDisciplineTaxonomy, taxonomyGroups } from "@/lib/disciplineTaxonomy";
import { STAGE_META, type PipelineStage } from "@/lib/pipeline";
import {
  clientLabel,
  commissionText,
  derivedSector,
  ECONOMICS_COLUMNS,
  formatRand,
  median,
  sectorGroup,
  sectorLabel,
  tenderTypeLabel,
  toNumber,
  type PackEconomics,
} from "@/lib/dealEconomics";
import { AppShell } from "../../_components/AppShell";
import { EconomicsForm, type CreditPerson } from "../economics-form";
import { MarketComparison } from "./market-comparison";
import { EmptyState } from "@/components/tt/empty-state";
import { ErrorState } from "@/components/tt/error-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Per-company data under RLS on every request (same as /pipeline).
export const instant = false;

type PackRow = PackEconomics & {
  tender_id: string;
  pipeline_stage: PipelineStage;
  submitted_at: string | null;
  tenders: { contract_no: string | null; title: string | null; description: string | null; buyer: string | null; family: string | null; ocid: string | null } | null;
};

type Row = {
  tenderId: string;
  contractNo: string | null;
  title: string;
  type: string;
  client: string;
  sector: string | null;
  sectorDerived: boolean;
  stage: PipelineStage;
  submittedAt: string | null;
  price: number | null;
  inclVat: boolean;
  person: string | null;
  commission: string | null;
  pack: PackEconomics;
  defaultSector: ReturnType<typeof derivedSector>;
};

const GROUPS = { type: "Tender type", client: "Client", sector: "Sector" } as const;
type GroupKey = keyof typeof GROUPS;
const OUTCOMES = ["all", "submitted", "won", "lost"] as const;

function shortDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "-";
}

const selectClass = "min-h-11 w-full max-w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Pricing history (feature list item 27, with item 26's credit alongside):
 * the company's OWN submitted prices across its tenders, filterable and
 * grouped by tender type, client and sector. Internal pricing intelligence
 * for the company - never customer- or buyer-facing. A filtered table plus a
 * per-group summary (count, low / median / high, won value); not a BI tool.
 *
 * Design-system audit fix (2026-10-21): converted from inline-CSSProperties
 * stale hex to Tailwind + design tokens, fixed the stale "Pipeline" label
 * (this screen is "Bids" everywhere else in the app now), and the main
 * "Tenders" table becomes a stacked card list on mobile instead of a
 * squeezed 10-column table.
 */
export default async function PricingHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; client?: string; sector?: string; outcome?: string; group?: string; error?: string }>;
}) {
  const sp = await searchParams;

  try {
    return await renderPricingHistory(sp);
  } catch (e) {
    console.error("pricing history page failed to load", e);
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
          <ErrorState
            action={
              <Link href="/pipeline/pricing" className={buttonVariants({ variant: "outline", className: "min-h-11" })}>
                Retry
              </Link>
            }
          />
        </div>
      </AppShell>
    );
  }
}

async function renderPricingHistory(sp: { type?: string; client?: string; sector?: string; outcome?: string; group?: string; error?: string }) {
  const group: GroupKey = sp.group === "client" || sp.group === "sector" ? sp.group : "type";
  const outcome = (OUTCOMES as readonly string[]).includes(sp.outcome ?? "") ? (sp.outcome as (typeof OUTCOMES)[number]) : "all";

  const supabase = await createClient();
  const [{ data: packs, error }, { data: peopleRows }, { data: opportunities }] = await Promise.all([
    supabase
      .from("tender_packs")
      .select(`tender_id, pipeline_stage, submitted_at, ${ECONOMICS_COLUMNS}, tenders(contract_no, title, description, buyer, family, ocid)`)
      .in("pipeline_stage", ["bidding", "submitted", "won", "lost"]),
    supabase.from("people").select("id, name").order("name"),
    // Scaling fix (see app/lib/discoveryPagination.ts's module comment for
    // the root-cause writeup): only used below to look up `categories` for
    // tenders already in this company's own pack history (`packs` above) -
    // every discovered_opportunities row that can match one of those packs
    // has `tender_id` set (pursue_discovered_opportunity() always backfills
    // it once a tender is pursued), so this never drops a row the lookup
    // below still needs.
    supabase.from("discovered_opportunities").select("ocid, contract_number, tender_id, categories").not("tender_id", "is", null),
  ]);
  const people = (peopleRows ?? []) as CreditPerson[];
  const taxonomy = await loadDisciplineTaxonomy(supabase);
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  if (error) console.error("tender_packs select failed for pricing history", error);

  const categoriesByKey = new Map<string, string[]>();
  for (const o of (opportunities ?? []) as { ocid: string | null; contract_number: string | null; tender_id: string | null; categories: string[] | null }[]) {
    if (!o.categories?.length) continue;
    for (const key of [o.tender_id && `id:${o.tender_id}`, o.ocid && `ocid:${o.ocid}`, o.contract_number && `no:${o.contract_number}`]) {
      if (key) categoriesByKey.set(key, o.categories);
    }
  }

  const all: Row[] = ((packs ?? []) as unknown as PackRow[]).map((p) => {
    const t = p.tenders;
    const cats =
      categoriesByKey.get(`id:${p.tender_id}`) ??
      (t?.ocid ? categoriesByKey.get(`ocid:${t.ocid}`) : undefined) ??
      (t?.contract_no ? categoriesByKey.get(`no:${t.contract_no}`) : undefined);
    const derived = derivedSector(t?.family ?? null, cats);
    return {
      tenderId: p.tender_id,
      contractNo: t?.contract_no ?? null,
      title: t?.title || t?.description || "(untitled)",
      type: tenderTypeLabel(t?.family ?? null),
      client: clientLabel(t?.buyer ?? null, t?.family ?? null),
      sector: p.price_sector ?? derived,
      sectorDerived: !p.price_sector && !!derived,
      stage: p.pipeline_stage,
      submittedAt: p.submitted_at,
      price: toNumber(p.submitted_price_zar),
      inclVat: p.submitted_price_incl_vat !== false,
      person: p.submitted_by_person_id ? nameById.get(p.submitted_by_person_id) ?? "(removed person)" : null,
      commission: commissionText(p),
      pack: p,
      defaultSector: derived,
    };
  });

  const priced = all.filter((r) => r.price !== null);
  // Handed in but never priced: the gap this page exists to close.
  const unpriced = all.filter((r) => r.price === null && r.stage !== "bidding");

  const types = [...new Set(priced.map((r) => r.type))].sort();
  const clients = [...new Set(priced.map((r) => r.client))].sort();

  const rows = priced
    .filter((r) => !sp.type || r.type === sp.type)
    .filter((r) => !sp.client || r.client === sp.client)
    // a group filter takes every discipline in it (0040)
    .filter((r) => !sp.sector || (sp.sector === "none" ? !r.sector : r.sector === sp.sector || sectorGroup(r.sector, taxonomy) === sp.sector))
    .filter((r) => outcome === "all" || r.stage === outcome)
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));

  // "By sector" rolls a discipline up to its group (road maintenance and
  // bridges are both Roads, bridges & civil works) so a history doesn't
  // splinter into one-row groups; the row itself shows the exact sector.
  const groupOf = (r: Row) => (group === "type" ? r.type : group === "client" ? r.client : sectorLabel(sectorGroup(r.sector, taxonomy), taxonomy));
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(groupOf(r), [...(groups.get(groupOf(r)) ?? []), r]);
  const summary = [...groups.entries()]
    .map(([name, rs]) => {
      const prices = rs.map((r) => r.price as number);
      const decided = rs.filter((r) => r.stage === "won" || r.stage === "lost").length;
      const won = rs.filter((r) => r.stage === "won");
      return {
        name,
        count: rs.length,
        low: Math.min(...prices),
        mid: median(prices),
        high: Math.max(...prices),
        won: won.length,
        decided,
        wonValue: won.reduce((s, r) => s + (r.price as number), 0),
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const mixedVat = new Set(rows.map((r) => r.inclVat)).size > 1;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
        <Link href="/pipeline" className="min-h-11 content-center text-sm text-muted-foreground no-underline hover:underline">← Bids</Link>
        <h1 className="mt-1.5 mb-1 font-display text-xl font-medium text-foreground sm:text-2xl">Pricing history</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          What you have submitted at, by tender type, client and sector, and how it compared with the published results. Internal only: nothing here goes into a submission pack.
        </p>

        {(error || sp.error) && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error ? "Couldn't load pricing history - try refreshing. If it keeps happening, let us know." : sp.error}
          </div>
        )}

        {unpriced.length > 0 && (
          <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            {unpriced.length} submitted tender{unpriced.length === 1 ? " has" : "s have"} no price recorded yet:{" "}
            {unpriced.map((r) => r.contractNo || r.title).join(", ")}. Record it on the{" "}
            <Link href="/pipeline" className="font-semibold text-accent">Bids</Link> card.
          </div>
        )}

        <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
          <Filter label="Tender type">
            <select name="type" defaultValue={sp.type ?? ""} className={selectClass}>
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Filter>
          <Filter label="Client">
            <select name="client" defaultValue={sp.client ?? ""} className={selectClass}>
              <option value="">All clients</option>
              {clients.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Filter>
          <Filter label="Sector">
            <select name="sector" defaultValue={sp.sector ?? ""} className={selectClass}>
              <option value="">All sectors</option>
              {taxonomyGroups(taxonomy).map(({ group, children }) => (
                <optgroup key={group.slug} label={group.label}>
                  <option value={group.slug}>{group.label} (all)</option>
                  {children.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                </optgroup>
              ))}
              <option value="none">Unclassified</option>
            </select>
          </Filter>
          <Filter label="Outcome">
            <select name="outcome" defaultValue={outcome} className={selectClass}>
              <option value="all">Any outcome</option>
              <option value="submitted">Awaiting outcome</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </Filter>
          <Filter label="Group by">
            <select name="group" defaultValue={group} className={selectClass}>
              {(Object.keys(GROUPS) as GroupKey[]).map((g) => <option key={g} value={g}>{GROUPS[g]}</option>)}
            </select>
          </Filter>
          <button type="submit" className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Apply
          </button>
          <Link href="/pipeline/pricing" className="min-h-11 content-center text-xs text-muted-foreground">Clear</Link>
        </form>

        {priced.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card">
            <EmptyState
              icon={ClipboardList}
              title="No priced tenders yet"
              description={
                <>
                  Open &ldquo;Price &amp; credit&rdquo; on a Bidding, Submitted, Won or Lost card on <Link href="/pipeline" className="font-semibold text-accent">Bids</Link>.
                </>
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card">
            <EmptyState icon={ClipboardList} title="No matches" description="No priced tenders match these filters." />
          </div>
        ) : (
          <>
            <h2 className="mb-2 text-base font-semibold text-foreground">By {GROUPS[group].toLowerCase()}</h2>
            {mixedVat && (
              <p className="mb-2 text-xs text-warning">
                These rows mix VAT-inclusive and VAT-exclusive prices; the summary adds them as typed.
              </p>
            )}
            <div className="mb-5 overflow-x-auto rounded-lg border border-border bg-card" style={{ WebkitOverflowScrolling: "touch" }}>
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold whitespace-nowrap text-muted-foreground">
                    <th className="px-2.5 py-2">{GROUPS[group]}</th>
                    <th className="px-2.5 py-2 text-right">Tenders</th>
                    <th className="px-2.5 py-2 text-right">Lowest</th>
                    <th className="px-2.5 py-2 text-right">Median</th>
                    <th className="px-2.5 py-2 text-right">Highest</th>
                    <th className="px-2.5 py-2 text-right">Won / decided</th>
                    <th className="px-2.5 py-2 text-right">Won value</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((g) => (
                    <tr key={g.name} className="border-b border-border/60 text-sm text-foreground last:border-0">
                      <td className="px-2.5 py-2 font-semibold">{g.name}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">{g.count}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">{formatRand(g.low)}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">{formatRand(g.mid)}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">{formatRand(g.high)}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">{g.decided ? `${g.won} / ${g.decided}` : "-"}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">{g.won ? formatRand(g.wonValue) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="mb-2 text-base font-semibold text-foreground">
              Tenders ({rows.length})
            </h2>

            {/* Desktop/tablet: the full 10-column table, side-scrolling with
                a sticky identifying column. Mobile: a stacked card per
                tender - a 10-column table squeezed to a phone cuts content
                off (design-system audit fix, 2026-10-21). */}
            <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block" style={{ WebkitOverflowScrolling: "touch" }}>
              <table className="w-full min-w-[980px] border-collapse">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold whitespace-nowrap text-muted-foreground">
                    <th className="sticky left-0 z-1 bg-card px-2.5 py-2 shadow-[2px_0_4px_oklch(0.2393_0.0581_256.7_/_6%)]">Tender</th>
                    <th className="px-2.5 py-2">Client</th>
                    <th className="px-2.5 py-2">Type</th>
                    <th className="px-2.5 py-2">Sector</th>
                    <th className="px-2.5 py-2">Outcome</th>
                    <th className="px-2.5 py-2">Submitted</th>
                    <th className="px-2.5 py-2 text-right">Price</th>
                    <th className="px-2.5 py-2">Credit</th>
                    <th className="px-2.5 py-2">Commission</th>
                    <th className="px-2.5 py-2">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const meta = STAGE_META[r.stage];
                    return (
                      <tr key={r.tenderId} className="border-b border-border/60 text-sm align-top last:border-0">
                        <td className="sticky left-0 z-1 max-w-[260px] bg-card px-2.5 py-2 shadow-[2px_0_4px_oklch(0.2393_0.0581_256.7_/_6%)]">
                          <Link href={`/tenders/${r.tenderId}`} className="text-foreground no-underline hover:underline">
                            {r.contractNo && <div className="font-mono text-[11px] font-semibold">{r.contractNo}</div>}
                            <div className="text-xs">{r.title}</div>
                          </Link>
                        </td>
                        <td className="px-2.5 py-2 text-foreground">{r.client}</td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-foreground">{r.type}</td>
                        <td className="px-2.5 py-2 text-foreground">
                          {sectorLabel(r.sector, taxonomy)}
                          {r.sectorDerived && <div className="text-[10px] text-muted-foreground">suggested</div>}
                        </td>
                        <td className="px-2.5 py-2">
                          <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", meta.chipClass)}>
                            {r.stage === "submitted" ? "Awaiting" : meta.label}
                          </span>
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-foreground">{shortDate(r.submittedAt)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-foreground">
                          {formatRand(r.price)}
                          {!r.inclVat && <div className="text-[10px] text-muted-foreground">excl. VAT</div>}
                        </td>
                        <td className="px-2.5 py-2 text-foreground">{r.person ?? "-"}</td>
                        <td className="px-2.5 py-2 text-foreground">
                          {r.commission ?? "-"}
                          {r.pack.commission_note && <div className="text-xs text-muted-foreground">{r.pack.commission_note}</div>}
                        </td>
                        <td className="min-w-[220px] px-2.5 py-2">
                          <EconomicsForm tenderId={r.tenderId} economics={r.pack} people={people} defaultSector={r.defaultSector} taxonomy={taxonomy} returnTo="pricing" toggleLabel="Edit" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2 md:hidden">
              {rows.map((r) => {
                const meta = STAGE_META[r.stage];
                return (
                  <div key={r.tenderId} className="rounded-lg border border-border bg-card p-3">
                    <Link href={`/tenders/${r.tenderId}`} className="block text-inherit no-underline">
                      {r.contractNo && <div className="font-mono text-xs font-semibold text-foreground">{r.contractNo}</div>}
                      <div className="text-sm font-medium text-foreground">{r.title}</div>
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.chipClass)}>
                        {r.stage === "submitted" ? "Awaiting" : meta.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{r.client}</span>
                      <span className="text-xs text-muted-foreground">· {r.type}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="font-semibold text-foreground">
                        {formatRand(r.price)}
                        {!r.inclVat && " (excl. VAT)"}
                      </span>
                      <span className="text-muted-foreground">Submitted {shortDate(r.submittedAt)}</span>
                      {r.person && <span className="text-muted-foreground">Credit: {r.person}</span>}
                    </div>
                    {(r.commission || r.pack.commission_note) && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Commission: {r.commission ?? "-"}
                        {r.pack.commission_note ? ` · ${r.pack.commission_note}` : ""}
                      </div>
                    )}
                    <div className="mt-2 border-t border-border pt-2">
                      <EconomicsForm tenderId={r.tenderId} economics={r.pack} people={people} defaultSector={r.defaultSector} taxonomy={taxonomy} returnTo="pricing" toggleLabel="Edit" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Published registers / awards for these tenders (0044). */}
            <MarketComparison tenders={rows.map((r) => ({ tenderId: r.tenderId, contractNo: r.contractNo, title: r.title, price: r.price }))} />
          </>
        )}
      </div>
    </AppShell>
  );
}

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
