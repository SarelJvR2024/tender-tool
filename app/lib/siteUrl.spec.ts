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
});
