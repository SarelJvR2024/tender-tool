import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// siteUrl() reads next/headers' headers() directly - mocked here so each
// case can set exactly the Host value a real incoming request would carry,
// without needing a real Next.js request/response cycle.
vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { headers } from "next/headers";
import { siteUrl } from "./siteUrl";

function mockHost(host: string | null) {
  (headers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: (name: string) => (name === "host" ? host : null),
  });
}

describe("siteUrl", () => {
  const originalVercelUrl = process.env.VERCEL_URL;

  beforeEach(() => {
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    if (originalVercelUrl === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = originalVercelUrl;
    vi.clearAllMocks();
  });

  it("trusts the real production domain", async () => {
    mockHost("tenderready.app");
    expect(await siteUrl()).toBe("https://tenderready.app");
  });

  it("trusts www. on the real production domain", async () => {
    mockHost("www.tenderready.app");
    expect(await siteUrl()).toBe("https://www.tenderready.app");
  });

  it("trusts any *.vercel.app deployment (prod alias and previews alike)", async () => {
    mockHost("tender-ready-git-fix-xyz123.vercel.app");
    expect(await siteUrl()).toBe("https://tender-ready-git-fix-xyz123.vercel.app");
  });

  it("trusts localhost (with a port) over http, for npm run dev", async () => {
    mockHost("localhost:3100");
    expect(await siteUrl()).toBe("http://localhost:3100");
  });

  it("trusts 127.0.0.1", async () => {
    mockHost("127.0.0.1:3000");
    expect(await siteUrl()).toBe("http://127.0.0.1:3000");
  });

  // Finding 267-class follow-up: the Host header is exactly as
  // client-controlled as a query param - a plain raw HTTP client can send
  // any value it likes. This is the real, direct repro: pre-fix, this
  // returned "https://evil.attacker.example" verbatim (confirmed before
  // writing the fix). Post-fix it must never be trusted.
  it("does NOT trust an arbitrary/spoofed Host header - falls back instead", async () => {
    mockHost("evil.attacker.example");
    const result = await siteUrl();
    expect(result).not.toBe("https://evil.attacker.example");
    expect(result).toBe("http://localhost:3000"); // no VERCEL_URL set in this test env
  });

  it("does NOT trust a spoofed Host even when it merely contains the real domain as a substring", async () => {
    mockHost("tenderready.app.evil.example");
    const result = await siteUrl();
    expect(result).not.toContain("evil.example");
  });

  it("falls back to VERCEL_URL when the Host header is unrecognised, same as when it's absent", async () => {
    process.env.VERCEL_URL = "tender-ready-abc123.vercel.app";
    mockHost("evil.attacker.example");
    expect(await siteUrl()).toBe("https://tender-ready-abc123.vercel.app");
  });

  it("falls back to VERCEL_URL when the Host header is entirely absent (pre-existing behavior, unchanged)", async () => {
    process.env.VERCEL_URL = "tender-ready-abc123.vercel.app";
    mockHost(null);
    expect(await siteUrl()).toBe("https://tender-ready-abc123.vercel.app");
  });

  it("falls back to the plain localhost default when Host is absent and VERCEL_URL isn't set (pre-existing behavior, unchanged)", async () => {
    mockHost(null);
    expect(await siteUrl()).toBe("http://localhost:3000");
  });

  // Standing-review pass, 2026-11-09 (follow-up to Finding 269): the
  // Finding 268 fix above validates only the part of the Host header
  // BEFORE the first colon (`isKnownGoodHost`'s own `host.split(":")[0]`,
  // meant to strip a real port like "localhost:3100") - but `siteUrl()`
  // itself then reconstructs the URL from the RAW, un-stripped host
  // string, not from the validated hostname. A Host header shaped like
  // "tenderready.app:@evil.attacker.example" passes the allowlist check
  // (its pre-colon part is the real domain) and is then substituted
  // verbatim into "https://tenderready.app:@evil.attacker.example" - which
  // is NOT a request to tenderready.app with a weird port. Every WHATWG-
  // compliant URL parser (every real browser, and Node's own `URL`,
  // confirmed directly: `new URL("https://tenderready.app:@evil.attacker.example").host`
  // is "evil.attacker.example") treats "tenderready.app:" as userinfo
  // (text before a trailing "@") and "evil.attacker.example" as the real
  // host - the exact same "looks same-origin to a naive string check, is a
  // different origin to every real URL parser" shape Finding 267 already
  // fixed once in safeRedirect.ts, just never checked for here. This is a
  // live bypass of the Finding 268 fix in the one file it exists to
  // protect - confirmed, not merely suspected, by the real `new URL(...)`
  // call above and by a real spoofed-Host request against a real running
  // dev server (see this pass's own System-Status.md write-up).
  it("does NOT trust a Host header that uses a fake 'port' to smuggle a different real host via userinfo (Finding 268-fix bypass)", async () => {
    mockHost("tenderready.app:@evil.attacker.example");
    const result = await siteUrl();
    expect(result).not.toContain("evil.attacker.example");
    // Confirm the claim about how a real URL parser resolves the
    // pre-fix value, so this test fails loudly (not just on a substring)
    // if the fix regresses back to returning that value verbatim.
    expect(new URL(result).host).not.toBe("evil.attacker.example");
  });

  it("does NOT trust a Host header with a non-numeric 'port' on a *.vercel.app host either (same bypass, different allowlist branch)", async () => {
    mockHost("my-preview.vercel.app:@evil.attacker.example");
    const result = await siteUrl();
    expect(result).not.toContain("evil.attacker.example");
  });

  it("still trusts a real numeric port on the real production domain (no false-positive narrowing)", async () => {
    mockHost("tenderready.app:8443");
    expect(await siteUrl()).toBe("https://tenderready.app:8443");
  });

  // Standing-review pass, 2026-11-09 (Finding 271 - found while re-reading
  // THIS file adversarially for a third time): `isLocal` used to be computed
  // with `goodHostAndPort.startsWith("localhost")` - a SUBSTRING check, not
  // an exact-hostname check. Any real *.vercel.app host whose name happens
  // to start with the literal text "localhost" (a perfectly legal, real
  // Vercel project/preview name - nothing stops anyone naming one that way)
  // already passes the KNOWN_GOOD_HOSTS allowlist on its own merits, but
  // then ALSO tripped this substring check and got "http://" instead of
  // "https://" - a real scheme downgrade for an already-validated host,
  // confirmed live against the real function pre-fix (see this pass's own
  // System-Status.md write-up for the exact curl round-trip).
  it("does NOT downgrade to http:// for a real .vercel.app host that merely starts with the text 'localhost' (Finding 271 - isLocal substring-match bug)", async () => {
    mockHost("localhost-preview-abc123.vercel.app");
    const result = await siteUrl();
    expect(result).toBe("https://localhost-preview-abc123.vercel.app");
  });

  it("does NOT downgrade to http:// for the exact host 'localhost.vercel.app' either (same bug, zero-length suffix after the literal word)", async () => {
    mockHost("localhost.vercel.app");
    const result = await siteUrl();
    expect(result).toBe("https://localhost.vercel.app");
  });

  // Side effect of the Finding 271 rewrite (parsing through the real `URL`
  // constructor, which WHATWG-normalizes hostnames to lowercase): the real
  // production domain is now correctly recognised regardless of case, where
  // the old hand-rolled regex match was case-sensitive and would have
  // fallen back instead. Not a security fix - case differences could never
  // make the OLD check accept a different, attacker-chosen domain, only
  // reject a differently-cased real one - but locking it in since the
  // behaviour genuinely changed here and a future edit could regress it.
  it("recognises the real production domain regardless of header case (URL-parser normalization, not a security property)", async () => {
    mockHost("TenderReady.App");
    expect(await siteUrl()).toBe("https://tenderready.app");
  });

  // Side effect of the Finding 271 rewrite: a Host carrying userinfo is now
  // rejected outright by the `username`/`password` check, rather than
  // (as the Finding 270 fix alone did) merely being prevented from putting
  // the attacker-chosen prefix anywhere in the final result. Confirms the
  // tightened behaviour directly, not just "doesn't contain evil.attacker.example".
  it("rejects a Host that carries userinfo outright, even on the *.vercel.app allowlist branch, rather than stripping it and returning the real host anyway", async () => {
    mockHost("evil.attacker.example@fake.vercel.app");
    const result = await siteUrl();
    expect(result).not.toBe("https://fake.vercel.app");
    expect(result).toBe("http://localhost:3000"); // falls back, same as any other rejected host
  });
});
