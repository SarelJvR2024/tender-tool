import { AppShellSkeleton } from "../../_components/AppShellSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCardSkeleton } from "@/components/tt/skeletons";

/**
 * Bulk CV upload's loading state - this route reads the signed-in company's
 * own roster (`people`) per request and never got a loading.tsx when it
 * shipped (app/AGENTS.md's "Bulk upload" entry doesn't mention one) - every
 * sibling People-cluster route (`/people`, `/people/[id]`) already has one.
 * Same convention: a static skeleton shaped like the real page (header,
 * then the drop-zone/person-picker card).
 */
export default function BulkCvUploadLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[760px] flex-1 px-4 py-6">
        <div className="mb-4 space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-4 w-4/5 max-w-md" />
        </div>
        <SectionCardSkeleton lines={4} />
      </div>
    </AppShellSkeleton>
  );
}
