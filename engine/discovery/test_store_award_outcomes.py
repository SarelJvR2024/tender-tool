"""
Focused tests for store_award_outcomes.py's find_winner()/merge() - no
dedicated test file existed for this module before this (test_award_outcomes.py
only covers the separate award_outcomes.py parsing module).

Finding (2026-10-21, docs/specs/QA-Edge-Case-Findings.md): find_winner()'s
last-resort fallback matched a winner to a bidder by comparing ONLY the
first word of each normalized name ("name_token"). Many real South African
company names share a common first word (place names, Nguni/Sesotho words)
while being completely unrelated entities - "Bokamoso Trading CC" and
"Bokamoso Construction (Pty) Ltd" matched on first-token alone with the
latter not even present in the bidders register. A difflib similarity
check was tried and found NOT to cleanly separate this false positive
(ratio ~0.69) from a genuine trading-name variant of the SAME company
(ratio ~0.67-0.73 for several realistic cases) - there is no safe
threshold. Fixed by never letting a name_token-only match set `is_winner`
on a stored, public award record - it still surfaces as an honest,
unconfirmed "closest candidate" note instead.

Usage: python3 engine/discovery/test_store_award_outcomes.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import store_award_outcomes as sao  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _bidders():
    return [
        {"name": "Bokamoso Trading CC", "amounts": [{"column": "Amount", "amount_zar": 500000, "amount_raw": None}]},
        {"name": "Siyakhula Projects (Pty) Ltd", "amounts": [{"column": "Amount", "amount_zar": 350000, "amount_raw": None}]},
    ]


def _part(winner, amount=None, bidders=None):
    return {"source": "etenders_portal", "source_url": None, "attribution": None,
            "status": "awarded", "title": "Test tender", "reference": "T001",
            "buyer": "Test Municipality", "closing_date": "2026-01-01", "award_date": None,
            "winner": winner, "winner_amount_zar": amount,
            "winner_points": None, "winner_bbbee_points": None, "winner_count": 1,
            "bidders": bidders if bidders is not None else _bidders(), "bidders_source": "etenders_bidders",
            "register_columns": 1, "notes": [], "procurement_type": None, "project_type": None,
            "province": None, "competitive": True}


def test_unrelated_company_sharing_a_first_word_is_not_assumed_the_winner():
    print("a real company sharing only a generic first word must not be stored as the winner")
    row = sao.merge("k1", [_part("Bokamoso Construction (Pty) Ltd")])
    check("no bidder is marked is_winner (the real winner isn't even in this register)",
          not any(b.get("is_winner") for b in row["bidders"]), row["bidders"])
    check("winner_match_basis stays null - a first-word-only hit is never asserted as a fact",
          row["winner_match_basis"] is None, row["winner_match_basis"])
    check("an honest, unconfirmed note names the closest candidate instead",
          any("could not be confidently matched" in n and "Bokamoso Trading CC" in n for n in row["data_notes"]),
          row["data_notes"])


def test_exact_name_match_still_sets_the_winner():
    print("mirror case: an exact (normalized) name match still works")
    row = sao.merge("k2", [_part("Bokamoso Trading CC")])
    winners = [b["name"] for b in row["bidders"] if b.get("is_winner")]
    check("the exact-match bidder is marked the winner", winners == ["Bokamoso Trading CC"], winners)
    check("basis is 'name', the confident path", row["winner_match_basis"] == "name", row["winner_match_basis"])


def test_amount_match_still_sets_the_winner():
    print("mirror case: a slightly-different name but an exact amount match still works")
    row = sao.merge("k3", [_part("Bokamoso Trading Close Corporation", amount=500000)])
    winners = [b["name"] for b in row["bidders"] if b.get("is_winner")]
    check("the amount-matched bidder is marked the winner", winners == ["Bokamoso Trading CC"], winners)
    check("basis is 'amount', the confident path", row["winner_match_basis"] == "amount", row["winner_match_basis"])


def test_find_winner_still_returns_the_unconfirmed_candidate_for_diagnostics():
    print("find_winner() itself still surfaces the name_token candidate (merge() is what withholds trust)")
    wi, basis = sao.find_winner(_bidders(), "Bokamoso Construction (Pty) Ltd", None)
    check("the candidate index and 'name_token' basis are still returned (not silently dropped)",
          wi == 0 and basis == "name_token", (wi, basis))


def test_every_row_in_one_batch_carries_the_same_keys():
    print("a batch mixing a brand-new tender with an already-seen one must not produce mismatched row keys")
    new_tender = _part("New Co (Pty) Ltd", bidders=[])
    new_tender["ocid"], new_tender["title"] = "ocds-new-001", "Brand new tender"
    seen_tender = _part("Old Co (Pty) Ltd", bidders=[])
    seen_tender["ocid"], seen_tender["title"] = "ocds-old-001", "Already-seen tender"
    existing = {sao.outcome_key(seen_tender): {"parts": {}, "first_seen_at": "2026-01-01T00:00:00+00:00"}}
    rows = sao.build_rows([new_tender, seen_tender], existing)
    check("build_rows() produced both rows", len(rows) == 2, len(rows))
    key_sets = [set(r.keys()) for r in rows]
    check("every row has the exact same set of keys - the real cause of the live "
          "PGRST102 'All object keys must match' crash (2026-10-22): a conditionally-added "
          "first_seen_at key made a new tender's row shape differ from an already-seen one's "
          "in the SAME upsert batch", key_sets[0] == key_sets[1], key_sets)
    check("the already-seen tender kept its real first_seen_at, not today's date",
          [r for r in rows if r["outcome_key"] == sao.outcome_key(seen_tender)][0]["first_seen_at"]
          == "2026-01-01T00:00:00+00:00")
    check("the brand-new tender got a first_seen_at at all (not missing)",
          [r for r in rows if r["outcome_key"] == sao.outcome_key(new_tender)][0]["first_seen_at"] is not None)


def test_zero_amount_dropped_with_an_explanatory_note():
    print("a literal '0.00' on a SANRAL register (parse_rand()'s own docstring confirms this is real, "
          "seen live 2026-10-17) must be dropped with the same kind of note every other dropped amount gets")
    rec = {
        "source": "sanral_awarded", "reference": "N.001-002-2026/1", "title": "Test tender",
        "opening_register": [
            {"tenderer": "Withdrawn Co (Pty) Ltd",
             "amounts": [{"column": "Amount", "amount_zar": 0.0, "amount_raw": "0.00"}]},
        ],
    }
    part = sao.part_from_sanral(rec)
    check("the zero amount is still dropped from amount_zar (0 fails plausible()'s 0 < amount check)",
          part["bidders"][0]["amounts"][0]["amount_zar"] is None, part["bidders"][0]["amounts"][0])
    check("but the raw text is kept, not discarded, so the register's own wording is still visible",
          part["bidders"][0]["amounts"][0]["amount_raw"] == "0.00")
    check("and - unlike every OTHER dropped amount in this file - a note explains why it's missing, "
          "not a silent null with no reason given",
          any("Withdrawn Co" in n for n in part["notes"]), part["notes"])


def test_amount_fallback_never_crosses_to_a_different_winners_source():
    print("merge()'s winner_amount_zar fallback (SANRAL's own approved-amount field missing/unparseable) "
          "must not silently pick up a DIFFERENT source's amount for a DIFFERENT named winner")
    # SANRAL's own awarded-page record: a real winner, but no parseable
    # approved contract amount (summarize_sanral()'s own "with_contract_amount"
    # count confirms this field is genuinely sometimes absent on a real
    # awarded-page record - not every award page carries it).
    sanral_rec = {"source": "sanral_awarded", "reference": "N.001-002-2026/1", "title": "Test tender",
                  "awarded_to": "Black Torres Builders CC"}
    # eTenders' own row for the SAME outcome_key, naming a genuinely
    # DIFFERENT company (e.g. a re-award SANRAL's page hasn't caught up
    # with) - its amount belongs to ITS OWN winner, not SANRAL's.
    portal_rec = {"bid_number": "SANRAL-TEST-1", "title": "Test tender", "buyer": "SANRAL",
                  "procurement_type": "Open", "awards": [{"supplier": "Delta Roadworks (Pty) Ltd",
                                                           "amount_zar": 18_500_000.0}]}
    row = sao.merge("sanral:N.001-002-2026/1",
                     [sao.part_from_sanral(sanral_rec), sao.part_from_portal(portal_rec)])
    check("SANRAL's higher-priority winner name is still used",
          row["winner_name"] == "Black Torres Builders CC", row["winner_name"])
    check("but eTenders' amount for the DIFFERENT winner (Delta Roadworks) is NOT attached to it",
          row["winner_amount_zar"] is None, row["winner_amount_zar"])
    check("an honest note names the excluded source and the other winner it actually belongs to",
          any("etenders_portal" in n and "Delta Roadworks" in n for n in row["data_notes"]), row["data_notes"])


def test_amount_fallback_still_works_for_the_same_winner_spelled_differently():
    print("mirror case: the legitimate use this fallback exists for - the SAME real winner, spelled "
          "differently on each source (fixture-confirmed real: SANRAL's 'Black Torres JV' vs eTenders' "
          "'BLACK TORRES 96' for X.003-080-2024/1) - must still get the other source's amount")
    sanral_rec = {"source": "sanral_awarded", "reference": "N.002-003-2026/1", "title": "Test tender 2",
                  "awarded_to": "Build Co (Pty) Ltd"}
    portal_rec = {"bid_number": "SANRAL-TEST-2", "title": "Test tender 2", "buyer": "SANRAL",
                  "procurement_type": "Open", "awards": [{"supplier": "BUILD CO LTD", "amount_zar": 9_000_000.0}]}
    row = sao.merge("sanral:N.002-003-2026/1",
                     [sao.part_from_sanral(sanral_rec), sao.part_from_portal(portal_rec)])
    check("the amount still comes through for the SAME (just differently spelled) winner",
          row["winner_amount_zar"] == 9_000_000.0, row["winner_amount_zar"])
    check("no spurious mismatch note for a genuine same-company spelling difference",
          not any("different winner name" in n for n in row["data_notes"]), row["data_notes"])


def test_points_fallback_never_crosses_to_a_different_winners_source():
    print("merge()'s winner_points/winner_bbbee_points must not silently pick up a DIFFERENT "
          "SANRAL part's score for a DIFFERENT named winner - the same bug shape Finding 246 fixed "
          "for winner_amount_zar, left open for these two fields")
    # The higher-priority (awarded-list) page: a real winner, but its own
    # detail page never had a Full Points Awarded / BBBEE Points row at all
    # (not every SANRAL detail page template includes them).
    awarded_rec = {"source": "sanral_awarded", "reference": "N.003-004-2026/1", "title": "Test tender 3",
                   "awarded_to": "Acme Construction (Pty) Ltd", "full_points": None, "bbbee_points": None}
    # The closed-list page for the SAME tender, naming a genuinely DIFFERENT
    # company (an appeal/re-award that page hasn't caught up with yet - the
    # exact scenario merge()'s own comment names for the amount field) -
    # its points belong to ITS OWN winner, not to the awarded-list's.
    closed_rec = {"source": "sanral_closed", "reference": "N.003-004-2026/1", "title": "Test tender 3",
                  "awarded_to": "Beta Builders CC", "full_points": "87.4000", "bbbee_points": "10.0000"}
    row = sao.merge("sanral:N.003-004-2026/1",
                     [sao.part_from_sanral(awarded_rec), sao.part_from_sanral(closed_rec)])
    check("the higher-priority winner name is still used",
          row["winner_name"] == "Acme Construction (Pty) Ltd", row["winner_name"])
    check("but sanral_closed's points for the DIFFERENT winner (Beta Builders) are NOT attached to it",
          row["winner_points"] is None and row["winner_bbbee_points"] is None,
          (row["winner_points"], row["winner_bbbee_points"]))
    check("an honest note names the excluded source and the other winner each score actually belongs to",
          sum(1 for n in row["data_notes"] if "sanral_closed" in n and "Beta Builders" in n) == 2,
          row["data_notes"])


def test_points_fallback_still_works_for_the_same_winner_spelled_differently():
    print("mirror case: the legitimate use this fallback exists for - the SAME real winner, spelled "
          "differently (or just named on one page and not the other) on each SANRAL page - must still "
          "get the other page's points")
    awarded_rec = {"source": "sanral_awarded", "reference": "N.004-005-2026/1", "title": "Test tender 4",
                   "awarded_to": "Build Co (Pty) Ltd", "full_points": None, "bbbee_points": None}
    closed_rec = {"source": "sanral_closed", "reference": "N.004-005-2026/1", "title": "Test tender 4",
                  "awarded_to": "BUILD CO LTD", "full_points": "92.1000", "bbbee_points": "15.0000"}
    row = sao.merge("sanral:N.004-005-2026/1",
                     [sao.part_from_sanral(awarded_rec), sao.part_from_sanral(closed_rec)])
    check("the points still come through for the SAME (just differently spelled) winner",
          row["winner_points"] == "92.1000", row["winner_points"])
    check("the BBBEE points too", row["winner_bbbee_points"] == "15.0000", row["winner_bbbee_points"])
    check("no spurious mismatch note for a genuine same-company spelling difference",
          not any("different winner name" in n for n in row["data_notes"]), row["data_notes"])


def main():
    test_unrelated_company_sharing_a_first_word_is_not_assumed_the_winner()
    test_exact_name_match_still_sets_the_winner()
    test_amount_match_still_sets_the_winner()
    test_find_winner_still_returns_the_unconfirmed_candidate_for_diagnostics()
    test_every_row_in_one_batch_carries_the_same_keys()
    test_zero_amount_dropped_with_an_explanatory_note()
    test_amount_fallback_never_crosses_to_a_different_winners_source()
    test_amount_fallback_still_works_for_the_same_winner_spelled_differently()
    test_points_fallback_never_crosses_to_a_different_winners_source()
    test_points_fallback_still_works_for_the_same_winner_spelled_differently()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
