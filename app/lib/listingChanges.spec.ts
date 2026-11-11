import { describe, expect, it } from "vitest";
import { listingSourceLabels, sourceLabel } from "./listingChanges";

// Finding 418, QA pass 2026-11-11: app/app/discovery/page.tsx renders a chip
// for every source.source / listing_sources[].source a discovered_opportunity
// row carries, via sourceLabel()/listingSourceLabels() reading this file's own
// SOURCE_LABELS map. engine/discovery/gov_sources.py keeps its OWN, separate,
// hand-kept copy of this exact same source-code -> human-label mapping
// (SOURCE_LABELS, read directly: 13 entries, including every one of
// gov_sources.ALL_SOURCES's 11 real discovery sources) - the identical
// "two hand-kept lists have to stay in sync and didn't" shape already found
// and fixed three times in this codebase for pipeline_stage lists, now found
// a fourth time for this list. This file's own copy had only 6 real source
// codes (etenders_portal/etenders_ocds/sanral/eskom_bulletin/
// transnet_etenders/capetown_procurement) plus "manual" - missing
// sars_procurement, cidb_tenders, dbsa_procurement, vaal_central_water,
// lephalale and kouga: 6 of gov_sources.ALL_SOURCES's own 11 real,
// production-scheduled discovery sources (confirmed live/scheduled elsewhere
// in this codebase's own QA history - e.g. Findings 264/333's own write-ups).
// A discovered_opportunity sourced from any of those 6 fell through
// sourceLabel()'s own `?? source.replace(/_/g, " ")` fallback and showed an
// unformatted, lowercase, underscore-stripped raw source code as its chip
// (e.g. "sars procurement" instead of a real human label) on the one screen
// every user sees every discovered tender on - app/app/discovery/page.tsx.

describe("sourceLabel - Finding 418: every one of gov_sources.ALL_SOURCES's 11 real sources must resolve to a real label, not its raw source code", () => {
  it("resolves every ALL_SOURCES code to a label that is NOT the raw, underscore-stripped fallback", () => {
    // engine/discovery/gov_sources.py: ALL_SOURCES = ("etenders_portal", "sanral",
    // "eskom_bulletin", "transnet_etenders", "capetown_procurement",
    // "sars_procurement", "cidb_tenders", "dbsa_procurement",
    // "vaal_central_water", "lephalale", "kouga") - read directly from the file.
    const ALL_SOURCES = [
      "etenders_portal", "sanral", "eskom_bulletin", "transnet_etenders", "capetown_procurement",
      "sars_procurement", "cidb_tenders", "dbsa_procurement", "vaal_central_water", "lephalale", "kouga",
    ];
    for (const code of ALL_SOURCES) {
      const label = sourceLabel(code);
      expect(label, `source "${code}" fell through to the raw-code fallback`).not.toBe(code.replace(/_/g, " "));
    }
  });

  it("gives kouga/lephalale/vaal_central_water/sars_procurement/cidb_tenders/dbsa_procurement real, specific labels", () => {
    expect(sourceLabel("kouga")).toMatch(/kouga/i);
    expect(sourceLabel("lephalale")).toMatch(/lephalale/i);
    expect(sourceLabel("vaal_central_water")).toMatch(/vaal central water/i);
    expect(sourceLabel("sars_procurement")).toMatch(/sars/i);
    expect(sourceLabel("cidb_tenders")).toMatch(/cidb/i);
    expect(sourceLabel("dbsa_procurement")).toMatch(/dbsa/i);
  });
});

describe("listingSourceLabels - the real call site's own shape (app/app/discovery/page.tsx)", () => {
  it("a lephalale-only opportunity's chip is a real label, not 'lephalale'", () => {
    expect(listingSourceLabels(null, "lephalale")).toEqual([sourceLabel("lephalale")]);
    expect(listingSourceLabels(null, "lephalale")[0]).not.toBe("lephalale");
  });

  it("a kouga + etenders_portal merged row shows both as real labels, portal first", () => {
    const labels = listingSourceLabels(
      [{ source: "kouga" }, { source: "etenders_portal" }],
      "etenders_portal",
    );
    expect(labels).toEqual(["eTenders portal", sourceLabel("kouga")]);
    expect(labels).not.toContain("kouga");
  });
});
