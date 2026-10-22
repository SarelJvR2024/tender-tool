import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/tt/section-card";
import type { StatusChip, ChipTone } from "@/lib/dates";

/**
 * Small shared pieces every extracted Company vault section reuses - kept
 * here rather than duplicated per file. Nothing here changes a fact or a
 * label; it's the Tailwind/token equivalent of the inline-CSSProperties
 * helpers (`Section`, `Field`, `Badge`, `SummaryChip`) the monolithic
 * page.tsx used to define inline.
 */

/** A titled card for one vault section, at its own anchor id for the sub-nav/jump links. */
export function VaultSection({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-20">
      <SectionCard title={title} description={description}>
        {children}
      </SectionCard>
    </div>
  );
}

export const fieldGridClass = "grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3";

export function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <div className="mb-0.5 text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium text-foreground">
        {value === null || value === undefined || value === "" ? (
          <span className="text-muted-foreground/70">Not on file</span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

export function NotStated(label: string): StatusChip {
  return { label, tone: "muted" };
}

const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/20 bg-warning/10 text-warning",
  destructive: "border-destructive/20 bg-destructive/10 text-destructive",
  muted: "border-muted-foreground/20 bg-muted text-muted-foreground",
  accent: "border-accent/20 bg-accent/10 text-accent",
};

/** Same soft 10%-tint pill as StatusBadge, for a StatusChip (expiryStatus()'s own 4 states) rather than a TenderStatus. */
export function ChipBadge({ status, className }: { status: StatusChip; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        CHIP_TONE_CLASS[status.tone],
        className,
      )}
    >
      {status.label}
    </span>
  );
}

export function SummaryChip({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: ChipTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
        CHIP_TONE_CLASS[tone],
      )}
    >
      {count} {label}
    </span>
  );
}

export const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

/** A full-width inline message - "saved", "couldn't load", etc. */
export function Banner({ tone, children }: { tone: "destructive" | "success"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        tone === "destructive" ? "border-destructive/20 bg-destructive/10 text-destructive" : "border-success/20 bg-success/10 text-success",
      )}
    >
      {children}
    </div>
  );
}
