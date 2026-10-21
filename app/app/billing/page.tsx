import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_components/AppShell";
import { fetchCompanySubscription } from "@/lib/companySubscription";
import {
  PLAN_LABEL,
  effectiveSubscriptionStatus,
  isSubscriptionLapsed,
  priceForPlanZar,
  trialDaysLeft,
  yearlyPriceZar,
  type BillingInterval,
  type PlanTier,
} from "@/lib/billing";
import { PageHeader } from "@/components/tt/page-header";
import { SectionCard } from "@/components/tt/section-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Depends on the signed-in user's own subscription row, same reason as
// every other RLS-scoped page in this app.
export const instant = false;

const PLAN_FEATURES: Record<PlanTier, string[]> = {
  watch: ["Discovery, fit verdict and score outlook", "Vault with expiry, view only", "1 compliance report a month"],
  pro: ["Everything in Watch, plus reminders", "General pack: SBD/MBD fill, merged pack (6/month)", "Experience Library and CV library", "Pipeline, tasks and role-based digest"],
  sanral_pro: ["Everything in Pro, no pack limit", "SANRAL workbook fill, both envelopes", "Done-with-you onboarding"],
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; error?: string }>;
}) {
  const { checkout, error } = await searchParams;
  const supabase = await createClient();
  const subscription = await fetchCompanySubscription(supabase);

  const status = subscription ? effectiveSubscriptionStatus(subscription) : null;
  const lapsed = subscription ? isSubscriptionLapsed(subscription) : false;
  const daysLeft = subscription ? trialDaysLeft(subscription) : null;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1000px] flex-1 px-8 py-6">
        <PageHeader
          className="mb-5"
          title="Billing"
          description="Your plan, trial and payment - PayFast sandbox for now, so no real card is charged."
        />

        {error && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}
        {checkout === "cancel" && (
          <div className="mb-5 rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
            Checkout was cancelled - no payment was made.
          </div>
        )}
        {checkout === "return" && (
          <div className="mb-5 rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
            Thanks - PayFast will confirm your payment shortly, and your plan below will update automatically once it does.
          </div>
        )}

        <SectionCard title="Current plan" className="mb-6">
          {subscription ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-foreground">{PLAN_LABEL[subscription.planTier]}</div>
                <div className="text-sm text-muted-foreground">
                  {status === "trialing" && daysLeft !== null && (daysLeft > 0 ? `Free trial - ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "Free trial ends today")}
                  {status === "active" && `Active - billed ${subscription.billingInterval}`}
                  {lapsed && "Trial/subscription ended - choose a plan below to keep full access"}
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  lapsed ? "border-destructive/20 bg-destructive/10 text-destructive" : "border-success/20 bg-success/10 text-success",
                )}
              >
                {lapsed ? "Action needed" : status === "trialing" ? "Trialing" : "Active"}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No subscription found for your company yet.</p>
          )}
        </SectionCard>

        <h2 className="mb-3 font-display text-lg font-medium text-foreground">Plans</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {(["watch", "pro", "sanral_pro"] as const).map((plan) => (
            <PlanCard key={plan} plan={plan} currentPlan={subscription?.planTier} />
          ))}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Yearly billing is 2 months free (10&times; the monthly price). Prices exclude VAT. Payments run through PayFast&apos;s
          sandbox for now - see{" "}
          <Link href="https://sandbox.payfast.co.za" className="underline underline-offset-2" target="_blank" rel="noreferrer">
            sandbox.payfast.co.za
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}

function PlanCard({ plan, currentPlan }: { plan: PlanTier; currentPlan?: PlanTier }) {
  const monthly = priceForPlanZar(plan, "monthly");
  const yearly = yearlyPriceZar(monthly);
  const isCurrent = plan === currentPlan;

  return (
    <SectionCard
      className={cn(plan === "sanral_pro" && "border-2 border-accent")}
      title={PLAN_LABEL[plan]}
      description={
        plan === "watch" ? (
          "Free"
        ) : (
          <>
            <span className="text-2xl font-semibold text-foreground">R{monthly.toLocaleString("en-ZA")}</span>
            <span className="text-sm text-muted-foreground">/month</span>
          </>
        )
      }
    >
      <ul className="mb-4 space-y-1.5 text-sm text-muted-foreground">
        {PLAN_FEATURES[plan].map((f) => (
          <li key={f}>&bull; {f}</li>
        ))}
      </ul>
      {plan !== "watch" ? (
        <div className="flex flex-col gap-2">
          <CheckoutLink plan={plan} interval="monthly" disabled={isCurrent} label={`Subscribe monthly - R${monthly.toLocaleString("en-ZA")}`} />
          <CheckoutLink
            plan={plan}
            interval="yearly"
            disabled={isCurrent}
            label={`Subscribe yearly - R${yearly.toLocaleString("en-ZA")} (2 months free)`}
            variant="outline"
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Your 14-day trial already gives you the full product - Watch is where things land afterwards if you don&apos;t choose a paid plan.</p>
      )}
      {isCurrent && <p className="mt-2 text-xs font-medium text-accent">Your current plan</p>}
    </SectionCard>
  );
}

function CheckoutLink({
  plan,
  interval,
  disabled,
  label,
  variant = "accent",
}: {
  plan: "pro" | "sanral_pro";
  interval: BillingInterval;
  disabled?: boolean;
  label: string;
  variant?: "accent" | "outline";
}) {
  if (disabled) {
    return (
      <Button variant={variant} className="h-11" disabled>
        {label}
      </Button>
    );
  }
  return (
    <Link href={`/api/billing/checkout?plan=${plan}&interval=${interval}`} className={buttonVariants({ variant, className: "h-11" })}>
      {label}
    </Link>
  );
}
