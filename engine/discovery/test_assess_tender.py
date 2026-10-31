"""
assess_tender.load_company_profile() had no dedicated test at all before
this pass - confirmed by a repo-wide search before writing this, despite
693 lines and being the one function every CLI/manual-profile caller
(engine/intake/classify_tender.py's --profile path, this module's own CLI)
uses to turn a hand-maintained profile.json into the dict assess_fit()/
estimate_score_outlook() score against.

QA Finding, 2026-10-31: `"disciplines": company.get("disciplines", [])`
had no type check at all. This function's own docstring says these files
are hand-maintained ("config/test_companies/<company>.json, or that
company's own exported profile"), and every OTHER field on `company` in a
real profile genuinely is a bare string (bee_level, black_ownership_pct,
...) - so typing "disciplines": "roads_civil" instead of ["roads_civil"]
is a realistic, easy mistake, not a contrived one.

taxonomy.fit_overlap()'s own `set(company_disciplines or [])` doesn't
reject a bare string: Python iterates a string into its INDIVIDUAL
CHARACTERS, so `{'r','o','a','d','s','_','c','i','v','i','l'}` never
equals a real category slug. Confirmed directly: a company profile with
"disciplines": "roads_civil" (not ["roads_civil"]) scored its own
road_maintenance tender as "outside the company's disciplines" / not_a_fit
- silently, no error, no crash - exactly the "silent wrong data is the
main risk" failure mode this module's own find_delivery_address()/
find_closing_time() docstrings already worry about everywhere else, just
unguarded here. The live Discovery fan-out's own company_profiles.py
always builds disciplines as a real list (sorted() of a set
comprehension), so it can never hit this - only this CLI/manual-profile
path can.

Fix: load_company_profile() now normalises a bare string into a one-item
list (the obviously intended reading of that typo), and anything else that
isn't a list or string into an empty list with a loud WARNING printed -
never silently iterating it into garbage.

Run: python3 engine/discovery/test_assess_tender.py
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import assess_tender as at  # noqa: E402
import taxonomy  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _profile_file(company_fields):
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump({"company": company_fields}, f)
    return path


def test_disciplines_as_a_bare_string_is_normalised_not_shredded_into_characters():
    print("a hand-typed 'disciplines': '<slug>' (not a list) is read as one discipline, not individual characters")
    path = _profile_file({"disciplines": "roads_civil"})
    try:
        profile = at.load_company_profile(path)
        check("a bare string is wrapped into a one-item list", profile["disciplines"] == ["roads_civil"], profile)

        tax = taxonomy.load_taxonomy(None)
        out = tax.fit_overlap(["road_maintenance"], profile["disciplines"])
        check("the company's own real discipline now matches exactly, not 'outside'",
              out["exact"] == ["road_maintenance"] and not out["outside"], out)
    finally:
        os.unlink(path)


def test_disciplines_as_an_empty_string_normalises_to_empty_list():
    print("'disciplines': '' (blank) is empty, not a one-item list of an empty string")
    path = _profile_file({"disciplines": ""})
    try:
        profile = at.load_company_profile(path)
        check("a blank string normalises to []", profile["disciplines"] == [], profile)
    finally:
        os.unlink(path)


def test_disciplines_of_a_genuinely_wrong_type_falls_back_to_empty_not_a_crash():
    print("'disciplines': 42 (not a string or list) is treated as empty, not shredded or crashing")
    path = _profile_file({"disciplines": 42})
    try:
        profile = at.load_company_profile(path)
        check("a non-list, non-string value is treated as empty", profile["disciplines"] == [], profile)
    finally:
        os.unlink(path)


def test_disciplines_as_a_real_list_is_unchanged():
    print("control: a normal 'disciplines': [...] list is passed through exactly as before")
    path = _profile_file({"disciplines": ["roads_civil", "water"]})
    try:
        profile = at.load_company_profile(path)
        check("a real list is untouched", profile["disciplines"] == ["roads_civil", "water"], profile)
    finally:
        os.unlink(path)


def main():
    test_disciplines_as_a_bare_string_is_normalised_not_shredded_into_characters()
    test_disciplines_as_an_empty_string_normalises_to_empty_list()
    test_disciplines_of_a_genuinely_wrong_type_falls_back_to_empty_not_a_crash()
    test_disciplines_as_a_real_list_is_unchanged()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
