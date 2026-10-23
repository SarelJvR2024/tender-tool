"use client";

import { useState, useSyncExternalStore } from "react";
import { ThumbsDown, ThumbsUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getAllTagsServerSnapshot,
  getAllTagsSnapshot,
  getPreviewEntryServerSnapshot,
  getPreviewEntrySnapshot,
  setPreviewInterest,
  setPreviewTags,
  subscribe,
  type InterestMark,
} from "@/lib/opportunityTagsPreview";

/**
 * PREVIEW of Sarel's own live feedback on /discovery (2026-10-22): "allow
 * the company to add tags for how to search and prioritise opportunities.
 * add quick tags to indicate interest or declines." Not the real feature -
 * see lib/opportunityTagsPreview.ts's own header comment. Every write here
 * is this one browser's localStorage, never the company's real data, and
 * the small "Preview" label below says so out loud rather than letting it
 * look like a working save.
 *
 * A standalone client island (not a prop threaded through the server-
 * rendered card) on purpose: discovered_opportunities carries no tags/
 * interest columns today, so there is nothing server-side to pass in - this
 * reads its own mock state straight from the browser, via
 * useSyncExternalStore (the correct way to read a value that lives outside
 * React - localStorage can't be read during SSR, unlike a plain
 * useState+useEffect read-after-mount).
 */
export function OpportunityQuickActions({ opportunityId }: { opportunityId: string }) {
  const { tags, interest } = useSyncExternalStore(
    subscribe,
    () => getPreviewEntrySnapshot(opportunityId),
    getPreviewEntryServerSnapshot,
  );
  const suggestions = useSyncExternalStore(subscribe, getAllTagsSnapshot, getAllTagsServerSnapshot);
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag || tags.includes(tag)) return;
    setPreviewTags(opportunityId, [...tags, tag]);
    setDraft("");
  }

  function removeTag(tag: string) {
    setPreviewTags(opportunityId, tags.filter((t) => t !== tag));
  }

  function toggleInterest(mark: Exclude<InterestMark, null>) {
    setPreviewInterest(opportunityId, interest === mark ? null : mark);
  }

  const otherSuggestions = suggestions.filter((s) => !tags.includes(s));

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => toggleInterest("interested")}
        title="Mark interested (preview only - not saved to your account yet)"
        className={cn(
          "flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold",
          interest === "interested" ? "border-success bg-success/10 text-success" : "border-border bg-card text-muted-foreground",
        )}
      >
        <ThumbsUp className="size-3" /> Interested
      </button>
      <button
        type="button"
        onClick={() => toggleInterest("declined")}
        title="Mark not interested (preview only - not saved to your account yet)"
        className={cn(
          "flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold",
          interest === "declined" ? "border-destructive bg-destructive/10 text-destructive" : "border-border bg-card text-muted-foreground",
        )}
      >
        <ThumbsDown className="size-3" /> Not interested
      </button>

      {tags.map((t) => (
        <span key={t} className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent">
          {t}
          <button type="button" onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`} className="flex size-3.5 items-center justify-center rounded-full hover:bg-accent/20">
            <X className="size-2.5" />
          </button>
        </span>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          addTag(draft);
        }}
        className="flex items-center"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="+ add tag"
          list={`tag-suggestions-${opportunityId}`}
          className="min-h-8 w-24 rounded-full border border-dashed border-border bg-transparent px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:w-32 focus:outline-none"
        />
        <datalist id={`tag-suggestions-${opportunityId}`}>
          {otherSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </form>

      <span title="Mock only - this browser's own storage, not yet saved to your company's account. Real tags/interest need a schema change, proposed separately for review." className="text-[10px] italic text-muted-foreground">
        Preview
      </span>
    </div>
  );
}
