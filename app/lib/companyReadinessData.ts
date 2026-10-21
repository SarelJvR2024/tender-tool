import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBidReadiness, type ReadinessResult } from "./readiness";

/**
 * Fetches the real data computeBidReadiness() needs and scores it - the one
 * place all three surfaces (dashboard, Company vault header, onboarding end
 * screen) get the score from, so they can never quietly disagree. Not part
 * of lib/readiness.ts itself: that file stays a pure function with no
 * Supabase call in it, specifically so it can be unit-tested without a
 * database. No company_id filter on any query below - RLS already scopes
 * every one of these tables to the signed-in user's own company, same as
 * every other query in this app.
 */
export async function fetchCompanyReadiness(supabase: SupabaseClient): Promise<ReadinessResult> {
  const [{ data: company }, { count: principalCount }, { data: cvRows }, { count: experienceCount }] = await Promise.all([
    supabase
      .from("companies")
      .select("legal_name, csd_supplier_number, sars_tcs_pin, sars_tcs_pin_expiry, bee_level, bee_proof_expiry, cidb_grading, cidb_expiry, bank_confirmation_letter_valid_until")
      .maybeSingle(),
    supabase.from("company_principals").select("id", { count: "exact", head: true }),
    supabase.from("cv_uploads").select("person_id"),
    supabase.from("experience_items").select("id", { count: "exact", head: true }),
  ]);

  const peopleWithCvCount = new Set((cvRows ?? []).map((r: { person_id: string }) => r.person_id)).size;

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
