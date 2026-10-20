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

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };
const button: React.CSSProperties = { minHeight: 40, padding: "0 16px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" };
const quiet: React.CSSProperties = { ...button, background: "#FFFFFF", color: "#16233B", border: "1px solid #D6D1C2" };
const row: React.CSSProperties = { padding: "7px 0", borderTop: "1px solid #ECEEF1", fontSize: 12 };

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
    <div id="reuse-past" style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 4 }}>Start from a previous submission</div>
      <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 12 }}>
        Carry over the answers you gave last time that don&apos;t change between tenders
        {flowOf(t.family as string | null) === "sanral" ? " - here, who filled each key position" : " - signatory and the standard declarations"}.
        Your vault documents, experience and CVs are already used on every tender, so there&apos;s nothing to copy for those.
        Price, briefing and anything specific to that tender are never carried over, and the forms are filled fresh from this tender&apos;s own documents.
      </div>

      {saved === "reuse" && (
        <div style={{ background: "#DCFCE7", color: "#15803D", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
          {answersCopied + positionsCopied === 0
            ? "Nothing new to carry over - this tender already had those answers."
            : `Carried over ${[
                answersCopied > 0 ? `${answersCopied} answer${answersCopied === 1 ? "" : "s"}` : "",
                positionsCopied > 0 ? `${positionsCopied} key position${positionsCopied === 1 ? "" : "s"}` : "",
              ].filter(Boolean).join(" and ")}. Check them below before you generate the pack.`}
        </div>
      )}

      <form method="get" action={`/tenders/${tenderId}#reuse-past`} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          name="reuse_from"
          aria-label="Tender to reuse answers from"
          defaultValue={reuseFrom ?? past[0].tender_id}
          style={{ flex: "1 1 260px", minHeight: 40, minWidth: 0, maxWidth: "100%", borderRadius: 8, border: "1px solid #D6D1C2", padding: "0 10px", fontSize: 13, background: "#FFFFFF", color: "#16233B" }}
        >
          {past.map((p) => (
            <option key={p.tender_id} value={p.tender_id}>
              {[p.contract_no, p.title.slice(0, 70), p.buyer, isPipelineStage(p.stage) ? STAGE_META[p.stage].label : p.stage].filter(Boolean).join(" · ")}
              {p.sameBuyer ? " (same buyer)" : ""}
            </option>
          ))}
        </select>
        <button type="submit" style={quiet}>Show what carries over</button>
      </form>

      {reuseFrom && !plan && (
        <div style={{ fontSize: 12, color: "#B91C1C", marginTop: 12 }}>That tender can&apos;t be used as a starting point for this one.</div>
      )}

      {plan && (
        <div style={{ marginTop: 14 }}>
          {plan.notes.map((n) => (
            <div key={n} style={{ fontSize: 12, color: "#B45309", marginBottom: 8 }}>{n}</div>
          ))}

          {(plan.answers.copy.length > 0 || plan.positions.copy.length > 0) && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#15803D", marginBottom: 2 }}>Will carry over from {plan.source.contract_no ?? "that tender"}</div>
              {plan.answers.copy.map((a) => (
                <div key={a.key} style={row}>
                  <div style={{ color: "#16233B" }}>{a.label}</div>
                  <div style={{ fontWeight: 600, color: "#16233B" }}>{displayValue(a.value, a.key, people)}</div>
                  <div style={{ fontSize: 11, color: "#8A93A0" }}>{a.why}</div>
                </div>
              ))}
              {plan.positions.copy.map((p) => (
                <div key={p.code} style={row}>
                  <div style={{ color: "#16233B" }}>{p.code}{p.description ? ` - ${p.description}` : ""}</div>
                  <div style={{ fontWeight: 600, color: "#16233B" }}>{people.get(p.personId) ?? "person on file"}</div>
                </div>
              ))}
              {plan.flow === "general" && plan.answers.copy.length > 0 && (
                <div style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>
                  The declarations are sworn on the signed forms - read them again before signing, in case anything changed since that tender.
                </div>
              )}
              <form action={applyPastSubmission} style={{ marginTop: 12 }}>
                <input type="hidden" name="tender_id" value={tenderId} />
                <input type="hidden" name="source_tender_id" value={plan.source.tender_id} />
                <button type="submit" style={button}>Use these</button>
              </form>
            </>
          )}

          {nothingToCopy && plan.notes.length === 0 && (
            <div style={{ fontSize: 12, color: "#5B6472" }}>Nothing from that tender to carry over to this one.</div>
          )}

          {skipped.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12, color: "#5B6472", cursor: "pointer" }}>Not carried over ({skipped.length})</summary>
              {skipped.map((s) => (
                <div key={s.key} style={row}>
                  <div style={{ color: "#16233B" }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: "#8A93A0" }}>{s.reason}</div>
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
