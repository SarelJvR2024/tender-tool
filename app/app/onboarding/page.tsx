import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "../_components/AuthShell";
import { Step1 } from "./_components/Step1";
import { AddDocumentsScreen } from "./_components/AddDocumentsScreen";

// Depends on the signed-in user's session, same reason as dashboard/page.tsx.
export const instant = false;

/**
 * Two short screens (spec v3 §3), not a wizard. Screen 1 ("Your company")
 * creates the company; Screen 2 ("Add documents, or start now") is purely
 * optional and reuses the existing document-scan upload/classify/review
 * engine (spec v3 Batch 2, #103).
 *
 * This used to branch on a `step` param across 6 steps plus a "done" bid-
 * readiness end screen that duplicated what Home already shows. Now: no
 * membership yet -> Screen 1, regardless of the URL (nothing else can
 * happen before a company exists). Membership exists and the URL explicitly
 * asks for step=2 -> Screen 2 (the one redirect target Screen 1's own
 * action produces). Anything else - no param, a stale step=3..6 or
 * step=done link, gibberish - sends a member who already has a company
 * straight to Home: onboarding is never a gate once the company exists
 * (spec v3 O09/O18), and Home's own checklist already prompts for whatever
 * is still missing (spec v3 §3) - no separate "onboarding complete" screen
 * needed, and no risk of it ever implying a company is tender-ready just
 * because these two screens are done.
 */
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

  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();

  if (!membership) {
    return (
      <AuthShell>
        <Step1 error={error} />
      </AuthShell>
    );
  }

  if (stepParam === "2") {
    return (
      <AuthShell>
        <AddDocumentsScreen companyId={membership.company_id as string} />
      </AuthShell>
    );
  }

  redirect("/dashboard");
}
