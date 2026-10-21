"""
Seeds ONE fixed demo/trial company ("Mzansi Roads & Civils (Pty) Ltd") with
realistic South African sample data, so a sales demo or a brand-new trial
visitor can log into a single shared demo account and see a populated company
on day one, instead of an empty vault - see app/AGENTS.md's "Demo company"
entry for the full design decision (including why this is a static-allowlist
company id in lib/demoCompany.ts, not a new `companies` column).

Same pattern as engine/seed_supabase_company.py: plain REST calls against the
live Supabase project with the service role key (RLS would otherwise block
writing a company row before any company_members row exists). Unlike that
script, this one also has to create its own auth.users row (via the GoTrue
Admin API) and company_members link, since nobody signs this company up
through the normal onboarding flow - it's a fixture, seeded once.

Requires environment variables (see app/.env.local.example):
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Usage:
  python3 seed_demo_company.py            # seed (refuses to run twice - see below)
  python3 seed_demo_company.py --reset    # delete the demo company + its tenders + its
                                           # auth user first, then re-seed (use after a
                                           # fix to this script; cascades do the rest)

Idempotency note: this is a one-off fixture script, not a repeatable migration.
It refuses to run again if a company with DEMO_LEGAL_NAME already exists,
rather than silently creating a second one - use --reset to replace it.
"""
import os
import sys
import json
import urllib.request
import urllib.error
import urllib.parse

DEMO_LEGAL_NAME = "Mzansi Roads & Civils (Pty) Ltd"
DEMO_EMAIL = "demo@mzansiroads.co.za"
DEMO_PASSWORD = "MzansiDemo-2026!"  # not committed anywhere else - see handback report for where this is recorded

TENDER_SLUGS = [
    "demo-n3-section-12-2025-1f",
    "demo-gp-n14-geotechnical-2026",
    "demo-n7-section-3-2026-1f",
]


def req(url, key, method, path, body=None, query=""):
    full = f"{url}/rest/v1/{path}{query}"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        full,
        data=data,
        method=method,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            body_text = resp.read()
            return json.loads(body_text) if body_text else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} failed: {e.code} {e.read().decode()}")


def auth_req(url, key, method, path, body=None):
    r = urllib.request.Request(
        f"{url}/auth/v1/admin/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            body_text = resp.read()
            return json.loads(body_text) if body_text else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} failed: {e.code} {e.read().decode()}")


def main():
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see app/.env.local.example).")
        sys.exit(1)

    reset = "--reset" in sys.argv

    existing = req(url, key, "GET", "companies", query=f"?legal_name=eq.{urllib.parse.quote(DEMO_LEGAL_NAME)}&select=id")
    if existing:
        if not reset:
            print(f"Demo company already exists (id={existing[0]['id']}). Pass --reset to delete and re-seed.")
            sys.exit(0)
        company_id = existing[0]["id"]
        print(f"--reset: deleting existing demo company {company_id} (cascades to people/packs/experience)...")
        req(url, key, "DELETE", "companies", query=f"?id=eq.{company_id}")
        for slug in TENDER_SLUGS:
            req(url, key, "DELETE", "tenders", query=f"?slug=eq.{slug}")
        users = auth_req(url, key, "GET", "users?per_page=200")
        for u in (users or {}).get("users", []):
            if u.get("email") == DEMO_EMAIL:
                auth_req(url, key, "DELETE", f"users/{u['id']}")
                print(f"  deleted auth user {u['id']}")

    print("Upserting demo tenders...")
    tender_rows = req(url, key, "POST", "tenders", [
        {
            "slug": "demo-n3-section-12-2025-1f",
            "contract_no": "N.003-120-2025/1F",
            "nra_reference": "NRA 2025/0512",
            "title": "Routine ad-hoc maintenance of N3 Section 12",
            "description": "Consulting engineering services for the routine ad-hoc maintenance of N3 Section 12 from Mooi River interchange (km 0.0) to Estcourt interchange (km 24.6), KwaZulu-Natal",
            "region": "KwaZulu-Natal",
            "closing_date": "2026-06-18 12:00:00+02",
            "family": "Conventional Consultant Tender",
            "status": "awarded",
        },
        {
            "slug": "demo-gp-n14-geotechnical-2026",
            "contract_no": "GDRT/2026/0098",
            "nra_reference": None,
            "title": "Geotechnical investigation and design review: N14 upgrade",
            "description": "Geotechnical investigation, laboratory testing and design review services for the proposed upgrade of the N14 between Krugersdorp and Lanseria, Gauteng",
            "region": "Gauteng",
            "closing_date": "2026-09-30 12:00:00+02",
            "family": "General (non-SANRAL)",
            "status": "closed",
        },
        {
            "slug": "demo-n7-section-3-2026-1f",
            "contract_no": "N.007-030-2026/1F",
            "nra_reference": "NRA 2026/0118",
            "title": "Routine ad-hoc maintenance of N7 Section 3",
            "description": "Consulting engineering services for the routine ad-hoc maintenance of N7 Section 3 from Vanrhynsdorp (km 0.0) to Klawer (km 31.4), Western Cape",
            "region": "Western Cape",
            "closing_date": "2026-11-27 12:00:00+02",
            "family": "Conventional Consultant Tender",
            "status": "open",
        },
    ], query="?on_conflict=slug")
    by_slug = {t["slug"]: t["id"] for t in tender_rows}
    tender_won = by_slug["demo-n3-section-12-2025-1f"]
    tender_submitted = by_slug["demo-gp-n14-geotechnical-2026"]
    tender_building = by_slug["demo-n7-section-3-2026-1f"]
    print(f"  won={tender_won} submitted={tender_submitted} building={tender_building}")

    print("Inserting demo company...")
    company_rows = req(url, key, "POST", "companies", [{
        "legal_name": DEMO_LEGAL_NAME,
        "csd_trading_name": "Mzansi Roads & Civils",
        "cipc_registration_number": "2014/123456/07",
        "vat_number": "4230198765",
        "income_tax_number": "9234567890",
        "paye_number": "7234567890",
        "csd_supplier_number": "MAAA0123456",
        "coid_registration_number": "COID-7788990",
        "coid_letter_of_good_standing_number": "GS-2026-4471",
        "coid_letter_of_good_standing_expiry": "2027-03-31",
        "bee_level": 2,
        "black_ownership_pct": 68,
        "bee_procurement_recognition_pct": 125,
        "status": "QSE",
        "registered_address": "12 Bosman Street, Pretoria Central, Pretoria, 0002",
        "postal_address": "PO Box 4521, Pretoria, 0001",
        "head_office": "Pretoria",
        "other_offices": 2,
        "ecsa_registered_staff_count": 4,
        "sacpcmp_registered_staff_count": 1,
        "total_employees": 38,
        "typical_jv_share_pct": 40,
        "bank_name": "First National Bank",
        "bank_branch_code": "250655",
        "director_name": "Lindiwe Dlamini",
        "sars_tcs_pin": "261023456789",
        "sars_tcs_pin_expiry": "2027-01-15",
        "pi_insurance_insurer": "Hollard Insurance",
        "pi_insurance_policy_number": "PI-88213-ZA",
        "pi_insurance_cover_zar": 10000000,
        "pi_insurance_expiry": "2027-02-28",
        "iso_9001_certified": False,
        "bank_confirmation_letter_date": "2026-09-20",
        "bee_proof_type": "certificate",
        "bee_proof_expiry": "2027-05-01",
        "telephone": "012 345 6789",
        "cellphone": "082 345 6789",
        "email": "info@mzansiroads.co.za",
        "cidb_grading": "7CE PE",
        "cidb_expiry": "2027-06-30",
        "cidb_registration_number": "10123456",
        "cidb_contractor_name": DEMO_LEGAL_NAME,
        "bee_entity_name": DEMO_LEGAL_NAME,
        "bank_confirmation_bank_name": "First National Bank",
        "bank_confirmation_account_holder": DEMO_LEGAL_NAME,
        "how_we_work": (
            "We are a Pretoria-based civil engineering consultancy specialising in road "
            "rehabilitation and routine maintenance contracts for SANRAL and provincial roads "
            "departments. Our core team covers pavement design, geotechnical investigation and "
            "resident engineering, and we partner with specialist subconsultants for traffic, "
            "structures and environmental work where a tender calls for it."
        ),
    }])
    company_id = company_rows[0]["id"]
    print(f"  company_id = {company_id}")

    print("Inserting demo people...")
    people_rows = req(url, key, "POST", "people", [
        {
            "company_id": company_id, "name": "Lindiwe Dlamini",
            "role": "Director / Principal Engineer", "signatory_capacity": "Director",
            "phone": "082 345 6789", "email": "lindiwe@mzansiroads.co.za",
            "ecsa_level": "Pr Eng", "ecsa_number": "20050123", "ecsa_date": "2005-04-12",
            "highest_level": "BEng (Civil Engineering)", "highest_institution": "University of Pretoria",
            "highest_graduated": "2000-12-01",
            "initial_description": "BEng (Civil Engineering)", "initial_institution": "University of Pretoria",
            "initial_graduated": "2000-12-01", "employment_status": "full_time_employee",
        },
        {
            "company_id": company_id, "name": "Johan van der Merwe",
            "role": "Resident Engineer", "signatory_capacity": None,
            "phone": "083 567 1234", "email": "johan@mzansiroads.co.za",
            "ecsa_level": "Pr Tech Eng", "ecsa_number": "20130456", "ecsa_date": "2013-09-01",
            "highest_level": "BTech (Civil Engineering)", "highest_institution": "Tshwane University of Technology",
            "highest_graduated": "2012-11-01",
            "initial_description": "BTech (Civil Engineering)", "initial_institution": "Tshwane University of Technology",
            "initial_graduated": "2012-11-01", "employment_status": "full_time_employee",
        },
        {
            "company_id": company_id, "name": "Naledi Khumalo",
            "role": "Candidate Engineer (Pavements)", "signatory_capacity": None,
            "phone": "071 998 2234", "email": "naledi@mzansiroads.co.za",
            "ecsa_level": "Candidate Engineer", "ecsa_number": "20210987", "ecsa_date": "2021-02-01",
            "highest_level": "BEng (Civil Engineering)", "highest_institution": "University of the Witwatersrand",
            "highest_graduated": "2020-12-01",
            "initial_description": "BEng (Civil Engineering)", "initial_institution": "University of the Witwatersrand",
            "initial_graduated": "2020-12-01", "employment_status": "full_time_employee",
        },
    ])
    lindiwe_id, johan_id, naledi_id = (p["id"] for p in people_rows)
    print(f"  lindiwe={lindiwe_id} johan={johan_id} naledi={naledi_id}")

    print("Creating demo auth user...")
    user = auth_req(url, key, "POST", "users", {
        "email": DEMO_EMAIL, "password": DEMO_PASSWORD, "email_confirm": True,
    })
    user_id = user["id"]
    print(f"  user_id = {user_id}")

    print("Linking company_members (owner)...")
    req(url, key, "POST", "company_members", [{"company_id": company_id, "user_id": user_id, "role": "owner"}])

    print("Inserting tender_packs (won / submitted / assessing & building)...")
    pack_rows = req(url, key, "POST", "tender_packs", [
        {
            "company_id": company_id, "tender_id": tender_won, "status": "confirmed",
            "pipeline_stage": "won", "submitted_at": "2026-06-10T09:00:00+02",
            "submitted_price_zar": 4870000, "submitted_price_incl_vat": True,
            "submitted_by_person_id": lindiwe_id,
        },
        {
            "company_id": company_id, "tender_id": tender_submitted, "status": "confirmed",
            "pipeline_stage": "submitted", "submitted_at": "2026-09-28T14:30:00+02",
            "submitted_price_zar": 1250000, "submitted_price_incl_vat": True,
            "submitted_by_person_id": lindiwe_id,
        },
        {
            "company_id": company_id, "tender_id": tender_building, "status": "suggested",
            "pipeline_stage": "bidding", "submitted_at": None,
            "submitted_price_zar": None, "submitted_price_incl_vat": True,
            "submitted_by_person_id": None,
        },
    ])
    pack_by_tender = {p["tender_id"]: p["id"] for p in pack_rows}
    pack_building = pack_by_tender[tender_building]
    print(f"  pack_building = {pack_building}")

    print("Inserting tender_requirements for the Assessing & building tender...")
    req(url, key, "POST", "tender_requirements", [
        {"tender_id": tender_building, "position_code": "PL", "position_description": "Professional Leader", "managerial": True},
        {"tender_id": tender_building, "position_code": "RE", "position_description": "Resident Engineer", "managerial": False},
        {"tender_id": tender_building, "position_code": "DS1", "position_description": "Design Specialist 1 - Pavement and Materials", "managerial": False},
    ])

    print("Inserting tender_pack_assignments (2 confirmed, 1 awaiting confirmation)...")
    req(url, key, "POST", "tender_pack_assignments", [
        {
            "tender_pack_id": pack_building, "position_code": "PL",
            "suggested_person_id": lindiwe_id, "suggested_score": 92,
            "suggested_rationale": "Pr Eng, 25 years, led 6 SANRAL routine maintenance contracts",
            "confirmed_person_id": lindiwe_id,
        },
        {
            "tender_pack_id": pack_building, "position_code": "RE",
            "suggested_person_id": johan_id, "suggested_score": 81,
            "suggested_rationale": "Pr Tech Eng, 13 years, resident engineer on 4 similar contracts",
            "confirmed_person_id": johan_id,
        },
        {
            "tender_pack_id": pack_building, "position_code": "DS1",
            "suggested_person_id": naledi_id, "suggested_score": 58,
            "suggested_rationale": "Candidate Engineer, 5 years, pavement design experience but not yet ECSA professionally registered",
            "confirmed_person_id": None,
        },
    ])

    print("Inserting financial_captures (draft - pricing not yet confirmed)...")
    req(url, key, "POST", "financial_captures", [{
        "company_id": company_id, "tender_id": tender_building, "status": "draft",
    }])

    print("Inserting briefing task (done)...")
    req(url, key, "POST", "tender_tasks", [{
        "company_id": company_id, "tender_id": tender_building,
        "description": "Attend compulsory briefing session", "due_date": "2026-10-10",
        "status": "done", "kind": "briefing", "is_standard": True,
    }])

    print("Inserting field_provenance rows...")
    req(url, key, "POST", "field_provenance", [
        {"tender_pack_id": pack_building, "field_key": "contract_data.client_name", "status": "confirmed",
         "value": "South African National Roads Agency SOC Ltd", "reason": None, "source": "fill_contract_data.py"},
        {"tender_pack_id": pack_building, "field_key": "a_forms.A2.signatory_name", "status": "confirmed",
         "value": "Lindiwe Dlamini", "reason": None, "source": "fill_a_forms.py"},
        {"tender_pack_id": pack_building, "field_key": "a_forms.A2.signatory_email", "status": "computed",
         "value": "lindiwe@mzansiroads.co.za", "reason": None, "source": "fill_a_forms.py"},
        {"tender_pack_id": pack_building, "field_key": "a_forms.A8.litigation", "status": "assumed_default",
         "value": "No", "reason": "No litigation against SANRAL on file - not independently re-verified for this submission.",
         "source": "fill_a_forms.py"},
        {"tender_pack_id": pack_building, "field_key": "financial_hours.summary", "status": "missing",
         "value": None, "reason": "Pricing has not been captured yet - complete the Financial Capture before this can be filled.",
         "source": "fill_financial_hours.py"},
    ])

    print("Inserting experience_items (Experience Library)...")
    req(url, key, "POST", "experience_items", [
        {
            "company_id": company_id, "project_name": "N3 Section 9 Routine Maintenance",
            "document_type": "project_record", "client_name": "South African National Roads Agency SOC Ltd",
            "client_type": "National Roads Authority", "disciplines": ["roads_civil"], "project_type": "RRM",
            "scope_summary": "Pavement rehabilitation and routine maintenance, similar scope and value band",
            "service_stages": ["construction", "close_out"], "value_rm": 38,
            "start_date": "2021-02-01", "completion_date": "2023-11-30",
            "tagged_at": "2026-01-10T08:00:00+02", "tagged_by": user_id, "uploaded_by": user_id,
        },
        {
            "company_id": company_id, "project_name": "R59 Rehabilitation, Vaal Triangle",
            "document_type": "project_record", "client_name": "Gauteng Department of Roads and Transport",
            "client_type": "Provincial Authority", "disciplines": ["roads_civil"], "project_type": "DS",
            "scope_summary": "Design review and supervision of road rehabilitation works",
            "service_stages": ["design_development", "construction"], "value_rm": 52,
            "start_date": "2019-05-01", "completion_date": "2022-03-15",
            "tagged_at": "2026-01-10T08:00:00+02", "tagged_by": user_id, "uploaded_by": user_id,
        },
        {
            "company_id": company_id, "project_name": "Tshwane Road Network Resurfacing Programme",
            "document_type": "project_record", "client_name": "City of Tshwane Metropolitan Municipality",
            "client_type": "Metro Council", "disciplines": ["roads_civil"], "project_type": "MP/MS",
            "scope_summary": "Resurfacing and pothole repair across the metro's road network",
            "service_stages": ["construction"], "value_rm": 19,
            "start_date": "2020-01-01", "completion_date": "2021-08-01",
            "tagged_at": "2026-01-10T08:00:00+02", "tagged_by": user_id, "uploaded_by": user_id,
        },
    ])

    print("\nDone.")
    print(f"Demo company id: {company_id}")
    print(f"Demo login: {DEMO_EMAIL} / (password set, see handback report - not committed here)")
    print("Add this company id to app/lib/demoCompany.ts's DEMO_COMPANY_ID.")


if __name__ == "__main__":
    main()
