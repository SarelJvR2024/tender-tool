import { AppShellSkeleton } from "../_components/AppShellSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function ToolkitLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 sm:p-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[88px] w-full rounded-xl" />
          <Skeleton className="h-[88px] w-full rounded-xl" />
          <Skeleton className="h-[88px] w-full rounded-xl" />
          <Skeleton className="h-[88px] w-full rounded-xl" />
        </div>
      </div>
    </AppShellSkeleton>
  );
}
