import { Eye, FileText, Hand, Info, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionType } from "./submission-plan-logic";

/**
 * Renders a submission-plan step's ActionType (submission-plan-logic.ts) -
 * a square-cornered, outlined tag, deliberately a different SHAPE from
 * BidTaskBadge's rounded pill (components/tt/bid-task-badge.tsx) so the two
 * tags read as two different kinds of information at a glance: status
 * (color, pill) vs. what-kind-of-work (icon + outline), never one badge
 * doing double duty.
 */
const ACTION_TYPE_META: Record<ActionType, { label: string; icon: typeof Info }> = {
  physical: { label: "Physical action", icon: Hand },
  decision: { label: "Decision", icon: UserCheck },
  document: { label: "Document", icon: FileText },
  info: { label: "Info", icon: Info },
  review: { label: "Review", icon: Eye },
};

export function ActionTypeTag({ type, className }: { type: ActionType; className?: string }) {
  const meta = ACTION_TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}
