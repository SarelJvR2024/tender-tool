"""
Regression test for process_pack_jobs.pack_suggestions_positions() - real
incident, 2026-10-28 (Mzansi SANRAL pack-assembly verification).

tender_pack_assignments keeps one row per position_code for a pack's whole
lifetime (0001's unique constraint is (tender_pack_id, position_code), no
delete on re-upload), so a company that re-attaches a different/corrected
Technical workbook - fewer or differently-coded positions than an earlier
one - leaves a stale, still-confirmed row for a position the CURRENT
workbook no longer asks for. gather()'s pack_suggestions.json build used to
iterate by_code.items() (every assignment ever made for the pack) instead of
`required` (what THIS workbook's own SETUP sheet currently asks for);
index_of/people are built from `required` alone, so the stale row's
confirmed_person_id was never in either and the build crashed with a
KeyError - exactly what happened live: a leftover "RE" assignment from an
earlier seed, the freshly-uploaded workbook asking only for PL/DS1.

Run: python3 engine/pack/test_pack_suggestions.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import process_pack_jobs as ppj  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


REQUIRED = [{"code": "PL", "description": "Project Leader"}, {"code": "DS1", "description": "Design Specialist 1"}]
# by_code carries a STALE "RE" row (confirmed on an earlier workbook version)
# that this tender's current SETUP sheet (REQUIRED, above) no longer asks for.
BY_CODE = {
    "PL": {"confirmed_person_id": "p-pl", "specialism_warning": False},
    "DS1": {"confirmed_person_id": "p-ds1", "specialism_warning": True},
    "RE": {"confirmed_person_id": "p-re-stale", "specialism_warning": False},
}
PEOPLE = {"p-pl": {"name": "Lindiwe Dlamini"}, "p-ds1": {"name": "Naledi Khumalo"}}
INDEX_OF = {"p-pl": 0, "p-ds1": 1}  # built from REQUIRED alone, same as the real gather() - no "p-re-stale" entry

try:
    out = ppj.pack_suggestions_positions(REQUIRED, BY_CODE, PEOPLE, INDEX_OF)
    check("a stale assignment for a position the current workbook doesn't require never raises", True)
except KeyError as e:
    check("a stale assignment for a position the current workbook doesn't require never raises", False, repr(e))
    out = {}

check("only the current workbook's own positions appear", set(out) == {"PL", "DS1"}, set(out))
check("PL's real confirmed candidate is kept", out.get("PL", {}).get("candidates", [{}])[0].get("name") == "Lindiwe Dlamini")
check("DS1's real confirmed candidate is kept", out.get("DS1", {}).get("candidates", [{}])[0].get("name") == "Naledi Khumalo")
check("DS1's specialism warning is carried through", out.get("DS1", {}).get("candidates", [{}])[0].get("specialism_warning") is True)

# An unconfirmed required position is omitted (confirm_pack.py's own gate
# already stops an unconfirmed one earlier in gather() - this just shouldn't
# crash if it's ever reached with one still unconfirmed).
required_with_unconfirmed = REQUIRED + [{"code": "RE2", "description": "Resident Engineer 2"}]
by_code_with_unconfirmed = dict(BY_CODE, RE2={"confirmed_person_id": None})
out2 = ppj.pack_suggestions_positions(required_with_unconfirmed, by_code_with_unconfirmed, PEOPLE, INDEX_OF)
check("a required position with no confirmed_person_id yet is omitted, not crashed on", "RE2" not in out2, out2)

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
