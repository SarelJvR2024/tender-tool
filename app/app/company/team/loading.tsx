import { AppShellSkeleton } from "../../_components/AppShellSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { TableRowsSkeleton } from "@/components/tt/skeletons";

/**
 * Team page's loading state - shaped like the real page (header, then the
 * member list table and the invite form), per app/AGENTS.md's
 * loading-skeleton convention.
 */
export default function TeamLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6">
        <div className="mb-4 space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <TableRowsSkeleton rows={4} columns={4} className="mb-5" />
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-11 w-full max-w-[420px] rounded-lg" />
      </div>
    </AppShellSkeleton>
  );
}
