"use client";

import { useState, useTransition } from "react";
import { ThumbsDown, ThumbsUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { setOpportunityInterest, setOpportunityTag, type OpportunityInterestMarker } from "./actions";

/**
 * Company tags + quick interest/decline marking (Sarel's own live feedback
 * on /discovery, 2026-10-22: "allow the company to add tags for how to
 * search and prioritise opportunities. add quick tags to indicate interest
 * or declines."). Migration 0089 - real persistence now, via
 * setOpportunityTag()/setOpportunityInterest() (actions.ts), not the earlier
 * browser-only localStorage preview this PR first shipped with.
 *
 * `tags`/`interest` prefill the local optimistic state below from the
 * opportunity row the server component already loaded
 * (discovered_opportunities.company_tags / .interest_marker) - no client-
 * side store, no useSyncExternalStore.
 *
 * Real bug, 2026-10-29 (Sarel: "the interested button doesn't work well,
 * need to click multiple times"): this used to have NO local optimistic
 * copy of the value at all - only `isPending`, to disable controls mid-
 * flight - relying entirely on the next render after
 * setOpportunityInterest()/setOpportunityTag()'s own revalidatePath("/discovery")
 * to show the new state. That revalidate re-runs discovery/page.tsx's own
 * deliberately heavy renderDiscovery() (8 parallel queries, N+1 lookups, up
 * to 40 market-pricing lookups), so the button could sit unchanged for
 * several seconds. A user who clicked again before that resolved was reading
 * the STALE `interest` prop from the still-unrefreshed render, so a second
 * click on "Interested" could toggle it straight back off - not a double
 * click doing nothing, an actual flip-flop. Now mirrors
 * OpportunityPreferencesPanel.tsx's own proven pattern: optimistic local
 * state updates immediately, a failed save reverts it. The slow background
 * revalidate still runs (interest_marker genuinely gates the Declined/
 * Interested tabs' own full-history filter - see lib/discoveryPagination.ts
 * - so it can't just be dropped the way the preferences panel's own
 * revalidatePath("/discovery") was), but it no longer blocks what the user
 * sees on click.
 */
export function OpportunityQuickActions({
  opportunityId,
  tags: initialTags,
  interest: initialInterest,
  suggestions,
}: {
  opportunityId: string;
  tags: string[];
  interest: OpportunityInterestMarker;
  /** Tags already used elsewhere on this page, for a "reuse a tag you
   * already typed" suggestion list - scoped to whatever window of
   * discovered_opportunities is currently loaded (same documented scoped-
   * limitation as the "Changed" filter tab; see lib/discoveryPagination.ts),
   * not a separate full-history query. */
  suggestions: string[];
}) {
  const [tags, setTags] = useState(initialTags);
  const [interest, setInterest] = useState(initialInterest);
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag || tags.includes(tag)) return;
    const prevTags = tags;
    setDraft("");
    setTags([...tags, tag]);
    startTransition(async () => {
      const result = await setOpportunityTag(opportunityId, tag, "add");
      if (!result?.ok) setTags(prevTags);
    });
  }

  function removeTag(tag: string) {
    const prevTags = tags;
    setTags(tags.filter((t) => t !== tag));
    startTransition(async () => {
      const result = await setOpportunityTag(opportunityId, tag, "remove");
      if (!result?.ok) setTags(prevTags);
    });
  }

  function toggleInterest(mark: Exclude<OpportunityInterestMarker, null>) {
    const prevInterest = interest;
    const next = interest === mark ? null : mark;
    setInterest(next);
    startTransition(async () => {
      const result = await setOpportunityInterest(opportunityId, next);
      if (!result?.ok) setInterest(prevInterest);
    });
  }

  const otherSuggestions = suggestions.filter((s) => !tags.includes(s));

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={isPending}
        onClick={() => toggleInterest("interested")}
        title="Mark interested"
        className={cn(
          "flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold",
          interest === "interested" ? "border-success bg-success/10 text-success" : "border-border bg-card text-muted-foreground",
          isPending ? "cursor-default opacity-60" : "cursor-pointer",
        )}
      >
        <ThumbsUp className="size-3" /> Interested
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => toggleInterest("declined")}
        title="Mark not interested"
        className={cn(
          "flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold",
          interest === "declined" ? "border-destructive bg-destructive/10 text-destructive" : "border-border bg-card text-muted-foreground",
          isPending ? "cursor-default opacity-60" : "cursor-pointer",
        )}
      >
        <ThumbsDown className="size-3" /> Not interested
      </button>

      {tags.map((t) => (
        <span key={t} className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent">
          {t}
          <button
            type="button"
            disabled={isPending}
            onClick={() => removeTag(t)}
            aria-label={`Remove tag ${t}`}
            className="flex size-3.5 items-center justify-center rounded-full hover:bg-accent/20"
          >
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
          disabled={isPending}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="+ add tag"
          list={`tag-suggestions-${opportunityId}`}
          className="min-h-8 w-24 rounded-full border border-dashed border-border bg-transparent px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:w-32 focus:outline-none disabled:opacity-60"
        />
        <datalist id={`tag-suggestions-${opportunityId}`}>
          {otherSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </form>
    </div>
  );
}
