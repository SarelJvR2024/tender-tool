"""
Regression test for fill_tender.py's and fill_conventional.py's own
fill_person() - the Form B1/B2 key-person-block writer - never threading the
ProvenanceLog `log` parameter either function already accepts (and already
passes into fill_company_front()) down into fill_person() itself.

Finding 376 (2026-11-11, standing solution-architect review): every OTHER
optional field this pipeline writes (sanral_fill.fill_company_front()'s own
bee_level/black_ownership_pct, the already-fixed SARS TCS PIN in
fill_a_forms.py Finding 368, the VAT number in fill_sbd_docx.py Finding 371)
logs either `confirmed` or `missing` through ProvenanceLog, so a genuinely
absent value still reaches ACTIONS_TO_SIGN.md for a human to fill in by hand
before signing. fill_person()'s own ecsa_number/ecsa_date/sacpcmp_number/
sacpcmp_date - conditionally written exactly like every one of those sibling
fields (`if q.get(...): wb.set_value(...)`) - had NO log call in either
branch: a key person with no SACPCMP (or ECSA) registration number/date on
file got a silently blank Form B1/B2 cell, with zero trace in
field_provenance.json and no flag on the real checklist.

Drives fill_conventional.py end to end against a real committed SANRAL
sample (templates/samples/R.334-030-2025.1F_ran.xlsm) and the repo's own
real sample pack (packs/r334-030-2025-1f.yaml - Klipcorp/Henning Jansen van
Rensburg, used for both key positions), the same fixture
test_fill_b7_legacy_precedence.py already drives this file against. That
sample's own "henning" person has ecsa_number/ecsa_date on file but no
sacpcmp_number/sacpcmp_date at all - a real, already-committed instance of
exactly the gap this fix closes, not a synthetic one. fill_tender.py's
identical fix is covered by direct code inspection only (no RRM-family
sample workbook is committed to this repo - same limitation
test_fill_b7_legacy_precedence.py's own docstring already states for that
file).

Run: python3 engine/test_fill_person_registration_provenance.py
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


def _run():
    work = tempfile.mkdtemp(prefix="fill_person_provenance_test_")
    out = os.path.join(work, "out.xlsm")
    log = ProvenanceLog(source="test")
    fill_conventional.main(TECH, BASE_PACK, out, log)
    return log.entries


def _entries(entries, suffix):
    return [e for e in entries if e["field_key"].endswith(f".{suffix}")]


def test_ecsa_number_on_file_is_confirmed():
    print("fill_conventional: a key person's own ECSA registration number, on file, is logged confirmed")
    es = _entries(_run(), "ecsa_number")
    check("at least one confirmed entry with the real number", len(es) >= 1
          and all(e["status"] == "confirmed" and e["value"] == "20150155" for e in es), es)


def test_ecsa_date_on_file_is_confirmed():
    print("fill_conventional: a key person's own ECSA registration date, on file, is logged confirmed")
    es = _entries(_run(), "ecsa_date")
    check("at least one confirmed entry with the real date", len(es) >= 1
          and all(e["status"] == "confirmed" and e["value"] == "2015-05-04" for e in es), es)


def test_sacpcmp_number_absent_is_logged_missing_not_silently_dropped():
    print("fill_conventional: no SACPCMP registration number on file - logged missing, not silently absent")
    es = _entries(_run(), "sacpcmp_number")
    check("at least one missing entry with a real reason naming the person", len(es) >= 1
          and all(e["status"] == "missing" and e["reason"] and "Henning" in e["reason"] for e in es), es)


def test_sacpcmp_date_absent_is_logged_missing_not_silently_dropped():
    print("fill_conventional: no SACPCMP registration date on file - logged missing, not silently absent")
    es = _entries(_run(), "sacpcmp_date")
    check("at least one missing entry with a real reason naming the person", len(es) >= 1
          and all(e["status"] == "missing" and e["reason"] and "Henning" in e["reason"] for e in es), es)


def test_both_key_person_blocks_are_logged():
    print("fill_conventional: both key-person blocks (PL and DS1, same person per this sample pack) are logged")
    entries = _run()
    check("exactly 2 ecsa_number entries, one per Form B1/B2 block filled",
          len(_entries(entries, "ecsa_number")) == 2, entries)


def main():
    test_ecsa_number_on_file_is_confirmed()
    test_ecsa_date_on_file_is_confirmed()
    test_sacpcmp_number_absent_is_logged_missing_not_silently_dropped()
    test_sacpcmp_date_absent_is_logged_missing_not_silently_dropped()
    test_both_key_person_blocks_are_logged()
    print(f"\n{len(fails)} failure(s)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
