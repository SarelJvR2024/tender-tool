import { createClient } from "@/lib/supabase/server";
import HarnessRunRow, { type HarnessDocument } from "./HarnessRunRow";
import SystemAlertRow, { type SystemAlert } from "./SystemAlertRow";
import { AppShell } from "../_components/AppShell";
import { AdminNav } from "./AdminNav";
import { StatCard } from "@/components/tt/stat-card";

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
//
// Color-token migration (2026-10-21): was raw inline-CSSProperties
// throughout (navy #16233B, muted #5B6472, border #E3E6EA, error banner
// #FEE2E2/#FCA5A5/#B91C1C, success #15803D, warning #B45309) - now
// Tailwind + tokens, same semantic mapping as every other admin page in
// this pass. The page's own local StatCard is gone in favor of the
// shared components/tt/stat-card.tsx (StatCard), which gained a `muted`
// tone for this page's two de-emphasized counts.
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
  // CV / document stats (migration 0068): Sarel's daily "how many open CVs
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

  if (error) console.error("admin_harness_runs select failed", error);
  if (alertsError) console.error("system_alerts select failed", alertsError);
  if (cvStatsError) console.error("platform_admin_cv_document_stats rpc failed", cvStatsError);

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
    <AppShell>
      <div className="mx-auto w-full max-w-[1000px] p-4 sm:p-6 md:px-8 md:py-6">
        <AdminNav active="alerts" />
        <section id="cv-document-stats" className="mb-9">
          <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">CVs &amp; tender documents</h1>
          <p className="mb-4 text-[13px] text-muted-foreground">
            Daily check: how many CVs we have on file, and - of the tender-specific CVs being worked for
            currently-open tenders - how many of those tenders we actually have the blank templates downloaded for.
            See migration 0068 for exactly what each number counts.
          </p>
          {cvStatsError && (
            <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
              {"Couldn't load CV/document stats - try refreshing. If it keeps happening, let us know."}
            </div>
          )}
          {cvStats && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
              <StatCard label="CVs uploaded (source files on file)" value={cvStats.cv_uploads_total} />
              <StatCard label="Generated CVs on file (ready)" value={cvStats.generated_cvs_ready} />
              <StatCard label="Generated CVs requested in total" value={cvStats.generated_cvs_total} tone="muted" />
              <StatCard label="Open tenders with a CV being worked" value={cvStats.open_tender_cvs_count} tone="muted" />
              <StatCard label="Tenders with documents downloaded" value={cvStats.open_tender_cvs_docs_downloaded} tone="success" />
              <StatCard label="Tenders missing documents" value={cvStats.open_tender_cvs_docs_missing} tone="warning" />
            </div>
          )}
        </section>

        <section id="system-alerts" className="mb-9">
          <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">System alerts</h1>
          <p className="mb-4 text-[13px] text-muted-foreground">
            Every failure the engines and the bridge worker hit (a job that crashed, a scoring error, OCR that
            couldn&apos;t run, a worker pass that broke) - one row per problem, counted each time it happens again.
            New alerts are e-mailed by the scheduled check-in (engine/alerts/check_system_alerts.py); mark one resolved
            once it is fixed.{" "}
            {open.length === 0 ? "Nothing open." : `${open.length} open${newCount > 0 ? `, ${newCount} not yet e-mailed` : ""}.`}
          </p>
          {alertsError && (
            <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
              {"Couldn't load system alerts - try refreshing. If it keeps happening, let us know."}
            </div>
          )}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {open.length === 0 && !alertsError && (
              <div className="p-4.5 text-[13px] text-success">No open system alerts.</div>
            )}
            {open.map((a) => <SystemAlertRow key={a.id} alert={a} />)}
          </div>
          {resolved.length > 0 && (
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-1.5 text-[13px] text-muted-foreground">
                Recently resolved ({resolved.length})
              </summary>
              <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card">
                {resolved.map((a) => <SystemAlertRow key={a.id} alert={a} />)}
              </div>
            </details>
          )}
        </section>

        <h2 className="mb-1 font-display text-[22px] font-bold text-foreground">Admin harness results</h2>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Results of running every test company through the real tender-filling pipeline (engine/admin_harness.py),
          checked against the stored baseline for each. Open a run to read the documents it generated, then mark it
          reviewed once they are right - that is the record that this tender template is trusted for real customers.{" "}
          {flaggedCount > 0 ? `${flaggedCount} flagged.` : "Nothing currently flagged."}{" "}
          {rows.length > 0 && (unreviewedCount > 0 ? `${unreviewedCount} not yet reviewed.` : "All reviewed.")}
        </p>

        {(error || actionError) && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            {error ? "Couldn't load harness results - try refreshing. If it keeps happening, let us know." : actionError}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {rows.length === 0 && !error && (
            <div className="p-4.5 text-[13px] text-muted-foreground">
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
    </AppShell>
  );
}
