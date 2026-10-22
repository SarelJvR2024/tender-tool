import { AppShellSkeleton } from "../../_components/AppShellSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCardSkeleton } from "@/components/tt/skeletons";

/**
 * Person detail's loading state - shaped like the real page (title, jump
 * nav, the edit-form card, then a couple more section cards), per
 * app/AGENTS.md's loading-skeleton convention.
 */
export default function PersonDetailLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[760px] flex-1 px-4 py-6">
        <Skeleton className="mb-2 h-6 w-48" />
        <Skeleton className="mb-4 h-4 w-80" />
        <div className="mb-4 flex gap-1.5">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
        </div>
        <SectionCardSkeleton lines={5} className="mb-5" />
        <SectionCardSkeleton lines={3} className="mb-5" />
        <SectionCardSkeleton lines={3} />
      </div>
    </AppShellSkeleton>
  );
}
