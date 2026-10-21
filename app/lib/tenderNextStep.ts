import { loadTenderCompliance, packReadiness } from "@/app/tenders/[id]/compliance-data";
import { loadGeneralPackReviewSnapshot } from "@/app/tenders/[id]/general-pack-review-data";
import { SANRAL_CONVENTIONAL_FAMILY, SHORT_ACTION_FOR_FORM } from "./tenderCompliance";

export type NextStep = { label: string; href: string };

function shortLabelFor(itemLabel: string): string {
  // itemLabel here is one of packReadiness()'s already-formatted "FORM label..."
  // strings - pull the form code back off the front of it to look up the
  // short phrase, falling back to the form code itself if it's a new one
  // this map doesn't know about yet.
  const form = itemLabel.split(" ")[0];
  return SHORT_ACTION_FOR_FORM[form] ?? `Review ${form}`;
}

/**
 * The one concrete, unfinished thing for this tender's pack - what Home's
 * "Closing soon" timeline shows instead of a vague "Needs your input".
 * Dispatches to the same two loaders the tender workspace itself uses
 * (compliance-data.ts for SANRAL conventional tenders, general-pack-review-data.ts
 * for everything else) so this never disagrees with what the workspace
 * itself reports - no separate "dashboard version" of pack readiness.
 *
 * Both loaders do a real, multi-query per-tender read (the same cost the
 * workspace page itself pays) - only call this for a small, bounded set of
 * tenders (e.g. closing within 14 days), never for a full tender list.
 */
export async function nextStepFor(tenderId: string, family: string | null, hasPack: boolean): Promise<NextStep | null> {
  if (!hasPack) {
    return { label: "Start the submission pack", href: `/tenders/${tenderId}` };
  }

  if (family === SANRAL_CONVENTIONAL_FAMILY) {
    const data = await loadTenderCompliance(tenderId);
    const readiness = packReadiness(data);
    if (!readiness.checked) return { label: "Review compliance", href: `/tenders/${tenderId}#compliance-check` };
    const first = readiness.mandatoryMissing[0] ?? readiness.toConfirm[0];
    if (first) return { label: shortLabelFor(first), href: `/tenders/${tenderId}#compliance-check` };
    if (readiness.unfilledPositions.length > 0) {
      return { label: `Confirm key person: ${readiness.unfilledPositions[0]}`, href: `/tenders/${tenderId}#key-positions` };
    }
    return null;
  }

  const snapshot = await loadGeneralPackReviewSnapshot(tenderId);
  if (!snapshot.mapped) return { label: "Review compliance", href: `/tenders/${tenderId}#general-pack` };
  const hasGap = snapshot.sections
    .flatMap((s) => s.items)
    .some((i) => i.status === "missing" || i.status === "needs_input" || i.status === "warning");
  if (hasGap) return { label: "Review compliance", href: `/tenders/${tenderId}#general-pack` };
  return null;
}
