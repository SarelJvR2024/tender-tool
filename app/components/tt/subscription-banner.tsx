import Link from "next/link";
import { isSubscriptionLapsed, PLAN_LABEL, trialDaysLeft, type CompanySubscriptionRow } from "@/lib/billing";

/**
 * Mounted once, at the top of AppShell's content column, on every signed-in
 * page. The one enforcement this first pass actually builds (app/AGENTS.md -
 * "SANRAL billing (PayFast integration)"): a lapsed trial/subscription
 * shows this banner and nothing else - it never hides the page behind it or
 * silently keeps working with no sign anything changed. No per-feature
 * gating, no redirect; the person can keep using everything while they
 * decide what to do, same as today, just with an honest, visible state.
 */
export function SubscriptionBanner({ subscription }: { subscription: CompanySubscriptionRow | null }) {
  if (!subscription) return null;

  if (isSubscriptionLapsed(subscription)) {
    const everTrialed = subscription.status === "trialing";
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/20 bg-warning/10 px-4 py-2.5 text-sm text-warning sm:px-6">
        <span className="font-medium">
          {everTrialed ? "Your free trial has ended." : "Your subscription has lapsed."} Choose a plan to keep full access.
        </span>
        <Link href="/billing" className="shrink-0 font-semibold underline underline-offset-2 hover:no-underline">
          Go to Billing
        </Link>
      </div>
    );
  }

  const daysLeft = trialDaysLeft(subscription);
  if (daysLeft !== null && daysLeft <= 3) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/20 bg-warning/10 px-4 py-2.5 text-sm text-warning sm:px-6">
        <span className="font-medium">
          {daysLeft === 0 ? "Your free trial ends today." : `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`}{" "}
          You&apos;re on {PLAN_LABEL[subscription.planTier]}.
        </span>
        <Link href="/billing" className="shrink-0 font-semibold underline underline-offset-2 hover:no-underline">
          Choose a plan
        </Link>
      </div>
    );
  }

  return null;
}
