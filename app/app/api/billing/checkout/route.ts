import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  PAYFAST_CYCLES_INDEFINITE,
  PAYFAST_FREQUENCY,
  encodePlanInterval,
  orderedCheckoutEntries,
  payfastMerchantId,
  payfastMerchantKey,
  payfastProcessUrl,
  signCheckoutFields,
  type PayfastFields,
} from "@/lib/payfast";
import { priceForPayfastAmount, type BillingInterval, type PlanTier } from "@/lib/billing";


/**
 * GET /api/billing/checkout?plan=pro|sanral_pro&interval=monthly|yearly
 *
 * Returns a self-submitting HTML form (PayFast's own documented onsite/
 * process pattern - their "process" endpoint is a page, not a JSON API) that
 * posts a signed PayFast transaction straight to PAYFAST_MODE's process
 * host. The signed fields are built and submitted in the SAME fixed order
 * (PAYFAST_CHECKOUT_FIELD_ORDER) - see lib/payfast.ts's own header comment
 * on why that consistency, not any particular order, is what actually has
 * to be true.
 */
export async function GET(request: NextRequest) {
  const plan = request.nextUrl.searchParams.get("plan") as PlanTier | null;
  const interval = (request.nextUrl.searchParams.get("interval") as BillingInterval | null) ?? "monthly";

  if (plan !== "pro" && plan !== "sanral_pro") {
    return NextResponse.redirect(new URL("/billing?error=Choose+a+plan+to+subscribe+to.", request.url));
  }
  if (interval !== "monthly" && interval !== "yearly") {
    return NextResponse.redirect(new URL("/billing?error=Unknown+billing+interval.", request.url));
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
  const planLabel = plan === "pro" ? "Tender Pro" : "SANRAL Pro";

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
    billing_date: new Date().toISOString().slice(0, 10),
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
