"""
Migration 0050: directors & shareholders register, the shared registrations
catalog (company / person / both scopes, many per holder), restricted bank
accounts, landlord property records - and the expiry reminders that read the
catalog through the SAME watch_deadlines mechanism.

Part 1 (always, no network): registration_reminders.find_due_registrations()
/ find_due_property_documents() over in-memory rows (the fake PostgREST from
test_watch_deadlines_urgency.py): company-held -> "document", person- and
director-held -> "person_credential", renew-soon then expired, second run
silent, routing through daily_digest.

Part 2 (REGISTRATION_PSQL set): a scratch Postgres with every migration
replayed (0001 -> 0050, every migration on main). Realistic multi-director company built with SQL
(synthetic people - the ID numbers are made up, Luhn-valid, not real):

  Thandeka Ndlovu   director + 40 %  African woman, 32 (youth)
  Pieter v d Merwe  director + 25 %  white man, 58
  Ayesha Patel      shareholder 20 % Indian woman, 45, disability
  Ndlovu Family Trust shareholder 15 % (juristic - unclassified)
  Sipho Mokoena     director only, non-executive

and checked: derived ownership breakdown, the 100 % cap, director-with-
shares refused, scope rules (company-only type on a person, person-only type
on the company, a stored_in type, another company's private type, another
company's person), multiple held by one holder, RLS between two companies,
bank accounts owner/admin-only with a masked summary for members, storage
paths outside the company folder, property documents across companies; then
the reminder finders on the real rows.

    REGISTRATION_PSQL="psql -h /tmp/dirpg/sock -p 54461 -U postgres -d dirtest" \\
        python3 engine/compliance/test_principals_registrations.py
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
import registration_reminders as rr  # noqa: E402
import test_watch_deadlines_urgency as fixture  # noqa: E402

TODAY = fixture.TODAY
D = fixture.D
FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def part1():
    print("Part 1 - in-memory")
    fixture.ROWS.clear()
    fixture.ROWS.update({
        "companies": [{"id": "co1", "legal_name": "Catalog Test Co"}],
        "people": [{"id": "p1", "company_id": "co1", "name": "Nurse Nomsa"}],
        "company_principals": [{"id": "dir1", "company_id": "co1", "full_name": "Sipho Director"}],
        "registration_types": [
            {"id": "rt-seta", "slug": "seta_accreditation", "label": "SETA accreditation (skills development provider)"},
            {"id": "rt-hpcsa", "slug": "hpcsa", "label": "HPCSA registration"},
            {"id": "rt-psira", "slug": "psira", "label": "PSIRA registration + letter of good standing"},
        ],
        "held_registrations": [
            {"id": "h1", "company_id": "co1", "registration_type_id": "rt-seta", "person_id": None, "principal_id": None,
             "registration_number": "MICT-ACC-2231", "category": "SAQA 48872", "expiry_date": D(20)},
            {"id": "h2", "company_id": "co1", "registration_type_id": "rt-seta", "person_id": None, "principal_id": None,
             "registration_number": "ETDP-0917", "category": "SAQA 50334", "expiry_date": D(400)},
            {"id": "h3", "company_id": "co1", "registration_type_id": "rt-hpcsa", "person_id": "p1", "principal_id": None,
             "registration_number": "MP 0123456", "category": None, "expiry_date": D(-3)},
            {"id": "h4", "company_id": "co1", "registration_type_id": "rt-psira", "person_id": None, "principal_id": "dir1",
             "registration_number": "3456789", "category": "Grade A", "expiry_date": D(45)},
            {"id": "h5", "company_id": "co1", "registration_type_id": "rt-psira", "person_id": None, "principal_id": None,
             "registration_number": "2999111", "category": None, "expiry_date": None},
        ],
        "company_properties": [{"id": "prop1", "company_id": "co1", "label": "Joubertina Main Rd offices"}],
        "property_documents": [
            {"id": "pd1", "company_id": "co1", "property_id": "prop1", "document_type": "building_insurance",
             "reference_number": "POL-77", "valid_until": D(10)},
            {"id": "pd2", "company_id": "co1", "property_id": "prop1", "document_type": "title_deed",
             "reference_number": "T1234/2011", "valid_until": None},
        ],
    })
    wd.supabase_request = fixture.fake_request
    seen = {}
    due = rr.find_due_registrations("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    for d in due:
        print("   ", {k: d.get(k) for k in ("type", "person_name", "label", "registration_number", "days_left", "status")})
    by = {d["held_registration_id"]: d for d in due}
    check(by.get("h1", {}).get("type") == "document" and by["h1"]["status"] == "renew_soon" and by["h1"]["days_left"] == 20,
          "company-held SETA accreditation in 20 days -> document, renew soon")
    check("h2" not in by, "the company's SECOND SETA accreditation (400 days) -> not reported (each row tracked separately)")
    check(by.get("h3", {}).get("type") == "person_credential" and by["h3"]["status"] == "expired"
          and by["h3"]["person_name"] == "Nurse Nomsa", "person-held HPCSA lapsed 3 days ago -> person_credential, expired, named")
    check(by.get("h4", {}).get("person_name") == "Sipho Director" and by["h4"]["type"] == "person_credential",
          "director-held PSIRA (45 days) -> person_credential naming the director")
    check("h5" not in by, "registration with no expiry recorded -> nothing (never treated as expired)")
    check(all("id_number" not in d for d in due), "no personal identifiers in any reminder item")
    check(all(isinstance(v, dict) and v.get("company_id") == "co1" for v in seen.values()),
          "every seen entry carries its company (needed by the database seen store)")
    props = rr.find_due_property_documents("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    check(len(props) == 1 and props[0]["label"] == "Building insurance - Joubertina Main Rd offices" and props[0]["days_left"] == 10,
          "property building insurance in 10 days -> reported with the building's name; title deed (no date) not")
    again = rr.find_due_registrations("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS) + \
        rr.find_due_property_documents("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    check(not again, "second run the same day reports nothing new")
    later = rr.find_due_registrations("u", "k", seen, TODAY + datetime.timedelta(days=21), wd.DEFAULT_DOC_LEAD_DAYS)
    check(any(d["held_registration_id"] == "h1" and d["status"] == "expired" for d in later),
          "21 days later the SETA accreditation is reported again as expired (escalation)")

    import daily_digest  # noqa: E402
    signals = {"new_tenders": [], "document_expiry": due + props, "tender_tasks": [], "readiness_changes": [], "submission_due": []}
    cv = daily_digest.build_digest_for_person({"name": "x", "tender_role": "cv_admin", "company_name": "x"}, signals)
    fin = daily_digest.build_digest_for_person({"name": "x", "tender_role": "finance", "company_name": "x"}, signals)
    check(len(cv.get("document_expiry") or []) == 2, "cv_admin digest gets the 2 person/director registrations")
    check(len(fin.get("document_expiry") or []) == 2, "finance digest gets the company accreditation + property document")


# ---------------------------------------------------------------------------
# Part 2
# ---------------------------------------------------------------------------

def psql_request(psql):
    def req(url, key, path):
        table, _, query = path.partition("?")
        params = urllib.parse.parse_qs(query)
        cols = params["select"][0]
        where = []
        for k, vals in params.items():
            if k in ("select", "order"):
                continue
            v = vals[0]
            m = re.match(r"in\.\((.*)\)", v)
            if m:
                ids = ",".join("'" + x.replace("'", "''") + "'" for x in m.group(1).split(","))
                where.append(f"{k}::text in ({ids})")
            elif v == "not.is.null":
                where.append(f"{k} is not null")
            else:
                raise AssertionError(f"stand-in doesn't understand {k}={v}")
        sql = (f"select coalesce(json_agg(t), '[]') from (select {cols} from {table}"
               f"{' where ' + ' and '.join(where) if where else ''}) t")
        out = subprocess.run(shlex.split(psql) + ["-tAc", sql], capture_output=True, text=True, check=True).stdout
        return json.loads(out)
    return req


def part2(psql):
    print("Part 2 - replayed Postgres (0001 -> 0050, every migration on main)")
    base = shlex.split(psql) + ["-q", "-v", "ON_ERROR_STOP=1", "-tA"]

    def run(sql):
        r = subprocess.run(base + ["-c", sql], capture_output=True, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()

    def as_user(uid, sql):
        return run(f"begin; set local role authenticated; set local test.uid = '{uid}'; {sql}; commit;")

    def one(sql):
        code, out, err = run(sql)
        if code:
            raise AssertionError(err)
        return out.splitlines()[-1] if out else ""

    today = datetime.date.today()
    d = lambda n: (today + datetime.timedelta(days=n)).isoformat()  # noqa: E731
    run("delete from companies where legal_name in ('Test Ndlovu Facilities (Pty) Ltd', 'Test Other Co (Pty) Ltd');"
        "delete from auth.users where email like '%@q-md.test'")
    owner = one("insert into auth.users (email) values ('owner@q-md.test') returning id")
    member = one("insert into auth.users (email) values ('member@q-md.test') returning id")
    other = one("insert into auth.users (email) values ('other@q-md.test') returning id")
    co = one("insert into companies (legal_name, black_ownership_pct, director_name) "
             "values ('Test Ndlovu Facilities (Pty) Ltd', 51, 'T Ndlovu') returning id")
    co2 = one("insert into companies (legal_name) values ('Test Other Co (Pty) Ltd') returning id")
    run(f"insert into company_members (company_id, user_id, role) values ('{co}', '{owner}', 'owner'), "
        f"('{co}', '{member}', 'member'), ('{co2}', '{other}', 'owner')")
    nurse = one(f"insert into people (company_id, name) values ('{co}', 'Test Nurse Nomsa') returning id")
    other_person = one(f"insert into people (company_id, name) values ('{co2}', 'Test Other Person') returning id")

    # --- A. the register, written as the company's own MEMBER under RLS ----
    code, out, err = as_user(member, f"""
      insert into company_principals (company_id, role, position, executive, full_name, id_number, sa_citizen, gender, race,
                                      ownership_pct, popia_consent_on, certified_id_path, certified_id_on)
      values ('{co}', 'both', 'Managing Director', true, 'Thandeka Ndlovu', '9404150120082', true, 'female', 'african', 40,
              '{d(-10)}', '{co}/principals/thandeka/id/abc-id.pdf', '{d(-20)}'),
             ('{co}', 'both', 'Director', true, 'Pieter van der Merwe', '6803025123085', true, 'male', 'white', 25, '{d(-10)}', null, null),
             ('{co}', 'shareholder', null, null, 'Ayesha Patel', '8107230164084', true, 'female', 'indian', 20, null, null, null),
             ('{co}', 'director', 'Non-executive director', false, 'Sipho Mokoena', '7509105781085', true, 'male', 'african', null, '{d(-5)}', null, null)
      returning id""")
    check(code == 0, f"member writes 4 natural-person principals under RLS {err[:160]}")
    code, out, err = as_user(member, f"update company_principals set disability = true where full_name = 'Ayesha Patel'")
    check(code == 0, "disability recorded for one shareholder")
    code, out, err = as_user(member, f"""insert into company_principals (company_id, role, holder_type, full_name, entity_registration_number, ownership_pct)
                                       values ('{co}', 'shareholder', 'juristic_person', 'Ndlovu Family Trust', 'IT 1234/2015', 15)""")
    check(code == 0, f"juristic shareholder (trust, 15 %) {err[:160]}")
    code, out, err = as_user(member, f"""insert into company_principals (company_id, role, full_name, ownership_pct)
                                       values ('{co}', 'shareholder', 'One Percent Too Many', 1)""")
    check(code != 0 and "more than 100" in err, "a 101st percent is refused (shareholdings capped at 100 %)")
    code, out, err = as_user(member, f"insert into company_principals (company_id, role, full_name, ownership_pct) values ('{co}', 'director', 'Shares Director', 5)")
    check(code != 0, "a 'director'-only row with a shareholding is refused (use 'both')")
    code, out, err = as_user(member, f"insert into company_principals (company_id, role, full_name, id_number) values ('{co}', 'director', 'Bad Id', '94041501200')")
    check(code != 0, "an 11-digit ID number is refused")
    code, out, err = as_user(member, f"insert into company_principals (company_id, role, full_name, certified_id_path) values ('{co}', 'director', 'Path Thief', '{co2}/principals/x/id/a.pdf')")
    check(code != 0, "a certified-ID path in another company's folder is refused")
    code, out, err = as_user(member, f"insert into company_principals (company_id, role, full_name, person_id) values ('{co}', 'director', 'Linked Wrong', '{other_person}')")
    check(code != 0 and "same company" in err, "linking a principal to another company's person is refused")

    bd = json.loads(one(f"select row_to_json(b) from company_ownership_breakdown b where company_id = '{co}'"))
    print("    breakdown:", {k: bd[k] for k in bd if k != "company_id"})
    expect = {"total_pct": 100, "black_pct": 60, "black_women_pct": 60, "women_pct": 60, "youth_pct": 40,
              "black_youth_pct": 40, "disabled_pct": 20, "black_disabled_pct": 20, "hdi_pct": 60, "unclassified_pct": 15}
    check(all(float(bd.get(k) or 0) == v for k, v in expect.items()) and bd["shareholders"] == 4,
          "derived breakdown: black 60, black women 60, women 60, youth 40, disabled 20, HDI 60, unclassified 15 (trust), total 100")
    code, out, err = as_user(member, f"select count(*) from company_ownership_breakdown where company_id = '{co}'")
    check(out.splitlines()[-1] == "1" if out else False, "member reads own breakdown through the security_invoker view")
    code, out, err = as_user(other, f"select count(*) from company_ownership_breakdown where company_id = '{co}'")
    check(out.splitlines()[-1] == "0" if out else False, "another company sees no breakdown for this company")
    code, out, err = as_user(other, f"select count(*) from company_principals where company_id = '{co}'")
    check(out.splitlines()[-1] == "0" if out else False, "another company sees 0 of this company's principals (ID numbers included)")
    code, out, err = as_user(other, f"insert into company_principals (company_id, role, full_name) values ('{co}', 'director', 'Planted')")
    check(code != 0, "another company can't insert into this company's register")
    code, out, err = as_user(other, f"update company_principals set ownership_pct = 0 where company_id = '{co}' returning id")
    check(code == 0 and not [x for x in out.splitlines() if re.match(r"^[0-9a-f-]{36}$", x)], "another company's update touches 0 rows")
    copied = one(f"select count(*) from company_principals where company_id = '{co}' and full_name = 'T Ndlovu'")
    check(copied == "0", "(0050 copies companies.director_name only for rows that existed when it ran - new companies start empty)")
    sipho = one(f"select id from company_principals where company_id = '{co}' and full_name = 'Sipho Mokoena'")
    thandeka = one(f"select id from company_principals where company_id = '{co}' and full_name = 'Thandeka Ndlovu'")

    # --- B. catalog + holdings ----------------------------------------------
    tid = lambda slug: one(f"select id from registration_types where slug = '{slug}' and owner_company_id is null")  # noqa: E731
    n = one("select count(*) from registration_types where owner_company_id is null")
    scopes = one("select string_agg(distinct scope, ',' order by scope) from registration_types")
    check(int(n) >= 40 and scopes == "both,company,person", f"catalog seeded: {n} shared types across company / person / both")
    code, out, err = as_user(member, f"""
      insert into held_registrations (company_id, registration_type_id, registration_number, category, issued_by, expiry_date)
      values ('{co}', '{tid('seta_accreditation')}', 'MICT-ACC-2231', 'SAQA 48872', 'MICT SETA', '{d(20)}'),
             ('{co}', '{tid('seta_accreditation')}', 'ETDP-0917', 'SAQA 50334', 'ETDP SETA', '{d(400)}'),
             ('{co}', '{tid('waste_licence')}', '12/9/11/L1234/7', null, 'GDARD', '{d(-4)}'),
             ('{co}', '{tid('psira')}', '2999111', null, null, null)""")
    check(code == 0, f"company holds 2 SETA accreditations + a waste licence + PSIRA (company scope / both) {err[:160]}")
    code, out, err = as_user(member, f"""
      insert into held_registrations (company_id, registration_type_id, person_id, registration_number, expiry_date)
      values ('{co}', '{tid('hpcsa')}', '{nurse}', 'MP 0123456', '{d(-3)}')""")
    check(code == 0, f"person (people row) holds HPCSA (person scope) {err[:160]}")
    code, out, err = as_user(member, f"""
      insert into held_registrations (company_id, registration_type_id, principal_id, registration_number, category, expiry_date)
      values ('{co}', '{tid('psira')}', '{sipho}', '3456789', 'Grade A', '{d(45)}'),
             ('{co}', '{tid('sacplan')}', '{thandeka}', 'A/1234/2015', 'Professional Planner', '{d(200)}')""")
    check(code == 0, f"directors hold PSIRA (both) and SACPLAN (person) {err[:160]}")
    code, out, err = as_user(member, f"insert into held_registrations (company_id, registration_type_id) values ('{co}', '{tid('hpcsa')}')")
    check(code != 0 and "held by a person" in err, "person-only type (HPCSA) on the company is refused")
    code, out, err = as_user(member, f"insert into held_registrations (company_id, registration_type_id, person_id) values ('{co}', '{tid('ncca')}', '{nurse}')")
    check(code != 0 and "held by the company" in err, "company-only type (NCCA) on a person is refused")
    code, out, err = as_user(member, f"insert into held_registrations (company_id, registration_type_id, person_id) values ('{co}', '{tid('sacnasp')}', '{nurse}')")
    check(code != 0 and "people.sacnasp_" in err, "SACNASP (stored_in people.sacnasp_*) is refused - one home per fact")
    code, out, err = as_user(member, f"insert into held_registrations (company_id, registration_type_id, person_id) values ('{co}', '{tid('hpcsa')}', '{other_person}')")
    check(code != 0 and "same company" in err, "another company's person as holder is refused")
    code, out, err = as_user(member, f"insert into held_registrations (company_id, registration_type_id, storage_path) values ('{co}', '{tid('waste_licence')}', '{co2}/registrations/x.pdf')")
    check(code != 0, "a certificate path in another company's folder is refused")

    code, out, err = as_user(other, f"""insert into registration_types (slug, label, scope, owner_company_id)
                                      values ('nhbrc_home_builder', 'NHBRC home builder registration', 'company', '{co2}') returning id""")
    custom = [x for x in out.splitlines() if re.match(r"^[0-9a-f-]{36}$", x)]
    check(code == 0 and len(custom) == 1, f"a company adds its own catalog type {err[:160]}")
    code, out, err = as_user(other, "insert into registration_types (slug, label, scope) values ('shared_by_customer', 'x', 'company')")
    check(code != 0, "a company can't add a SHARED catalog row (service role only)")
    code, out, err = as_user(member, f"select count(*) from registration_types where slug = 'nhbrc_home_builder'")
    check(out.splitlines()[-1] == "0" if out else False, "another company's private type is invisible")
    if custom:
        code, out, err = as_user(member, f"insert into held_registrations (company_id, registration_type_id) values ('{co}', '{custom[0]}')")
        check(code != 0, "holding another company's private type is refused")
    code, out, err = as_user(other, f"select count(*) from held_registrations where company_id = '{co}'")
    check(out.splitlines()[-1] == "0" if out else False, "another company sees 0 of this company's registrations")
    multi = one(f"select count(*) from held_registrations h join registration_types t on t.id = h.registration_type_id "
                f"where h.company_id = '{co}' and t.slug = 'seta_accreditation' and h.person_id is null and h.principal_id is null")
    check(multi == "2", "the same entity holds the same type twice (2 SETA accreditations) - many-to-many")

    # --- bank accounts --------------------------------------------------------
    code, out, err = as_user(owner, f"""insert into bank_accounts (company_id, bank_name, branch_code, account_holder, account_type, account_number)
                                      values ('{co}', 'FNB', '250655', 'Test Ndlovu Facilities (Pty) Ltd', 'cheque', '62812345678')""")
    check(code == 0, f"owner stores the company's bank account {err[:160]}")
    code, out, err = as_user(owner, f"""insert into bank_accounts (company_id, principal_id, bank_name, account_holder, account_type, account_number)
                                      values ('{co}', '{sipho}', 'Capitec', 'S Mokoena', 'savings', '1234567890')""")
    check(code == 0, f"owner stores a director's bank account {err[:160]}")
    code, out, err = as_user(member, f"select count(*) from bank_accounts where company_id = '{co}'")
    check(out.splitlines()[-1] == "0" if out else False, "a plain MEMBER reads 0 bank account rows (numbers hidden)")
    code, out, err = as_user(member, f"insert into bank_accounts (company_id, bank_name, account_holder, account_number) values ('{co}', 'X', 'X', '12345678')")
    check(code != 0, "a plain member can't write a bank account")
    code, out, err = as_user(member, f"select string_agg(last4, ',' order by last4) from bank_account_summaries('{co}')")
    check((out.splitlines()[-1] if out else "") == "5678,7890", "member sees the masked summary only: last 4 digits")
    code, out, err = as_user(other, f"select count(*) from bank_account_summaries('{co}')")
    check(out.splitlines()[-1] == "0" if out else False, "another company's summary call for this company returns nothing")
    code, out, err = as_user(other, f"select count(*) from bank_accounts where company_id = '{co}'")
    check(out.splitlines()[-1] == "0" if out else False, "another company's OWNER reads 0 of these bank accounts")
    code, out, err = as_user(owner, f"insert into bank_accounts (company_id, principal_id, bank_name, account_holder, account_number) values ('{co}', '{sipho}', 'X', 'X', '12x45678')")
    check(code != 0, "a non-digit account number is refused")

    # --- C. properties ----------------------------------------------------------
    code, out, err = as_user(member, f"""insert into company_properties (company_id, label, physical_address, erf_number, town, local_municipality,
                                          province, ownership_basis, registered_owner, title_deed_number, gross_lettable_area_m2,
                                          parking_bays_covered, parking_bays_open, sapoa_grade, ground_floor_space, wheelchair_accessible)
                                       values ('{co}', 'Joubertina Main Road offices', '12 Main Road, Joubertina', 'Erf 412', 'Joubertina',
                                               'Kou-Kamma', 'Eastern Cape', 'registered_owner', 'Test Ndlovu Facilities (Pty) Ltd',
                                               'T12345/2011', 160, 2, 10, 'B', true, true) returning id""")
    prop = [x for x in out.splitlines() if re.match(r"^[0-9a-f-]{36}$", x)]
    check(code == 0 and len(prop) == 1, f"property record (the EC Agriculture SCMU8-0143 facts) {err[:160]}")
    if prop:
        code, out, err = as_user(member, f"""insert into property_documents (company_id, property_id, document_type, reference_number, issued_on, valid_until)
                                           values ('{co}', '{prop[0]}', 'title_deed', 'T12345/2011', '2011-05-02', null),
                                                  ('{co}', '{prop[0]}', 'building_insurance', 'POL-77', '{d(-355)}', '{d(10)}'),
                                                  ('{co}', '{prop[0]}', 'pest_control_certificate', null, '{d(-400)}', null)""")
        check(code == 0, f"title deed + insurance + pest control certificate stored {err[:160]}")
        code, out, err = as_user(other, f"insert into property_documents (company_id, property_id, document_type) values ('{co2}', '{prop[0]}', 'title_deed')")
        check(code != 0 and "same company" in err, "another company can't attach a document to this company's property")
        code, out, err = as_user(other, f"select count(*) from company_properties where company_id = '{co}'")
        check(out.splitlines()[-1] == "0" if out else False, "another company sees 0 of these properties")
        code, out, err = as_user(member, f"insert into company_properties (company_id, label, sapoa_grade) values ('{co}', 'x', 'Z')")
        check(code != 0, "an unknown SAPOA grade is refused")

    # --- reminders on the real rows ------------------------------------------------
    wd.supabase_request = psql_request(psql)
    seen = {}
    due = [x for x in rr.find_due_registrations("u", "k", seen, today, wd.DEFAULT_DOC_LEAD_DAYS) if x["company_id"] == co]
    for x in due:
        print("   ", {k: x.get(k) for k in ("type", "person_name", "label", "registration_number", "expiry_date", "days_left", "status")})
    by = {(x["registration_slug"], x.get("person_name")): x for x in due}
    check(by.get(("seta_accreditation", None), {}).get("status") == "renew_soon" and by[("seta_accreditation", None)]["days_left"] == 20,
          "real rows: company SETA accreditation (MICT) in 20 days -> renew soon; the ETDP one (400 days) is not reported")
    check(sum(1 for x in due if x["registration_slug"] == "seta_accreditation") == 1, "real rows: exactly one of the two SETA accreditations is due")
    check(by.get(("waste_licence", None), {}).get("status") == "expired", "real rows: company waste licence lapsed 4 days ago -> expired")
    check(by.get(("hpcsa", "Test Nurse Nomsa"), {}).get("type") == "person_credential", "real rows: person HPCSA lapsed -> person_credential")
    check(by.get(("psira", "Sipho Mokoena"), {}).get("status") == "renew_soon", "real rows: director PSIRA in 45 days -> renew soon")
    check(("sacplan", "Thandeka Ndlovu") not in by, "real rows: director SACPLAN in 200 days -> not reported")
    check(len(due) == 4, f"real rows: exactly 4 items ({len(due)})")
    pdue = [x for x in rr.find_due_property_documents("u", "k", seen, today, wd.DEFAULT_DOC_LEAD_DAYS) if x["company_id"] == co]
    check(len(pdue) == 1 and pdue[0]["days_left"] == 10 and "Joubertina" in pdue[0]["label"], "real rows: building insurance in 10 days -> reported")
    again = [x for x in rr.find_due_registrations("u", "k", seen, today, wd.DEFAULT_DOC_LEAD_DAYS) if x["company_id"] == co]
    check(not again, "real rows: second run reports nothing new")
    # The seen entries go into the database seen store (0041) as-is.
    mine = {k: v for k, v in seen.items() if v.get("company_id") == co}
    values = ",".join(f"('{v['company_id']}', 'watch_deadlines', '{k}', '{v['kind']}', '{v['first_seen']}')" for k, v in mine.items())
    code, _, err = run("insert into deadline_reminders_seen (company_id, consumer, seen_key, kind, first_seen) values " + values) \
        if mine else (1, "", "nothing to store")
    check(code == 0 and len(mine) == 5, f"the 5 seen entries store in deadline_reminders_seen (0041) {err[:160]}")

    run(f"delete from companies where id in ('{co}', '{co2}'); delete from auth.users where email like '%@q-md.test'")
    left = one("select count(*) from company_principals where full_name in ('Thandeka Ndlovu', 'Sipho Mokoena')")
    check(left == "0", "deleting the company removes its principals (cascade)")


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
