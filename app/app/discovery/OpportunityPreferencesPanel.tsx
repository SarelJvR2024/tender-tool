"use client";

import { useSyncExternalStore } from "react";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getPreferencesServerSnapshot,
  getPreferencesSnapshot,
  setDisciplinesPreview,
  setHideSanralPreview,
  subscribe,
  toggleDiscipline,
} from "@/lib/opportunityPreferencesPreview";
import { taxonomyGroups, type DisciplineTaxonomy } from "@/lib/disciplineTaxonomy";

/**
 * PREVIEW of Sarel's own live feedback, this session (2026-10-23): "in the
 * opportunities page we need to add options to set the opportunity
 * preferences for a company" + the SANRAL case ("this shouldnt be tehere if
 * the company is not interested in sanral projects"). Not the real feature -
 * see lib/opportunityPreferencesPreview.ts's own header comment for why
 * (needs a new company-level table/columns, proposed in this PR's
 * description and app/AGENTS.md, not applied here).
 *
 * A standalone client island mounted next to the existing filter-tab bar
 * (page.tsx only gained a few lines to render this - the tab bar itself is
 * untouched), same reasoning as PR #121's OpportunityQuickActions: nothing
 * server-side to pass in yet, so this reads its own mock state straight from
 * the browser via useSyncExternalStore.
 *
 * Collapsed by default (a <details> element, not JS state) so a company that
 * never opens it sees no change at all to the page they already know.
 */
export function OpportunityPreferencesPanel({ taxonomy }: { taxonomy: DisciplineTaxonomy }) {
  const prefs = useSyncExternalStore(subscribe, getPreferencesSnapshot, getPreferencesServerSnapshot);
  const groups = taxonomyGroups(taxonomy);

  return (
    <details className="mb-5 rounded-lg border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground">
        <Settings2 className="size-4 text-muted-foreground" />
        Opportunity preferences
        <span
          title="Preview only - nothing here is saved to your company profile yet. A real, saved version of this needs a small database change, which is proposed separately for Sarel's own review before anyone builds it for real."
          className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
        >
          Preview - not yet saved
        </span>
      </summary>

      <div className="border-t border-border px-4 py-3.5">
        <p className="mb-3 text-xs text-muted-foreground">
          Tell us which buyers and disciplines your company actually does work in. This is a working preview so you can
          react to it before anyone builds the real saved version - every choice below lives only in this browser
          (your device&apos;s local storage), not your company&apos;s account, and reloading on another device or
          clearing your browser data loses it. Nothing here changes what you or your team are shown today.
        </p>

        <label className="mb-4 flex min-h-11 items-center gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={prefs.hideSanral}
            onChange={(e) => setHideSanralPreview(e.target.checked)}
            className="size-4 accent-accent"
          />
          Don&apos;t show me SANRAL / road-construction tenders - my company doesn&apos;t do that work
        </label>

        <div className="mb-1 text-xs font-semibold text-foreground">Disciplines we care about</div>
        <p className="mb-2 text-[11px] text-muted-foreground">
          The same discipline list your Experience Library already uses (so a tag you pick here would mean the same
          thing there, if this gets built for real).
        </p>
        <div className="flex flex-col gap-2.5">
          {groups.map(({ group, children }) => (
            <div key={group.slug}>
              <div className="mb-1 text-[11px] font-bold text-muted-foreground">{group.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {[group, ...children].map((c) => {
                  const active = prefs.disciplines.includes(c.slug);
                  return (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() => setDisciplinesPreview(toggleDiscipline(prefs.disciplines, c.slug))}
                      className={cn(
                        "min-h-8 rounded-full border px-2.5 text-[11px] font-semibold",
                        active ? "border-accent bg-accent/10 text-accent" : "border-border bg-card text-muted-foreground",
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
