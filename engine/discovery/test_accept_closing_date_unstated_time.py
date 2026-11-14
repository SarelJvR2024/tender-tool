"""
Standing solution-architect review, Finding 475 (2026-11-14).

accept_tender_update_date() (migration 0048, widened by 0106/0111, fixed by
0146) is the person-accepted sibling of watch_tender_updates.apply_closing_date()
- the ONE other real writer of tenders.closing_date. When a buyer's addendum
states a new closing date but no TIME (tender_updates.find_closing_change()'s
own _time_from() returns None whenever its regex match captured no time
group - common: many addenda just move "the closing date" without repeating
a time) AND there is no closing_date already on file to borrow the time of
day from, this SQL function used to fall back to a bare '12:00' - a THIRD,
disagreeing "closing date with no stated time" default for the identical
real-world fact every other source in this engine already agrees is 11:00
SAST:
  - engine/discovery/source_http.py's iso_sast_closing() ("a bare date
    defaults to 11:00 SAST, the standard closing time").
  - engine/discovery/watch_tender_updates.py's own _sanral_closing() (fixed
    2026-10-29 for exactly this same disagreeing-noon-default shape).

Checks the real SQL function (not a reimplementation) against a scratch
Postgres with every migration replayed - same method as
engine/intake/test_manual_intake.py and engine/pack/bridge_selftest.py.
Standalone (does not depend on test_tender_updates.py's own Part 3
scenario/seed_db(), which cannot currently run in this environment for an
unrelated, pre-existing reason: its fixture still inserts
tender_packs.pipeline_stage = 'bidding', a value migration 0105 removed from
tender_packs_pipeline_stage_check - reproduces identically with or without
this fix, not touched by it).

Usage:
    createdb -h 127.0.0.1 -U postgres closingtime_test
    engine/security/replay_schema.sh -h 127.0.0.1 -U postgres -d closingtime_test
    PGPASSWORD=... python3 engine/discovery/test_accept_closing_date_unstated_time.py \\
        "psql -h 127.0.0.1 -U postgres -d closingtime_test"
"""
import json
import subprocess
import sys
import uuid


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)):
        v = json.dumps(v)
    return "'" + str(v).replace("'", "''") + "'"


class Psql:
    def __init__(self, cmd):
        self.cmd = cmd.split()

    def sql(self, q):
        r = subprocess.run(self.cmd + ["-v", "ON_ERROR_STOP=1", "-At", "-c", q], capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(f"psql: {r.stderr.strip()}\n{q[:400]}")
        return r.stdout.strip()

    def as_user(self, uid, q):
        """Run q as a signed-in member (RLS on) - same convention as
        test_manual_intake.Client.as_user()."""
        full = f"set role authenticated; select set_config('test.uid', {lit(uid)}, false); {q}"
        r = subprocess.run(self.cmd + ["-v", "ON_ERROR_STOP=1", "-At", "-c", full], capture_output=True, text=True)
        if r.returncode:
            return False, r.stderr.strip()
        return True, r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""


FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def _member(c, label):
    uid = c.sql("insert into auth.users default values returning id").splitlines()[0]
    company = c.sql(f"insert into companies (legal_name) values ({lit(label)}) returning id").splitlines()[0]
    c.sql(f"insert into company_members (company_id, user_id, role) values ('{company}', '{uid}', 'owner')")
    return uid, company


def _closing_sast(c, tender_id):
    return c.sql(
        f"select to_char(closing_date at time zone 'Africa/Johannesburg', 'YYYY-MM-DD\"T\"HH24:MI:SS') "
        f"from tenders where id = '{tender_id}'"
    )


def test_no_time_no_file_defaults_to_1100(c):
    """The bug: a closing-date change with no stated time, accepted on a
    tender with no closing_date yet on file, must default to 11:00 SAST -
    NOT 12:00."""
    uid, company = _member(c, f"No-Time Closing Co {uuid.uuid4().hex[:6]}")
    tender = c.sql(
        f"insert into tenders (slug, title, source, status) values "
        f"('qa475-{uuid.uuid4().hex[:8]}', 'Finding 475 no-time tender', 'etenders_ocds', 'open') returning id"
    ).splitlines()[0]
    check(c.sql(f"select closing_date from tenders where id = '{tender}'") == "", "setup: tenders.closing_date starts null")
    c.sql(f"insert into tender_packs (company_id, tender_id, pipeline_stage) values ('{company}', '{tender}', 'found')")

    # tender_updates.find_closing_change()'s own shape for a date-only change: no "time" key.
    changes = {"closing_date": {"date": "2026-12-15", "previous_date": None, "quote": "closing date moved to 15 December 2026", "applied": False}}
    doc = c.sql(
        f"insert into tender_watched_documents (tender_id, doc_key, source, title, kind, changes) values "
        f"('{tender}', 'qa475@1', 'etenders_ocds', 'Addendum 1.pdf', 'addendum', {lit(changes)}::jsonb) returning id"
    ).splitlines()[0]

    ok, out = c.as_user(uid, f"select accept_tender_update_date('{doc}', 'closing_date')")
    check(ok, f"accept: the pursuing company's member accepts the date-only closing change ({out[:200]})")

    stored = _closing_sast(c, tender)
    check(stored == "2026-12-15T11:00:00",
          f"accept: a closing date with NO stated time defaults to 11:00 SAST, the engine's own documented "
          f"convention (source_http.py iso_sast_closing(), watch_tender_updates._sanral_closing()) - got {stored} SAST")


def test_time_stated_is_used_verbatim(c):
    """Unaffected-path regression: the document DOES state a time - still
    used verbatim, never the 11:00 default."""
    uid, company = _member(c, f"Time-Stated Co {uuid.uuid4().hex[:6]}")
    tender = c.sql(
        f"insert into tenders (slug, title, source, status) values "
        f"('qa475b-{uuid.uuid4().hex[:8]}', 'Finding 475 time-stated tender', 'etenders_ocds', 'open') returning id"
    ).splitlines()[0]
    c.sql(f"insert into tender_packs (company_id, tender_id, pipeline_stage) values ('{company}', '{tender}', 'found')")
    changes = {"closing_date": {"date": "2026-12-20", "time": "14:30", "previous_date": None, "quote": "x", "applied": False}}
    doc = c.sql(
        f"insert into tender_watched_documents (tender_id, doc_key, source, title, kind, changes) values "
        f"('{tender}', 'qa475b@1', 'etenders_ocds', 'Addendum.pdf', 'addendum', {lit(changes)}::jsonb) returning id"
    ).splitlines()[0]
    ok, out = c.as_user(uid, f"select accept_tender_update_date('{doc}', 'closing_date')")
    check(ok, f"regression: time-stated accept succeeds ({out[:160]})")
    stored = _closing_sast(c, tender)
    check(stored == "2026-12-20T14:30:00", f"regression: the document's OWN stated time (14:30) is used, not 11:00 - got {stored}")


def test_borrows_time_already_on_file(c):
    """Unaffected-path regression: no time stated, but a closing_date is
    already on file - the existing time-of-day is still borrowed."""
    uid, company = _member(c, f"Borrow-Time Co {uuid.uuid4().hex[:6]}")
    tender = c.sql(
        f"insert into tenders (slug, title, source, status, closing_date) values "
        f"('qa475c-{uuid.uuid4().hex[:8]}', 'Finding 475 borrow-time tender', 'etenders_ocds', 'open', '2026-11-01T09:15:00+02:00') returning id"
    ).splitlines()[0]
    c.sql(f"insert into tender_packs (company_id, tender_id, pipeline_stage) values ('{company}', '{tender}', 'found')")
    changes = {"closing_date": {"date": "2026-12-22", "previous_date": "2026-11-01", "quote": "x", "applied": False}}
    doc = c.sql(
        f"insert into tender_watched_documents (tender_id, doc_key, source, title, kind, changes) values "
        f"('{tender}', 'qa475c@1', 'etenders_ocds', 'Addendum.pdf', 'addendum', {lit(changes)}::jsonb) returning id"
    ).splitlines()[0]
    ok, out = c.as_user(uid, f"select accept_tender_update_date('{doc}', 'closing_date')")
    check(ok, f"regression: borrow-from-file accept succeeds ({out[:160]})")
    stored = _closing_sast(c, tender)
    check(stored == "2026-12-22T09:15:00", f"regression: the time-of-day already on file (09:15) is borrowed, not 11:00 - got {stored}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    c = Psql(sys.argv[1])
    c.sql("grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated; "
          "grant execute on all functions in schema public to authenticated")
    test_no_time_no_file_defaults_to_1100(c)
    test_time_stated_is_used_verbatim(c)
    test_borrows_time_already_on_file(c)
    if FAILS:
        print(f"\n{len(FAILS)} FAILED:")
        for f in FAILS:
            print(" -", f)
        sys.exit(1)
    print("\nAll passed.")


if __name__ == "__main__":
    main()
