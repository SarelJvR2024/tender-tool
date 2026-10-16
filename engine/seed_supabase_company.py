"""
Seeds Klipcorp's company row, Henning's person row, and every confirmed
tender_pack/tender_pack_assignment from the CLI pack generator's real output
into Supabase - the bridge between the CLI pipeline (packs/generated/*/pack.yaml)
and the web app's tenant-scoped tables.

Deliberately reads real data only from gitignored local files
(config/klipcorp_profile.json, packs/generated/*/pack.yaml) at runtime - this
script itself is safe to commit because it contains no PII, same pattern as
every engine/fill_*.py script.

Requires environment variables (see app/.env.local.example):
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

The service role key is required, not the anon key - RLS would otherwise
block writing a company row before any auth.users/company_members row exists
to satisfy is_company_member(). This script is meant to be run once, by hand,
from a trusted machine - never from the deployed app.

Usage: python3 seed_supabase_company.py
"""
import os
import sys
import glob
import json
import yaml
import urllib.request
import urllib.error

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def supabase_request(url, service_key, method, path, body=None):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} failed: {e.code} {e.read().decode()}")


def main():
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
              "(see app/.env.local.example) before running this.")
        sys.exit(1)

    profile = json.load(open(os.path.join(ROOT, "config/klipcorp_profile.json")))
    comp = profile["company"]
    henning = profile["key_people"][0]

    pi = comp.get("professional_indemnity_insurance") or {}
    iso = comp.get("iso_9001") or {}

    print("Upserting company...")
    company_rows = supabase_request(url, key, "POST", "companies", [{
        "legal_name": comp["legal_name"],
        "csd_trading_name": comp.get("csd_trading_name"),
        "cipc_registration_number": comp.get("cipc_registration_number"),
        "vat_number": comp.get("vat_number"),
        "income_tax_number": comp.get("income_tax_number"),
        "paye_number": comp.get("paye_number"),
        "csd_supplier_number": comp.get("csd_supplier_number"),
        "coid_registration_number": comp.get("coid_registration_number"),
        "coid_letter_of_good_standing_number": comp.get("coid_letter_of_good_standing_number"),
        "coid_letter_of_good_standing_expiry": comp.get("coid_letter_of_good_standing_expiry"),
        "bee_level": comp.get("bee_level"),
        "black_ownership_pct": comp.get("black_ownership_pct"),
        "bee_procurement_recognition_pct": comp.get("bee_procurement_recognition_pct"),
        "status": comp.get("status"),
        "registered_address": comp.get("registered_address"),
        "postal_address": comp.get("postal_address"),
        "head_office": comp.get("head_office_per_form_b3"),
        "other_offices": comp.get("other_offices", 0),
        "ecsa_registered_staff_count": comp.get("ecsa_registered_staff_count", 0),
        "sacpcmp_registered_staff_count": comp.get("sacpcmp_registered_staff_count", 0),
        "total_employees": comp.get("total_employees"),
        "typical_jv_share_pct": comp.get("typical_jv_share_pct"),
        "bank_name": comp.get("bank", {}).get("bank_name"),
        "bank_branch_code": comp.get("bank", {}).get("branch_code"),
        "director_name": comp.get("director", {}).get("name"),
        # 0014_vault_compliance_documents.sql - same source (profile JSON) as
        # the COID fields above. Uploaded copies (*_path) are not seeded: the
        # files go in through the Document Vault upload, not this script.
        "sars_tcs_pin": comp.get("sars_tcs_pin"),
        "sars_tcs_pin_expiry": comp.get("sars_tcs_pin_expiry"),
        "pi_insurance_insurer": pi.get("insurer"),
        "pi_insurance_policy_number": pi.get("policy_number"),
        "pi_insurance_cover_zar": pi.get("limit_of_indemnity_zar"),
        "pi_insurance_expiry": pi.get("period_to"),
        "iso_9001_certified": iso.get("certified"),
        "iso_9001_certificate_number": iso.get("certificate_number"),
        "iso_9001_expiry": iso.get("expiry"),
        "bank_confirmation_letter_date": comp.get("bank", {}).get("confirmation_letter_date"),
        "bee_proof_type": comp.get("bee_proof_type"),
        "bee_proof_expiry": comp.get("bee_proof_expiry"),
    }])
    company_id = company_rows[0]["id"]
    print(f"  company_id = {company_id}")

    print("Upserting Henning...")
    person_rows = supabase_request(url, key, "POST", "people", [{
        "company_id": company_id,
        "name": henning["name"],
        "id_number": henning.get("id_number"),
        "role": henning.get("role"),
        "signatory_capacity": henning.get("signatory_capacity"),
        "phone": henning.get("phone"),
        "ecsa_level": henning["qualifications"].get("ecsa_level"),
        "ecsa_number": henning["qualifications"].get("ecsa_number"),
        "ecsa_date": henning["qualifications"].get("ecsa_date"),
        "highest_level": henning["qualifications"].get("highest_level"),
        "highest_description": henning["qualifications"].get("highest_description"),
        "highest_institution": henning["qualifications"].get("highest_institution"),
        "highest_graduated": henning["qualifications"].get("highest_graduated"),
        "initial_description": henning["qualifications"].get("initial_description"),
        "initial_institution": henning["qualifications"].get("initial_institution"),
    }])
    person_id = person_rows[0]["id"]
    print(f"  person_id = {person_id}")

    pack_dirs = sorted(glob.glob(os.path.join(ROOT, "packs/generated/*")))
    print(f"\nFound {len(pack_dirs)} generated packs")
    for pack_dir in pack_dirs:
        pack_path = os.path.join(pack_dir, "pack.yaml")
        if not os.path.exists(pack_path):
            continue
        pack = yaml.safe_load(open(pack_path))
        slug = os.path.basename(pack_dir)
        contract_no = pack.get("_provenance", {}).get("contract") or slug

        tenders = supabase_request(url, key, "GET", f"tenders?contract_no=eq.{contract_no}&select=id")
        if not tenders:
            print(f"  SKIP {slug}: no matching row in tenders table yet - run seed_tenders.sql first")
            continue
        tender_id = tenders[0]["id"]

        tender_packs = supabase_request(url, key, "POST", "tender_packs", [{
            "company_id": company_id, "tender_id": tender_id, "status": "confirmed",
        }])
        tender_pack_id = tender_packs[0]["id"]

        for kp in pack.get("key_persons", []):
            supabase_request(url, key, "POST", "tender_pack_assignments", [{
                "tender_pack_id": tender_pack_id,
                "position_code": kp["position"],
                "confirmed_person_id": person_id,
                "specialism_warning": kp.get("position") == "DS1",
            }])
        print(f"  seeded {slug} -> tender_pack {tender_pack_id} ({len(pack.get('key_persons', []))} positions)")

    print("\nDone.")


if __name__ == "__main__":
    main()
