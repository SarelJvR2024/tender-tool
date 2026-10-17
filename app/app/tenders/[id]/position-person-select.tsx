"use client";

import { useTransition } from "react";
import { confirmPositionPerson } from "./pack-inputs-actions";

export type PositionCandidate = { id: string; name: string };

/**
 * Inline "who fills this position on THIS tender" control - same plain
 * select, pick it, it persists shape as task-assignee-select.tsx, writing
 * tender_pack_assignments.confirmed_person_id. People tagged for the
 * position's role (person_role_eligibility, 0016) are listed first.
 */
export function PositionPersonSelect({
  tenderId,
  tenderPackId,
  positionCode,
  confirmedPersonId,
  tagged,
  others,
  roleTitle,
}: {
  tenderId: string;
  tenderPackId: string;
  positionCode: string;
  confirmedPersonId: string | null;
  tagged: PositionCandidate[];
  others: PositionCandidate[];
  roleTitle: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      aria-label={`Confirmed key person for ${positionCode}`}
      value={confirmedPersonId ?? ""}
      disabled={isPending}
      onChange={(e) =>
        startTransition(() => {
          confirmPositionPerson(tenderId, tenderPackId, positionCode, e.target.value || null);
        })
      }
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
        maxWidth: 240,
      }}
    >
      <option value="">Not confirmed - choose a person</option>
      {tagged.length > 0 && (
        <optgroup label={roleTitle ? `Tagged as fitting ${roleTitle}` : "Tagged for this role"}>
          {tagged.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label={tagged.length > 0 ? "Everyone else in People" : "People"}>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
