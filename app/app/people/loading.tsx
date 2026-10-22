import { AppShellSkeleton } from "../_components/AppShellSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCardSkeleton } from "@/components/tt/skeletons";

/**
 * People list's loading state - shaped like the real page (header, the
 * registration-health chip row, then a 2-column grid of person cards), per
 * app/AGENTS.md's loading-skeleton convention (same shape as dashboard's).
 */
export default function PeopleLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-52" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-11 w-36" />
        </div>
        <div className="mb-3.5 flex gap-1.5">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-6 w-36 rounded-full" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SectionCardSkeleton key={i} lines={2} />
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}
