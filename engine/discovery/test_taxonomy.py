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

Part 1 also checks the eTenders cross-check (audit O1, 0054): the buyer's
own eTenders category compared with Tender Tool's categories for real live
tenders (agrees / differs / generic / unmapped), never changing them.

Part 3 (TAXONOMY_PSQL set): the in-app maintenance of 0054 - only a platform
admin writes the list; a company member suggests their own tag (pending),
can't for another company or with another company's item, can't approve;
the admin approves (category created with the same slug, the company's
tagged item is then on the list) or rejects with a note.

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

    # eTenders cross-check (0054, audit O1). Real live tenders, 2026-10-17
    # (Home/PaginatedTenderOpportunities: description + the buyer's category).
    XREF = [
        ("Britstown Magistrate Court: Cleaning services for 36 months",
         "Services: Functional (Including Cleaning and Security Services)", "agrees"),
        ("Tender for the leasing of turnkey office space in region 2 inclusive of parking facilities",
         "Rental and leasing activities", "agrees"),
        ("SUPPLY AND DELIVERY OF FRESH MEAT ON AN AS AND WHEN REQUIRED BASIS FOR A PERIOD OF 3 YEARS TO KRIEL POWER STATION.",
         "Food and beverage service activities", "differs"),
        ("THE SUPPLY AND DELIVERY OF OPTICAL ASSISTIVE DEVICES TO THE GAUTENG DEPARTMENT OF HEALTH INSTITUTIONS",
         "Supplies: Medical", "differs"),
        ("The Maintenance and repairs of vehicles for King Shaka International Airport",
         "Services: General", "generic"),
    ]
    for text, site, want in XREF:
        cats = assess_tender.categorize(None, text, taxonomy=tax)
        x = tax.etenders_crosscheck(cats, site)
        check(x["status"] == want and x["site_category"] == site,
              f"eTenders '{site}' vs {cats}: {x['status']} ({x['note'][:90]})")
    optical = tax.etenders_crosscheck(assess_tender.categorize(None, XREF[3][0], taxonomy=tax), "Supplies: Medical")
    check("medical_supplies_equipment" in optical["matching_categories"],
          "a 'differs' names the categories the buyer's entry corresponds to (optical devices -> medical supplies)")
    x = tax.etenders_crosscheck(["uncategorized_goods"], "Real estate activities")
    check(x["status"] == "differs" and "couldn't categorise" in x["note"], "uncategorised by Tender Tool: the buyer's category is offered as a hint")
    check(tax.etenders_crosscheck(["catering"], "Some Entry Not On The Site") ["status"] == "unmapped", "an entry no category lists -> unmapped")
    check(tax.etenders_crosscheck(["catering"], None) is None, "no site category -> no cross-check (never guessed)")
    rel = {"title": XREF[2][0], "description": XREF[2][0], "procurement_category": "goods", "is_closed": True,
           "etenders_category": "Food and beverage service activities"}
    reading = assess_tender.read_release(rel, fetch_document=False)
    scored = assess_tender.score_release(rel, reading, {"disciplines": ["food_provisions"], "has_cidb_grading": False})
    check(scored["categories"] == assess_tender.categorize(rel["title"], rel["description"], "goods")
          and scored["etenders_category"] == "Food and beverage service activities"
          and scored["etenders_category_check"]["status"] == "differs",
          "read/score_release carry the cross-check next to the (unchanged) categories")


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


def part3(psql):
    print("Part 3 - in-app maintenance (0054): platform admin writes, company suggestions reviewed")

    def sql(q, uid=None):
        if uid:
            q = f"set role authenticated; set test.uid = '{uid}'; " + q
        return subprocess.run(shlex.split(psql) + ["-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", q], capture_output=True, text=True)

    ua, ub, ad = "a0000000-0000-0000-0000-00000000000a", "b0000000-0000-0000-0000-00000000000b", "ad000000-0000-0000-0000-0000000000ad"
    sql("delete from discipline_category_suggestions where slug like 'tt_test_%'; delete from discipline_categories where slug like 'tt_test_%';"
        f"delete from platform_admins where user_id in ('{ua}','{ub}','{ad}');"
        "delete from companies where legal_name in ('O2 Company A', 'O2 Company B');"
        f"delete from auth.users where id in ('{ua}','{ub}','{ad}');"
        f"insert into auth.users (id, email) values ('{ua}','a@test'),('{ub}','b@test'),('{ad}','admin@test');"
        f"insert into platform_admins (user_id, note) values ('{ad}', 'test admin');")
    ca = sql("insert into companies (legal_name) values ('O2 Company A') returning id").stdout.strip().splitlines()[0]
    cb = sql("insert into companies (legal_name) values ('O2 Company B') returning id").stdout.strip().splitlines()[0]
    sql(f"insert into company_members (company_id, user_id, role) values ('{ca}','{ua}','owner'),('{cb}','{ub}','owner')")
    ia = sql(f"insert into experience_items (company_id, project_name, document_type, disciplines) values "
             f"('{ca}', 'Port Ngqura channel survey', 'reference_letter', array['tt_test_hydro']) returning id").stdout.strip().splitlines()[0]
    ib = sql(f"insert into experience_items (company_id, project_name, document_type) values ('{cb}', 'B project', 'reference_letter') returning id").stdout.strip().splitlines()[0]

    # the list: owners of a company are NOT platform admins
    r = sql("insert into discipline_categories (slug, label) values ('tt_test_owner', 'x')", ua)
    check(r.returncode != 0, "a company owner can't add to the shared list")
    r = sql("update discipline_categories set label = 'hacked' where slug = 'catering' returning slug", ua)
    check(r.stdout.strip() == "", "a company owner can't edit a shared category (0 rows)")
    r = sql("insert into discipline_categories (slug, label, parent_slug, keywords) values "
            "('tt_test_added', 'Added in the app', 'professional_services', array['tt test keyword']) returning slug", ad)
    check(r.returncode == 0 and r.stdout.strip() == "tt_test_added", f"the platform admin adds a discipline {r.stderr.strip()[:150]}")
    r = sql("update discipline_categories set label = 'Renamed', active = false where slug = 'tt_test_added' returning label, active", ad)
    check(r.stdout.strip() == "Renamed|f", "the platform admin renames / retires it")
    r = sql("update discipline_categories set parent_slug = 'water' where slug = 'roads_civil'", ad)
    check(r.returncode != 0 and "must stay a group" in r.stderr, "a group with disciplines can't be moved under another group (no third level)")
    r = sql("delete from discipline_categories where slug = 'tt_test_added' returning slug", ad)
    check(r.stdout.strip() == "", "not even the admin deletes (retire instead)")
    r = sql("select is_platform_admin()", ad)
    r2 = sql("select is_platform_admin()", ua)
    check(r.stdout.strip() == "t" and r2.stdout.strip() == "f", "is_platform_admin(): true for the admin, false for an owner")

    # suggestions
    r = sql(f"insert into discipline_category_suggestions (company_id, slug, label, suggested_parent_slug, note, example_item_id, suggested_by) "
            f"values ('{ca}', 'tt_test_hydro', 'Hydrographic survey', 'professional_services', 'surveys of channels', '{ia}', '{ua}') "
            "returning status, company_name, example_project_name", ua)
    check(r.returncode == 0 and r.stdout.strip() == "pending|O2 Company A|Port Ngqura channel survey",
          f"a member suggests their own tag: pending, with company and project name for the reviewer ({r.stdout.strip()} {r.stderr.strip()[:120]})")
    r = sql(f"insert into discipline_category_suggestions (company_id, slug, label, suggested_by) values ('{ca}', 'tt_test_hydro', 'again', '{ua}')", ua)
    check(r.returncode != 0 and "one_pending" in r.stderr, "the same tag twice while pending -> refused")
    r = sql(f"insert into discipline_category_suggestions (company_id, slug, label, suggested_by) values ('{cb}', 'tt_test_b', 'x', '{ua}')", ua)
    check(r.returncode != 0, "a member can't suggest on behalf of another company")
    r = sql(f"insert into discipline_category_suggestions (company_id, slug, label, example_item_id, suggested_by) values ('{ca}', 'tt_test_x', 'x', '{ib}', '{ua}')", ua)
    check(r.returncode != 0 and "not this company" in r.stderr, "...nor point at another company's experience item")
    r = sql(f"insert into discipline_category_suggestions (company_id, slug, label, suggested_by) values ('{ca}', 'road_maintenance', 'x', '{ua}')", ua)
    check(r.returncode != 0 and "already on the shared list" in r.stderr, "a slug already on the list can't be suggested")
    r = sql(f"insert into discipline_category_suggestions (company_id, slug, label, suggested_by, status) values ('{ca}', 'tt_test_y', 'x', '{ua}', 'approved')", ua)
    check(r.returncode != 0, "a member can't file it as already approved")
    sid = sql("select id from discipline_category_suggestions where slug = 'tt_test_hydro'").stdout.strip()
    r = sql("select count(*) from discipline_category_suggestions where slug = 'tt_test_hydro'", ub)
    check(r.stdout.strip() == "0", "company B doesn't see company A's suggestion")
    r = sql("select count(*) from discipline_category_suggestions where slug = 'tt_test_hydro'", ad)
    check(r.stdout.strip() == "1", "the platform admin sees it")
    r = sql(f"update discipline_category_suggestions set status = 'approved' where id = '{sid}' returning id", ua)
    check(r.stdout.strip() == "", "the suggesting member can't approve it")
    r = sql(f"select approve_discipline_suggestion('{sid}', 'x', null)", ua)
    check(r.returncode != 0 and "Only a platform admin" in r.stderr, "...not through the approve function either")
    r = sql(f"select approve_discipline_suggestion('{sid}', 'Hydrographic & bathymetric survey', 'professional_services', "
            "array['hydrographic survey*', 'bathymetric*'], '{}', 'Added - thanks')", ad)
    check(r.returncode == 0 and r.stdout.strip() == "tt_test_hydro", f"the admin approves {r.stderr.strip()[:150]}")
    r = sql("select c.label, c.parent_slug, s.status, s.created_category_slug, s.review_note, s.company_name from discipline_categories c "
            "join discipline_category_suggestions s on s.slug = c.slug where c.slug = 'tt_test_hydro'")
    check(r.stdout.strip() == "Hydrographic & bathymetric survey|professional_services|approved|tt_test_hydro|Added - thanks|O2 Company A",
          f"...the category exists under the same slug, the suggestion is approved with the note ({r.stdout.strip()})")
    r = sql("select count(*) from experience_items e join discipline_categories c on c.slug = any(e.disciplines) "
            f"where e.id = '{ia}' and c.slug = 'tt_test_hydro'", ua)
    check(r.stdout.strip() == "1", "company A's tagged item is now under a listed category - its data unchanged")
    r = sql(f"select approve_discipline_suggestion('{sid}', 'x', null)", ad)
    check(r.returncode != 0 and "already approved" in r.stderr, "approving twice is refused")

    class PsqlClient:
        def select(self, table, filters=None, order=None):
            return json.loads(sql(f"select coalesce(json_agg(t order by sort_order), '[]') from {table} t").stdout)

    live = taxonomy.load_taxonomy(PsqlClient())
    got = assess_tender.categorize(None, "Bathymetric survey of the Port of Ngqura", taxonomy=live)
    check("tt_test_hydro" in got, f"Discovery sorts into the approved category on its next run ({got})")

    sql(f"insert into discipline_category_suggestions (company_id, slug, label, suggested_by) values ('{ca}', 'tt_test_rej', 'Survey stuff', '{ua}')", ua)
    rid = sql("select id from discipline_category_suggestions where slug = 'tt_test_rej'").stdout.strip()
    r = sql(f"update discipline_category_suggestions set status = 'rejected', reviewed_by = '{ad}', reviewed_at = now(), "
            f"review_note = 'Covered by Land surveying, GIS & mapping', company_name = 'forged' where id = '{rid}' returning company_name", ad)
    check(r.stdout.strip() == "O2 Company A", "the admin rejects with a note; review can't rewrite what was suggested")
    r = sql("select status, review_note from discipline_category_suggestions where slug = 'tt_test_rej'", ua)
    check(r.stdout.strip() == "rejected|Covered by Land surveying, GIS & mapping", "the company sees the outcome and the note")
    sql(f"insert into discipline_category_suggestions (company_id, slug, label, suggested_by) values ('{ca}', 'tt_test_wd', 'w', '{ua}')", ua)
    r = sql("delete from discipline_category_suggestions where slug = 'tt_test_wd' returning slug", ua)
    check(r.stdout.strip() == "tt_test_wd", "a member withdraws a pending suggestion")
    r = sql("delete from discipline_category_suggestions where slug = 'tt_test_hydro' returning slug", ua)
    check(r.stdout.strip() == "", "...but not a reviewed one")
    r = sql(f"delete from experience_items where id = '{ia}'")
    r2 = sql("select example_item_id is null, example_project_name from discipline_category_suggestions where slug = 'tt_test_hydro'")
    check(r.returncode == 0 and r2.stdout.strip() == "t|Port Ngqura channel survey",
          "deleting the example item keeps the suggestion (link set null, the snapshot name stays)")

    sql("delete from discipline_category_suggestions where slug like 'tt_test_%'; delete from discipline_categories where slug like 'tt_test_%';"
        f"delete from companies where id in ('{ca}','{cb}'); delete from platform_admins where user_id = '{ad}';"
        f"delete from auth.users where id in ('{ua}','{ub}','{ad}')")


def main():
    part1()
    psql = os.environ.get("TAXONOMY_PSQL")
    if psql:
        part2(psql)
        part3(psql)
    else:
        print("(Part 2 skipped - set TAXONOMY_PSQL to a scratch Postgres with the migrations replayed)")
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
