import { formatActivityTime } from "@/lib/tenderActivity";
import { causeLine, isOpenDowngrade, verdictLabel, type Downgrade } from "@/lib/discoveryReassessment";
import { acknowledgeDowngrade } from "./actions";
import { cn } from "@/lib/utils";

/**
 * "Re-assessed: was Strong fit, now Not a fit" (migration 0055). Open (nobody
 * has marked it seen): a flagged banner - danger-red when the company is
 * actively working on the tender, warning-amber otherwise - with why it
 * matched before and a "Mark as seen" button. Seen: a small muted marker that
 * stays, so a downgraded tender is never mistaken for one that never matched.
 *
 * Design-system audit fix (2026-10-21): converted from inline-CSSProperties
 * stale hex to Tailwind + design tokens, part of the same Discovery pass.
 */
export function DowngradeFlag({
  opportunityId,
  verdict,
  downgrade,
  pursuingStage,
  returnTo,
  acknowledgedByLabel,
}: {
  opportunityId: string;
  verdict: string;
  downgrade: Downgrade;
  /** tender_packs.pipeline_stage when the company is actively pursuing it (found/bidding/submitted). */
  pursuingStage: string | null;
  returnTo: string;
  acknowledgedByLabel: string | null;
}) {
  if (!downgrade.downgraded_from) return null;
  const was = verdictLabel(downgrade.downgraded_from);
  const now = verdictLabel(verdict);
  const when = downgrade.downgraded_at ? formatActivityTime(downgrade.downgraded_at) : "";

  if (!isOpenDowngrade(downgrade)) {
    return (
      <div className="mt-2 text-[11px] text-muted-foreground">
        <span className="font-bold text-warning">Re-assessed</span> {when}: was {was}, now {now}
        {downgrade.downgrade_acknowledged_at
          ? ` · marked as seen${acknowledgedByLabel ? ` by ${acknowledgedByLabel}` : ""} on ${formatActivityTime(downgrade.downgrade_acknowledged_at)}`
          : ""}
      </div>
    );
  }

  const danger = !!pursuingStage;
  return (
    <div className={cn("mb-2.5 rounded-lg border p-3", danger ? "border-destructive/30 bg-destructive/10" : "border-warning/30 bg-warning/10")}>
      <div className={cn("text-sm font-bold", danger ? "text-destructive" : "text-warning")}>
        &#9888; Re-assessed - {verdict === "not_a_fit" ? "no longer a good fit for your company" : "a weaker fit than when it was found"}
      </div>
      <div className="mt-0.5 text-xs text-foreground">
        Was <strong>{was}</strong>, now <strong>{now}</strong>
        {when ? ` as of ${when}` : ""}. {causeLine(downgrade.downgrade_cause)}
        {danger && ` You are working on this tender (${pursuingStage}) - check whether it is still worth pursuing before more work goes into it.`}
      </div>
      {(downgrade.reasons_before ?? []).length > 0 && (
        <details className="mt-1.5">
          <summary className="min-h-8 cursor-pointer content-center text-xs font-semibold text-foreground">Why it matched before</summary>
          <ul className="mt-1 list-disc pl-4.5 text-xs text-muted-foreground">
            {(downgrade.reasons_before ?? []).map((r, i) => (
              <li key={i} className="mb-0.5">{r}</li>
            ))}
          </ul>
        </details>
      )}
      <form action={acknowledgeDowngrade} className="mt-2">
        <input type="hidden" name="opportunity_id" value={opportunityId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <button type="submit" className="min-h-11 rounded-lg border border-border bg-card px-3.5 text-xs font-semibold text-foreground">
          Mark as seen
        </button>
      </form>
    </div>
  );
}
