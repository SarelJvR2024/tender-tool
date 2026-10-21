import { loadTenderCompliance, packReadiness } from "@/app/tenders/[id]/compliance-data";
import { loadGeneralPackReviewSnapshot } from "@/app/tenders/[id]/general-pack-review-data";
import { SANRAL_CONVENTIONAL_FAMILY } from "./tenderCompliance";

export type NextStep = { label: string; href: string };

// Short, verb-first text for each SANRAL doc-item form code (lib/tenderCompliance.ts's
// own `form` field) - the compliance report's own label for each item is a full
// catalog sentence (e.g. "Standard declarations (debt, fronting, litigation, SBD 4,
// POPIA, past SCM practices, addenda, commitments...)"), too long for a one-line
// dashboard row. This is a presentation-only rephrasing, not a different source of
// truth - which item is missing/to-confirm still comes from packReadiness() itself.
const SHORT_ACTION_FOR_FORM: Record<string, string> = {
  A2: "Confirm signatory authority",
  "A4-A23": "Complete the SBD 4 declarations",
  A7: "Confirm CSD registration",
  A9: "Confirm SARS tax compliance",
  A12: "Upload B-BBEE certificate",
  A17: "Upload PI insurance certificate",
  A18: "Upload bank confirmation letter",
  A20: "Upload COID letter",
  B4: "Upload ISO 9001 certificate",
  B6: "Confirm past performance",
  "C1.1.1": "Sign the Form of Offer",
  "C2.4": "Confirm pricing",
  Briefing: "Confirm briefing attendance",
};

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
