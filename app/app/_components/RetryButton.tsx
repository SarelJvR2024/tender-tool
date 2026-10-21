"use client";

import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Generic "try again" action for an ErrorState - re-runs the failed server
 * component without a full page reload (same `router.refresh()` pattern the
 * root error boundary's own `retry()` relies on under the hood).
 */
export function RetryButton({ label = "Retry" }: { label?: string }) {
  const router = useRouter();
  return (
    <Button variant="outline" size="sm" className="min-h-11 md:min-h-9" onClick={() => router.refresh()}>
      <RotateCw className="size-4" aria-hidden />
      {label}
    </Button>
  );
}
