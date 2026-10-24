"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Per-row "which tender named this role" citation for the role-tag checklist
 * on a person's page (/people/[id], "Tender roles this CV qualifies for").
 * tender_roles.source (migration 0016) is real evidence text - which SANRAL
 * Book 1 table/matrix sheet, or which other buyer's tender, the role code
 * comes from - not decoration. It used to live only in a bare `title=`
 * attribute on the row's own <label>, with the row's own intro copy reading
 * "Hover a role to see which tender it came from" - unreachable on any
 * touch device and invisible to a screen reader, the same hover-only bug
 * class the last several UI/UX review passes fixed elsewhere (chart counts,
 * notification titles). A small Tooltip-backed (?) icon reuses the same
 * accessible, already-proven pattern this app uses for its section-level
 * "how this works" tooltips (pack-review.tsx, submission-pack.tsx,
 * narrative-documents.tsx) instead of a fourth hand-rolled convention.
 */
export function RoleSourceInfo({ source, roleTitle }: { source: string; roleTitle: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={`Where "${roleTitle}" comes from`}
        className="inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <Info className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left font-normal">{source}</TooltipContent>
    </Tooltip>
  );
}
