import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "../_components/AuthShell";
import { Step1 } from "./_components/Step1";
import { Step2 } from "./_components/Step2";
import { Step3 } from "./_components/Step3";
import { Step4 } from "./_components/Step4";
import { Step5 } from "./_components/Step5";
import { EndScreen } from "./_components/EndScreen";
import { COMPANY_OFFICE_COLUMNS, type CompanyOffice } from "@/lib/locality";

// Depends on the signed-in user's session, same reason as dashboard/page.tsx.
export const instant = false;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string }>;
}) {
  const { step: stepParam, error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("company_members").select("company_id, daily_digest_opt_in").eq("user_id", user.id).maybeSingle();

  // Nothing else can happen before a company exists - step 1 regardless of
  // the URL's own step param.
  if (!membership) {
    return (
      <AuthShell>
        <Step1 error={error} />
      </AuthShell>
    );
  }

  const companyId = membership.company_id as string;
  const step = stepParam === "done" ? "done" : Number(stepParam) >= 2 && Number(stepParam) <= 5 ? Number(stepParam) : "done";

  if (step === 2) {
    const { data: company } = await supabase
      .from("companies")
      .select("id, csd_supplier_number, sars_tcs_pin, sars_tcs_pin_expiry, bee_level, bee_proof_expiry, cidb_grading, cidb_expiry")
      .eq("id", companyId)
      .single();
    return (
      <AuthShell>
        <Step2 company={company!} error={error} />
      </AuthShell>
    );
  }

  if (step === 3) {
    const { data: offices } = await supabase.from("company_offices").select(COMPANY_OFFICE_COLUMNS).eq("company_id", companyId).order("created_at");
    return (
      <AuthShell>
        <Step3 companyId={companyId} offices={(offices ?? []) as CompanyOffice[]} error={error} />
      </AuthShell>
    );
  }

  if (step === 4) {
    const [{ data: people }, { data: cvs }] = await Promise.all([
      supabase.from("people").select("id, name, role").eq("company_id", companyId).order("created_at"),
      supabase.from("cv_uploads").select("person_id").eq("company_id", companyId),
    ]);
    const cvPersonIds = new Set((cvs ?? []).map((c) => c.person_id as string));
    const rows = (people ?? []).map((p) => ({ ...p, hasCv: cvPersonIds.has(p.id) }));
    return (
      <AuthShell>
        <Step4 companyId={companyId} people={rows} error={error} />
      </AuthShell>
    );
  }

  if (step === 5) {
    return (
      <AuthShell>
        <Step5 digestOptIn={membership.daily_digest_opt_in === true} error={error} />
      </AuthShell>
    );
  }

  // step === "done": the bid-readiness end screen, also the default landing
  // spot for a member who just visits /onboarding with no step param.
  const [{ data: company }, { count: officeCount }, { count: peopleCount }] = await Promise.all([
    supabase.from("companies").select("csd_supplier_number, sars_tcs_pin, bee_level, cidb_grading").eq("id", companyId).single(),
    supabase.from("company_offices").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    supabase.from("people").select("id", { count: "exact", head: true }).eq("company_id", companyId),
  ]);

  return (
    <AuthShell>
      <EndScreen
        hasCompliance={!!(company?.csd_supplier_number || company?.sars_tcs_pin || company?.bee_level)}
        hasCidb={!!company?.cidb_grading}
        officeCount={officeCount ?? 0}
        peopleCount={peopleCount ?? 0}
        digestOptIn={membership.daily_digest_opt_in === true}
      />
    </AuthShell>
  );
}
