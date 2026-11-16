"""
Offline checks for run_discovery.py's own per-row helpers - no network.

  1. a normal row (slug present) has no skip reason;
  2. a row with no detail-page link (slug=None, the real shape
     list_tenders._parse_row() returns when SANRAL's markup has no <a href>
     for that row) is skipped with a real reason, not silently;
  3. changed() still reports "new" for a never-seen slug, None for an
     identical repeat, and a real diff for a changed field - unaffected by
     this fix.

Usage: python3 engine/discovery/test_run_discovery.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_discovery as rd  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


# 1. a normal row is never skipped
normal_row = {"slug": "r-343-020-2025-1f", "reference": "R.343-020-2025", "detail_url": "https://www.nra.co.za/open-tenders/r-343-020-2025-1f"}
check("normal row: no skip reason", rd.skip_reason(normal_row) is None)

# 2. a row with no parseable link is skipped, with a real reason
no_link_row = {"slug": None, "detail_url": None, "reference": "R.999-888-2026", "description": "Some tender"}
reason = rd.skip_reason(no_link_row)
check("no-link row: has a skip reason", bool(reason), reason)
check("no-link row: reason mentions the real cause", "detail-page link" in (reason or ""), reason)

# a falsy-but-present slug (empty string) is treated the same as missing
check("empty-string slug: still skipped", rd.skip_reason({"slug": "", "reference": "x"}) is not None)

# 3. changed() itself, unaffected by this fix
check("changed(): never seen before is new", rd.changed(None, {"file_size": "1 MB"}) == "new")
check("changed(): identical repeat is None",
      rd.changed({"file_size": "1 MB", "file_count": "2", "last_updated": "2026-11-01"},
                 {"file_size": "1 MB", "file_count": "2", "last_updated": "2026-11-01"}) is None)
check("changed(): a real diff is reported",
      "last_updated" in (rd.changed({"file_size": "1 MB", "file_count": "2", "last_updated": "2026-11-01"},
                                     {"file_size": "1 MB", "file_count": "2", "last_updated": "2026-11-05"}) or ""))

print(f"\n{'ALL PASSED' if not FAILS else f'{len(FAILS)} FAILED'}")
sys.exit(1 if FAILS else 0)
