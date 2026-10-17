import { createClient } from "@/lib/supabase/server";
import HarnessRunRow, { type HarnessDocument } from "./HarnessRunRow";
import { SiteNav } from "../_components/SiteNav";

// Reads per-request session/DB data (admin_harness_runs, gated by RLS on the
// signed-in user being a platform admin - migration 0043) - same escape hatch as
// app/app/dashboard/page.tsx.
export const instant = false;

const ARTIFACT_BUCKET = "admin-harness-artifacts";
// Long enough that a preview opened from a page left sitting for a while still
// loads - this is one person's internal QA page, not a shared link.
const SIGNED_URL_SECONDS = 3600;

type RunRow = {
  id: string;
  run_at: string;
  test_company: string;
  tender_ref: string;
  kind: "forms" | "pack";
  status: string;
  summary: { counts?: Record<string, number> } | null;
  details: string | null;
  artifacts: { label: string; path: string; content_type: string }[] | null;
  reviewed_at: string | null;
  review_note: string | null;
};

// Spec item 31: the admin_harness.py results (written by
// engine/write_admin_harness_results.py), each expandable to the documents that
// run actually generated - rendered inline - plus a reviewed / not-reviewed
// record (migration 0022). Deliberately no filters or extra workflow states.
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const { data: runs, error } = await supabase
    .from("admin_harness_runs")
    .select("id, run_at, test_company, tender_ref, kind, status, summary, details, artifacts, reviewed_at, review_note")
    .order("run_at", { ascending: false })
    .order("kind", { ascending: true })
    .order("test_company", { ascending: true });

  const rows = (runs ?? []) as RunRow[];
  const flaggedCount = rows.filter((r) => r.status === "flagged").length;
  const unreviewedCount = rows.filter((r) => !r.reviewed_at).length;

  // One batch of signed URLs for every stored document (private bucket).
  const paths = rows.flatMap((r) => (r.artifacts ?? []).map((a) => a.path));
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(ARTIFACT_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }

  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <SiteNav active="admin" />

      <div style={{ padding: "24px 32px", maxWidth: 1000, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Admin harness results</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 16px" }}>
          Results of running every test company through the real tender-filling pipeline (engine/admin_harness.py),
          checked against the stored baseline for each. Open a run to read the documents it generated, then mark it
          reviewed once they are right - that is the record that this tender template is trusted for real customers.{" "}
          {flaggedCount > 0 ? `${flaggedCount} flagged.` : "Nothing currently flagged."}{" "}
          {rows.length > 0 && (unreviewedCount > 0 ? `${unreviewedCount} not yet reviewed.` : "All reviewed.")}
        </p>

        {(error || actionError) && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            {error ? `Could not load harness results: ${error.message}` : actionError}
          </div>
        )}

        <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.6fr 0.7fr 0.9fr 1.3fr", gap: 12, padding: "9px 18px", fontSize: 11, fontWeight: 600, color: "#9A9684", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #F0EEE6" }}>
            <div>Test company</div><div>Tender</div><div>Status</div><div>Review</div><div>Last run</div>
          </div>
          {rows.length === 0 && !error && (
            <div style={{ padding: "24px 18px", fontSize: 13, color: "#6B6758" }}>
              No harness runs recorded yet - run <code>python3 engine/write_admin_harness_results.py --pack</code> to populate this.
            </div>
          )}
          {rows.map((r) => {
            const documents: HarnessDocument[] = (r.artifacts ?? []).map((a) => ({
              label: a.label,
              url: signed.get(a.path) ?? null,
              isPdf: a.content_type === "application/pdf",
            }));
            return (
              <HarnessRunRow
                key={r.id}
                runId={r.id}
                testCompany={r.test_company}
                tenderRef={r.tender_ref}
                kind={r.kind}
                status={r.status}
                runAt={r.run_at}
                details={r.details}
                counts={r.summary?.counts ?? null}
                documents={documents}
                reviewedAt={r.reviewed_at}
                reviewNote={r.review_note}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
