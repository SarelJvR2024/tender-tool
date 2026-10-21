"""
Focused tests for the naive-UTC "today" bug (Finding 37/38's own bug class -
a bridge worker container has no TZ set and runs in UTC by default, so a
naive datetime.date.today() is one calendar day behind the real SAST date
for the 00:00-01:59 SAST window every day) in two engine/pack/ call sites,
neither of which had a dedicated test file before this.

Run: python3 engine/pack/test_pdf_merge.py
"""
import datetime as real_datetime
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ENGINE, "cv"))
sys.path.insert(0, os.path.join(ENGINE, "pack_generator"))
sys.path.insert(0, ENGINE)
import pdf_merge  # noqa: E402
import process_pack_jobs as ppj  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class FixedDateTime(real_datetime.datetime):
    """The system clock at UTC 2026-10-20 23:30 (= SAST 2026-10-21 01:30,
    inside the 00:00-01:59 SAST bad window)."""
    @classmethod
    def now(cls, tz=None):
        base = real_datetime.datetime(2026, 10, 20, 23, 30, tzinfo=real_datetime.timezone.utc)
        return base.astimezone(tz) if tz else base


class FixedDate(real_datetime.date):
    """What a naive datetime.date.today() would read under the same fake
    UTC clock as FixedDateTime above - patched too (not just .datetime.now)
    so these tests still catch a regression to the OLD naive form, not just
    a hypothetical one that happens to keep using datetime.now."""
    @classmethod
    def today(cls):
        return real_datetime.date(2026, 10, 20)


def _patch_clock(mod):
    """Patches mod.datetime.datetime AND mod.datetime.date; returns the
    (real_datetime, real_date) pair to restore."""
    real_dt, real_date = mod.datetime.datetime, mod.datetime.date
    mod.datetime.datetime, mod.datetime.date = FixedDateTime, FixedDate
    return real_dt, real_date


def _restore_clock(mod, saved):
    mod.datetime.datetime, mod.datetime.date = saved


def test_expiry_warning_catches_a_document_expired_real_yesterday():
    print("expiry_warning(): a document that expired exactly 'real yesterday'")
    # Finding (2026-10-21): `exp < today`'s naive `today` fallback still read
    # 2026-10-20 inside the bad window (the same as the real "yesterday"), so
    # a document whose expiry is 2026-10-20 was never flagged EXPIRED -
    # silently missing from the assembled submission pack's own warnings.
    saved = _patch_clock(pdf_merge)
    try:
        warning = pdf_merge.expiry_warning("2026-10-20", None)
    finally:
        _restore_clock(pdf_merge, saved)
    check("a document expired real-yesterday is flagged EXPIRED, not silently valid",
          warning is not None and "EXPIRED 2026-10-20" in warning, warning)


def test_expiry_warning_does_not_false_flag_a_document_valid_today():
    print("expiry_warning(): a document expiring exactly on the real SAST today (mirror case)")
    saved = _patch_clock(pdf_merge)
    try:
        warning = pdf_merge.expiry_warning("2026-10-21", None)
    finally:
        _restore_clock(pdf_merge, saved)
    check("a document expiring ON the real SAST today is still valid, not falsely flagged",
          warning is None, warning)


class FakeClient:
    """.select/.update/.insert, the exact shape sync_position_suggestions()
    calls. No filters applied beyond what the function itself needs -
    this fake exists only to drive its control flow, not model real
    PostgREST filtering."""

    def __init__(self, tables):
        self.tables = tables
        self.inserts = []

    def select(self, table, filters=None, order=None):
        return list(self.tables.get(table, []))

    def update(self, table, filters, body):
        raise AssertionError("not expected in this test")

    def insert(self, table, body):
        self.inserts.append(body)


def test_sync_position_suggestions_skips_a_tender_closed_real_yesterday():
    print("sync_position_suggestions(): a SANRAL tender that closed exactly 'real yesterday'")
    # Finding (2026-10-21): the naive `today` fallback kept re-ranking a
    # tender whose closing_date was real-yesterday for one extra cycle
    # inside the bad window, since `closing_date < naive_today` was False
    # (both read 2026-10-20).
    tables = {
        "tender_requirements": [{"tender_id": "t1", "company_id": None, "is_alternate": False,
                                 "position_code": "PL", "position_description": "Project Leader"}],
        "tenders": [{"id": "t1", "family": "Conventional Consultant Tender", "closing_date": "2026-10-20"}],
        "tender_packs": [{"id": "pk1", "tender_id": "t1", "company_id": "co1"}],
        "people": [], "projects": [], "tender_pack_assignments": [],
    }
    client = FakeClient(tables)
    saved = _patch_clock(ppj)
    try:
        written = ppj.sync_position_suggestions(client, today=None)
    finally:
        _restore_clock(ppj, saved)
    check("a tender closed real-yesterday is skipped (no wasted re-ranking), not re-scored",
          written == 0 and client.inserts == [], (written, client.inserts))


def main():
    test_expiry_warning_catches_a_document_expired_real_yesterday()
    test_expiry_warning_does_not_false_flag_a_document_valid_today()
    test_sync_position_suggestions_skips_a_tender_closed_real_yesterday()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
