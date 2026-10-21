"""
Unit test for daily_digest.filter_opted_in() alone - the opt-in gate added
by migration 0073 (Sarel, 2026-10-20: "yes let's make this an optional
email that the customer can decide if they want to receive it."). Pure
function, no network, no Supabase, no fixtures beyond plain dicts - the
full roster/role/company behaviour around it is covered end to end by
test_digest_live.py's own opt-in check; this file is only about the gate
itself and its edge cases.

    python3 engine/notify/test_digest_opt_in.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daily_digest  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def main():
    print("filter_opted_in(): opt-in, not opt-out")

    check(daily_digest.filter_opted_in([]) == [], "empty roster -> empty result")

    roster = [
        {"name": "Opted in", "email_opt_in": True},
        {"name": "Opted out", "email_opt_in": False},
        {"name": "Never set (missing key)"},
        {"name": "Explicit None", "email_opt_in": None},
        {"name": "Truthy but not boolean True", "email_opt_in": 1},
        {"name": "String 'true' (a config/typing mistake)", "email_opt_in": "true"},
    ]
    kept = [p["name"] for p in daily_digest.filter_opted_in(roster)]
    check(kept == ["Opted in"],
          f"only an exact email_opt_in=True entry is kept - everything else (false/missing/None/1/'true') "
          f"is treated as not opted in ({kept})")

    check(daily_digest.filter_opted_in([dict(p) for p in roster]) == [roster[0]],
          "filter_opted_in doesn't mutate or reorder - the one survivor is byte-identical to the input dict")

    # Doesn't raise on a roster entry missing other fields entirely - the
    # gate only ever looks at email_opt_in, nothing else about the row.
    check(daily_digest.filter_opted_in([{"email_opt_in": True}]) == [{"email_opt_in": True}],
          "a minimal roster entry with only email_opt_in works")

    big = [{"n": i, "email_opt_in": (i % 3 == 0)} for i in range(30)]
    check(len(daily_digest.filter_opted_in(big)) == 10,
          "scales to a larger roster: exactly the entries with email_opt_in=True survive, in order")
    check([p["n"] for p in daily_digest.filter_opted_in(big)] == [i for i in range(30) if i % 3 == 0],
          "original order is preserved")

    print(f"\n{len(FAILS)} failure(s)" + (":" if FAILS else "."))
    for f in FAILS:
        print(f"  - {f}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
