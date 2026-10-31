import { describe, expect, it } from "vitest";
import { operationalRecipients, criticalBidRecipients } from "./notificationRecipients";

/** A minimal Supabase client stub exposing only the one RPC both functions call. */
function stubSupabase(rows: { email: string; daily_digest_opt_in: boolean }[], rpcError: unknown = null) {
  return {
    rpc: async () => (rpcError ? { data: null, error: rpcError } : { data: rows, error: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("operationalRecipients - the discovered-tenders digest's own gate", () => {
  it("keeps only opted-in members with a real email", async () => {
    const supabase = stubSupabase([
      { email: "owner@co.example", daily_digest_opt_in: true },
      { email: "estimator@co.example", daily_digest_opt_in: false },
      { email: "", daily_digest_opt_in: true },
    ]);
    expect(await operationalRecipients(supabase, "co-1")).toEqual(["owner@co.example"]);
  });

  it("no opted-in member at all -> empty, not a crash", async () => {
    const supabase = stubSupabase([{ email: "owner@co.example", daily_digest_opt_in: false }]);
    expect(await operationalRecipients(supabase, "co-1")).toEqual([]);
  });

  it("RPC failure -> empty, logged, not thrown", async () => {
    const supabase = stubSupabase([], { message: "boom" });
    expect(await operationalRecipients(supabase, "co-1")).toEqual([]);
  });
});

describe("criticalBidRecipients - corrigenda/returnables/deadline alerts' own gate", () => {
  it("returns EVERY registered member with a real email, regardless of daily_digest_opt_in", async () => {
    const supabase = stubSupabase([
      { email: "owner@co.example", daily_digest_opt_in: false },
      { email: "estimator@co.example", daily_digest_opt_in: false },
    ]);
    expect(await criticalBidRecipients(supabase, "co-1")).toEqual(["owner@co.example", "estimator@co.example"]);
  });

  it("still excludes a member with no real email on file", async () => {
    const supabase = stubSupabase([
      { email: "owner@co.example", daily_digest_opt_in: false },
      { email: "", daily_digest_opt_in: false },
    ]);
    expect(await criticalBidRecipients(supabase, "co-1")).toEqual(["owner@co.example"]);
  });

  it("no registered member at all -> empty, not a crash", async () => {
    const supabase = stubSupabase([]);
    expect(await criticalBidRecipients(supabase, "co-1")).toEqual([]);
  });

  it("RPC failure -> empty, logged, not thrown", async () => {
    const supabase = stubSupabase([], { message: "boom" });
    expect(await criticalBidRecipients(supabase, "co-1")).toEqual([]);
  });

  it("never reads from the people table - it's a different recipient source entirely (stub has no people-shaped data to leak)", async () => {
    // The stub above only ever exposes `rpc()` - if criticalBidRecipients()
    // tried to call supabase.from("people")... it would throw, since the
    // stub has no `.from()` at all. This test passing IS the proof.
    const supabase = stubSupabase([{ email: "owner@co.example", daily_digest_opt_in: false }]);
    await expect(criticalBidRecipients(supabase, "co-1")).resolves.toEqual(["owner@co.example"]);
  });
});
