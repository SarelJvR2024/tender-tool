import { createHash } from "node:crypto";

/**
 * PayFast signature + ITN helpers.
 *
 * Field order for the OUTBOUND checkout form only matters in one way: the
 * order used to compute the signature must be the exact same order the
 * fields are rendered as hidden <input>s, because PayFast's server
 * recomputes the signature from the POST body it actually receives (in that
 * same order) and compares. CHECKOUT_FIELD_ORDER below is that single,
 * shared order - there is no other "correct" order to match, as long as
 * signing and rendering stay in lockstep.
 *
 * For the INBOUND ITN postback, we don't control PayFast's field order, so
 * verifyItnSignature() recomputes using the exact order the fields arrived
 * in the raw POST body (never alphabetised, never reconstructed from a
 * fixed list) - that's the only order PayFast itself could have signed.
 */

export type PayfastMode = "sandbox" | "live";

export interface PayfastConfig {
  merchantId: string;
  merchantKey: string;
  passphrase: string | undefined;
  mode: PayfastMode;
}

export function getPayfastConfig(): PayfastConfig {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  const mode = process.env.PAYFAST_MODE === "live" ? "live" : "sandbox";
  if (!merchantId || !merchantKey) {
    throw new Error(
      "PAYFAST_MERCHANT_ID / PAYFAST_MERCHANT_KEY are not set. PayFast's sandbox has public test credentials - see docs/specs for the variable names to add via the environment's secrets settings."
    );
  }
  return { merchantId, merchantKey, passphrase: process.env.PAYFAST_PASSPHRASE || undefined, mode };
}

export function payfastHost(mode: PayfastMode): string {
  return mode === "live" ? "www.payfast.co.za" : "sandbox.payfast.co.za";
}

export function payfastProcessUrl(mode: PayfastMode): string {
  return `https://${payfastHost(mode)}/eng/process`;
}

const VALIDATE_PATH = "/eng/query/validate";

export function payfastValidateUrl(mode: PayfastMode): string {
  return `https://${payfastHost(mode)}${VALIDATE_PATH}`;
}

// The hostnames PayFast itself sends ITN postbacks from. A request claiming
// to be an ITN but arriving from anywhere else is not PayFast.
export const KNOWN_PAYFAST_ITN_HOSTS = [
  "www.payfast.co.za",
  "sandbox.payfast.co.za",
  "w1w.payfast.co.za",
  "w2w.payfast.co.za",
];

export function isKnownPayfastItnHost(hostname: string): boolean {
  return KNOWN_PAYFAST_ITN_HOSTS.includes(hostname.toLowerCase());
}

// subscription_type=1 recurring billing's `frequency` codes. PayFast does
// not publish these in a place we could fetch - 3/6 is the best-corroborated
// reading from third-party integrations, not independently confirmed
// against PayFast's own docs. Verify against a real sandbox subscription
// before this is relied on for a live charge.
export const PAYFAST_FREQUENCY_MONTHLY = 3;
export const PAYFAST_FREQUENCY_ANNUAL = 6;

// PHP's urlencode(): like encodeURIComponent, but spaces become '+' (not
// %20) and a handful of chars RFC3986 leaves unescaped get escaped too.
// PayFast's own signature examples are written against PHP's urlencode(),
// so matching it exactly (not encodeURIComponent on its own) is what makes
// our signature agree with PayFast's recomputation of it.
export function payfastUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export function formatAmount(amountZar: number): string {
  return amountZar.toFixed(2);
}

function signatureBaseString(entries: Array<[string, string]>, passphrase?: string): string {
  const parts = entries
    .filter(([, value]) => value !== "" && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${payfastUrlEncode(String(value).trim())}`);
  if (passphrase) {
    parts.push(`passphrase=${payfastUrlEncode(passphrase.trim())}`);
  }
  return parts.join("&");
}

export function generateSignature(entries: Array<[string, string]>, passphrase?: string): string {
  return createHash("md5").update(signatureBaseString(entries, passphrase)).digest("hex");
}

// The single order used for both signing and rendering the checkout form -
// see the module comment. Blank/undefined fields are dropped before signing
// (and before rendering), so a shorter checkout (no subscription fields, say)
// is still self-consistent.
export const CHECKOUT_FIELD_ORDER = [
  "merchant_id",
  "merchant_key",
  "return_url",
  "cancel_url",
  "notify_url",
  "name_first",
  "email_address",
  "m_payment_id",
  "amount",
  "item_name",
  "item_description",
  "subscription_type",
  "billing_date",
  "recurring_amount",
  "frequency",
  "cycles",
] as const;

export type CheckoutFieldValues = Partial<Record<(typeof CHECKOUT_FIELD_ORDER)[number], string>>;

export interface CheckoutForm {
  actionUrl: string;
  fields: Array<[string, string]>;
}

export function buildCheckoutForm(values: CheckoutFieldValues, config: PayfastConfig): CheckoutForm {
  const entries = CHECKOUT_FIELD_ORDER.filter((key) => values[key] !== undefined && values[key] !== "").map(
    (key) => [key, values[key] as string] as [string, string]
  );
  const signature = generateSignature(entries, config.passphrase);
  return { actionUrl: payfastProcessUrl(config.mode), fields: [...entries, ["signature", signature]] };
}

export interface ItnVerification {
  valid: boolean;
  fields: Record<string, string>;
}

/**
 * Recomputes the signature from the raw ITN body, in the exact order the
 * fields arrived - URLSearchParams preserves that order, and so does the
 * plain object built from it (string keys keep insertion order in JS).
 */
export function verifyItnSignature(rawBody: string, passphrase?: string): ItnVerification {
  const params = new URLSearchParams(rawBody);
  const entries: Array<[string, string]> = [];
  const fields: Record<string, string> = {};
  let receivedSignature: string | null = null;
  for (const [key, value] of params.entries()) {
    if (key === "signature") {
      receivedSignature = value;
      continue;
    }
    entries.push([key, value]);
    fields[key] = value;
  }
  if (receivedSignature === null) return { valid: false, fields };
  const expected = generateSignature(entries, passphrase);
  return { valid: expected === receivedSignature.toLowerCase(), fields };
}

/**
 * The second ITN check: PayFast's own server-to-server confirmation that it
 * really sent this exact payload. Posting the untouched raw body back to
 * PayFast and requiring the literal response 'VALID' is PayFast's own
 * documented mechanism for this - a forged ITN can fake a matching
 * signature (if it ever learned the passphrase) but can't make PayFast's
 * own server confirm a postback PayFast never sent.
 */
export async function confirmItnWithPayfast(rawBody: string, mode: PayfastMode): Promise<boolean> {
  const response = await fetch(payfastValidateUrl(mode), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: rawBody,
  });
  const text = (await response.text()).trim();
  return text === "VALID";
}
