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
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
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
      className={`rounded-md border border-warning bg-card px-3 py-1 text-xs font-semibold whitespace-nowrap text-warning ${isPending ? "cursor-default opacity-60" : "cursor-pointer"}`}
    >
      Looks right
    </button>
  );
}
