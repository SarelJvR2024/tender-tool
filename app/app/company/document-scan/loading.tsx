import { AppShell } from "../../_components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCardSkeleton } from "@/components/tt/skeletons";

/** Bulk document scan's loading state, per app/AGENTS.md's loading-skeleton convention. */
export default function DocumentScanLoading() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[900px] flex-1 px-4 py-5">
        <Skeleton className="mb-2 h-4 w-32" />
        <Skeleton className="mb-2 h-6 w-56" />
        <Skeleton className="mb-4 h-4 w-96" />
        <SectionCardSkeleton lines={2} className="mb-3.5" />
        <SectionCardSkeleton lines={5} />
      </div>
    </AppShell>
  );
}
