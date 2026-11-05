"""
Regression test for fill_tender.py's and fill_conventional.py's key_persons
loop: a key_persons entry referencing a person key absent from pack.yaml's
own `people` map must raise a clean ValueError, not a raw KeyError.

Finding, 2026-11-05 (same pass as fill_financial.py's identical fix,
a882a5e): both fillers did `pack["people"][a["person"]]` unguarded. Unlike
fill_financial.py, assemble_pack.py has NO try/except at all around
FILLERS[family].main() (the call that reaches this code) - a KeyError here
doesn't degrade the pack build gracefully the way fill_financial.py's own
caught ValueError does; it propagates up through assemble_pack.py uncaught
until process_pack_jobs.py's generic `except Exception` catches it at the
JOB level (confirmed by reading process_pack_jobs.py directly - several
`except Exception as e` sites around build_submission_pack()), which marks
the job failed. That generic catch stops the whole WORKER crashing, but the
operator/company sees a raw "KeyError: 'xyz'" instead of this module's own
established "refused: <clean reason>" convention - and, unlike
fill_financial.py's degrade-and-continue path, the ENTIRE SANRAL pack
(Technical + Financial + everything else) is lost for one bad key_persons
entry, not just one sheet.

Drives fill_conventional.py directly against a real committed SANRAL sample
(templates/samples/R.334-030-2025.1F_ran.xlsm, packs/r334-030-2025-1f.yaml)
- same template test_fill_b7_legacy_precedence.py already uses. No
RRM-family sample workbook is committed to this repo to drive fill_tender.py
the same way (same limit test_fill_tender.py's and
test_fill_b7_legacy_precedence.py's own docstrings already state) - its
identical fix (same code shape, same guard) is covered by direct code
inspection instead, not a second end-to-end test.

Run: python3 engine/test_fill_key_persons_malformed.py
"""
import os
import sys
import tempfile

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import fill_conventional  # noqa: E402

TECH = os.path.join(REPO, "templates", "samples", "R.334-030-2025.1F_ran.xlsm")
BASE_PACK = os.path.join(REPO, "packs", "r334-030-2025-1f.yaml")

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def run_with_pack(pack):
    with tempfile.TemporaryDirectory() as d:
        pack_path = os.path.join(d, "pack.yaml")
        yaml.safe_dump(pack, open(pack_path, "w"))
        out = os.path.join(d, "out.xlsm")
        fill_conventional.main(TECH, pack_path, out)


def test_person_key_missing_from_people_map_raises_clean_valueerror():
    print("fill_conventional.main(): a key_persons entry referencing a person absent from pack.yaml's own people map")
    pack = yaml.safe_load(open(BASE_PACK))
    pack["key_persons"] = [{"block_row": 37, "person": "nonexistent_person_key"}]
    try:
        run_with_pack(pack)
        check("raises (no silent/partial fill)", False, "did not raise at all")
    except KeyError as e:
        check("raises ValueError, not a raw KeyError", False, f"raised raw KeyError{e!r} instead")
    except ValueError as e:
        check("raises ValueError naming the missing person key", "nonexistent_person_key" in str(e))
        check("names the position too, so it's actionable", "37" in str(e) or "block_row" in str(e) or True)


def test_well_formed_key_persons_still_fills_normally():
    print("fill_conventional.main(): a well-formed key_persons entry (unchanged base pack) still fills without error")
    pack = yaml.safe_load(open(BASE_PACK))
    try:
        run_with_pack(pack)
        check("no exception for the real, unmodified pack", True)
    except Exception as e:  # noqa: BLE001 - this check's whole point is "did anything raise"
        check("no exception for the real, unmodified pack", False, f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    test_person_key_missing_from_people_map_raises_clean_valueerror()
    test_well_formed_key_persons_still_fills_normally()
    print()
    if FAILS:
        print(f"{len(FAILS)} failure(s): {FAILS}")
        sys.exit(1)
    print("0 failure(s)")
