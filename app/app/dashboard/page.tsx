import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/dates";
import { SiteNav } from "../_components/SiteNav";

// This page depends on the signed-in user's session (via RLS) on every
// request, so it can't be prerendered - "instant = false" is Next.js 16's
// Cache Components escape hatch for a route that must block on real,
// per-request data.
export const instant = false;

type TenderRow = {
  id: string;
  contract_no: string | null;
  nra_reference: string | null;
  description: string | null;
  closing_date: string | null;
  source: string | null;
  family: string | null;
  tender_packs: { status: string }[];
};

function statusFor(tender: TenderRow): { label: string; bg: string; color: string } {
  const pack = tender.tender_packs?.[0];
  if (!pack) return { label: "Needs documents", bg: "#FEF3C7", color: "#B45309" };
  if (pack.status === "confirmed" || pack.status === "filled") {
    return { label: "Complete", bg: "#DCFCE7", color: "#15803D" };
  }
  return { label: "Needs your input", bg: "#FEF3C7", color: "#B45309" };
}

export default async function DashboardPage() {
  const supabase = await createClient();

  // tender_packs only comes back for the signed-in user's own company, via RLS -
  // this query shape works the same regardless of which company is asking.
  const { data: tenders, error } = await supabase
    .from("tenders")
    .select("id, contract_no, nra_reference, description, closing_date, source, family, tender_packs(status)")
    .order("closing_date", { ascending: true });

  const rows = (tenders ?? []) as unknown as TenderRow[];
  const completeCount = rows.filter((t) => statusFor(t).label === "Complete").length;
  const needsInputCount = rows.length - completeCount;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
      <SiteNav active="dashboard" />

      <div style={{ flex: 1, padding: "24px 32px", maxWidth: 1240, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "0 0 16px" }}>
          {/* Not only SANRAL any more: Discovery's "Prepare this tender" (0018)
              and manual loads (0024) land here too. */}
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: 0 }}>Tenders</h1>
          <Link
            href="/tenders/new"
            style={{ display: "inline-flex", alignItems: "center", minHeight: 40, padding: "0 16px", borderRadius: 8, background: "#D97706", color: "#FFFFFF", fontSize: 13, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
          >
            Load a tender manually
          </Link>
        </div>

        {error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            Could not load tenders: {error.message}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard label="Tenders tracked" value={rows.length} color="#16233B" />
          <StatCard label="Packs complete" value={completeCount} color="#15803D" />
          <StatCard label="Needs your input" value={needsInputCount} color="#B45309" />
        </div>

        <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 2.4fr 1fr 1.3fr", gap: 12, padding: "9px 18px", fontSize: 11, fontWeight: 600, color: "#9A9684", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #F0EEE6" }}>
            <div>Contract</div><div>Description</div><div>Closes</div><div>Status</div>
          </div>
          {rows.length === 0 && !error && (
            <div style={{ padding: "24px 18px", fontSize: 13, color: "#6B6758" }}>
              No tenders yet - run <code>supabase/seed_tenders.sql</code> to load the known SANRAL tenders.
            </div>
          )}
          {rows.map((t) => {
            const st = statusFor(t);
            const left = daysUntil(t.closing_date);
            return (
              <div key={t.id} style={{ display: "grid", gridTemplateColumns: "1.3fr 2.4fr 1fr 1.3fr", gap: 12, alignItems: "center", padding: "11px 18px", borderTop: "1px solid #F0EEE6" }}>
                <div>
                  <a href={`/tenders/${t.id}`} style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "#16233B", textDecoration: "none" }}>{t.contract_no ?? "(no reference)"}</a>
                  <div style={{ fontSize: 11, color: "#9A9684" }}>{t.nra_reference}</div>
                </div>
                <div style={{ fontSize: 12, color: "#4B5563" }}>
                  <a href={`/tenders/${t.id}`} style={{ color: "#4B5563", textDecoration: "none" }}>{t.description}</a>
                  {t.source === "manual" && (
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 100, background: "#F0EEE6", color: "#16233B" }}>
                      {t.family ? "Loaded manually" : "Loaded manually - analysing"}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#16233B" }}>
                  {t.closing_date ? new Date(t.closing_date).toLocaleDateString() : "-"}
                  {left !== null && <div style={{ fontSize: 10, color: left <= 7 ? "#B45309" : "#9A9684" }}>{left} days left</div>}
                </div>
                <div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>
                    {st.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 9, padding: "13px 16px" }}>
      <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
