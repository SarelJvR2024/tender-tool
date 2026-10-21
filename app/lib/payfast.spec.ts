import { describe, expect, it } from "vitest";
import {
  buildCheckoutForm,
  CHECKOUT_FIELD_ORDER,
  formatAmount,
  generateSignature,
  isKnownPayfastItnHost,
  payfastUrlEncode,
  verifyItnSignature,
  type PayfastConfig,
} from "./payfast";

describe("payfastUrlEncode", () => {
  it("encodes spaces as + (PHP urlencode, not encodeURIComponent's %20)", () => {
    expect(payfastUrlEncode("John Smith")).toBe("John+Smith");
  });
  it("encodes reserved punctuation encodeURIComponent leaves alone", () => {
    expect(payfastUrlEncode("a'b(c)d*e!f")).toBe("a%27b%28c%29d%2Ae%21f");
  });
});

describe("formatAmount", () => {
  it("always renders two decimal places", () => {
    expect(formatAmount(1490)).toBe("1490.00");
    expect(formatAmount(29900)).toBe("29900.00");
    expect(formatAmount(99.5)).toBe("99.50");
  });
});

describe("generateSignature", () => {
  it("is order-sensitive - the same fields in a different order hash differently", () => {
    const a = generateSignature([["a", "1"], ["b", "2"]]);
    const b = generateSignature([["b", "2"], ["a", "1"]]);
    expect(a).not.toBe(b);
  });
  it("drops blank values rather than hashing an empty segment", () => {
    const withBlank = generateSignature([["a", "1"], ["b", ""], ["c", "3"]]);
    const withoutBlank = generateSignature([["a", "1"], ["c", "3"]]);
    expect(withBlank).toBe(withoutBlank);
  });
  it("appends the passphrase when given", () => {
    const withoutPassphrase = generateSignature([["a", "1"]]);
    const withPassphrase = generateSignature([["a", "1"]], "secret");
    expect(withPassphrase).not.toBe(withoutPassphrase);
  });
  it("is a lowercase 32-char hex MD5 digest", () => {
    expect(generateSignature([["a", "1"]])).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("buildCheckoutForm", () => {
  const config: PayfastConfig = { merchantId: "10000100", merchantKey: "46f0cd694581a", passphrase: undefined, mode: "sandbox" };

  it("renders fields in CHECKOUT_FIELD_ORDER, dropping any left unset", () => {
    const { fields } = buildCheckoutForm(
      { merchant_id: config.merchantId, merchant_key: config.merchantKey, amount: "1490.00", item_name: "Starter plan" },
      config
    );
    const keys = fields.map(([k]) => k);
    expect(keys.slice(0, -1)).toEqual(["merchant_id", "merchant_key", "amount", "item_name"]);
    expect(keys.at(-1)).toBe("signature");
  });

  it("the signature it appends matches generateSignature() over the same rendered fields", () => {
    const values = { merchant_id: config.merchantId, merchant_key: config.merchantKey, amount: "2990.00", item_name: "Professional plan" };
    const { fields } = buildCheckoutForm(values, config);
    const withoutSignature = fields.slice(0, -1);
    const signature = fields.at(-1)![1];
    expect(generateSignature(withoutSignature, config.passphrase)).toBe(signature);
  });

  it("points at the sandbox host in sandbox mode, live host in live mode", () => {
    const sandbox = buildCheckoutForm({ merchant_id: "x", merchant_key: "y" }, config);
    expect(sandbox.actionUrl).toContain("sandbox.payfast.co.za");
    const live = buildCheckoutForm({ merchant_id: "x", merchant_key: "y" }, { ...config, mode: "live" });
    expect(live.actionUrl).toContain("www.payfast.co.za");
    expect(live.actionUrl).not.toContain("sandbox");
  });
});

describe("verifyItnSignature", () => {
  it("accepts a body whose signature matches the fields in received order", () => {
    const entries: Array<[string, string]> = [
      ["m_payment_id", "abc-123"],
      ["pf_payment_id", "999"],
      ["payment_status", "COMPLETE"],
      ["amount_gross", "2990.00"],
    ];
    const signature = generateSignature(entries, "my-passphrase");
    const body = new URLSearchParams([...entries, ["signature", signature]]).toString();
    const result = verifyItnSignature(body, "my-passphrase");
    expect(result.valid).toBe(true);
    expect(result.fields.payment_status).toBe("COMPLETE");
  });

  it("rejects a body whose signature doesn't match (tampered field)", () => {
    const entries: Array<[string, string]> = [
      ["m_payment_id", "abc-123"],
      ["amount_gross", "2990.00"],
    ];
    const signature = generateSignature(entries, "my-passphrase");
    // Tamper with the amount after signing - this is exactly what a forged
    // ITN would look like.
    const tampered = new URLSearchParams([
      ["m_payment_id", "abc-123"],
      ["amount_gross", "1.00"],
      ["signature", signature],
    ]).toString();
    expect(verifyItnSignature(tampered, "my-passphrase").valid).toBe(false);
  });

  it("rejects a body signed with the wrong passphrase", () => {
    const entries: Array<[string, string]> = [["a", "1"]];
    const signature = generateSignature(entries, "right-passphrase");
    const body = new URLSearchParams([...entries, ["signature", signature]]).toString();
    expect(verifyItnSignature(body, "wrong-passphrase").valid).toBe(false);
  });

  it("is false (not a throw) when there is no signature field at all", () => {
    const body = new URLSearchParams([["a", "1"]]).toString();
    expect(verifyItnSignature(body).valid).toBe(false);
  });
});

describe("isKnownPayfastItnHost", () => {
  it("accepts PayFast's documented ITN source hosts", () => {
    expect(isKnownPayfastItnHost("www.payfast.co.za")).toBe(true);
    expect(isKnownPayfastItnHost("sandbox.payfast.co.za")).toBe(true);
    expect(isKnownPayfastItnHost("w1w.payfast.co.za")).toBe(true);
  });
  it("rejects anything else, including a lookalike domain", () => {
    expect(isKnownPayfastItnHost("payfast.co.za.evil.com")).toBe(false);
    expect(isKnownPayfastItnHost("attacker.com")).toBe(false);
  });
});

describe("CHECKOUT_FIELD_ORDER", () => {
  it("has no duplicate field names", () => {
    expect(new Set(CHECKOUT_FIELD_ORDER).size).toBe(CHECKOUT_FIELD_ORDER.length);
  });
});
