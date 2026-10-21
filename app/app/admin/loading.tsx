import { AppShell } from "../_components/AppShell";
import { StatCardSkeleton, TableRowsSkeleton } from "@/components/tt/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * /admin's loading state - shaped like the real page (AdminNav, the CV/doc
 * stats row, system alerts, then harness results) rather than a generic
 * spinner, same convention as dashboard/pipeline/discovery's own
 * loading.tsx. Every /admin/* sub-route gets its own matching loading.tsx
 * alongside it (AdminNav + that page's own body shape).
 */
export default function AdminLoading() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1000px] p-4 sm:p-6 md:px-8 md:py-6">
        <Skeleton className="mb-3 h-5 w-full max-w-md" />

        <div className="mb-9">
          <Skeleton className="mb-1 h-6 w-56" />
          <Skeleton className="mb-4 h-4 w-full max-w-lg" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
        </div>

        <div className="mb-9">
          <Skeleton className="mb-1 h-6 w-40" />
          <Skeleton className="mb-4 h-4 w-full max-w-lg" />
          <TableRowsSkeleton rows={3} columns={4} />
        </div>

        <div>
          <Skeleton className="mb-1 h-6 w-56" />
          <Skeleton className="mb-4 h-4 w-full max-w-lg" />
          <TableRowsSkeleton rows={4} columns={4} />
        </div>
      </div>
    </AppShell>
  );
}
