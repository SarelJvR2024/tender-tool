"""
Focused tests for etenders_portal.py's dedupe_rows() - no dedicated test
file existed for this module before this.

Finding (2026-10-20, forty-ninth run, docs/specs/QA-Edge-Case-Findings.md):
dedupe_rows()'s own docstring names TWO reasons a tender's id comes back as
several joined-child-record rows from the portal - "a tender cancelled
twice ... or with several awards" - but the merge logic only ever collected
the `cancelled` field across duplicates into `_cancellations`; `bidders`
(a multi-lot award's per-lot winner/amount) was left as whichever duplicate
row happened to be the FIRST one dict()'d, silently dropping every other
lot's bidder/amount - the exact shape this module's own docstring says
happens for real. This feeds store_award_outcomes.py's award/price
intelligence and tender_changes.py's "bidders list published" change event
(keyed by bidder COUNT), so a truncated list there isn't just a missing
detail - it's wrong award data.

Run: python3 engine/discovery/test_etenders_portal.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import etenders_portal as ep  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def test_multi_lot_award_keeps_every_lots_bidders():
    print("dedupe_rows: a multi-lot award (2 duplicate rows, one bidder each)")
    rows = [
        {"id": 999, "tender_No": "RFQ-001", "description": "Supply of X (Lot 1)", "status": "Awarded",
         "bidders": [{"biddersName": "Lot1 Winner CC", "amount": 100000, "isDeleted": False}]},
        {"id": 999, "tender_No": "RFQ-001", "description": "Supply of X (Lot 2)", "status": "Awarded",
         "bidders": [{"biddersName": "Lot2 Winner (Pty) Ltd", "amount": 250000, "isDeleted": False}]},
    ]
    deduped = ep.dedupe_rows(rows)
    check("exactly one row survives for the shared id", len(deduped) == 1, deduped)
    names = sorted(b["biddersName"] for b in deduped[0]["bidders"])
    check("both lots' bidders survive, not just the first row's",
          names == ["Lot1 Winner CC", "Lot2 Winner (Pty) Ltd"], deduped[0].get("bidders"))
    rel = ep.normalize(deduped[0], "awarded")
    rel_names = sorted(b["name"] for b in rel.get("bidders") or [])
    check("normalize() carries both lots through to the release", rel_names == ["Lot1 Winner CC", "Lot2 Winner (Pty) Ltd"],
          rel.get("bidders"))


def test_single_row_tender_unaffected():
    print("dedupe_rows: an ordinary tender with no duplicate rows")
    rows = [{"id": 1, "tender_No": "A", "bidders": [{"biddersName": "Only Bidder", "amount": 5, "isDeleted": False}]}]
    deduped = ep.dedupe_rows(rows)
    check("the single row's own bidders are unchanged", deduped[0]["bidders"] == rows[0]["bidders"], deduped)


def test_cancellation_merge_still_works():
    print("dedupe_rows: a tender cancelled twice (the module's own worked example)")
    rows = [
        {"id": 2, "cancelled": {"reason": "Error by publisher", "dateModified": "2026-10-10T00:00:00Z"}},
        {"id": 2, "cancelled": {"reason": "Duplicate", "dateModified": "2026-10-16T00:00:00Z"}},
    ]
    deduped = ep.dedupe_rows(rows)
    check("both cancellation records are kept, newest first",
          [c["reason"] for c in deduped[0]["_cancellations"]] == ["Duplicate", "Error by publisher"], deduped)
    check("a cancellation-only row has an empty (not missing) bidders list", deduped[0]["bidders"] == [], deduped)


def test_duplicate_bidder_entries_are_not_doubled():
    print("dedupe_rows: the SAME bidder entry repeated on two duplicate rows unchanged")
    rows = [
        {"id": 3, "bidders": [{"biddersName": "Same Co", "amount": 10, "isDeleted": False}]},
        {"id": 3, "bidders": [{"biddersName": "Same Co", "amount": 10, "isDeleted": False}]},
    ]
    deduped = ep.dedupe_rows(rows)
    check("an identical bidder entry repeated across rows is kept once, not duplicated",
          deduped[0]["bidders"] == [{"biddersName": "Same Co", "amount": 10, "isDeleted": False}], deduped)


def main():
    test_multi_lot_award_keeps_every_lots_bidders()
    test_single_row_tender_unaffected()
    test_cancellation_merge_still_works()
    test_duplicate_bidder_entries_are_not_doubled()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
