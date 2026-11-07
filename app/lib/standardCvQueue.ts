import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const STANDARD_CV_FORMATS = ["sanral_keyperson", "world_bank"] as const;
const STANDARD_CV_DETAILS = ["summary", "detailed"] as const;

/**
 * Queue the four standard (non-tender-specific) CV formats for one person,
 * unless a set is already waiting to be built (re-confirming twice
 * shouldn't stack duplicate jobs). Returns true on failure, null on
 * success.
 *
 * Shared by every real "confirm/apply a CV extraction" action -
 * app/app/people/actions.ts applyCvExtraction() (the full People page, the
 * original and, until now, only caller) and app/app/my-cv/actions.ts
 * applyMyCvExtraction() (the employee self-service "My CV" page, 0065) -
 * so a person's standard CVs get queued the same way regardless of which
 * of the two "confirm this CV extraction" screens actually applied their
 * fields.
 *
 * Moved out of app/app/people/actions.ts into this shared module (standing
 * solution-architect review, 2026-11-07) after applyMyCvExtraction() was
 * found to never call it at all, unlike its true sibling applyCvExtraction()
 * - no comment anywhere explained the omission, and the engine/general's
 * pack-build CV lookup (process_general_jobs.py's own per-role
 * generated_cvs select, which takes the newest 'ready' row regardless of
 * tender_id) is a real, live consumer of exactly these standard rows as its
 * fallback CV source. A person whose CV extraction was confirmed
 * exclusively through My CV therefore never had a single standard CV
 * queued, and - because apply_my_cv_extraction_checked()/
 * apply_cv_extraction_checked() both require the extraction's own
 * review_status to still be 'pending_review' - there was no way to retry
 * once it had already been applied: the person's own "My generated CVs"
 * card, and the full People page's identical card, would show "None
 * generated yet." forever, and a general-tender pack tagging that person
 * for a role would show "no CV uploaded or generated for this person" even
 * though their CV fields were, in fact, fully confirmed.
 *
 * Unlike requestTenderCv()'s own dedupe check, this one has NO database-
 * level backstop - migration 0075 (generated_cvs_dedupe_pending_idx)
 * deliberately scoped its unique index to tender_pack_id is not null,
 * explicitly leaving the standard (non-tender) path "out of scope... left
 * out of scope deliberately rather than guessing at a different dedupe
 * rule for it" (see that migration's own header). So THIS read failing
 * silently and treating an unreadable "pending?" check as "no, nothing
 * pending" is not a safe-direction cosmetic gap the way the tender-specific
 * path's equivalent check is (that one has 0075's unique index catching the
 * race) - it is the one and only thing stopping a transient read failure
 * from queueing a second, fully duplicate set of 4 standard-CV jobs onto
 * the shared worker pool, exactly the "unlimited generation jobs on a
 * worker pool shared across every company" abuse 0075's own header names
 * as the original finding.
 */
export async function queueStandardCvs(
  supabase: SupabaseClient,
  companyId: string,
  personId: string,
  userId: string | null,
) {
  const { data: pending, error: pendingError } = await supabase
    .from("generated_cvs")
    .select("id")
    .eq("person_id", personId)
    .is("tender_id", null)
    .in("status", ["requested", "generating"])
    .limit(1);
  if (pendingError) {
    console.error("generated_cvs pending-check failed for standard CV queue", pendingError);
    return true;
  }
  if ((pending ?? []).length > 0) return null;
  const standardJobs = STANDARD_CV_FORMATS.flatMap((format) =>
    STANDARD_CV_DETAILS.map((detail) => ({
      company_id: companyId,
      person_id: personId,
      format,
      detail,
      status: "requested" as const,
      requested_by: userId,
    })),
  );
  const { error } = await supabase.from("generated_cvs").insert(standardJobs);
  if (error) console.error("generated_cvs insert failed for standard CV queue", error);
  return error ? true : null;
}
