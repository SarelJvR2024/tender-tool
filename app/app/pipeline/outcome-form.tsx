import { formatRand, toNumber } from "@/lib/dealEconomics";
import { recordOutcomeAndMoveStage } from "./actions";
import type { PipelineStage } from "@/lib/pipeline";

export type Outcome = {
  winningCompany: string | null;
  winningPriceZar: string | null;
  biddersCount: string | null;
  reasonLost: string | null;
};

const label: React.CSSProperties = { display: "block", fontSize: 10, fontWeight: 600, color: "#5B6472", margin: "6px 0 2px" };
const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 32,
  padding: "0 8px",
  borderRadius: 6,
  border: "1px solid #E3E6EA",
  background: "#FFFFFF",
  fontSize: 12,
  color: "#16233B",
};

/**
 * "Moving to Awarded/Lost opens an outcome form" (prompt 10, item 4): winning
 * company, winning price, number of bidders, reason lost - see
 * recordOutcomeAndMoveStage (pipeline/actions.ts) for why these 4 live in
 * tender_answers rather than a new table/migration. Shown on Submitted (to
 * record the outcome as part of the move) and on Awarded/Lost (to correct
 * it later) - never on Found/Bidding, which have no outcome yet.
 */
export function OutcomeForm({ tenderId, stage, outcome }: { tenderId: string; stage: PipelineStage; outcome: Outcome }) {
  if (stage !== "submitted" && stage !== "won" && stage !== "lost") return null;
  const hasOutcome = !!(outcome.winningCompany || outcome.winningPriceZar || outcome.biddersCount || outcome.reasonLost);
  const summaryText =
    stage === "submitted"
      ? "Record outcome"
      : hasOutcome
        ? `Outcome: ${outcome.winningCompany ?? (stage === "won" ? "us" : "unknown winner")}${outcome.winningPriceZar ? ` · ${formatRand(toNumber(outcome.winningPriceZar))}` : ""}`
        : "Add outcome details";

  return (
    <details style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #ECEEF1" }} open={stage === "submitted" && !hasOutcome}>
      <summary style={{ cursor: "pointer", listStyle: "revert", fontSize: 11, fontWeight: 600, color: "#5B6472" }}>{summaryText}</summary>
      <form action={recordOutcomeAndMoveStage} style={{ marginTop: 4 }}>
        <input type="hidden" name="tender_id" value={tenderId} />

        <label style={label} htmlFor={`wc-${tenderId}`}>Winning company</label>
        <input id={`wc-${tenderId}`} name="winning_company" placeholder="e.g. us, or another firm's name" defaultValue={outcome.winningCompany ?? ""} style={input} />

        <label style={label} htmlFor={`wp-${tenderId}`}>Winning price (R)</label>
        <input id={`wp-${tenderId}`} name="winning_price" inputMode="decimal" placeholder="e.g. 1 250 000" defaultValue={outcome.winningPriceZar ?? ""} style={input} />

        <label style={label} htmlFor={`bc-${tenderId}`}>Number of bidders</label>
        <input id={`bc-${tenderId}`} name="bidders_count" inputMode="numeric" placeholder="e.g. 6" defaultValue={outcome.biddersCount ?? ""} style={input} />

        <label style={label} htmlFor={`rl-${tenderId}`}>Reason lost (if applicable)</label>
        <input id={`rl-${tenderId}`} name="reason_lost" placeholder="e.g. priced too high" defaultValue={outcome.reasonLost ?? ""} style={input} />

        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button
            type="submit"
            name="stage"
            value="won"
            style={{ flex: 1, minHeight: 36, border: "1px solid #15803D", borderRadius: 7, background: "#DCFCE7", color: "#15803D", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
          >
            Mark Awarded
          </button>
          <button
            type="submit"
            name="stage"
            value="lost"
            style={{ flex: 1, minHeight: 36, border: "1px solid #B91C1C", borderRadius: 7, background: "#FEE2E2", color: "#B91C1C", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
          >
            Mark Lost
          </button>
        </div>
      </form>
    </details>
  );
}
