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


def main():
    test_unrelated_company_sharing_a_first_word_is_not_assumed_the_winner()
    test_exact_name_match_still_sets_the_winner()
    test_amount_match_still_sets_the_winner()
    test_find_winner_still_returns_the_unconfirmed_candidate_for_diagnostics()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
