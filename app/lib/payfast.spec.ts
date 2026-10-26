import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSignatureBaseString,
  decodePlanInterval,
  encodePlanInterval,
  isBillingSandboxed,
  signCheckoutFields,
  verifyItnSignature,
} from "./payfast";

// payfastPassphrase() reads process.env.PAYFAST_PASSPHRASE directly (no way
// to inject it as a param from here), and every fixture below - including
// PayFast's own real recorded ITN signature - was computed assuming NO
// passphrase (PayFast's sandbox has none configured by default). Without
// this, these tests are not hermetic: they pass or fail depending on
// whatever this environment's real PAYFAST_PASSPHRASE happens to be, which
// is exactly the kind of thing a deployment environment legitimately sets
// (QA pass, 2026-10-22 - confirmed live: this environment has a real,
// non-empty PAYFAST_PASSPHRASE configured, and every verifyItnSignature
// test failed against it, including the "reproduces PayFast's own real ITN
// signature" one - not because the code is wrong, but because the test
// never isolated itself from the ambient environment). vi.stubEnv() clears
// it for every test in this file and vi.unstubAllEnvs() restores the real
// value afterward, so this suite's own correctness never depends on what a
// given machine happens to have configured.
beforeEach(() => {
  vi.stubEnv("PAYFAST_PASSPHRASE", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildSignatureBaseString", () => {
  it("orders fields per PayFast's documented order, not insertion order", () => {
    // Deliberately inserted out of order (amount before merchant_id) -
    // the output must still read merchant_id first.
    const base = buildSignatureBaseString({ amount: "100.00", merchant_id: "10000100", item_name: "Tender Pro" });
    expect(base).toBe("merchant_id=10000100&amount=100.00&item_name=Tender+Pro");
  });

  it("skips undefined/empty fields entirely - never an empty '&key='", () => {
    const base = buildSignatureBaseString({ merchant_id: "10000100", name_last: "", email_address: undefined });
    expect(base).toBe("merchant_id=10000100");
  });

  it("encodes spaces as '+' (PayFast/PHP urlencode convention), not %20", () => {
    const base = buildSignatureBaseString({ item_name: "SANRAL Pro plan" });
    expect(base).toBe("item_name=SANRAL+Pro+plan");
    expect(base).not.toContain("%20");
  });

  it("appends the passphrase last, when configured", () => {
    const base = buildSignatureBaseString({ merchant_id: "10000100" }, "mypassphrase");
    expect(base).toBe("merchant_id=10000100&passphrase=mypassphrase");
  });
});

describe("signCheckoutFields", () => {
  it("is a deterministic 32-char lowercase md5 hex digest", () => {
    const sig = signCheckoutFields({ merchant_id: "10000100", merchant_key: "46f0cd694581a", amount: "1490.00" });
    expect(sig).toMatch(/^[0-9a-f]{32}$/);
    expect(sig).toBe(signCheckoutFields({ merchant_id: "10000100", merchant_key: "46f0cd694581a", amount: "1490.00" }));
  });
});

describe("verifyItnSignature", () => {
  // Builds a raw ITN-shaped body the same way PayFast would send it, signs
  // it the same way PayFast signs its own ITN (md5 of the body with the
  // signature pair stripped out), and confirms verifyItnSignature accepts
  // it - then confirms any tampering is rejected. This is the one place
  // correctness really matters (per this piece's own brief), so it's
  // checked both ways, not just the happy path.
  function rawBodyWithSignature(fieldsWithoutSignature: string): string {
    const signature = createHash("md5").update(fieldsWithoutSignature, "utf8").digest("hex");
    return `${fieldsWithoutSignature}&signature=${signature}`;
  }

  it("accepts a correctly-signed body", () => {
    const body = rawBodyWithSignature("m_payment_id=abc123&pf_payment_id=99&payment_status=COMPLETE&amount_gross=1490.00");
    const signature = body.match(/signature=([0-9a-f]+)/)![1];
    expect(verifyItnSignature(body, signature)).toBe(true);
  });

  it("rejects a tampered body (amount changed after signing)", () => {
    const body = rawBodyWithSignature("m_payment_id=abc123&payment_status=COMPLETE&amount_gross=1490.00");
    const signature = body.match(/signature=([0-9a-f]+)/)![1];
    const tampered = body.replace("1490.00", "1.00");
    expect(verifyItnSignature(tampered, signature)).toBe(false);
  });

  it("rejects a wrong signature outright", () => {
    const body = "m_payment_id=abc123&payment_status=COMPLETE&signature=deadbeef";
    expect(verifyItnSignature(body, "deadbeef")).toBe(false);
  });
});

describe("verifyItnSignature against PayFast's own official recorded fixture", () => {
  // Not self-referential like the round-trip tests above: this exact
  // {data, signature} pair comes verbatim from PayFast's own open-source
  // SDK test suite (github.com/PayFast/payfast-php-sdk,
  // tests/PaymentIntegrations/NotificationTest.php's setUp(), no
  // passphrase) - a real signature PayFast's own server actually produced
  // for this real data, read directly from their repo (cloned and read in
  // full during this piece's own live verification pass - see
  // app/AGENTS.md). Matching it byte-for-byte is the strongest available
  // confirmation that this file's encoding (PHP urlencode semantics: "+"
  // for space, ! * ' ( ) escaped - the two ways encodeURIComponent differs
  // from PHP's urlencode) is correct, independent of this repo's own code
  // being self-consistent with itself.
  it("reproduces PayFast's own real ITN signature for their own test fixture", () => {
    const orderedPairs = [
      ["m_payment_id", "000000020"],
      ["pf_payment_id", "1579137"],
      ["payment_status", "COMPLETE"],
      ["item_name", "Order #000000020"],
      ["item_description", ""],
      ["amount_gross", "15.00"],
      ["amount_fee", "-2.30"],
      ["amount_net", "12.70"],
      ["custom_str1", ""],
      ["custom_str2", ""],
      ["custom_str3", ""],
      ["custom_str4", ""],
      ["custom_str5", ""],
      ["custom_int1", ""],
      ["custom_int2", ""],
      ["custom_int3", ""],
      ["custom_int4", ""],
      ["custom_int5", ""],
      ["name_first", "Tom"],
      ["name_last", "Tom"],
      ["email_address", "lindley+user1@appinlet.com"],
      ["merchant_id", "10027938"],
    ] as const;
    const rawBody =
      orderedPairs.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, "+")}`).join("&") +
      "&signature=4078bca2c8987e0e0c4e7230f2f46323";
    expect(verifyItnSignature(rawBody, "4078bca2c8987e0e0c4e7230f2f46323")).toBe(true);
  });
});

describe("isBillingSandboxed", () => {
  // Regression coverage for the billing-review fix (2026-10-26): /billing's
  // Subscribe buttons and /api/billing/checkout itself both call this one
  // function so they can never disagree - a disabled button while the
  // route still happily starts a sandbox transaction underneath it (the
  // bug this fix closed) would show up here as route/page reading
  // different results for the same env, which these cases rule out.
  it("defaults to sandboxed when PAYFAST_MODE is unset (no live credentials configured)", () => {
    vi.stubEnv("PAYFAST_MODE", undefined);
    vi.stubEnv("NEXT_PUBLIC_PAYFAST_SANDBOX", undefined);
    expect(isBillingSandboxed()).toBe(true);
  });

  it("is not sandboxed once PAYFAST_MODE=live, with no override set", () => {
    vi.stubEnv("PAYFAST_MODE", "live");
    vi.stubEnv("NEXT_PUBLIC_PAYFAST_SANDBOX", undefined);
    expect(isBillingSandboxed()).toBe(false);
  });

  it("stays sandboxed when PAYFAST_MODE is explicitly 'sandbox'", () => {
    vi.stubEnv("PAYFAST_MODE", "sandbox");
    vi.stubEnv("NEXT_PUBLIC_PAYFAST_SANDBOX", undefined);
    expect(isBillingSandboxed()).toBe(true);
  });

  it("NEXT_PUBLIC_PAYFAST_SANDBOX='true' forces sandboxed even if PAYFAST_MODE=live", () => {
    vi.stubEnv("PAYFAST_MODE", "live");
    vi.stubEnv("NEXT_PUBLIC_PAYFAST_SANDBOX", "true");
    expect(isBillingSandboxed()).toBe(true);
  });

  it("NEXT_PUBLIC_PAYFAST_SANDBOX='false' forces not-sandboxed even if PAYFAST_MODE=live (matches, doesn't fight, the real mode)", () => {
    vi.stubEnv("PAYFAST_MODE", "live");
    vi.stubEnv("NEXT_PUBLIC_PAYFAST_SANDBOX", "false");
    expect(isBillingSandboxed()).toBe(false);
  });
});

describe("encodePlanInterval / decodePlanInterval", () => {
  it("round-trips", () => {
    const encoded = encodePlanInterval({ planTier: "business", billingInterval: "yearly" });
    expect(encoded).toBe("business:yearly");
    expect(decodePlanInterval(encoded)).toEqual({ planTier: "business", billingInterval: "yearly" });
  });

  it("rejects an unknown plan or interval rather than guessing", () => {
    expect(decodePlanInterval("enterprise:monthly")).toBeNull(); // enterprise is priced on request, never a self-serve PayFast checkout
    expect(decodePlanInterval("starter:weekly")).toBeNull();
    expect(decodePlanInterval(null)).toBeNull();
  });
});
