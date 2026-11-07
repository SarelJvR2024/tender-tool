"""
Regression test for confirm_pack.py - the one gate between an AI-suggested
pack and the real fill engine (nothing reaches fill_conventional.py/
fill_tender.py without a named human confirmation). No templates, no
LibreOffice, no network: pure JSON/YAML fixtures through confirm().

Run: python3 engine/pack_generator/test_confirm_pack.py
"""
import json
import os
import sys
import tempfile

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import confirm_pack  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def person(initial_graduated):
    return {"name": "Test Person", "id_number": "0101015000081", "qualifications":
            {"initial_graduated": initial_graduated}, "projects": []}


def run(initial_graduated, closing_date="2026-12-01"):
    """Builds a minimal, otherwise-valid confirm() input with one position
    ('PL') assigned to one person whose initial_graduated is the value under
    test. Returns (ok, error)."""
    with tempfile.TemporaryDirectory() as d:
        sugg = {"contract_no": "TEST-001", "closing_date": closing_date}
        sel = {"confirmed_by": "test", "confirmed_date": "2026-11-07",
               "selections": {"PL": {"confirmed_person": "person_0"}}}
        profile = {"company": {"legal_name": "Test Co", "bee_level": None, "black_ownership_pct": None,
                               "status": None}, "key_people": [person(initial_graduated)]}
        sugg_path = os.path.join(d, "sugg.json")
        sel_path = os.path.join(d, "sel.yaml")
        prof_path = os.path.join(d, "prof.json")
        out_path = os.path.join(d, "pack.yaml")
        json.dump(sugg, open(sugg_path, "w"))
        yaml.safe_dump(sel, open(sel_path, "w"))
        json.dump(profile, open(prof_path, "w"))
        try:
            confirm_pack.confirm(sugg_path, sel_path, prof_path, out_path)
            return True, None
        except Exception as e:
            return False, e


def check_malformed_initial_graduated_never_crashes_uncaught():
    print("confirm(): a malformed initial_graduated always raises a clean ValueError, never an uncaught TypeError")
    # Finding 155 (2026-11-07): a non-string initial_graduated (a number,
    # bool, or a list/dict - reachable via a hand-edited profile.json fed to
    # this script's own documented CLI usage) raised an uncaught TypeError
    # from datetime.date.fromisoformat(), not the ValueError this function's
    # own "no initial_graduated"/"not a valid date" paths already raise -
    # the identical gap years_experience_at() was fixed for (Finding 138,
    # 2026-11-06), never swept into this sibling file. process_pack_jobs.py's
    # own real caller treats a ValueError as this gate refusing on purpose
    # (a "warning") and anything else as a crash (an "error") - so this
    # wasn't just a worse message, it wrongly escalated a routine bad-data
    # refusal into what looks like a real bug.
    for bad in (20150305, True, False, ["2015-03-05"], {"y": 2015}, 3.14):
        ok, err = run(bad)
        check(f"initial_graduated={bad!r} is refused, not a crash", not ok and isinstance(err, ValueError), err)
        if not ok:
            check(f"initial_graduated={bad!r}: the error names the field, not a raw Python type error",
                  "initial_graduated" in str(err) and "fromisoformat" not in str(err), str(err))

    # Unaffected cases: still correct after the fix.
    ok, err = run("2015-03-05")
    check("a genuinely valid date still works", ok, err)
    ok, err = run("not-a-date")
    check("an unparsable STRING is still refused with the same ValueError as before",
          not ok and isinstance(err, ValueError) and "not a valid" in str(err), err)
    ok, err = run(None)
    check("a missing initial_graduated is still refused with the dedicated 'no date on file' message",
          not ok and isinstance(err, ValueError) and "no initial_graduated date on file" in str(err), err)
    ok, err = run("2030-01-01")  # well after the 2026-12-01 closing date used by run() (a 1-month gap rounds to 0, not negative)
    check("a future-dated (after closing) initial_graduated is still refused as negative experience",
          not ok and isinstance(err, ValueError) and "would be negative" in str(err), err)


def main():
    check_malformed_initial_graduated_never_crashes_uncaught()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
