import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildCustomerRow, type CompanyOverviewRow } from "./customerRowData";
import type { CustomerMember } from "@/app/admin/customers/CustomerRow";

const COMPANY: CompanyOverviewRow = {
  id: "11111111-1111-1111-1111-111111111111",
  legal_name: "Acme Civils (Pty) Ltd",
  csd_trading_name: null,
  csd_supplier_number: "MAAA1234567",
  is_test_company: false,
  created_at: "2026-01-01T00:00:00Z",
  // Real, non-zero member count from the OTHER rpc (platform_admin_companies) -
  // deliberately non-zero in every test below so a bug that falls back to
  // "zero members" is distinguishable from the real count, not coincidentally
  // the same number.
  member_count: 3,
  people_count: 5,
  tenders_pursued_count: 2,
  active_tenders_count: 1,
  last_activity_at: null,
  plan_tier: "professional",
  subscription_status: "active",
  trial_ends_at: null,
};

const REAL_MEMBERS: CustomerMember[] = [
  { user_id: "u1", email: "owner@acme.co.za", role: "owner", joined_at: "2026-01-01T00:00:00Z" },
  { user_id: "u2", email: "admin@acme.co.za", role: "admin", joined_at: "2026-01-02T00:00:00Z" },
  { user_id: "u3", email: "member@acme.co.za", role: "member", joined_at: "2026-01-03T00:00:00Z" },
];

const NO_READINESS = { data: null, error: null };

describe("buildCustomerRow()", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("a real, successful members read is passed through untouched - the baseline, non-error path", () => {
    const row = buildCustomerRow(COMPANY, { data: REAL_MEMBERS, error: null }, NO_READINESS);
    expect(row.membersError).toBe(false);
    expect(row.members).toEqual(REAL_MEMBERS);
    expect(row.primaryContact).toBe("owner@acme.co.za");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("a genuinely empty members list (real zero) is NOT reported as an error", () => {
    const row = buildCustomerRow(COMPANY, { data: [], error: null }, NO_READINESS);
    expect(row.membersError).toBe(false);
    expect(row.members).toEqual([]);
    expect(row.primaryContact).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // The regression this test guards: before this fix, `platform_admin_company_members`'s
  // own error was discarded entirely - a failed read fell through the same
  // `data ?? []` fallback as a real zero-member company, so a platform admin
  // saw "3 members" in the row header (from the separate, successful
  // `platform_admin_companies` read) directly above a contradicting
  // "No members." in the very same row's expanded detail, with no
  // explanatory comment anywhere and the console never once mentioning the
  // RPC failure that caused it.
  it("a failed members RPC is reported as membersError, not a false real-zero, and is logged", () => {
    const row = buildCustomerRow(COMPANY, { data: null, error: { message: "rpc timeout" } }, NO_READINESS);
    expect(row.membersError).toBe(true);
    expect(row.members).toEqual([]);
    // Never claim a primary contact scraped from a members list we know failed to load.
    expect(row.primaryContact).toBeNull();
    // The real, non-zero member_count from the sibling rpc is untouched -
    // this is exactly the field whose header value would contradict the
    // row's own "No members." detail if membersError were not distinguished.
    expect(row.member_count).toBe(3);
    expect(errorSpy).toHaveBeenCalledWith("platform_admin_company_members rpc failed", { message: "rpc timeout" }, COMPANY.id);
  });

  it("a failed readiness RPC is logged but does not throw, and renders as the pre-existing 'couldn't be computed' null", () => {
    const row = buildCustomerRow(COMPANY, { data: REAL_MEMBERS, error: null }, { data: null, error: { message: "rpc timeout" } });
    expect(row.readinessPercent).toBeNull();
    expect(row.readinessCriteria).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith("platform_admin_company_readiness_data rpc failed", { message: "rpc timeout" }, COMPANY.id);
    // Members are unaffected by the readiness RPC's own failure.
    expect(row.membersError).toBe(false);
  });

  it("falls back to the first member when no member has the owner role", () => {
    const nonOwnerMembers: CustomerMember[] = [
      { user_id: "u2", email: "admin@acme.co.za", role: "admin", joined_at: "2026-01-02T00:00:00Z" },
    ];
    const row = buildCustomerRow(COMPANY, { data: nonOwnerMembers, error: null }, NO_READINESS);
    expect(row.primaryContact).toBe("admin@acme.co.za");
  });

  it("trialDaysRemaining is only computed for a trialing subscription", () => {
    const trialing = buildCustomerRow(
      { ...COMPANY, subscription_status: "trialing", trial_ends_at: new Date(Date.now() + 5 * 86400000).toISOString() },
      { data: REAL_MEMBERS, error: null },
      NO_READINESS,
    );
    expect(trialing.trialDaysRemaining).not.toBeNull();

    const active = buildCustomerRow(COMPANY, { data: REAL_MEMBERS, error: null }, NO_READINESS);
    expect(active.trialDaysRemaining).toBeNull();
  });

  // Finding 317's own regression guard. `subscription_status` is the raw
  // `company_subscriptions.status` column, which stays "trialing" forever
  // for a trial that lapsed with no payment on file (nothing rewrites it -
  // lib/billing.ts's own header comment). Before this fix, CustomerRow.tsx's
  // status chip coloured itself straight off that raw value, so this exact
  // row - already shown as "trial expired" by its own trialDaysRemaining -
  // still got the ordinary in-progress "trialing" (warning/yellow) tone
  // instead of "past_due" (destructive/red).
  it("effectiveSubscriptionStatus flips to past_due for a lapsed trial, even though the raw subscription_status still reads 'trialing'", () => {
    const lapsedTrial = buildCustomerRow(
      { ...COMPANY, subscription_status: "trialing", trial_ends_at: new Date(Date.now() - 3 * 86400000).toISOString() },
      { data: REAL_MEMBERS, error: null },
      NO_READINESS,
    );
    expect(lapsedTrial.subscription_status).toBe("trialing");
    expect(lapsedTrial.trialDaysRemaining).toBeLessThan(0);
    expect(lapsedTrial.effectiveSubscriptionStatus).toBe("past_due");
  });

  it("effectiveSubscriptionStatus matches the raw status for a trial still running, a paying active company, and a real past_due/cancelled row", () => {
    const stillTrialing = buildCustomerRow(
      { ...COMPANY, subscription_status: "trialing", trial_ends_at: new Date(Date.now() + 5 * 86400000).toISOString() },
      { data: REAL_MEMBERS, error: null },
      NO_READINESS,
    );
    expect(stillTrialing.effectiveSubscriptionStatus).toBe("trialing");

    const active = buildCustomerRow(COMPANY, { data: REAL_MEMBERS, error: null }, NO_READINESS);
    expect(active.effectiveSubscriptionStatus).toBe("active");

    const pastDue = buildCustomerRow({ ...COMPANY, subscription_status: "past_due" }, { data: REAL_MEMBERS, error: null }, NO_READINESS);
    expect(pastDue.effectiveSubscriptionStatus).toBe("past_due");

    const cancelled = buildCustomerRow({ ...COMPANY, subscription_status: "cancelled" }, { data: REAL_MEMBERS, error: null }, NO_READINESS);
    expect(cancelled.effectiveSubscriptionStatus).toBe("cancelled");
  });

  it("effectiveSubscriptionStatus is null when there is no subscription row at all", () => {
    const noSub = buildCustomerRow({ ...COMPANY, subscription_status: null }, { data: REAL_MEMBERS, error: null }, NO_READINESS);
    expect(noSub.effectiveSubscriptionStatus).toBeNull();
  });
});
