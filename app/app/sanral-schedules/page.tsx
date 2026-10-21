import Link from "next/link";
import { Zap, FolderOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/dates";
import { SANRAL_CONVENTIONAL_FAMILY } from "@/lib/tenderCompliance";
import { AppShell } from "../_components/AppShell";
import { PageHeader } from "@/components/tt/page-header";
import { EmptyState } from "@/components/tt/empty-state";
import { DeadlineChip } from "@/components/tt/deadline-chip";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * "SANRAL schedules" (prompt 10, item 2: "make the SANRAL automation a
 * clearly visible, premium feature"). The automation itself is unchanged -
 * SubmissionPack (app/app/tenders/[id]/submission-pack.tsx) still does the
 * actual work, one tender at a time. This page is the front door the
 * sidebar nav item points to: the same "usually 6 to 8 hours by hand"
 * promise up top, then a jump straight to the real action on whichever
 * SANRAL tender the company is working on - never a second copy of
 * requestSubmissionPack()'s own logic.
 *
 * Presentation and flow only, per the prompt's own instruction - the
 * query below only reads tenders/tender_packs/pack_generation_jobs that
 * already exist; nothing new is stored.
 */
export const instant = false;

type TenderRow = {
  id: string;
  contract_no: string | null;
  title: string | null;
  buyer: string | null;
  closing_date: string | null;
  tender_packs: { id: string }[];
};

type LatestJob = { tender_id: string; status: "requested" | "generating" | "ready" | "failed"; requested_at: string };

const JOB_STATUS_LABEL: Record<LatestJob["status"], string> = {
  requested: "Queued",
  generating: "Filling now…",
  ready: "Ready to download",
  failed: "Last run failed",
};

export default async function SanralSchedulesPage() {
  const supabase = await createClient();

  const { data: tenderRows } = await supabase
    .from("tenders")
    .select("id, contract_no, title, buyer, closing_date, tender_packs!inner(id)")
    .eq("family", SANRAL_CONVENTIONAL_FAMILY)
    .order("closing_date", { ascending: true });

  const tenders = (tenderRows ?? []) as unknown as TenderRow[];
  const tenderIds = tenders.map((t) => t.id);

  const latestByTender = new Map<string, LatestJob>();
  if (tenderIds.length > 0) {
    const { data: jobRows } = await supabase
      .from("pack_generation_jobs")
      .select("tender_id, status, requested_at")
      .in("tender_id", tenderIds)
      .order("requested_at", { ascending: false });
    for (const j of (jobRows ?? []) as LatestJob[]) {
      if (!latestByTender.has(j.tender_id)) latestByTender.set(j.tender_id, j);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 sm:p-6">
        <PageHeader
          title="SANRAL schedules"
          description="The Technical and Financial workbooks, Form B reports and returnable forms, filled from your own vault and key-person data."
        />

        <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-gradient-to-r from-warning/10 to-transparent p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
            <Zap className="size-5" aria-hidden />
          </div>
          <div className="text-sm font-medium text-foreground">
            Usually 6 to 8 hours by hand. We fill them in minutes.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {["Reading the file", "Filling schedules", "Checking totals"].map((step, i) => (
            <div key={step} className="rounded-xl border border-border bg-card p-4 text-sm">
              <div className="mb-1 font-display text-xs font-semibold text-muted-foreground">Step {i + 1}</div>
              <div className="font-medium text-foreground">{step}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {tenders.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No SANRAL tenders yet"
              description={
                <>
                  Fill this in once you&apos;re bidding on a SANRAL conventional-consultant tender - find one from{" "}
                  <Link href="/discovery" className="font-medium text-foreground underline">
                    Opportunities
                  </Link>
                  .
                </>
              }
            />
          ) : (
            tenders.map((t) => {
              const daysLeft = daysUntil(t.closing_date);
              const job = latestByTender.get(t.id);
              return (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {t.contract_no || t.title || "Tender"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{t.buyer ?? "No client on file"}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {daysLeft !== null && <DeadlineChip daysLeft={daysLeft} />}
                    {job && <Badge variant="outline">{JOB_STATUS_LABEL[job.status] ?? job.status}</Badge>}
                    <Link href={`/tenders/${t.id}#submission-pack`} className={buttonVariants({ size: "sm" })}>
                      Fill SANRAL schedules
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </AppShell>
  );
}
