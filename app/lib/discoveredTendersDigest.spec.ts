import { describe, expect, it } from "vitest";
import { discoveredTenderIdempotencyKey, toDiscoveredTenderCard, type DiscoveredOpportunityRow } from "./discoveredTendersDigest";

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

describe("discoveredTenderIdempotencyKey", () => {
  it("is stable and keyed only on the opportunity id", () => {
    expect(discoveredTenderIdempotencyKey("opp-1")).toBe("discovered-tender-opp-1");
    expect(discoveredTenderIdempotencyKey("opp-1")).toBe(discoveredTenderIdempotencyKey("opp-1"));
  });

  it("differs for a different opportunity id", () => {
    expect(discoveredTenderIdempotencyKey("opp-1")).not.toBe(discoveredTenderIdempotencyKey("opp-2"));
  });
});
