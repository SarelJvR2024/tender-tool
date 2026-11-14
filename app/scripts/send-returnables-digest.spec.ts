// Finding 451 (standing solution-architect review, 2026-11-12): without
// filterCancelledTenders(), a candidate for a tender the buyer has already
// cancelled outright - tender_watched_documents.kind === "cancellation" -
// would still reach returnablesMissingMandatoryItems()/the real email send
// and fire a "you're missing a mandatory returnable" nudge for a bid that
// was never going to be submitted. Same shape, same fix, as Finding 449's
// own filterCancelledTenders() in send-deadline-reminders.ts - reusing
// tendersWithCancellationNotice() (lib/deadlineReminders.ts) unchanged.
import { describe, expect, it, vi } from "vitest";
import { filterCancelledTenders } from "./send-returnables-digest.ts";
import { POSTGREST_PAGE_SIZE } from "../lib/supabasePaging.ts";
import type { ReturnablesWindowCandidate } from "../lib/returnablesDigestCandidates.ts";

function candidate(overrides: Partial<ReturnablesWindowCandidate> = {}): ReturnablesWindowCandidate {
  return {
    tender: {
      id: "tender-1",
      contract_no: "N.007-030-2026/1F",
      description: "Upgrade of road",
      title: null,
      closing_date: "2026-11-17T11:00:00+02:00",
      family: null,
      document_requirements: null,
      tender_packs: [],
    },
    companyId: "company-1",
    businessDaysLeft: 4,
    ...overrides,
  };
}

// Thenable, chainable .from() builder - same technique
// send-deadline-reminders.spec.ts's own filterCancelledTenders tests use, so
// .range()-paging is actually exercised rather than hidden by an
// over-generous mock.
function makeBuilder(data: unknown, error: unknown = null) {
  const capped = Array.isArray(data) ? data.slice(0, POSTGREST_PAGE_SIZE) : data;
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    range: (from: number, to: number) => Promise.resolve({ data: Array.isArray(data) ? data.slice(from, to + 1) : data, error }),
    then: (resolve: (v: { data: unknown; error: unknown }) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: capped, error }).then(resolve, reject),
  };
  return builder;
}

function mockSupabase(docRows: unknown, error: unknown = null) {
  const from = vi.fn(() => makeBuilder(docRows, error));
  return { from } as unknown as { from: typeof from };
}

describe("filterCancelledTenders (send-returnables-digest)", () => {
  it("returns every candidate unchanged when the secondary query finds no cancellation at all", async () => {
    const supabase = mockSupabase([]);
    const candidates = [candidate(), candidate({ tender: { ...candidate().tender, id: "tender-2" } })];

    const result = await filterCancelledTenders(supabase as never, candidates);

    expect(result).toEqual(candidates);
  });

  it("drops every candidate whose tender has a cancellation-kind watched document", async () => {
    const supabase = mockSupabase([{ tender_id: "tender-1", kind: "cancellation" }]);

    const result = await filterCancelledTenders(supabase as never, [candidate()]);

    expect(result).toEqual([]);
  });

  it("keeps a still-live tender's own candidate while dropping a cancelled sibling tender's", async () => {
    const supabase = mockSupabase([{ tender_id: "tender-1", kind: "cancellation" }]);
    const liveCandidate = candidate({ tender: { ...candidate().tender, id: "tender-2" }, companyId: "company-2" });

    const result = await filterCancelledTenders(supabase as never, [candidate(), liveCandidate]);

    expect(result).toEqual([liveCandidate]);
  });

  it("fails open - keeps every candidate unfiltered - when the secondary query errors", async () => {
    const supabase = mockSupabase(null, { message: "connection reset" });

    const result = await filterCancelledTenders(supabase as never, [candidate()]);

    expect(result).toEqual([candidate()]);
  });

  it("returns an empty array unchanged without querying anything (zero candidates)", async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as { from: typeof from };

    const result = await filterCancelledTenders(supabase as never, []);

    expect(result).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("only queries tender_watched_documents for the distinct tender ids actually in play", async () => {
    const from = vi.fn(() => makeBuilder([]));
    const supabase = { from } as unknown as { from: typeof from };
    const candidates = [candidate(), candidate({ companyId: "company-2" })]; // same tender, 2 companies

    await filterCancelledTenders(supabase as never, candidates);

    expect(from).toHaveBeenCalledWith("tender_watched_documents");
  });
});
