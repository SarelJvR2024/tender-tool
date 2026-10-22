import { AuthShell } from "../../_components/AuthShell";
import { Skeleton } from "@/components/ui/skeleton";

const cardClass = "box-border w-[380px] max-w-full rounded-xl border border-border bg-card px-9 py-10 text-center font-sans";

/**
 * Invite page's loading state while the invite preview loads, matching the
 * real page's own card shape, per app/AGENTS.md's loading-skeleton
 * convention.
 */
export default function InviteLoading() {
  return (
    <AuthShell>
      <div className={cardClass}>
        <Skeleton className="mx-auto mb-3 h-6 w-48" />
        <Skeleton className="mx-auto mb-2 h-4 w-64" />
        <Skeleton className="mx-auto mb-6 h-4 w-56" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    </AuthShell>
  );
}
