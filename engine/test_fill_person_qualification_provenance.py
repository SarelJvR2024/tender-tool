"""
Regression test for fill_tender.py's and fill_conventional.py's own
fill_person() - the Form B1/B2 key-person-block writer - never guarding or
logging its own highest_description/highest_institution/highest_graduated/
initial_description/initial_institution fields (initial_graduated was
already covered, see below).

Finding 388 (2026-11-11, standing solution-architect review): these five
columns are independently nullable (0001_init_schema.sql - no check
constraint ties any of them to highest_level/each other) and the People
page's own form (app/app/people/[id]/page.tsx) never marks any of them
`required` - unlike confirm_pack.py's own hard-stop on initial_graduated
(needed to compute years_experience), none of these five is validated
anywhere before reaching this function. Two independent bugs, both fixed
here:

  1. A CRASH, not just a silent gap: `highest_graduated` was passed
     straight into wb.set_date(), which calls `.year` on whatever it's
     given with no None guard - a key person with no highest-qualification
     graduation date on file (a real, reachable profile shape: the People
     page lets it be left blank) crashed the ENTIRE pack-generation job
     with a raw `AttributeError: 'NoneType' object has no attribute
     'year'`, not a clean, actionable refusal. Live-reproduced below
     against the real committed sample before the fix.
  2. The same "zero field_provenance trace" gap Finding 376 already fixed
     for ecsa_number/ecsa_date/sacpcmp_number/sacpcmp_date - the four text
     siblings (highest_description/highest_institution/
     initial_description/initial_institution) don't crash (wb.set_value()
     already tolerates None), but were written with NO log call in either
     branch, so a genuinely missing value never reached ACTIONS_TO_SIGN.md.

Drives fill_conventional.py end to end against a real committed SANRAL
sample (templates/samples/R.334-030-2025.1F_ran.xlsm) and the repo's own
real sample pack (packs/r334-030-2025-1f.yaml), modified in-memory (never
written back to the committed file) to null out one field at a time - the
same fixture test_fill_person_registration_provenance.py already drives
for the sibling ecsa/sacpcmp fix. fill_tender.py's identical fix is covered
by direct code inspection only (no RRM-family sample workbook is committed
to this repo - same limitation test_fill_b7_legacy_precedence.py's own
docstring already states for that file).

Run: python3 engine/test_fill_person_qualification_provenance.py
"""
import os
import sys
import tempfile

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import fill_conventional  # noqa: E402
from provenance import ProvenanceLog  # noqa: E402

TECH = os.path.join(REPO, "templates", "samples", "R.334-030-2025.1F_ran.xlsm")
BASE_PACK = os.path.join(REPO, "packs", "r334-030-2025-1f.yaml")

fails = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        fails.append(name)


def _run(mutate=None):
    base = yaml.safe_load(open(BASE_PACK))
    if mutate:
        mutate(base["people"]["henning"]["qualifications"])
    work = tempfile.mkdtemp(prefix="fill_person_qual_provenance_test_")
    pack_path = os.path.join(work, "pack.yaml")
    yaml.safe_dump(base, open(pack_path, "w"))
    out = os.path.join(work, "out.xlsm")
    log = ProvenanceLog(source="test")
    fill_conventional.main(TECH, pack_path, out, log)
    return log.entries


def _entries(entries, suffix):
    return [e for e in entries if e["field_key"].endswith(f".{suffix}")]


def test_a_missing_highest_graduated_no_longer_crashes_the_whole_pack_job():
    print("fill_conventional: no highest-qualification graduation date on file no longer "
          "crashes with AttributeError 'NoneType' object has no attribute 'year'")
    try:
        entries = _run(lambda q: q.__setitem__("highest_graduated", None))
        crashed = False
    except AttributeError as e:
        crashed = True
        entries = []
    check("does not crash", not crashed)
    es = _entries(entries, "highest_graduated")
    check("logged missing instead, with a real reason naming the person", len(es) >= 1
          and all(e["status"] == "missing" and e["reason"] and "Henning" in e["reason"] for e in es), es)


def test_highest_graduated_on_file_is_confirmed():
    print("fill_conventional: a key person's own highest-qualification graduation date, on file, is logged confirmed")
    es = _entries(_run(), "highest_graduated")
    check("at least one confirmed entry with the real date", len(es) >= 1
          and all(e["status"] == "confirmed" and e["value"] == "2015-01-01" for e in es), es)


def test_highest_description_absent_is_logged_missing_not_silently_dropped():
    print("fill_conventional: no highest qualification description on file - logged missing, not silently absent")
    es = _entries(_run(lambda q: q.__setitem__("highest_description", None)), "highest_description")
    check("at least one missing entry with a real reason naming the person", len(es) >= 1
          and all(e["status"] == "missing" and e["reason"] and "Henning" in e["reason"] for e in es), es)


def test_highest_institution_absent_is_logged_missing_not_silently_dropped():
    print("fill_conventional: no highest qualification institution on file - logged missing, not silently absent")
    es = _entries(_run(lambda q: q.__setitem__("highest_institution", None)), "highest_institution")
    check("at least one missing entry with a real reason naming the person", len(es) >= 1
          and all(e["status"] == "missing" and e["reason"] and "Henning" in e["reason"] for e in es), es)


def test_initial_description_absent_is_logged_missing_not_silently_dropped():
    print("fill_conventional: no initial qualification description on file - logged missing, not silently absent")
    es = _entries(_run(lambda q: q.__setitem__("initial_description", None)), "initial_description")
    check("at least one missing entry with a real reason naming the person", len(es) >= 1
          and all(e["status"] == "missing" and e["reason"] and "Henning" in e["reason"] for e in es), es)


def test_initial_institution_absent_is_logged_missing_not_silently_dropped():
    print("fill_conventional: no initial qualification institution on file - logged missing, not silently absent")
    es = _entries(_run(lambda q: q.__setitem__("initial_institution", None)), "initial_institution")
    check("at least one missing entry with a real reason naming the person", len(es) >= 1
          and all(e["status"] == "missing" and e["reason"] and "Henning" in e["reason"] for e in es), es)


def test_four_text_fields_on_file_are_all_confirmed():
    print("fill_conventional: all four text qualification fields, on file, are logged confirmed with the real values")
    entries = _run()
    check("highest_description confirmed with real value",
          any(e["field_key"].endswith(".highest_description") and e["status"] == "confirmed"
              and e["value"] == "MEng (Civil Engineering)" for e in entries), entries)
    check("highest_institution confirmed with real value",
          any(e["field_key"].endswith(".highest_institution") and e["status"] == "confirmed"
              and e["value"] == "Univ of Stellenbosch" for e in entries), entries)
    check("initial_description confirmed with real value",
          any(e["field_key"].endswith(".initial_description") and e["status"] == "confirmed"
              and e["value"] == "BEng (Civil Engineering)" for e in entries), entries)
    check("initial_institution confirmed with real value",
          any(e["field_key"].endswith(".initial_institution") and e["status"] == "confirmed"
              and e["value"] == "Univ of Pretoria" for e in entries), entries)


def test_both_key_person_blocks_are_logged():
    print("fill_conventional: both key-person blocks (PL and DS1, same person per this sample pack) are logged")
    entries = _run()
    check("exactly 2 highest_graduated entries, one per Form B1/B2 block filled",
          len(_entries(entries, "highest_graduated")) == 2, entries)


def main():
    test_a_missing_highest_graduated_no_longer_crashes_the_whole_pack_job()
    test_highest_graduated_on_file_is_confirmed()
    test_highest_description_absent_is_logged_missing_not_silently_dropped()
    test_highest_institution_absent_is_logged_missing_not_silently_dropped()
    test_initial_description_absent_is_logged_missing_not_silently_dropped()
    test_initial_institution_absent_is_logged_missing_not_silently_dropped()
    test_four_text_fields_on_file_are_all_confirmed()
    test_both_key_person_blocks_are_logged()
    print(f"\n{len(fails)} failure(s)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
