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

  // Finding 267, 2026-11-09: a tab/newline/CR character hidden right after
  // the leading "/" passed the backslash-bypass check above (the next
  // character is neither "/" nor "\\"), but the WHATWG URL parser every
  // real browser (and Node's own spec-compliant `URL`) implements strips
  // ALL ASCII tab (U+0009) and newline (U+000A/U+000D) characters from a
  // URL string unconditionally, BEFORE resolving it - so the value a
  // browser actually navigates to has that character gone, re-forming the
  // exact "//" or "/\\" bypass shape this file already guards against.
  // Confirmed live, not just read-and-reasoned: `router.push()` on this
  // exact value, in a real Chromium tab against this app's own dev server,
  // issued a real outbound request to the attacker host
  // (`net::ERR_NAME_NOT_RESOLVED` only because that host doesn't exist,
  // not because the navigation was refused).
  it("rejects a tab/newline/CR-hidden backslash or protocol-relative bypass", () => {
    expect(isSafeRedirectPath("/\t\\evil.com")).toBe(false);
    expect(isSafeRedirectPath("/\t/evil.com")).toBe(false);
    expect(isSafeRedirectPath("/\n\\evil.com")).toBe(false);
    expect(isSafeRedirectPath("/\n/evil.com")).toBe(false);
    expect(isSafeRedirectPath("/\r\\evil.com")).toBe(false);
    expect(isSafeRedirectPath("/\r/evil.com")).toBe(false);
  });

  it("still accepts a legitimate path that happens to contain none of these characters right after the leading slash", () => {
    // a tab/newline elsewhere in the path is stripped by the same browser
    // behaviour, but doesn't reintroduce "//" or "/\\" right at the start,
    // so it's still a same-origin path, not a bypass - confirmed directly
    // against the real WHATWG `URL` parser (`new URL(...)` stays on the
    // same origin for this exact value).
    expect(isSafeRedirectPath("/dash\tboard/evil.com")).toBe(true);
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
