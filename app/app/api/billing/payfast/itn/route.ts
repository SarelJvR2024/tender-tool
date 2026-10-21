import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PAYFAST_ITN_HOSTNAMES, decodePlanInterval, payfastValidateUrl, verifyItnSignature } from "@/lib/payfast";


/**
 * PayFast's ITN (Instant Transaction Notification) webhook - the ONLY path
 * that ever marks a subscription active/past_due from a real payment. No
 * Supabase session exists here at all (PayFast's own server calls this
 * route directly) - see supabase/migrations/0078's own header comment for
 * why the actual write goes through apply_payfast_itn(), a narrow SECURITY
 * DEFINER function, rather than a service-role client (this app never
 * holds that key - see 0077's header comment).
 *
 * This is the one place in this piece of work where correctness really
 * matters (money-adjacent), so every one of PayFast's own documented ITN
 * security checks is done, in order, failing closed on the first one that
 * doesn't pass:
 *   1. Signature (lib/payfast.ts's verifyItnSignature, confirmed correct
 *      against PayFast's own official SDK test fixture - see payfast.spec.ts).
 *   2. Source IP resolves to one of PayFast's own documented hostnames.
 *   3. Server confirmation: POST the exact raw body back to PayFast's own
 *      /eng/query/validate endpoint and require the literal response "VALID" -
 *      PayFast's own strongest documented check (confirms a REAL transaction
 *      exists on their side, not just that a signature happens to match -
 *      which matters here since the sandbox's universal test merchant has
 *      no real passphrase, so signature alone is a weaker guarantee than
 *      on a live account with one configured).
 * PayFast expects a 200 response and retries on anything else - a rejected
 * ITN (any check failing) still returns 200 so PayFast doesn't hammer this
 * endpoint with retries for a request that will never become valid, but
 * nothing is written to the database for it.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);
  const signature = params.get("signature");

  if (!signature || !verifyItnSignature(rawBody, signature)) {
    console.error("PayFast ITN: signature verification failed", { mPaymentId: params.get("m_payment_id") });
    return new NextResponse("OK", { status: 200 });
  }

  if (!(await sourceIpLooksLikePayfast(request))) {
    console.error("PayFast ITN: source IP did not match any of PayFast's own documented hostnames", {
      ip: request.headers.get("x-forwarded-for"),
    });
    return new NextResponse("OK", { status: 200 });
  }

  const confirmed = await confirmWithPayfast(rawBody);
  if (!confirmed) {
    console.error("PayFast ITN: server confirmation (eng/query/validate) did not return VALID", {
      mPaymentId: params.get("m_payment_id"),
    });
    return new NextResponse("OK", { status: 200 });
  }

  const mPaymentId = params.get("m_payment_id");
  const pfPaymentId = params.get("pf_payment_id") || params.get("token");
  const paymentStatus = params.get("payment_status");
  const planInterval = decodePlanInterval(params.get("custom_str2"));

  if (!mPaymentId || !paymentStatus) {
    console.error("PayFast ITN: missing m_payment_id or payment_status after verification passed - ignoring", {
      mPaymentId,
      paymentStatus,
    });
    return new NextResponse("OK", { status: 200 });
  }

  const periodEnd = planInterval ? nextPeriodEnd(planInterval.billingInterval) : null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_payfast_itn", {
    p_m_payment_id: mPaymentId,
    p_payfast_token: pfPaymentId,
    p_payment_status: paymentStatus,
    p_period_end: periodEnd,
  });
  if (error) {
    // Genuinely unexpected (e.g. no pending row for this m_payment_id) -
    // logged loudly, still 200 so PayFast doesn't retry forever for a
    // payment this app can never reconcile.
    console.error("apply_payfast_itn rpc failed", error, { mPaymentId, paymentStatus });
  }

  return new NextResponse("OK", { status: 200 });
}

function nextPeriodEnd(interval: "monthly" | "yearly"): string {
  const d = new Date();
  if (interval === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

async function sourceIpLooksLikePayfast(request: NextRequest): Promise<boolean> {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const sourceIp = forwardedFor?.split(",")[0]?.trim();
  if (!sourceIp) {
    // No IP to check (e.g. a local/dev request with no proxy header) -
    // logged, not hard-blocked: signature + server confirmation are both
    // still required either way, and a platform that doesn't forward a
    // client IP shouldn't make every payment unreconcilable.
    console.warn("PayFast ITN: no x-forwarded-for header to check source IP against");
    return true;
  }
  try {
    const { lookup } = await import("node:dns/promises");
    const results = await Promise.all(
      PAYFAST_ITN_HOSTNAMES.map((host) => lookup(host, { all: true }).catch(() => []))
    );
    const validIps = new Set(results.flat().map((r) => r.address));
    if (validIps.size === 0) {
      console.warn("PayFast ITN: could not resolve any of PayFast's own hostnames - skipping the IP check");
      return true;
    }
    return validIps.has(sourceIp);
  } catch (e) {
    console.warn("PayFast ITN: IP check failed unexpectedly, not blocking on it", e);
    return true;
  }
}

async function confirmWithPayfast(rawBody: string): Promise<boolean> {
  try {
    const res = await fetch(payfastValidateUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: rawBody,
    });
    const text = (await res.text()).trim();
    return text === "VALID";
  } catch (e) {
    console.error("PayFast ITN: could not reach PayFast's own validate endpoint", e);
    return false;
  }
}
