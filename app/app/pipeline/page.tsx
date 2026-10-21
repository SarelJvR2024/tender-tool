import type { CSSProperties } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/dates";
import { GENERAL_FAMILY } from "@/lib/generalTender";
import { SANRAL_CONVENTIONAL_FAMILY } from "@/lib/tenderCompliance";
import { NEXT_STAGES, OUTCOME_FIELD_KEYS, PIPELINE_STAGES, PREVIOUS_STAGE, STAGE_META, type PipelineStage } from "@/lib/pipeline";
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

// Same chip vocabulary as app/app/discovery/page.tsx's verdictChip().
const VERDICT_CHIP: Record<string, { label: string; bg: string; color: string }> = {
  strong_fit: { label: "Strong fit", bg: "#DCFCE7", color: "#15803D" },
  possible: { label: "Possible", bg: "#FEF3C7", color: "#B45309" },
  needs_review: { label: "Needs review", bg: "#FEF3C7", color: "#B45309" },
  not_a_fit: { label: "Not a fit", bg: "#FEE2E2", color: "#B91C1C" },
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

// Card spec (item 4): "closing date with colour (red < 3d, amber < 7d)".
function closingColor(left: number | null, closingDate: string | null): string {
  if (left === null) return "#8A93A0";
  if (isPast(closingDate)) return "#B91C1C";
  if (left < 3) return "#B91C1C";
  if (left < 7) return "#B45309";
  return "#5B6472";
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const [{ data: tenders, error }, { data: opportunities }, { data: peopleRows }, { data: outcomeRows }] = await Promise.all([
    supabase
      .from("tenders")
      .select(`id, contract_no, title, description, buyer, closing_date, family, status, ocid, tender_packs(pipeline_stage, stage_changed_at, submitted_at, ${ECONOMICS_COLUMNS})`)
      .order("closing_date", { ascending: true }),
    // Discovery's fit verdict, where this tender came from the scored feed.
    supabase.from("discovered_opportunities").select("ocid, contract_number, tender_id, verdict, categories, downgraded_from, downgrade_acknowledged_at"),
    // Who can get credit for a submission (item 26, migration 0034): the
    // company's people roster, same list the task assignee picker uses.
    supabase.from("people").select("id, name").order("name"),
    // Outcome facts (item 4) - tender_answers' own outcome:* keys, see
    // recordOutcomeAndMoveStage (pipeline/actions.ts) for why this table.
    supabase.from("tender_answers").select("tender_id, field_key, value").in("field_key", Object.values(OUTCOME_FIELD_KEYS)),
  ]);
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
  // Pack Review read per tender is real Supabase cost (same N+1 concern
  // flagged for Home's own "specific next step", app/AGENTS.md "Home
  // cockpit").
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
  const activeCards = [...byStage.found, ...byStage.bidding];
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
      <div style={{ flex: 1, padding: "24px 16px", maxWidth: 1240, width: "100%", margin: "0 auto", boxSizing: "border-box", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Bids</h1>
          <Link href="/pipeline/pricing" style={{ fontSize: 13, fontWeight: 600, color: "#D97706", textDecoration: "none" }}>
            Pricing history →
          </Link>
        </div>
        <p style={{ fontSize: 13, color: "#5B6472", margin: "0 0 16px" }}>
          Every tender you&apos;re tracking, by stage. Open a card for its workspace; move it on when something changes.
        </p>

        {(error || actionError) && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            {error ? "Couldn't load tenders - try refreshing. If it keeps happening, let us know." : actionError}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard label="Active bids" value={activeBids} color="#16233B" />
          <StatCard label="Total value being bid" value={formatRand(totalValueBeingBid)} color="#16233B" />
          <StatCard label="Submitted this month" value={submittedThisMonth} color="#16233B" />
          <StatCard label="Win rate" value={winRate === null ? "-" : `${winRate}%`} color={winRate !== null && winRate >= 50 ? "#15803D" : "#16233B"} />
        </div>
        <p style={{ fontSize: 11, color: "#8A93A0", margin: "-12px 0 20px" }}>
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
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#5B6472", borderBottom: "1px solid #E3E6EA" }}>
                    <th style={{ padding: "6px 8px" }}>Tender</th>
                    <th style={{ padding: "6px 8px" }}>Client</th>
                    <th style={{ padding: "6px 8px" }}>Stage</th>
                    <th style={{ padding: "6px 8px" }}>Value</th>
                    <th style={{ padding: "6px 8px" }}>Closing</th>
                    <th style={{ padding: "6px 8px" }}>Owner</th>
                    <th style={{ padding: "6px 8px" }}>Readiness</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((c) => {
                    const left = daysUntil(c.closingDate);
                    const meta = STAGE_META[c.stage];
                    const owner = c.economics?.submitted_by_person_id ? peopleById.get(c.economics.submitted_by_person_id) : null;
                    return (
                      <tr key={c.id} style={{ borderBottom: "1px solid #ECEEF1" }}>
                        <td style={{ padding: "8px" }}>
                          <Link href={`/tenders/${c.id}`} style={{ color: "#16233B", fontWeight: 600, textDecoration: "none" }}>
                            {c.contractNo ?? c.title}
                          </Link>
                        </td>
                        <td style={{ padding: "8px", color: "#4B5563" }}>{c.buyer}</td>
                        <td style={{ padding: "8px" }}>
                          <span style={{ padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 700, background: meta.bg, color: meta.color }}>{meta.label}</span>
                        </td>
                        <td style={{ padding: "8px", color: "#16233B" }}>{formatRand(toNumber(c.economics?.submitted_price_zar))}</td>
                        <td style={{ padding: "8px", color: closingColor(left, c.closingDate) }}>{c.closingDate ? shortDate(c.closingDate) : "-"}</td>
                        <td style={{ padding: "8px", color: "#4B5563" }}>{owner ?? "-"}</td>
                        <td style={{ padding: "8px", color: "#4B5563" }}>{c.readiness !== null ? `${c.readiness}%` : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TabsContent>
          <TabsContent value="board">
            {/* The board scrolls sideways on its own on a phone; the page itself never does.
                Nothing used to hint that Won/Lost sit off-screen, so a right-edge
                fade (hidden once the board actually fits, i.e. desktop widths) +
                a small text cue give the scroll somewhere to point at. */}
            <div style={{ position: "relative" }}>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(220px, 1fr))", gap: 12, alignItems: "start" }}>
                {PIPELINE_STAGES.map((stage) => {
                  const meta = STAGE_META[stage];
                  const column = byStage[stage];
                  return (
                    <section key={stage} style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 11, padding: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 4px 0" }}>
                        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: meta.bg, color: meta.color }}>
                          {meta.label}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#5B6472" }}>{column.length}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#8A93A0", padding: "6px 4px 10px" }}>{meta.hint}</div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {column.length === 0 && (
                          <div style={{ fontSize: 12, color: "#8A93A0", padding: "14px 8px", textAlign: "center", border: "1px dashed #E3E6EA", borderRadius: 9 }}>
                            {EMPTY_COPY[stage]}
                          </div>
                        )}
                        {column.map((c) => (
                          <TenderCard key={c.id} card={c} people={people} taxonomy={taxonomy} />
                        ))}
                      </div>

                      {stage === "found" && (
                        <Link href="/discovery" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#D97706", textDecoration: "none", padding: "10px 4px 2px" }}>
                          Find more in Opportunities →
                        </Link>
                      )}
                    </section>
                  );
                })}
                </div>
              </div>
              {/* Right-edge fade: the only hint, on narrower viewports, that
                  Won/Lost sit off-screen to the right. */}
              <ScrollFade fadeColor="255, 255, 255" minWidthToHide={1180} />
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

  let dateLine: { text: string; color: string };
  if (!open) {
    const when = card.stage === "submitted" ? card.submittedAt : card.stageChangedAt;
    dateLine = {
      text: `${card.stage === "submitted" ? "Submitted" : STAGE_META[card.stage].label} ${shortDate(when)}`,
      color: "#5B6472",
    };
  } else if (left === null) {
    dateLine = { text: "No closing date", color: "#8A93A0" };
  } else if (isPast(card.closingDate)) {
    // Usually means it was handed in and just needs moving to Submitted.
    dateLine = { text: `Closed ${shortDate(card.closingDate)}`, color: "#B91C1C" };
  } else {
    dateLine = { text: `Closes ${shortDate(card.closingDate)} · ${left} day${left === 1 ? "" : "s"} left`, color: closingColor(left, card.closingDate) };
  }

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 9, padding: "10px 12px" }}>
      <Link href={`/tenders/${card.id}`} style={{ display: "block", textDecoration: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
          {card.contractNo && (
            <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: "#16233B", overflowWrap: "anywhere" }}>{card.contractNo}</span>
          )}
          {verdict && (
            <span style={{ padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 600, background: verdict.bg, color: verdict.color }}>{verdict.label}</span>
          )}
          {card.wasVerdict && (
            <span
              title="Re-assessed: the Discovery verdict got worse since this tender was found - see its Discovery entry"
              style={{ padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 700, background: card.downgradeOpen ? "#FEE2E2" : "#FFFFFF", color: card.downgradeOpen ? "#B91C1C" : "#5B6472" }}
            >
              {card.downgradeOpen ? "\u26A0 " : ""}Re-assessed · was {VERDICT_CHIP[card.wasVerdict]?.label ?? card.wasVerdict}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#16233B", marginBottom: 2, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {card.title}
        </div>
        <div style={{ fontSize: 12, color: "#4B5563", marginBottom: 4 }}>{card.buyer}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: dateLine.color }}>{dateLine.text}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          {card.economics?.submitted_price_zar != null && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "#16233B" }}>{formatRand(toNumber(card.economics.submitted_price_zar))}</span>
          )}
          {card.readiness !== null && (
            <span
              title="Readiness score"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 20,
                height: 20,
                padding: "0 5px",
                borderRadius: 100,
                fontSize: 10,
                fontWeight: 700,
                background: card.readiness === 100 ? "#DCFCE7" : card.readiness >= 50 ? "#FEF3C7" : "#FEE2E2",
                color: card.readiness === 100 ? "#15803D" : card.readiness >= 50 ? "#B45309" : "#B91C1C",
              }}
            >
              {card.readiness}%
            </span>
          )}
          {owner && (
            <span
              title={`Owner: ${owner}`}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: "50%", background: "#E8EBF1", color: "#16233B", fontSize: 9, fontWeight: 700 }}
            >
              {initials(owner)}
            </span>
          )}
        </div>
      </Link>

      {card.stage !== "submitted" && (NEXT_STAGES[card.stage].length > 0 || back) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 10, paddingTop: 8, borderTop: "1px solid #ECEEF1" }}>
          {NEXT_STAGES[card.stage].map((next) => (
            <StageButton key={next} tenderId={card.id} stage={next} primary />
          ))}
          {back && <StageButton tenderId={card.id} stage={back} />}
        </div>
      )}
      {card.stage === "submitted" && back && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #ECEEF1" }}>
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
  const style: CSSProperties = primary
    ? {
        // This is the single action that actually moves a tender forward on
        // this board - on a phone it's tapped once per card, repeatedly down
        // a scrolling column, so it gets the same 44px minimum as every other
        // primary button in the app (company page, task-add), not the 32px
        // used for lighter secondary controls like the "<- Back" link below.
        minHeight: 44,
        padding: "0 14px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        border: stage === "won" ? "1px solid #15803D" : stage === "lost" ? "1px solid #B91C1C" : "none",
        background: stage === "won" ? "#DCFCE7" : stage === "lost" ? "#FEE2E2" : "#16233B",
        color: stage === "won" ? "#15803D" : stage === "lost" ? "#B91C1C" : "#FFFFFF",
      }
    : { minHeight: 32, padding: "0 6px", border: "none", background: "transparent", fontSize: 12, color: "#8A93A0", cursor: "pointer" };
  return (
    <form action={moveTenderStage}>
      <input type="hidden" name="tender_id" value={tenderId} />
      <input type="hidden" name="stage" value={stage} />
      <button type="submit" style={style} title={primary ? undefined : `Move back to ${STAGE_META[stage].label}`}>
        {label}
      </button>
    </form>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 9, padding: "13px 16px" }}>
      <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
