import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

/** A paragraph of placeholder lines, the last one shorter. */
export function TextSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/5" : "w-full")} />
      ))}
    </div>
  );
}

/** Placeholder for a StatCard - label, big value, no trend. */
export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("gap-3 px-5 py-4", className)}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-16" />
    </Card>
  );
}

/** Placeholder for a titled SectionCard with a few body lines. */
export function SectionCardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <Card className={cn("gap-4 px-5 py-4", className)}>
      <Skeleton className="h-4 w-32" />
      <TextSkeleton lines={lines} />
    </Card>
  );
}

/** Placeholder rows for a DataTable while its data is still loading. */
export function TableRowsSkeleton({ rows = 4, columns = 4, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={cn("flex items-center gap-4 px-4 py-3", r > 0 && "border-t border-border")}>
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-1/3" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}
