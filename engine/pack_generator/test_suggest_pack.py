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
import json
import os
import sys
import tempfile

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


def test_a_person_with_projects_explicitly_null_does_not_crash_scoring_for_everyone_else():
    """Finding (2026-10-30): candidate_person_text()'s `person.get("projects", [])`
    only substitutes [] when the key is ABSENT - a signatory-only director
    entered with just a name is a real profile.json shape with "projects":
    null PRESENT, and `for proj in None:` raised TypeError straight out of
    rank_candidates(), with no per-person try/except - losing every OTHER
    candidate's suggestion for that position too, not just the one person
    with no projects on file. generate_cv.py's own build_sanral_keyperson()/
    build_world_bank() already guard this exact field with "or []"; this
    sibling function didn't."""
    print("a person with 'projects': null on file doesn't crash scoring for the whole position")
    position = {"code": "DS1", "description": "Structures Specialist"}
    signatory_only = {"name": "Director No Projects", "qualifications": {}, "description": "", "projects": None}
    real_candidate = _person("Zelda Junior", "2020-01-01", "Structures specialist")
    try:
        ranked = _rank({"person_0": signatory_only, "person_1": real_candidate}, position)
        check("both candidates are still scored - the null-projects person doesn't abort the whole call",
              {c["name"] for c in ranked} == {"Director No Projects", "Zelda Junior"}, ranked)
        check("the signatory-only director scores 0, not crashing or being silently dropped",
              next(c["score"] for c in ranked if c["name"] == "Director No Projects") == 0, ranked)
    except TypeError as e:
        check("suggest_pack.py no longer crashes on a person whose projects is explicitly null", False, str(e))


def test_suggest_refuses_clearly_on_a_blank_or_unreadable_closing_date_cell():
    """Finding (2026-10-25): suggest()'s own `_excel_date(wb.cached("SETUP",
    "C3"))` had no guard at all, unlike classify_tender.read_setup()'s
    identical calculation - a blank or unreadable SETUP!C3 cell (a real,
    plausible template shape, not every buyer fills in every cell the same
    way) raised a bare "int() argument must be a string..." with no
    indication which cell or workbook was the problem."""
    print("suggest(): a blank/unreadable SETUP!C3 cell is refused with a clear, named error, not a bare TypeError")
    real_workbook = sp.Workbook

    class FakeWB:
        def __init__(self, path):
            pass

        def cached(self, sheet, ref):
            return "R.396-010-2025/1F" if ref == "C2" else None

    sp.Workbook = FakeWB
    d = tempfile.mkdtemp()
    profile_path = os.path.join(d, "profile.json")
    json.dump({"key_people": []}, open(profile_path, "w"))
    try:
        sp.suggest("fake_template.xlsm", profile_path, d)
        check("a blank SETUP!C3 should have raised", False)
    except ValueError as e:
        check("raises ValueError naming the template and the cell, not a bare TypeError",
              "SETUP!C3" in str(e) and "fake_template.xlsm" in str(e), str(e))
    except TypeError as e:
        check("raises ValueError naming the template and the cell, not a bare TypeError", False, str(e))
    finally:
        sp.Workbook = real_workbook


def test_excel_date_parses_a_text_typed_date_too_not_only_a_numeric_serial():
    """QA Finding, 2026-10-30: Workbook.cached() returns a genuine Excel date
    cell as a plain numeric serial (date FORMATTING is only a display style,
    not part of the cell's own stored value) - but a cell someone typed as
    literal text (an apostrophe-prefixed '2026-05-01 to stop Excel's own
    autoformat, a paste-as-values from a different locale) comes back as a
    string instead. _excel_date() only ever tried int(serial) - a
    perfectly valid, if unusually-typed, closing date raised here, while
    engine/pack/assemble_pack.py's own separate, independently written
    _excel_date() already parsed both shapes. The SAME SETUP!C3 cell of the
    SAME tender was silently dropped during intake (classify_tender.
    read_setup(), which imports this function) and falsely refused during
    key-position suggestion (this file's own suggest()), while the real
    pack build read it fine."""
    print("_excel_date(): a text-typed closing date ('2026-05-01') is parsed exactly like a numeric "
          "Excel serial for the same real day")
    check("a numeric Excel serial still works (unchanged)", sp._excel_date(46356) == datetime.date(2026, 11, 30))
    check("a text-typed ISO date string is now parsed too", sp._excel_date("2026-05-01") == datetime.date(2026, 5, 1))
    check("a text-typed date with incidental surrounding whitespace is still parsed",
          sp._excel_date("  2026-05-01  ") == datetime.date(2026, 5, 1))
    for bad in (None, "", "not-a-date", True, False):
        try:
            sp._excel_date(bad)
            check(f"genuinely unreadable input ({bad!r}) still raises, not silently guessed", False)
        except (TypeError, ValueError):
            check(f"genuinely unreadable input ({bad!r}) still raises, not silently guessed", True)

    print("suggest(): a text-typed SETUP!C3 closing date no longer falsely refused")
    real_workbook = sp.Workbook

    class FakeWB:
        def __init__(self, path):
            pass

        def cached(self, sheet, ref):
            return "R.396-010-2025/1F" if ref == "C2" else ("2026-05-01" if ref == "C3" else None)

    sp.Workbook = FakeWB
    d = tempfile.mkdtemp()
    profile_path = os.path.join(d, "profile.json")
    json.dump({"key_people": []}, open(profile_path, "w"))
    try:
        sp.suggest("fake_template.xlsm", profile_path, d)
        check("suggest() no longer falsely raises on a valid, text-typed closing date", True)
        written = json.load(open(os.path.join(d, "pack_suggestions.json")))
        check("...and the real closing date reached the written output",
              written.get("closing_date") == "2026-05-01", written)
    except ValueError as e:
        check("suggest() no longer falsely raises on a valid, text-typed closing date", False, str(e))
    finally:
        sp.Workbook = real_workbook


def main():
    test_tied_score_breaks_by_years_regardless_of_profile_order()
    test_genuine_score_difference_still_wins_over_years()
    test_tied_score_and_years_breaks_by_name()
    test_a_person_with_projects_explicitly_null_does_not_crash_scoring_for_everyone_else()
    test_suggest_refuses_clearly_on_a_blank_or_unreadable_closing_date_cell()
    test_excel_date_parses_a_text_typed_date_too_not_only_a_numeric_serial()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
