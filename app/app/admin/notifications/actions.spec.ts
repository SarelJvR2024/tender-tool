import { afterEach, describe, expect, it, vi } from "vitest";

// First dedicated test file for app/admin/notifications/actions.ts - standing
// review, 2026-11-09. sendTestNotificationEmail() ("Send Test to Me" on the
// Template Gallery) is the only one of /admin/'s 15 real Server Actions with
// no is_platform_admin() check anywhere in its own call chain - not in the
// action itself (unlike markHarnessRunReviewed/writeAlertResolution's RLS-
// enforced-update-then-zero-row-check, setTestCompany/setPlatformSetting/
// startImpersonation/endImpersonation/overrideOpportunityConfidence/
// submitRequirementReview/reprocessRequirementExtraction's SECURITY DEFINER
// RPCs that each call `if not is_platform_admin() then raise exception`
// internally, or addCategory/updateCategory/approveSuggestion/
// rejectSuggestion's own explicit requireAdmin() helper), and not in the two
// RPCs it calls either: claim_notification()/record_notification_sent()
// (migration 0093, `grant ... to anon, authenticated`) are DELIBERATELY not
// admin-gated - their own comments say so ("called from both the anon/
// authenticated context (a Server Action with no service-role key, e.g. the
// welcome email)") - so they are not a backstop for this one admin-only
// caller the way they are for every other real sender.
//
// admin/layout.tsx's own header comment already establishes, as settled fact
// in this codebase (UX audit 2026-10-23, item 5, confirmed live with a
// non-admin account), that /admin/*'s shared segment layout - and therefore
// its is_platform_admin() gate - does not run before a Server Action defined
// under that segment: "a Server Action is reachable by direct POST" is the
// exact phrase every one of this file's 5 sibling admin actions.ts files
// uses for why each re-checks admin status itself. This file never did.
//
// Mocking technique copied from the established convention
// (app/people/actions.spec.ts and siblings): a mocked
// `@/lib/supabase/server`/`next/navigation`, calling the real, unmodified
// exported action, not a reimplementation of its logic. `@/lib/resendEmail`
// is mocked too, purely so a real outbound Resend call is never attempted
// from a test - its mock's own call count is exactly what proves whether
// the bug let a non-admin's test-send actually reach the point of sending.

type RpcResp = { data: unknown; error: { message: string } | null };

const sendTransactionalEmailMock = vi.fn(async () => ({ status: "sent" as const, resendId: "re_test_123" }));
vi.mock("@/lib/resendEmail", () => ({
  sendTransactionalEmail: sendTransactionalEmailMock,
}));

function makeSupabase(userEmail: string | null, rpcResponses: Record<string, RpcResp>) {
  const rpcCalls: { name: string; params: unknown }[] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: userEmail ? { id: "user-1", email: userEmail } : null } }) },
      rpc: async (name: string, params: unknown) => {
        rpcCalls.push({ name, params });
        return rpcResponses[name] ?? { data: null, error: null };
      },
    },
    rpcCalls,
  };
}

const supabaseState: { current: ReturnType<typeof makeSupabase>["client"] | null } = { current: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseState.current,
}));

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

async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    throw new Error("expected a redirect, action returned normally");
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
}

function formDataWith(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

afterEach(() => {
  vi.resetModules();
  sendTransactionalEmailMock.mockClear();
  supabaseState.current = null;
});

describe("sendTestNotificationEmail - platform-admin gate", () => {
  it("blocks a signed-in NON-admin before any email is sent (Finding - previously missing entirely)", async () => {
    const { client } = makeSupabase("employee@acme-civils.co.za", {
      is_platform_admin: { data: false, error: null },
    });
    supabaseState.current = client;

    const { sendTestNotificationEmail } = await import("./actions");
    const url = await expectRedirect(
      sendTestNotificationEmail(formDataWith({ template_key: "welcome_user" })),
    );

    expect(url).toContain("/admin/notifications");
    expect(url).toContain("error=");
    expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
  });

  it("still lets a real platform admin send a test email", async () => {
    const { client } = makeSupabase("sarel@tenderready.app", {
      is_platform_admin: { data: true, error: null },
    });
    supabaseState.current = client;

    const { sendTestNotificationEmail } = await import("./actions");
    const url = await expectRedirect(
      sendTestNotificationEmail(formDataWith({ template_key: "welcome_user" })),
    );

    expect(url).toContain("sent=");
    expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1);
  });
});
