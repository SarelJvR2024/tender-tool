"""
Bridge for spec item 31 (admin review console): runs admin_harness.py's existing
logic and upserts one row per (test_company, tender_ref) into the web app's
admin_harness_runs table (app/supabase/migrations/0005_admin_harness_results.sql,
renamed by 0006_rename_dummy_to_test_company.sql), so Sarel can see harness
results at /admin instead of only in a terminal.

Deliberately imports and calls admin_harness.main() directly rather than shelling
out to it - its main() is already a plain function that returns a clean
{"clean": [...], "flagged": [...], "failed": [...]} structure (each entry a
(run_key, message) tuple, run_key = "<test_company>__<tender_slug>"), so no
refactoring of admin_harness.py was needed to reuse it.

The per-run (counts, sig) summary that admin_harness.py computes is read back
from its own baseline JSON files (state/admin_harness_baselines/<run_key>.json) -
the one place that shape is already persisted - rather than recomputing it here.

Connection pattern (urllib + REST upsert via Prefer: resolution=merge-duplicates)
copied from engine/seed_supabase_company.py. Requires the same env vars:
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Usage: python3 write_admin_harness_results.py [--reset]
"""
import os
import sys
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

import admin_harness

HERE = os.path.dirname(os.path.abspath(__file__))


def supabase_request(url, service_key, method, path, body=None):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} failed: {e.code} {e.read().decode()}")


def run_key_parts(run_key):
    # run_key is "<test_company>__<tender_slug>" - admin_harness.py's own format.
    test_company, _, tender_ref = run_key.partition("__")
    return test_company, tender_ref


def summary_for(run_key, store_dir):
    baseline_path = os.path.join(store_dir, f"{run_key}.json")
    if os.path.exists(baseline_path):
        return json.load(open(baseline_path))
    return {}


def main():
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
              "(see app/.env.local.example) before running this.")
        sys.exit(1)

    reset = "--reset" in sys.argv
    result = admin_harness.main(reset=reset)
    store_dir = admin_harness.DEFAULT_STORE

    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for run_key, msg in result["clean"]:
        test_company, tender_ref = run_key_parts(run_key)
        rows.append({
            "test_company": test_company,
            "tender_ref": tender_ref,
            "status": "ok",
            "summary": summary_for(run_key, store_dir),
            "details": msg,
            "run_at": now,
        })
    for run_key, msg in result["flagged"]:
        test_company, tender_ref = run_key_parts(run_key)
        rows.append({
            "test_company": test_company,
            "tender_ref": tender_ref,
            "status": "flagged",
            "summary": summary_for(run_key, store_dir),
            "details": msg,
            "run_at": now,
        })
    # Run failures (exceptions, not shape mismatches) still get a visible row -
    # better Sarel sees "RUN FAILED" in the console than nothing at all.
    for run_key, msg in result["failed"]:
        test_company, tender_ref = run_key_parts(run_key)
        rows.append({
            "test_company": test_company,
            "tender_ref": tender_ref,
            "status": "flagged",
            "summary": {},
            "details": f"RUN FAILED: {msg}",
            "run_at": now,
        })

    if not rows:
        print("No harness rows to write (no test company profiles found).")
        return

    print(f"Upserting {len(rows)} admin_harness_runs rows...")
    supabase_request(url, key, "POST", "admin_harness_runs", rows)
    print("Done.")


if __name__ == "__main__":
    main()
