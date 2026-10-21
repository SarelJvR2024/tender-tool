import { AppShell } from "../_components/AppShell";
import { TableRowsSkeleton } from "@/components/tt/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * SANRAL schedules' loading state - shaped like the real page (header, the
 * promo strip, the 3-step explainer, then the tender list) rather than a
 * generic spinner, same convention as dashboard/pipeline/discovery's own
 * loading.tsx.
 */
export default function SanralSchedulesLoading() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 sm:p-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>

        <Skeleton className="h-[72px] w-full rounded-xl" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>

        <TableRowsSkeleton rows={3} columns={3} />
      </div>
    </AppShell>
  );
}
