import { AppShellSkeleton } from "../../_components/AppShellSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCardSkeleton } from "@/components/tt/skeletons";

/**
 * "Load a tender by hand" form's loading state while the company row that
 * gates/prefills the form loads, per app/AGENTS.md's loading-skeleton
 * convention.
 */
export default function TendersNewLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[640px] flex-1 px-4 py-6">
        <div className="mb-4 space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <SectionCardSkeleton lines={5} />
      </div>
    </AppShellSkeleton>
  );
}
