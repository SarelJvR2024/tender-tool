import { AppShellSkeleton } from "../../_components/AppShellSkeleton";
import { TableRowsSkeleton } from "@/components/tt/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminNotificationsLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6 md:px-8 md:py-6">
        <Skeleton className="mb-3 h-5 w-full max-w-md" />
        <Skeleton className="mb-1 h-6 w-48" />
        <Skeleton className="mb-4 h-4 w-full max-w-lg" />
        <TableRowsSkeleton rows={8} columns={6} />
      </div>
    </AppShellSkeleton>
  );
}
