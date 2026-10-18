import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../_components/SiteNav";
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

const XREF_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  agrees: { label: "agrees", bg: "#DCFCE7", color: "#15803D" },
  differs: { label: "differs - check", bg: "#FEF3C7", color: "#B45309" },
  generic: { label: "catch-all bucket", bg: "#F0EEE6", color: "#6B6758" },
  unmapped: { label: "not cross-referenced yet", bg: "#F0EEE6", color: "#6B6758" },
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

function verdictChip(verdict: string): { label: string; bg: string; color: string } {
  switch (verdict) {
    case "strong_fit":
      return { label: "Strong fit", bg: "#DCFCE7", color: "#15803D" };
    case "possible":
      return { label: "Possible", bg: "#FEF3C7", color: "#B45309" };
    case "needs_review":
      return { label: "Needs review", bg: "#FEF3C7", color: "#B45309" };
    case "not_a_fit":
      return { label: "Not a fit", bg: "#FEE2E2", color: "#B91C1C" };
    case "closed":
      return { label: "Closed", bg: "#F1F5F9", color: "#475569" };
    default:
      return { label: verdict, bg: "#F1F5F9", color: "#475569" };
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
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
      <SiteNav active="discovery" />

      <div style={{ flex: 1, padding: "24px 16px", maxWidth: 1240, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", margin: "0 0 16px" }}>
          <div style={{ flex: "1 1 320px" }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Discovery</h1>
            <p style={{ fontSize: 13, color: "#6B6758", margin: 0 }}>
              Government tenders - national, provincial, municipal and state-owned buyers - scored against your company
              profile. Read daily from National Treasury&apos;s eTenders portal (every buyer that publishes there) plus
              SANRAL, Eskom, Transnet and the City of Cape Town&apos;s own sites, with cancellations, moved closing dates
              and addenda tracked. Not covered: private-sector work, and municipal notices that never reach eTenders
              or one of those sites.
            </p>
          </div>
          {/* A tender that isn't in this feed (SANRAL's own portal, a forwarded
              RFQ, a buyer not on eTenders) - migration 0024. */}
          <Link
            href="/tenders/new"
            style={{ display: "inline-flex", alignItems: "center", minHeight: 40, padding: "0 16px", borderRadius: 8, background: "#FFFFFF", border: "1px solid #16233B", color: "#16233B", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
          >
            Found one elsewhere? Load it manually
          </Link>
        </div>

        {error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            Could not load discovered opportunities: {error.message}
          </div>
        )}
        {actionError && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            {actionError}
          </div>
        )}

        {openDowngrades.length > 0 && (
          <div
            style={{
              background: openPursued.length ? "#FEE2E2" : "#FEF3C7",
              border: `1px solid ${openPursued.length ? "#FCA5A5" : "#FCD34D"}`,
              borderRadius: 9,
              padding: "11px 16px",
              marginBottom: 16,
              fontSize: 13,
              color: openPursued.length ? "#B91C1C" : "#B45309",
            }}
          >
            <strong>
              &#9888; {openDowngrades.length} tender{openDowngrades.length === 1 ? " is" : "s are"} no longer as good a fit as when
              {openDowngrades.length === 1 ? " it was" : " they were"} found
            </strong>
            {openPursued.length > 0 && <> - including {openPursued.length} you are working on</>}.{" "}
            {openDowngrades.length === 1 ? "It was" : "They were"} scored again (usually because your company profile changed) and came out
            worse. {openDowngrades.length === 1 ? "It is" : "Each is"} flagged below until someone in your company marks it as seen.{" "}
            <a href="/discovery?verdict=reassessed" style={{ color: "#16233B", fontWeight: 600 }}>Show re-assessed tenders</a>
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 20,
            overflowX: "auto",
            paddingBottom: 4,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {FILTERS.map((f) => {
            const isActive = f.key === activeFilter;
            return (
              <a
                key={f.key}
                href={f.key === "all" ? "/discovery" : `/discovery?verdict=${f.key}`}
                style={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 14px",
                  borderRadius: 100,
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "none",
                  border: isActive ? "1px solid #16233B" : "1px solid #E5E1D5",
                  background: isActive ? "#16233B" : "#FFFFFF",
                  color: isActive ? "#FFFFFF" : "#16233B",
                }}
              >
                {f.label}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 18,
                    height: 18,
                    padding: "0 5px",
                    borderRadius: 100,
                    fontSize: 10,
                    fontWeight: 700,
                    background: isActive ? "rgba(255,255,255,0.2)" : "#F1F5F9",
                    color: isActive ? "#FFFFFF" : "#475569",
                  }}
                >
                  {counts[f.key]}
                </span>
              </a>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visibleRows.length === 0 && !error && (
            <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "24px 18px", fontSize: 13, color: "#6B6758" }}>
              No discovered opportunities{activeFilter !== "all" ? " in this filter" : ""} yet - run{" "}
              <code>engine/discovery/watch_new_tenders.py</code> and{" "}
              <code>engine/discovery/seed_supabase_opportunities.py</code> to load new ones.
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
                style={{
                  background: "#FFFFFF",
                  border: open ? `2px solid ${pursuingStage ? "#B91C1C" : "#B45309"}` : "1px solid #E5E1D5",
                  borderRadius: 11,
                  padding: "14px 18px",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div style={{ flex: "1 1 320px", minWidth: 0 }}>
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "#16233B" }}>
                      {o.contract_number || "(no reference number)"}
                    </span>
                    {o.source === "manual" && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 100, background: "#F0EEE6", color: "#16233B" }}>Loaded manually</span>
                    )}
                    {o.source !== "manual" &&
                      listingSourceLabels(o.listing_sources, o.source).map((label) => (
                        <span key={label} title="Where this tender is listed" style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 100, background: "#F0EEE6", color: "#16233B" }}>
                          {label}
                        </span>
                      ))}
                    {changes.some((c) => c.change_type === "cancelled") && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 100, background: "#FEE2E2", color: "#B91C1C" }}>Cancelled</span>
                    )}
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "3px 10px",
                        borderRadius: 100,
                        fontSize: 11,
                        fontWeight: 600,
                        background: chip.bg,
                        color: chip.color,
                      }}
                    >
                      {chip.label}
                    </span>
                    {isDowngraded(o) && (
                      <span
                        title="The verdict this tender had before it was re-assessed"
                        style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 100, background: "#F6F5F1", border: "1px solid #E5E1D5", color: "#6B6758", textDecoration: "line-through" }}
                      >
                        was {verdictLabel(o.downgraded_from)}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#16233B", marginBottom: 2 }}>
                    {o.title || "(untitled)"}
                  </div>
                  <div style={{ fontSize: 12, color: "#4B5563", marginBottom: 6 }}>
                    {o.buyer || "(unknown buyer)"}
                    {facts && <span style={{ color: "#9A9684" }}> · {facts}</span>}
                  </div>
                  {o.briefing?.date && (
                    <div style={{ fontSize: 12, color: o.briefing.compulsory ? "#B45309" : "#4B5563", fontWeight: o.briefing.compulsory ? 600 : 400, marginBottom: 6 }}>
                      {o.briefing.compulsory ? "Compulsory briefing" : "Briefing"}: {new Date(o.briefing.date).toLocaleString("en-ZA", SAST_DATETIME)}
                      {o.briefing.venue && <span style={{ fontWeight: 400, color: "#6B6758" }}> · {o.briefing.venue.slice(0, 120)}</span>}
                    </div>
                  )}

                  {/* What changed on the listing since it was found (0051). Most
                      urgent first; the full list folds away past three. */}
                  {changes.length > 0 && (
                    <div style={{ margin: "4px 0 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                      {changes.slice(0, 3).map((c) => {
                        const tone = changeTone(c.change_type);
                        return (
                          <div key={c.id} style={{ fontSize: 12, padding: "6px 10px", borderRadius: 8, background: tone.bg, border: `1px solid ${tone.border}`, color: tone.color, overflowWrap: "anywhere" }}>
                            <strong>{CHANGE_LABELS[c.change_type] ?? c.change_type}</strong>: {c.summary}
                            {c.evidence_url && (
                              <>
                                {" "}
                                <a href={c.evidence_url} target="_blank" rel="noopener noreferrer" style={{ color: tone.color, fontWeight: 600 }}>
                                  source ↗
                                </a>
                              </>
                            )}
                          </div>
                        );
                      })}
                      {changes.length > 3 && (
                        <details style={{ fontSize: 12, color: "#4B5563" }}>
                          <summary style={{ cursor: "pointer" }}>{changes.length - 3} more change{changes.length - 3 === 1 ? "" : "s"}</summary>
                          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                            {changes.slice(3).map((c) => (
                              <li key={c.id} style={{ marginBottom: 2, overflowWrap: "anywhere" }}>
                                <strong>{CHANGE_LABELS[c.change_type] ?? c.change_type}</strong>: {c.summary}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}

                  {(o.categories ?? []).length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                      {(o.categories ?? []).map((c) => (
                        <span
                          key={c}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: 100,
                            background: "#F1F5F9",
                            color: "#475569",
                          }}
                        >
                          {c.startsWith("uncategorized") ? c.replace(/_/g, " ") : taxonomyLabel(taxonomy, c)}
                        </span>
                      ))}
                    </div>
                  )}

                  {o.etenders_category && (
                    // The buyer's own pick on eTenders, as a cross-reference
                    // only - Tender Tool's categories (above) drive the fit.
                    <div title={o.etenders_category_check?.note ?? undefined} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 11, color: "#6B6758", marginBottom: 6 }}>
                      <span>Buyer&apos;s eTenders category: <span style={{ color: "#16233B", fontWeight: 600 }}>{o.etenders_category}</span></span>
                      {o.etenders_category_check && XREF_STYLE[o.etenders_category_check.status] && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 100, background: XREF_STYLE[o.etenders_category_check.status].bg, color: XREF_STYLE[o.etenders_category_check.status].color }}>
                          {XREF_STYLE[o.etenders_category_check.status].label}
                        </span>
                      )}
                      {o.etenders_category_check?.status === "differs" && o.etenders_category_check.matching_categories.length > 0 && (
                        <span>
                          (on Tender Tool&apos;s list that is {o.etenders_category_check.matching_categories.slice(0, 3).map((c) => taxonomyLabel(taxonomy, c)).join(", ")})
                        </span>
                      )}
                    </div>
                  )}

                  {(o.reasons ?? []).length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#6B6758" }}>
                      {(o.reasons ?? []).map((r, i) => (
                        <li key={i} style={{ marginBottom: 2 }}>
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
                    <div style={{ marginTop: 8, padding: "8px 12px", background: "#F6F5F1", border: "1px solid #E5E1D5", borderRadius: 9 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#16233B", marginBottom: 3 }}>How it&apos;s scored</div>
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#4B5563" }}>
                        {(o.score_outlook?.summary ?? []).map((line, i) => (
                          <li key={i} style={{ marginBottom: 2 }}>
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div style={{ flex: "0 0 180px", textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#9A9684", marginBottom: 2 }}>Closes</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#16233B", marginBottom: 10 }}>
                    {o.closing_date ? new Date(o.closing_date).toLocaleString("en-ZA", SAST_DATETIME) : "-"}
                  </div>
                  {/* Into the Tender Workspace: what this tender needs, the questions
                      only you can answer, and a generated pack (migration 0018). */}
                  {o.verdict !== "closed" && !changes.some((c) => c.change_type === "cancelled") && (
                    <form action={pursueOpportunity} style={{ marginBottom: 10 }}>
                      <input type="hidden" name="opportunity_id" value={o.id} />
                      <button
                        type="submit"
                        style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        {o.tender_id ? "Open in workspace" : "Prepare this tender"}
                      </button>
                    </form>
                  )}
                  {docs.length === 0 && (
                    <div style={{ fontSize: 11, color: "#9A9684" }}>{o.source === "manual" ? "Documents uploaded by you" : "No document URL on file"}</div>
                  )}
                  {docs.map((d, i) => (
                    <a
                      key={i}
                      href={d.url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "block",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#D97706",
                        textDecoration: "none",
                        marginBottom: 4,
                      }}
                    >
                      {d.title || "View document"} ↗
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
