import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBidReadiness, type ReadinessResult } from "./readiness";
import { fetchAllRows } from "./supabasePaging";

/**
 * Fetches the real data computeBidReadiness() needs and scores it - the one
 * place all three surfaces (dashboard, Company vault header, onboarding end
 * screen) get the score from, so they can never quietly disagree. Not part
 * of lib/readiness.ts itself: that file stays a pure function with no
 * Supabase call in it, specifically so it can be unit-tested without a
 * database. No company_id filter on any query below - RLS already scopes
 * every one of these tables to the signed-in user's own company, same as
 * every other query in this app.
 *
 * `cv_uploads` is read via fetchAllRows(), not a plain `.select()` - the same
 * class of bug lib/marketPricing.ts (PR #111) and lib/discoveryPagination.ts
 * were each fixed for: PostgREST silently caps a single response at 1000
 * rows (db-max-rows) regardless of any client-side `.limit()`. cv_uploads is
 * exactly the shape that bites (migration 0008: "Re-uploading a newer CV is
 * a new row (history kept), not an overwrite" - one company's own upload
 * history grows forever, no retention), so a long-lived company could pass
 * 1000 rows and silently undercount distinct people-with-a-CV. The other two
 * counts below stay plain `count: "exact", head: true` queries - PostgREST's
 * exact row count isn't capped by db-max-rows, only the actual row data is,
 * so those were never at risk.
 */
export async function fetchCompanyReadiness(supabase: SupabaseClient): Promise<ReadinessResult> {
  const [{ data: company }, { count: principalCount }, cvUploads, { count: experienceCount }] = await Promise.all([
    supabase
      .from("companies")
      .select("legal_name, csd_supplier_number, sars_tcs_pin, sars_tcs_pin_expiry, bee_level, bee_proof_expiry, cidb_grading, cidb_expiry, bank_confirmation_letter_valid_until")
      .maybeSingle(),
    supabase.from("company_principals").select("id", { count: "exact", head: true }),
    fetchAllRows<{ person_id: string }>(
      (from, to) => supabase.from("cv_uploads").select("person_id").range(from, to),
      20_000,
    ),
    supabase.from("experience_items").select("id", { count: "exact", head: true }),
  ]);

  const peopleWithCvCount = new Set(cvUploads.rows.map((r) => r.person_id)).size;

  return computeBidReadiness({
    legalName: company?.legal_name ?? null,
    csdSupplierNumber: company?.csd_supplier_number ?? null,
    taxPin: company?.sars_tcs_pin ?? null,
    taxPinExpiry: company?.sars_tcs_pin_expiry ?? null,
    beeLevel: company?.bee_level ?? null,
    beeProofExpiry: company?.bee_proof_expiry ?? null,
    cidbGrading: company?.cidb_grading ?? null,
    cidbExpiry: company?.cidb_expiry ?? null,
    bankConfirmationValidUntil: company?.bank_confirmation_letter_valid_until ?? null,
    principalCount: principalCount ?? 0,
    peopleWithCvCount,
    experienceProjectCount: experienceCount ?? 0,
  });
}
