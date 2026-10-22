import { AppShellSkeleton } from "../../_components/AppShellSkeleton";
import { TableRowsSkeleton } from "@/components/tt/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Pricing history's loading state - header, the filter bar, and two
 * table-shaped placeholders, per app/AGENTS.md's loading-skeleton convention.
 */
export default function PricingHistoryLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="mt-2 mb-1 h-7 w-56" />
        <Skeleton className="mb-4 h-4 w-96" />

        <Skeleton className="mb-4 h-16 w-full rounded-lg" />

        <Skeleton className="mb-2 h-5 w-32" />
        <TableRowsSkeleton rows={3} columns={5} />

        <Skeleton className="mt-5 mb-2 h-5 w-32" />
        <TableRowsSkeleton rows={4} columns={6} />
      </div>
    </AppShellSkeleton>
  );
}
