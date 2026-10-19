"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// This page is a server component, so it has no way to re-fetch itself on
// a timer. While documents are still being read/classified in the
// background, this polls by calling router.refresh() every 15s, which
// re-runs the page's server-side data fetch and re-renders with whatever
// has finished - no manual refresh needed. Renders nothing; stops polling
// entirely once nothing is left queued (including right away, if nothing
// was queued to begin with).
export function QueuePoller({ queuedCount }: { queuedCount: number }) {
  const router = useRouter();

  useEffect(() => {
    if (queuedCount <= 0) return;
    const id = setInterval(() => {
      router.refresh();
    }, 15000);
    return () => clearInterval(id);
  }, [queuedCount, router]);

  return null;
}
