"""
The reminder seen stores live in the database (migration 0041), not in
state/seen_deadlines.json / state/seen_digest_readiness.json (Sarel,
2026-10-17: "why would anything be saved in local instead of database").

Part 1 (always, CI): watch_deadlines.main() run twice as the CLI runs it
(env vars set, sys.argv), the Supabase reads served from in-memory rows
(test_watch_deadlines_urgency.fake_request) and the seen store through an
in-memory stand-in of company_profiles.RestClient. Run 1 reports every due
item and writes one deadline_reminders_seen row per item, each under its
own company; run 2 reports nothing; a renewed document is reported again;
no file is written under state/.

Part 2 (REMINDER_PSQL set - a scratch Postgres with every migration
replayed, same method as engine/discovery/test_discovery_fanout.py): the same
two runs with the seen store in the REAL table (rows read back with SQL), the
daily digest's two stores (deadline items under consumer daily_digest -
independent of the watch's rows - and digest_readiness_seen against a real
field_provenance row), and RLS: a member reads only its own company's rows
and can't write any.

    python3 engine/compliance/test_reminder_seen_db.py
    REMINDER_PSQL="psql -h /tmp/sock -p 54481 -U postgres -d alertstest" python3 engine/compliance/test_reminder_seen_db.py
"""
import contextlib
import datetime
import io
import json
import os
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "engine", "notify"))
sys.path.insert(0, os.path.join(ROOT, "engine", "intake"))
sys.path.insert(0, os.path.join(ROOT, "engine", "pack"))
import watch_deadlines as wd  # noqa: E402
import company_profiles  # noqa: E402
import test_watch_deadlines_urgency as fixture  # noqa: E402

FAILS = []
TODAY = datetime.date.today()
STATE = os.path.join(ROOT, "state")


def D(n):
    return (TODAY + datetime.timedelta(days=n)).isoformat()


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def rows_for(co_a, co_b, person, task, tender):
    return {
        "companies": [
            {"id": co_a, "legal_name": "Seen DB Co A", "coid_letter_of_good_standing_expiry": D(20)},
            {"id": co_b, "legal_name": "Seen DB Co B", "coid_letter_of_good_standing_expiry": D(-3)},
        ],
        "people": [{"id": person, "company_id": co_a, "name": "Seen DB Engineer", "ecsa_expiry": D(10),
                    "ecsa_number": "20150155"}],
        "tender_packs": [],
        "tenders": [{"id": tender, "contract_no": "SEEN-1", "title": "t", "closing_date": D(40) + "T10:00:00+00:00",
                     "status": "open"}],
        "tender_tasks": [{"id": task, "company_id": co_a, "tender_id": tender, "description": "Site visit",
                          "due_date": D(3), "status": "not_started", "kind": None}],
    }


def run_cli():
    sys.argv = ["watch_deadlines.py", "--out", os.path.join(OUT, "report.json")]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        wd.main()
    report = json.load(open(os.path.join(OUT, "report.json")))
    return report, buf.getvalue()


def total(report):
    return sum(len(v) for v in report.values())


class MemClient:
    def __init__(self):
        self.tables = {}

    def select(self, table, filters=None, order=None):
        return [dict(r) for r in self.tables.get(table, [])
                if all(r.get(k) == v for k, v in (filters or {}).items())]

    def upsert(self, table, rows, on_conflict):
        keys = on_conflict.split(",")
        store = self.tables.setdefault(table, [])
        for row in rows:
            hit = next((r for r in store if all(r.get(k) == row.get(k) for k in keys)), None)
            (hit.update(row) if hit else store.append(dict(row)))
        return rows


def two_runs(client_factory, read_rows, label):
    co_a, co_b, person, task, tender = (str(uuid.uuid4()) for _ in range(5))
    fixture.ROWS.clear()
    fixture.ROWS.update(rows_for(co_a, co_b, person, task, tender))
    wd.supabase_request = fixture.fake_request
    company_profiles.RestClient = lambda url, key: client_factory()
    os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "http://fake", "fake-key"
    state_before = sorted(os.listdir(STATE)) if os.path.isdir(STATE) else []

    r1, out1 = run_cli()
    check(total(r1) == 4 and len(r1["documents"]) == 2 and len(r1["person_credentials"]) == 1 and len(r1["tasks"]) == 1,
          f"{label}: run 1 reports the 4 due items (2 COIDs, 1 ECSA, 1 task) - {total(r1)}")
    rows = read_rows()
    check(sorted((r["company_id"], r["kind"]) for r in rows) ==
          sorted([(co_a, "document"), (co_b, "document"), (co_a, "person_credential"), (co_a, "task")])
          and all(r["consumer"] == "watch_deadlines" for r in rows),
          f"{label}: 4 deadline_reminders_seen rows, each under its own company, consumer watch_deadlines")
    r2, out2 = run_cli()
    check(total(r2) == 0 and "reported before, 0 new" in out2, f"{label}: run 2 reads the store back - nothing reported")
    fixture.ROWS["companies"][0]["coid_letter_of_good_standing_expiry"] = D(45)  # renewed
    r3, _ = run_cli()
    check([(d["company_id"], d["expiry_date"]) for d in r3["documents"]] == [(co_a, D(45))] and total(r3) == 1,
          f"{label}: a renewed document (new expiry) is reported again, once")
    check((sorted(os.listdir(STATE)) if os.path.isdir(STATE) else []) == state_before
          and not os.path.exists(os.path.join(STATE, "seen_deadlines.json")),
          f"{label}: no local seen file written under state/")
    return co_a, co_b, person, task, tender


def part1():
    print("Part 1 - watch_deadlines CLI, seen store through the REST client (in-memory)")
    mem = MemClient()
    two_runs(lambda: mem, lambda: mem.tables.get("deadline_reminders_seen", []), "in-memory")


def part2(psql):
    import daily_digest
    from test_manual_intake import Client
    print("Part 2 - the real 0041 tables on a replayed scratch Postgres")
    c = Client(psql, "/nonexistent")
    made = []

    def factory():
        return c
    real_rest = company_profiles.RestClient

    def read_rows():
        ids = ",".join(f"'{x}'" for x in made)
        return json.loads(c.sql(f"select coalesce(json_agg(t), '[]') from (select * from deadline_reminders_seen "
                                f"where company_id::text in ({ids})) t")) if made else []
    # companies must exist for the FK: insert them as the fixture is built
    orig_rows_for = rows_for

    def rows_for_db(co_a, co_b, person, task, tender):
        for co, name in ((co_a, "Seen DB Co A"), (co_b, "Seen DB Co B")):
            c.sql(f"insert into companies (id, legal_name) values ('{co}', '{name}')")
            made.append(co)
        return orig_rows_for(co_a, co_b, person, task, tender)
    globals()["rows_for"] = rows_for_db
    try:
        co_a, co_b, person, task, tender = two_runs(factory, read_rows, "database")
    finally:
        globals()["rows_for"] = orig_rows_for
        company_profiles.RestClient = real_rest

    # The digest's own stores: deadline items under consumer daily_digest,
    # independent of the watch's rows; readiness against a real row.
    seen, loaded = wd.load_seen_db(c, "daily_digest")
    check(not any(e["company_id"] in made for e in seen.values()),
          "digest consumer: the watch's rows are not the digest's (each reports an item independently)")
    docs = wd.find_due_documents("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    n = wd.save_seen_db(c, seen, loaded, "daily_digest")
    check(len([d for d in docs if d["company_id"] in made]) == 2 and n >= 2,
          f"digest consumer: the same 2 COIDs reported to the digest and stored under it ({n} rows)")
    t = json.loads(c.sql("select row_to_json(t) from tenders t limit 1"))
    pack = c.insert("tender_packs", {"company_id": co_a, "tender_id": t["id"]})
    fp = c.insert("field_provenance", {"tender_pack_id": pack["id"], "field_key": "company.bee_level",
                                       "status": "missing", "reason": "no certificate", "source": "test"})
    fixture.ROWS["field_provenance"] = [fp]
    fixture.ROWS["tender_packs"] = [pack]
    rseen, rloaded = daily_digest.load_readiness_seen_db(c)
    owners = {}
    ch = daily_digest.find_readiness_changes("u", "k", rseen, TODAY, owners)
    w = daily_digest.save_readiness_seen_db(c, rseen, rloaded, owners)
    stored = json.loads(c.sql(f"select row_to_json(s) from digest_readiness_seen s where field_provenance_id = '{fp['id']}'"))
    check(len(ch) == 1 and w == 1 and stored["company_id"] == co_a and stored["status"] == "missing",
          "digest readiness: the change reported and stored under the pack's company")
    rseen, rloaded = daily_digest.load_readiness_seen_db(c)
    check(daily_digest.find_readiness_changes("u", "k", rseen, TODAY, {}) == [],
          "digest readiness: read back from the table - not reported again")

    # RLS (0041): a member of A reads only A's rows and can't write them.
    c.sql("grant usage on schema public to authenticated; grant select, insert, update, delete on all tables "
          "in schema public to authenticated")
    uid = c.sql("insert into auth.users default values returning id").splitlines()[0]
    c.insert("company_members", {"company_id": co_a, "user_id": uid, "role": "member"})
    ok, n = c.as_user(uid, "select count(*) from deadline_reminders_seen")
    own = c.sql(f"select count(*) from deadline_reminders_seen where company_id = '{co_a}'")
    check(ok and n == own, f"RLS: a member of A reads only A's reminder rows ({n} of {own} own)")
    ok, n = c.as_user(uid, "select count(*) from digest_readiness_seen")
    check(ok and n == "1", f"RLS: a member of A reads only A's readiness rows ({n})")
    ok, _ = c.as_user(uid, f"insert into deadline_reminders_seen (company_id, consumer, seen_key, kind) "
                           f"values ('{co_a}', 'watch_deadlines', 'x', 'document')")
    check(not ok, "RLS: a member can't write the seen store (service role only)")
    ok, n = c.as_user(uid, "with d as (delete from deadline_reminders_seen returning 1) select count(*) from d")
    check(ok and n == "0", "RLS: a member can't delete seen rows")
    c.sql(f"delete from companies where id::text in ({','.join(repr(x) for x in made)})")


if __name__ == "__main__":
    import tempfile
    OUT = tempfile.mkdtemp()
    part1()
    psql = os.environ.get("REMINDER_PSQL")
    if psql:
        part2(psql)
    else:
        print("(Part 2 skipped - set REMINDER_PSQL to a scratch Postgres with the migrations replayed)")
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)
