import { loadB7State } from "./b7-data";
import { SubcontractingPlanForm } from "./subcontracting-plan-form";
import { clearSubcontractingPlan } from "./b7-actions";
import { B7_CATEGORY_BANDS, B7_POLICY_MIN_PCT } from "@/lib/sanralB7";
import { formatDate } from "@/lib/dates";

/**
 * "Form B7 - Subcontracting to Targeted Enterprises" on the SANRAL Tender
 * Workspace: whether B7 applies to this tender for this company (category
 * read from the tender's own Technical workbook + SANRAL's matrix there +
 * the company's size - app/lib/sanralB7.ts), and the company's own answer:
 * its subcontracting plan, or the tender's own Book 1 waiver quoted. The
 * submission pack hard-stops when B7 applies and this is unanswered.
 */

const BADGE: Record<string, { label: string; className: string }> = {
  required: { label: "Required", className: "bg-destructive/10 text-destructive" },
  unknown: { label: "Can't rule out - answer it", className: "bg-warning/10 text-warning" },
  not_required: { label: "Not required", className: "bg-muted text-muted-foreground" },
  waived: { label: "Waived by this tender", className: "bg-muted text-muted-foreground" },
};

export async function SubcontractingPlan({ tenderId, saved }: { tenderId: string; saved: boolean }) {
  const s = await loadB7State(tenderId);
  const answered = !!s.plan;
  const badge =
    answered && s.plan?.mode === "subcontract" ? { label: "Answered", className: "bg-success/10 text-success" } : BADGE[s.applies.status];
  const category = s.setup?.category ?? null;
  const needsPlanUnanswered = s.applies.needsPlan && !answered;

  return (
    <div id="form-b7" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-0.5 flex flex-wrap items-start justify-between gap-2.5">
        <div className="text-[15px] font-bold text-foreground">Form B7 - Subcontracting to Targeted Enterprises</div>
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      <div className="mb-2.5 text-xs text-muted-foreground">
        SANRAL makes subcontracting at least {B7_POLICY_MIN_PCT}% of the contract to Targeted Enterprises (black-owned EME or
        QSE consulting firms, B-BBEE level 1 or 2) a contract condition, depending on the contract value and your size:
        under R6m - QSE and Generic firms; R6m-R25m - Generic firms only; over R25m - everyone. Only you can say who you
        will subcontract to, so nothing here is filled in for you.
      </div>

      <div
        className={`mb-3 rounded-lg border px-3.5 py-2.5 text-xs ${
          needsPlanUnanswered ? "border-warning/30 bg-warning/10 text-warning" : "border-border bg-card text-foreground"
        }`}
      >
        <div className="mb-0.5 font-bold">
          {category ? `Category ${category} tender (${B7_CATEGORY_BANDS[category]})` : "Category not read yet"}
          {s.companyStatus ? ` · your company: ${s.companyStatus}` : " · your company's size not recorded"}
        </div>
        <div>
          {s.applies.reason[0].toUpperCase() + s.applies.reason.slice(1)}
          {/[.!?]["']?$/.test(s.applies.reason) ? "" : "."}
        </div>
        {!category && (
          <div className="mt-1 text-muted-foreground">
            The category comes from SANRAL&apos;s own Technical Submission workbook (SETUP sheet) once it is uploaded under Blank
            tender templates above - the contract value itself is never guessed.
          </div>
        )}
        {s.applies.status === "not_required" && !answered && (
          <div className="mt-1 text-muted-foreground">
            Form B7 is left out of the pack, with this reason on its checklist. If you subcontract anyway (SANRAL scores the
            percentage under functionality), give your plan below and it is filled in.
          </div>
        )}
      </div>

      {saved && <div className="mb-2 text-xs font-semibold text-success">Form B7 answer saved.</div>}

      {s.errors.length > 0 && (
        <div className="mb-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {s.errors.map((e) => (
            <div key={e}>- {e}</div>
          ))}
        </div>
      )}
      {s.warnings.length > 0 && (
        <div className="mb-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {s.warnings.map((w) => (
            <div key={w}>- {w}</div>
          ))}
        </div>
      )}

      <SubcontractingPlanForm tenderId={tenderId} initial={s.plan} />

      {answered && (
        <form action={clearSubcontractingPlan} className="mt-2">
          <input type="hidden" name="tender_id" value={tenderId} />
          <button type="submit" className="cursor-pointer border-none bg-transparent p-0 text-xs text-muted-foreground underline">
            Clear this answer{s.updatedAt ? ` (saved ${(formatDate(s.updatedAt) ?? "—")})` : ""}
          </button>
        </form>
      )}
    </div>
  );
}
