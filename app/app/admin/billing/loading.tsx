import { AppShellSkeleton } from "../../_components/AppShellSkeleton";
import { TableRowsSkeleton } from "@/components/tt/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminBillingLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[1150px] p-4 sm:p-6 md:px-8 md:py-6">
        <Skeleton className="mb-3 h-5 w-full max-w-md" />
        <Skeleton className="mb-1 h-6 w-32" />
        <Skeleton className="mb-4 h-4 w-full max-w-xl" />
        <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
        <TableRowsSkeleton rows={6} columns={7} />
      </div>
    </AppShellSkeleton>
  );
}
