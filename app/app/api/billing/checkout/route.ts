import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  PAYFAST_CYCLES_INDEFINITE,
  PAYFAST_FREQUENCY,
  encodePlanInterval,
  isBillingSandboxed,
  orderedCheckoutEntries,
  payfastMerchantId,
  payfastMerchantKey,
  payfastProcessUrl,
  signCheckoutFields,
  type PayfastFields,
} from "@/lib/payfast";
import { PLAN_LABEL, priceForPayfastAmount, type BillingInterval, type PlanTier } from "@/lib/billing";
import { sastToday } from "@/lib/publicHolidays";


/**
 * POST /api/billing/checkout (body: plan=starter|professional|business,
 * interval=monthly|yearly)
 *
 * Returns a self-submitting HTML form (PayFast's own documented onsite/
 * process pattern - their "process" endpoint is a page, not a JSON API) that
 * posts a signed PayFast transaction straight to PAYFAST_MODE's process
 * host. The signed fields are built and submitted in the SAME fixed order
 * (PAYFAST_CHECKOUT_FIELD_ORDER) - see lib/payfast.ts's own header comment
 * on why that consistency, not any particular order, is what actually has
 * to be true.
 *
 * POST, not GET (standing review finding, 2026-11-10): this handler's own
 * very first real step - before PayFast is ever involved - is
 * start_payfast_checkout() (0078/0117), a SECURITY DEFINER RPC that writes
 * the company's plan_tier/billing_interval/max_users/max_packs_per_month
 * onto its LIVE company_subscriptions row immediately, synchronously, with
 * no confirmation step. A GET handler with that real a side effect is
 * reachable by a plain top-level cross-site navigation (a crafted link, an
 * auto-submitting <meta refresh>, window.location from another origin) -
 * SameSite=Lax (this app's own cookie default, via @supabase/ssr) allows
 * cookies on exactly that shape of request, since a simple GET-method
 * top-level navigation is treated as "safe". A paying company's own quota/
 * seat cap could be forced to change - most harmfully, silently downgraded,
 * shrinking max_users/max_packs_per_month below what the company is
 * actually using - by nothing more than getting a signed-in member to open
 * one crafted link, with no payment ever involved and no confirmation UI
 * shown first. POST closes this: SameSite=Lax does NOT send cookies on a
 * cross-site POST (only a true top-level GET/HEAD navigation qualifies), so
 * a forged cross-origin form submission (the only way to script a POST
 * without a click) arrives with no session, and start_payfast_checkout()'s
 * own auth.uid()-is-null path already returns "no company for the signed-in
 * user" exactly as it would for any other unauthenticated call. The
 * existing /billing page is this route's only real caller - switched to a
 * same-origin <form method="post"> below, same two fields, same gate
 * (isBillingSandboxed()) before either the plan/interval is even read.
 * Deliberately does NOT change WHEN a legitimate click's own write takes
 * effect (that is the separate, already-standing, Sarel's-own-call
 * "grants-before-ITN" item) - only WHO/WHAT can reach this handler at all.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const plan = form.get("plan") as PlanTier | null;
  const interval = (form.get("interval") as BillingInterval | null) ?? "monthly";

  if (plan !== "starter" && plan !== "professional" && plan !== "business") {
    return NextResponse.redirect(new URL("/billing?error=Choose+a+plan+to+subscribe+to.", request.url));
  }
  if (interval !== "monthly" && interval !== "yearly") {
    return NextResponse.redirect(new URL("/billing?error=Unknown+billing+interval.", request.url));
  }

  // Same guard /billing's own Subscribe buttons already disable on
  // (isBillingSandboxed(), lib/payfast.ts) - the UI and this route read one
  // flag, so a disabled button and a refused direct-URL hit are the same
  // decision. Without this, a sandbox-disabled button was only a UI nicety:
  // hitting this URL directly still built and auto-submitted a real
  // PayFast sandbox transaction.
  if (isBillingSandboxed()) {
    return NextResponse.redirect(
      new URL(`/billing?error=${encodeURIComponent("Payments aren't switched on yet - try again once they are.")}`, request.url)
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const [{ data: company }, { data: mPaymentId, error: checkoutError }] = await Promise.all([
    supabase.from("companies").select("id, legal_name, csd_trading_name").maybeSingle(),
    supabase.rpc("start_payfast_checkout", { p_plan_tier: plan, p_billing_interval: interval }),
  ]);

  if (checkoutError || !mPaymentId || !company) {
    console.error("start_payfast_checkout rpc failed", checkoutError);
    return NextResponse.redirect(
      new URL(`/billing?error=${encodeURIComponent("Could not start checkout - try again.")}`, request.url)
    );
  }

  const origin = request.nextUrl.origin;
  const amount = priceForPayfastAmount(plan, interval);
  const planLabel = PLAN_LABEL[plan];

  const fields: PayfastFields = {
    merchant_id: payfastMerchantId(),
    merchant_key: payfastMerchantKey(),
    return_url: `${origin}/billing?checkout=return`,
    cancel_url: `${origin}/billing?checkout=cancel`,
    notify_url: `${origin}/api/billing/payfast/itn`,
    email_address: user.email ?? undefined,
    m_payment_id: mPaymentId as string,
    amount,
    item_name: `${planLabel} - ${interval === "yearly" ? "yearly" : "monthly"}`,
    item_description: `${company.csd_trading_name || company.legal_name} - ${planLabel} subscription`,
    custom_str1: company.id as string,
    custom_str2: encodePlanInterval({ planTier: plan, billingInterval: interval }),
    subscription_type: "1",
    // SAST, not raw UTC - during the 22:00-00:00 UTC window (00:00-02:00
    // SAST) a raw toISOString() slice reports yesterday's date, handing
    // PayFast a billing_date already in the past for the real SA calendar
    // day. Same UTC-vs-SAST bug class as the deadline calculator's own
    // sastToday() fix.
    billing_date: sastToday(),
    recurring_amount: amount,
    frequency: String(PAYFAST_FREQUENCY[interval]),
    cycles: String(PAYFAST_CYCLES_INDEFINITE),
  };

  // Signing and the actual submitted <form> fields MUST iterate in the same
  // order (see lib/payfast.ts's own header comment on PAYFAST_CHECKOUT_FIELD_ORDER) -
  // orderedCheckoutEntries() is the one place that order is decided, used by
  // both signCheckoutFields() (via buildSignatureBaseString) and the inputs
  // rendered below, so the two can never silently drift apart.
  const signature = signCheckoutFields(fields);
  const inputs = orderedCheckoutEntries(fields)
    .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtmlAttr(value)}" />`)
    .join("\n");

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Redirecting to PayFast...</title></head>
  <body onload="document.forms[0].submit()">
    <p>Redirecting you to PayFast to complete your subscription - please wait...</p>
    <form method="POST" action="${payfastProcessUrl()}">
      ${inputs}
      <input type="hidden" name="signature" value="${signature}" />
      <noscript><button type="submit">Continue to PayFast</button></noscript>
    </form>
  </body>
</html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
