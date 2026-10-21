import { loadTenderCompliance } from "./compliance-data";
import { loadSubmissionPlan } from "./submission-plan-data";
import { classifyComplianceItem, type BidTaskStatus } from "./bid-task-status";
import { SectionCard } from "@/components/tt/section-card";
import { BidTaskBadge } from "@/components/tt/bid-task-badge";

/**
 * "Disqualification guard" - Sarel's own 7-check list, built from existing
 * data only (no new tables/columns/migrations). Reuses the same classifiers
 * every other Verify/Provide/Fix screen on this page already uses:
 * classifyComplianceItem() (bid-task-status.ts, PR #35) for SANRAL doc
 * items, loadSubmissionPlan()'s own already-classified steps (built by a
 * sibling session this same day, reusing the SAME checkReturnable()/
 * roleStatus()/cidbGradingStep() this app's general-tender screens already
 * use) for general tenders - never a second, disagreeing read of the same
 * fact.
 *
 * Two of the 7 checks Sarel asked for have NO backing data anywhere in this
 * schema, confirmed by reading every candidate table/column before
 * concluding that: "required SBD forms ... signed" and "every page needing
 * a signature is signed" both only track WHO is meant to sign (signatureStatus/
 * signatureAnswerStatus), never whether a physical signature actually
 * happened on a given page. Rather than inventing a fake pass/fail for
 * those two, they're shown here as their own explicit "not tracked yet"
 * rows - visibly different from a real check, not silently omitted.
 *
 * Tailwind/tokens migration (design-system pass): markup/styling only -
 * every field, label and value below is an unchanged, line-for-line
 * translation of the previous inline-CSSProperties version, including this
 * screen's own existing pill wording ("Would disqualify"/"You need to
 * supply this"/"Clear"), passed as `BidTaskBadge`'s `children` override
 * rather than its shared default label - same pattern `StatusBadge`
 * already uses for a screen-specific word choice (see app/AGENTS.md,
 * "Dashboard migration"). `BidTaskBadge` (new, components/tt/) is the
 * shared Verify/Provide/Fix pill this pass introduces, reused by later
 * tender-workspace color-migration pieces.
 */

type GuardRow = { label: string; status: BidTaskStatus; detail: string };

const STATUS_LABEL: Record<BidTaskStatus, string> = {
  fix: "Would disqualify",
  provide: "You need to supply this",
  verify: "Clear",
};

export async function DisqualificationGuard({
  tenderId,
  isSanralFamily,
  isGeneralFamily,
}: {
  tenderId: string;
  isSanralFamily: boolean;
  isGeneralFamily: boolean;
}) {
  const rows: GuardRow[] = [];
  let mapped = false;

  if (isSanralFamily) {
    const data = await loadTenderCompliance(tenderId);
    if (data?.mapped) {
      mapped = true;
      const byKey = (k: string) => data.docItems.find((i) => i.key === k);
      const push = (label: string, item: ReturnType<typeof byKey>) => {
        if (!item) return;
        const task = classifyComplianceItem(item);
        rows.push({ label, status: task.status, detail: task.reason });
      };
      push("Tax compliance (SARS TCS PIN)", byKey("tax"));
      push("CSD registration number", byKey("csd"));
      push("B-BBEE certificate or affidavit (valid at closing)", byKey("bbbee"));

      if (data.positionRows.length > 0) {
        const incomplete = data.positionRows.filter((p) => !p.person || !(p.cv || p.tenderCv?.status === "ready"));
        const noPerson = data.positionRows.some((p) => !p.person);
        rows.push({
          label: "Key personnel CVs",
          status: incomplete.length === 0 ? "verify" : noPerson ? "fix" : "provide",
          detail:
            incomplete.length === 0
              ? "Every key position has a confirmed person with a CV on file."
              : `${incomplete.length} of ${data.positionRows.length} key position(s) still need a confirmed person or a CV.`,
        });
      }
    }
  } else if (isGeneralFamily) {
    const plan = await loadSubmissionPlan(tenderId);
    if (plan.mapped) {
      mapped = true;
      const byId = (id: string) => plan.steps.find((s) => s.id === id);
      const push = (label: string, step: ReturnType<typeof byId>) => {
        if (!step) return;
        rows.push({ label, status: step.bidTaskStatus, detail: step.note });
      };
      push("Tax compliance (SARS TCS PIN)", byId("returnable:tax_compliance"));
      push("CSD registration number", byId("returnable:csd_report"));
      push("B-BBEE certificate or affidavit (valid at closing)", byId("returnable:bbbee_proof"));
      push("CIDB grade meets this tender's requirement", byId("cidb_grading"));

      const roleSteps = plan.steps.filter((s) => s.category === "role");
      if (roleSteps.length > 0) {
        const gaps = roleSteps.filter((s) => s.bidTaskStatus !== "verify");
        rows.push({
          label: "Key personnel CVs",
          status: gaps.some((s) => s.bidTaskStatus === "fix") ? "fix" : gaps.length > 0 ? "provide" : "verify",
          detail: gaps.length === 0 ? "Every required role is tagged with a CV." : gaps.map((s) => s.title).join("; "),
        });
      }
    }
  }

  return (
    <div id="disqualification-guard" className="mb-4 scroll-mt-20">
      <SectionCard
        title="Disqualification guard"
        description="The checks most likely to disqualify a bid outright, read from your company vault and this tender's own documents - nothing new to fill in here."
      >
        {!mapped && (
          <div className="text-xs text-muted-foreground">
            Not available yet - this tender&apos;s documents haven&apos;t been read, so there&apos;s nothing real to check.
          </div>
        )}

        {mapped && (
          <div className="flex flex-col">
            {rows.map((r) => (
              <div key={r.label} className="flex items-start gap-2 border-t border-border py-2.5 first:border-t-0">
                <BidTaskBadge status={r.status} className="mt-0.5 shrink-0">
                  {STATUS_LABEL[r.status]}
                </BidTaskBadge>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground">{r.label}</div>
                  <div className="text-xs break-words text-muted-foreground">{r.detail}</div>
                </div>
              </div>
            ))}

            {/* Not tracked anywhere in this schema - shown, not silently omitted. */}
            {[
              "Required SBD forms present and signed (only whether they're present is tracked - a physical signature is never recorded)",
              "Every page needing a signature is signed (only who the chosen signatory is gets tracked, never whether a page was actually countersigned)",
            ].map((detail) => (
              <div key={detail} className="flex items-start gap-2 border-t border-border py-2.5 first:border-t-0">
                <BidTaskBadge status="not_tracked" className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1 text-xs break-words text-muted-foreground/70">{detail}</div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
