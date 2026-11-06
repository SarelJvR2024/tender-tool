import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCompanySubscription } from "./companySubscription";

// Standing solution-architect review, 2026-11-06: fetchCompanySubscription()
// used to return a bare `CompanySubscriptionRow | null` - a failed Supabase
// read and the genuine "no company_subscriptions row yet" case both came
// back as plain `null`, indistinguishable from each other. Its own doc
// comment already notes a real `null` row should never happen for a real
// company (the companies_start_trial trigger creates one at company
// creation), so a `null` in practice is overwhelmingly a read failure, not
// a real state - yet `billing/page.tsx` rendered "No subscription found for
// your company yet." on that same bare `null`, and `AppShell.tsx` (mounted
// on every signed-in page) silently showed no trial/lapsed banner either
// way. These tests exercise the fix directly against the real, unmodified
// function, using the same sequential-response-queue mocking convention
// already established for `lib/savingsCounterData.spec.ts`.

type Resp = { data: unknown; error: { message: string } | null };

function makeSupabase(resp: Resp) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.maybeSingle = () => resp;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => resolve(resp);
  return { from: () => chain } as unknown as Parameters<typeof fetchCompanySubscription>[0];
}

const OK_ROW: Resp = {
  data: {
    plan_tier: "professional",
    billing_interval: "monthly",
    status: "active",
    trial_ends_at: null,
    max_users: 5,
    max_packs_per_month: 20,
  },
  error: null,
};

describe("fetchCompanySubscription", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns error: false and a real subscription on the ordinary success path", async () => {
    const supabase = makeSupabase(OK_ROW);
    const { subscription, error } = await fetchCompanySubscription(supabase);
    expect(error).toBe(false);
    expect(subscription).not.toBeNull();
    expect(subscription?.planTier).toBe("professional");
    expect(subscription?.maxUsers).toBe(5);
  });

  it("returns error: false and a null subscription on the genuine 'no row yet' case", async () => {
    const supabase = makeSupabase({ data: null, error: null });
    const { subscription, error } = await fetchCompanySubscription(supabase);
    expect(subscription).toBeNull();
    expect(error).toBe(false);
  });

  it("returns error: true (not a plain null) when the read fails", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = makeSupabase({ data: null, error: { message: "connection reset" } });
    const { subscription, error } = await fetchCompanySubscription(supabase);
    // Pre-fix this looked identical to the genuine "no row yet" case above -
    // the whole point of this test is that it no longer does.
    expect(subscription).toBeNull();
    expect(error).toBe(true);
    expect(logSpy).toHaveBeenCalledWith("company_subscriptions select failed", { message: "connection reset" });
  });
});
