import { AppShell } from "../_components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCardSkeleton } from "@/components/tt/skeletons";

/**
 * My CV page's loading state - shaped like the real page (header, the
 * details form card, then the CV-upload/CV-compare card), per
 * app/AGENTS.md's loading-skeleton convention.
 */
export default function MyCvLoading() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[720px] flex-1 px-4 py-6">
        <div className="mb-4 space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <SectionCardSkeleton lines={4} className="mb-3.5" />
        <SectionCardSkeleton lines={3} />
      </div>
    </AppShell>
  );
}
