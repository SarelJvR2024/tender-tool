import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { ProgressRing } from "./progress-ring";
import { cn } from "@/lib/utils";
import type { ReadinessResult } from "@/lib/readiness";

/**
 * The one place bid-readiness actually renders - Home (large) and the
 * onboarding end screen share this exact component; Company vault (compact)
 * reuses it too even though that page itself hasn't been migrated to the
 * design system yet (same kind of visible seam SiteNav left on every
 * newly-migrated page before it - see app/AGENTS.md - not a bug to chase).
 * The score itself always comes from lib/companyReadinessData.ts, never
 * computed here, so these three surfaces can't quietly disagree.
 */
export function BidReadinessCard({
  result,
  size = "large",
  className,
}: {
  result: ReadinessResult;
  size?: "large" | "compact";
  className?: string;
}) {
  const ringColor = result.percent >= 80 ? "success" : result.percent >= 50 ? "accent" : "warning";

  if (size === "compact") {
    return (
      <Link
        href="/onboarding?step=done"
        className={cn("flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-inherit no-underline hover:bg-muted/50", className)}
      >
        <ProgressRing value={result.percent} size={40} strokeWidth={4} color={ringColor} label={<span className="text-xs font-semibold text-foreground">{result.percent}%</span>} />
        <div className="text-xs">
          <div className="font-medium text-foreground">Bid-ready</div>
          <div className="text-muted-foreground">
            {result.blockers.length === 0 ? "Everything on file" : `${result.blockers.length} thing${result.blockers.length === 1 ? "" : "s"} to fix`}
          </div>
        </div>
      </Link>
    );
  }

  const topFixes = result.blockers.slice(0, 3);

  return (
    <div className={cn("rounded-lg border border-border bg-card p-5", className)}>
      <div className="flex items-center gap-5">
        <ProgressRing value={result.percent} size={88} strokeWidth={7} color={ringColor} />
        <div>
          <div className="font-display text-lg font-medium text-foreground">{result.percent}% bid-ready</div>
          <div className="text-sm text-muted-foreground">
            {result.blockers.length === 0 ? "Everything's on file - you're ready to bid." : "A few things are still worth fixing."}
          </div>
        </div>
      </div>

      {topFixes.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5 border-t border-border pt-4">
          {topFixes.map((item) => (
            <li key={item.key} className="flex items-center gap-2.5 text-sm">
              <Circle className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-foreground">{item.label}</span>
              {item.reason === "expired" && <span className="text-xs font-medium text-destructive">Expired</span>}
              {item.reason === "expiring_soon" && <span className="text-xs font-medium text-warning">Expires in {item.daysLeft}d</span>}
              <Link href={item.href} className="ml-auto shrink-0 text-xs font-medium text-accent hover:underline">
                Fix
              </Link>
            </li>
          ))}
        </ul>
      )}
      {topFixes.length === 0 && (
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-sm text-success">
          <Check className="size-4" />
          Nothing left to fix
        </div>
      )}
    </div>
  );
}
