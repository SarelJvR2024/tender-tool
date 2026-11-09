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
import { lifecycleRecipients, unsubscribeUrlFor, allCompanies } from "./send-onboarding-nudges.ts";
import { POSTGREST_PAGE_SIZE } from "../lib/supabasePaging.ts";

function mockSupabase(rpcResponses: Record<string, { data: unknown; error: unknown }>) {
  const rpc = vi.fn(async (name: string) => rpcResponses[name] ?? { data: null, error: null });
  return { rpc } as unknown as Parameters<typeof lifecycleRecipients>[0];
}

/** A `.from("companies").select(...).eq(...).range(from, to)` chain whose
 * terminal `.range()` call resolves with the page of `allRows` it asks for -
 * real pagination behaviour, not a single canned response, so a test using
 * this actually exercises whether a caller ranges through every page or
 * silently stops at the first one. */
function mockCompaniesTable(allRows: Record<string, unknown>[]) {
  const range = vi.fn(async (from: number, to: number) => ({ data: allRows.slice(from, to + 1), error: null }));
  const eq = vi.fn(() => ({ range }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as Parameters<typeof allCompanies>[0], range };
}

describe("allCompanies", () => {
  it("pages through .range() until every row is read, not just the first PostgREST page", async () => {
    // Real incident this guards against (Finding, intake rotation 2026-11-09):
    // runVaultKickstart()/runFirstTender() both used to read `companies` with
    // a plain, unranged `.select()` - past PostgREST's 1000-row cap
    // (lib/supabasePaging.ts), every company created after the 1000th
    // silently never appeared in either candidate list again, with no error
    // and no retry.
    const rows = Array.from({ length: POSTGREST_PAGE_SIZE + 5 }, (_, i) => ({ id: `c${i}` }));
    const { client, range } = mockCompaniesTable(rows);
    const { rows: result, error } = await allCompanies(client, "id");
    expect(error).toBeNull();
    expect(result).toHaveLength(POSTGREST_PAGE_SIZE + 5);
    expect(result[0]).toEqual({ id: "c0" });
    expect(result[POSTGREST_PAGE_SIZE + 4]).toEqual({ id: `c${POSTGREST_PAGE_SIZE + 4}` });
    expect(range).toHaveBeenCalledTimes(2); // one full 1000-row page, then the 5-row remainder
  });

  it("stops after a short page and never claims more rows than actually exist", async () => {
    const rows = [{ id: "c0" }, { id: "c1" }];
    const { client } = mockCompaniesTable(rows);
    const { rows: result, error } = await allCompanies(client, "id");
    expect(error).toBeNull();
    expect(result).toEqual(rows);
  });
});

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
