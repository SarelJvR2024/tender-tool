import { AppShell } from "../../_components/AppShell";
import { SectionCardSkeleton } from "@/components/tt/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminTaxonomyLoading() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1000px] px-4 pt-6 pb-10 sm:px-6 md:px-8">
        <Skeleton className="mb-3 h-5 w-full max-w-md" />
        <Skeleton className="mb-1 h-6 w-40" />
        <Skeleton className="mb-4 h-4 w-full max-w-lg" />
        <div className="space-y-4">
          <SectionCardSkeleton lines={3} />
          <SectionCardSkeleton lines={4} />
          <SectionCardSkeleton lines={5} />
        </div>
      </div>
    </AppShell>
  );
}
