import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_components/AppShell";
import { fetchCompanySubscription } from "@/lib/companySubscription";
import { formatZAR } from "@/lib/formatZAR";
import {
  PAYABLE_PLAN_TIERS,
  PLAN_LABEL,
  PLAN_LIMITS,
  effectiveSubscriptionStatus,
  isSubscriptionLapsed,
  priceForPlanZar,
  trialDaysLeft,
  yearlyPriceZar,
  type BillingInterval,
} from "@/lib/billing";
import { PageHeader } from "@/components/tt/page-header";
import { SectionCard } from "@/components/tt/section-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isBillingSandboxed } from "@/lib/payfast";

// Depends on the signed-in user's own subscription row, same reason as
// every other RLS-scoped page in this app.
export const instant = false;

type PayablePlan = (typeof PAYABLE_PLAN_TIERS)[number];

// Every plan gets every engine - no feature gating (Sarel's own framing:
// "nothing is held back for a bigger plan"). Plans differ only by seats
// and bid-pack volume, both read straight from PLAN_LIMITS below, never
// hardcoded a second time here.
const PLAN_DESCRIPTION: Record<PayablePlan, string> = {
  starter: "For the owner or director who handles tenders personally.",
  professional: "For a company that tenders most weeks and can't afford to miss a closing date.",
  business: "For a team running several bids at once, or several branches.",
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; error?: string }>;
}) {
  const { checkout, error } = await searchParams;
  // UX audit 2026-10-23, item 6: "PayFast sandbox" was hardcoded into this
  // page's copy regardless of PAYFAST_MODE (lib/payfast.ts), so production
  // would keep telling paying customers their card wasn't being charged
  // even once PAYFAST_MODE=live. First fix gated the copy on the real
  // checkout/ITN routes' own flag; re-review 2026-10-23 asked for an
  // explicit NEXT_PUBLIC_PAYFAST_SANDBOX switch instead, so it can be
  // turned off here without touching PAYFAST_MODE's own effect on where
  // checkout actually posts. CAUTION, not enforced in code: if this is set
  // to "false" while PAYFAST_MODE is still "sandbox", the page will claim
  // live payment while checkout is still hitting PayFast's sandbox - don't
  // flip this ahead of PAYFAST_MODE actually going live. Unset falls back
  // to the real mode, same safe default as before.
  //
  // isBillingSandboxed() (lib/payfast.ts) is the SAME flag /api/billing/checkout
  // itself reads before building a PayFast form - this page disabling the
  // Subscribe buttons and the route refusing to start a transaction are two
  // views of one source, not two independent checks that could drift apart.
  const isSandbox = isBillingSandboxed();
  const supabase = await createClient();
  const subscription = await fetchCompanySubscription(supabase);

  const status = subscription ? effectiveSubscriptionStatus(subscription) : null;
  const lapsed = subscription ? isSubscriptionLapsed(subscription) : false;
  const daysLeft = subscription ? trialDaysLeft(subscription) : null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user?.id ?? "").maybeSingle();
  const companyId = membership?.company_id as string | undefined;

  const [{ count: memberCount }, { data: packsThisPeriod }] = await Promise.all([
    companyId ? supabase.from("company_members").select("id", { count: "exact", head: true }).eq("company_id", companyId) : Promise.resolve({ count: null }),
    companyId && status === "active" ? supabase.rpc("company_packs_this_period", { p_company_id: companyId }) : Promise.resolve({ data: null }),
  ]);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1000px] flex-1 px-8 py-6">
        <PageHeader
          className="mb-5"
          title={isSandbox ? "Billing not yet active" : "Billing"}
          description={
            isSandbox
              ? "Card payments are not switched on yet. Your plan stays active in the meantime."
              : "Your plan, trial and payment."
          }
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
          {subscription && (
            <div className="mt-4 grid gap-3 border-t border-border pt-4 text-sm text-muted-foreground sm:grid-cols-2">
              <div>
                Team: <span className="font-medium text-foreground">{memberCount ?? 0}</span> of{" "}
                {subscription.maxUsers ?? "unlimited"}
              </div>
              <div>
                Bid packs this period:{" "}
                <span className="font-medium text-foreground">{status === "active" ? ((packsThisPeriod as number | null) ?? 0) : "—"}</span> of{" "}
                {status === "trialing" ? "1 (trial)" : subscription.maxPacksPerMonth ?? "unlimited"}
              </div>
            </div>
          )}
        </SectionCard>

        <h2 className="mb-3 font-display text-lg font-medium text-foreground">Plans</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Every plan gets every engine - no feature is held back for a bigger plan. Plans differ only by how many people and how many bid packs a month.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PAYABLE_PLAN_TIERS.map((plan) => (
            <PlanCard key={plan} plan={plan} currentPlan={subscription?.planTier} isSandbox={isSandbox} />
          ))}
          <SectionCard title="Enterprise" description="Priced on request">
            <p className="mb-4 text-sm text-muted-foreground">
              For organisations with their own tender function, multiple entities or specific reporting needs. We scope users,
              volume, integrations and training with you and quote accordingly.
            </p>
            <a href="mailto:hello@tendertool.co.za?subject=Enterprise%20plan" className={buttonVariants({ variant: "outline", className: "h-11 w-full" })}>
              Contact us
            </a>
          </SectionCard>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Yearly billing is 2 months free (10&times; the monthly price). Prices exclude VAT.
        </p>
      </div>
    </AppShell>
  );
}

function PlanCard({ plan, currentPlan, isSandbox }: { plan: PayablePlan; currentPlan?: string; isSandbox: boolean }) {
  const monthly = priceForPlanZar(plan, "monthly");
  const yearly = yearlyPriceZar(monthly);
  const isCurrent = plan === currentPlan;
  const limits = PLAN_LIMITS[plan];

  return (
    <SectionCard
      className={cn(plan === "professional" && "border-2 border-accent")}
      title={PLAN_LABEL[plan]}
      description={
        <>
          <span className="text-2xl font-semibold text-money">{formatZAR(monthly)}</span>
          <span className="text-sm text-muted-foreground">/month</span>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{PLAN_DESCRIPTION[plan]}</p>
      <ul className="mb-4 space-y-1.5 text-sm text-muted-foreground">
        <li>&bull; {limits.maxUsers} people</li>
        <li>&bull; {limits.maxPacksPerMonth} bid packs a month</li>
        <li>&bull; Every AI engine - nothing held back</li>
        {plan === "professional" && <li className="font-medium text-accent">&bull; For companies tendering regularly</li>}
      </ul>
      <div className="flex flex-col gap-2">
        <CheckoutLink
          plan={plan}
          interval="monthly"
          disabled={isCurrent}
          isSandbox={isSandbox}
          priceLabel={formatZAR(monthly)}
        />
        <CheckoutLink
          plan={plan}
          interval="yearly"
          disabled={isCurrent}
          isSandbox={isSandbox}
          priceLabel={`${formatZAR(yearly)}/yr`}
          variant="outline"
        />
      </div>
      {isCurrent && <p className="mt-2 text-xs font-medium text-accent">Your current plan</p>}
      {!isCurrent && isSandbox && <p className="mt-2 text-xs text-muted-foreground">Payments aren&apos;t switched on yet</p>}
    </SectionCard>
  );
}

// h-auto/whitespace-normal here is a deliberate override of the shared
// Button/Link's own whitespace-nowrap default (components/ui/button.tsx) -
// "Subscribe yearly - R 49,900.00/yr" (Business, yearly) does not fit a
// single nowrap line in a 4-up desktop grid card or a narrow phone width,
// and nowrap without overflow handling let it visually spill past the
// button's own border rather than truncate. Splitting the interval word
// from the price onto two short, always-short lines fits at both widths
// regardless of exact price length, rather than depending on wrap landing
// at a convenient space.
function CheckoutLink({
  plan,
  interval,
  disabled,
  isSandbox,
  priceLabel,
  variant = "accent",
}: {
  plan: PayablePlan;
  interval: BillingInterval;
  disabled?: boolean;
  isSandbox: boolean;
  priceLabel: string;
  variant?: "accent" | "outline";
}) {
  const intervalLabel = interval === "yearly" ? "Yearly" : "Monthly";
  const fullLabel = `Subscribe ${intervalLabel.toLowerCase()} - ${priceLabel}`;
  const content = (
    <span className="flex flex-col items-center leading-tight">
      <span>{intervalLabel}</span>
      <span className="text-xs font-normal opacity-80">{priceLabel}</span>
    </span>
  );
  const sharedClassName = "h-auto min-h-11 whitespace-normal py-2 text-center";

  // Billing not switched on (sandbox) blocks every plan's checkout, not
  // just the current one - this mirrors the exact guard
  // /api/billing/checkout itself applies (isBillingSandboxed(), lib/payfast.ts),
  // so a disabled button here and a redirect-with-reason there are the same
  // decision, never a UI promise the route doesn't keep.
  if (disabled || isSandbox) {
    return (
      <Button
        variant={variant}
        className={sharedClassName}
        disabled
        aria-label={isSandbox && !disabled ? `${fullLabel} - payments aren't switched on yet` : fullLabel}
      >
        {content}
      </Button>
    );
  }
  return (
    <Link
      href={`/api/billing/checkout?plan=${plan}&interval=${interval}`}
      className={buttonVariants({ variant, className: sharedClassName })}
      aria-label={fullLabel}
    >
      {content}
    </Link>
  );
}
