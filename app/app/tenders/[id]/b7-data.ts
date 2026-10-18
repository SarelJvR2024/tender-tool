import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  PLAN_COLUMNS,
  b7Applicability,
  checkPlan,
  parsePlan,
  type B7Applicability,
  type B7Setup,
  type SubcontractingPlan,
} from "@/lib/sanralB7";

/**
 * Form B7 state for one SANRAL tender and the signed-in company, loaded once
 * per request (React cache()) and shared by the Form B7 card
 * (subcontracting-plan.tsx), the submission-pack card and
 * requestSubmissionPack() - so the gate the card shows is the gate the
 * request enforces, and both match engine/pack/process_pack_jobs.py.
 */
export type B7State = {
  setup: B7Setup;
  companyStatus: string | null;
  plan: SubcontractingPlan | null;
  updatedAt: string | null;
  applies: B7Applicability;
  errors: string[];
  warnings: string[];
  /** Hard stop for the pack: Form B7 applies (or can't be ruled out) and isn't answered, or the answer is invalid. */
  blocker: string | null;
};

export const loadB7State = cache(async (tenderId: string): Promise<B7State> => {
  const supabase = await createClient();
  const [{ data: tender }, { data: company }, { data: planRow }] = await Promise.all([
    supabase.from("tenders").select("sanral_b7_setup").eq("id", tenderId).maybeSingle(),
    // RLS scopes companies to the signed-in user's own company (same read compliance-data.ts makes).
    supabase.from("companies").select("status").maybeSingle(),
    supabase.from("tender_subcontracting_plans").select(PLAN_COLUMNS).eq("tender_id", tenderId).maybeSingle(),
  ]);
  const setup = ((tender?.sanral_b7_setup as B7Setup) ?? null) as B7Setup;
  const companyStatus = (company?.status as string | null) ?? null;
  const plan = planRow ? parsePlan(planRow) : null;
  const applies = b7Applicability(setup, companyStatus, plan);
  const { errors, warnings } = plan ? checkPlan(plan, applies) : { errors: [], warnings: [] };
  const blocker =
    applies.needsPlan && !plan
      ? `Form B7 (subcontracting to Targeted Enterprises) applies and hasn't been answered: ${applies.reason}. Give your plan in the Form B7 card above.`
      : plan && errors.length > 0
        ? `Form B7 subcontracting plan is incomplete: ${errors.join("; ")}.`
        : null;
  return { setup, companyStatus, plan, updatedAt: (planRow?.updated_at as string | null) ?? null, applies, errors, warnings, blocker };
});
