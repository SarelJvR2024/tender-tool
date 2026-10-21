// Government tender sources and listing-level changes, as Discovery shows them
// (migration 0051; engine/discovery/gov_sources.py and tender_changes.py).
// Pure helpers - no Supabase calls - so the page and any later surface agree
// on labels and on which change matters most.

export type ListingSource = { source: string; source_id?: string | null; url?: string | null };

export type ListingChange = {
  id: string;
  ocid: string | null;
  change_type: string;
  summary: string;
  evidence_url: string | null;
  source_timestamp: string | null;
  detected_at: string;
};

export const SOURCE_LABELS: Record<string, string> = {
  etenders_portal: "eTenders portal",
  etenders_ocds: "eTenders (OCDS feed)",
  sanral: "SANRAL site",
  eskom_bulletin: "Eskom Tender Bulletin",
  transnet_etenders: "Transnet eTenders",
  capetown_procurement: "City of Cape Town portal",
  manual: "Loaded manually",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, " ");
}

// Distinct sources, in a stable order (portal first).
export function listingSourceLabels(sources: ListingSource[] | null, fallback: string | null): string[] {
  const keys = (sources ?? []).map((s) => s.source);
  if (keys.length === 0 && fallback) keys.push(fallback);
  const order = Object.keys(SOURCE_LABELS);
  return [...new Set(keys)]
    .sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)))
    .map(sourceLabel);
}

// Lower = more urgent. A cancellation or a moved deadline changes what a
// bidder must do; a listed document might.
const CHANGE_RANK: Record<string, number> = {
  cancelled: 0,
  closing_date_changed: 1,
  sources_disagree: 2,
  briefing_changed: 3,
  readvertised: 4,
  document_added: 5,
  validity_extended: 6,
  title_changed: 7,
  bidders_list_published: 8,
  award_published: 8,
  regret_published: 9,
};

export const CHANGE_LABELS: Record<string, string> = {
  cancelled: "Cancelled",
  closing_date_changed: "Closing date moved",
  sources_disagree: "Dates disagree",
  briefing_changed: "Briefing moved",
  readvertised: "Re-advertised",
  document_added: "Addendum / new document",
  validity_extended: "Validity extended",
  title_changed: "Title changed",
  bidders_list_published: "Bidders list published",
  award_published: "Award published",
  regret_published: "Regret letters out",
};

export function sortChanges(changes: ListingChange[]): ListingChange[] {
  return [...changes].sort(
    (a, b) =>
      (CHANGE_RANK[a.change_type] ?? 10) - (CHANGE_RANK[b.change_type] ?? 10) ||
      (b.source_timestamp ?? b.detected_at).localeCompare(a.source_timestamp ?? a.detected_at),
  );
}

// Design-system audit fix (2026-10-21): a soft-tint token class, not a
// literal hex triplet. The catch-all case (a new document, an extension, a
// published list/award/regret letter) reads as `info`, not `accent` - the
// product promise reserves accent for the single most important action on
// a screen, and several rows can show this "notable but not urgent" tone
// at once.
export function changeTone(type: string): { chipClass: string } {
  if (type === "cancelled") return { chipClass: "border border-destructive/30 bg-destructive/10 text-destructive" };
  if (type === "closing_date_changed" || type === "sources_disagree" || type === "briefing_changed")
    return { chipClass: "border border-warning/30 bg-warning/10 text-warning" };
  return { chipClass: "border border-info/30 bg-info/10 text-info" };
}

export function groupByOcid(changes: ListingChange[]): Map<string, ListingChange[]> {
  const out = new Map<string, ListingChange[]>();
  for (const c of changes) {
    if (!c.ocid) continue;
    const list = out.get(c.ocid) ?? [];
    list.push(c);
    out.set(c.ocid, list);
  }
  for (const [k, v] of out) out.set(k, sortChanges(v));
  return out;
}
