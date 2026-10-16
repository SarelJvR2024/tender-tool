"use client";

import { useState, useTransition } from "react";
import { markFieldReviewed } from "./actions";

/**
 * "Looks right" button on an assumed_default field. Calls a no-op server
 * action (see actions.ts TODO - there's no reviewed_at column to persist
 * this to yet) and just flips local UI state so the reviewer gets feedback
 * that their tap registered. Not shared/synced across viewers or reloads.
 */
export function ReviewButton({ fieldKey }: { fieldKey: string }) {
  const [reviewed, setReviewed] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (reviewed) {
    return (
      <span style={{ fontSize: 12, fontWeight: 600, color: "#15803D", display: "inline-flex", alignItems: "center", gap: 4 }}>
        Looks right ✓
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await markFieldReviewed(fieldKey);
          setReviewed(true);
        })
      }
      style={{
        padding: "5px 12px",
        borderRadius: 7,
        border: "1px solid #B45309",
        background: "#FFFFFF",
        color: "#B45309",
        fontSize: 12,
        fontWeight: 600,
        cursor: isPending ? "default" : "pointer",
        opacity: isPending ? 0.6 : 1,
        whiteSpace: "nowrap",
      }}
    >
      Looks right
    </button>
  );
}
