"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type WorkspaceTab = {
  id: string;
  label: string;
  /** Other element ids rendered inside this tab's content that a JumpLink
   * might deep-link to directly (e.g. "general-pack-review" inside the
   * "Pack" tab) - so switching tabs via hash still finds the right one. */
  anchors?: string[];
  badge?: React.ReactNode;
  content: React.ReactNode;
};

/**
 * Tabs for GeneralTenderWorkspace's secondary sections (Documents/Questions/
 * People/Pack) - Sarel's own live feedback: "see if you can streamline the
 * page and move to different tabs, it is a very long list." Deliberately
 * scoped to ONLY these four: the Disqualification guard and the Submission
 * plan (page.tsx) and this workspace's own "What this tender needs" section
 * are mounted above/outside this component entirely, so no blocker ever
 * ends up hidden in a tab (spec v3 §16.E: "Do not bury blockers in a hidden
 * tab").
 *
 * Content for every tab is always rendered (no extra fetch per tab - all of
 * it was already being fetched unconditionally before this existed); only
 * which one is VISIBLE changes, via the `hidden` attribute rather than
 * unmounting, so a JumpLink's href="#general-documents" style in-page
 * anchor still finds a real element in the DOM. Since `hidden` elements
 * can't be scrolled to, this listens for the hash changing (a JumpLink
 * click, or the page loading with a hash already in the URL) and switches
 * tabs itself before re-doing the scroll the browser couldn't do while it
 * was hidden.
 */
export function WorkspaceTabs({ tabs }: { tabs: WorkspaceTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  useEffect(() => {
    function syncFromHash() {
      const hash = window.location.hash.replace("#", "");
      if (!hash) return;
      const match = tabs.find((t) => t.id === hash || t.anchors?.includes(hash));
      if (match) {
        setActive(match.id);
        requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
      }
    }
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div role="tablist" className="mb-3 flex gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
              active === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.badge}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} hidden={active !== t.id}>
          {t.content}
        </div>
      ))}
    </div>
  );
}

export function TabBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold text-warning">
      {count}
    </span>
  );
}
