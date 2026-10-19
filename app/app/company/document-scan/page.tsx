import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, SubPage } from "../_components/ui";
import { UploadForm } from "./upload-form";
import { DocumentReviewCard, type OnboardingResult } from "./review";
import { QueuePoller } from "./QueuePoller";

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
};

export default async function DocumentScanPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  const companyId = membership.company_id as string;

  const [{ data: pending }, { data: principals }, { data: people }, { count: queuedCount }] = await Promise.all([
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

  return (
    <>
      {/* Same mobile collapse as people/[id]/page.tsx's .cvx-row - this
          card's field grid (checkbox / 150px label / value) is the same
          fixed-label-column shape, squeezed the same way on a phone. */}
      <style>{`
        @media (max-width: 600px) {
          .obx-row { grid-template-columns: 28px 1fr !important; }
          .obx-row > div:nth-child(2),
          .obx-row > div:nth-child(3) { grid-column: 2; }
        }
      `}</style>
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
      <QueuePoller queuedCount={queuedCount ?? 0} />

      {saved === "handed-off" && handoffPerson && (
        <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#15803D" }}>
          Handed off to the CV pipeline - find it on{" "}
          <Link href={`/people/${handoffPerson.id}`} style={{ color: "#15803D", fontWeight: 700, textDecoration: "underline" }}>
            {handoffPerson.name}&apos;s People page
          </Link>
          .
        </div>
      )}

      <Card title="Upload">
        <UploadForm companyId={companyId} />
      </Card>

      {!!queuedCount && (
        <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 9, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#1E3A8A" }}>
          {queuedCount} document{queuedCount === 1 ? "" : "s"} still being read - this runs in the background (a worker, not this page) and will appear below automatically.
        </div>
      )}

      <Card title={`To review (${pending?.length ?? 0})`}>
        {(pending ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: "#6B6758" }}>Nothing waiting for review right now.</div>
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
              />
            );
          })
        )}
      </Card>
    </SubPage>
    </>
  );
}
