"use client";

import { useState } from "react";
import { Info, X } from "lucide-react";

/**
 * Shown app-wide (mounted in AppShell) only while viewing the one seeded
 * demo/trial company (lib/demoCompany.ts) - so a prospect browsing the demo
 * never mistakes its sample data for a real company's own vault. The close
 * button only hides it for the rest of this browser session (plain local
 * state, no persistence) - presentation only, per the demo-company spec;
 * it comes back on the next page load, same as every other unmigrated
 * "dismiss" affordance in this app that isn't wired to real storage.
 */
export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="flex items-start gap-3 border-b border-info/20 bg-info/10 px-4 py-2.5 text-sm text-info sm:items-center sm:px-6">
      <Info className="mt-0.5 size-4 shrink-0 sm:mt-0" aria-hidden />
      <p className="flex-1 leading-snug">
        <span className="font-semibold">Demo company.</span> You&apos;re viewing a demo company with sample
        data &mdash; your own tenders will look like this once you add real ones.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-1 text-info/70 transition-colors hover:bg-info/15 hover:text-info"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
