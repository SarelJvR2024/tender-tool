import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../_components/SiteNav";
import { pursueOpportunity } from "./actions";

// Reads the signed-in user's company via RLS on every request (same reasoning
// as app/app/dashboard/page.tsx) - can't be prerendered.
export const instant = false;

type DocumentUrl = { url: string | null; title: string | null };

type OpportunityRow = {
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
};

type VerdictFilter = "all" | "strong_fit" | "needs_review" | "not_a_fit";

const FILTERS: { key: VerdictFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "strong_fit", label: "Strong fit" },
  { key: "needs_review", label: "Needs review" },
  { key: "not_a_fit", label: "Not a fit" },
];

// "needs_review" groups assess_tender.py's "possible" and "needs_review" verdicts -
// both mean "a human should look at this", just at different confidence levels
// (see assess_fit()'s docstring/logic in engine/discovery/assess_tender.py).
function matchesFilter(verdict: string, filter: VerdictFilter): boolean {
  if (filter === "all") return true;
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

  // Scoped to the signed-in user's company via RLS (is_company_member) -
  // this query shape works the same regardless of which company is asking.
  const { data: opportunities, error } = await supabase
    .from("discovered_opportunities")
    .select("id, contract_number, buyer, title, closing_date, categories, verdict, reasons, document_urls, first_seen, score_outlook, tender_id, source")
    .order("first_seen", { ascending: false });

  const rows = (opportunities ?? []) as unknown as OpportunityRow[];

  const counts: Record<VerdictFilter, number> = {
    all: rows.length,
    strong_fit: rows.filter((r) => r.verdict === "strong_fit").length,
    needs_review: rows.filter((r) => r.verdict === "possible" || r.verdict === "needs_review").length,
    not_a_fit: rows.filter((r) => r.verdict === "not_a_fit").length,
  };

  const visibleRows = rows.filter((r) => matchesFilter(r.verdict, activeFilter));

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
      <SiteNav active="discovery" />

      <div style={{ flex: 1, padding: "24px 16px", maxWidth: 1240, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", margin: "0 0 16px" }}>
          <div style={{ flex: "1 1 320px" }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Discovery</h1>
            <p style={{ fontSize: 13, color: "#6B6758", margin: 0 }}>
              Newly-found tender opportunities from the national OCDS feed, scored against your company profile.
              Click through to download the real document from the buyer&apos;s own site.
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
            return (
              <div
                key={o.id}
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E5E1D5",
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "#16233B" }}>
                      {o.contract_number || "(no reference number)"}
                    </span>
                    {o.source === "manual" && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 100, background: "#F0EEE6", color: "#16233B" }}>Loaded manually</span>
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
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#16233B", marginBottom: 2 }}>
                    {o.title || "(untitled)"}
                  </div>
                  <div style={{ fontSize: 12, color: "#4B5563", marginBottom: 6 }}>{o.buyer || "(unknown buyer)"}</div>

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
                          {c.replace(/_/g, " ")}
                        </span>
                      ))}
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
                    {o.closing_date ? new Date(o.closing_date).toLocaleDateString() : "-"}
                  </div>
                  {/* Into the Tender Workspace: what this tender needs, the questions
                      only you can answer, and a generated pack (migration 0018). */}
                  {o.verdict !== "closed" && (
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
