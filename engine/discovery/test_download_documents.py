"""
Offline check for download_documents.py's download_error_message() - no
network, no Playwright browser.

Found 2026-11-09 (discovery rotation): download_one() built its own
{"error": ...} field with `result.get("html", "no link returned")` -
that default only fires when the "html" key is ABSENT, never when it's
PRESENT with a null value ({"success": false, "html": null}, plausible
for a server-side validation failure with no HTML message body). A null
error then reached main()'s own status-line formatting
(`r.get("error", "")[:200]`) - the identical "default only on missing,
not on None" trap - which also returned None, and slicing it crashed with
a bare TypeError OUTSIDE the per-slug try/except in main()'s loop,
aborting the ENTIRE run (every other queued slug lost, not just the one
whose JSON happened to look like this) instead of being logged as one
ordinary failed download.

Usage: python3 engine/discovery/test_download_documents.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import download_documents as dd  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


# The real, documented shape: an "html" key present with a human-readable message.
check("a real html error message is kept verbatim",
      dd.download_error_message({"success": False, "html": "We detected that submission is from an invalid source"})
      == "We detected that submission is from an invalid source")

# The bug this pass fixed: "html" present but null, not absent.
check("html: null falls back to 'no link returned', not None",
      dd.download_error_message({"success": False, "html": None}) == "no link returned")

# The case the ORIGINAL .get(key, default) call was written for - key absent entirely.
check("a missing html key falls back to 'no link returned'",
      dd.download_error_message({"success": False}) == "no link returned")

# An empty string is just as useless to a human reading the log as None - same fallback.
check("an empty-string html message falls back too",
      dd.download_error_message({"success": False, "html": ""}) == "no link returned")

# Confirms the actual crash this was found through: main()'s own status-line
# slicing must never see a None error, whatever shape the real JSON takes.
for result in ({"success": False, "html": None}, {"success": False}, {"success": False, "html": ""}):
    msg = dd.download_error_message(result)
    sliceable = isinstance(msg, str)
    check(f"download_error_message({result!r}) is always a real string, never None (main()'s own [:200] slice would crash on None)",
          sliceable, msg)

print(f"\n{'ALL PASSED' if not FAILS else f'{len(FAILS)} FAILED'}")
sys.exit(1 if FAILS else 0)
