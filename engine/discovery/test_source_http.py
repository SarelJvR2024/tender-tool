"""
Offline tests for source_http.py's shared helpers that aren't already
exercised through a specific reader's own test file (e.g. iso_sast_closing()
is covered via lephalale.py/randwater.py/etc's own tests). No network.

Run: python3 engine/discovery/test_source_http.py   (exit 1 on any failure)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


# --- strip_title_artifacts(): Batch 2B Touch-ups, Sarel's own live examples ---

check("none in, none out", sh.strip_title_artifacts(None) is None)
check("empty string unchanged", sh.strip_title_artifacts("") == "")

r = sh.strip_title_artifacts("GA Mathebula / Supply and delivery of office furniture")
check("compiler-initials prefix stripped", r == "Supply and delivery of office furniture", r)

r = sh.strip_title_artifacts("Routine road maintenance contract 2026(Re-Advert)")
check("trailing (Re-Advert) stripped, no space before it", r == "Routine road maintenance contract 2026", r)

r = sh.strip_title_artifacts("Supply of fuel tankers - 2026 (RE-ADVERT)")
check("(RE-ADVERT), upper-case and hyphen-spaced, stripped", r == "Supply of fuel tankers - 2026", r)

r = sh.strip_title_artifacts("GA Mathebula / Rehabilitation of access road (Re-Advert)")
check("both artifacts in one title stripped together", r == "Rehabilitation of access road", r)

# A real tender title that happens to start with a province code + a
# Title-Case word + "/" must NOT be mistaken for a compiler's initials.
r = sh.strip_title_artifacts("KZN Roads / Bridges Maintenance Batch 3")
check("real KZN-prefixed title is not mistaken for a compiler sign-off", r == "KZN Roads / Bridges Maintenance Batch 3", r)

r = sh.strip_title_artifacts("Supply and delivery of IBR roofing sheets for the Klipfontein Dam project")
check("an ordinary title with neither artifact is unchanged", r == "Supply and delivery of IBR roofing sheets for the Klipfontein Dam project", r)

# Three initials (not the exact two-letter shape of the real example) is
# left alone - only the literal shape seen in Sarel's own example is stripped.
r = sh.strip_title_artifacts("GAM Mathebula / Supply and delivery of office furniture")
check("3-letter initials are not treated as a compiler prefix", r == "GAM Mathebula / Supply and delivery of office furniture", r)

print(f"\n{len(FAILS)} failure(s)")
if FAILS:
    sys.exit(1)
