import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Finding 356, standing review pass 2026-11-10. `proxy.ts`'s own
 * "signed in but no company yet -> /onboarding" check (the `company_members`
 * read a few lines down) always authenticates against the REAL signed-in
 * user's own `sb-*` cookies - correct and unaffected by impersonation, per
 * this repo's own prior, already-documented finding on the impersonation
 * SESSION-REFRESH gap (a different problem: the impersonated session's
 * tokens going stale, not this check). But during an active "View Tenant
 * Workspace" impersonation session (Admin Command Center Phase 4), the
 * REAL signed-in user is the platform admin - and `platform_admins`
 * (migration 0043) is its own table, explicitly "Not a customer role - a
 * company owner is NOT a platform admin", so a dedicated admin account
 * genuinely has no `company_members` row of its own. With no guard here,
 * this check force-redirects EVERY guarded request made while impersonating
 * (i.e. every page "View Tenant Workspace" exists to let an admin view) to
 * `/onboarding` - which itself renders via the swapped-in IMPERSONATED
 * session (lib/supabase/server.ts's `createClient()`, unlike this
 * middleware, DOES honor the `tt_impersonation` cookie) and, once the
 * target company's own onboarding is already done, bounces straight back -
 * an infinite redirect loop that breaks the whole feature for any admin
 * account with no company of its own.
 *
 * Mocks @supabase/ssr's createServerClient with a fake client standing in
 * for a REAL admin user (no company_members row) - the exact state that
 * triggers the bug - and drives the real, unmodified `proxy()` export
 * against two real NextRequest objects differing only in whether the
 * `tt_impersonation` cookie is present.
 */

const getUserMock = vi.fn();
const maybeSingleMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    }),
  }),
}));

describe("proxy() - guarded route membership check vs. active impersonation", () => {
  it("still redirects a genuinely-unonboarded signed-in user to /onboarding (unaffected, no impersonation cookie)", async () => {
    const { proxy } = await import("./proxy");
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    maybeSingleMock.mockResolvedValue({ data: null, error: null }); // no company_members row

    const req = new NextRequest("http://localhost:3000/dashboard");
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/onboarding");
  });

  it("does NOT redirect a signed-in platform admin with no company of their own to /onboarding while an impersonation cookie is active", async () => {
    const { proxy } = await import("./proxy");
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    maybeSingleMock.mockResolvedValue({ data: null, error: null }); // admin's own account: no company_members row

    const req = new NextRequest("http://localhost:3000/dashboard", {
      headers: { cookie: "tt_impersonation=%7B%22auditLogId%22%3A%22a%22%2C%22accessToken%22%3A%22t%22%2C%22refreshToken%22%3A%22r%22%7D" },
    });
    const res = await proxy(req);

    // Before the fix: this redirects to /onboarding exactly like the first
    // test, even though the admin is actively impersonating - the real bug.
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
