import { AppShell } from "../_components/AppShell";
import { StatCardSkeleton } from "@/components/tt/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Bids pipeline's loading state - header, the 4-stat strip, and a row of
 * column-shaped placeholders standing in for the board, per app/AGENTS.md's
 * loading-skeleton convention.
 */
export default function PipelineLoading() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
        <div className="mb-1 flex items-center justify-between gap-3">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="mb-4 h-4 w-80" />

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>

        <Skeleton className="mb-3 h-9 w-40" />

        <div className="flex flex-col gap-3 lg:flex-row">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-2.5 lg:min-w-[220px] lg:flex-1">
              <Skeleton className="mb-3 h-5 w-24" />
              <Skeleton className="h-20 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
