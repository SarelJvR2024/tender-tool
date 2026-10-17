"""
SACNASP / SAGC registration expiry reminders (migration 0040, hardcoded-
assumptions audit Q5) through the SAME mechanism as ECSA / SACPCMP:
watch_deadlines.find_due_person_credentials() -> _expiry_window(), one
seen-store, one lead-time window (TRACKED_PERSON_EXPIRY_FIELDS).

Part 1 (always, no network): in-memory rows shaped like people 0001+0035+0040,
served by test_watch_deadlines_urgency.py's fake PostgREST.
  1. a SACNASP registration lapsing in 15 days is reported (renew soon) with
     the person, company and number;
  2. an SAGC registration that lapsed 2 days ago is reported as expired;
  3. a SACNASP registration valid for 400 more days is not reported;
  4. a person with ECSA only (no SACNASP / SAGC recorded - the normal case,
     the fields are optional) produces no SACNASP / SAGC item at all;
  5. a second run the same day reports nothing new;
  6. the role digest routes them like any person registration (cv_admin).

Part 2 (REGISTRATION_PSQL set): the same check on a scratch Postgres with
every migration replayed (0001 -> 0040): real `people` rows written with
SQL, read back through a psql-backed stand-in for the two PostgREST GETs
find_due_person_credentials() makes.

    REGISTRATION_PSQL="psql -h /tmp/tt-tax-pg/sock -p 54439 -U postgres -d replay" \\
        python3 engine/compliance/test_watch_conditional_registrations.py
"""
import datetime
import json
import os
import re
import shlex
import subprocess
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "notify"))
import watch_deadlines as wd  # noqa: E402
import test_watch_deadlines_urgency as fixture  # noqa: E402

TODAY = fixture.TODAY
D = fixture.D
FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def person(pid, co, name, **cols):
    base = {"id": pid, "company_id": co, "name": name}
    for col, _, _, num in wd.TRACKED_PERSON_EXPIRY_FIELDS:
        base.setdefault(col, None)
        base.setdefault(num, None)
    base.update(cols)
    return base


def part1():
    print("Part 1 - in-memory")
    fixture.ROWS.clear()
    fixture.ROWS.update({
        "companies": [{"id": "co1", "legal_name": "Geo Test Co"}],
        "people": [
            person("g1", "co1", "Gina Geologist", sacnasp_number="400123/08", sacnasp_expiry=D(15)),
            person("s1", "co1", "Sipho Surveyor", sagc_number="PLS1234", sagc_expiry=D(-2)),
            person("g2", "co1", "Later Geologist", sacnasp_number="400999/10", sacnasp_expiry=D(400)),
            person("e1", "co1", "Eddie Engineer", ecsa_number="20150155", ecsa_expiry=D(500)),
        ],
    })
    wd.supabase_request = fixture.fake_request
    cols = [c for c, _, _, _ in wd.TRACKED_PERSON_EXPIRY_FIELDS]
    check("sacnasp_expiry" in cols and "sagc_expiry" in cols, "SACNASP and SAGC are in TRACKED_PERSON_EXPIRY_FIELDS")
    seen = {}
    due = wd.find_due_person_credentials("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    for d in due:
        print("   ", {k: d.get(k) for k in ("person_name", "label", "registration_number", "days_left", "status")})
    by = {(d["person_id"], d["field"]): d for d in due}
    g1 = by.get(("g1", "sacnasp_expiry"))
    check(g1 is not None and g1["status"] == "renew_soon" and g1["days_left"] == 15
          and g1["registration_number"] == "400123/08" and g1["company_name"] == "Geo Test Co"
          and "SACNASP" in g1["label"], "SACNASP lapsing in 15 days -> renew soon, with person/company/number")
    s1 = by.get(("s1", "sagc_expiry"))
    check(s1 is not None and s1["status"] == "expired" and "SAGC" in s1["label"], "SAGC lapsed 2 days ago -> expired")
    check(("g2", "sacnasp_expiry") not in by, "SACNASP valid 400 more days -> not reported")
    check(not any(d["person_id"] == "e1" for d in due), "ECSA-only person (no SACNASP/SAGC recorded) -> nothing")
    check(len(due) == 2, f"exactly 2 items ({len(due)})")
    again = wd.find_due_person_credentials("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    check(not again, "second run the same day reports nothing new")

    import daily_digest  # noqa: E402
    signals = {"new_tenders": [], "document_expiry": due, "tender_tasks": [], "readiness_changes": [], "submission_due": []}
    cv = daily_digest.build_digest_for_person({"name": "x", "tender_role": "cv_admin", "company_name": "x"}, signals)
    check(len(cv.get("document_expiry") or []) == 2, "cv_admin digest carries both (same routing as ECSA/SACPCMP)")
    return due


def psql_request(psql):
    """The two GETs find_due_person_credentials() makes, answered by real SQL."""
    def req(url, key, path):
        table, _, query = path.partition("?")
        params = urllib.parse.parse_qs(query)
        cols = params["select"][0]
        where = []
        for k, vals in params.items():
            if k in ("select", "order"):
                continue
            m = re.match(r"in\.\((.*)\)", vals[0])
            if m:
                ids = ",".join("'" + v.replace("'", "''") + "'" for v in m.group(1).split(","))
                where.append(f"{k}::text in ({ids})")
        order = " order by name" if "order" in params else ""
        sql = (f"select coalesce(json_agg(t), '[]') from (select {cols} from {table}"
               f"{' where ' + ' and '.join(where) if where else ''}{order}) t")
        out = subprocess.run(shlex.split(psql) + ["-tAc", sql], capture_output=True, text=True, check=True).stdout
        return json.loads(out)
    return req


def part2(psql):
    print("Part 2 - replayed Postgres")
    run = lambda sql: subprocess.run(shlex.split(psql) + ["-q", "-v", "ON_ERROR_STOP=1", "-tAc", sql],  # noqa: E731
                                     capture_output=True, text=True)
    today = datetime.date.today()
    r = run("delete from people where name like 'Q5 %'; delete from companies where legal_name = 'Q5 Registration Test Co';"
            "insert into companies (legal_name) values ('Q5 Registration Test Co') returning id")
    check(r.returncode == 0, f"test company inserted {r.stderr.strip()[:200]}")
    co = r.stdout.strip().splitlines()[0]
    r = run(f"""insert into people (company_id, name, sacnasp_category, sacnasp_number, sacnasp_expiry)
                  values ('{co}', 'Q5 Geologist', 'Pr.Sci.Nat', '400123/08', '{today + datetime.timedelta(days=15)}');
                insert into people (company_id, name, sagc_category, sagc_number, sagc_expiry)
                  values ('{co}', 'Q5 Surveyor', 'Professional Land Surveyor', 'PLS1234', '{today - datetime.timedelta(days=2)}');
                insert into people (company_id, name, ecsa_level, ecsa_number)
                  values ('{co}', 'Q5 Engineer', 'Professional Engineer', '20150155');""")
    check(r.returncode == 0, f"people rows with the 0040 columns written {r.stderr.strip()[:200]}")
    r = run(f"select sacnasp_category is null and sacnasp_number is null and sacnasp_expiry is null and "
            f"sagc_category is null and sagc_number is null and sagc_expiry is null from people "
            f"where company_id = '{co}' and name = 'Q5 Engineer'")
    check(r.stdout.strip() == "t", "a person with no SACNASP/SAGC gets nulls (optional, no default)")
    wd.supabase_request = psql_request(psql)
    due = [d for d in wd.find_due_person_credentials("u", "k", {}, today, wd.DEFAULT_DOC_LEAD_DAYS)
           if d["company_id"] == co]
    for d in due:
        print("   ", {k: d.get(k) for k in ("person_name", "label", "registration_number", "expiry_date", "days_left", "status")})
    by = {(d["person_name"], d["field"]): d for d in due}
    g = by.get(("Q5 Geologist", "sacnasp_expiry"))
    s = by.get(("Q5 Surveyor", "sagc_expiry"))
    check(g is not None and g["status"] == "renew_soon" and g["days_left"] == 15, "real row: SACNASP in 15 days -> renew soon")
    check(s is not None and s["status"] == "expired" and s["days_left"] == -2, "real row: SAGC lapsed 2 days ago -> expired")
    check(not any(d["person_name"] == "Q5 Engineer" for d in due), "real row: ECSA-only person -> nothing")
    run(f"delete from people where company_id = '{co}'; delete from companies where id = '{co}'")


def main():
    part1()
    psql = os.environ.get("REGISTRATION_PSQL")
    if psql:
        part2(psql)
    else:
        print("(Part 2 skipped - set REGISTRATION_PSQL to a replayed scratch database)")
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
