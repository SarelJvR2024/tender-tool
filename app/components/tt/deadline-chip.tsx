import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type Band = "far" | "soon" | "urgent" | "past";

// Exported so anything else that needs the same "how urgent is this
// deadline" read (e.g. lib/tenderTimeline.ts) uses the identical bands
// rather than a second copy that could silently drift from this chip's own.
export function bandFor(daysLeft: number): Band {
  if (daysLeft < 0) return "past";
  if (daysLeft < 7) return "urgent";
  if (daysLeft <= 14) return "soon";
  return "far";
}

const BAND_STYLE: Record<Band, string> = {
  far: "border-border bg-muted text-muted-foreground",
  soon: "border-warning/20 bg-warning/10 text-warning",
  urgent: "border-destructive/20 bg-destructive/10 text-destructive",
  past: "border-muted-foreground/20 bg-transparent text-muted-foreground line-through decoration-muted-foreground/50",
};

function label(daysLeft: number): string {
  if (daysLeft < 0) return "Closed";
  if (daysLeft === 0) return "Due today";
  if (daysLeft === 1) return "1 day left";
  return `${daysLeft} days left`;
}

/**
 * A deadline, color-coded by urgency: more than 14 days is neutral, 7-14 is
 * a warning tint, under 7 is destructive, and a date already past renders
 * muted with a strike-through rather than a false-urgent red (nothing can
 * be done about a closed deadline by shouting at it). Pass `daysLeft`
 * directly if you've already computed it against the right clock/timezone -
 * this component doesn't do date math itself.
 */
export function DeadlineChip({ daysLeft, className }: { daysLeft: number; className?: string }) {
  const band = bandFor(daysLeft);
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        BAND_STYLE[band],
        className,
      )}
    >
      <Clock className="size-3" aria-hidden />
      {label(daysLeft)}
    </span>
  );
}
