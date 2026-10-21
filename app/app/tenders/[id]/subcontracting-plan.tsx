import { loadB7State } from "./b7-data";
import { SubcontractingPlanForm } from "./subcontracting-plan-form";
import { clearSubcontractingPlan } from "./b7-actions";
import { B7_CATEGORY_BANDS, B7_POLICY_MIN_PCT } from "@/lib/sanralB7";

/**
 * "Form B7 - Subcontracting to Targeted Enterprises" on the SANRAL Tender
 * Workspace: whether B7 applies to this tender for this company (category
 * read from the tender's own Technical workbook + SANRAL's matrix there +
 * the company's size - app/lib/sanralB7.ts), and the company's own answer:
 * its subcontracting plan, or the tender's own Book 1 waiver quoted. The
 * submission pack hard-stops when B7 applies and this is unanswered.
 */

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

const BADGE: Record<string, { label: string; bg: string; color: string }> = {
  required: { label: "Required", bg: "#FEE2E2", color: "#B91C1C" },
  unknown: { label: "Can't rule out - answer it", bg: "#FEF3C7", color: "#B45309" },
  not_required: { label: "Not required", bg: "#ECEEF1", color: "#5B6472" },
  waived: { label: "Waived by this tender", bg: "#ECEEF1", color: "#5B6472" },
};

export async function SubcontractingPlan({ tenderId, saved }: { tenderId: string; saved: boolean }) {
  const s = await loadB7State(tenderId);
  const answered = !!s.plan;
  const badge = answered && s.plan?.mode === "subcontract" ? { label: "Answered", bg: "#DCFCE7", color: "#15803D" } : BADGE[s.applies.status];
  const category = s.setup?.category ?? null;

  return (
    <div id="form-b7" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B" }}>Form B7 - Subcontracting to Targeted Enterprises</div>
        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", background: badge.bg, color: badge.color }}>
          {badge.label}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 10 }}>
        SANRAL makes subcontracting at least {B7_POLICY_MIN_PCT}% of the contract to Targeted Enterprises (black-owned EME or
        QSE consulting firms, B-BBEE level 1 or 2) a contract condition, depending on the contract value and your size:
        under R6m - QSE and Generic firms; R6m-R25m - Generic firms only; over R25m - everyone. Only you can say who you
        will subcontract to, so nothing here is filled in for you.
      </div>

      <div
        style={{
          background: s.applies.needsPlan && !answered ? "#FEF3C7" : "#FFFFFF",
          border: `1px solid ${s.applies.needsPlan && !answered ? "#F5D08A" : "#E3E6EA"}`,
          borderRadius: 9,
          padding: "10px 14px",
          marginBottom: 12,
          fontSize: 12,
          color: s.applies.needsPlan && !answered ? "#B45309" : "#16233B",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 2 }}>
          {category ? `Category ${category} tender (${B7_CATEGORY_BANDS[category]})` : "Category not read yet"}
          {s.companyStatus ? ` · your company: ${s.companyStatus}` : " · your company's size not recorded"}
        </div>
        <div>
          {s.applies.reason[0].toUpperCase() + s.applies.reason.slice(1)}
          {/[.!?]["']?$/.test(s.applies.reason) ? "" : "."}
        </div>
        {!category && (
          <div style={{ marginTop: 4, color: "#5B6472" }}>
            The category comes from SANRAL&apos;s own Technical Submission workbook (SETUP sheet) once it is uploaded under Blank
            tender templates above - the contract value itself is never guessed.
          </div>
        )}
        {s.applies.status === "not_required" && !answered && (
          <div style={{ marginTop: 4, color: "#5B6472" }}>
            Form B7 is left out of the pack, with this reason on its checklist. If you subcontract anyway (SANRAL scores the
            percentage under functionality), give your plan below and it is filled in.
          </div>
        )}
      </div>

      {saved && <div style={{ fontSize: 12, color: "#15803D", marginBottom: 8, fontWeight: 600 }}>Form B7 answer saved.</div>}

      {s.errors.length > 0 && (
        <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#B91C1C" }}>
          {s.errors.map((e) => (
            <div key={e}>- {e}</div>
          ))}
        </div>
      )}
      {s.warnings.length > 0 && (
        <div style={{ background: "#FEF3C7", border: "1px solid #F5D08A", borderRadius: 9, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#B45309" }}>
          {s.warnings.map((w) => (
            <div key={w}>- {w}</div>
          ))}
        </div>
      )}

      <SubcontractingPlanForm tenderId={tenderId} initial={s.plan} />

      {answered && (
        <form action={clearSubcontractingPlan} style={{ marginTop: 8 }}>
          <input type="hidden" name="tender_id" value={tenderId} />
          <button type="submit" style={{ background: "none", border: "none", padding: 0, color: "#5B6472", fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>
            Clear this answer{s.updatedAt ? ` (saved ${new Date(s.updatedAt).toLocaleDateString()})` : ""}
          </button>
        </form>
      )}
    </div>
  );
}
