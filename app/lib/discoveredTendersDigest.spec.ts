import { describe, expect, it } from "vitest";
import {
  DISCOVERED_TENDER_VERDICTS,
  discoveredTenderIdempotencyKey,
  openDiscoveredOpportunityWindow,
  toDiscoveredTenderCard,
  type DiscoveredOpportunityRow,
} from "./discoveredTendersDigest";

const BASE: DiscoveredOpportunityRow = {
  id: "opp-1",
  company_id: "co-1",
  contract_number: "N.007-030-2026/1F",
  buyer: "SANRAL",
  title: "Rehabilitation of N2 Section 7",
  description: null,
  etenders_category: "Construction",
  categories: ["road_construction_upgrade"],
  closing_date: "2026-12-01T10:00:00+02:00",
  verdict: "strong_fit",
};

describe("toDiscoveredTenderCard", () => {
  it("maps every field directly when present", () => {
    expect(toDiscoveredTenderCard(BASE)).toEqual({
      id: "opp-1",
      contractNumber: "N.007-030-2026/1F",
      buyer: "SANRAL",
      title: "Rehabilitation of N2 Section 7",
      category: "Construction",
      cidbGrading: null,
      closingDate: "2026-12-01T10:00:00+02:00",
      verdict: "strong_fit",
    });
  });

  it("falls back to description when title is null", () => {
    const row = { ...BASE, title: null, description: "Fallback description" };
    expect(toDiscoveredTenderCard(row).title).toBe("Fallback description");
  });

  it("falls back to the first category when etenders_category is null", () => {
    const row = { ...BASE, etenders_category: null };
    expect(toDiscoveredTenderCard(row).category).toBe("road_construction_upgrade");
  });

  it("is null for category when neither etenders_category nor categories exist", () => {
    const row = { ...BASE, etenders_category: null, categories: null };
    expect(toDiscoveredTenderCard(row).category).toBeNull();
  });

  it("always leaves cidbGrading null - no per-tender CIDB field exists in this schema", () => {
    expect(toDiscoveredTenderCard(BASE).cidbGrading).toBeNull();
  });

  it("defaults verdict to needs_review when null", () => {
    const row = { ...BASE, verdict: null };
    expect(toDiscoveredTenderCard(row).verdict).toBe("needs_review");
  });
});

describe("openDiscoveredOpportunityWindow", () => {
  // Standing review, 2026-11-07: replaces the old fixed 2-day created_at
  // lookback (which permanently and silently dropped a zero-recipient
  // company's older-than-2-days opportunities) with a closing_date bound -
  // these tests pin the exact filter shape main() builds from this.
  it("keeps the same 3 fit verdicts the digest has always used", () => {
    expect(openDiscoveredOpportunityWindow(new Date("2026-11-07T06:00:00Z")).verdicts).toEqual(DISCOVERED_TENDER_VERDICTS);
    expect(DISCOVERED_TENDER_VERDICTS).toEqual(["strong_fit", "possible", "needs_review"]);
  });

  it("builds a closing_date-is-null-or-not-yet-closed PostgREST .or() filter keyed on the given clock", () => {
    const { closingDateOrFilter } = openDiscoveredOpportunityWindow(new Date("2026-11-07T06:00:00.000Z"));
    expect(closingDateOrFilter).toBe("closing_date.is.null,closing_date.gte.2026-11-07T06:00:00.000Z");
  });

  it("moves forward with the clock - an opportunity closing yesterday relative to 'now' is excluded, one closing tomorrow is kept", () => {
    const now = new Date("2026-11-07T06:00:00.000Z");
    const { closingDateOrFilter } = openDiscoveredOpportunityWindow(now);
    // Not a real Postgres eval (no DB here) - but the filter's own cutoff
    // must be exactly `now`'s ISO string, so a row closing a second before
    // it fails `.gte` and a row closing a second after it passes.
    const cutoff = closingDateOrFilter.split("closing_date.gte.")[1];
    expect(new Date(cutoff).getTime()).toBe(now.getTime());
  });

  it("defaults to the real current time when called with no argument", () => {
    const before = Date.now();
    const { closingDateOrFilter } = openDiscoveredOpportunityWindow();
    const after = Date.now();
    const cutoff = new Date(closingDateOrFilter.split("closing_date.gte.")[1]).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before);
    expect(cutoff).toBeLessThanOrEqual(after);
  });
});

describe("discoveredTenderIdempotencyKey", () => {
  it("is stable and keyed only on the opportunity id", () => {
    expect(discoveredTenderIdempotencyKey("opp-1")).toBe("discovered-tender-opp-1");
    expect(discoveredTenderIdempotencyKey("opp-1")).toBe(discoveredTenderIdempotencyKey("opp-1"));
  });

  it("differs for a different opportunity id", () => {
    expect(discoveredTenderIdempotencyKey("opp-1")).not.toBe(discoveredTenderIdempotencyKey("opp-2"));
  });
});
