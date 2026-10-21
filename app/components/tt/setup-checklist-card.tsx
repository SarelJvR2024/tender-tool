import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export type SetupChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  href: string;
};

/**
 * "Get set up to bid" - Home's new-company setup checklist (app/AGENTS.md
 * "Home cockpit, empty-state setup checklist"). Composed entirely from
 * already-computed readiness/document-expiry signals (no new completion
 * logic) - same tick-list shape as BidReadinessCard's own blockers list
 * (Circle/Check icon, a short label, a "Fix" link straight to where it's
 * fixed), so a brand-new company sees one consistent pattern for "things to
 * do", not a second competing one.
 */
export function SetupChecklistCard({ items, className }: { items: SetupChecklistItem[]; className?: string }) {
  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;

  return (
    <div className={cn("rounded-lg border border-border bg-card p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-medium text-foreground">Get set up to bid</h2>
          <p className="text-sm text-muted-foreground">
            A few quick things before your first bid - {doneCount} of {items.length} done.
          </p>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        {items.map((item) => (
          <li key={item.key} className="flex min-h-11 items-center gap-2.5 text-sm">
            {item.done ? (
              <Check className="size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className={item.done ? "text-muted-foreground line-through" : "text-foreground"}>{item.label}</span>
            {!item.done && (
              <Link href={item.href} className="ml-auto shrink-0 text-xs font-medium text-accent hover:underline">
                Fix
              </Link>
            )}
          </li>
        ))}
      </ul>

      {allDone && (
        <div className="mt-2 flex items-center gap-2 border-t border-border pt-4 text-sm text-success">
          <Check className="size-4" aria-hidden />
          All set up - you&apos;re ready for your first bid.
        </div>
      )}
    </div>
  );
}
