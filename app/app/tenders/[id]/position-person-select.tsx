"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { confirmPositionPerson } from "./pack-inputs-actions";
import type { PositionSuggestions, Suggestion } from "@/lib/positionSuggestions";

export type PositionCandidate = { id: string; name: string };

/**
 * Who fills this position on THIS tender, writing
 * tender_pack_assignments.confirmed_person_id (same "pick it, it persists"
 * shape as task-assignee-select.tsx).
 *
 * The best-scoring eligible person is suggested, with up to two alternatives
 * and a one-line reason each (app/lib/positionSuggestions.ts, from the
 * existing score_candidate() ranking). "Confirm" takes the suggestion; "Use"
 * takes an alternative; the dropdown still lists everyone - suggested first,
 * then the rest of the people tagged for the role, then everyone else.
 */
export function PositionPersonSelect({
  tenderId,
  tenderPackId,
  positionCode,
  confirmedPersonId,
  tagged,
  others,
  roleTitle,
  suggestions,
  demo,
}: {
  tenderId: string;
  tenderPackId: string;
  positionCode: string;
  confirmedPersonId: string | null;
  tagged: PositionCandidate[];
  others: PositionCandidate[];
  roleTitle: string | null;
  suggestions: PositionSuggestions;
  // Set by the no-signup demo (spec §6): same real suggestion ranking and
  // layout, but "Confirm"/"Use"/the dropdown send a visitor to sign up
  // instead of writing tender_pack_assignments.confirmed_person_id - there
  // is no real tenderPackId behind a sample tender to write to.
  demo?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const choose = (personId: string | null) => {
    if (demo) {
      router.push("/signup");
      return;
    }
    startTransition(() => {
      confirmPositionPerson(tenderId, tenderPackId, positionCode, personId);
    });
  };

  const { suggestion, alternatives } = suggestions;
  const top = [suggestion, ...alternatives].filter((s): s is Suggestion => !!s);
  const topIds = new Set(top.map((s) => s.id));
  const restTagged = tagged.filter((p) => !topIds.has(p.id));
  const restOthers = others.filter((p) => !topIds.has(p.id));
  const basisNote =
    suggestions.basis === "everyone"
      ? roleTitle
        ? `Nobody is tagged as fitting ${roleTitle} yet, so this is ranked across everyone in People.`
        : "This position's role can't be told from its description, so this is ranked across everyone in People."
      : null;

  return (
    <div className="flex flex-[1_1_280px] max-w-[420px] flex-col items-stretch gap-2">
      {suggestion && confirmedPersonId !== suggestion.id && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold tracking-wide text-warning">
                  {confirmedPersonId ? "SUGGESTED INSTEAD" : "SUGGESTED"}
                </span>
                {/* Keyword-overlap ratio, not a calibrated probability - see
                    lib/positionSuggestions.ts's own Suggestion.matchPercent comment. */}
                {suggestion.matchPercent !== null && (
                  <span
                    title="Share of this position's own keywords this person has evidence of - a quick signal, not a certified score"
                    className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground"
                  >
                    {suggestion.matchPercent}% match
                  </span>
                )}
              </div>
              <div className="text-[13px] font-bold text-foreground">{suggestion.name}</div>
              <div className={`text-[11px] ${suggestion.specialismWarning ? "text-destructive" : "text-muted-foreground"}`}>{suggestion.why}</div>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={() => choose(suggestion.id)}
              className={`min-h-9 rounded-lg border-none bg-foreground px-3.5 text-xs font-semibold whitespace-nowrap text-white ${isPending ? "cursor-default opacity-60" : "cursor-pointer"}`}
            >
              Confirm {suggestion.name.split(" ")[0]} for bid
            </button>
          </div>
          {suggestions.tied && alternatives[0] && (
            <div className="mt-1 text-[11px] text-warning">
              Same match score as {alternatives[0].name} - put first on years&apos; experience on file. Check which fits better.
            </div>
          )}
          {basisNote && <div className="mt-1 text-[11px] text-warning">{basisNote}</div>}
        </div>
      )}
      {alternatives.filter((s) => s.id !== confirmedPersonId).length > 0 && (
        <div className="flex flex-col gap-1">
          {alternatives
            .filter((s) => s.id !== confirmedPersonId)
            .map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 border-t border-border pt-1 text-xs text-foreground">
                <div className="min-w-0">
                  <span className="font-semibold">Alternative: {s.name}</span>
                  {s.matchPercent !== null && (
                    <>
                      {" "}
                      <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">{s.matchPercent}% match</span>
                    </>
                  )}
                  <span className={s.specialismWarning ? "text-destructive" : "text-muted-foreground"}> - {s.why}</span>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => choose(s.id)}
                  className={`min-h-8 rounded-md border border-border bg-card px-2.5 text-[11px] font-semibold whitespace-nowrap text-foreground ${isPending ? "cursor-default" : "cursor-pointer"}`}
                >
                  Swap candidate
                </button>
              </div>
            ))}
        </div>
      )}
      {!suggestions.scored && (
        <div className="text-[11px] text-muted-foreground">
          A suggestion appears once the pack builder has scored your people against this position.
        </div>
      )}
      {suggestions.scored && suggestions.noSuitableCandidate && (
        <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
          <strong className="text-foreground">No suitable candidate identified</strong> - nobody on file has any ECSA
          registration, years&apos; experience, or keyword match for this position. Choose someone manually below if
          you know who it should be.
        </div>
      )}
      <select
        aria-label={`Confirmed key person for ${positionCode}`}
        value={confirmedPersonId ?? ""}
        disabled={isPending}
        onChange={(e) => choose(e.target.value || null)}
        className={`min-h-9 rounded-md border bg-card px-2 text-xs font-semibold text-foreground ${
          confirmedPersonId ? "border-border" : "border-accent"
        } ${isPending ? "cursor-default opacity-60" : "cursor-pointer"}`}
      >
        <option value="">{confirmedPersonId ? "Clear - not confirmed" : "Or choose anyone else…"}</option>
        {top.length > 0 && (
          <optgroup label="Suggested">
            {top.map((s, i) => (
              <option key={s.id} value={s.id}>
                {s.name} {i === 0 ? "(best match)" : "(alternative)"}
              </option>
            ))}
          </optgroup>
        )}
        {restTagged.length > 0 && (
          <optgroup label={roleTitle ? `Also tagged as fitting ${roleTitle}` : "Also tagged for this role"}>
            {restTagged.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        {restOthers.length > 0 && (
          <optgroup label={tagged.length > 0 || top.length > 0 ? "Everyone else in People" : "People"}>
            {restOthers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
