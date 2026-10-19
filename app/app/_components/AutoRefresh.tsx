"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * While some background job is still running, re-fetch the current page
 * every 15s so the server-rendered state (status, results, counts) catches
 * up without a manual reload. Renders nothing; stops once nothing is active.
 */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
