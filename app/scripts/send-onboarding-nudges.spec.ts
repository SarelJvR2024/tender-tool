// Regression test for a real bug found 2026-11-07 (standing solution-
// architect review): lifecycleRecipients() and unsubscribeUrlFor() both
// discarded a real company_notification_recipients()/
// lifecycle_unsubscribe_token_for() RPC error with no console.error at all -
// unlike every sibling recipient resolver (operationalRecipients()/
// criticalBidRecipients(), lib/notificationRecipients.ts), which both log
// this exact RPC's own error. A transient read failure for one company was
// silently indistinguishable from "every member genuinely opted out" (or
// "this user genuinely has no unsubscribe token"), with nothing in the logs
// to tell the two apart. Worst case: trialDay7Candidates() (lib/
// trialLifecycle.ts) is an exact-day match (daysUntil(trial_ends_at) === 7),
// not a retried window - a company that hits this failure on its one
// qualifying day never gets the trial_day_7_milestone nudge at all, since
// the very next day's run no longer matches, and nothing in the logs would
// ever show why.
import { describe, expect, it, vi } from "vitest";
import { lifecycleRecipients, unsubscribeUrlFor } from "./send-onboarding-nudges.ts";

function mockSupabase(rpcResponses: Record<string, { data: unknown; error: unknown }>) {
  const rpc = vi.fn(async (name: string) => rpcResponses[name] ?? { data: null, error: null });
  return { rpc } as unknown as Parameters<typeof lifecycleRecipients>[0];
}

describe("lifecycleRecipients", () => {
  it("logs the real RPC error instead of discarding it silently", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = mockSupabase({
      company_notification_recipients: { data: null, error: { message: "connection reset" } },
    });
    const result = await lifecycleRecipients(supabase, "company-1");
    expect(result).toEqual([]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("company-1"), { message: "connection reset" });
    spy.mockRestore();
  });

  it("does not log anything when the RPC genuinely returns zero/opted-out rows", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = mockSupabase({
      company_notification_recipients: { data: [{ user_id: "u1", email: "a@x.com", lifecycle_email_opt_out: true }], error: null },
    });
    const result = await lifecycleRecipients(supabase, "company-1");
    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns every non-opted-out member with a real email on success", async () => {
    const supabase = mockSupabase({
      company_notification_recipients: {
        data: [
          { user_id: "u1", email: "a@x.com", lifecycle_email_opt_out: false },
          { user_id: "u2", email: "b@x.com", lifecycle_email_opt_out: true },
          { user_id: "u3", email: null, lifecycle_email_opt_out: false },
        ],
        error: null,
      },
    });
    const result = await lifecycleRecipients(supabase, "company-1");
    expect(result).toEqual([{ userId: "u1", email: "a@x.com" }]);
  });
});

describe("unsubscribeUrlFor", () => {
  it("logs the real RPC error instead of discarding it silently", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = mockSupabase({
      lifecycle_unsubscribe_token_for: { data: null, error: { message: "timeout" } },
    });
    const result = await unsubscribeUrlFor(supabase, "user-1", "https://tender-ready.vercel.app");
    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("user-1"), { message: "timeout" });
    spy.mockRestore();
  });

  it("returns the real unsubscribe URL on success, with no log noise", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = mockSupabase({
      lifecycle_unsubscribe_token_for: { data: "tok-123", error: null },
    });
    const result = await unsubscribeUrlFor(supabase, "user-1", "https://tender-ready.vercel.app");
    expect(result).toBe("https://tender-ready.vercel.app/api/unsubscribe?token=tok-123");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
