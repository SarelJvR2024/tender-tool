import Link from "next/link";
import { AlertTriangle, FileWarning, PartyPopper, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type NextBestAction =
  | { kind: "deadline"; title: string; detail: string; daysLeft: number; href: string }
  | { kind: "document"; title: string; detail: string; daysLeft: number; href: string }
  | { kind: "opportunity"; title: string; detail: string; href: string }
  | { kind: "none" };

const ICON = { deadline: AlertTriangle, document: FileWarning, opportunity: Sparkles, none: PartyPopper } as const;

const TONE: Record<Exclude<NextBestAction["kind"], "none">, string> = {
  deadline: "border-destructive/20 bg-destructive/10 text-destructive",
  document: "border-warning/20 bg-warning/10 text-warning",
  opportunity: "border-accent/20 bg-accent/10 text-accent",
};

const EYEBROW: Record<NextBestAction["kind"], string> = {
  deadline: "Next best action - closing soon",
  document: "Next best action - document expiring",
  opportunity: "Next best action - new opportunity",
  none: "Next best action",
};

/**
 * The single most urgent thing, picked by dashboard/page.tsx in priority
 * order (a near deadline with an incomplete pack, else an expiring document,
 * else a new matching opportunity) - this component only renders whichever
 * one won, it doesn't do the picking itself.
 */
export function NextBestActionCard({ action, className }: { action: NextBestAction; className?: string }) {
  const Icon = ICON[action.kind];

  if (action.kind === "none") {
    return (
      <div className={cn("flex h-full flex-col justify-center gap-2 rounded-lg border border-border bg-card p-5", className)}>
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" aria-hidden />
          {EYEBROW.none}
        </div>
        <div className="font-display text-base font-medium text-foreground">Nothing urgent right now</div>
        <p className="text-sm text-muted-foreground">No deadlines closing soon, no documents expiring, no new opportunities waiting on you.</p>
      </div>
    );
  }

  return (
    <Link
      href={action.href}
      className={cn("flex h-full flex-col gap-2 rounded-lg border border-border bg-card p-5 text-inherit no-underline hover:bg-muted/50", className)}
    >
      <div className={cn("inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE[action.kind])}>
        <Icon className="size-3.5" aria-hidden />
        {EYEBROW[action.kind]}
      </div>
      <div className="font-display text-base font-medium text-foreground">{action.title}</div>
      <p className="text-sm text-muted-foreground">{action.detail}</p>
    </Link>
  );
}
