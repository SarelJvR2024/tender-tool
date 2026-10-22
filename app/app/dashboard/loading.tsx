import { AppShellSkeleton } from "../_components/AppShellSkeleton";
import { StatCardSkeleton, SectionCardSkeleton, TableRowsSkeleton } from "@/components/tt/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Home cockpit's loading state - shaped like the real page (header, the
 * readiness/next-action row, the stat strip, then two bounded lists), not a
 * generic spinner, per app/AGENTS.md's loading-skeleton convention.
 */
export default function DashboardLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-8 py-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-10 w-48" />
        </div>

        <div className="mb-5 grid gap-3 lg:grid-cols-2">
          <SectionCardSkeleton lines={2} />
          <SectionCardSkeleton lines={2} />
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>

        <div className="mb-5">
          <Skeleton className="mb-2 h-5 w-32" />
          <TableRowsSkeleton rows={3} columns={3} />
        </div>

        <div>
          <Skeleton className="mb-2 h-5 w-52" />
          <TableRowsSkeleton rows={3} columns={3} />
        </div>
      </div>
    </AppShellSkeleton>
  );
}
