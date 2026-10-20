import { cn } from "@/lib/utils";

/**
 * Top-of-screen header: an editorial (Fraunces) title, an optional muted
 * description line, and a right-aligned actions slot (buttons, a status
 * chip, whatever the screen needs). Wraps to a stacked layout once the
 * actions no longer fit beside the title, rather than ever scrolling.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="font-display text-2xl font-medium tracking-tight text-foreground text-balance sm:text-3xl">
          {title}
        </h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
