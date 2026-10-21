import { loadSubmissionPlan } from "./submission-plan-data";
import type { PlanStep } from "./submission-plan-logic";
import type { BidTaskStatus } from "./bid-task-status";
import { DeadlineChip } from "@/components/tt/deadline-chip";

/**
 * The full submission plan - every step the assessment engine found for this
 * tender (forms, buyer forms, returnables, key-personnel roles, questions,
 * CIDB grading, the compulsory briefing, and any unresolved gap), plus the
 * due-date timeline warning. This is deliberately the FULL list: the
 * Disqualification guard (disqualification-guard.tsx, same data source, same
 * day, different Claude session) already surfaces a curated 7-check subset
 * of the highest-severity items - this card is the complete "what do we
 * actually have to go and do" view Sarel originally asked the assessment
 * engine to answer, not a replacement for the guard.
 *
 * Same visual language as disqualification-guard.tsx (inline CSSProperties,
 * soft-tint status chips, identical hex values) since this page isn't
 * migrated to the Tailwind design system yet (app/AGENTS.md) - DeadlineChip
 * is the one exception, reused directly for the timeline banner rather than
 * reinventing its urgency styling in CSSProperties.
 */

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

const STATUS_STYLE: Record<BidTaskStatus, { label: string; bg: string; color: string }> = {
  fix: { label: "Fix", bg: "#FEE2E2", color: "#B91C1C" },
  provide: { label: "Provide", bg: "#FEF3C7", color: "#B45309" },
  verify: { label: "Verify", bg: "#DCFCE7", color: "#15803D" },
};

// Same worst-first ordering every other Verify/Provide/Fix screen on this
// page uses - Fix items (real disqualification risk) need attention before
// a Provide item, which needs attention before a Verify-only glance.
const GROUP_ORDER: { status: BidTaskStatus; title: string; emptyText: string }[] = [
  { status: "fix", title: "Fix", emptyText: "Nothing here would disqualify the bid." },
  { status: "provide", title: "Provide", emptyText: "Nothing left only you can supply." },
  { status: "verify", title: "Verify", emptyText: "Nothing here needs a look yet." },
];

function StepRow({ step }: { step: PlanStep }) {
  const st = STATUS_STYLE[step.bidTaskStatus];
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 0", borderTop: "1px solid #ECEEF1" }}>
      <span
        style={{
          flex: "0 0 auto",
          marginTop: 1,
          display: "inline-flex",
          alignItems: "center",
          padding: "2px 9px",
          borderRadius: 100,
          fontSize: 11,
          fontWeight: 600,
          background: st.bg,
          color: st.color,
          whiteSpace: "nowrap",
        }}
      >
        {st.label}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{step.title}</div>
        <div style={{ fontSize: 12, color: "#4B5563", wordBreak: "break-word" }}>{step.note}</div>
      </div>
    </div>
  );
}

export async function SubmissionPlanView({ tenderId }: { tenderId: string }) {
  const plan = await loadSubmissionPlan(tenderId);

  return (
    <div id="submission-plan" style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Submission plan</div>
      <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 12 }}>
        Every step this tender&apos;s own documents call for, read from your company vault and this tender&apos;s
        answers - nothing invented, nothing re-checked twice.
      </div>

      {!plan.mapped && (
        <div style={{ fontSize: 12, color: "#8A93A0" }}>
          Not available yet - this tender&apos;s documents haven&apos;t been read, so there&apos;s nothing real to
          plan against.
        </div>
      )}

      {plan.mapped && (
        <>
          {plan.timeline.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {plan.timeline.map((m) => (
                <div
                  key={m.key}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4B5563" }}
                >
                  <span style={{ fontWeight: 600, color: "#16233B" }}>{m.label}:</span>
                  <DeadlineChip daysLeft={m.daysLeft} />
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 12 }}>
            {plan.summary.fix} to fix, {plan.summary.provide} to provide, {plan.summary.verify} to verify (
            {plan.summary.total} step{plan.summary.total === 1 ? "" : "s"} total).
          </div>

          {GROUP_ORDER.map((group) => {
            const groupSteps = plan.steps.filter((s) => s.bidTaskStatus === group.status);
            return (
              <div key={group.status} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>
                  {group.title} ({groupSteps.length})
                </div>
                {groupSteps.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#8A93A0", padding: "9px 0" }}>{group.emptyText}</div>
                ) : (
                  groupSteps.map((s) => <StepRow key={s.id} step={s} />)
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
