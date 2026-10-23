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
 * `tags`/`interest` come straight from the opportunity row the server
 * component already loaded (discovered_opportunities.company_tags /
 * .interest_marker) - no client-side store, no useSyncExternalStore. Every
 * write goes through startTransition() + a direct server-action call, the
 * same "tap it, it persists" shape as tenders/[id]/task-status-button.tsx
 * and task-assignee-select.tsx: no local optimistic copy of the value itself
 * (only `isPending`, to disable controls mid-flight) - the next render
 * after revalidatePath("/discovery") is what actually shows the new state,
 * consistent with every other inline control in this codebase.
 */
export function OpportunityQuickActions({
  opportunityId,
  tags,
  interest,
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
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag || tags.includes(tag)) return;
    setDraft("");
    startTransition(() => {
      setOpportunityTag(opportunityId, tag, "add");
    });
  }

  function removeTag(tag: string) {
    startTransition(() => {
      setOpportunityTag(opportunityId, tag, "remove");
    });
  }

  function toggleInterest(mark: Exclude<OpportunityInterestMarker, null>) {
    startTransition(() => {
      setOpportunityInterest(opportunityId, interest === mark ? null : mark);
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
