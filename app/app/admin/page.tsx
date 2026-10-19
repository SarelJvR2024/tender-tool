import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import HarnessRunRow, { type HarnessDocument } from "./HarnessRunRow";
import SystemAlertRow, { type SystemAlert } from "./SystemAlertRow";
import { SiteNav } from "../_components/SiteNav";

// Reads per-request session/DB data (admin_harness_runs, gated by RLS on the
// signed-in user being a platform admin - migration 0043) - same escape hatch as
// app/app/dashboard/page.tsx.
export const instant = false;

const ARTIFACT_BUCKET = "admin-harness-artifacts";
// Long enough that a preview opened from a page left sitting for a while still
// loads - this is one person's internal QA page, not a shared link.
const SIGNED_URL_SECONDS = 3600;
const RESOLVED_SHOWN = 20;
const ALERT_COLUMNS =
  "id, source, severity, message, detail, context, occurrences, first_seen_at, last_seen_at, reported_at, resolved_at, resolution_note";

type CvDocumentStats = {
  cv_uploads_total: number;
  generated_cvs_total: number;
  generated_cvs_ready: number;
  open_tender_cvs_count: number;
  open_tender_cvs_docs_downloaded: number;
  open_tender_cvs_docs_missing: number;
};

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

  // System alerts (migration 0042): every open alert, plus the most recently
  // resolved ones for reference. Owner-only by RLS, same as the harness runs.
  // CV / document stats (migration 0066): Sarel's daily "how many open CVs
  // / did we get the tender documents" check, computed server-side rather
  // than left as a one-off query - see that migration's header for exactly
  // what each number counts.
  const [{ data: openAlerts, error: alertsError }, { data: resolvedAlerts }, { data: cvStatsRows, error: cvStatsError }] = await Promise.all([
    supabase.from("system_alerts").select(ALERT_COLUMNS).is("resolved_at", null)
      .order("last_seen_at", { ascending: false }),
    supabase.from("system_alerts").select(ALERT_COLUMNS).not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false }).limit(RESOLVED_SHOWN),
    supabase.rpc("platform_admin_cv_document_stats"),
  ]);
  const cvStats = cvStatsRows?.[0] as CvDocumentStats | undefined;
  const open = (openAlerts ?? []) as SystemAlert[];
  const resolved = (resolvedAlerts ?? []) as SystemAlert[];
  const newCount = open.filter((a) => !a.reported_at).length;

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
        <div style={{ display: "flex", gap: 14, fontSize: 13, marginBottom: 12 }}>
          <span style={{ color: "#16233B", fontWeight: 600 }}>Alerts &amp; harness results</span>
          <Link href="/admin/customers" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Customers</Link>
          <Link href="/admin/settings" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Settings</Link>
          <Link href="/admin/taxonomy" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Discipline list</Link>
        </div>
        <section id="cv-document-stats" style={{ marginBottom: 36 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>CVs &amp; tender documents</h1>
          <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 16px" }}>
            Daily check: how many CVs we have on file, and - of the tender-specific CVs being worked for
            currently-open tenders - how many of those tenders we actually have the blank templates downloaded for.
            See migration 0066 for exactly what each number counts.
          </p>
          {cvStatsError && (
            <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
              Could not load CV/document stats: {cvStatsError.message}
            </div>
          )}
          {cvStats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <StatCard label="CVs uploaded (source files on file)" value={cvStats.cv_uploads_total} color="#16233B" />
              <StatCard label="Generated CVs on file (ready)" value={cvStats.generated_cvs_ready} color="#16233B" />
              <StatCard label="Generated CVs requested in total" value={cvStats.generated_cvs_total} color="#6B6758" />
              <StatCard label="Open tenders with a CV being worked" value={cvStats.open_tender_cvs_count} color="#6B6758" />
              <StatCard label="Tenders with documents downloaded" value={cvStats.open_tender_cvs_docs_downloaded} color="#15803D" />
              <StatCard label="Tenders missing documents" value={cvStats.open_tender_cvs_docs_missing} color="#B45309" />
            </div>
          )}
        </section>

        <section id="system-alerts" style={{ marginBottom: 36 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>System alerts</h1>
          <p style={{ fontSize: 13, color: "#5B6472", margin: "0 0 16px" }}>
            Every failure the engines and the bridge worker hit (a job that crashed, a scoring error, OCR that
            couldn&apos;t run, a worker pass that broke) - one row per problem, counted each time it happens again.
            New alerts are e-mailed by the scheduled check-in (engine/alerts/check_system_alerts.py); mark one resolved
            once it is fixed.{" "}
            {open.length === 0 ? "Nothing open." : `${open.length} open${newCount > 0 ? `, ${newCount} not yet e-mailed` : ""}.`}
          </p>
          {alertsError && (
            <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
              Could not load system alerts: {alertsError.message}
            </div>
          )}
          <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 11, overflow: "hidden" }}>
            {open.length === 0 && !alertsError && (
              <div style={{ padding: "18px", fontSize: 13, color: "#15803D" }}>No open system alerts.</div>
            )}
            {open.map((a) => <SystemAlertRow key={a.id} alert={a} />)}
          </div>
          {resolved.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 13, color: "#5B6472", cursor: "pointer", padding: "6px 0" }}>
                Recently resolved ({resolved.length})
              </summary>
              <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 11, overflow: "hidden", marginTop: 8 }}>
                {resolved.map((a) => <SystemAlertRow key={a.id} alert={a} />)}
              </div>
            </details>
          )}
        </section>

        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Admin harness results</h2>
        <p style={{ fontSize: 13, color: "#5B6472", margin: "0 0 16px" }}>
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

        <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 11, overflow: "hidden" }}>
          {rows.length === 0 && !error && (
            <div style={{ padding: "24px 18px", fontSize: 13, color: "#5B6472" }}>
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

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 9, padding: "13px 16px" }}>
      <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
