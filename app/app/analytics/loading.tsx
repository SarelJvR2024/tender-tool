import { AppShellSkeleton } from "../_components/AppShellSkeleton";
import { StatCardSkeleton, SectionCardSkeleton } from "@/components/tt/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Analytics' loading state - this route never got a loading.tsx when it
 * shipped, even though it does several real per-request Supabase reads
 * (including a paginated fetchAllRows() over the shared `tenders` table),
 * unlike every sibling screen with a heavier read (dashboard, pipeline,
 * discovery). Shaped like the real page (header, the 4-stat strip, then the
 * chart/breakdown section cards), per app/AGENTS.md's loading-skeleton
 * convention.
 */
export default function AnalyticsLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6 md:px-8 md:py-6">
        <Skeleton className="mb-1 h-6 w-32" />
        <Skeleton className="mb-4 h-4 w-full max-w-xl" />

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SectionCardSkeleton lines={3} />
          <SectionCardSkeleton lines={3} />
          <SectionCardSkeleton lines={3} />
          <SectionCardSkeleton lines={3} />
        </div>
      </div>
    </AppShellSkeleton>
  );
}
