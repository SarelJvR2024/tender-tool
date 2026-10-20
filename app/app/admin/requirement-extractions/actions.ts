"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Records one platform-admin verdict on one engine/general/requirements.py
 * extraction item, via submit_requirement_extraction_review() (migration
 * 0074 - is_platform_admin()-gated SECURITY DEFINER, same escape-hatch
 * pattern as every other admin RPC). Called directly from the client row
 * component (RequirementItemRow), not through a <form action>, so the row
 * can drop out of the list on success without a full page navigation - see
 * that component for the optimistic-removal side of this.
 *
 * p_corrected_value is parsed from the admin's own JSON/text input here, not
 * on the client, so a bad paste surfaces as this action's own error instead
 * of a client-side throw.
 */
export async function submitRequirementReview(input: {
  tenderId: string;
  itemKey: string;
  itemType: string;
  itemSnapshot: unknown;
  verdict: "correct" | "corrected" | "false_positive";
  correctedValueRaw: string | null; // only meaningful when verdict is "corrected"
  note: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  let correctedValue: unknown = null;
  if (input.verdict === "corrected") {
    const raw = (input.correctedValueRaw ?? "").trim();
    if (!raw) return { ok: false, error: "Enter the corrected value before saving." };
    try {
      correctedValue = JSON.parse(raw);
    } catch {
      // Not valid JSON - treat it as a plain corrected quote/string rather
      // than rejecting it; most corrections here are "the quote should have
      // been X", not a hand-built object.
      correctedValue = raw;
    }
  }

  const { error } = await supabase.rpc("submit_requirement_extraction_review", {
    p_tender_id: input.tenderId,
    p_item_key: input.itemKey,
    p_item_type: input.itemType,
    p_item_snapshot: input.itemSnapshot,
    p_verdict: input.verdict,
    p_corrected_value: correctedValue,
    p_note: input.note?.trim() || null,
  });
  if (error) {
    console.error("submit_requirement_extraction_review rpc failed", error);
    return { ok: false, error: "Could not save this review - try again. If it keeps happening, let us know." };
  }
  return { ok: true };
}
