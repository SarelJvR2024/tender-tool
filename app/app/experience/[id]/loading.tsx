import { AppShellSkeleton } from "../../_components/AppShellSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCardSkeleton } from "@/components/tt/skeletons";

/**
 * Experience detail's loading state - shaped like the real page (back
 * link, title, the long tagging form, then the delete action), per
 * app/AGENTS.md's loading-skeleton convention.
 */
export default function ExperienceDetailLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[760px] flex-1 px-4 py-6">
        <Skeleton className="mb-3 h-4 w-40" />
        <Skeleton className="mb-1 h-6 w-64" />
        <Skeleton className="mb-4 h-4 w-80" />
        <SectionCardSkeleton lines={8} className="mb-4" />
        <SectionCardSkeleton lines={3} />
      </div>
    </AppShellSkeleton>
  );
}
