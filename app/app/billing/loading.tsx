import { AppShellSkeleton } from "../_components/AppShellSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCardSkeleton } from "@/components/tt/skeletons";

/**
 * Billing page's loading state - shaped like the real page (header, the
 * subscription status banner, then the 4 pricing-tier cards), per
 * app/AGENTS.md's loading-skeleton convention.
 */
export default function BillingLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6">
        <div className="mb-5 space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="mb-5 h-16 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SectionCardSkeleton key={i} lines={3} />
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}
