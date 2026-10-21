import { createClient } from "@supabase/supabase-js";
import {
  confirmItnWithPayfast,
  getPayfastConfig,
  isKnownPayfastItnHost,
  verifyItnSignature,
} from "@/lib/payfast";

// PayFast's ITN (Instant Transaction Notification) webhook. No user session
// exists here - PayFast's own server posts this, not a logged-in browser -
// so this route authenticates the REQUEST itself, not a user, via three
// independent checks (PayFast's own documented process): (1) the signature
// over the posted fields matches, (2) PayFast's own server confirms, on a
// separate server-to-server call, that it really sent this exact payload,
// (3) the request's source host is one of PayFast's own. All three must
// pass before record_payfast_itn() (a narrow SECURITY DEFINER RPC, not a
// service-role client - this app never holds one, see 0078's own header
// comment) is allowed to touch the database.
//
// Always return 200 once the body has been read and checks run, even on a
// failed check - PayFast retries a non-200 response, and a malformed or
// forged request isn't something retrying will fix.
export async function POST(request: Request) {
  const rawBody = await request.text();

  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = (forwardedHost ?? new URL(request.url).host).split(":")[0];
  if (!isKnownPayfastItnHost(host)) {
    console.warn(`PayFast ITN rejected: source host "${host}" is not a known PayFast host`);
    return new Response("ok", { status: 200 });
  }

  const config = getPayfastConfig();
  const { valid: signatureValid, fields } = verifyItnSignature(rawBody, config.passphrase);
  if (!signatureValid) {
    console.warn("PayFast ITN rejected: signature mismatch");
    return new Response("ok", { status: 200 });
  }

  const confirmed = await confirmItnWithPayfast(rawBody, config.mode);
  if (!confirmed) {
    console.warn("PayFast ITN rejected: PayFast's own validate endpoint did not confirm this payload");
    return new Response("ok", { status: 200 });
  }

  const mPaymentId = fields["m_payment_id"];
  const pfPaymentId = fields["pf_payment_id"] ?? null;
  const paymentStatus = fields["payment_status"] ?? "FAILED";
  const amountGross = Number(fields["amount_gross"] ?? "0");
  if (!mPaymentId) {
    console.warn("PayFast ITN rejected: no m_payment_id in the posted fields");
    return new Response("ok", { status: 200 });
  }

  // anon key + a narrow SECURITY DEFINER RPC, matching this app's standing
  // rule that it never holds the Supabase service-role key (see
  // .env.local.example) - every privileged write, here included, goes
  // through a function designed for exactly this caller.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { error } = await supabase.rpc("record_payfast_itn", {
    p_m_payment_id: mPaymentId,
    p_pf_payment_id: pfPaymentId,
    p_payment_status: paymentStatus,
    p_amount_gross_zar: amountGross,
    p_raw: fields,
  });
  if (error) {
    console.error("PayFast ITN: record_payfast_itn() failed", error);
  }

  return new Response("ok", { status: 200 });
}
