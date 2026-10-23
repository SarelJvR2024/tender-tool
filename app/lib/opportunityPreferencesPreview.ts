// PREVIEW ONLY - not real persistence. Sarel's own live feedback, this
// session (2026-10-23), after onboarding a new test company: "in the
// opportunities page we need to add options to set the opportunity
// preferences for a company" + "i see also there is by default a sanral bid
// pulled in, this shouldnt be tehere if the company is not interested in
// sanral projects." Both need a new company-scoped table/columns - neither
// `companies` nor `discovered_opportunities` carries anything like "which
// buyers/disciplines this company cares about" today (confirmed by reading
// both tables' own migrations). Real storage is a schema change, which this
// repo's standing rule says may be PROPOSED but never autonomously merged -
// see this PR's description and app/AGENTS.md for the proposed migration
// SQL and the server actions that would read/write it once Sarel signs off.
//
// So this is a browser-only mock, same technique as PR #121's own
// lib/opportunityTagsPreview.ts (read that file for the fuller rationale on
// why useSyncExternalStore is the right read path here) - but deliberately
// a SEPARATE module/key, not an extension of that file: PR #121 previews a
// per-OPPORTUNITY concept (tags + interest marker on one discovered_opportunity
// row); this previews a per-COMPANY concept (which buyer boards/disciplines
// the company cares about at all). Different shape, different eventual
// table, so a different localStorage key and a different store - keeping
// PR #121 untouched and independently mergeable, per this task's own
// instruction not to touch its files.
//
// Every read/write here is `localStorage`, scoped to one browser, never
// synced to the company or to Supabase. It exists purely so Sarel can see
// and react to the real interaction before anyone writes the schema for
// real. The UI built on top of this (OpportunityPreferencesPanel.tsx) says
// "Preview - not yet saved to your company profile" out loud - nothing here
// should ever be mistaken for the real feature actually filtering what
// anyone sees.
const STORAGE_KEY = "tt_opportunity_preferences_preview_v1";

export type OpportunityPreferencesPreview = {
  // Sarel's own concrete case: "shouldnt be there if the company is not
  // interested in sanral projects" - a company-level opt-out of the
  // SANRAL/road-construction board. true = "don't show me SANRAL tenders".
  hideSanral: boolean;
  // discipline_categories (0040) slugs this company says it cares about -
  // reuses the SAME taxonomy Experience Library tagging and pricing already
  // use (lib/disciplineTaxonomy.ts), not a new invented vocabulary.
  disciplines: string[];
};

export const EMPTY_PREFERENCES: OpportunityPreferencesPreview = { hideSanral: false, disciplines: [] };

/**
 * Pure and exported for unit testing: never trusts whatever JSON happens to
 * be sitting in localStorage (a stale shape from an earlier version of this
 * preview, a value edited by hand in devtools, etc) - degrades to the empty
 * default rather than throwing or passing through garbage.
 */
export function sanitizePreferences(raw: unknown): OpportunityPreferencesPreview {
  if (!raw || typeof raw !== "object") return EMPTY_PREFERENCES;
  const r = raw as Record<string, unknown>;
  const disciplines = Array.isArray(r.disciplines)
    ? Array.from(new Set(r.disciplines.filter((d): d is string => typeof d === "string" && d.length > 0)))
    : [];
  return { hideSanral: r.hideSanral === true, disciplines };
}

/** Pure: on/off toggle for a slug in a discipline list, used by the panel's checkbox handler. */
export function toggleDiscipline(current: string[], slug: string): string[] {
  return current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readStore(): OpportunityPreferencesPreview {
  if (typeof window === "undefined") return EMPTY_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizePreferences(JSON.parse(raw)) : EMPTY_PREFERENCES;
  } catch {
    return EMPTY_PREFERENCES;
  }
}

// useSyncExternalStore requires getSnapshot to return a stable (===)
// reference until the underlying data actually changes - cached and only
// ever replaced by writePreferences() below, never recomputed by the getter.
let snapshotCache: OpportunityPreferencesPreview | null = null;

function writePreferences(prefs: OpportunityPreferencesPreview): void {
  snapshotCache = prefs;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Storage full/blocked (private browsing) - the preview just doesn't
      // persist across reloads; nothing real was ever at risk of being lost.
    }
  }
  notify();
}

export function getPreferencesSnapshot(): OpportunityPreferencesPreview {
  if (!snapshotCache) snapshotCache = readStore();
  return snapshotCache;
}

export function getPreferencesServerSnapshot(): OpportunityPreferencesPreview {
  return EMPTY_PREFERENCES;
}

export function setHideSanralPreview(hide: boolean): void {
  writePreferences({ ...getPreferencesSnapshot(), hideSanral: hide });
}

export function setDisciplinesPreview(disciplines: string[]): void {
  writePreferences({ ...getPreferencesSnapshot(), disciplines });
}
