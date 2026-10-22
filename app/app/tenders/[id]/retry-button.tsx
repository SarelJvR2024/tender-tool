"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * A real retry, not a "try refreshing" hint: router.refresh() re-runs this
 * page's Server Components against fresh data without a full page reload (so
 * scroll position, open <details>, etc. survive) - used by ErrorBanner and by
 * each of the 4 new section-level try/catch fallbacks in page.tsx. 44px
 * minimum touch target (this screen's own convention) even though the visual
 * chip looks small - padding, not a smaller box, does the work.
 */
export function RetryButton({ label = "Retry" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      className={`min-h-11 min-w-11 rounded-md border border-current bg-transparent px-3.5 text-xs font-semibold text-inherit ${pending ? "cursor-default" : "cursor-pointer"}`}
    >
      {pending ? "Retrying…" : label}
    </button>
  );
}
