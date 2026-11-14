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

// Finding 415 (2026-11-11): a SEPARATE, line-level vocabulary from
// DOC_KIND_LABEL above. DOC_KIND_LABEL's keys are the DOCUMENT's own overall
// classification (engine/discovery/tender_updates.py's classify_document()'s
// `kind` - addendum/clarification/cancellation/revised_document/
// supporting_document). `other_changes[]` entries come from that same
// file's find_other_changes()/OTHER_CHANGE_RES instead - a line found INSIDE
// an addendum's text stating a specific change to the tender itself - and
// its `kind` can only ever be one of the 7 keys below. The two vocabularies
// never overlap by construction, so looking `other_changes[].kind` up in
// DOC_KIND_LABEL (as this file used to) always misses and silently falls
// back to the generic "Change noted" for every real other_changes entry -
// discarding the specific signal (scope/pricing/evaluation/CIDB/validity)
// this exact regex detection work exists to produce, in the real email this
// sends (scripts/send-corrigendum-alerts.ts, scheduled every 2h, 07:00-19:00
// SAST weekdays). Confirmed directly against OTHER_CHANGE_RES's own list.
const OTHER_CHANGE_KIND_LABEL: Record<string, string> = {
  scope: "Scope of work amended",
  requirement_removed: "Requirement removed",
  wording_replaced: "Wording replaced",
  pricing: "Pricing / BOQ amended",
  evaluation: "Evaluation criteria changed",
  cidb: "CIDB grading changed",
  validity: "Bid validity extended",
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
  const briefing = changes.briefing as { date?: string | null; previous_date?: string | null; quote?: string; cancelled?: boolean } | undefined;
  if (briefing?.date) {
    out.push({ kind: "briefing", date: briefing.date, previousDate: briefing.previous_date ?? null, quote: briefing.quote ?? "" });
  } else if (briefing?.cancelled) {
    // Finding 446: classify_document() (engine/discovery/tender_updates.py)
    // writes changes.briefing = {date: null, cancelled: true, quote: ...}
    // for a briefing CANCELLED or made non-compulsory (BRIEFING_CANCELLED_RE)
    // - a real, deliberate sentinel shape, not "no briefing change at all".
    // The `briefing?.date` check above (the only branch that used to exist)
    // is falsy for this sentinel (date is null by design), so a cancelled
    // briefing was silently dropped from this array whenever the SAME
    // addendum also moved the closing date or matched an other_changes
    // pattern (out.length > 0, so the "no structured change" fallback in
    // changesForDoc()'s caller, which uses doc.summary and DOES mention the
    // cancellation via classify_document()'s own `bits` text, never runs
    // either) - exactly the scenario a real SANRAL/CIDB addendum often is
    // ("closing date moved to X; the compulsory briefing is hereby
    // cancelled"). app/app/tenders/[id]/tender-updates.tsx's own live
    // Tender Workspace reader already handles this correctly (`briefing &&
    // ... briefing.cancelled ? "Briefing session cancelled or no longer
    // compulsory." : ...` - truthy-object check, never `briefing.date`), so
    // this was specifically the corrigendum EMAIL's own gap: a company could
    // receive "Closing Date Changed (Addendum)" with no mention at all that
    // the briefing they were planning to attend no longer exists.
    out.push({ kind: "briefing", date: null, previousDate: null, quote: briefing.quote ?? "", cancelled: true });
  }
  const other = (changes.other_changes as { kind?: string; quote?: string }[] | undefined) ?? [];
  for (const c of other) {
    out.push({ kind: "other", label: OTHER_CHANGE_KIND_LABEL[c.kind ?? ""] ?? "Change noted", quote: c.quote ?? "" });
  }
  if (out.length === 0) {
    out.push({ kind: "other", label: DOC_KIND_LABEL[doc.kind ?? ""] ?? "New document", quote: doc.summary ?? doc.title ?? "" });
  }
  return out;
}

export type TenderUpdateNotificationRow = { pipeline_stage: string | null };

/**
 * Submission-suppression for corrigendum alerts: 'won'/'lost' are genuinely
 * terminal, skipped. 'submitted' (and 'briefing_shortlisted', which only
 * ever follows it) is deliberately KEPT - an addendum before closing can
 * still require a resubmission or acknowledgement even after a company has
 * submitted (engine/discovery/watch_tender_updates.py's own ACTIVE_STAGES
 * reasoning). This app's real pipeline_stage enum is found/assessing/
 * building/submitted/briefing_shortlisted/won/lost (widened from the
 * original 5-value found/bidding/submitted/won/lost by migration 0105,
 * which retired 'bidding' - this comment used to still cite the old
 * 5-value, migration-0021-only enum; correctness-checked against
 * scripts/send-corrigendum-alerts.ts's own, already-current comment, and
 * against the real check constraint in 0105_tender_pipeline_stage_v2.sql.
 * The `!== "won" && !== "lost"` check below is exclusion-based, so it was
 * never actually WRONG about any of the newer stages - only this comment
 * was stale). There is no dispatched/awarded/declined value to filter
 * against.
 */
export function isCorrigendumCandidate(row: TenderUpdateNotificationRow): boolean {
  return row.pipeline_stage !== "won" && row.pipeline_stage !== "lost";
}
