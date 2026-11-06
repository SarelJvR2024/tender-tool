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

  const { data: membership, error: membershipError } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (membershipError) console.error("onboarding: company_members read failed", membershipError);

  if (!membership) {
    // A failed read (membershipError truthy) is indistinguishable from the
    // genuine "no company yet" case below unless flagged explicitly - an
    // already-onboarded member who lands here (a stale bookmark/link, or
    // proxy.ts's own equivalent redirect on a transient blip) would
    // otherwise see Screen 1 ("create your company") with no hint anything
    // is wrong. migration 0116's unique constraint means submitting it
    // would fail safely rather than create a duplicate company, but still
    // warn first rather than let them submit into a confusing error with no
    // context.
    return (
      <AuthShell>
        <Step1
          error={
            error ??
            (membershipError
              ? "Couldn't check whether your company is already set up - refresh before continuing. If you already have one, creating a new one now would fail safely, but please refresh first."
              : undefined)
          }
        />
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
