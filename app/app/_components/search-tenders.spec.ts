import { afterEach, describe, expect, it, vi } from "vitest";

// Standing solution-architect review, 2026-11-06 (from-scratch read of a
// representative file outside any grep pattern, per that pass's own
// directive to stop refining the TS-sweep's grep and just read files).
//
// searchTenders() used to return a bare `[]` on a failed `tenders` read,
// identical in shape to the genuine "no tender matches this query" result -
// CommandPalette.tsx's <CommandEmpty> showed "Nothing found." either way,
// implying the tender doesn't exist rather than that the search itself
// failed. Low severity (a command-palette convenience, not a compliance
// gate or hard stop), but the exact false-all-clear shape this sweep looks
// for. Fixed by returning `{ results, error }` instead of a bare array.
//
// Mocking convention copied from app/company/actions.spec.ts /
// app/company/registrations/actions.spec.ts (this repo's own established
// pattern for a "use server" file that calls createClient() internally) -
// calls the real, unmodified exported function, not a reimplementation.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(resp: Resp) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "or", "order", "limit"];
  for (const m of methods) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => resolve(resp);
  return chain;
}

const supabaseState: { current: unknown } = { current: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseState.current,
}));

afterEach(() => {
  vi.resetModules();
  supabaseState.current = null;
});

describe("searchTenders", () => {
  it("returns error: false and [] without even querying when the query is under 2 characters", async () => {
    const fromSpy = vi.fn();
    supabaseState.current = { from: fromSpy };
    const { searchTenders } = await import("./search-tenders");

    const { results, error } = await searchTenders("a");

    expect(results).toEqual([]);
    expect(error).toBe(false);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("returns error: false and [] on the genuine 'no tender matches' case", async () => {
    supabaseState.current = { from: () => makeChain({ data: [], error: null }) };
    const { searchTenders } = await import("./search-tenders");

    const { results, error } = await searchTenders("ZZZ-NOPE");

    expect(results).toEqual([]);
    expect(error).toBe(false);
  });

  it("returns error: true (not a bare empty array) on a failed read, so the caller can tell it apart from a genuine no-match", async () => {
    supabaseState.current = { from: () => makeChain({ data: null, error: { message: "boom" } }) };
    const { searchTenders } = await import("./search-tenders");

    const { results, error } = await searchTenders("SANRAL-001");

    expect(results).toEqual([]);
    expect(error).toBe(true);
  });

  it("returns the real rows and error: false on success", async () => {
    const rows = [{ id: "t1", contract_no: "SANRAL-001", description: "Road upgrade" }];
    supabaseState.current = { from: () => makeChain({ data: rows, error: null }) };
    const { searchTenders } = await import("./search-tenders");

    const { results, error } = await searchTenders("SANRAL");

    expect(results).toEqual(rows);
    expect(error).toBe(false);
  });
});
