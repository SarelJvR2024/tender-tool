"""
Tender Tool's own discipline taxonomy (audit Q3, migration 0040,
engine/discovery/taxonomy.py) - checks that it sorts REAL tenders, that the
fit scoring still works on it, and that it grows without a migration.

Part 1 (always, no network):
  1. the seed file validates (slugs, two levels, the 7 legacy groups kept);
  2. real tender descriptions (the 11 general samples, the 6 SANRAL samples,
     and live eTenders opportunities from 2026-10-17) land in the expected
     disciplines - including the two the old 7-bucket matcher got wrong
     (RAF plumbing -> roads_civil via "Road Accident Fund"; an architectural
     PSP in a "district" -> it_telecoms via the substring "ict");
  3. group / discipline overlap: a company tagged with a group matches every
     discipline in it; a company tagged with a discipline only "broadly"
     matches a tender known just by its group; siblings don't match;
  4. assess_fit() verdicts on that taxonomy (strong fit / not a fit /
     needs review), i.e. the fit-scoring logic still works;
  5. growing the list: a category that exists only as a ROW (a fake
     discipline_categories client) is used by categorize() with no code or
     migration change; an unreadable table falls back to the seed and says so.

Part 2 (TAXONOMY_PSQL set - a scratch Postgres with every migration
replayed): the real table - 112 seed rows, an INSERT adds a category, the
two-level rule and slug format are enforced, signed-in users can read but
not write, tender_packs.price_sector accepts any listed category (old and
new) and rejects one that isn't listed, and categorize() picks up the row
inserted a moment earlier.

    TAXONOMY_PSQL="psql -h /tmp/tt-tax-pg/sock -p 54439 -U postgres -d replay" \\
        python3 engine/discovery/test_taxonomy.py
"""
import json
import os
import shlex
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ["TT_TAXONOMY_SOURCE"] = "seed"
import taxonomy  # noqa: E402
import assess_tender  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


# Real descriptions, verbatim: general samples (templates/general_samples/
# sources.json), SANRAL seed (app/supabase/seed_tenders.sql), and live
# eTenders opportunities (Home/PaginatedTenderOpportunities, 2026-10-17).
# expected: every slug listed must be among the categories.
REAL = [
    ("raf_pr10118921", "The Road Accident Fund (RAF) wishes to appoint a suitable service provider to Flush Plumbing lines at the Head Office in Block F.", ["plumbing"], ["road_construction_upgrade", "road_maintenance"]),
    ("ecdpwi_scmu5_0007", "PROVISION OF PROFESSIONAL ARCHITECTURAL SERVICES (PSP) FOR REHABILITATION, RENOVATION AND REFURBISHMENT TO SOMERSET EAST SERVICE OFFICE IN SARAH BAARTMAN DISTRICT", ["architecture"], ["it_telecoms", "software_systems", "networks_telecoms"]),
    ("dawid_kruiper_tn051", "APPOINTMENT OF EXTERNAL SECURITY SERVICES AT THE EILAND HOLIDAY RESORT, ROSE PARK & REITZPARK UNTIL 31 JANUARY 2027", ["security_guarding"], []),
    ("dsti_rfq15", "Appointment of a service provider to offer internal audit training programmes", ["training_skills_development"], []),
    ("mthashana_tvet", "PANEL OF SERVICE PROVIDERS THAT DEAL WITH MENTAL HEALTH AND WELL-BEING OF ALL MTHASHANA COLLEGE EMPLOYEES (THREE-YEAR CONTRACT", ["wellness_counselling"], []),
    ("tourism_nb143", "Request for quotation : e Library Subscription for 2026-2029", ["books_publications_subscriptions"], ["software_systems"]),
    ("ssa_change_mgmt", "APPOINTMENT OF A SERVICE PROVIDER TO RENDER CHANGE MANAGEMENT SERVICES TO THE STATE SECURITY AGENCY FOR A PERIOD OF THREE YEARS", ["management_consulting"], ["security_guarding"]),
    ("salb_15-10-2026", "Request for quotation for 24-hour alarm monitoring and emergency responses services at the SALB premises.", ["security_guarding"], ["office_accommodation_leasing"]),
    ("eskom_e3689", "Supply and delivery of Thermocouples for a period of five (5) years at Lethabo Power Station on an as and when required basis.", ["mechanical_plant_equipment"], []),
    ("overberg_q12", "Provision for Lifeguard services at Uilenkraalsmond and Die Dam resorts", ["facilities_management"], []),
    ("R.334-030-2025/1F", "Routine ad-hoc maintenance of R334 Section 3 Consulting engineering services for the routine ad-hoc maintenance of R334 Section 3 from Great Fish River (km 0.0) to Mpeko (km 13.2)", ["road_maintenance", "consulting_engineering"], []),
    ("R.396-010-2025/1F", "Routine ad-hoc maintenance of R396 Section 1 Consulting engineering services for the routine ad-hoc maintenance of R396 Section 1", ["road_maintenance", "consulting_engineering"], []),
    ("live: lease at Ocean Road", "REQUEST FOR PROPOSAL TO LEASE THE PREMISES IN EXTENT OF 1502,4m2 AT OCEAN ROAD FOR THE PORT OF CAPE TOWN FOR A PERIOD OF UP TO TEN (10) YEARS", ["office_accommodation_leasing"], ["road_construction_upgrade"]),
    ("live: WWTW upgrade", "Tender for the upgrading of Ekangala Wastewater Treatment Works for civil, structural, mechanical and electrical components", ["water_wastewater_treatment", "mechanical_plant_equipment", "electrical_installation_reticulation"], []),
    ("live: PV at a school", "Provision for the Supply, installation, testing, commissioning, and handover of a Ground-mounted PV with BESS system at Mqikela Senior Secondary School Eastern Cape", ["renewable_energy"], ["building_construction"]),
    ("live: geotech", "OTTOSHOOP SAPS DOLOMITE RISK MANAGEMENT: UPGRADE AND REPLACEMENT OF CIVIL ENGINEERING AND DRY SERVICES", ["geotechnical_investigation"], []),
    ("live: SD-WAN", "APPOINTMENT OF A SERVICE PROVIDER TO DESIGN, IMPLEMENT, AND MAINTAIN SOFTWARE-DEFINED WIDE AREA NETWORK (SD-WAN) SOLUTIONS AND WI-FI SERVICES FOR A PERIOD OF THREE YEARS ACROSS THE HEAD OFFICE AND NATURE RESERVES", ["networks_telecoms"], ["environmental_rehabilitation"]),
    ("live: re-advert", "SERVICE PROVIDERS FOR REPAIRS AND MAINTENANCE OF SMALL PLANT AND EQUIPMENT FOR A PERIOD OF 3 YEARS - RE-ADVERT", ["plant_hire_machinery"], ["advertising_marketing"]),
    ("live: legal panel", "APPOINTMENT OF A PANEL OF LEGAL SERVICE PROVIDERS FOR A PERIOD OF 5 YEARS ON AN AS AND WHEN REQUIRED BASIS.", ["legal_services"], []),
    ("live: pit latrines", "IMPLEMENTATION OF THE ERADICATION OF PIT LATRINES AT NKALAKUTHABA HIGH SCHOOL IN ZULULAND DISTRICT, KWAZULU-NATAL PROVINCE", ["water_wastewater_treatment"], []),
    ("live: catering", "FOR THE PROVISION OF CATERING SERVICE (SIT DOWN CANTEEN AND TAKE AWAY) SERVICES IN TRANSNET ENGINEERING BLOEMFONTEIN", ["catering"], []),
    ("live: fleet", "Provision of a comprehensive fleet management for leasing fleet and vehicle tracking system for 36 months", ["vehicles_fleet"], []),
]


def part1():
    print("Part 1 - seed taxonomy, real tenders, fit scoring, growth without a migration")
    rows = taxonomy.load_seed()
    problems = taxonomy.validate(rows)
    check(not problems, f"seed validates ({problems[:3]})")
    groups = [r for r in rows if not r.get("parent")]
    check(len(groups) == 19 and len(rows) - len(groups) == 93, f"19 groups / 93 disciplines ({len(groups)}/{len(rows) - len(groups)})")
    check(all(g in {r["slug"] for r in groups} for g in taxonomy.LEGACY_GROUPS), "the 7 original buckets are kept as group slugs")

    tax = taxonomy.load_taxonomy()
    for name, text, want, not_want in REAL:
        got = assess_tender.categorize(None, text, taxonomy=tax)
        ok = all(w in got for w in want) and not any(n in got for n in not_want)
        check(ok, f"{name}: {got}")

    check(assess_tender.categorize(None, "RFQJW69BZ2026 -GAUSONIC GT100 BL-100", "goods", taxonomy=tax) == ["uncategorized_goods"],
          "nothing recognisable -> uncategorized_<buyer's OCDS category> (unchanged fallback)")

    exact, broad = tax.overlap(["road_maintenance"], ["roads_civil"])
    check(exact == ["road_maintenance"] and not broad, "company tagged roads_civil (group) matches road_maintenance")
    exact, broad = tax.overlap(["roads_civil"], ["road_maintenance"])
    check(not exact and broad == ["roads_civil"], "tender known only as roads_civil, company does road_maintenance -> broad match")
    exact, broad = tax.overlap(["geotechnical_investigation"], ["architecture"])
    check(not exact and not broad, "siblings (architecture vs geotechnical) don't match")
    exact, _ = tax.overlap(["security_guarding"], ["security_facilities"])
    check(exact == ["security_guarding"], "a legacy group tag written before 0040 still matches its disciplines")

    sig = {"cidb_grading": None}
    guard = {"disciplines": ["security_facilities"], "has_cidb_grading": False}
    arch = {"disciplines": ["architecture"], "has_cidb_grading": False}
    roads_child = {"disciplines": ["road_maintenance"], "has_cidb_grading": False}
    none = {"disciplines": [], "has_cidb_grading": False}
    tn051 = assess_tender.categorize(None, REAL[2][1], taxonomy=tax)
    v, reasons = assess_tender.assess_fit(tn051, sig, "full_document", guard)
    check(v == "strong_fit" and "Security guarding" in reasons[0], f"guarding company on TN051: strong_fit, reason names the discipline ({v}: {reasons[0][:90]})")
    v, _ = assess_tender.assess_fit(tn051, sig, "full_document", arch)
    check(v == "not_a_fit", f"architects on TN051: not_a_fit ({v})")
    v, _ = assess_tender.assess_fit(tn051, sig, "full_document", none)
    check(v == "needs_review", f"no disciplines on file: needs_review, never rejected ({v})")
    v, reasons = assess_tender.assess_fit(["roads_civil"], sig, "full_document", roads_child)
    check(v == "possible" and "Same discipline group" in reasons[0], f"broad group match: possible (not strong) + 'check scope' reason ({v})")
    scmu5 = assess_tender.categorize(None, REAL[1][1], taxonomy=tax)
    v, _ = assess_tender.assess_fit(scmu5, sig, "full_document", arch)
    check(v == "strong_fit", f"architects on the ECDPWI architectural PSP: strong_fit ({v})")

    class FakeClient:
        def __init__(self, rows, fail=False):
            self.rows, self.fail = rows, fail

        def select(self, table, filters=None, order=None):
            if self.fail:
                raise RuntimeError("relation \"discipline_categories\" does not exist")
            assert table == "discipline_categories"
            return self.rows

    db_rows = [taxonomy.db_row(r, (i + 1) * 10, "seed") for i, r in enumerate(rows)]
    hydro = "Appointment of a service provider for the hydrographic survey of the Port of Ngqura entrance channel"
    before = assess_tender.categorize(None, hydro, taxonomy=taxonomy.Taxonomy(taxonomy.rows_from_db(db_rows), "t"))
    new_row = taxonomy.db_row({"slug": "hydrographic_survey", "label": "Hydrographic & bathymetric survey", "parent": "professional_services",
                               "keywords": ["hydrographic survey*", "bathymetric*"]}, 9999, "test")
    live = taxonomy.load_taxonomy(FakeClient(db_rows + [new_row]))
    after = assess_tender.categorize(None, hydro, taxonomy=live)
    check("hydrographic_survey" not in before and "hydrographic_survey" in after and live.source == "discipline_categories table",
          f"a category that exists only as a table ROW is used at once ({before} -> {after})")
    check(live.parent_of("hydrographic_survey") == "professional_services" and
          live.overlap(["hydrographic_survey"], ["professional_services"])[0] == ["hydrographic_survey"],
          "...and sits in its group for fit matching")
    fb = taxonomy.load_taxonomy(FakeClient([], fail=True))
    check(fb.source.startswith("seed file (could not read") and len(fb.rows) == len(rows),
          f"unreadable table -> seed, and says why ({fb.source[:60]})")

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump([{"tender_No": n, "description": t, "category": "Services: General"} for n, t, _, _ in REAL] +
                  [{"tender_No": "X", "description": "RFQJW69BZ2026 -GAUSONIC GT100 BL-100", "category": "Other service activities"}], f)
    res = taxonomy.coverage(f.name, show_uncategorized=0, tax=tax)
    os.unlink(f.name)
    check(res["total"] == len(REAL) + 1 and res["uncategorized"] == 1, f"coverage review reports the uncategorised one ({res['uncategorized']})")


def part2(psql):
    print("Part 2 - the real table (replayed migrations)")

    def sql(q, as_user=False):
        if as_user:
            q = "set role authenticated; " + q
        return subprocess.run(shlex.split(psql) + ["-q", "-tA", "-c", q], capture_output=True, text=True)

    r = sql("select count(*), count(*) filter (where parent_slug is null) from discipline_categories")
    check(r.stdout.strip() == "112|19", f"seed rows: 112 categories, 19 groups ({r.stdout.strip()})")
    sql("delete from discipline_categories where slug in ('hydrographic_survey', 'deep_child')")
    r = sql("insert into discipline_categories (slug, label, parent_slug, keywords, added_from) values "
            "('hydrographic_survey', 'Hydrographic & bathymetric survey', 'professional_services', "
            "array['hydrographic survey*', 'bathymetric*'], 'test_taxonomy.py') returning slug")
    check(r.returncode == 0 and r.stdout.strip() == "hydrographic_survey", f"a new category is one INSERT, no migration {r.stderr.strip()[:120]}")
    r = sql("insert into discipline_categories (slug, label, parent_slug) values ('deep_child', 'x', 'road_maintenance')")
    check(r.returncode != 0 and "two levels only" in r.stderr, "a third level is refused")
    r = sql("insert into discipline_categories (slug, label) values ('Bad Slug', 'x')")
    check(r.returncode != 0, "a non-slug key is refused")
    # Supabase grants ALL on public tables to `authenticated` and leaves the
    # restricting to RLS; the scratch DB has no such default, so mirror it.
    sql("grant usage on schema public to authenticated; grant all on discipline_categories to authenticated")
    r = sql("select count(*) from discipline_categories", as_user=True)
    check(r.returncode == 0 and int(r.stdout.strip() or 0) == 113, f"signed-in users read the list ({r.stdout.strip()})")
    r = sql("insert into discipline_categories (slug, label) values ('user_added', 'x')", as_user=True)
    check(r.returncode != 0, "signed-in users cannot write it (service role only)")

    r = sql("select id from companies limit 1")
    if not r.stdout.strip():
        sql("insert into companies (legal_name) values ('Taxonomy Test Co')")
    co = sql("select id from companies limit 1").stdout.strip()
    tid = sql("select id from tenders limit 1").stdout.strip()
    sql(f"delete from tender_packs where company_id = '{co}' and tender_id = '{tid}'")
    r = sql(f"insert into tender_packs (company_id, tender_id, price_sector) values ('{co}', '{tid}', 'roads_civil') returning id")
    check(r.returncode == 0, f"price_sector: a legacy group value (roads_civil) is still valid {r.stderr.strip()[:160]}")
    pid = r.stdout.strip().splitlines()[0] if r.returncode == 0 else None
    if pid:
        r = sql(f"update tender_packs set price_sector = 'geotechnical_investigation' where id = '{pid}'")
        check(r.returncode == 0, "price_sector: a new discipline is valid")
        r = sql(f"update tender_packs set price_sector = 'hydrographic_survey' where id = '{pid}'")
        check(r.returncode == 0, "price_sector: a category inserted a moment ago is valid - no migration")
        r = sql(f"update tender_packs set price_sector = 'bogus_sector' where id = '{pid}'")
        check(r.returncode != 0, "price_sector: a slug not on the list is refused (FK)")
        sql(f"delete from tender_packs where id = '{pid}'")

    class PsqlClient:
        def select(self, table, filters=None, order=None):
            out = sql(f"select coalesce(json_agg(t order by sort_order), '[]') from {table} t").stdout
            return json.loads(out)

    live = taxonomy.load_taxonomy(PsqlClient())
    got = assess_tender.categorize(None, "Hydrographic survey of the Port of Ngqura entrance channel", taxonomy=live)
    check(live.source == "discipline_categories table" and "hydrographic_survey" in got,
          f"categorize() reads the live table and uses the new row ({got})")
    sql("delete from discipline_categories where slug = 'hydrographic_survey'")


def main():
    part1()
    psql = os.environ.get("TAXONOMY_PSQL")
    if psql:
        part2(psql)
    else:
        print("(Part 2 skipped - set TAXONOMY_PSQL to a scratch Postgres with the migrations replayed)")
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
