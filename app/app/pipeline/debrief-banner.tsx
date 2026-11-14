import { formatRand } from "@/lib/dealEconomics";
import { ConfirmSubmitButton } from "../_components/ConfirmSubmitButton";
import { dismissDebriefBanner, recordOutcomeAndMoveStage } from "./actions";

/**
 * "Government outcome published" (Claude-Brief-Awards-Intelligence_v2.md
 * Phase 4, Sarel 2026-11-14) - a published award (matchPursuitsToAwards(),
 * lib/awardsIntelligence.ts) found for a tender still sitting at
 * 'submitted'. "Confirm Won"/"Confirm Lost" pre-fill and submit the SAME
 * existing outcome form (recordOutcomeAndMoveStage, this file's own
 * actions.ts) that already moves pipeline_stage and records the outcome -
 * nothing new needed there. ConfirmSubmitButton (a plain window.confirm()
 * intercept on the submit click, no new mechanism) satisfies "clicking
 * Confirm must require user confirmation" literally.
 *
 * Never auto-fires: this banner only ever appears, it never itself writes
 * anything. A click is required for either Confirm button; Dismiss is the
 * one new write (debrief_dismissed_at, migration 0145) and still requires
 * its own explicit click.
 */
export function DebriefBanner({
  tenderId,
  winnerName,
  winnerAmountZar,
  companyWon,
}: {
  tenderId: string;
  winnerName: string;
  winnerAmountZar: number | null;
  companyWon: boolean;
}) {
  return (
    <div className="mb-2.5 rounded-lg border border-accent/30 bg-accent/10 p-3">
      <div className="text-sm font-bold text-accent">Government outcome published</div>
      <div className="mt-0.5 text-xs text-foreground">
        Awarded to <strong>{winnerName}</strong>
        {winnerAmountZar !== null && <> for {formatRand(winnerAmountZar)}</>}.
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <form action={recordOutcomeAndMoveStage}>
          <input type="hidden" name="tender_id" value={tenderId} />
          <input type="hidden" name="stage" value="won" />
          <input type="hidden" name="winning_company" value={winnerName} />
          {winnerAmountZar !== null && <input type="hidden" name="winning_price" value={String(winnerAmountZar)} />}
          <ConfirmSubmitButton
            confirmMessage={`Confirm this tender was WON (by ${winnerName}${winnerAmountZar !== null ? ` for ${formatRand(winnerAmountZar)}` : ""})? This moves it to Won on your pipeline board.`}
            className="min-h-9 rounded-md bg-success px-3 text-xs font-semibold text-success-foreground hover:opacity-90"
          >
            Confirm Won
          </ConfirmSubmitButton>
        </form>
        <form action={recordOutcomeAndMoveStage}>
          <input type="hidden" name="tender_id" value={tenderId} />
          <input type="hidden" name="stage" value="lost" />
          <input type="hidden" name="winning_company" value={winnerName} />
          {winnerAmountZar !== null && <input type="hidden" name="winning_price" value={String(winnerAmountZar)} />}
          <ConfirmSubmitButton
            confirmMessage={`Confirm this tender was LOST (to ${winnerName})? This moves it to Lost on your pipeline board.`}
            className="min-h-9 rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted"
          >
            Confirm Lost
          </ConfirmSubmitButton>
        </form>
        <form action={dismissDebriefBanner}>
          <input type="hidden" name="tender_id" value={tenderId} />
          <button type="submit" className="min-h-9 rounded-md px-3 text-xs font-semibold text-muted-foreground hover:bg-muted">
            Dismiss
          </button>
        </form>
      </div>
      {companyWon === false && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          Not matched to one of your own company names on the award - check before confirming either way.
        </div>
      )}
    </div>
  );
}
