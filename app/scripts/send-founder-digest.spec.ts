// Regression test for a real bug found 2026-11-07x (standing solution-
// architect review): all 4 of these count*() functions caught their own
// read error, logged it with console.error, and then returned a plain `0`
// anyway - so a transient Supabase/RPC failure rendered in the founder
// daily digest email as "0 new signups" / "0 active subscriptions" / "0
// tenders closing within 48h" / "0 flagged" - indistinguishable from a
// genuine zero. Fixed to return `null` on a real read failure, distinct
// from a correctly-derived zero; `founderDailyDigestEmail()`
// (lib/emailTemplatesTier3.ts) renders that `null` as its own "Couldn't
// load" value rather than "0".
import { describe, expect, it, vi } from "vitest";
import { countActiveSubscriptions, countClosingWithin48h, countNewSignups24h, countScoutBacklog } from "./send-founder-digest.ts";

/** Thenable, chainable query-builder stub good enough for every .from()
 * shape these 4 functions use (a head-count select, a direct awaited
 * chain, and a .range()-paginated chain). */
function makeBuilder(data: unknown, error: unknown, count: number | null = null) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    is: () => builder,
    in: () => builder,
    range: () => Promise.resolve({ data, error }),
    then: (resolve: (v: { data: unknown; error: unknown; count: unknown }) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error, count }).then(resolve, reject),
  };
  return builder;
}

function mockSupabase(fromResponses: Record<string, { data?: unknown; error?: unknown; count?: number | null }>) {
  const from = vi.fn((table: string) => {
    const r = fromResponses[table] ?? {};
    return makeBuilder(r.data ?? null, r.error ?? null, r.count ?? null);
  });
  return { from } as unknown as Parameters<typeof countNewSignups24h>[0];
}

describe("countNewSignups24h", () => {
  it("returns null, not 0, when the read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = mockSupabase({ companies: { error: { message: "connection reset" } } });
    const result = await countNewSignups24h(supabase, new Date());
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns the real count on success, including a genuine zero", async () => {
    const supabase = mockSupabase({ companies: { count: 0 } });
    expect(await countNewSignups24h(supabase, new Date())).toBe(0);
    const supabase2 = mockSupabase({ companies: { count: 4 } });
    expect(await countNewSignups24h(supabase2, new Date())).toBe(4);
  });
});

describe("countActiveSubscriptions", () => {
  it("returns null, not 0, when the read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = mockSupabase({ company_subscriptions: { error: { message: "timeout" } } });
    expect(await countActiveSubscriptions(supabase)).toBeNull();
    spy.mockRestore();
  });

  it("returns the real count on success, excluding test companies", async () => {
    const supabase = mockSupabase({
      company_subscriptions: {
        data: [
          { company_id: "a", status: "active", companies: { is_test_company: false } },
          { company_id: "b", status: "active", companies: { is_test_company: true } },
        ],
      },
    });
    expect(await countActiveSubscriptions(supabase)).toBe(1);
  });
});

describe("countClosingWithin48h", () => {
  it("returns null, not 0, when the paginated read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = mockSupabase({ tender_packs: { error: { message: "502" } } });
    expect(await countClosingWithin48h(supabase, new Date())).toBeNull();
    spy.mockRestore();
  });

  it("returns a genuine zero when nothing is closing soon", async () => {
    const supabase = mockSupabase({ tender_packs: { data: [] } });
    expect(await countClosingWithin48h(supabase, new Date())).toBe(0);
  });
});

describe("countScoutBacklog", () => {
  it("returns null, not 0, when the read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = mockSupabase({ system_alerts: { error: { message: "RLS denied" } } });
    expect(await countScoutBacklog(supabase)).toBeNull();
    spy.mockRestore();
  });

  it("returns the real count on success, including a genuine zero", async () => {
    const supabase = mockSupabase({ system_alerts: { count: 0 } });
    expect(await countScoutBacklog(supabase)).toBe(0);
  });
});
