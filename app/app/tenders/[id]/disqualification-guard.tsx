import { loadTenderCompliance } from "./compliance-data";
import { loadSubmissionPlan } from "./submission-plan-data";
import { classifyComplianceItem, type BidTaskStatus } from "./bid-task-status";

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
 */

type GuardRow = { label: string; status: BidTaskStatus; detail: string };

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

const STATUS_STYLE: Record<BidTaskStatus, { label: string; bg: string; color: string }> = {
  fix: { label: "Would disqualify", bg: "#FEE2E2", color: "#B91C1C" },
  provide: { label: "You need to supply this", bg: "#FEF3C7", color: "#B45309" },
  verify: { label: "Clear", bg: "#DCFCE7", color: "#15803D" },
};

const NOT_TRACKED_LABEL = {
  bg: "#ECEEF1",
  color: "#5B6472",
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
    <div id="disqualification-guard" style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Disqualification guard</div>
      <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 12 }}>
        The checks most likely to disqualify a bid outright, read from your company vault and this tender&apos;s own
        documents - nothing new to fill in here.
      </div>

      {!mapped && (
        <div style={{ fontSize: 12, color: "#8A93A0" }}>
          Not available yet - this tender&apos;s documents haven&apos;t been read, so there&apos;s nothing real to check.
        </div>
      )}

      {mapped && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((r) => {
            const st = STATUS_STYLE[r.status];
            return (
              <div key={r.label} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 0", borderTop: "1px solid #ECEEF1" }}>
                <span style={{ flex: "0 0 auto", marginTop: 1, display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                  {st.label}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: "#4B5563", wordBreak: "break-word" }}>{r.detail}</div>
                </div>
              </div>
            );
          })}

          {/* Not tracked anywhere in this schema - shown, not silently omitted. */}
          {[
            "Required SBD forms present and signed (only whether they're present is tracked - a physical signature is never recorded)",
            "Every page needing a signature is signed (only who the chosen signatory is gets tracked, never whether a page was actually countersigned)",
          ].map((detail) => (
            <div key={detail} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 0", borderTop: "1px solid #ECEEF1" }}>
              <span style={{ flex: "0 0 auto", marginTop: 1, display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: NOT_TRACKED_LABEL.bg, color: NOT_TRACKED_LABEL.color, whiteSpace: "nowrap" }}>
                Not tracked yet
              </span>
              <div style={{ minWidth: 0, flex: 1, fontSize: 12, color: "#8A93A0", wordBreak: "break-word" }}>{detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
