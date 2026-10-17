import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DISCIPLINES } from "@/lib/experience";
import { STAGE_META, type PipelineStage } from "@/lib/pipeline";
import {
  clientLabel,
  commissionText,
  derivedSector,
  ECONOMICS_COLUMNS,
  formatRand,
  median,
  sectorLabel,
  tenderTypeLabel,
  toNumber,
  type PackEconomics,
} from "@/lib/dealEconomics";
import { SiteNav } from "../../_components/SiteNav";
import { EconomicsForm, type CreditPerson } from "../economics-form";

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

/**
 * Pricing history (feature list item 27, with item 26's credit alongside):
 * the company's OWN submitted prices across its tenders, filterable and
 * grouped by tender type, client and sector. Internal pricing intelligence
 * for the company - never customer- or buyer-facing. A filtered table plus a
 * per-group summary (count, low / median / high, won value); not a BI tool.
 */
export default async function PricingHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; client?: string; sector?: string; outcome?: string; group?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const group: GroupKey = sp.group === "client" || sp.group === "sector" ? sp.group : "type";
  const outcome = (OUTCOMES as readonly string[]).includes(sp.outcome ?? "") ? (sp.outcome as (typeof OUTCOMES)[number]) : "all";

  const supabase = await createClient();
  const [{ data: packs, error }, { data: peopleRows }, { data: opportunities }] = await Promise.all([
    supabase
      .from("tender_packs")
      .select(`tender_id, pipeline_stage, submitted_at, ${ECONOMICS_COLUMNS}, tenders(contract_no, title, description, buyer, family, ocid)`)
      .in("pipeline_stage", ["bidding", "submitted", "won", "lost"]),
    supabase.from("people").select("id, name").order("name"),
    supabase.from("discovered_opportunities").select("ocid, contract_number, tender_id, categories"),
  ]);
  const people = (peopleRows ?? []) as CreditPerson[];
  const nameById = new Map(people.map((p) => [p.id, p.name]));

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
    .filter((r) => !sp.sector || (sp.sector === "none" ? !r.sector : r.sector === sp.sector))
    .filter((r) => outcome === "all" || r.stage === outcome)
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));

  const groupOf = (r: Row) => (group === "type" ? r.type : group === "client" ? r.client : sectorLabel(r.sector));
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

  const select: CSSProperties = { minHeight: 36, padding: "0 8px", borderRadius: 7, border: "1px solid #E5E1D5", background: "#FFFFFF", fontSize: 13, color: "#16233B", maxWidth: "100%" };
  const th: CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6B6758", padding: "8px 10px", borderBottom: "1px solid #E5E1D5", whiteSpace: "nowrap" };
  const td: CSSProperties = { fontSize: 13, color: "#16233B", padding: "8px 10px", borderBottom: "1px solid #F0EEE6", verticalAlign: "top" };
  const num: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  // The "Tenders" table below is 10 columns wide (minWidth: 980) and scrolls
  // sideways on a phone - without a frozen first column, scrolling right to
  // see Price/Credit/Commission/Edit loses track of which tender the row
  // even is. Pins the identifying column in place, same idea as a frozen
  // header column in a spreadsheet.
  const stickyCol: CSSProperties = { position: "sticky", left: 0, zIndex: 1, background: "#FFFFFF", boxShadow: "2px 0 4px rgba(22,35,59,0.06)" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: "#F6F5F1" }}>
      <SiteNav active="pipeline" />

      <div style={{ flex: 1, padding: "24px 16px", maxWidth: 1240, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <Link href="/pipeline" style={{ fontSize: 13, color: "#6B6758", textDecoration: "none" }}>← Pipeline</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "6px 0 4px" }}>Pricing history</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 16px" }}>
          What you have submitted at, by tender type, client and sector. Internal only: nothing here goes into a submission pack.
        </p>

        {(error || sp.error) && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            {error ? `Could not load pricing: ${error.message}` : sp.error}
          </div>
        )}

        {unpriced.length > 0 && (
          <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#92400E" }}>
            {unpriced.length} submitted tender{unpriced.length === 1 ? " has" : "s have"} no price recorded yet:{" "}
            {unpriced.map((r) => r.contractNo || r.title).join(", ")}. Record it on the{" "}
            <Link href="/pipeline" style={{ color: "#D97706", fontWeight: 600 }}>Pipeline</Link> card.
          </div>
        )}

        <form method="get" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end", background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: 12, marginBottom: 16 }}>
          <Filter label="Tender type">
            <select name="type" defaultValue={sp.type ?? ""} style={select}>
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Filter>
          <Filter label="Client">
            <select name="client" defaultValue={sp.client ?? ""} style={select}>
              <option value="">All clients</option>
              {clients.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Filter>
          <Filter label="Sector">
            <select name="sector" defaultValue={sp.sector ?? ""} style={select}>
              <option value="">All sectors</option>
              {DISCIPLINES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              <option value="none">Unclassified</option>
            </select>
          </Filter>
          <Filter label="Outcome">
            <select name="outcome" defaultValue={outcome} style={select}>
              <option value="all">Any outcome</option>
              <option value="submitted">Awaiting outcome</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </Filter>
          <Filter label="Group by">
            <select name="group" defaultValue={group} style={select}>
              {(Object.keys(GROUPS) as GroupKey[]).map((g) => <option key={g} value={g}>{GROUPS[g]}</option>)}
            </select>
          </Filter>
          <button type="submit" style={{ minHeight: 36, padding: "0 16px", border: "none", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Apply
          </button>
          <Link href="/pipeline/pricing" style={{ fontSize: 12, color: "#6B6758", alignSelf: "center" }}>Clear</Link>
        </form>

        {priced.length === 0 ? (
          <div style={{ background: "#FFFFFF", border: "1px dashed #E5E1D5", borderRadius: 11, padding: 24, textAlign: "center", fontSize: 13, color: "#6B6758" }}>
            No submitted prices recorded yet. Open &ldquo;Price &amp; credit&rdquo; on a Bidding, Submitted, Won or Lost card on the{" "}
            <Link href="/pipeline" style={{ color: "#D97706", fontWeight: 600 }}>Pipeline</Link>.
          </div>
        ) : rows.length === 0 ? (
          <div style={{ background: "#FFFFFF", border: "1px dashed #E5E1D5", borderRadius: 11, padding: 24, textAlign: "center", fontSize: 13, color: "#6B6758" }}>
            No priced tenders match these filters.
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#16233B", margin: "0 0 8px" }}>By {GROUPS[group].toLowerCase()}</h2>
            {mixedVat && (
              <p style={{ fontSize: 12, color: "#B45309", margin: "0 0 8px" }}>
                These rows mix VAT-inclusive and VAT-exclusive prices; the summary adds them as typed.
              </p>
            )}
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, marginBottom: 20 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>{GROUPS[group]}</th>
                    <th style={{ ...th, textAlign: "right" }}>Tenders</th>
                    <th style={{ ...th, textAlign: "right" }}>Lowest</th>
                    <th style={{ ...th, textAlign: "right" }}>Median</th>
                    <th style={{ ...th, textAlign: "right" }}>Highest</th>
                    <th style={{ ...th, textAlign: "right" }}>Won / decided</th>
                    <th style={{ ...th, textAlign: "right" }}>Won value</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((g) => (
                    <tr key={g.name}>
                      <td style={{ ...td, fontWeight: 600 }}>{g.name}</td>
                      <td style={num}>{g.count}</td>
                      <td style={num}>{formatRand(g.low)}</td>
                      <td style={num}>{formatRand(g.mid)}</td>
                      <td style={num}>{formatRand(g.high)}</td>
                      <td style={num}>{g.decided ? `${g.won} / ${g.decided}` : "-"}</td>
                      <td style={num}>{g.won ? formatRand(g.wonValue) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#16233B", margin: "0 0 8px" }}>
              Tenders ({rows.length})
            </h2>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, ...stickyCol }}>Tender</th>
                    <th style={th}>Client</th>
                    <th style={th}>Type</th>
                    <th style={th}>Sector</th>
                    <th style={th}>Outcome</th>
                    <th style={th}>Submitted</th>
                    <th style={{ ...th, textAlign: "right" }}>Price</th>
                    <th style={th}>Credit</th>
                    <th style={th}>Commission</th>
                    <th style={th}>Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const meta = STAGE_META[r.stage];
                    return (
                      <tr key={r.tenderId}>
                        <td style={{ ...td, ...stickyCol, maxWidth: 260 }}>
                          <Link href={`/tenders/${r.tenderId}`} style={{ color: "#16233B", textDecoration: "none" }}>
                            {r.contractNo && <div style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600 }}>{r.contractNo}</div>}
                            <div style={{ fontSize: 12 }}>{r.title}</div>
                          </Link>
                        </td>
                        <td style={td}>{r.client}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{r.type}</td>
                        <td style={td}>
                          {sectorLabel(r.sector)}
                          {r.sectorDerived && <div style={{ fontSize: 10, color: "#9A9684" }}>suggested</div>}
                        </td>
                        <td style={td}>
                          <span style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: meta.bg, color: meta.color }}>
                            {r.stage === "submitted" ? "Awaiting" : meta.label}
                          </span>
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{shortDate(r.submittedAt)}</td>
                        <td style={num}>
                          {formatRand(r.price)}
                          {!r.inclVat && <div style={{ fontSize: 10, color: "#9A9684" }}>excl. VAT</div>}
                        </td>
                        <td style={td}>{r.person ?? "-"}</td>
                        <td style={td}>
                          {r.commission ?? "-"}
                          {r.pack.commission_note && <div style={{ fontSize: 11, color: "#6B6758" }}>{r.pack.commission_note}</div>}
                        </td>
                        <td style={{ ...td, minWidth: 220 }}>
                          <EconomicsForm tenderId={r.tenderId} economics={r.pack} people={people} defaultSector={r.defaultSector} returnTo="pricing" toggleLabel="Edit" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, fontWeight: 600, color: "#6B6758", minWidth: 0, maxWidth: "100%" }}>
      {label}
      {children}
    </label>
  );
}
