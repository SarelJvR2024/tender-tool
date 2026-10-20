import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export type TenderStatus = "draft" | "needs-docs" | "in-progress" | "ready" | "submitted" | "won" | "lost" | "expired";

const STATUS_LABEL: Record<TenderStatus, string> = {
  draft: "Draft",
  "needs-docs": "Needs documents",
  "in-progress": "In progress",
  ready: "Ready",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
  expired: "Expired",
};

/**
 * The one status pill every tender-shaped list/card needs. A soft tonal
 * fill (10% tint background, full-strength text, 20% tint border) rather
 * than a solid badge, in every variant including the two outcome states -
 * confident without shouting. `expired` is visually distinct from `draft`
 * (dashed border) even though both are neutral-muted: one is "hasn't
 * started", the other is "this status itself has lapsed".
 */
const statusBadgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      status: {
        draft: "border-muted-foreground/20 bg-muted text-muted-foreground",
        "needs-docs": "border-warning/20 bg-warning/10 text-warning",
        "in-progress": "border-info/20 bg-info/10 text-info",
        ready: "border-success/20 bg-success/10 text-success",
        submitted: "border-accent/30 bg-accent/10 text-accent",
        won: "border-success/30 bg-success/15 text-success",
        lost: "border-destructive/20 bg-destructive/10 text-destructive",
        expired: "border-dashed border-muted-foreground/30 bg-transparent text-muted-foreground",
      } satisfies Record<TenderStatus, string>,
    },
  },
);

export function StatusBadge({
  status,
  children,
  className,
}: { status: TenderStatus; children?: React.ReactNode; className?: string } & VariantProps<typeof statusBadgeVariants>) {
  return <span className={cn(statusBadgeVariants({ status }), className)}>{children ?? STATUS_LABEL[status]}</span>;
}
