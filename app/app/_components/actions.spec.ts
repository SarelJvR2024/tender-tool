import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness test for app/_components/actions.ts's
// signOut() - the account menu's "Sign out" button, rendered on every
// signed-in page (AppSidebar.tsx), including while a platform admin's
// "View Tenant Workspace" impersonation session is active.
//
// Finding (standing review pass, 2026-11-10): signOut() called plain
// createClient() (no bypass) - which, whenever the tt_impersonation cookie
// is present, swaps in the IMPERSONATED client (lib/supabase/server.ts): a
// throwaway, non-cookie-backed supabase-js instance (persistSession: false,
// no @supabase/ssr cookie sync). Calling .auth.signOut() on THAT client
// never touches the real admin's own sb-* cookies, nor the
// tt_impersonation cookie itself - so clicking "Sign out" while
// impersonating silently signed out nothing real: both the admin's actual
// session and the open impersonation session survived the redirect to
// /login. Fixed: signOut() now uses createClient({ bypassImpersonation:
// true }) (so the REAL signed-in identity is the one actually signed out)
// and, when an impersonation session is open, closes its audit row and
// clears its cookie first - the same bookkeeping endImpersonation()
// (impersonation-actions.ts) already does on its own "Exit impersonation"
// path.
//
// Mocking technique copied from this repo's own established convention for
// Server Action tests (app/company/officeActions.spec.ts /
// app/tenders/[id]/comment-actions.spec.ts): mock @/lib/supabase/server's
// createClient directly, record what options it was called with, and drive
// the real, unmodified exported action.

class RedirectSignal extends Error {
  url: string;
  constructor(url: string) {
    super("NEXT_REDIRECT");
    this.url = url;
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

const createClientCalls: Array<{ bypassImpersonation?: boolean } | undefined> = [];
const signOutMock = vi.fn().mockResolvedValue({ error: null });
const rpcMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/server", () => ({
  createClient: async (options?: { bypassImpersonation?: boolean }) => {
    createClientCalls.push(options);
    return {
      auth: { signOut: signOutMock },
      rpc: rpcMock,
    };
  },
}));

const readImpersonationCookieMock = vi.fn();
const clearImpersonationCookieMock = vi.fn();

vi.mock("@/lib/impersonation", () => ({
  readImpersonationCookie: readImpersonationCookieMock,
  clearImpersonationCookie: clearImpersonationCookieMock,
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  createClientCalls.length = 0;
});

async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    throw new Error("expected a redirect, action returned normally");
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
}

describe("signOut - while an impersonation session is active", () => {
  it("signs out the REAL admin identity, not the swapped-in impersonated client", async () => {
    readImpersonationCookieMock.mockResolvedValue({ auditLogId: "log-1", accessToken: "t", refreshToken: "r" });

    const { signOut } = await import("./actions");
    const url = await expectRedirect(signOut());

    expect(url).toBe("/login");
    // Pre-fix: createClient() was called with no options at all (undefined)
    // - never { bypassImpersonation: true } - so this is the assertion that
    // actually isolates the bug.
    expect(createClientCalls).toContainEqual({ bypassImpersonation: true });
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("closes the open impersonation session (audit row + cookie) instead of leaving it dangling", async () => {
    readImpersonationCookieMock.mockResolvedValue({ auditLogId: "log-1", accessToken: "t", refreshToken: "r" });

    const { signOut } = await import("./actions");
    await expectRedirect(signOut());

    expect(rpcMock).toHaveBeenCalledWith("platform_admin_end_impersonation", { p_audit_log_id: "log-1" });
    expect(clearImpersonationCookieMock).toHaveBeenCalledTimes(1);
  });
});

describe("signOut - no impersonation active (regression)", () => {
  it("still just signs out normally - no impersonation bookkeeping calls made", async () => {
    readImpersonationCookieMock.mockResolvedValue(null);

    const { signOut } = await import("./actions");
    const url = await expectRedirect(signOut());

    expect(url).toBe("/login");
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(clearImpersonationCookieMock).not.toHaveBeenCalled();
  });
});
