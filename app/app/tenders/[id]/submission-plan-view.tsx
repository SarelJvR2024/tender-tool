import { loadSubmissionPlan } from "./submission-plan-data";
import { actionTypeForStep, type PlanStep } from "./submission-plan-logic";
import type { BidTaskStatus } from "./bid-task-status";
import { ActionTypeTag } from "./action-type-tag";
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
 * Grouped by PHASE (the order you'd actually compile a tender pack in), not
 * by status - Sarel's own live feedback: "change submission plan to be
 * grouped by how to compile the tender pack and according to the timeline
 * of when things need to happen ... not just one long list." The existing
 * Fix/Provide/Verify status is kept as the color-coded badge on each row
 * ("you can still color code if it needs fixing or done or ready to
 * submit") - worst-first WITHIN a phase - it's just no longer the thing the
 * page is grouped by.
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

// The order a tender pack actually gets compiled in: first confirm you even
// qualify (the documents/grading that would disqualify you outright), then
// decide who's doing it, then produce the paperwork, then answer whatever
// is specific to this buyer, then the one thing you have to physically go
// and do, then whatever the engine itself couldn't pin down. Each phase's
// own PlanStep.category values - no new field, no schema change.
const PHASE_ORDER: { categories: string[]; title: string; emptyText: string }[] = [
  { categories: ["returnable", "cidb_grading"], title: "1. Confirm you qualify", emptyText: "Nothing here would disqualify the bid." },
  { categories: ["role"], title: "2. Assign your team", emptyText: "No roles named in this tender." },
  { categories: ["form", "buyer_form"], title: "3. Complete the forms", emptyText: "No forms found in this tender's documents." },
  { categories: ["question"], title: "4. Answer this tender's own questions", emptyText: "Nothing only a person can answer." },
  { categories: ["briefing"], title: "5. Attend the briefing", emptyText: "No compulsory briefing on file." },
  { categories: ["gap"], title: "6. Known limitations", emptyText: "Nothing the engine flagged as uncertain." },
];

// Worst-first within a phase - same ordering every other Verify/Provide/Fix
// screen on this page uses.
const STATUS_ORDER: BidTaskStatus[] = ["fix", "provide", "verify"];

function StepRow({ step }: { step: PlanStep }) {
  const st = STATUS_STYLE[step.bidTaskStatus];
  return (
    <div className="flex items-start gap-2 border-t border-border py-2.5">
      <div className="mt-px flex flex-none flex-col items-end gap-1">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${st.className}`}
        >
          {st.label}
        </span>
        <ActionTypeTag type={actionTypeForStep(step)} />
      </div>
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
        Every step this tender calls for, grouped by when you&apos;d actually do it.
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

          {/* Always-visible overall progress - item 5 of Sarel's own list:
              "add a summary of how much is still needed per section ...
              always displayed so that it is easy to track progress." */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {plan.summary.total - plan.summary.fix - plan.summary.provide} of {plan.summary.total} ready
            </span>
            <span>·</span>
            <span>{plan.summary.fix} to fix</span>
            <span>·</span>
            <span>{plan.summary.provide} to provide</span>
            <span>·</span>
            <span>{plan.summary.verify} to verify</span>
          </div>

          {PHASE_ORDER.map((phase) => {
            const phaseSteps = plan.steps
              .filter((s) => phase.categories.includes(s.category))
              .sort((a, b) => STATUS_ORDER.indexOf(a.bidTaskStatus) - STATUS_ORDER.indexOf(b.bidTaskStatus));
            if (phaseSteps.length === 0) return null; // nothing in this phase for this tender - skip it, don't pad the list with an empty section
            const done = phaseSteps.filter((s) => s.bidTaskStatus === "verify").length;
            return (
              <div key={phase.title} className="mb-3.5">
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-foreground">{phase.title}</div>
                  <div className="shrink-0 text-xs font-semibold text-muted-foreground">
                    {done} of {phaseSteps.length} done
                  </div>
                </div>
                {phaseSteps.map((s) => (
                  <StepRow key={s.id} step={s} />
                ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
