import { describe, expect, it } from "vitest";
import { isSafeRedirectPath, safeRedirectPath } from "./safeRedirect";

// QA Finding, 2026-10-23: the 3 real call sites this replaced all used only
// `value.startsWith("/")` (one also excluded "//"), which a real browser's
// own WHATWG URL parsing bypasses via the backslash-is-a-path-separator
// rule for special schemes - `new URL("/\\evil.com", base).href` resolves
// to "https://evil.com/", not a same-origin path. Every case below is a
// real bypass attempt that passed at least one of the 3 original checks.
describe("isSafeRedirectPath", () => {
  it("accepts an ordinary same-origin path", () => {
    expect(isSafeRedirectPath("/dashboard")).toBe(true);
    expect(isSafeRedirectPath("/tenders/abc-123?tab=pack#section")).toBe(true);
  });

  it("accepts the bare root path", () => {
    expect(isSafeRedirectPath("/")).toBe(true);
  });

  it("rejects a protocol-relative URL (the one case all 3 original checks except one already caught)", () => {
    expect(isSafeRedirectPath("//evil.com")).toBe(false);
  });

  it("rejects the backslash bypass - a real open redirect every original check missed", () => {
    expect(isSafeRedirectPath("/\\evil.com")).toBe(false);
    expect(isSafeRedirectPath("/\\/evil.com")).toBe(false);
    expect(isSafeRedirectPath("/\\\\evil.com")).toBe(false);
  });

  it("rejects a value with no leading slash at all, including the userinfo '@' trick", () => {
    expect(isSafeRedirectPath("https://evil.com")).toBe(false);
    expect(isSafeRedirectPath("@evil.com")).toBe(false);
    expect(isSafeRedirectPath("evil.com")).toBe(false);
  });

  it("rejects empty, missing or non-string input", () => {
    expect(isSafeRedirectPath("")).toBe(false);
    expect(isSafeRedirectPath(null)).toBe(false);
    expect(isSafeRedirectPath(undefined)).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("returns the value unchanged when it's safe", () => {
    expect(safeRedirectPath("/people/42", "/dashboard")).toBe("/people/42");
  });

  it("falls back for every bypass attempt above, never passing one through", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "@evil.com", "https://evil.com", "", null, undefined]) {
      expect(safeRedirectPath(bad, "/dashboard")).toBe("/dashboard");
    }
  });
});
