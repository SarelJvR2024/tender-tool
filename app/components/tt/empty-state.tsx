import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The "nothing here yet" panel for an empty list/table/search result -
 * an icon in a soft tinted roundel, a short title, one line of explanation,
 * and (usually) one primary action to get unstuck. Centered, generous
 * padding - this should never look like a shrunken error message.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  /** Usually a plain sentence, but takes a node so a link can sit inline in it. */
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-accent/10">
        <Icon className="size-5 text-accent" aria-hidden />
      </div>
      <div className="space-y-1">
        <h3 className="font-display text-lg font-medium text-foreground">{title}</h3>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
