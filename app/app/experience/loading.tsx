import { AppShell } from "../_components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCardSkeleton } from "@/components/tt/skeletons";

/**
 * Experience list's loading state - shaped like the real page (header, the
 * readiness summary card, the capture form, then a list of experience
 * rows), per app/AGENTS.md's loading-skeleton convention.
 */
export default function ExperienceLoading() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6">
        <Skeleton className="mb-2 h-6 w-48" />
        <Skeleton className="mb-4 h-4 w-96" />
        <SectionCardSkeleton lines={2} className="mb-4" />
        <SectionCardSkeleton lines={3} className="mb-4" />
        <div className="mb-3 flex gap-1.5">
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <SectionCardSkeleton key={i} lines={2} className="mb-2.5" />
        ))}
      </div>
    </AppShell>
  );
}
