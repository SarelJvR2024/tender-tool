import Link from "next/link";
import { WizardShell } from "./WizardShell";
import { PAYABLE_PLAN_TIERS, PLAN_LABEL, priceForPlanZar, trialDaysLeft, type CompanySubscriptionRow } from "@/lib/billing";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * New, additive step (not in the original 5-step wizard) - Sarel's PayFast
 * billing piece added a 14-day trial, and this is the one place a brand
 * new signup actually sees it and can subscribe straight away if they want
 * to. Deliberately thin: it reuses app/billing's own checkout links (same
 * /api/billing/checkout route, same lib/billing.ts pricing) rather than a
 * separate onboarding-only checkout path - "Skip for now" (same pattern as
 * every other step) just continues the trial already running since company
 * creation (step 1's companies insert, via the companies_start_trial
 * trigger - migration 0078), so skipping here changes nothing.
 */
export function Step6({ subscription }: { subscription: CompanySubscriptionRow | null }) {
  const daysLeft = subscription ? trialDaysLeft(subscription) : null;
  return (
    <WizardShell
      step={6}
      description={
        daysLeft !== null
          ? `You're on a free ${daysLeft}-day trial of Professional already - subscribe now, or skip and decide later from Billing.`
          : "Subscribe now, or skip and decide later from Billing."
      }
    >
      <div className="mb-5 flex flex-col gap-3">
        {PAYABLE_PLAN_TIERS.map((plan) => (
          <div key={plan} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <div className="text-sm font-semibold text-foreground">{PLAN_LABEL[plan]}</div>
              <div className="text-xs text-muted-foreground">R{priceForPlanZar(plan, "monthly").toLocaleString("en-ZA")}/month, or yearly for 2 months free</div>
            </div>
            <Link
              href={`/api/billing/checkout?plan=${plan}&interval=monthly`}
              className={cn(buttonVariants({ variant: plan === "professional" ? "accent" : "outline" }), "h-10 shrink-0")}
            >
              Subscribe
            </Link>
          </div>
        ))}
      </div>
    </WizardShell>
  );
}
