import { createClient } from "@/lib/supabase/server";
import HarnessRunRow from "./HarnessRunRow";
import { SiteNav } from "../_components/SiteNav";

// Reads per-request session/DB data (admin_harness_runs, gated by RLS on the
// signed-in user being a company owner) - same escape hatch as
// app/app/dashboard/page.tsx.
export const instant = false;

type RunRow = {
  id: string;
  run_at: string;
  dummy_company: string;
  tender_ref: string;
  status: string;
  details: string | null;
};

// Spec item 31: a diagnostic safety net for Sarel, not a daily-use screen - just
// the admin_harness.py results (written by engine/write_admin_harness_results.py)
// as a plain list. No filters, no fancy UI, deliberately.
export default async function AdminPage() {
  const supabase = await createClient();

  const { data: runs, error } = await supabase
    .from("admin_harness_runs")
    .select("id, run_at, dummy_company, tender_ref, status, details")
    .order("run_at", { ascending: false });

  const rows = (runs ?? []) as RunRow[];
  const flaggedCount = rows.filter((r) => r.status === "flagged").length;

  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <SiteNav active="admin" />

      <div style={{ padding: "24px 32px", maxWidth: 1000, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Admin harness results</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 16px" }}>
          Results of running every dummy test company through the real tender-filling pipeline (engine/admin_harness.py),
          checked against the stored baseline for each. {flaggedCount > 0
            ? `${flaggedCount} flagged for review.`
            : "Nothing currently flagged."}
        </p>

        {error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            Could not load harness results: {error.message}
          </div>
        )}

        <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.8fr 1.3fr", gap: 12, padding: "9px 18px", fontSize: 11, fontWeight: 600, color: "#9A9684", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #F0EEE6" }}>
            <div>Dummy company</div><div>Tender</div><div>Status</div><div>Last run</div>
          </div>
          {rows.length === 0 && !error && (
            <div style={{ padding: "24px 18px", fontSize: 13, color: "#6B6758" }}>
              No harness runs recorded yet - run <code>python3 engine/write_admin_harness_results.py</code> to populate this.
            </div>
          )}
          {rows.map((r) => (
            <HarnessRunRow
              key={r.id}
              dummyCompany={r.dummy_company}
              tenderRef={r.tender_ref}
              status={r.status}
              runAt={r.run_at}
              details={r.details}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
