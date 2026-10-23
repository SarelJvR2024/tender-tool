// PREVIEW ONLY - not real persistence. Sarel's live feedback on /discovery
// (2026-10-22): "allow the company to add tags for how to search and
// prioritise opportunities. add quick tags to indicate interest or
// declines." Both need a new company-scoped column/table
// (discovered_opportunities has neither today) - real storage is a schema
// change, which this repo's standing rule says may be PROPOSED but never
// autonomously merged (see the PR description this file ships in for the
// proposed migration SQL).
//
// So this is a browser-only mock: every read/write here is `localStorage`,
// scoped to one browser, never synced to the company or to Supabase. It
// exists purely so Sarel can see and react to the real interaction (adding a
// tag, marking interested/declined) before anyone writes the schema for
// real. Every caller must treat it as non-authoritative, and the UI says so
// out loud (see OpportunityQuickActions's own "Preview" label) - nothing
// here should ever be mistaken for the real feature.
//
// A plain external store (subscribe/getSnapshot), read via React's
// useSyncExternalStore in the component - the correct way to read a mutable
// value that lives outside React (localStorage can't be read during SSR,
// and a plain useState+useEffect read-after-mount pattern is exactly what
// the set-state-in-effect lint rule now flags).
const STORAGE_KEY = "tt_opportunity_tags_preview_v1";

export type InterestMark = "interested" | "declined" | null;

type PreviewStore = Record<string, { tags: string[]; interest: InterestMark }>;

const EMPTY_ENTRY: { tags: string[]; interest: InterestMark } = { tags: [], interest: null };
const EMPTY_TAGS: string[] = [];

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readStore(): PreviewStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PreviewStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: PreviewStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full/blocked (private browsing) - the preview just doesn't
    // persist across reloads; nothing real was ever at risk of being lost.
  }
  notify();
}

export function setPreviewTags(opportunityId: string, tags: string[]): void {
  const store = readStore();
  store[opportunityId] = { ...(store[opportunityId] ?? EMPTY_ENTRY), tags };
  entrySnapshotCache.delete(opportunityId);
  tagsListSnapshotCache = null;
  writeStore(store);
}

export function setPreviewInterest(opportunityId: string, interest: InterestMark): void {
  const store = readStore();
  store[opportunityId] = { ...(store[opportunityId] ?? EMPTY_ENTRY), interest };
  entrySnapshotCache.delete(opportunityId);
  writeStore(store);
}

// useSyncExternalStore requires getSnapshot to return a stable (===)
// reference until the underlying data actually changes, or React re-renders
// in a loop - so every snapshot is cached and only replaced by the write
// functions above, never recomputed by the getter itself.
const entrySnapshotCache = new Map<string, { tags: string[]; interest: InterestMark }>();

export function getPreviewEntrySnapshot(opportunityId: string): { tags: string[]; interest: InterestMark } {
  const cached = entrySnapshotCache.get(opportunityId);
  if (cached) return cached;
  const entry = readStore()[opportunityId] ?? EMPTY_ENTRY;
  entrySnapshotCache.set(opportunityId, entry);
  return entry;
}

export function getPreviewEntryServerSnapshot(): { tags: string[]; interest: InterestMark } {
  return EMPTY_ENTRY;
}

let tagsListSnapshotCache: string[] | null = null;

/** Every tag used anywhere in this browser's preview data, for a simple
 * "reuse a tag you already typed" suggestion list - the closest a
 * localStorage mock can get to a real company-wide tag vocabulary. */
export function getAllTagsSnapshot(): string[] {
  if (tagsListSnapshotCache) return tagsListSnapshotCache;
  const store = readStore();
  const all = new Set<string>();
  for (const entry of Object.values(store)) for (const t of entry.tags) all.add(t);
  tagsListSnapshotCache = [...all].sort();
  return tagsListSnapshotCache;
}

export function getAllTagsServerSnapshot(): string[] {
  return EMPTY_TAGS;
}
