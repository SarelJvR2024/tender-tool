import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, SubPage } from "../_components/ui";
import { UploadForm } from "./upload-form";
import { DocumentReviewCard, type OnboardingResult } from "./review";
import { AutoRefresh } from "../../_components/AutoRefresh";
import { retryOnboardingUpload } from "./actions";

// Bulk onboarding document scan (0063): drop in a folder/zip of whatever
// compliance documents the company already has instead of uploading and
// tagging each one by hand. Request-time data under RLS, same reason as
// every other /company sub-page.
export const instant = false;

const SAVED: Record<string, string> = {
  uploaded: "Uploaded - each document is being read and classified; this page updates itself as results come in.",
  filed: "Document filed.",
  "handed-off": "Handed off to the CV pipeline - find it on that person's People page.",
  skipped: "Marked as needing manual review.",
  discarded: "Discarded.",
  retrying: "Queued again - this page updates itself as the result comes in.",
};

export default async function DocumentScanPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  const companyId = membership.company_id as string;

  const [{ data: pending, error: pendingError }, { data: principals }, { data: people }, { count: queuedCount }, { data: company }, { data: failed, error: failedError }] = await Promise.all([
    supabase
      .from("onboarding_document_results")
      .select("id, document_kind, document_kind_reason, fields, warnings, text_method, model, created_at, onboarding_uploads(original_filename)")
      .eq("company_id", companyId)
      .eq("review_status", "pending_review")
      .order("created_at", { ascending: false }),
    supabase.from("company_principals").select("id, full_name").eq("company_id", companyId).order("full_name"),
    supabase.from("people").select("id, name").eq("company_id", companyId).order("name"),
    supabase
      .from("onboarding_uploads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ["classification_requested", "classifying"]),
    supabase.from("companies").select("legal_name").eq("id", companyId).maybeSingle(),
    // UX audit re-review 2026-10-23, item 2: a failed classification used to
    // leave no trace anywhere on this page - not "still being read" (that
    // only counts classification_requested/classifying), not "To review"
    // (that only counts rows classify_documents.py actually succeeded on).
    // This is the only place that failure is visible at all.
    supabase
      .from("onboarding_uploads")
      .select("id, original_filename, created_at")
      .eq("company_id", companyId)
      .eq("status", "classification_failed")
      .order("created_at", { ascending: false }),
  ]);

  // "handed-off" means confirmCvHandoff just inserted a cv_uploads row for
  // this company (actions.ts) and redirected back here - its person_id is
  // the person the banner below should link to. Read it back from the most
  // recent row rather than a query param, so this page is the only file
  // that needs to change for the banner to carry a real link.
  let handoffPerson: { id: string; name: string } | null = null;
  if (saved === "handed-off") {
    const { data: latestCvUpload } = await supabase
      .from("cv_uploads")
      .select("person_id, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const personId = latestCvUpload?.person_id as string | undefined;
    const person = personId ? (people ?? []).find((p) => p.id === personId) ?? null : null;
    if (person) handoffPerson = { id: person.id, name: person.name };
  }

  if (pendingError) console.error("onboarding_document_results select failed", pendingError);

  return (
    <SubPage
      title="Bulk document scan"
      intro={
        <>
          Drop in every compliance document your company already has - CIDB, B-BBEE, tax clearance, ID documents, CVs, bank letter, PI
          insurance, ISO 9001, project reference letters - at once, instead of uploading and tagging each one by hand. Each file is
          read by AI to work out what it is and pull out its key fields, with the exact text it read them from. <strong>Nothing is
          saved to your company profile until you confirm or correct each one below.</strong>
        </>
      }
      error={error}
      saved={saved === "handed-off" && handoffPerson ? null : saved ? SAVED[saved] ?? saved : null}
    >
      <AutoRefresh active={(queuedCount ?? 0) > 0} />

      {saved === "handed-off" && handoffPerson && (
        <div className="mb-4 rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
          Handed off to the CV pipeline - find it on{" "}
          <Link href={`/people/${handoffPerson.id}`} className="font-bold text-success underline">
            {handoffPerson.name}&apos;s People page
          </Link>
          .
        </div>
      )}

      <Card title="Upload">
        <UploadForm companyId={companyId} />
      </Card>

      {!!queuedCount && (
        <div className="mb-3.5 rounded-lg border border-info/30 bg-info/10 px-3.5 py-2.5 text-sm text-info">
          {queuedCount} document{queuedCount === 1 ? "" : "s"} still being read - this runs in the background (a worker, not this page) and will appear below automatically.
        </div>
      )}

      {pendingError && (
        <div className="mb-3.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
          Couldn&apos;t load documents waiting for review - try refreshing. If it keeps happening, let us know.
        </div>
      )}

      {failedError && (
        <div className="mb-3.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
          Couldn&apos;t load documents that failed - try refreshing. If it keeps happening, let us know.
        </div>
      )}

      {!failedError && (failed ?? []).length > 0 && (
        <Card title={`Couldn't be read (${failed!.length})`}>
          {failed!.map((u) => (
            <div key={u.id} className="mb-2 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5 last:mb-0">
              <div>
                <div className="text-sm font-semibold text-foreground">{u.original_filename}</div>
                <div className="mt-0.5 text-xs text-destructive">
                  We couldn&apos;t read this file automatically. The original file is safe - retry, or upload a
                  clearer copy.
                </div>
              </div>
              <form action={retryOnboardingUpload}>
                <input type="hidden" name="upload_id" value={u.id} />
                <button type="submit" className="text-xs font-semibold text-accent">
                  Retry
                </button>
              </form>
            </div>
          ))}
        </Card>
      )}

      <Card title={`To review (${pending?.length ?? 0})`}>
        {!pendingError && (pending ?? []).length === 0 ? (
          <div className="text-sm text-muted-foreground">Nothing waiting for review right now.</div>
        ) : (
          (pending ?? []).map((row) => {
            const upload = row.onboarding_uploads as unknown as { original_filename: string } | null;
            return (
              <DocumentReviewCard
                key={row.id}
                result={row as unknown as OnboardingResult}
                filename={upload?.original_filename ?? "document"}
                principals={principals ?? []}
                people={people ?? []}
                companyLegalName={company?.legal_name ?? null}
              />
            );
          })
        )}
      </Card>
    </SubPage>
  );
}
