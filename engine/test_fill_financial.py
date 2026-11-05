"""
Regression test for fill_financial.py - this module had NO dedicated test at
all before this pass (confirmed: no test_fill_financial.py existed anywhere
in the repo, only indirect coverage of row_for_position() via
test_form_field_audit.py's test_financial_rows()).

Finding, 2026-11-05: a malformed pack.yaml (a key_persons entry referencing a
person key that doesn't exist in pack.yaml's own `people` map, a person with
no `name`, or a pack with no `company.name` at all) raised a raw KeyError
from main(), not the ValueError every OTHER data-shaped refusal in this
module already raises (e.g. "Position '...' has no row..."). This matters
because pack/assemble_pack.py's own caller specifically catches ValueError
around fill_financial.main() and degrades gracefully ("Financial workbook:
fill_financial.py refused: ...", pack build continues with the Technical
workbook, reports, envelope covers all still produced) - a KeyError bypassed
that catch entirely and crashed the WHOLE SANRAL pack build for one bad
field in one sheet, exactly the "one contained module problem takes down the
whole pack" shape this session has fixed repeatedly elsewhere (Findings 125,
128). Confirmed against the real shipped SANRAL Financial Submission
template (templates/samples/financial/R.334-030-2025.1F_Financial_
Submission_ran.xlsm), not a hand-built fixture.

Run: python3 engine/test_fill_financial.py
"""
import os
import sys
import tempfile

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import fill_financial  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


TPL = os.path.join(REPO, "templates", "samples", "financial", "R.334-030-2025.1F_Financial_Submission_ran.xlsm")
tmp = tempfile.mkdtemp(prefix="tt_ff_test_")


def _run(pack):
    pack_path = os.path.join(tmp, f"pack_{len(os.listdir(tmp))}.yaml")
    out_path = os.path.join(tmp, f"out_{len(os.listdir(tmp))}.xlsm")
    yaml.safe_dump(pack, open(pack_path, "w"), sort_keys=False)
    fill_financial.main(TPL, pack_path, out_path)
    return out_path


GOOD_PACK = {
    "company": {"name": "Riverstone Civils (Pty) Ltd"},
    "key_persons": [{"position": "PL", "person": "p1"}, {"position": "DS1", "person": "p2"}],
    "people": {"p1": {"name": "T. Nkosi"}, "p2": {"name": "A. van der Merwe"}},
}


def test_a_well_formed_pack_still_fills_correctly():
    out_path = _run(GOOD_PACK)
    check("a well-formed pack writes the output file", os.path.isfile(out_path))


# --- the bug: a malformed pack used to raise a raw KeyError, not the ------
#     ValueError assemble_pack.py's own caller specifically catches to -----
#     degrade gracefully instead of crashing the whole SANRAL pack build ---

def test_person_key_missing_from_the_people_map_is_refused_not_a_raw_keyerror():
    bad = {**GOOD_PACK, "key_persons": [{"position": "PL", "person": "ghost"}],
           "people": {"p1": {"name": "T. Nkosi"}}}
    try:
        _run(bad)
        check("a key_persons entry pointing at a person absent from the people map is refused", False,
              "main() returned with no error")
    except ValueError as e:
        check("a key_persons entry pointing at a person absent from the people map is refused", True)
        check("...and the error names the dangling person key, not a generic message", "ghost" in str(e), str(e))
    except KeyError as e:
        check("a key_persons entry pointing at a person absent from the people map is refused", False,
              f"raised a raw KeyError instead of ValueError: {e!r}")


def test_person_with_no_name_is_refused_not_a_raw_keyerror():
    bad = {**GOOD_PACK, "people": {"p1": {}, "p2": {"name": "A. van der Merwe"}}}
    try:
        _run(bad)
        check("a person with no name field is refused", False, "main() returned with no error")
    except ValueError as e:
        check("a person with no name field is refused", True)
        check("...and the error names the person, not a generic message", "p1" in str(e), str(e))
    except KeyError as e:
        check("a person with no name field is refused", False, f"raised a raw KeyError instead of ValueError: {e!r}")


def test_missing_company_name_is_refused_not_a_raw_keyerror():
    bad = {**GOOD_PACK, "company": {}}
    try:
        _run(bad)
        check("a pack with no company.name is refused", False, "main() returned with no error")
    except ValueError as e:
        check("a pack with no company.name is refused", True)
    except KeyError as e:
        check("a pack with no company.name is refused", False, f"raised a raw KeyError instead of ValueError: {e!r}")


def main():
    test_a_well_formed_pack_still_fills_correctly()
    test_person_key_missing_from_the_people_map_is_refused_not_a_raw_keyerror()
    test_person_with_no_name_is_refused_not_a_raw_keyerror()
    test_missing_company_name_is_refused_not_a_raw_keyerror()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
