import { describe, expect, it } from "vitest";
import { registrationsAskedFor } from "./personCredentials.ts";

// registrationsAskedFor() had zero test coverage before this pass (confirmed
// by grep). Finding 300 (2026-11-09, standing review): this function used to
// filter both its reads on `tenders.status = 'open'` - a column that is set
// ONCE, at insert time, and never revisited (see personCredentials.ts's own
// header comment on the function, and docs/specs/QA-Edge-Case-Findings.md
// for the live scratch-database repro). Fixed to filter on `closing_date`
// (the live signal) instead, the same convention `.or("closing_date.is.null,
// closing_date.gte.now")` uses Postgres's own special 'now' timestamptz
// literal so no client-side Date.now() is needed before this file's own
// request-time reads (its "'now' only after..." Cache Components rule).
//
// Follows lib/marketPricing.spec.ts's own makeSelectChain/makeOutcomesSupabase
// convention for a minimal chainable Supabase mock, extended to also record
// every .or()/.eq() call so a regression (reintroducing the stale
// tenders.status filter) fails loudly, not just silently under-fetches.

type Resp = { data: unknown; error: null };

function makeChain(resp: Resp, calls: { method: string; args: unknown[] }[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "not"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    };
  }
  // .range() is fetchAllRows()'s own terminal call - resolve here, same
  // shape as marketPricing.spec.ts's makeSelectChain (a thenable, not a
  // real Promise, matching how supabase-js's own query builder works).
  chain.range = (...args: unknown[]) => {
    calls.push({ method: "range", args });
    return { then: (resolve: (r: Resp) => void) => resolve(resp) };
  };
  return chain;
}

function makeSupabase(reqRowsResp: Resp, tendersResp: Resp) {
  const reqCalls: { method: string; args: unknown[] }[] = [];
  const tendersCalls: { method: string; args: unknown[] }[] = [];
  const supabase = {
    from: (table: string) => {
      if (table === "tender_requirements") return makeChain(reqRowsResp, reqCalls);
      if (table === "tenders") return makeChain(tendersResp, tendersCalls);
      throw new Error(`unexpected table in test: ${table}`);
    },
  } as unknown as Parameters<typeof registrationsAskedFor>[0];
  return { supabase, reqCalls, tendersCalls };
}

describe("registrationsAskedFor", () => {
  it("filters both reads on closing_date, never on the write-once tenders.status column (Finding 300 regression guard)", async () => {
    const { supabase, reqCalls, tendersCalls } = makeSupabase({ data: [], error: null }, { data: [], error: null });
    await registrationsAskedFor(supabase);

    const reqOr = reqCalls.find((c) => c.method === "or");
    expect(reqOr?.args).toEqual(["closing_date.is.null,closing_date.gte.now", { referencedTable: "tenders" }]);
    expect(reqCalls.some((c) => c.method === "eq")).toBe(false);

    const tendersOr = tendersCalls.find((c) => c.method === "or");
    expect(tendersOr?.args).toEqual(["closing_date.is.null,closing_date.gte.now"]);
    expect(tendersCalls.some((c) => c.method === "eq")).toBe(false);
  });

  it("includes a general-family tender whose closing_date is in the future and excludes one in the past - the exact two cases the old status='open' filter got backwards (a status='closed' row that was later reopened by an accepted corrigendum, and a status='open' row that has since quietly closed)", async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const { supabase } = makeSupabase(
      { data: [], error: null },
      {
        data: [
          { id: "t-open", contract_no: "OPEN-1", title: "Still open", closing_date: future, document_requirements: { person_registrations: [{ body: "SACAP" }] } },
          { id: "t-closed", contract_no: "CLOSED-1", title: "Already closed", closing_date: past, document_requirements: { person_registrations: [{ body: "SACAP" }] } },
        ],
        error: null,
      },
    );
    const askedFor = await registrationsAskedFor(supabase);
    expect(askedFor.SACAP).toEqual(["OPEN-1"]);
  });

  it("includes a SANRAL tender (via tender_requirements.position_description) only while its own closing_date hasn't passed", async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const { supabase } = makeSupabase(
      {
        data: [
          {
            position_code: "GEO01",
            position_description: "Senior Engineering Geologist",
            tenders: { id: "t-sanral", contract_no: "SANRAL-1", title: null, status: "open", closing_date: future },
          },
        ],
        error: null,
      },
      { data: [], error: null },
    );
    const askedFor = await registrationsAskedFor(supabase);
    expect(askedFor.SACNASP).toEqual(["SANRAL-1 (GEO01)"]);
  });

  it("a tender with no closing_date on file still counts as open (null, not excluded)", async () => {
    const { supabase } = makeSupabase(
      { data: [], error: null },
      {
        data: [{ id: "t-no-date", contract_no: "NODATE-1", title: null, closing_date: null, document_requirements: { person_registrations: [{ body: "PSIRA" }] } }],
        error: null,
      },
    );
    const askedFor = await registrationsAskedFor(supabase);
    expect(askedFor.PSIRA).toEqual(["NODATE-1"]);
  });
});
