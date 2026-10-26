// PayFast integration: signing an outgoing checkout request, and verifying
// an incoming ITN (Instant Transaction Notification) webhook. Sandbox only
// for now (Sarel's own instruction) - PAYFAST_MODE defaults to "sandbox" and
// everything here reads the mode from one place.
//
// Sandbox credentials below (merchant_id 10000100, merchant_key
// 46f0cd694581a) are PayFast's own universal published test values - see
// https://developers.payfast.co.za/docs#testing - not a secret, so they are
// hardcoded rather than read from an env var. Going live later is an env
// var swap (PAYFAST_MODE=live, PAYFAST_MERCHANT_ID/PAYFAST_MERCHANT_KEY set
// to the real merchant's own credentials, PAYFAST_PASSPHRASE set) - nothing
// else in this file changes.
//
// Node-only (uses the "node:crypto" module) - never imported into a "use
// client" component.
import { createHash } from "node:crypto";

export type PayfastMode = "sandbox" | "live";

export function payfastMode(): PayfastMode {
  return process.env.PAYFAST_MODE === "live" ? "live" : "sandbox";
}

export function payfastMerchantId(): string {
  return process.env.PAYFAST_MERCHANT_ID || "10000100";
}

export function payfastMerchantKey(): string {
  return process.env.PAYFAST_MERCHANT_KEY || "46f0cd694581a";
}

// Unset in sandbox by default - PayFast's own sandbox test account has no
// passphrase configured, and setting one here that the sandbox account
// doesn't also have configured would make every signature mismatch. Real
// going-live checklist item: set this once a live merchant's own passphrase
// exists (PayFast dashboard > Settings > Integration).
export function payfastPassphrase(): string | null {
  return process.env.PAYFAST_PASSPHRASE || null;
}

export function payfastHost(): string {
  return payfastMode() === "live" ? "www.payfast.co.za" : "sandbox.payfast.co.za";
}

// Single source of truth for "is this still sandbox, from a customer's point
// of view" - read by both /billing's own copy (lib/payfast.ts -> page.tsx)
// AND the checkout route itself (/api/billing/checkout), so the two can
// never drift (one claiming "billing is active" while the other still
// quietly starts a PayFast sandbox transaction). NEXT_PUBLIC_PAYFAST_SANDBOX
// is the explicit override introduced by the 2026-10-23 UX audit (item 6);
// unset falls back to the real payfastMode().
export function isBillingSandboxed(): boolean {
  return process.env.NEXT_PUBLIC_PAYFAST_SANDBOX === undefined
    ? payfastMode() === "sandbox"
    : process.env.NEXT_PUBLIC_PAYFAST_SANDBOX === "true";
}

export function payfastProcessUrl(): string {
  return `https://${payfastHost()}/eng/process`;
}

export function payfastValidateUrl(): string {
  return `https://${payfastHost()}/eng/query/validate`;
}

// PayFast's documented hostnames for its own notification/process servers -
// used to check the ITN's source IP (one of their own documented 3
// security checks, alongside signature + server confirmation). Resolved by
// DNS at request time rather than hardcoded IPs, since PayFast's own docs
// say these can change; this repo doesn't pin them to a point-in-time list.
export const PAYFAST_ITN_HOSTNAMES = [
  "www.payfast.co.za",
  "sandbox.payfast.co.za",
  "w1w.payfast.co.za",
  "w2w.payfast.co.za",
];

// PayFast's actual rule, confirmed by reading the official SDK's own
// signing code (github.com/PayFast/payfast-php-sdk, lib/Auth.php,
// generateSignature()) rather than assumed from (conflicting) third-party
// tutorials: there is no single universal "canonical order" PayFast
// requires across every integration - the SDK's own array_filter() keeps
// whatever order YOUR data was already in, merely dropping any field name
// outside its known allowlist (below). What has to be true is narrower but
// load-bearing: the signature must be computed over fields in EXACTLY the
// same order they are then submitted in (PHP's $_POST, like Node's own
// parsed form body, preserves submission order) - so this file picks one
// fixed order and uses it for BOTH buildSignatureBaseString() and the
// actual submitted form fields (app/api/billing/checkout's route handler),
// never one order for signing and a different one for posting.
export const PAYFAST_CHECKOUT_FIELD_ORDER = [
  "merchant_id",
  "merchant_key",
  "return_url",
  "cancel_url",
  "notify_url",
  "notify_method",
  "name_first",
  "name_last",
  "email_address",
  "cell_number",
  "m_payment_id",
  "amount",
  "item_name",
  "item_description",
  "custom_int1",
  "custom_int2",
  "custom_int3",
  "custom_int4",
  "custom_int5",
  "custom_str1",
  "custom_str2",
  "custom_str3",
  "custom_str4",
  "custom_str5",
  "email_confirmation",
  "confirmation_address",
  "currency",
  "payment_method",
  "subscription_type",
  "billing_date",
  "recurring_amount",
  "frequency",
  "cycles",
] as const;

export type PayfastFields = Partial<Record<(typeof PAYFAST_CHECKOUT_FIELD_ORDER)[number], string>>;

// PayFast's own reference implementation signs with PHP's urlencode() (see
// github.com/PayFast/payfast-php-sdk, lib/PaymentIntegrations/Notification.php
// dataToString()) - confirmed byte-for-byte correct against that SDK's own
// recorded real ITN fixture (lib/payfast.spec.ts). PHP's urlencode() and
// JS's encodeURIComponent() differ in two ways, both corrected here:
// spaces become "+" not "%20", and urlencode() additionally escapes
// ! * ' ( ) - the 5 characters encodeURIComponent leaves untouched (its own
// "never escape" set includes them, PHP's urlencode's does not) - a company
// name containing an apostrophe (common in SA business names) would
// otherwise silently sign differently than PayFast's own server computes.
function payfastEncode(value: string): string {
  return encodeURIComponent(value.trim())
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function md5(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/** fields, filtered to the known set and placed in this file's one fixed order - the single source both the signature string AND the actual submitted form must iterate in (see PAYFAST_CHECKOUT_FIELD_ORDER's own comment: they must agree, not follow any particular canonical order). */
export function orderedCheckoutEntries(fields: PayfastFields): [string, string][] {
  return PAYFAST_CHECKOUT_FIELD_ORDER.filter((key) => fields[key] !== undefined && fields[key] !== "").map((key) => [
    key,
    fields[key]!,
  ]);
}

/** Builds the exact "key=value&key=value..." string PayFast signs, skipping empty fields. */
export function buildSignatureBaseString(fields: PayfastFields, passphrase?: string | null): string {
  const parts = orderedCheckoutEntries(fields).map(([key, value]) => `${key}=${payfastEncode(value)}`);
  if (passphrase) {
    parts.push(`passphrase=${payfastEncode(passphrase)}`);
  }
  return parts.join("&");
}

/** The signature for an outgoing checkout request (lib/payfast.ts's own field order + the configured passphrase, if any). */
export function signCheckoutFields(fields: PayfastFields): string {
  return md5(buildSignatureBaseString(fields, payfastPassphrase()));
}

/**
 * Verifies an INCOMING ITN's signature. Unlike the outgoing checkout
 * signature (built from our own field order above), PayFast's own ITN
 * verification recipe is to take the raw POST body PayFast actually sent,
 * strip its trailing "&signature=..." pair, optionally append
 * "&passphrase=...", and md5 that - reusing PayFast's own byte-for-byte
 * ordering and encoding rather than re-deriving a string from parsed
 * key/value pairs (which risks a subtle re-encoding mismatch e.g. "+" vs
 * "%20" vs "%2B"). rawBody is the exact application/x-www-form-urlencoded
 * body Next.js handed us (request.text()), before any parsing.
 */
export function verifyItnSignature(rawBody: string, receivedSignature: string): boolean {
  const withoutSignature = rawBody.replace(/(^|&)signature=[^&]*/, "").replace(/^&/, "");
  const passphrase = payfastPassphrase();
  const base = passphrase ? `${withoutSignature}&passphrase=${payfastEncode(passphrase)}` : withoutSignature;
  const expected = md5(base);
  return expected.toLowerCase() === receivedSignature.toLowerCase();
}

export type PlanAndInterval = { planTier: "starter" | "professional" | "business"; billingInterval: "monthly" | "yearly" };

/** custom_str2 encodes "plan:interval" - our own compact format, not PayFast's; parsed back out by the ITN handler. */
export function encodePlanInterval(plan: PlanAndInterval): string {
  return `${plan.planTier}:${plan.billingInterval}`;
}

export function decodePlanInterval(value: string | null | undefined): PlanAndInterval | null {
  if (!value) return null;
  const [planTier, billingInterval] = value.split(":");
  if (planTier !== "starter" && planTier !== "professional" && planTier !== "business") return null;
  if (billingInterval !== "monthly" && billingInterval !== "yearly") return null;
  return { planTier, billingInterval };
}

// PayFast's recurring-billing frequency codes (developers.payfast.co.za,
// "Subscriptions" - Monthly=3, Annual=6). cycles=0 means "until cancelled".
export const PAYFAST_FREQUENCY: Record<"monthly" | "yearly", number> = { monthly: 3, yearly: 6 };
export const PAYFAST_CYCLES_INDEFINITE = 0;
