import { formatActivityTime } from "@/lib/tenderActivity";
import { causeLine, isOpenDowngrade, verdictLabel, type Downgrade } from "@/lib/discoveryReassessment";
import { acknowledgeDowngrade } from "./actions";

/**
 * "Re-assessed: was Strong fit, now Not a fit" (migration 0055). Open (nobody
 * has marked it seen): a flagged banner - danger-red when the company is
 * actively working on the tender, warning-amber otherwise - with why it
 * matched before and a "Mark as seen" button. Seen: a small muted marker that
 * stays, so a downgraded tender is never mistaken for one that never matched.
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
      <div style={{ marginTop: 8, fontSize: 11, color: "#5B6472" }}>
        <span style={{ fontWeight: 700, color: "#B45309" }}>Re-assessed</span> {when}: was {was}, now {now}
        {downgrade.downgrade_acknowledged_at
          ? ` · marked as seen${acknowledgedByLabel ? ` by ${acknowledgedByLabel}` : ""} on ${formatActivityTime(downgrade.downgrade_acknowledged_at)}`
          : ""}
      </div>
    );
  }

  const danger = !!pursuingStage;
  const fg = danger ? "#B91C1C" : "#B45309";
  const bg = danger ? "#FEE2E2" : "#FEF3C7";
  const border = danger ? "#FCA5A5" : "#FCD34D";
  return (
    <div style={{ margin: "0 0 10px", padding: "10px 12px", borderRadius: 8, background: bg, border: `1px solid ${border}` }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: fg }}>
        &#9888; Re-assessed - {verdict === "not_a_fit" ? "no longer a good fit for your company" : "a weaker fit than when it was found"}
      </div>
      <div style={{ fontSize: 12, color: "#16233B", marginTop: 3 }}>
        Was <strong>{was}</strong>, now <strong>{now}</strong>
        {when ? ` as of ${when}` : ""}. {causeLine(downgrade.downgrade_cause)}
        {danger && ` You are working on this tender (${pursuingStage}) - check whether it is still worth pursuing before more work goes into it.`}
      </div>
      {(downgrade.reasons_before ?? []).length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 12, fontWeight: 600, color: "#16233B", cursor: "pointer" }}>Why it matched before</summary>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, color: "#5B6472" }}>
            {(downgrade.reasons_before ?? []).map((r, i) => (
              <li key={i} style={{ marginBottom: 2 }}>{r}</li>
            ))}
          </ul>
        </details>
      )}
      <form action={acknowledgeDowngrade} style={{ marginTop: 8 }}>
        <input type="hidden" name="opportunity_id" value={opportunityId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <button
          type="submit"
          style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, background: "#FFFFFF", color: "#16233B", border: "1px solid #16233B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          Mark as seen
        </button>
      </form>
    </div>
  );
}
