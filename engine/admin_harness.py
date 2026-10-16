"""
Spec item 30: runs every known tender's templates against several test
companies at different data-completeness levels (config/test_companies/),
so breakage is caught before a real customer's data goes near a template.

Mirrors fingerprint.py's own first-seen/mismatch pattern deliberately, not
by coincidence: the first clean run for a (test company, tender)
combination becomes a stored baseline (state/admin_harness_baselines/);
every later run is compared against it and FLAGGED - not silently accepted -
when the shape of the result changes. A changed shape means one of:
  - SANRAL changed the template (same thing fingerprint.py's own MISMATCH
    check would catch earlier in the pipeline, at the workbook level - this
    catches it again at the docx/A-Forms level, which fingerprint.py
    doesn't cover).
  - This repo's own filler scripts changed behaviour (a bug, or a deliberate
    change that should be reviewed before trusting it on a real tender).
This script does not render anything for a human to look at - that's item
31's review console. It produces the flagged/clean list that console reads.

Usage: python3 admin_harness.py [--store DIR] [--reset]
"""
import os
import sys
import json
import glob
import shutil
import argparse
import fill_docx_forms
import fill_a_forms
from provenance import merge_and_save, load

HERE = os.path.dirname(os.path.abspath(__file__))
TEST_COMPANY_DIR = os.path.join(HERE, "..", "config", "test_companies")
TEMPLATES_DIR = os.path.join(HERE, "..", "templates", "forms")
DEFAULT_STORE = os.path.join(HERE, "..", "state", "admin_harness_baselines")
RUN_OUT_DIR = "/tmp/admin_harness_runs"


def run_one(test_profile_path, tender_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    slug = os.path.basename(tender_dir.rstrip("/"))
    docx_log = fill_docx_forms.main(tender_dir, test_profile_path, out_dir)
    _, a_forms_log = fill_a_forms.main(f"{tender_dir}/A_Forms.docx", test_profile_path, out_dir, slug, "")
    merged_path = f"{out_dir}/field_provenance.json"
    merge_and_save(merged_path, docx_log, a_forms_log)
    return load(merged_path)


def summarize(entries):
    counts = {}
    for e in entries:
        counts[e["status"]] = counts.get(e["status"], 0) + 1
    # A stable signature: which field_keys landed in each status, sorted. This is
    # what actually gets compared run-to-run - counts alone could stay the same
    # while a DIFFERENT field silently became missing, which would be exactly
    # the kind of regression this harness exists to catch.
    sig = {status: sorted(e["field_key"] for e in entries if e["status"] == status)
           for status in ("confirmed", "assumed_default", "missing")}
    return counts, sig


def main(store_dir=DEFAULT_STORE, reset=False):
    if reset and os.path.exists(store_dir):
        shutil.rmtree(store_dir)
    os.makedirs(store_dir, exist_ok=True)

    test_profiles = sorted(glob.glob(f"{TEST_COMPANY_DIR}/*.json"))
    tender_dirs = sorted(d for d in glob.glob(f"{TEMPLATES_DIR}/*") if os.path.isdir(d))
    if not test_profiles:
        print(f"No test company profiles found in {TEST_COMPANY_DIR}")
        sys.exit(1)

    flagged, clean, failed = [], [], []
    for profile_path in test_profiles:
        company_name = os.path.basename(profile_path).replace(".json", "")
        for tender_dir in tender_dirs:
            slug = os.path.basename(tender_dir.rstrip("/"))
            if not os.path.exists(f"{tender_dir}/A_Forms.docx"):
                continue  # this tender's templates aren't on file yet (e.g. R.396-010) - nothing to run
            run_key = f"{company_name}__{slug}"
            out_dir = f"{RUN_OUT_DIR}/{run_key}"
            try:
                entries = run_one(profile_path, tender_dir, out_dir)
            except Exception as e:
                failed.append((run_key, f"{type(e).__name__}: {e}"))
                continue

            counts, sig = summarize(entries)
            baseline_path = f"{store_dir}/{run_key}.json"
            if not os.path.exists(baseline_path):
                json.dump({"counts": counts, "sig": sig}, open(baseline_path, "w"), indent=2)
                clean.append((run_key, f"first run, baseline stored - {counts}"))
                continue

            baseline = json.load(open(baseline_path))
            if baseline["sig"] != sig:
                changed_fields = []
                for status in ("confirmed", "assumed_default", "missing"):
                    added = set(sig[status]) - set(baseline["sig"].get(status, []))
                    removed = set(baseline["sig"].get(status, [])) - set(sig[status])
                    if added:
                        changed_fields.append(f"now {status}: {sorted(added)}")
                    if removed:
                        changed_fields.append(f"no longer {status}: {sorted(removed)}")
                flagged.append((run_key, "; ".join(changed_fields)))
            else:
                clean.append((run_key, f"matches baseline - {counts}"))

    print(f"\nAdmin harness: {len(clean)} clean, {len(flagged)} flagged for review, {len(failed)} run failures\n")
    for k, msg in failed:
        print(f"  RUN FAILED  {k}: {msg}")
    for k, msg in flagged:
        print(f"  FLAGGED     {k}: {msg}")
    for k, msg in clean:
        print(f"  OK          {k}: {msg}")

    return {"clean": clean, "flagged": flagged, "failed": failed}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", default=DEFAULT_STORE)
    ap.add_argument("--reset", action="store_true", help="wipe stored baselines and start fresh")
    args = ap.parse_args()
    result = main(args.store, args.reset)
    sys.exit(1 if (result["flagged"] or result["failed"]) else 0)
