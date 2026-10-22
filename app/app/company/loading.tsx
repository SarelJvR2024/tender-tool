import { AppShellSkeleton } from "../_components/AppShellSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCardSkeleton } from "@/components/tt/skeletons";

/**
 * Company vault's loading state - shaped like the real page (header, the
 * sub-nav, then a few stacked section cards for the profile/documents/
 * offices/notifications blocks), per app/AGENTS.md's loading-skeleton
 * convention.
 */
export default function CompanyLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6">
        <div className="mb-4 space-y-2">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="mb-4 flex gap-1.5">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <SectionCardSkeleton lines={3} className="mb-3.5" />
        <SectionCardSkeleton lines={3} className="mb-3.5" />
        <SectionCardSkeleton lines={2} />
      </div>
    </AppShellSkeleton>
  );
}
