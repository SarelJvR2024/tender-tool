"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ScrollFade } from "../../_components/ScrollFade";

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
 * The Tender Workspace's own top-level tabs (page.tsx), and formerly
 * GeneralTenderWorkspace's own secondary sections too (that nested use was
 * removed in the Phase 2 retab - everything is one set of top-level tabs
 * now). `header`, when passed, renders above the tab bar inside the same
 * sticky container (page.tsx's condensed title/status/countdown recap,
 * Sarel's own follow-up brief: "Keep the contract title, closing badge, and
 * status header sticky at the top above the tabs").
 *
 * Content for every tab is always rendered (no extra fetch per tab - all of
 * it was already being fetched unconditionally before this existed); only
 * which one is VISIBLE changes, via the `hidden` attribute rather than
 * unmounting, so a deep link's href="#general-documents" style in-page
 * anchor still finds a real element in the DOM. Since `hidden` elements
 * can't be scrolled to, this listens for the hash changing (an anchor
 * click, or the page loading with a hash already in the URL) and switches
 * tabs itself before re-doing the scroll the browser couldn't do while it
 * was hidden.
 */
export function WorkspaceTabs({
  tabs,
  sticky = false,
  header,
}: {
  tabs: WorkspaceTab[];
  sticky?: boolean;
  header?: React.ReactNode;
}) {
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

  const tabBar = (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-1">
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
  );

  return (
    <div>
      {sticky ? (
        // The page's own top-level tabs (page.tsx, Phase 2 retab): sticky so
        // the tab bar - this workspace's primary navigation now - stays
        // reachable while scrolling a long tab's content, same idea the old
        // flat jump-nav row used to serve. Not used for a nested
        // WorkspaceTabs (none currently exist) - stacking two sticky bars
        // would cover more of the viewport than it's worth.
        <div className="sticky top-0 z-[5] mb-3 bg-background py-1.5">
          {header}
          <div className="relative">
            {tabBar}
            <ScrollFade fadeColor="255, 255, 255" minWidthToHide={99999} hint={false} />
          </div>
        </div>
      ) : (
        <div className="mb-3">{tabBar}</div>
      )}
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
