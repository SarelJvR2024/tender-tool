"""
Focused tests for suggest_pack.py's suggest()/score_candidate() ranking -
no dedicated test file existed for this module before this.

Finding (2026-10-21, docs/specs/QA-Edge-Case-Findings.md): the candidate
ranking sort had no tie-break at all (`key=lambda c: c["score"], reverse=True`),
unlike engine/pack/process_pack_jobs.py's own rank_candidates() for the
SAME scoring, which explicitly ties-break by years' experience then name
("ties: more years' experience, then name - stated, not hidden"). Since
Python's sorted() is stable, an unbroken tie fell back to each person's
position in the company's profile JSON - two candidates tied on score
could get a DIFFERENT "SUGGESTED" person purely depending on file order,
and that pick could silently disagree with what the same company's live
Tender Workspace would rank first for the identical position.

Run: python3 engine/pack_generator/test_suggest_pack.py
"""
import datetime
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import suggest_pack as sp  # noqa: E402

FAILS = []
CLOSING = datetime.date(2026, 12, 1)


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _person(name, grad, description, projects=None):
    return {"name": name, "qualifications": {"initial_graduated": grad}, "description": description,
            "projects": projects or []}


def _rank(people, position):
    return sp.rank_candidates(people, position, CLOSING)


def test_tied_score_breaks_by_years_regardless_of_profile_order():
    print("two candidates tied on score, different years' experience - the suggestion must not depend on file order")
    position = {"code": "DS1", "description": "Structures Specialist"}
    junior = _person("Zelda Junior", "2020-01-01", "Structures specialist")
    senior = _person("Amara Senior", "2005-01-01", "Structures specialist")

    ranked_junior_first = _rank({"person_0": junior, "person_1": senior}, position)
    ranked_senior_first = _rank({"person_0": senior, "person_1": junior}, position)
    check("junior-first profile order still suggests the more senior, tied-score candidate",
          ranked_junior_first[0]["name"] == "Amara Senior", ranked_junior_first)
    check("senior-first profile order suggests the SAME candidate (order-independent)",
          ranked_senior_first[0]["name"] == "Amara Senior", ranked_senior_first)
    check("both orderings agree with each other", ranked_junior_first[0]["name"] == ranked_senior_first[0]["name"])


def test_genuine_score_difference_still_wins_over_years():
    print("mirror case: a genuinely better keyword match must still win over a merely more senior mismatch")
    position = {"code": "DS1", "description": "Structures Specialist bridges"}
    matched_junior = _person("Zelda Junior", "2020-01-01", "Structures specialist bridges")
    unmatched_senior = _person("Amara Senior", "2005-01-01", "Quantity surveyor roads")
    ranked = _rank({"person_0": unmatched_senior, "person_1": matched_junior}, position)
    check("the higher-scoring candidate wins even though they have fewer years than the loser",
          ranked[0]["name"] == "Zelda Junior" and ranked[0]["score"] > ranked[1]["score"], ranked)


def test_tied_score_and_years_breaks_by_name():
    print("two candidates tied on BOTH score and years - falls back to name, stays deterministic")
    position = {"code": "DS1", "description": "Structures Specialist"}
    a = _person("Zed Person", "2010-01-01", "Structures specialist")
    b = _person("Amy Person", "2010-01-01", "Structures specialist")
    ranked1 = _rank({"person_0": a, "person_1": b}, position)
    ranked2 = _rank({"person_0": b, "person_1": a}, position)
    check("name-based tie-break picks the alphabetically-first name consistently",
          ranked1[0]["name"] == "Amy Person" and ranked2[0]["name"] == "Amy Person", (ranked1, ranked2))


def main():
    test_tied_score_breaks_by_years_regardless_of_profile_order()
    test_genuine_score_difference_still_wins_over_years()
    test_tied_score_and_years_breaks_by_name()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
