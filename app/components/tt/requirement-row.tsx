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
 * rather than a separate "looks similar" mockup.
 *
 * Wired back into general-workspace.tsx's own documents/registrations/roles
 * sections (Tender Workspace overhaul, 2026-10-25) - `labelSuffix` and
 * `trailing` exist only so that file's few extra per-row bits ("mentioned,
 * may not be required", a "Renew soon" chip, a match-strength badge) have
 * somewhere to go without forking this component into a second, near-
 * identical copy; both are optional and unused by the demo page, which
 * keeps rendering exactly as before.
 */
export function RequirementRow({
  label,
  labelSuffix,
  detail,
  quote,
  fromOcr,
  status,
  trailing,
}: {
  label: string;
  /** Extra inline text after the label (e.g. "- mentioned, may not be required"). */
  labelSuffix?: React.ReactNode;
  detail?: string;
  quote: string;
  fromOcr?: boolean;
  status: StatusChip;
  /** Extra badge(s) shown before the main status chip (e.g. a match-strength note). */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-border py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">
          {label}
          {labelSuffix}
        </div>
        {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
        <div className="mt-1 text-[11px] break-words text-muted-foreground italic">
          {fromOcr ? OCR_TAG : ""}&ldquo;{quote}&rdquo;
        </div>
      </div>
      <div className="mt-0.5 flex shrink-0 flex-wrap items-center gap-1.5">
        {trailing}
        <ChipBadge status={status} />
      </div>
    </div>
  );
}
