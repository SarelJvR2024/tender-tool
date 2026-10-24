import { describe, expect, it } from "vitest";
import {
  firstTenderCandidates,
  vaultDocsOnFile,
  vaultKickstartCandidates,
  VAULT_KICKSTART_MIN_DAYS_SINCE_SIGNUP,
  FIRST_TENDER_MIN_DAYS_SINCE_SIGNUP,
  type FirstTenderCompanyRow,
  type VaultKickstartCompanyRow,
} from "./onboardingNudges";

const NOW = new Date("2026-10-24T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe("vaultDocsOnFile", () => {
  it("counts only the 7 real vault document columns", () => {
    expect(vaultDocsOnFile({ sars_tcs_pin_document_path: "x", cidb_document_path: "y", legal_name: "not a vault doc" })).toBe(2);
    expect(vaultDocsOnFile({})).toBe(0);
  });
});

describe("vaultKickstartCandidates", () => {
  const base: VaultKickstartCompanyRow = { id: "c1", legal_name: "Klipcorp", created_at: daysAgo(10), sars_tcs_pin_document_path: null };

  it("fires for a company past the signup grace period with fewer than 2 vault docs", () => {
    const out = vaultKickstartCandidates([base], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].vaultDocsOnFile).toBe(0);
  });

  it("never nudges a vault already at the 2-document threshold (brief's own suppression rule)", () => {
    const ready = { ...base, sars_tcs_pin_document_path: "a", cidb_document_path: "b" };
    expect(vaultKickstartCandidates([ready], NOW)).toEqual([]);
  });

  it("does not fire before the signup grace period has passed", () => {
    const fresh = { ...base, created_at: daysAgo(VAULT_KICKSTART_MIN_DAYS_SINCE_SIGNUP - 1) };
    expect(vaultKickstartCandidates([fresh], NOW)).toEqual([]);
  });

  it("fires exactly at the grace-period boundary", () => {
    const atBoundary = { ...base, created_at: daysAgo(VAULT_KICKSTART_MIN_DAYS_SINCE_SIGNUP) };
    expect(vaultKickstartCandidates([atBoundary], NOW)).toHaveLength(1);
  });
});

describe("firstTenderCandidates", () => {
  const company: FirstTenderCompanyRow = { id: "c1", legal_name: "Klipcorp", created_at: daysAgo(10) };

  it("fires for a company past the grace period with zero pipeline tenders", () => {
    expect(firstTenderCandidates([company], new Set(), NOW)).toEqual([company]);
  });

  it("never nudges a company that already has a pipeline (brief's own suppression rule)", () => {
    expect(firstTenderCandidates([company], new Set(["c1"]), NOW)).toEqual([]);
  });

  it("does not fire before the signup grace period has passed", () => {
    const fresh = { ...company, created_at: daysAgo(FIRST_TENDER_MIN_DAYS_SINCE_SIGNUP - 1) };
    expect(firstTenderCandidates([fresh], new Set(), NOW)).toEqual([]);
  });
});
