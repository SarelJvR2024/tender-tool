import { createClient } from "@/lib/supabase/server";
import { buildReusePlan, flowOf, listPastSubmissions, type ReusePlan } from "@/lib/pastSubmissionReuse";
import { STAGE_META, isPipelineStage } from "@/lib/pipeline";
import { applyPastSubmission } from "./reuse-actions";

/**
 * "Start from a previous submission" (feature item 9). Shown only while this
 * tender is still being prepared and the company has handed in at least one
 * tender of the same kind. Two steps, no client JS: pick a tender → the page
 * re-renders with a preview of exactly what would carry over (and what won't,
 * with the reason) → "Use these" applies it. Nothing is copied without that
 * click. What is reusable at all is decided in app/lib/pastSubmissionReuse.ts.
 */

const buttonClass = "min-h-10 cursor-pointer rounded-lg border-none bg-foreground px-4 text-[13px] font-semibold text-white";
const quietClass = "min-h-10 cursor-pointer rounded-lg border border-border bg-card px-4 text-[13px] font-semibold text-foreground";
const rowClass = "border-t border-border py-[7px] text-xs";

function displayValue(value: string, key: string, people: Map<string, string>) {
  if (key === "signatory_person_id") return people.get(value) ?? "person on file";
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  return value;
}

export async function ReusePastSubmission({
  tenderId,
  reuseFrom,
  saved,
  reused,
}: {
  tenderId: string;
  reuseFrom?: string;
  saved?: string;
  reused?: string;
}) {
  const supabase = await createClient();
  const [{ data: t }, { data: pack }] = await Promise.all([
    supabase.from("tenders").select("id, contract_no, title, description, buyer, family").eq("id", tenderId).maybeSingle(),
    supabase.from("tender_packs").select("pipeline_stage").eq("tender_id", tenderId).maybeSingle(),
  ]);
  if (!t) return null;
  // A tender that has gone in is the thing being reused, not a draft.
  const stage = (pack?.pipeline_stage as string | undefined) ?? "found";
  if (stage === "submitted" || stage === "won" || stage === "lost") return null;

  const past = await listPastSubmissions(supabase, t as Parameters<typeof listPastSubmissions>[1]);
  if (past.length === 0) return null;

  let plan: ReusePlan | null = null;
  if (reuseFrom) plan = await buildReusePlan(supabase, tenderId, reuseFrom);

  const { data: peopleRows } = await supabase.from("people").select("id, name");
  const people = new Map(((peopleRows ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  const [answersCopied, positionsCopied] = (reused ?? "").split(".").map((n) => Number(n) || 0);
  const nothingToCopy = plan && plan.answers.copy.length === 0 && plan.positions.copy.length === 0;
  const skipped = plan ? [...plan.answers.skip, ...plan.positions.skip] : [];

  return (
    <div id="reuse-past" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-1 text-[15px] font-bold text-foreground">Start from a previous submission</div>
      <div className="mb-3 text-xs text-muted-foreground">
        Carry over the answers you gave last time that don&apos;t change between tenders
        {flowOf(t.family as string | null) === "sanral" ? " - here, who filled each key position" : " - signatory and the standard declarations"}.
        Your vault documents, experience and CVs are already used on every tender, so there&apos;s nothing to copy for those.
        Price, briefing and anything specific to that tender are never carried over, and the forms are filled fresh from this tender&apos;s own documents.
      </div>

      {saved === "reuse" && (
        <div className="mb-3 rounded-lg bg-success/10 px-3 py-2 text-xs font-semibold text-success">
          {answersCopied + positionsCopied === 0
            ? "Nothing new to carry over - this tender already had those answers."
            : `Carried over ${[
                answersCopied > 0 ? `${answersCopied} answer${answersCopied === 1 ? "" : "s"}` : "",
                positionsCopied > 0 ? `${positionsCopied} key position${positionsCopied === 1 ? "" : "s"}` : "",
              ].filter(Boolean).join(" and ")}. Check them below before you generate the pack.`}
        </div>
      )}

      <form method="get" action={`/tenders/${tenderId}#reuse-past`} className="flex flex-wrap items-center gap-2">
        <select
          name="reuse_from"
          aria-label="Tender to reuse answers from"
          defaultValue={reuseFrom ?? past[0].tender_id}
          className="min-h-10 min-w-0 max-w-full flex-[1_1_260px] rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground"
        >
          {past.map((p) => (
            <option key={p.tender_id} value={p.tender_id}>
              {[p.contract_no, p.title.slice(0, 70), p.buyer, isPipelineStage(p.stage) ? STAGE_META[p.stage].label : p.stage].filter(Boolean).join(" · ")}
              {p.sameBuyer ? " (same buyer)" : ""}
            </option>
          ))}
        </select>
        <button type="submit" className={quietClass}>Show what carries over</button>
      </form>

      {reuseFrom && !plan && (
        <div className="mt-3 text-xs text-destructive">That tender can&apos;t be used as a starting point for this one.</div>
      )}

      {plan && (
        <div className="mt-3.5">
          {plan.notes.map((n) => (
            <div key={n} className="mb-2 text-xs text-warning">{n}</div>
          ))}

          {(plan.answers.copy.length > 0 || plan.positions.copy.length > 0) && (
            <>
              <div className="mb-0.5 text-xs font-bold text-success">Will carry over from {plan.source.contract_no ?? "that tender"}</div>
              {plan.answers.copy.map((a) => (
                <div key={a.key} className={rowClass}>
                  <div className="text-foreground">{a.label}</div>
                  <div className="font-semibold text-foreground">{displayValue(a.value, a.key, people)}</div>
                  <div className="text-[11px] text-muted-foreground">{a.why}</div>
                </div>
              ))}
              {plan.positions.copy.map((p) => (
                <div key={p.code} className={rowClass}>
                  <div className="text-foreground">{p.code}{p.description ? ` - ${p.description}` : ""}</div>
                  <div className="font-semibold text-foreground">{people.get(p.personId) ?? "person on file"}</div>
                </div>
              ))}
              {plan.flow === "general" && plan.answers.copy.length > 0 && (
                <div className="mt-1.5 text-[11px] text-warning">
                  The declarations are sworn on the signed forms - read them again before signing, in case anything changed since that tender.
                </div>
              )}
              <form action={applyPastSubmission} className="mt-3">
                <input type="hidden" name="tender_id" value={tenderId} />
                <input type="hidden" name="source_tender_id" value={plan.source.tender_id} />
                <button type="submit" className={buttonClass}>Use these</button>
              </form>
            </>
          )}

          {nothingToCopy && plan.notes.length === 0 && (
            <div className="text-xs text-muted-foreground">Nothing from that tender to carry over to this one.</div>
          )}

          {skipped.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">Not carried over ({skipped.length})</summary>
              {skipped.map((s) => (
                <div key={s.key} className={rowClass}>
                  <div className="text-foreground">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground">{s.reason}</div>
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
