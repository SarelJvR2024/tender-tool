"""
Manifest v2 (2026-10-29, Sarel's own brief): _functionality()'s structured
scorecard - has_sub_minimum/sub_minimum_rule/criteria, replacing the plain
present/threshold-only shape. Both new fields are generic pattern matches
(no specific point split or rule wording is hardcoded anywhere) - see this
file's sibling, engine/general/test_requirements_manifest_v2.py, for why
(the brief's own benchmark document doesn't exist in this environment).

Run: python3 engine/discovery/test_score_outlook_functionality.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import score_outlook as so  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


SCORECARD_TEXT = """
Functionality will be evaluated against the criteria below. A minimum score
of 70 points is required to proceed to price evaluation. Bidders must
achieve a minimum rating of 3 out of 5 in every criterion.

Company Experience 40 points
Key Personnel 40 points
Methodology 20 points
"""

NO_SUB_MINIMUM_TEXT = """
Functionality will be evaluated by the evaluation committee. A minimum
score of 60 points is required to proceed to price evaluation.
"""

SINGLE_LINE_TEXT = "Functionality is scored out of 100. Methodology 20 points is the only line item mentioned."


def test_real_scorecard_with_sub_minimum_extracted():
    r = so._functionality(SCORECARD_TEXT)
    check("present is True", r["present"] is True)
    check("the real stated threshold (70) is read, not guessed", r["threshold"] == 70)
    check("a real 'minimum X out of Y in every criterion' clause sets has_sub_minimum", r["has_sub_minimum"] is True)
    check("the sub_minimum_rule carries the real clause text, not a generic label", "3" in (r["sub_minimum_rule"] or "") and "5" in (r["sub_minimum_rule"] or ""), r["sub_minimum_rule"])
    check("all 3 real criteria rows are extracted", len(r["criteria"]) == 3, r["criteria"])
    if len(r["criteria"]) == 3:
        names = {c["name"] for c in r["criteria"]}
        check("each real criterion name is captured correctly", names == {"Company Experience", "Key Personnel", "Methodology"}, names)
        weights = {c["name"]: c["weight"] for c in r["criteria"]}
        check("each real weight is read correctly, not assumed", weights == {"Company Experience": 40, "Key Personnel": 40, "Methodology": 20}, weights)


def test_no_sub_minimum_clause_means_the_field_stays_honestly_false():
    r = so._functionality(NO_SUB_MINIMUM_TEXT)
    check("present is True", r["present"] is True)
    check("has_sub_minimum is False when the document states no such rule - never guessed true", r["has_sub_minimum"] is False)
    check("sub_minimum_rule is None, not an invented rule", r["sub_minimum_rule"] is None)
    check("criteria is empty - no real scoring table was present", r["criteria"] == [])


def test_a_single_stray_points_line_is_not_mistaken_for_a_real_scorecard():
    r = so._functionality(SINGLE_LINE_TEXT)
    check("a single '<N> points' line alone is too weak to call a real criteria breakdown - stays empty",
          r["criteria"] == [], r["criteria"])


def test_present_false_and_present_none_branches_carry_the_same_new_keys():
    na = so._functionality("Functionality\nN/A - price and specific goals only.")
    check("the 'not applicable' branch still carries has_sub_minimum/sub_minimum_rule/criteria keys (always the same shape)",
          set(na.keys()) >= {"has_sub_minimum", "sub_minimum_rule", "criteria"})
    none_found = so._functionality("This document never mentions functionality or quality evaluation at all.")
    check("the 'not mentioned' branch also carries the same keys", set(none_found.keys()) >= {"has_sub_minimum", "sub_minimum_rule", "criteria"})


def main():
    test_real_scorecard_with_sub_minimum_extracted()
    test_no_sub_minimum_clause_means_the_field_stays_honestly_false()
    test_a_single_stray_points_line_is_not_mistaken_for_a_real_scorecard()
    test_present_false_and_present_none_branches_carry_the_same_new_keys()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
