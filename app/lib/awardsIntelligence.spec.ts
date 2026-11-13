import { describe, expect, it } from "vitest";
import {
  bidDontBidSignal,
  bucketBbbeeLevel,
  competitionStats,
  dominantIncumbent,
  matchPursuitsToAwards,
  priceGuide,
  topWinningSuppliers,
  winnerBbbeeSplit,
  type Pursuit,
} from "./awardsIntelligence";
import type { Bidder, TenderOutcome } from "./marketPricing";

/** A minimal, otherwise-"empty" register bidder. */
function bidder(name: string, overrides: Partial<Bidder> = {}): Bidder {
  return { name, amounts: [], ...overrides };
}

/** A minimal single-winner AWARDED TenderOutcome - only the fields these
 * functions actually read need real values; everything else is a
 * reasonable, inert default. */
function award(overrides: Partial<TenderOutcome> = {}): TenderOutcome {
  return {
    id: "id",
    outcome_key: "sanral:1",
    reference: null,
    buyer: null,
    title: null,
    project_type: null,
    procurement_type: null,
    province: null,
    categories: [],
    competitive: true,
    status: "awarded",
    closing_date: null,
    award_date: null,
    winner_name: null,
    winner_amount_zar: null,
    winner_points: null,
    winner_count: 1,
    buyer_key: null,
    winner_key: null,
    is_panel_award: false,
    pricing_excluded: false,
    pricing_exclusion_reasons: [],
    bidders: [],
    bidders_source: null,
    register_columns: 0,
    bidder_count: 0,
    priced_bidder_count: 0,
    low_bid_zar: null,
    median_bid_zar: null,
    high_bid_zar: null,
    winner_rank: null,
    winner_vs_median: null,
    lowest_bid_won: null,
    winner_match_basis: null,
    data_notes: [],
    sources: [],
    source_urls: [],
    attribution: null,
    refreshed_at: "2026-11-13T00:00:00Z",
    ...overrides,
  };
}

/** A winner, named and keyed, with a given B-BBEE level (so winnerBbbeeSplit
 * and bidDontBidSignal's own B-BBEE rule have a winnerBidder() to find). */
function winnerAward(name: string, key: string, level: string | null, overrides: Partial<TenderOutcome> = {}): TenderOutcome {
  return award({
    winner_name: name,
    winner_key: key,
    bidder_count: 1,
    bidders: [bidder(name, { is_winner: true, bbbee_level: level })],
    ...overrides,
  });
}

// ------------------------------------------------------- 1. Competition

describe("competitionStats", () => {
  it("counts only awards that actually published a bidder list", () => {
    const stats = competitionStats([
      award({ bidder_count: 4 }),
      award({ bidder_count: 0 }), // no register at all - excluded
      award({ bidder_count: 8 }),
    ]);
    expect(stats.n).toBe(2);
    expect(stats.median).toBe(6);
    expect(stats.low).toBe(4);
    expect(stats.high).toBe(8);
  });

  it("n=0 when nothing published a bidder list - never a fabricated median", () => {
    const stats = competitionStats([award({ bidder_count: 0 }), award({ bidder_count: 0 })]);
    expect(stats).toEqual({ n: 0, median: null, low: null, high: null });
  });
});

// ------------------------------------------------------- 2. Who wins

describe("bucketBbbeeLevel", () => {
  it("EME and QSE pass through unchanged", () => {
    expect(bucketBbbeeLevel("EME")).toBe("EME");
    expect(bucketBbbeeLevel("QSE")).toBe("QSE");
  });
  it("Level 1 and Level 2 both bucket to 'Level 1-2'", () => {
    expect(bucketBbbeeLevel("Level 1")).toBe("Level 1-2");
    expect(bucketBbbeeLevel("Level 2")).toBe("Level 1-2");
  });
  it("Level 3-8, Non-compliant, and unknown/null all fold into 'other' - the brief's own bucket list stops there", () => {
    expect(bucketBbbeeLevel("Level 3")).toBe("other");
    expect(bucketBbbeeLevel("Level 8")).toBe("other");
    expect(bucketBbbeeLevel("Non-compliant")).toBe("other");
    expect(bucketBbbeeLevel(null)).toBe("other");
    expect(bucketBbbeeLevel(undefined)).toBe("other");
  });
});

describe("winnerBbbeeSplit", () => {
  it("buckets each single-winner awarded tender by its winner's own level", () => {
    const split = winnerBbbeeSplit([
      winnerAward("A", "A", "EME"),
      winnerAward("B", "B", "QSE"),
      winnerAward("C", "C", "Level 2"),
      winnerAward("D", "D", "Level 5"),
      winnerAward("E", "E", null),
    ]);
    expect(split).toEqual({ n: 5, EME: 1, QSE: 1, "Level 1-2": 1, other: 2 });
  });

  it("a panel award (winner_count > 1) is never counted - no single level to attribute it to", () => {
    const split = winnerBbbeeSplit([award({ status: "awarded", winner_count: 2 })]);
    expect(split.n).toBe(0);
  });

  it("a register-only tender (no confirmed winner yet) is never counted", () => {
    const split = winnerBbbeeSplit([award({ status: "register_published", winner_count: 0 })]);
    expect(split.n).toBe(0);
  });
});

describe("topWinningSuppliers", () => {
  it("groups by winner_key (not the raw, possibly-inconsistent winner_name), sums value, sorts by wins then value", () => {
    const top = topWinningSuppliers([
      winnerAward("Alpha Co", "ALPHA", "EME", { winner_amount_zar: 100000 }),
      winnerAward("ALPHA CO (PTY) LTD", "ALPHA", "EME", { winner_amount_zar: 200000 }), // same real company, different string
      winnerAward("Beta Co", "BETA", "QSE", { winner_amount_zar: 900000 }),
      winnerAward("Gamma Co", "GAMMA", "EME", { winner_amount_zar: 50000 }),
    ]);
    // The display name kept is whichever spelling was seen FIRST ("Alpha Co") -
    // deterministic, not an attempt to pick the "best" of several real spellings.
    expect(top[0]).toEqual({ key: "ALPHA", name: "Alpha Co", wins: 2, totalValueZar: 300000 });
    expect(top[1].key).toBe("BETA");
    expect(top[2].key).toBe("GAMMA");
  });

  it("respects the limit argument", () => {
    const top = topWinningSuppliers(
      Array.from({ length: 8 }, (_, i) => winnerAward(`Co${i}`, `CO${i}`, "EME")),
      5,
    );
    expect(top.length).toBe(5);
  });
});

// ------------------------------------------------------- 3. Price guide

describe("priceGuide", () => {
  it("computes median/p25/p75 of usable amounts (standard quantile interpolation)", () => {
    // Sorted: 100, 200, 300, 400, 500 -> p25 index 1.0 -> 200; median 300; p75 index 3.0 -> 400.
    const guide = priceGuide([100, 200, 300, 400, 500].map((v) => award({ winner_amount_zar: v })));
    expect(guide.n).toBe(5);
    expect(guide.median).toBe(300);
    expect(guide.p25).toBe(200);
    expect(guide.p75).toBe(400);
  });

  it("excludes pricing_excluded rows from the amount distribution entirely", () => {
    const guide = priceGuide([
      award({ winner_amount_zar: 100000 }),
      award({ winner_amount_zar: 1, pricing_excluded: true }), // nominal placeholder - Phase 2
      award({ winner_amount_zar: 999999999, pricing_excluded: true, is_panel_award: true }), // panel award
    ]);
    expect(guide.n).toBe(1);
    expect(guide.median).toBe(100000);
  });

  it("'lowest did NOT win' % and typical gap, computed only where both a low bid and a winner amount are on file", () => {
    const guide = priceGuide([
      award({ winner_amount_zar: 100, low_bid_zar: 100, lowest_bid_won: true }), // winner WAS lowest
      award({ winner_amount_zar: 120, low_bid_zar: 100, lowest_bid_won: false }), // +20%
      award({ winner_amount_zar: 140, low_bid_zar: 100, lowest_bid_won: false }), // +40%
      award({ winner_amount_zar: 200, low_bid_zar: null, lowest_bid_won: null }), // no register - excluded from this half
    ]);
    expect(guide.vsLowest.n).toBe(3);
    expect(guide.vsLowest.lowestDidNotWinPct).toBe(66.7); // 2 of 3
    expect(guide.vsLowest.typicalGapPct).toBe(30); // median of [20%, 40%]
  });

  it("n=0 with no fabricated numbers when nothing is usable", () => {
    const guide = priceGuide([award({ winner_amount_zar: null }), award({ status: "register_published", winner_count: 0 })]);
    expect(guide).toEqual({ n: 0, median: null, p25: null, p75: null, vsLowest: { n: 0, lowestDidNotWinPct: null, typicalGapPct: null } });
  });
});

// ------------------------------------------------------- 4. Repeat-winner signal

describe("dominantIncumbent", () => {
  it("flags a supplier who won MORE than 40% - 3 of 7 is 42.9%, dominant", () => {
    const awards = [
      ...Array.from({ length: 3 }, () => winnerAward("Dominant Co", "DOM", "EME")),
      ...Array.from({ length: 4 }, (_, i) => winnerAward(`Other${i}`, `OTHER${i}`, "EME")),
    ];
    const result = dominantIncumbent(awards);
    expect(result.isDominant).toBe(true);
    expect(result.winnerKey).toBe("DOM");
    expect(result.sharePct).toBeCloseTo(42.9, 1);
    expect(result.n).toBe(7);
  });

  it("EXACTLY 40% is NOT dominant - the brief says 'more than 40%', not 'at least'", () => {
    const awards = [
      ...Array.from({ length: 2 }, () => winnerAward("Co", "CO", "EME")),
      ...Array.from({ length: 3 }, (_, i) => winnerAward(`Other${i}`, `OTHER${i}`, "EME")),
    ];
    const result = dominantIncumbent(awards); // 2 of 5 = 40.0%
    expect(result.sharePct).toBe(40);
    expect(result.isDominant).toBe(false);
  });

  it("no winners at all -> not dominant, n=0, nothing fabricated", () => {
    const result = dominantIncumbent([award({ status: "register_published", winner_count: 0 })]);
    expect(result).toEqual({ isDominant: false, winnerKey: null, winnerName: null, sharePct: null, n: 0 });
  });
});

// ------------------------------------------------------- 5. Bid / don't-bid signal

describe("bidDontBidSignal", () => {
  it("Grey when n < MIN_SAMPLE (5), and says exactly why", () => {
    const result = bidDontBidSignal({ awards: [award(), award(), award()], userBbbeeLevel: "EME" });
    expect(result.signal).toBe("Grey");
    expect(result.n).toBe(3);
    expect(result.rulesFired[0]).toMatch(/not enough comparable awards/i);
  });

  it("Amber when median bidders >= 15, even if nothing else fires", () => {
    const awards = Array.from({ length: 5 }, () => award({ bidder_count: 15, status: "register_published", winner_count: 0 }));
    const result = bidDontBidSignal({ awards, userBbbeeLevel: null });
    expect(result.signal).toBe("Amber");
    expect(result.rulesFired.some((r) => /high competition/i.test(r))).toBe(true);
  });

  it("Amber when there is a dominant incumbent (>40% win share)", () => {
    const awards = [
      ...Array.from({ length: 3 }, () => winnerAward("Dominant Co", "DOM", "EME", { bidder_count: 3 })),
      ...Array.from({ length: 2 }, (_, i) => winnerAward(`Other${i}`, `OTHER${i}`, "EME", { bidder_count: 3 })),
    ];
    const result = bidDontBidSignal({ awards, userBbbeeLevel: "EME" });
    expect(result.signal).toBe("Amber");
    expect(result.rulesFired.some((r) => /dominant incumbent/i.test(r))).toBe(true);
  });

  it("Amber when the user's own B-BBEE level has never won here", () => {
    const awards = Array.from({ length: 5 }, (_, i) => winnerAward(`Co${i}`, `CO${i}`, "QSE", { bidder_count: 3 }));
    const result = bidDontBidSignal({ awards, userBbbeeLevel: "EME" }); // only QSE winners on record
    expect(result.signal).toBe("Amber");
    expect(result.rulesFired.some((r) => /your b-bbee level/i.test(r))).toBe(true);
  });

  it("Green when median bidders <= 6 AND the user's own level has won here", () => {
    const awards = Array.from({ length: 5 }, (_, i) => winnerAward(`Co${i}`, `CO${i}`, "EME", { bidder_count: 4 }));
    const result = bidDontBidSignal({ awards, userBbbeeLevel: "EME" });
    expect(result.signal).toBe("Green");
    expect(result.rulesFired.length).toBeGreaterThan(0);
  });

  it("the user's level simply unknown (null) never fires the B-BBEE Amber rule, but also can't earn Green", () => {
    const awards = Array.from({ length: 5 }, (_, i) => winnerAward(`Co${i}`, `CO${i}`, "EME", { bidder_count: 4 }));
    const result = bidDontBidSignal({ awards, userBbbeeLevel: null });
    expect(result.signal).toBe("Grey"); // low competition, but we can't confirm the (unknown) user level has won
    expect(result.rulesFired.some((r) => /your b-bbee level/i.test(r))).toBe(false);
  });

  it("never returns a numeric win-probability field, anywhere", () => {
    const awards = Array.from({ length: 5 }, (_, i) => winnerAward(`Co${i}`, `CO${i}`, "EME", { bidder_count: 4 }));
    const result = bidDontBidSignal({ awards, userBbbeeLevel: "EME" });
    expect(Object.keys(result).sort()).toEqual(["n", "rulesFired", "signal"]);
  });
});

// ------------------------------------------------------- 6. Win/loss suggestion

describe("matchPursuitsToAwards", () => {
  const awards = [
    award({ outcome_key: "sanral:X.001", reference: "X.001-2026/1", buyer: "SANRAL", title: "Road upgrade", winner_name: "Winner Co", winner_count: 1 }),
    award({ outcome_key: "ocid:1", reference: null, buyer: "Dept of Water", title: "Supply and install new pump station equipment", winner_name: "Pump Co", winner_count: 1 }),
  ];

  it("matches by reference first, whatever the punctuation/spacing", () => {
    const pursuits: Pursuit[] = [{ id: "p1", reference: "x001 2026/1", buyer: null, title: null, companyNames: ["Winner Co"] }];
    const [result] = matchPursuitsToAwards(pursuits, awards);
    expect(result.matchedOn).toBe("reference");
    expect(result.suggestion).toBe("Won");
  });

  it("falls back to same-buyer title similarity when there's no reference match", () => {
    const pursuits: Pursuit[] = [
      { id: "p2", reference: null, buyer: "Dept of Water", title: "Supply and install a new pump station", companyNames: ["Some Other Co"] },
    ];
    const [result] = matchPursuitsToAwards(pursuits, awards);
    expect(result.matchedOn).toBe("title_similarity");
    expect(result.suggestion).toBe("Lost");
    expect(result.lostTo).toBe("Pump Co");
  });

  it("suggests 'Won' only when one of the company's own names is the real winner", () => {
    const pursuits: Pursuit[] = [{ id: "p3", reference: "X.001-2026/1", buyer: null, title: null, companyNames: ["Winner Co Pty Ltd"] }];
    const [result] = matchPursuitsToAwards(pursuits, awards);
    expect(result.suggestion).toBe("Won");
  });

  it("'Unmatched' when nothing resembles it, and 'Unmatched' (not a guess) when the matched tender has no winner yet", () => {
    const unmatched: Pursuit[] = [{ id: "p4", reference: "no-such-ref", buyer: "Nobody", title: "Nothing like this exists", companyNames: [] }];
    expect(matchPursuitsToAwards(unmatched, awards)[0].suggestion).toBe("Unmatched");

    const stillOpen = [award({ outcome_key: "sanral:Y.1", reference: "Y.001-2026/1", status: "register_published", winner_count: 0 })];
    const pending: Pursuit[] = [{ id: "p5", reference: "Y.001-2026/1", buyer: null, title: null, companyNames: [] }];
    const [result] = matchPursuitsToAwards(pending, stillOpen);
    expect(result.matchedOn).toBe("reference");
    expect(result.suggestion).toBe("Unmatched"); // matched the tender, but it has no winner yet - never guessed
  });

  it("the result never carries anything resembling a pipeline-stage field - it is a suggestion only", () => {
    const pursuits: Pursuit[] = [{ id: "p1", reference: "X.001-2026/1", buyer: null, title: null, companyNames: ["Winner Co"] }];
    const [result] = matchPursuitsToAwards(pursuits, awards);
    expect(Object.keys(result).sort()).toEqual(["lostTo", "matchedOn", "matchedOutcomeKey", "pursuitId", "suggestion"]);
  });
});
