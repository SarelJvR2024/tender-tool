import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

const TONE_CLASS = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
} as const;

/**
 * A single number worth drawing attention to (a count, a total, a rate) -
 * the small, scannable tile a dashboard row of 3-5 of these forms. `trend`
 * is optional and purely cosmetic framing (up = success-tinted, down =
 * destructive-tinted); it never implies which direction is "good" for a
 * given metric, so pass the label/sign yourself. `tone` colors the big
 * value itself instead - for when the number's own color is the point (a
 * count of things still needing attention), not a separate trend arrow.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  trend?: { value: string; direction: "up" | "down" };
  tone?: keyof typeof TONE_CLASS;
  className?: string;
}) {
  return (
    <Card className={cn("gap-2 px-5 py-4 shadow-sm", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className={cn("font-display text-3xl font-medium tracking-tight", TONE_CLASS[tone])}>{value}</span>
        {trend && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-xs font-medium",
              trend.direction === "up" ? "text-success" : "text-destructive",
            )}
          >
            {trend.direction === "up" ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
            {trend.value}
          </span>
        )}
      </div>
    </Card>
  );
}
