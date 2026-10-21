import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The "this failed to load" panel - same shape as EmptyState (icon in a
 * soft tinted roundel, short title, one line of explanation, optional
 * action) but in the destructive tone, so a real failure never reads as
 * "nothing here yet". Pair with a Retry action (e.g. RetryButton) rather
 * than leaving the reader stuck.
 */
export function ErrorState({
  icon: Icon = AlertTriangle,
  title = "Couldn't load this",
  description = "Something went wrong fetching this. Try again - if it keeps happening, let us know.",
  action,
  className,
}: {
  icon?: LucideIcon;
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10">
        <Icon className="size-5 text-destructive" aria-hidden />
      </div>
      <div className="space-y-1">
        <h3 className="font-display text-lg font-medium text-foreground">{title}</h3>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
