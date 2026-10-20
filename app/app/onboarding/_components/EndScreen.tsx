import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { ProgressRing } from "@/components/tt/progress-ring";
import { buttonVariants } from "@/components/ui/button";
import { computeBidReadiness } from "./readiness";

export function EndScreen(input: Parameters<typeof computeBidReadiness>[0]) {
  const { percent, items } = computeBidReadiness(input);
  const missing = items.filter((i) => !i.done);

  return (
    <div className="w-full max-w-xl rounded-xl border border-border bg-card p-8 text-center shadow-sm md:p-10">
      <div className="mb-5 flex justify-center">
        <ProgressRing value={percent} size={96} strokeWidth={8} color={percent >= 80 ? "success" : percent >= 50 ? "accent" : "warning"} />
      </div>
      <h1 className="mb-1 font-display text-xl font-medium text-foreground">You&apos;re {percent}% bid-ready</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {missing.length === 0 ? "Everything's on file - you're ready to bid." : "A few things are still worth adding."}
      </p>

      {missing.length > 0 && (
        <ul className="mb-7 flex flex-col gap-1.5 text-left">
          {items.map((item) => (
            <li key={item.label} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              {item.done ? (
                <Check className="size-4 shrink-0 text-success" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className={item.done ? "text-muted-foreground line-through" : "text-foreground"}>{item.label}</span>
              {!item.done && (
                <Link href={item.href} className="ml-auto shrink-0 text-xs font-medium text-accent hover:underline">
                  Add
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Link href="/discovery" className={buttonVariants({ variant: "accent", className: "h-11 flex-1" })}>
          See matching opportunities
        </Link>
        <Link href="/tenders/new" className={buttonVariants({ variant: "outline", className: "h-11 flex-1" })}>
          Load a tender I already have
        </Link>
      </div>
    </div>
  );
}
