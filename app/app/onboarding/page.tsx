import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchCompanyReadiness } from "@/lib/companyReadinessData";
import { COMPANY_OFFICE_COLUMNS, type CompanyOffice } from "@/lib/locality";
import { BidReadinessCard } from "@/components/tt/bid-readiness-card";
import { buttonVariants } from "@/components/ui/button";
import { AuthShell } from "../_components/AuthShell";
import { Step1 } from "./_components/Step1";
import { Step2 } from "./_components/Step2";
import { Step3 } from "./_components/Step3";
import { Step4 } from "./_components/Step4";
import { Step5 } from "./_components/Step5";

// Depends on the signed-in user's session, same reason as dashboard/page.tsx.
export const instant = false;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string }>;
}) {
  const { step: stepParam, error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id, daily_digest_opt_in")
    .eq("user_id", user.id)
    .maybeSingle();

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
  // spot for a member who just visits /onboarding with no step param. Same
  // score (lib/readiness.ts, via lib/companyReadinessData.ts) the dashboard
  // and Company vault header show - never computed separately here.
  const readiness = await fetchCompanyReadiness(supabase);

  return (
    <AuthShell>
      <div className="w-full max-w-xl">
        <BidReadinessCard result={readiness} />
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <Link href="/discovery" className={buttonVariants({ variant: "accent", className: "h-11 flex-1" })}>
            See matching opportunities
          </Link>
          <Link href="/tenders/new" className={buttonVariants({ variant: "outline", className: "h-11 flex-1" })}>
            Load a tender I already have
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
