import { cn } from "@/lib/utils";

/**
 * A circular percentage indicator (readiness, completeness, score) for
 * where a horizontal Progress bar reads as "a loading bar" rather than
 * "a score" - a dashboard tile, a compliance summary. Pure SVG, no new
 * dependency; the track is drawn in `muted`, the fill in `accent` by
 * default (pass `color` to use `success`/`warning`/`destructive` instead
 * when the ring itself needs to carry that meaning).
 */
export function ProgressRing({
  value,
  size = 72,
  strokeWidth = 7,
  color = "accent",
  label,
  className,
}: {
  /** 0-100 */
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: "accent" | "success" | "warning" | "destructive" | "primary";
  label?: React.ReactNode;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} className="stroke-muted" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          fill="none"
          className={cn(
            "transition-[stroke-dashoffset] duration-500 ease-out",
            color === "accent" && "stroke-accent",
            color === "success" && "stroke-success",
            color === "warning" && "stroke-warning",
            color === "destructive" && "stroke-destructive",
            color === "primary" && "stroke-primary",
          )}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {label ?? <span className="font-display text-base font-medium text-foreground">{Math.round(clamped)}%</span>}
      </div>
    </div>
  );
}
