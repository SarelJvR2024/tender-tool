"use client";

import { useState, useTransition } from "react";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { setOpportunityPreferences } from "./preferencesActions";
import { taxonomyGroups, type DisciplineTaxonomy } from "@/lib/disciplineTaxonomy";

/** Pure: on/off toggle for a slug in a discipline list, used by the panel's chip handler. */
function toggleDiscipline(current: string[], slug: string): string[] {
  return current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
}

/**
 * Sarel's own live feedback, this session (2026-10-23): "in the
 * opportunities page we need to add options to set the opportunity
 * preferences for a company" + the SANRAL case ("this shouldnt be tehere if
 * the company is not interested in sanral projects"). Now the REAL, saved
 * version: Sarel reviewed and signed off on the `company_tender_preferences`
 * schema (migration 0087) this was originally only proposed against - see
 * app/AGENTS.md's dated entries for the full history (preview -> schema
 * review -> this).
 *
 * A standalone client island mounted next to the existing filter-tab bar
 * (page.tsx only gained a few lines to render this - the tab bar itself is
 * untouched), same reasoning as PR #121's OpportunityQuickActions. Prefilled
 * from the row discovery/page.tsx already read server-side
 * (`initialHideSanral`/`initialDisciplines`); every change is saved for real
 * via `setOpportunityPreferences()` (preferencesActions.ts), the same
 * direct-invoke-inside-useTransition shape as task-status-button.tsx's
 * `advanceTaskStatus` - no form, no page reload. Optimistic local state
 * updates immediately; a failed save reverts and shows the same error text
 * every other mutating action in this app uses.
 *
 * Collapsed by default (a <details> element, not JS state) so a company that
 * never opens it sees no change at all to the page they already know.
 */
export function OpportunityPreferencesPanel({
  taxonomy,
  initialHideSanral,
  initialDisciplines,
}: {
  taxonomy: DisciplineTaxonomy;
  initialHideSanral: boolean;
  initialDisciplines: string[];
}) {
  const [hideSanral, setHideSanral] = useState(initialHideSanral);
  const [disciplines, setDisciplines] = useState(initialDisciplines);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const groups = taxonomyGroups(taxonomy);

  function save(nextHideSanral: boolean, nextDisciplines: string[]) {
    const prevHideSanral = hideSanral;
    const prevDisciplines = disciplines;
    setHideSanral(nextHideSanral);
    setDisciplines(nextDisciplines);
    setError(null);
    startTransition(async () => {
      const result = await setOpportunityPreferences(nextHideSanral, nextDisciplines);
      if (!result.ok) {
        // Revert the optimistic update - a save that didn't actually land
        // should never leave the UI claiming otherwise.
        setHideSanral(prevHideSanral);
        setDisciplines(prevDisciplines);
        setError(result.error);
      }
    });
  }

  return (
    <details className="mb-5 rounded-lg border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground">
        <Settings2 className="size-4 text-muted-foreground" />
        Opportunity preferences
        {isPending && (
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Saving…</span>
        )}
      </summary>

      <div className="border-t border-border px-4 py-3.5">
        <p className="mb-3 text-xs text-muted-foreground">
          Tell us which buyers and disciplines your company actually does work in - saved to your company&apos;s account,
          so everyone on your team sees the same choices here and on the Bids board.
        </p>

        {error && (
          <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <label className="mb-4 flex min-h-11 items-center gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={hideSanral}
            onChange={(e) => save(e.target.checked, disciplines)}
            className="size-4 accent-accent"
          />
          Don&apos;t show me SANRAL / road-construction tenders - my company doesn&apos;t do that work
        </label>

        <div className="mb-1 text-xs font-semibold text-foreground">Disciplines we care about</div>
        <p className="mb-2 text-[11px] text-muted-foreground">
          The same discipline list your Experience Library already uses - picking one here means the same thing
          there. Leave all of these unselected if you don&apos;t want Discovery to prioritize by discipline yet.
        </p>
        <div className="flex flex-col gap-2.5">
          {groups.map(({ group, children }) => (
            <div key={group.slug}>
              <div className="mb-1 text-[11px] font-bold text-muted-foreground">{group.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {[group, ...children].map((c) => {
                  const active = disciplines.includes(c.slug);
                  return (
                    <button
                      key={c.slug}
                      type="button"
                      disabled={isPending}
                      onClick={() => save(hideSanral, toggleDiscipline(disciplines, c.slug))}
                      className={cn(
                        "min-h-8 rounded-full border px-2.5 text-[11px] font-semibold",
                        active ? "border-accent bg-accent/10 text-accent" : "border-border bg-card text-muted-foreground",
                        isPending && "opacity-60",
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
