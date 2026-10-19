"""
Dedicated tests for tender_changes.py's own logic, beyond what test_gov_sources.py's
test_changes() already covers (parsing real portal/Eskom/Transnet rows into releases,
first-sighting document detection, closing/briefing moves, cancellations, re-advertisements,
re-listings, bidders lists - see that file). This file exists specifically to close a gap
flagged repeatedly across several standing QA/robustness review passes (eleventh through
twenty-third runs, docs/specs/QA-Edge-Case-Findings.md): tender_changes.py had no dedicated
test file of its own.

Focus here: _event()'s dedupe_key construction - the mechanism that is supposed to make
"a re-run never records the same change twice" (the module's own docstring) without ever
silently dropping a GENUINELY new change. Finding (2026-10-19, twenty-fifth run): a
closing/briefing/title date that revisits an earlier value (extended, reverted, extended
again - three separate, real events) used to collapse the third occurrence into the
first's dedupe_key and silently drop it, because the key was built from the new value
alone with no notion of time. Fixed by bucketing the fallback key by the day the change
was detected - this still dedupes a same-day retry (the actual scenario the mechanism
exists for: two runs racing against the same stale, not-yet-persisted snapshot) without
collapsing two genuinely separate occurrences of the same value that are days or weeks
apart, which is how real tender extensions/reversions are spaced in practice.

Usage: python3 engine/discovery/test_tender_changes.py
"""
import datetime as real_datetime
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "alerts"))
import tender_changes as tc  # noqa: E402
import source_http as sh  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _release(closing_date=None, title="Road resurfacing", briefing_date=None,
             ocid="ocds-test-0001", contract_number="X.001-001-2026/1F"):
    return sh.release(
        ocid=ocid, contract_number=contract_number, title=title,
        buyer="Test Department", documents=[], source="etenders_portal", source_id="1",
        source_url="https://portal/1", status="advertised", closing_date=closing_date,
        briefing={"date": briefing_date} if briefing_date else None,
    )


class _FrozenDay(real_datetime.datetime):
    """Lets a test pin tender_changes.py's own `datetime.datetime.now(sh.SAST)` calls to
    a specific day, so a sequence of detect()/save() runs can simulate real elapsed time
    (days or weeks apart) without actually waiting."""
    _now = None

    @classmethod
    def now(cls, tz=None):
        return cls._now if tz is None else cls._now.astimezone(tz)


def _run_on(store, day, release):
    """One detect()+save() cycle for `release`, as if it happened on 2026-10-<day>."""
    return _run_at(store, day, 9, release)


def _run_at(store, day, hour, release):
    """Same as _run_on, but at a specific hour on 2026-10-<day> - lets a test place two
    runs within the same calendar day (distinct hours) or the same minute (same hour)."""
    real_dt = tc.datetime.datetime
    tc.datetime.datetime = _FrozenDay
    _FrozenDay._now = real_datetime.datetime(2026, 10, day, hour, 0, tzinfo=sh.SAST)
    try:
        snaps = store.load_snapshots([release["ocid"] or release["source"]])
        events, new_snaps = tc.detect([release], snaps)
        return store.save(new_snaps, events)
    finally:
        tc.datetime.datetime = real_dt


def test_oscillating_closing_date_every_occurrence_reported():
    print("a closing date extended, reverted, then extended again to the SAME value - "
          "every occurrence must be reported, not just the first")
    tmp = tempfile.mkdtemp()
    try:
        store = tc.LocalStore(os.path.join(tmp, "snaps.json"), os.path.join(tmp, "changes.json"))
        A, B = "2026-11-01T12:00:00+02:00", "2026-11-15T12:00:00+02:00"

        new1 = _run_on(store, 1, _release(closing_date=A))
        check("day 1: first sighting reports nothing yet (no prior snapshot to diff against)",
              new1 == [])

        new2 = _run_on(store, 5, _release(closing_date=B))
        check("day 5: A->B extension reported", len(new2) == 1 and new2[0]["change_type"] == "closing_date_changed"
              and new2[0]["new_value"] == B)

        new3 = _run_on(store, 10, _release(closing_date=A))
        check("day 10: B->A reversion reported", len(new3) == 1 and new3[0]["new_value"] == A)

        new4 = _run_on(store, 15, _release(closing_date=B))
        check("day 15: A->B again (the SAME new value as day 5, weeks later) is still reported, "
              "not silently dropped as 'already recorded'",
              len(new4) == 1 and new4[0]["new_value"] == B)
    finally:
        shutil.rmtree(tmp)


def test_same_day_retry_still_deduplicates():
    print("two detect()/save() calls on the same day against the same stale snapshot "
          "(the real scenario the dedupe mechanism exists for) still count as one change")
    tmp = tempfile.mkdtemp()
    try:
        store = tc.LocalStore(os.path.join(tmp, "snaps.json"), os.path.join(tmp, "changes.json"))
        _run_on(store, 1, _release(closing_date="2026-11-01T12:00:00+02:00"))
        new_first = _run_on(store, 5, _release(closing_date="2026-11-20T12:00:00+02:00"))
        check("first call on day 5 reports the change", len(new_first) == 1)
        # A second, identical call the SAME day against the snapshot the first call just
        # persisted: nothing changed any more (prev == now), so no event at all - the
        # structural guarantee this whole mechanism relies on (snapshot already advanced).
        new_second = _run_on(store, 5, _release(closing_date="2026-11-20T12:00:00+02:00"))
        check("a second call the same day, after the snapshot already advanced, reports nothing",
              new_second == [])
    finally:
        shutil.rmtree(tmp)


def test_different_listings_never_collide_on_dedupe_key():
    print("two different tenders changing to the same new closing date on the same day "
          "are two separate events, never merged into one")
    tmp = tempfile.mkdtemp()
    try:
        store = tc.LocalStore(os.path.join(tmp, "snaps.json"), os.path.join(tmp, "changes.json"))
        same_new_date = "2026-11-20T12:00:00+02:00"
        _run_on(store, 1, _release(ocid="ocds-aaa", closing_date="2026-11-01T12:00:00+02:00"))
        _run_on(store, 1, _release(ocid="ocds-bbb", contract_number="Y.002-002-2026/1F", closing_date="2026-11-02T12:00:00+02:00"))
        snaps = store.load_snapshots(["ocds-aaa", "ocds-bbb"])
        events, new_snaps = tc.detect([
            _release(ocid="ocds-aaa", closing_date=same_new_date),
            _release(ocid="ocds-bbb", contract_number="Y.002-002-2026/1F", closing_date=same_new_date),
        ], snaps)
        _FrozenDay._now = real_datetime.datetime(2026, 10, 5, 9, 0, tzinfo=sh.SAST)
        real_dt = tc.datetime.datetime
        tc.datetime.datetime = _FrozenDay
        try:
            new = store.save(new_snaps, events)
        finally:
            tc.datetime.datetime = real_dt
        check("both tenders' changes are reported, not deduplicated against each other",
              len(new) == 2 and {e["ocid"] for e in new} == {"ocds-aaa", "ocds-bbb"})
    finally:
        shutil.rmtree(tmp)


def test_disagreement_dedupe_also_time_bucketed():
    print("a cross-source closing-date disagreement that recurs on a later date is "
          "reported again too, same fix as closing_date_changed")
    tmp = tempfile.mkdtemp()
    try:
        store = tc.LocalStore(os.path.join(tmp, "snaps.json"), os.path.join(tmp, "changes.json"))

        def with_disagreement(value, base_value):
            r = _release(closing_date=value)
            r["source_disagreements"] = [{"field": "closing_date", "source": "sanral", "value": value,
                                          "base_source": "etenders_portal", "base_value": base_value}]
            return r

        new1 = _run_on(store, 1, with_disagreement("2026-11-20T12:00:00+02:00", "2026-11-01T12:00:00+02:00"))
        check("day 1: disagreement reported", len(new1) == 1 and new1[0]["change_type"] == "sources_disagree")
        new2 = _run_on(store, 20, with_disagreement("2026-11-20T12:00:00+02:00", "2026-11-01T12:00:00+02:00"))
        check("day 20: the SAME disagreement recurring weeks later is reported again, not dropped",
              len(new2) == 1 and new2[0]["change_type"] == "sources_disagree")
    finally:
        shutil.rmtree(tmp)


def test_same_day_multiple_real_oscillations_all_reported():
    print("a closing date flipping A->B->A->B three real times within ONE calendar day "
          "(not just weeks apart) - every occurrence still reported, not just the first two "
          "(standing QA review, twenty-seventh run: day-level bucketing alone still collided "
          "on this narrower, same-day version of the original bug)")
    tmp = tempfile.mkdtemp()
    try:
        store = tc.LocalStore(os.path.join(tmp, "snaps.json"), os.path.join(tmp, "changes.json"))
        A, B = "2026-11-01T12:00:00+02:00", "2026-11-15T12:00:00+02:00"
        new0 = _run_at(store, 5, 8, _release(closing_date=A))
        check("hour 8: first sighting reports nothing yet", new0 == [])
        new1 = _run_at(store, 5, 9, _release(closing_date=B))
        check("hour 9: A->B reported", len(new1) == 1 and new1[0]["new_value"] == B)
        new2 = _run_at(store, 5, 10, _release(closing_date=A))
        check("hour 10: B->A reported", len(new2) == 1 and new2[0]["new_value"] == A)
        new3 = _run_at(store, 5, 11, _release(closing_date=B))
        check("hour 11: A->B again, same day as hour 9's identical new_value - still reported, "
              "not silently dropped", len(new3) == 1 and new3[0]["new_value"] == B)
    finally:
        shutil.rmtree(tmp)


def main():
    test_oscillating_closing_date_every_occurrence_reported()
    test_same_day_retry_still_deduplicates()
    test_different_listings_never_collide_on_dedupe_key()
    test_disagreement_dedupe_also_time_bucketed()
    test_same_day_multiple_real_oscillations_all_reported()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
