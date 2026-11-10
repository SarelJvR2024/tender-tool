import { afterEach, describe, expect, it, vi } from "vitest";

// Finding 344 (standing solution-architect review, 2026-11-10): the same
// naive-UTC-slice-of-a-timestamptz bug Findings 289-292 already fixed
// repeatedly in engine/ (Python) existed, unfixed and unchecked, on the
// TypeScript side too. loadTenderCompliance() (this file) computed
// findMatchingExperience()'s own `asOf` parameter as
// `closingDate.slice(0, 10)` - a raw string slice of tenders.closing_date,
// which PostgREST always returns in UTC - instead of lib/dates.ts's own
// closingDayOf(), the already-tested helper that exists specifically to
// convert a timestamptz into its real South African (SAST, UTC+2) calendar
// day. For a closing time whose UTC time-of-day falls in 22:00-23:59 (SAST
// 00:00-01:59 the next day - the exact window Findings 289-292 each confirm
// is the real-world trigger, e.g. a SANRAL default-midnight closing time),
// the naive slice reads one calendar day EARLIER than the tender's real
// SAST closing day. Passed straight into experience_matches() (migration
// 0012) as p_as_of, this both (a) excludes a company's own qualifying
// Experience Library evidence completed on the real closing day itself
// (the upper bound `completion_date <= p_as_of` becomes one day too
// strict), and (b) lets a genuinely stale item one day outside the
// `window_years` cutoff through as "recent enough" (the lower bound
// `p_as_of - make_interval(years => ...)` moves a day earlier too) -
// exactly Finding 291's own "lets a stale row through" mechanism, just in
// the TypeScript mirror Finding 292's own engine/-only sweep never reached.
//
// This call site feeds the SANRAL compliance report's "Company experience
// evidence" item (sanralConventionalDocumentChecks()) and the functionality
// score estimate (estimateSanralConventional() via pastPerformanceFromExperience()),
// both read by submission-pack.tsx (imports loadTenderCompliance from this
// file directly) and compliance-report.tsx.
//
// Mocking technique copied from the established convention
// (app/app/tenders/[id]/general-actions.spec.ts and its own precedents): a
// minimal chainable/thenable Supabase stub, keyed by table name (not call
// order - this function's own Promise.all branches are too numerous and
// conditionally-shaped to track a single shared call index safely), plus a
// mocked @/lib/supabase/server and a spied @/lib/experience so the exact
// `asOf` argument passed to the real findMatchingExperience() call can be
// asserted on directly. Calls the real, unmodified loadTenderCompliance(),
// never a reimplementation of its logic.

import { SANRAL_CONVENTIONAL_FAMILY } from "@/lib/tenderCompliance";

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(resp: Resp) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order"]) chain[m] = () => chain;
  chain.maybeSingle = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => resolve(resp);
  return chain;
}

function makeSupabase(responses: Record<string, Resp>) {
  const fallback: Resp = { data: null, error: null };
  const fromCalls: string[] = [];
  return {
    client: {
      from: (table: string) => {
        fromCalls.push(table);
        return makeChain(responses[table] ?? fallback);
      },
    },
    fromCalls,
  };
}

const supabaseState: { current: ReturnType<typeof makeSupabase>["client"] | null } = { current: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseState.current,
}));

const findMatchingExperienceMock = vi.fn(async () => ({ items: [], error: null as string | null }));

vi.mock("@/lib/experience", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/experience")>();
  return { ...actual, findMatchingExperience: findMatchingExperienceMock };
});

vi.mock("@/lib/disciplineTaxonomy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/disciplineTaxonomy")>();
  return { ...actual, loadDisciplineTaxonomy: async () => ({ categories: [], source: "fallback" as const, error: null }) };
});

afterEach(() => {
  vi.clearAllMocks();
  supabaseState.current = null;
});

// 00:30 SAST on 2026-10-21, stored (as PostgREST always does for a
// timestamptz) as its UTC equivalent - the exact representative shape
// Findings 289-292 each used.
const TRICKY_CLOSING_DATE = "2026-10-20T22:30:00+00:00";
const REAL_SAST_CLOSING_DAY = "2026-10-21";

describe("loadTenderCompliance: findMatchingExperience's asOf is the tender's own SAST closing day", () => {
  it("passes the real SAST calendar day, not a naive UTC slice one day early", async () => {
    const { client } = makeSupabase({
      tenders: { data: { id: "tender-1", closing_date: TRICKY_CLOSING_DATE, family: SANRAL_CONVENTIONAL_FAMILY, evaluation_rules: null }, error: null },
      companies: { data: { id: "company-1", legal_name: "Test Co" }, error: null },
    });
    supabaseState.current = client;

    const { loadTenderCompliance } = await import("./compliance-data");
    const data = await loadTenderCompliance("tender-1");

    expect(data?.mapped).toBe(true);
    expect(findMatchingExperienceMock).toHaveBeenCalledTimes(1);
    const [, , opts] = findMatchingExperienceMock.mock.calls[0] as unknown as [unknown, unknown, { asOf?: string }];
    expect(opts.asOf).toBe(REAL_SAST_CLOSING_DAY);
    // The exact wrong value the pre-fix `closingDate.slice(0, 10)` produced
    // for this same real timestamp - confirming this is a genuine
    // divergence, not merely a different-but-still-valid representation.
    expect(opts.asOf).not.toBe(TRICKY_CLOSING_DATE.slice(0, 10));
  });
});
