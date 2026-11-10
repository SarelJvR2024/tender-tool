import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness test for
// app/app/admin/customers/impersonation-actions.ts's startImpersonation().
//
// Finding (standing review pass, 2026-11-10): admin/layout.tsx's own
// is_platform_admin() guard - the thing impersonation-actions.ts's own
// header comment relies on to say "an already-active impersonation session
// ... can't reach this page at all" - only runs when /admin/customers is
// RENDERED. It does NOT run again when a Server Action bound on that page
// is invoked directly (Next.js executes a Server Action by its own
// reference id, never by re-rendering the page/layout tree first) - and
// CustomerRow.tsx's own "View Tenant Workspace" button is a plain
// `<form action={startImpersonation}>` with the company id baked into a
// hidden input, which stays live in the DOM of any already-rendered
// /admin/customers tab/page forever.
//
// So: admin opens /admin/customers, clicks "View Tenant Workspace" for
// Company A (cookie now holds Company A's audit log id) - then, from a
// second tab/window still showing that same, earlier-rendered
// /admin/customers page (or the same tab via back/forward-cache), clicks
// "View Tenant Workspace" for Company B. startImpersonation() itself never
// reads the existing impersonation cookie at all - it unconditionally opens
// a NEW impersonation_audit_logs row and overwrites the cookie with Company
// B's own audit_log_id, discarding Company A's audit_log_id with no code
// path left that can ever reach it again. Company A's own audit row is
// left with ended_at permanently null - not the honest "still open" state
// migration 0102's own column comment describes (cookie not yet exited, or
// expired), but a silently abandoned one that can NEVER be closed by
// anything, defeating the whole point of migration 0102's "Immutable Audit
// Logging" guardrail (a correct open/closed state for every session).
//
// Fixed: startImpersonation() now reads the impersonation cookie FIRST and,
// if one is already open, closes its audit row (platform_admin_end_impersonation,
// best-effort/logged-not-surfaced - same shape endImpersonation() and
// signOut() already use for their own bookkeeping) before opening the new
// one - so switching targets is always recorded as end-then-start, never a
// silent overwrite, and no row can ever be left open with no way back to it.
//
// Mocking technique copied from this repo's own established convention for
// Server Action tests (app/company/officeActions.spec.ts /
// app/app/_components/actions.spec.ts, Finding 357): mock
// @/lib/supabase/server's createClient and @/lib/impersonation directly,
// record what they were called with, and drive the real, unmodified
// exported action.

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

const rpcCalls: Array<{ fn: string; args: unknown }> = [];
const rpcMock = vi.fn(async (fn: string, args: unknown) => {
  rpcCalls.push({ fn, args });
  if (fn === "platform_admin_start_impersonation") {
    return { data: [{ audit_log_id: "new-log", target_user_id: "target-user", target_email: "member@example.co.za", company_name: "Company B" }], error: null };
  }
  if (fn === "platform_admin_end_impersonation") {
    return { data: null, error: null };
  }
  throw new Error(`unexpected rpc ${fn}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
    rpc: rpcMock,
  }),
}));

const readImpersonationCookieMock = vi.fn();
const setImpersonationCookieMock = vi.fn();
const mintTargetSessionMock = vi.fn().mockResolvedValue({ ok: true, accessToken: "new-access", refreshToken: "new-refresh" });

vi.mock("@/lib/impersonation", () => ({
  readImpersonationCookie: readImpersonationCookieMock,
  setImpersonationCookie: setImpersonationCookieMock,
  clearImpersonationCookie: vi.fn(),
  mintTargetSession: mintTargetSessionMock,
}));

afterEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
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

function formWith(companyId: string): FormData {
  const fd = new FormData();
  fd.set("company_id", companyId);
  return fd;
}

describe("startImpersonation - a dangling, already-open impersonation session", () => {
  it("closes the OLD audit row before opening a new one, instead of silently overwriting the cookie", async () => {
    readImpersonationCookieMock.mockResolvedValue({ auditLogId: "old-log", accessToken: "old-access", refreshToken: "old-refresh" });

    const { startImpersonation } = await import("./impersonation-actions");
    const url = await expectRedirect(startImpersonation(formWith("company-b")));

    expect(url).toBe("/dashboard");
    // Pre-fix: rpcCalls never contains an "end" call for "old-log" at all -
    // this is the assertion that isolates the leaked-open-row bug.
    expect(rpcCalls).toContainEqual({ fn: "platform_admin_end_impersonation", args: { p_audit_log_id: "old-log" } });
    expect(setImpersonationCookieMock).toHaveBeenCalledWith({ auditLogId: "new-log", accessToken: "new-access", refreshToken: "new-refresh" });
  });
});

describe("startImpersonation - no existing impersonation session (regression)", () => {
  it("starts normally, with no end-impersonation bookkeeping call made", async () => {
    readImpersonationCookieMock.mockResolvedValue(null);

    const { startImpersonation } = await import("./impersonation-actions");
    const url = await expectRedirect(startImpersonation(formWith("company-b")));

    expect(url).toBe("/dashboard");
    expect(rpcCalls.some((c) => c.fn === "platform_admin_end_impersonation")).toBe(false);
    expect(rpcCalls).toContainEqual({ fn: "platform_admin_start_impersonation", args: { p_company_id: "company-b", p_reason: "Admin Diagnostics" } });
  });
});
