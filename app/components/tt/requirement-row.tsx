import { ChipBadge } from "@/app/company/_components/shared";
import type { StatusChip } from "@/lib/dates";
import { OCR_TAG } from "@/app/tenders/[id]/ocr-notice";

/**
 * One "requirement traced back to the tender's own document" row - the exact
 * pattern general-workspace.tsx renders inline for returnables/registrations/
 * roles (quote snippet, OCR_TAG when the text came from a scan, a status
 * chip), pulled out as its own small component so the no-signup demo (spec
 * §6: "requirements linked to tender pages") can render it with hand-built
 * sample data through the same real ChipBadge/StatusChip/OCR_TAG pieces,
 * rather than a separate "looks similar" mockup. Not yet wired back into
 * general-workspace.tsx's own inline markup - that file was only just
 * stabilised by the color-migration pass, so swapping its JSX for this is
 * left for a follow-up rather than risked here.
 */
export function RequirementRow({
  label,
  detail,
  quote,
  fromOcr,
  status,
}: {
  label: string;
  detail?: string;
  quote: string;
  fromOcr?: boolean;
  status: StatusChip;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-border py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">{label}</div>
        {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
        <div className="mt-1 text-[11px] break-words text-muted-foreground italic">
          {fromOcr ? OCR_TAG : ""}&ldquo;{quote}&rdquo;
        </div>
      </div>
      <ChipBadge status={status} className="mt-0.5 shrink-0" />
    </div>
  );
}
