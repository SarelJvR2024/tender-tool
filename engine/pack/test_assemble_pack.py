"""
check_template() (engine/pack/assemble_pack.py) had no dedicated test at all
before this pass - confirmed by a repo-wide search before writing this. It
is build_submission_pack()'s own STEP 1 - the real SANRAL pack build calls
it before anything else, for every company.

QA Finding, 2026-10-29: a corrupted/truncated fingerprint baseline file (a
bad merge, an interrupted regeneration - the exact kind of file PR #170's
own fingerprint regeneration writes) used to raise a raw JSONDecodeError
straight out of check_template(), instead of the clean ValueError every
OTHER refusal here already raises ("template family not fillable",
"fingerprint MISMATCH"). That distinction isn't cosmetic:
process_pack_jobs.py's own exception handler treats a ValueError as a
clean, actionable refusal ("warning" severity) but anything else as a
genuine worker crash ("error" severity) - so the raw exception didn't just
look worse in the log, it misclassified a known, recoverable condition as a
crash. Same bug class, and the same fix, as
engine/intake/classify_tender.py's check_fingerprint() (Finding 97) - a
separate, independent occurrence of it in the pack-assembly path.

Run: python3 engine/pack/test_assemble_pack.py
"""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
import assemble_pack as ap  # noqa: E402

TECH_WORKBOOK = os.path.join(HERE, "..", "..", "templates", "samples", "R.334-030-2025.1F_ran.xlsm")

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def test_check_template_no_baseline_match_mismatch_and_corrupted_baseline():
    print("check_template(): no stored baseline yet, a real match, a real mismatch, "
          "and a corrupted baseline file on disk")
    store = tempfile.mkdtemp(prefix="assemble_fp_store_")
    try:
        real_fp = ap.fingerprint.build_fingerprint(TECH_WORKBOOK)
        family = real_fp["family"]
        baseline_path = os.path.join(store, family.replace(" ", "_") + ".json")

        fam, warnings = ap.check_template(TECH_WORKBOOK, store)
        check("no stored baseline at all is reported as a warning, not a guessed match",
              fam == family and any("No stored fingerprint baseline" in w for w in warnings), warnings)

        with open(baseline_path, "w") as f:
            json.dump(real_fp, f)
        fam, warnings = ap.check_template(TECH_WORKBOOK, store)
        check("the real workbook's own fingerprint matches its own freshly-written baseline, no warning",
              fam == family and warnings == [], warnings)

        tampered = dict(real_fp, sheet_names=list(real_fp["sheet_names"]) + ["A Brand New Sheet"])
        with open(baseline_path, "w") as f:
            json.dump(tampered, f)
        try:
            ap.check_template(TECH_WORKBOOK, store)
            check("a genuinely different stored baseline raises (blocks the pack build)", False)
        except ValueError as e:
            check("a genuinely different stored baseline raises a clean ValueError naming the mismatch",
                  "MISMATCH" in str(e), str(e))

        # The finding: a corrupted baseline file must raise the SAME clean
        # ValueError shape as the mismatch case above, not a raw JSONDecodeError.
        with open(baseline_path, "w") as f:
            f.write("{not valid json at all!!")
        try:
            ap.check_template(TECH_WORKBOOK, store)
            check("a corrupted baseline file raises (blocks the pack build, doesn't silently pass)", False)
        except Exception as e:
            # json.JSONDecodeError is itself a ValueError subclass, so an
            # isinstance(e, ValueError) check alone can't tell the fix from
            # the bug - the real signal is the message: the fix's own clean,
            # actionable wording (names the family, gives next steps) versus
            # the raw "Expecting property name..." internal parser detail
            # the unfixed code raised instead.
            check("a corrupted baseline file is reported with this function's own clean, actionable wording, "
                  "not the raw JSON parser detail", "Could not read the stored" in str(e), str(e))
            check("...and names the real family, not a generic message", family in str(e), str(e))
    finally:
        shutil.rmtree(store, ignore_errors=True)


def test_check_template_refuses_an_unfillable_family():
    print("check_template(): a template whose sheet set matches neither Conventional nor RRM is refused")
    # Any real workbook whose sheets don't match FILLERS's own family set -
    # the second of check_template()'s two ValueError-raising guards, kept
    # as a control alongside the corrupted-baseline case above (confirms
    # this guard's own message still names the real, offending family).
    real = ap.fingerprint.build_fingerprint(TECH_WORKBOOK)
    original_build = ap.fingerprint.build_fingerprint
    ap.fingerprint.build_fingerprint = lambda path: dict(real, family="Some Unknown Family")
    try:
        ap.check_template(TECH_WORKBOOK)
        check("an unfillable family raises (blocks the pack build)", False)
    except ValueError as e:
        check("an unfillable family raises a clean ValueError naming it", "Some Unknown Family" in str(e), str(e))
    finally:
        ap.fingerprint.build_fingerprint = original_build


def main():
    test_check_template_no_baseline_match_mismatch_and_corrupted_baseline()
    test_check_template_refuses_an_unfillable_family()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
