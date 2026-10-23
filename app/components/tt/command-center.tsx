import Link from "next/link";
import { AlertTriangle, Gavel, PackageCheck, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, daysUntil } from "@/lib/dates";
import { operationalStatusMessage, hoursUntilPrintSignDeadline, type DecisionNeeded } from "@/lib/dispatchTriage";
import type { DispatchCard } from "@/lib/dispatchDashboard";
import { DeadlineChip } from "./deadline-chip";
import { DispatchStatusButton } from "./dispatch-status-button";
import { EmptyState } from "./empty-state";

/**
 * The Tender Command Center (Sarel's own brief, 2026-10-24) - the dashboard's
 * operational triage view, replacing the old "Closing soon" list. Every
 * card here is a DispatchCard (lib/dispatchDashboard.ts) - already
 * classified, already carrying a real blocking summary from
 * lib/tenderNextStep.ts, nothing computed again in this file.
 */

function titleOf(c: DispatchCard): string {
  return c.contractNo ?? c.description ?? "Tender";
}

const DECISION_TAG: Record<Exclude<DecisionNeeded, "none">, string> = {
  attend_briefing: "Briefing attendance",
  director_resolution: "Director resolution",
};

function printDeadlineLabel(c: DispatchCard): string | null {
  if (!c.printDeadline) return null;
  return formatDateTime(c.printDeadline);
}

// Zone 1: the single highest-urgency card, as a high-contrast alert bar -
// nothing here if no card is actually at dispatch risk (an honest absence,
// not a disguised "everything's fine" banner either - see the empty state
// each lane renders on its own instead).
export function CriticalDispatchBanner({ cards }: { cards: DispatchCard[] }) {
  if (cards.length === 0) return null;
  // Soonest print-cutoff first; a digital submission (no print cutoff) falls
  // back to its own closing-date proximity via the same daysUntil() every
  // other urgency read on this page already uses, rather than a second,
  // inline Date.now() read during render.
  const urgencyHours = (c: DispatchCard) => hoursUntilPrintSignDeadline(c) ?? (c.closingDate ? (daysUntil(c.closingDate) ?? 999) * 24 : Infinity);
  const sorted = [...cards].sort((a, b) => urgencyHours(a) - urgencyHours(b));
  const top = sorted[0];
  const message = operationalStatusMessage(top, top.blockingSummary) ?? `${titleOf(top)} is at dispatch risk.`;
  const extra = cards.length > 1 ? ` (+${cards.length - 1} more tender${cards.length - 1 === 1 ? "" : "s"} at dispatch risk)` : "";

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-destructive">
            {cards.length === 1 ? "1 tender at dispatch risk" : `${cards.length} tenders at dispatch risk`}
          </div>
          <div className="text-sm text-destructive/90">
            {titleOf(top)}: {message}
            {extra}
          </div>
        </div>
      </div>
      <Link
        href={top.blockingHref ?? `/tenders/${top.tenderId}#pack-compiler`}
        className="shrink-0 rounded-md border border-destructive/40 bg-card px-3 py-1.5 text-xs font-semibold text-destructive no-underline hover:bg-destructive/10"
      >
        {top.blockingHref ? "Resolve blockers" : "Open Pack Compiler"}
      </Link>
    </div>
  );
}

function CardShell({ card, children }: { card: DispatchCard; children: React.ReactNode }) {
  const left = daysUntil(card.closingDate);
  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-xs font-semibold text-foreground">{card.contractNo ?? "(no reference)"}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{[card.buyer, card.description].filter(Boolean).join(" - ")}</div>
        </div>
        {left !== null && <DeadlineChip daysLeft={left} />}
      </div>
      {children}
    </div>
  );
}

// Lane A: "Needs Decision" (Directors/Principals) - every card with a real,
// derived decision pending, regardless of which triage bucket it's
// otherwise in (a critical dispatch-risk tender can still need a director
// call at the same time).
export function NeedsDecisionLane({ cards }: { cards: DispatchCard[] }) {
  const decisionCards = cards.filter((c) => c.decisionNeeded !== "none");
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {decisionCards.length === 0 ? (
        <EmptyState icon={Gavel} title="Nothing waiting on a decision" description="No briefings or director calls pending right now." />
      ) : (
        decisionCards.map((c) => (
          <CardShell key={c.tenderId} card={c}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
                {DECISION_TAG[c.decisionNeeded as Exclude<DecisionNeeded, "none">]}
              </span>
              {c.decisionNeeded === "attend_briefing" && c.briefingDate && (
                <span className="text-xs text-muted-foreground">
                  Briefing {formatDate(c.briefingDate)}
                  {c.briefingTime ? ` at ${c.briefingTime}` : ""}
                </span>
              )}
              {c.decisionNeeded === "director_resolution" && c.blockingSummary && (
                <span className="text-xs text-muted-foreground">{c.blockingSummary}</span>
              )}
            </div>
            <Link
              href={c.decisionNeeded === "attend_briefing" ? `/tenders/${c.tenderId}#tasks-milestones` : (c.blockingHref ?? `/tenders/${c.tenderId}`)}
              className="w-fit text-xs font-semibold text-accent no-underline hover:underline"
            >
              {c.decisionNeeded === "attend_briefing" ? "Open Tender Workspace" : "Review & Sign Off"} →
            </Link>
          </CardShell>
        ))
      )}
    </div>
  );
}

// Lane B: "Urgent Actions & Blocked Items" (Compilers) - closing soon or
// print-cutoff-critical, with real pending work. The dual timeline (box
// deadline vs print/bind cutoff) is the brief's own explicit ask - both are
// values this file already has, from lib/dispatchTriage.ts, never computed
// twice.
export function UrgentActionsLane({ cards }: { cards: DispatchCard[] }) {
  const urgentCards = cards.filter((c) => (c.bucket === "critical" || c.bucket === "in_progress") && c.blockingSummary);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {urgentCards.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="Nothing blocked right now" description="No urgent, unresolved compliance items on your active bids." />
      ) : (
        urgentCards.map((c) => {
          const deadlineText = printDeadlineLabel(c);
          return (
            <CardShell key={c.tenderId} card={c}>
              <div className="rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning">⚠️ {c.blockingSummary}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>⏱️ Tender box deadline: {c.closingDate ? formatDateTime(c.closingDate) : "—"}</span>
                {deadlineText && <span className="font-semibold text-foreground">🖨️ Print & bind cutoff: {deadlineText}</span>}
              </div>
              <Link href={c.blockingHref ?? `/tenders/${c.tenderId}`} className="w-fit text-xs font-semibold text-accent no-underline hover:underline">
                Fix this →
              </Link>
            </CardShell>
          );
        })
      )}
    </div>
  );
}

// Lane C: "Dispatch & Delivery Tracker" - tenders where physical compilation
// has actually started (dispatch_status moved off its default). Logistics
// themselves (submission type, delivery location, print/transit hours,
// courier) are edited on the Tender Workspace's own Pack compiler tab, not
// here - this lane is read + advance only, same "dashboard triages,
// workspace does the work" split as every other lane.
export function DispatchLane({ cards }: { cards: DispatchCard[] }) {
  const dispatchCards = cards.filter((c) => c.dispatchStatus !== "not_ready" || c.submissionType === "physical_box");
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {dispatchCards.length === 0 ? (
        <EmptyState icon={PackageCheck} title="Nothing in dispatch yet" description="Once a pack is ready to print, it shows up here." />
      ) : (
        dispatchCards.map((c) => (
          <CardShell key={c.tenderId} card={c}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <DispatchStatusButton tenderPackId={c.tenderPackId} tenderId={c.tenderId} status={c.dispatchStatus} />
              <Link href={`/tenders/${c.tenderId}#pack-compiler`} className="text-xs font-semibold text-accent no-underline hover:underline">
                Print Final Submission Pack →
              </Link>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {c.deliveryLocation && <span>Destination: {c.deliveryLocation}</span>}
              {c.courierContact && <span>Courier/driver: {c.courierContact}</span>}
              {!c.deliveryLocation && !c.courierContact && <span>No delivery location or courier set yet - add them on the Pack compiler tab.</span>}
            </div>
          </CardShell>
        ))
      )}
    </div>
  );
}

// Zone 3: "Radar / Can Wait" - low-stress, collapsed by default (rendered
// collapsed via <details> - no client state needed for something this low-
// priority by definition).
export function RadarSection({ cards }: { cards: DispatchCard[] }) {
  const radarCards = cards.filter((c) => c.bucket === "radar");
  if (radarCards.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <Radar className="mr-1.5 inline size-3.5 align-text-bottom" aria-hidden />
        No tenders on radar right now.
      </div>
    );
  }
  return (
    <details className="overflow-hidden rounded-lg border border-border bg-muted/30">
      <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-muted-foreground">
        <Radar className="mr-1.5 inline size-3.5 align-text-bottom" aria-hidden />
        {radarCards.length} shortlisted tender{radarCards.length === 1 ? "" : "s"} closing in &gt;7 days - no immediate action required
      </summary>
      <div className="border-t border-border bg-card">
        {radarCards.map((c) => {
          const left = daysUntil(c.closingDate);
          return (
            <Link
              key={c.tenderId}
              href={`/tenders/${c.tenderId}`}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-inherit no-underline first:border-t-0 hover:bg-muted/50"
            >
              <div className="min-w-0 text-xs">
                <span className="font-mono font-semibold text-foreground">{c.contractNo ?? "(no reference)"}</span>
                <span className="ml-2 text-muted-foreground">{[c.buyer, c.description].filter(Boolean).join(" - ")}</span>
              </div>
              {left !== null && <DeadlineChip daysLeft={left} className={cn("shrink-0")} />}
            </Link>
          );
        })}
      </div>
    </details>
  );
}
