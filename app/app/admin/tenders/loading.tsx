import { AppShellSkeleton } from "../../_components/AppShellSkeleton";
import { TableRowsSkeleton } from "@/components/tt/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Tender Catalog's loading state - this route (platform_admin_tender_catalog
 * RPC + the discipline taxonomy load, both real per-request reads) never
 * got a loading.tsx when it shipped, the one admin sub-route the 2026-10-21
 * loading-skeleton audit's own named scope (customers/settings/taxonomy/
 * discovered-opportunities/requirement-extractions) didn't yet cover - this
 * tab was added after that pass. Same convention as the sibling admin
 * sub-routes: a static skeleton shaped like the real page (intro text,
 * summary line, filter row, then the catalog table).
 */
export default function AdminTendersLoading() {
  return (
    <AppShellSkeleton>
      <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6 md:px-8 md:py-6">
        <Skeleton className="mb-3 h-5 w-full max-w-md" />
        <Skeleton className="mb-1 h-6 w-40" />
        <Skeleton className="mb-2.5 h-4 w-full max-w-xl" />
        <Skeleton className="mb-4 h-3.5 w-72" />
        <div className="mb-3 flex flex-wrap gap-2">
          <Skeleton className="h-11 w-40 rounded-lg" />
          <Skeleton className="h-11 w-40 rounded-lg" />
          <Skeleton className="h-11 w-40 rounded-lg" />
        </div>
        <TableRowsSkeleton rows={8} columns={6} />
      </div>
    </AppShellSkeleton>
  );
}
