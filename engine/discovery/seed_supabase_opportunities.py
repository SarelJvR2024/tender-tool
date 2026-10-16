"""
Reads a watch_new_tenders.py JSON output file (its --out, a list of report-worthy
assess_release() results with "ocid"/"documents" added - see that script's
new_releases list) and upserts each release into the app's discovered_opportunities
table (app/supabase/migrations/0004_discovery.sql) - the bridge between the CLI
discovery pipeline (local JSON today) and the web app's Discovery page, same role
seed_supabase_company.py already plays for company/people/pack data.

Upsert key: ocid, not contract_number. watch_new_tenders.py's own seen-store already
treats ocid as the primary identity for a release (falling back to contract_number
only when a release has none - see its `key = r.get("ocid") or r.get("contract_number")`),
so reusing contract_number here instead would risk merging two genuinely different
OCDS releases that happen to share one buyer's loosely-formatted reference number.
Rows with no ocid at all (fallback case) are always inserted fresh rather than
matched by contract_number, since a contract_number collision is exactly the
ambiguity above - duplicates in that rare case are safer than a wrong merge, and
cheap to deduplicate by hand later if it ever actually happens.

Requires environment variables (see app/.env.local.example), read from the
environment only, never hardcoded:
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

The service role key is required, not the anon key - discovered_opportunities has
no client insert policy (same reasoning as tenders/tender_documents in 0001: this
is backend-written data, never a bare client-side insert). Meant to be run once per
watch_new_tenders.py run, by hand or from a scheduled task on a trusted machine -
never from the deployed app.

Usage:
    python3 seed_supabase_opportunities.py <new_releases.json> [--company-legal-name NAME]
"""
import os
import sys
import json
import argparse
import urllib.request
import urllib.error
import urllib.parse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
DEFAULT_LEGAL_NAME = "Klipcorp (Pty) Ltd"  # matches config/klipcorp_profile.json's company.legal_name -
# v1 is single-tenant (Klipcorp), same assumption seed_supabase_company.py already makes.


def supabase_request(url, service_key, method, path, body=None, prefer=None):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            **({"Prefer": prefer} if prefer else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body_text = r.read()
            return json.loads(body_text) if body_text else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} failed: {e.code} {e.read().decode()}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("releases_path", help="JSON file written by watch_new_tenders.py's --out")
    ap.add_argument("--company-legal-name", default=DEFAULT_LEGAL_NAME,
                     help=f"which company's row to attach these to (default: {DEFAULT_LEGAL_NAME!r})")
    args = ap.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
              "(see app/.env.local.example) before running this.")
        sys.exit(1)

    releases = json.load(open(args.releases_path))
    if not releases:
        print("No releases in this file - nothing to seed.")
        return

    print(f"Looking up company '{args.company_legal_name}'...")
    companies = supabase_request(
        url, key, "GET",
        f"companies?legal_name=eq.{urllib.parse.quote(args.company_legal_name)}&select=id",
    )
    if not companies:
        print(f"  ERROR: no company row found for '{args.company_legal_name}' - run "
              f"seed_supabase_company.py first.")
        sys.exit(1)
    company_id = companies[0]["id"]
    print(f"  company_id = {company_id}")

    with_ocid = [r for r in releases if r.get("ocid")]
    without_ocid = [r for r in releases if not r.get("ocid")]

    def to_row(r):
        documents = r.get("documents") or []
        return {
            "company_id": company_id,
            "contract_number": r.get("contract_number"),
            "buyer": r.get("buyer"),
            "title": r.get("title"),
            "closing_date": r.get("closing_date"),
            "categories": r.get("categories") or [],
            "document_depth": r.get("document_depth"),
            "verdict": r.get("verdict"),
            "reasons": r.get("reasons") or [],
            "ocid": r.get("ocid"),
            "document_urls": [{"url": d.get("url"), "title": d.get("title")} for d in documents if d.get("url")],
            # assess_release()'s scoring outlook (score_outlook.py) - null for
            # JSON written before that existed, never a fabricated default.
            "score_outlook": r.get("score_outlook"),
        }

    if with_ocid:
        print(f"Upserting {len(with_ocid)} release(s) with an ocid (on_conflict=company_id,ocid)...")
        supabase_request(
            url, key, "POST", "discovered_opportunities?on_conflict=company_id,ocid",
            body=[to_row(r) for r in with_ocid],
            prefer="return=minimal,resolution=merge-duplicates",
        )

    if without_ocid:
        print(f"Inserting {len(without_ocid)} release(s) with no ocid (always fresh rows - "
              f"see module docstring on why contract_number isn't used as an upsert key)...")
        supabase_request(
            url, key, "POST", "discovered_opportunities",
            body=[to_row(r) for r in without_ocid],
            prefer="return=minimal",
        )

    print(f"\nDone - seeded {len(releases)} discovered opportunity row(s) for company_id {company_id}.")


if __name__ == "__main__":
    main()
