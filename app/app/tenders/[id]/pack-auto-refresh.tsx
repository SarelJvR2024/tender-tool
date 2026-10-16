"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * While a submission pack is requested/generating, re-fetch the page every
 * 15 s so the status moves to ready (with its download link) or failed
 * without a manual reload. Renders nothing; stops once nothing is active.
 */
export function PackAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
