// Pure logic for scripts/send-corrigendum-alerts.ts, split out so it's
// unit-testable without a live Supabase connection - same convention as
// lib/deadlineReminders.ts/lib/briefingReminders.ts for their own sender
// scripts.
import type { TenderChange } from "./emailTemplatesTier1.ts";

const DOC_KIND_LABEL: Record<string, string> = {
  addendum: "Addendum published",
  clarification: "Clarification issued",
  cancellation: "Cancellation notice",
  revised_document: "Revised document published",
  supporting_document: "New supporting document",
};

export type WatchedDocRow = {
  id: string;
  kind: string | null;
  title: string | null;
  summary: string | null;
  changes: Record<string, unknown> | null;
};

/** Flattens tender_watched_documents.changes (migration 0039's own jsonb shape) into corrigendumAlertEmail's TenderChange[] - closing_date/briefing first (most actionable), then every other_changes entry, falling back to the document's own kind/summary when there's no structured change at all (e.g. a supporting_document with nothing to diff). */
export function changesForDoc(doc: WatchedDocRow): TenderChange[] {
  const changes = doc.changes ?? {};
  const out: TenderChange[] = [];

  const closing = changes.closing_date as { date?: string; previous_on_file?: string; quote?: string } | undefined;
  if (closing?.date) {
    out.push({ kind: "closing_date", date: closing.date, previousDate: closing.previous_on_file ?? null, quote: closing.quote ?? "" });
  }
  const briefing = changes.briefing as { date?: string; previous_date?: string; quote?: string } | undefined;
  if (briefing?.date) {
    out.push({ kind: "briefing", date: briefing.date, previousDate: briefing.previous_date ?? null, quote: briefing.quote ?? "" });
  }
  const other = (changes.other_changes as { kind?: string; quote?: string }[] | undefined) ?? [];
  for (const c of other) {
    out.push({ kind: "other", label: DOC_KIND_LABEL[c.kind ?? ""] ?? "Change noted", quote: c.quote ?? "" });
  }
  if (out.length === 0) {
    out.push({ kind: "other", label: DOC_KIND_LABEL[doc.kind ?? ""] ?? "New document", quote: doc.summary ?? doc.title ?? "" });
  }
  return out;
}

export type TenderUpdateNotificationRow = { pipeline_stage: string | null };

/**
 * Submission-suppression for corrigendum alerts: 'won'/'lost' are genuinely
 * terminal, skipped. 'submitted' is deliberately KEPT - an addendum before
 * closing can still require a resubmission or acknowledgement even after a
 * company has submitted (engine/discovery/watch_tender_updates.py's own
 * ACTIVE_STAGES reasoning). This app's real pipeline_stage enum is
 * found/bidding/submitted/won/lost (migration 0021) - there is no
 * dispatched/awarded/declined value to filter against.
 */
export function isCorrigendumCandidate(row: TenderUpdateNotificationRow): boolean {
  return row.pipeline_stage !== "won" && row.pipeline_stage !== "lost";
}
