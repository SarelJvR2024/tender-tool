import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Step = { label: string; description?: string };

/**
 * A horizontal step sequence (a wizard, a pipeline stage track) - each
 * step is "complete" (filled, checkmark), "current" (accent ring, filled
 * number), or "upcoming" (muted outline), joined by a connector line that
 * itself fills in behind completed steps. Wraps to a vertical stack below
 * the `sm` breakpoint rather than forcing a horizontal scroll.
 */
export function Stepper({ steps, current, className }: { steps: Step[]; current: number; className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-6 sm:flex-row sm:gap-0", className)}>
      {steps.map((step, i) => {
        const state = i < current ? "complete" : i === current ? "current" : "upcoming";
        return (
          <li key={step.label} className="flex flex-1 items-start gap-3 sm:flex-col sm:items-stretch sm:gap-2">
            <div className="flex items-center gap-2 sm:w-full">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  state === "complete" && "border-primary bg-primary text-primary-foreground",
                  state === "current" && "border-accent bg-accent/10 text-accent-foreground ring-2 ring-accent/30",
                  state === "upcoming" && "border-border bg-background text-muted-foreground",
                )}
              >
                {state === "complete" ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className={cn("hidden h-px flex-1 sm:block", state === "complete" ? "bg-primary" : "bg-border")}
                />
              )}
            </div>
            <div className="min-w-0">
              <div className={cn("text-sm font-medium", state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>
                {step.label}
              </div>
              {step.description && <div className="text-xs text-muted-foreground">{step.description}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
