import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type CompanySubNavItem = {
  href: string;
  label: string;
  /** Only set for a section with a real completion signal (lib/readiness.ts / lib/documentExpiry.ts) to reuse - not every section has one. */
  complete?: boolean;
  /**
   * Group header shown above this item when it differs from the previous
   * item's group - a first-time-user orientation aid (Sarel's own live
   * feedback: "the different sections ... feel intimidating for an
   * initial user") so the flat 12-item list reads as "what every tender
   * needs" vs "team & experience" vs "other", not one undifferentiated
   * wall of links. Purely a label grouping of the existing items/order -
   * no new section, href or data signal.
   */
  group?: string;
};

/**
 * The company vault's section nav - a horizontal scrollable pill row below
 * `lg`, a persistent sticky column to its left at `lg` and up (replacing
 * the old CompanyJumpLink horizontal bar in both cases). A section gets a
 * green check only when `complete` was actually computed from existing
 * data (see page.tsx) - no tick is still a valid, honest state, not a
 * missing feature. Items sharing a `group` get one header above the
 * cluster (desktop column only - the horizontal pill row below `lg` stays
 * flat, since a horizontal scroller has no good place to inline a header).
 */
export function CompanySubNav({ items }: { items: CompanySubNavItem[] }) {
  return (
    <nav aria-label="Company vault sections" className="lg:sticky lg:top-20 lg:h-fit lg:w-52 lg:shrink-0">
      <div className="-mx-4 overflow-x-auto px-4 pb-1 lg:mx-0 lg:overflow-visible lg:px-0 lg:pb-0">
        <div className="flex gap-1.5 lg:flex-col lg:gap-0.5">
          {items.map((item, i) => (
            <div key={item.href} className="contents">
              {item.group && item.group !== items[i - 1]?.group && (
                <div className="hidden px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase first:pt-1 lg:block">
                  {item.group}
                </div>
              )}
              <a
                href={item.href}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium whitespace-nowrap text-foreground no-underline hover:bg-muted/60",
                  "lg:w-full lg:rounded-md lg:border-0 lg:bg-transparent lg:px-3 lg:py-2 lg:text-sm",
                )}
              >
                {item.complete && <Check className="size-3.5 shrink-0 text-success" aria-hidden />}
                <span className="truncate">{item.label}</span>
              </a>
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}
