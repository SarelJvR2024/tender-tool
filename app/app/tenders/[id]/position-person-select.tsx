"use client";

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
}: {
  tenderId: string;
  tenderPackId: string;
  positionCode: string;
  confirmedPersonId: string | null;
  tagged: PositionCandidate[];
  others: PositionCandidate[];
  roleTitle: string | null;
  suggestions: PositionSuggestions;
}) {
  const [isPending, startTransition] = useTransition();
  const choose = (personId: string | null) =>
    startTransition(() => {
      confirmPositionPerson(tenderId, tenderPackId, positionCode, personId);
    });

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
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch", flex: "1 1 280px", maxWidth: 420 }}>
      {suggestion && confirmedPersonId !== suggestion.id && (
        <div style={{ background: "#FEF3C7", border: "1px solid #F5D08A", borderRadius: 9, padding: "8px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#B45309", letterSpacing: 0.3 }}>
                {confirmedPersonId ? "SUGGESTED INSTEAD" : "SUGGESTED"}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B" }}>{suggestion.name}</div>
              <div style={{ fontSize: 11, color: suggestion.specialismWarning ? "#B91C1C" : "#4B5563" }}>{suggestion.why}</div>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={() => choose(suggestion.id)}
              style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 12, fontWeight: 600, border: "none", cursor: isPending ? "default" : "pointer", opacity: isPending ? 0.6 : 1, whiteSpace: "nowrap" }}
            >
              Confirm {suggestion.name.split(" ")[0]}
            </button>
          </div>
          {suggestions.tied && alternatives[0] && (
            <div style={{ fontSize: 11, color: "#92400E", marginTop: 4 }}>
              Same match score as {alternatives[0].name} - put first on years&apos; experience on file. Check which fits better.
            </div>
          )}
          {basisNote && <div style={{ fontSize: 11, color: "#92400E", marginTop: 4 }}>{basisNote}</div>}
        </div>
      )}
      {alternatives.filter((s) => s.id !== confirmedPersonId).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {alternatives
            .filter((s) => s.id !== confirmedPersonId)
            .map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", fontSize: 12, color: "#16233B", borderTop: "1px solid #F0EEE6", paddingTop: 4 }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>Alternative: {s.name}</span>
                  <span style={{ color: s.specialismWarning ? "#B91C1C" : "#6B6758" }}> - {s.why}</span>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => choose(s.id)}
                  style={{ minHeight: 32, padding: "0 10px", borderRadius: 7, background: "#FFFFFF", color: "#16233B", fontSize: 11, fontWeight: 600, border: "1px solid #E5E1D5", cursor: isPending ? "default" : "pointer", whiteSpace: "nowrap" }}
                >
                  Use
                </button>
              </div>
            ))}
        </div>
      )}
      {!suggestions.scored && (
        <div style={{ fontSize: 11, color: "#9A9684" }}>
          A suggestion appears once the pack builder has scored your people against this position.
        </div>
      )}
      <select
        aria-label={`Confirmed key person for ${positionCode}`}
        value={confirmedPersonId ?? ""}
        disabled={isPending}
        onChange={(e) => choose(e.target.value || null)}
        style={{
          minHeight: 36,
          padding: "0 8px",
          borderRadius: 7,
          border: confirmedPersonId ? "1px solid #E5E1D5" : "1px solid #D97706",
          background: "#FFFFFF",
          color: "#16233B",
          fontSize: 12,
          fontWeight: 600,
          cursor: isPending ? "default" : "pointer",
          opacity: isPending ? 0.6 : 1,
        }}
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
