import { AppShellSkeleton } from "../../_components/AppShellSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function ToolkitToolLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 sm:p-6">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-[320px] w-full max-w-[640px] rounded-xl" />
      </div>
    </AppShellSkeleton>
  );
}
