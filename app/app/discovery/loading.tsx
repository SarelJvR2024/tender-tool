import { AppShell } from "../_components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Opportunities' loading state - header, the filter-chip row, and a few
 * card-shaped placeholders, per app/AGENTS.md's loading-skeleton convention.
 */
export default function DiscoveryLoading() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-80 space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
          <Skeleton className="h-11 w-56" />
        </div>

        <div className="mb-5 flex gap-2">
          <Skeleton className="h-11 w-20 rounded-full" />
          <Skeleton className="h-11 w-28 rounded-full" />
          <Skeleton className="h-11 w-32 rounded-full" />
          <Skeleton className="h-11 w-24 rounded-full" />
        </div>

        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4.5">
              <Skeleton className="mb-2 h-4 w-40" />
              <Skeleton className="mb-2 h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
