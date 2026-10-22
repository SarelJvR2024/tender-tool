// Tender updates found after discovery (migration 0039,
// engine/discovery/watch_tender_updates.py): addenda, clarifications,
// cancellations, revised documents and late supporting documents, each read
// and classified by the engine. Pure helpers for the Tender Workspace's
// "This tender has been updated" card and its activity-log entries.

export type TenderUpdateKind = "addendum" | "clarification" | "cancellation" | "revised_document" | "supporting_document";
export type TenderUpdateUrgency = "critical" | "high" | "info";

export type ClosingDateChange = {
  date: string;
  time: string | null;
  quote: string;
  previous_on_file: string | null;
  previous_in_document: string | null;
  direction: "later" | "earlier" | "same" | "unknown";
  listing_date: string | null;
  listing_agrees: boolean;
  applied: boolean;
} & Acceptance;

/** Set by accept_tender_update_date() (0048) when a person applied the date. */
export type Acceptance = {
  applied_by?: "person";
  accepted_by?: string;
  accepted_by_company?: string;
  accepted_at?: string;
  on_file_before_accept?: string | null;
  applied_value?: string;
  time_assumed?: boolean;
};

export type BriefingChange = {
  date: string | null;
  time: string | null;
  previous_date: string | null;
  quote: string;
  cancelled?: boolean;
  // 0048: the briefing date on file when the watch read it, whether the
  // document's "original" date matches it, and whether it was written to
  // tenders.briefing_date + the "Briefing session" milestones.
  previous_on_file?: string | null;
  on_file_agrees?: boolean;
  applied?: boolean;
} & Acceptance;

export type TenderUpdateChanges = {
  closing_date?: ClosingDateChange;
  briefing?: BriefingChange;
  other_changes?: { kind: string; quote: string }[];
  caveats?: string[];
};

export type TenderUpdate = {
  id: string;
  title: string | null;
  url: string | null;
  source: "etenders_ocds" | "sanral_page";
  first_seen_at: string;
  kind: TenderUpdateKind | null;
  read_basis: "text" | "ocr" | "title_only" | null;
  urgency: TenderUpdateUrgency | null;
  summary: string | null;
  changes: TenderUpdateChanges | null;
  read_error: string | null;
};

export const UPDATE_KIND_LABEL: Record<TenderUpdateKind, string> = {
  addendum: "Addendum",
  clarification: "Clarification",
  cancellation: "Cancellation notice",
  revised_document: "Revised document",
  supporting_document: "New document",
};

// Tailwind token classes (app/globals.css), not literal hex - badgeClassName
// follows components/tt/bid-task-badge.tsx's own soft-tint convention
// (border-X/20 bg-X/10 text-X); cardBorderClassName is the stronger,
// solid-token border the whole update card itself uses to flag severity.
export const URGENCY_STYLE: Record<TenderUpdateUrgency, { badgeClassName: string; cardBorderClassName: string; label: string }> = {
  critical: { badgeClassName: "border-destructive/20 bg-destructive/10 text-destructive", cardBorderClassName: "border-destructive/50", label: "Act now" },
  high: { badgeClassName: "border-warning/20 bg-warning/10 text-warning", cardBorderClassName: "border-warning/50", label: "Important" },
  info: { badgeClassName: "border-border bg-muted text-foreground", cardBorderClassName: "border-border", label: "For information" },
};

const URGENCY_RANK: Record<TenderUpdateUrgency, number> = { critical: 0, high: 1, info: 2 };

/** Most urgent first, then newest. */
export function sortUpdates(updates: TenderUpdate[]): TenderUpdate[] {
  return [...updates].sort(
    (a, b) =>
      URGENCY_RANK[a.urgency ?? "info"] - URGENCY_RANK[b.urgency ?? "info"] ||
      new Date(b.first_seen_at).getTime() - new Date(a.first_seen_at).getTime(),
  );
}

export function mostUrgent(updates: TenderUpdate[]): TenderUpdateUrgency | null {
  return sortUpdates(updates)[0]?.urgency ?? null;
}

const DAY = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** "2026-11-06" -> "Fri 6 Nov 2026" (a calendar day, not shifted by time zone). */
export function formatDay(day: string | null): string {
  if (!day) return "?";
  const d = new Date(`${day.slice(0, 10)}T12:00:00+02:00`);
  return Number.isNaN(d.getTime()) ? day : DAY.format(d);
}

/** The one-line closing-date message the card leads with, or null. */
export function closingDateLine(c: ClosingDateChange | undefined): { text: string; tone: "good" | "bad" | "neutral" } | null {
  if (!c) return null;
  const when = `${formatDay(c.date)}${c.time ? ` ${c.time}` : ""}`;
  const was = c.previous_on_file && c.previous_on_file !== c.date ? c.previous_on_file : c.previous_in_document;
  const wasText = was ? ` (was ${formatDay(was)})` : "";
  if (c.direction === "later") return { text: `Closing date moved later to ${when}${wasText} - more time to prepare a bid.`, tone: "good" };
  if (c.direction === "earlier") return { text: `Closing date brought forward to ${when}${wasText} - less time than planned.`, tone: "bad" };
  if (c.direction === "same") return { text: `Closing date confirmed as ${when}.`, tone: "neutral" };
  return { text: `Closing date stated as ${when}.`, tone: "neutral" };
}

/** Whether the closing date on file was changed from this update, said plainly. */
export function appliedLine(c: ClosingDateChange | undefined): string | null {
  if (!c || c.direction === "same") return null;
  if (c.applied && c.applied_by === "person")
    return `Applied by hand: the closing date on file, its countdown, the “Tender closes” task and Discovery now show ${formatDay(c.date)}${c.time_assumed ? " (the document gives no time - the time of day on file was kept)" : ""}.`;
  if (c.applied) return "The closing date on file, its countdown and the “Tender closes” task have been updated - the listing shows the same date.";
  if (c.listing_date && !c.listing_agrees)
    return `Not applied: the listing still shows ${formatDay(c.listing_date)}. The closing date on file is unchanged until the buyer's listing agrees - confirm with the buyer.`;
  return "Not applied automatically - the closing date on file is unchanged. Check the document and confirm with the buyer.";
}

/**
 * A date the document states that wasn't applied automatically and that a
 * person can accept (accept_tender_update_date, 0048): the closing date when
 * the buyer's listing doesn't show it (or shows nothing), the briefing date
 * when the document's "original" briefing date isn't the one on file.
 */
export function closingNeedsDecision(c: ClosingDateChange | undefined): boolean {
  return !!c && !c.applied && c.direction !== "same";
}

export function briefingNeedsDecision(b: BriefingChange | undefined): boolean {
  return !!b && !!b.date && !b.cancelled && !b.applied && b.on_file_agrees === false;
}
