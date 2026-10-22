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
 * Uses the shared design-system tokens (`app/globals.css`) via Tailwind
 * classes, same soft-tint status-chip convention as every other migrated
 * Verify/Provide/Fix screen - DeadlineChip is reused directly for the
 * timeline banner rather than reinventing its urgency styling here.
 */

const STATUS_STYLE: Record<BidTaskStatus, { label: string; className: string }> = {
  fix: { label: "Fix", className: "bg-destructive/10 text-destructive" },
  provide: { label: "Provide", className: "bg-warning/10 text-warning" },
  verify: { label: "Verify", className: "bg-success/10 text-success" },
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
    <div className="flex items-start gap-2 border-t border-border py-2.5">
      <span
        className={`mt-px inline-flex flex-none items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${st.className}`}
      >
        {st.label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-foreground">{step.title}</div>
        <div className="text-xs break-words text-muted-foreground">{step.note}</div>
      </div>
    </div>
  );
}

export async function SubmissionPlanView({ tenderId }: { tenderId: string }) {
  const plan = await loadSubmissionPlan(tenderId);

  return (
    <div id="submission-plan" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-0.5 text-[15px] font-bold text-foreground">Submission plan</div>
      <div className="mb-3 text-xs text-muted-foreground">
        Every step this tender&apos;s own documents call for, read from your company vault and this tender&apos;s
        answers - nothing invented, nothing re-checked twice.
      </div>

      {!plan.mapped && (
        <div className="text-xs text-muted-foreground">
          Not available yet - this tender&apos;s documents haven&apos;t been read, so there&apos;s nothing real to
          plan against.
        </div>
      )}

      {plan.mapped && (
        <>
          {plan.timeline.length > 0 && (
            <div className="mb-3.5 flex flex-wrap gap-2">
              {plan.timeline.map((m) => (
                <div
                  key={m.key}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span className="font-semibold text-foreground">{m.label}:</span>
                  <DeadlineChip daysLeft={m.daysLeft} />
                </div>
              ))}
            </div>
          )}

          <div className="mb-3 text-xs text-muted-foreground">
            {plan.summary.fix} to fix, {plan.summary.provide} to provide, {plan.summary.verify} to verify (
            {plan.summary.total} step{plan.summary.total === 1 ? "" : "s"} total).
          </div>

          {GROUP_ORDER.map((group) => {
            const groupSteps = plan.steps.filter((s) => s.bidTaskStatus === group.status);
            return (
              <div key={group.status} className="mb-3.5">
                <div className="mb-0.5 text-xs font-bold text-foreground">
                  {group.title} ({groupSteps.length})
                </div>
                {groupSteps.length === 0 ? (
                  <div className="py-2.5 text-xs text-muted-foreground">{group.emptyText}</div>
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
