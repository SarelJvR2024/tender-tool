import { formatRand, toNumber } from "@/lib/dealEconomics";
import { recordOutcomeAndMoveStage } from "./actions";
import type { PipelineStage } from "@/lib/pipeline";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export type Outcome = {
  winningCompany: string | null;
  winningPriceZar: string | null;
  biddersCount: string | null;
  reasonLost: string | null;
};

/**
 * "Moving to Awarded/Lost opens an outcome form" (prompt 10, item 4): winning
 * company, winning price, number of bidders, reason lost - see
 * recordOutcomeAndMoveStage (pipeline/actions.ts) for why these 4 live in
 * tender_answers rather than a new table/migration. Shown on Submitted (to
 * record the outcome as part of the move) and on Awarded/Lost (to correct
 * it later) - never on Found/Bidding, which have no outcome yet.
 *
 * Design-system audit fix (2026-10-21): converted from inline-CSSProperties
 * stale hex to Tailwind + design tokens (shadcn Input/Label/Button, the
 * same min-h-11 touch-target convention the rest of the app's forms use).
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
    <details className="mt-2 border-t border-border pt-2" open={stage === "submitted" && !hasOutcome}>
      <summary className="min-h-8 cursor-pointer text-xs font-semibold text-muted-foreground">{summaryText}</summary>
      <form action={recordOutcomeAndMoveStage} className="mt-1 flex flex-col gap-2">
        <input type="hidden" name="tender_id" value={tenderId} />

        <div>
          <Label htmlFor={`wc-${tenderId}`} className="mb-1 text-[10px] font-semibold text-muted-foreground">Winning company</Label>
          <Input id={`wc-${tenderId}`} name="winning_company" placeholder="e.g. us, or another firm's name" defaultValue={outcome.winningCompany ?? ""} className="min-h-11 text-xs" />
        </div>

        <div>
          <Label htmlFor={`wp-${tenderId}`} className="mb-1 text-[10px] font-semibold text-muted-foreground">Winning price (R)</Label>
          <Input id={`wp-${tenderId}`} name="winning_price" inputMode="decimal" placeholder="e.g. 1 250 000" defaultValue={outcome.winningPriceZar ?? ""} className="min-h-11 text-xs" />
        </div>

        <div>
          <Label htmlFor={`bc-${tenderId}`} className="mb-1 text-[10px] font-semibold text-muted-foreground">Number of bidders</Label>
          <Input id={`bc-${tenderId}`} name="bidders_count" inputMode="numeric" placeholder="e.g. 6" defaultValue={outcome.biddersCount ?? ""} className="min-h-11 text-xs" />
        </div>

        <div>
          <Label htmlFor={`rl-${tenderId}`} className="mb-1 text-[10px] font-semibold text-muted-foreground">Reason lost (if applicable)</Label>
          <Input id={`rl-${tenderId}`} name="reason_lost" placeholder="e.g. priced too high" defaultValue={outcome.reasonLost ?? ""} className="min-h-11 text-xs" />
        </div>

        <div className="flex gap-1.5 pt-1">
          <Button type="submit" name="stage" value="won" variant="success" className="min-h-11 flex-1 text-xs font-bold">
            Mark Awarded
          </Button>
          <Button type="submit" name="stage" value="lost" variant="destructive" className="min-h-11 flex-1 text-xs font-bold">
            Mark Lost
          </Button>
        </div>
      </form>
    </details>
  );
}
