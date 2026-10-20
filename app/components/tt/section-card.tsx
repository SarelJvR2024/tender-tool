import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A titled card for grouping a chunk of a screen - the shadcn Card's own
 * header/title/description slots, wired up so a caller just passes text
 * instead of re-assembling CardHeader/CardTitle every time. `actions` sits
 * to the right of the title (a link, a button, a menu trigger).
 */
export function SectionCard({
  title,
  description,
  actions,
  footer,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className={cn("shadow-sm", className)}>
      {(title || description || actions) && (
        <CardHeader className={cn(actions && "grid-cols-[1fr_auto]")}>
          <div className="min-w-0">
            {title && <CardTitle>{title}</CardTitle>}
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </CardHeader>
      )}
      {children && <CardContent>{children}</CardContent>}
      {footer}
    </Card>
  );
}
