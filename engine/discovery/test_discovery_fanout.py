"""
Discovery fan-out check (Hardcoded-Assumptions-Audit Q4, Sarel 2026-10-17:
"It should score for all companies in the app. Nothing must be klipcorp
specific"): the SAME discovered tender is scored separately for every
company, each from its own profile, and each company's report-worthy verdict
becomes its own discovered_opportunities row.

Two real public tenders from templates/general_samples (their own PDFs, read
through assess_tender.fetch_pdf_text over a file:// URL - the same code path
as a live eTenders document link):
  dawid_kruiper_tn051  external security services (security_facilities), Northern Cape
  ecdpwi_scmu5_0007    professional architectural services (roads_civil, buildings, ...), Eastern Cape

Part 1 (always): profile-file mode. The 4 committed test companies plus two
deliberately different synthetic profiles. Proves the verdicts differ per
company for the same reading, and that the documents are read once per
tender, not once per company.

Part 2 (with FANOUT_PSQL set - a scratch Postgres with every migration
replayed, same method as engine/intake/test_manual_intake.py): Supabase mode.
Companies, tagged experience items and offices are real rows; profiles are
built by company_profiles.all_company_profiles() from those rows;
seed_supabase_opportunities.seed() writes the rows; they are read back per
company. Also: a test company (is_test_company) is scored like any other by
default (Sarel, 2026-10-17: "let it come up in the discovery results") and left
out only with include_test_companies=False; the seen store is the
discovery_seen_releases table (0038) - rows read back, a second run reports
nothing and reads no document, a company added later IS scored on the releases
still in the window, the local JSON file is not touched, and under RLS a member
reads only its own company's seen rows and can't write any.

    python3 engine/discovery/test_discovery_fanout.py
    FANOUT_PSQL="psql -h /tmp/sock -p 54411 -U postgres -d tpltest" python3 engine/discovery/test_discovery_fanout.py
"""
import json
import os
import shlex
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "engine", "intake"))
sys.path.insert(0, os.path.join(ROOT, "engine", "pack"))
import assess_tender  # noqa: E402
import company_profiles  # noqa: E402
import watch_new_tenders as watch  # noqa: E402
import seed_supabase_opportunities as seeder  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


SAMPLES = json.load(open(os.path.join(ROOT, "templates", "general_samples", "sources.json")))["samples"]


def release(key, pdf):
    s = SAMPLES[key]
    return {"ocid": s["ocid"], "contract_number": s["reference"], "buyer": s["buyer"], "title": s["description"],
            "description": s["description"], "closing_date": "2099-01-01T11:00:00Z", "is_closed": False,
            "documents": [{"url": "file://" + os.path.join(ROOT, "templates", "general_samples", key, pdf),
                           "title": pdf}]}


RELEASES = [release("dawid_kruiper_tn051", "TN051.pdf"), release("ecdpwi_scmu5_0007", "SCMU5-26-27-0007SB.pdf")]
ALL = watch.REPORT_WORTHY_VERDICTS_WIDE | {"not_a_fit"}  # every verdict, so each company's own one is visible


def synthetic(legal, disciplines, cidb, province):
    return {"company_id": None, "legal_name": legal, "key": f"synthetic:{legal}",
            "profile": {"disciplines": disciplines, "bee_level": 1, "black_ownership_pct": 100,
                        "has_cidb_grading": cidb,
                        "offices": [{"province": province, "district_municipality": None, "local_municipality": None,
                                     "town": None, "office_kind": "head_office"}]}}


def verdicts(out):
    return {r["contract_number"]: {c["legal_name"]: c["verdict"] for c in r["company_results"]} for r in out}


def part1():
    print("Part 1 - profile files + synthetic profiles, one reading per tender")
    files = sorted(os.path.join(ROOT, "config", "test_companies", f) for f in
                   os.listdir(os.path.join(ROOT, "config", "test_companies")) if f.endswith(".json"))
    companies = company_profiles.profiles_from_files(files) + [
        synthetic("Synthetic Guarding Services CC", ["security_facilities"], False, "Northern Cape"),
        synthetic("Synthetic Architects Inc", ["buildings", "professional_services"], True, "Eastern Cape"),
    ]
    reads = []
    real_fetch = assess_tender.fetch_pdf_text

    def counting_fetch(url):
        reads.append(url)
        return real_fetch(url)

    seen = {}
    out = watch.fan_out(RELEASES, companies, seen, ALL, fetch_text=counting_fetch)
    v = verdicts(out)
    for ref, per in v.items():
        print(f"    {ref}:")
        for name, verdict in per.items():
            print(f"      {verdict:<13} {name}")
    check(len(reads) == len(RELEASES), f"documents read once per tender ({len(reads)} reads for {len(RELEASES)} tenders "
                                       f"x {len(companies)} companies)")
    tn051 = v[SAMPLES["dawid_kruiper_tn051"]["reference"]]
    check(tn051["Synthetic Guarding Services CC"] == "strong_fit", "security tender: the guarding company is a strong fit")
    check(tn051["Synthetic Architects Inc"] == "not_a_fit", "security tender: the architects are not a fit")
    check(tn051["Test Complete Engineering (Pty) Ltd"] == "needs_review",
          "security tender: a company with no disciplines on file needs review (never rejected, never assumed)")
    check(len(set(tn051.values())) >= 3, f"same tender, {len(set(tn051.values()))} different verdicts across companies")
    sc = v[SAMPLES["ecdpwi_scmu5_0007"]["reference"]]
    check(sc["Synthetic Architects Inc"] != tn051["Synthetic Architects Inc"],
          "the architects' verdict differs between the two tenders")
    # Each company's score outlook is its own (locality: the guarding company's
    # Northern Cape office vs the architects' Eastern Cape office).
    by = {c["legal_name"]: c for r in out for c in r["company_results"]
          if r["contract_number"] == SAMPLES["dawid_kruiper_tn051"]["reference"]}
    o1, o2 = (json.dumps(by[n]["score_outlook"], sort_keys=True) for n in
              ("Synthetic Guarding Services CC", "Synthetic Architects Inc"))
    check(o1 != o2, "score outlooks are per company, not one shared outlook")
    check(all(set(e["companies"]) == {c["key"] for c in companies} for e in seen.values()),
          "seen store records every company per release")
    again = watch.fan_out(RELEASES, companies, seen, ALL, fetch_text=counting_fetch)
    check(again == [] and len(reads) == len(RELEASES), "second run: nothing new, no document re-read")
    # No Supabase companies (profile files): watch.run() keeps the local JSON store.
    import tempfile
    store = os.path.join(tempfile.mkdtemp(), "seen.json")
    first = watch.run(RELEASES, companies, ALL, client=None, seen_store=store, log=lambda m: None)
    on_disk = json.load(open(store))
    check(len(first) == 2 and set(on_disk) == {r["ocid"] for r in RELEASES} and
          all(set(e["companies"]) == {c["key"] for c in companies} for e in on_disk.values()),
          "profile-file run: seen store is the local JSON file (both releases, every company)")
    check(watch.run(RELEASES, companies, ALL, client=None, seen_store=store, log=lambda m: None) == [],
          "profile-file run: second run against the same JSON file reports nothing")
    legacy = {RELEASES[0]["ocid"]: {"first_seen": "2026-10-01", "verdict": "possible"}}
    out3 = watch.fan_out(RELEASES[:1], companies[:1], legacy, ALL)
    check(len(out3) == 1 and "companies" in legacy[RELEASES[0]["ocid"]] and
          legacy[RELEASES[0]["ocid"]]["first_seen"] == "2026-10-01",
          "pre-fan-out seen entry (one shared verdict) is re-scored per company, first_seen kept")
    try:
        assess_tender.load_company_profile(None)
        check(False, "no default company profile")
    except ValueError:
        check(True, "no default company profile (load_company_profile(None) refuses)")
    saved = {k: os.environ.pop(k, None) for k in ("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
    try:
        watch.load_companies(None)
        check(False, "no Supabase and no --profile: stops")
    except SystemExit:
        check(True, "no Supabase and no --profile: the watch stops instead of scoring for a sample company")
    finally:
        os.environ.update({k: v for k, v in saved.items() if v})


def part2(psql):
    import bridge_selftest
    from test_manual_intake import Client
    print("Part 2 - Supabase mode on a scratch Postgres (every migration replayed)")
    c = Client(psql, "/nonexistent")
    c.sql("delete from discovered_opportunities; delete from discovery_seen_releases; "
          "delete from experience_items; delete from company_offices; "
          "delete from companies where legal_name like 'Fanout %'")

    def company(name, tags, cidb=None, province=None, test=False):
        row = c.insert("companies", {"legal_name": name, "cidb_grading": cidb, "bee_level": 1,
                                     "is_test_company": test})
        if tags:
            c.insert("experience_items", {"company_id": row["id"], "project_name": f"{name} reference project",
                                          "document_type": "completion_certificate", "disciplines": tags,
                                          "tagged_at": "2026-10-01T00:00:00+00:00"})
        if province:
            c.insert("company_offices", {"company_id": row["id"], "province": province, "office_kind": "head_office"})
        return row["id"]

    ids = {
        "Fanout Guarding CC": company("Fanout Guarding CC", ["security_facilities"], province="Northern Cape"),
        "Fanout Architects Inc": company("Fanout Architects Inc", ["buildings", "professional_services"], "6GB", "Eastern Cape"),
        "Fanout Roads (Pty) Ltd": company("Fanout Roads (Pty) Ltd", ["roads_civil"], "7CE", "Gauteng"),
        "Fanout Test Harness Co": company("Fanout Test Harness Co", ["security_facilities"], test=True),
    }

    def fanout_rows(**kw):
        return [r for r in company_profiles.all_company_profiles(c, **kw) if r["legal_name"].startswith("Fanout ")]
    all_rows = fanout_rows()
    names = [r["legal_name"] for r in all_rows]
    check("Fanout Test Harness Co" in names, "is_test_company scored like any other company by default (audit (a))")
    check(len(all_rows) == 4, f"4 companies scored ({', '.join(names)})")
    excl = [r["legal_name"] for r in fanout_rows(include_test_companies=False)]
    check("Fanout Test Harness Co" not in excl and len(excl) == 3,
          "include_test_companies=False (--exclude-test-companies) leaves it out")
    guard = next(r for r in all_rows if r["legal_name"] == "Fanout Guarding CC")
    check(guard["profile"]["disciplines"] == ["security_facilities"] and
          guard["profile"]["offices"][0]["province"] == "Northern Cape",
          "profile built from the company's own experience tags + offices rows")

    reads = []
    real_fetch = assess_tender.fetch_pdf_text

    def counting_fetch(url):
        reads.append(url)
        return real_fetch(url)
    import tempfile
    json_store = os.path.join(tempfile.mkdtemp(), "never_written_seen.json")
    out = watch.run(RELEASES, all_rows, watch.REPORT_WORTHY_VERDICTS_WIDE, client=c, seen_store=json_store,
                    fetch_text=counting_fetch, log=lambda m: print("   ", m))
    check(not os.path.exists(json_store), "Supabase run: the local JSON seen store is not written")
    written = seeder.seed(c, out, log=lambda m: print("   ", m))
    rows = c.sql("select coalesce(json_agg(t), '[]') from (select c.legal_name, d.contract_number, d.verdict, "
                 "d.score_outlook is not null as has_outlook from discovered_opportunities d join companies c "
                 "on c.id = d.company_id where c.legal_name like 'Fanout %' order by 2, 1) t")
    rows = json.loads(rows)
    for r in rows:
        print(f"    row: {r['contract_number']:<22} {r['verdict']:<13} {r['legal_name']}")
    tn = SAMPLES["dawid_kruiper_tn051"]["reference"]
    tn_rows = {r["legal_name"]: r["verdict"] for r in rows if r["contract_number"] == tn}
    check(tn_rows.get("Fanout Guarding CC") == "strong_fit", "TN051 row for the guarding company: strong_fit")
    check(tn_rows.get("Fanout Test Harness Co") == "strong_fit",
          "TN051 row for the test company too (security tags) - it comes up in the discovery results")
    check("Fanout Architects Inc" not in tn_rows and "Fanout Roads (Pty) Ltd" not in tn_rows,
          "TN051: no row for companies it isn't report-worthy for (their own not_a_fit)")
    check(all(r["has_outlook"] for r in rows), "each row carries its own score outlook")
    check(sum(written.values()) == len(rows), f"{len(rows)} rows written, one per company x report-worthy tender")

    seen_rows = json.loads(c.sql(
        "select coalesce(json_agg(t), '[]') from (select c.legal_name, s.release_key, s.ocid, s.contract_number, "
        "s.verdict, s.profile_fingerprint, s.first_seen from discovery_seen_releases s join companies c "
        "on c.id = s.company_id where c.legal_name like 'Fanout %' order by 2, 1) t"))
    for r in seen_rows:
        print(f"    seen: {r['release_key']:<20} {r['verdict']:<13} {r['legal_name']:<24} {r['profile_fingerprint'][:12]}")
    check(len(seen_rows) == len(RELEASES) * len(all_rows),
          f"seen store in the database: {len(seen_rows)} rows = {len(RELEASES)} releases x {len(all_rows)} companies")
    arch = {r["release_key"]: r for r in seen_rows if r["legal_name"] == "Fanout Architects Inc"}
    check(arch[RELEASES[0]["ocid"]]["verdict"] == "not_a_fit",
          "the architects' own not_a_fit on TN051 is a seen row (recorded, not reported)")
    check(all(r["profile_fingerprint"] == company_profiles.profile_fingerprint(
        next(x["profile"] for x in all_rows if x["legal_name"] == r["legal_name"])) for r in seen_rows),
          "each seen row carries the fingerprint of the profile it was scored against")
    check(all(r["ocid"] == r["release_key"] and r["contract_number"] for r in seen_rows),
          "seen rows keep ocid + contract number")

    n_reads = len(reads)
    check(watch.run(RELEASES, all_rows, watch.REPORT_WORTHY_VERDICTS_WIDE, client=c, seen_store=json_store,
                    fetch_text=counting_fetch, log=lambda m: None) == [] and len(reads) == n_reads,
          "second run, seen store read back from the database: nothing new, no document re-read")
    late = company("Fanout Late Joiner Guards", ["security_facilities"], province="Northern Cape")
    all_rows = fanout_rows()
    out = watch.run(RELEASES, all_rows, watch.REPORT_WORTHY_VERDICTS_WIDE, client=c, seen_store=json_store,
                    log=lambda m: None)
    check([[x["legal_name"] for x in r["company_results"]] for r in out] == [["Fanout Late Joiner Guards"]],
          "a company added later is scored on releases still in the window (and only it)")
    seeder.seed(c, out)
    n = c.sql(f"select count(*) from discovered_opportunities where company_id = '{late}'")
    check(n == "1", "the late company's own row written")
    n = c.sql(f"select count(*) from discovery_seen_releases where company_id = '{late}'")
    check(n == str(len(RELEASES)), f"the late company's seen rows written ({n})")
    check(not os.path.exists(json_store), "the local JSON file still never written in Supabase mode")
    # RLS: each company sees only its own row (0004 tenant isolation).
    uid = c.sql("insert into auth.users default values returning id").splitlines()[0]
    c.insert("company_members", {"company_id": ids["Fanout Guarding CC"], "user_id": uid, "role": "owner"})
    c.sql("grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated; "
          "grant execute on all functions in schema public to authenticated")
    ok, seen_rows = c.as_user(uid, "select count(*) from discovered_opportunities")
    check(ok and seen_rows == "1", f"a Fanout Guarding member sees only its own row under RLS ({seen_rows})")
    ok, n = c.as_user(uid, "select count(*) from discovery_seen_releases")
    check(ok and n == str(len(RELEASES)), f"a Fanout Guarding member reads only its own seen rows under RLS ({n})")
    ok, err = c.as_user(uid, f"insert into discovery_seen_releases (company_id, release_key, verdict) "
                             f"values ('{ids['Fanout Guarding CC']}', 'x', 'possible')")
    check(not ok, "a member can't write the seen store (service role only)")


if __name__ == "__main__":
    part1()
    psql = os.environ.get("FANOUT_PSQL")
    if psql:
        part2(psql)
    else:
        print("(Part 2 skipped - set FANOUT_PSQL to a scratch Postgres with the migrations replayed)")
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)
