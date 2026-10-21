import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The Product promise's Verify/Provide/Fix pill (app/AGENTS.md), used
 * wherever a tender-workspace screen shows a `BidTaskStatus`
 * (app/tenders/[id]/bid-task-status.ts) - kept here, not re-declared per
 * file, as the tender workspace's inline-CSSProperties screens migrate to
 * Tailwind/tokens one at a time. The type is a plain string union (not
 * imported from bid-task-status.ts) so this shared component doesn't take
 * a dependency on one route's own logic file.
 *
 * A 4th, non-BidTaskStatus state - `not_tracked` - covers a check this app
 * genuinely has no data for yet (e.g. the Disqualification guard's "not
 * tracked yet" rows) - visibly distinct (neutral grey) from a real
 * Clear/Fix/Provide verdict, never silently omitted.
 */
export type BidTaskBadgeStatus = "fix" | "provide" | "verify" | "not_tracked";

const LABEL: Record<BidTaskBadgeStatus, string> = {
  fix: "Fix",
  provide: "Provide",
  verify: "Verify",
  not_tracked: "Not tracked yet",
};

const bidTaskBadgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      status: {
        fix: "border-destructive/20 bg-destructive/10 text-destructive",
        provide: "border-warning/20 bg-warning/10 text-warning",
        verify: "border-success/20 bg-success/10 text-success",
        not_tracked: "border-muted-foreground/20 bg-muted text-muted-foreground",
      } satisfies Record<BidTaskBadgeStatus, string>,
    },
  },
);

export function BidTaskBadge({
  status,
  children,
  className,
}: { status: BidTaskBadgeStatus; children?: React.ReactNode; className?: string } & VariantProps<typeof bidTaskBadgeVariants>) {
  return <span className={cn(bidTaskBadgeVariants({ status }), className)}>{children ?? LABEL[status]}</span>;
}
