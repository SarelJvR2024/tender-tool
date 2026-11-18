"""
Offline tests for general_harness.py - Finding 491: a typo'd --only sample
name used to silently filter the harness's own sample list down to [], so
main() fell straight through to "0 clean, 0 flagged, 0 failed" with exit
code 0 - a misleadingly-green, zero-coverage run, indistinguishable from a
real clean sweep. unknown_only_names() is the pure check that now catches
this before any real work starts; the second part below runs the real CLI
end to end (no mocking) against this repo's own real
templates/general_samples/ directory, proving the real exit code and
message, not just the extracted helper.

Run: python3 engine/general/test_general_harness.py
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import general_harness as gh  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


# --- unknown_only_names(): the pure check, no real samples needed ----------

check("no --only at all: nothing to report", gh.unknown_only_names(["a", "b"], []) == [])
check("every --only name is real: nothing to report", gh.unknown_only_names(["a", "b"], ["b"]) == [])
check("the real bug's shape: a typo'd name is reported, not silently dropped",
      gh.unknown_only_names(["salb_15-10-2026", "dawid_kruiper_tn051"], ["slab_15-10-2026"]) == ["slab_15-10-2026"])
check("a mix of one real and one typo'd name reports only the typo",
      gh.unknown_only_names(["a", "b"], ["a", "c"]) == ["c"])
check("multiple typos are all reported, in the order given",
      gh.unknown_only_names(["a"], ["x", "y"]) == ["x", "y"])

# --- the real CLI, end to end, against this repo's own real samples -------

real_samples = sorted(d for d in os.listdir(gh.SAMPLES) if os.path.isdir(os.path.join(gh.SAMPLES, d)))
check("sanity: this repo's own real sample corpus is non-empty (otherwise this test proves nothing)",
      len(real_samples) > 0, real_samples)

store = tempfile.mkdtemp(prefix="tt_general_harness_test_")
result = subprocess.run(
    [sys.executable, os.path.join(HERE, "general_harness.py"), "--no-pack", "--only", "this_sample_does_not_exist",
     "--store", store],
    capture_output=True, text=True,
)
check("the real bug, fixed: a typo'd --only name now exits non-zero, not a silent green 0/0/0",
      result.returncode == 1, result.returncode)
check("the real bug, fixed: the real CLI prints a loud ERROR naming the unknown sample",
      "ERROR" in result.stdout and "this_sample_does_not_exist" in result.stdout, result.stdout)
check("the real CLI never reaches '0 clean, 0 flagged, 0 failed' for this input",
      "0 clean, 0 flagged, 0 failed" not in result.stdout, result.stdout)

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
