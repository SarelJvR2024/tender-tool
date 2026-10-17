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

--pack (added 2026-10-16) also runs the full submission-pack chain for each
test company - suggest/confirm -> fill_conventional/fill_tender ->
print_reports -> fill_financial -> run_forms_pipeline -> letter + covers ->
generate_cv.py -> one merged PDF (engine/pack/assemble_pack.py) - reads the
PDF back (page count, page-number stamps, contents page, bookmarks) and
compares the pack's shape (ordered sections + page counts, what was left out)
against its own baseline in state/admin_harness_pack_baselines/. Opt-in
because it needs LibreOffice and takes about a minute per run; by default it
covers one tender (--pack-tenders all for every tender on file).

Usage: python3 admin_harness.py [--store DIR] [--reset] [--pack] [--pack-tenders SLUG,...|all]
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
DEFAULT_PACK_STORE = os.path.join(HERE, "..", "state", "admin_harness_pack_baselines")
DEFAULT_PACK_TENDERS = ["R.396-010-2025.1F"]
PACK_RUN_OUT_DIR = "/tmp/admin_harness_pack_runs"
RUN_OUT_DIR = "/tmp/admin_harness_runs"


SAMPLES_DIR = os.path.join(HERE, "..", "templates", "samples")


def harness_pack(test_profile_path, slug, out_dir):
    """A minimal confirmed pack.yaml for the forms run: the test company's
    first key person confirmed on every position the tender's own SETUP sheet
    lists (templates/samples/<slug>_ran.xlsm) - the same assignment the --pack
    run makes for these one-person test companies. C.1.2.3's key-person table
    is filled from the confirmed pack (fill_docx_forms.key_persons_by_row), so
    without one the harness would no longer exercise that path. None when the
    sample workbook isn't on hand."""
    import yaml
    sys.path.insert(0, os.path.join(HERE, "pack_generator"))
    from sanral_fill import Workbook
    from suggest_pack import read_required_positions
    xlsm = os.path.join(SAMPLES_DIR, f"{slug}_ran.xlsm")
    if not os.path.exists(xlsm):
        return None
    profile = json.load(open(test_profile_path))
    person = dict(profile["key_people"][0])
    primary, _ = read_required_positions(Workbook(xlsm))
    path = os.path.join(out_dir, "harness_pack.yaml")
    yaml.safe_dump({"people": {"person_0": person},
                    "key_persons": [{"position": p["code"], "person": "person_0"} for p in primary]},
                   open(path, "w"), sort_keys=False)
    return path


def run_one(test_profile_path, tender_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    slug = os.path.basename(tender_dir.rstrip("/"))
    docx_log = fill_docx_forms.main(tender_dir, test_profile_path, out_dir, None,
                                    harness_pack(test_profile_path, slug, out_dir))
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


def compare_to_baseline(store_dir, run_key, sig):
    """Shared first-seen / match / flag rule. Returns ("clean"|"flagged", message)."""
    baseline_path = f"{store_dir}/{run_key}.json"
    if not os.path.exists(baseline_path):
        json.dump(sig, open(baseline_path, "w"), indent=2)
        return "clean", "first run, baseline stored"
    baseline = json.load(open(baseline_path))
    if baseline == sig:
        return "clean", "matches baseline"
    changes = []
    for k in sorted(set(baseline) | set(sig)):
        old, new = baseline.get(k), sig.get(k)
        if old == new:
            continue
        if isinstance(old, list) and isinstance(new, list):
            added, removed = [x for x in new if x not in old], [x for x in old if x not in new]
            changes.append(f"{k}: +{added} -{removed}" if (added or removed) else f"{k}: order changed")
        else:
            changes.append(f"{k}: {old} -> {new}")
    return "flagged", "; ".join(changes)


def run_pack_checks(test_profiles, store_dir=DEFAULT_PACK_STORE, tenders=None, reset=False):
    """--pack: the whole submission-pack chain per (test company, tender) - see
    module docstring and engine/pack/harness_pack.py."""
    sys.path.insert(0, os.path.join(HERE, "pack"))
    import harness_pack
    if reset and os.path.exists(store_dir):
        shutil.rmtree(store_dir)
    os.makedirs(store_dir, exist_ok=True)
    flagged, clean, failed = [], [], []
    for profile_path in test_profiles:
        company_name = os.path.basename(profile_path).replace(".json", "")
        for slug in tenders or DEFAULT_PACK_TENDERS:
            run_key = f"{company_name}__{slug}"
            try:
                result = harness_pack.run_pack_one(profile_path, slug, f"{PACK_RUN_OUT_DIR}/{run_key}")
            except Exception as e:
                failed.append((run_key, f"{type(e).__name__}: {e}"))
                continue
            if result["outcome"] == "built" and result["problems"]:
                failed.append((run_key, "merged PDF failed read-back: " + "; ".join(result["problems"][:5])))
                continue
            sig = harness_pack.signature(result)
            status, msg = compare_to_baseline(store_dir, run_key, sig)
            detail = (f"{sig['page_count']} pages, {len(sig['sections'])} sections, {len(sig['omitted'])} not included"
                      if sig["outcome"] == "built" else f"refused at {sig['stage']}: {sig['reason'][:120]}")
            (clean if status == "clean" else flagged).append((run_key, f"{msg} - {detail}"))
    return {"clean": clean, "flagged": flagged, "failed": failed}


def main(store_dir=DEFAULT_STORE, reset=False, pack=False, pack_tenders=None):
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

    result = {"clean": clean, "flagged": flagged, "failed": failed}
    if pack:
        tenders = None
        if pack_tenders == "all":
            tenders = [os.path.basename(d) for d in tender_dirs]
        elif pack_tenders:
            tenders = pack_tenders.split(",")
        p = run_pack_checks(test_profiles, tenders=tenders, reset=reset)
        print(f"\nSubmission-pack check: {len(p['clean'])} clean, {len(p['flagged'])} flagged for review, "
              f"{len(p['failed'])} run failures\n")
        for k, msg in p["failed"]:
            print(f"  RUN FAILED  {k}: {msg}")
        for k, msg in p["flagged"]:
            print(f"  FLAGGED     {k}: {msg}")
        for k, msg in p["clean"]:
            print(f"  OK          {k}: {msg}")
        result["pack"] = p
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", default=DEFAULT_STORE)
    ap.add_argument("--reset", action="store_true", help="wipe stored baselines and start fresh")
    ap.add_argument("--pack", action="store_true", help="also run the full submission-pack chain (needs LibreOffice)")
    ap.add_argument("--pack-tenders", help=f"comma-separated tender slugs, or 'all' (default {DEFAULT_PACK_TENDERS[0]})")
    args = ap.parse_args()
    result = main(args.store, args.reset, args.pack, args.pack_tenders)
    pack = result.get("pack") or {}
    bad = result["flagged"] or result["failed"] or pack.get("flagged") or pack.get("failed")
    sys.exit(1 if bad else 0)
