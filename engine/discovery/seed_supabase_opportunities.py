"""
Reads a watch_new_tenders.py JSON output file (its --out: report-worthy
releases, each with `company_results` - one entry per company whose OWN
verdict is report-worthy) and upserts one discovered_opportunities row per
company x tender (app/supabase/migrations/0004_discovery.sql), each carrying
that company's own verdict, reasons and scoring outlook. The bridge between the
CLI discovery pipeline (local JSON today) and the web app's Discovery page.

Per company, never one shared verdict (Sarel, 2026-10-17, audit Q4: "It should
score for all companies in the app. Nothing must be klipcorp specific"). The
schema was already per company (company_id on every row, unique
(company_id, ocid) since 0024); what changed is that the rows now come from
each company's own score instead of one profile's score attached to
"Klipcorp (Pty) Ltd". There is no default company any more: a result scored
from Supabase carries its company_id; one scored from a --profile file (local
run) is matched to the company row with that file's legal_name, and skipped
with a message if there is none.

Upsert key: (company_id, ocid), not contract_number. watch_new_tenders.py's own
seen-store treats ocid as a release's identity (falling back to contract_number
only when a release has none), so reusing contract_number here could merge two
genuinely different OCDS releases that share one buyer's loosely-formatted
reference number. Rows with no ocid are always inserted fresh rather than
matched by contract_number - duplicates in that rare case are safer than a
wrong merge.

Requires environment variables (see app/.env.local.example), read from the
environment only, never hardcoded:
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

The service role key is required, not the anon key - discovered_opportunities has
no client insert policy (same reasoning as tenders/tender_documents in 0001: this
is backend-written data, never a bare client-side insert). Meant to be run once per
watch_new_tenders.py run, by hand or from a scheduled task on a trusted machine -
never from the deployed app.

Usage:
    python3 seed_supabase_opportunities.py <new_releases.json>
"""
import os
import sys
import json
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import company_profiles  # noqa: E402


LISTING_SOURCES = ("etenders_ocds", "etenders_portal", "sanral", "eskom_bulletin", "transnet_etenders",
                   "capetown_procurement")  # 0051's discovered_opportunities.source check, minus 'manual'


def to_row(r, company_id, c):
    """One company's discovered_opportunities row for release r."""
    documents = r.get("documents") or []
    return {
        "company_id": company_id,
        "contract_number": r.get("contract_number"),
        "buyer": r.get("buyer"),
        "title": r.get("title"),
        "description": r.get("description"),  # 0018; null for JSON written before it
        "closing_date": r.get("closing_date"),
        "categories": r.get("categories") or [],
        "document_depth": r.get("document_depth"),
        # THIS company's own verdict/reasons/outlook (company_results), never
        # another company's.
        "verdict": c.get("verdict"),
        "reasons": c.get("reasons") or [],
        "ocid": r.get("ocid"),
        "document_urls": [{"url": d.get("url"), "title": d.get("title")} for d in documents if d.get("url")],
        # assess_release()'s scoring outlook (score_outlook.py) - null for
        # JSON written before that existed, never a fabricated default.
        "score_outlook": c.get("score_outlook"),
        # 0051: where the tender is listed and the listing's own facts
        # (gov_sources.py). Absent from JSON written by an OCDS-only run, so
        # those rows keep source etenders_ocds and empty listing fields.
        "source": r.get("source") if r.get("source") in LISTING_SOURCES else "etenders_ocds",
        "listing_sources": r.get("listing_sources") or [],
        "province": r.get("province"),
        "tender_type": r.get("tender_type"),
        "briefing": r.get("briefing"),
        "listing_status": r.get("status") if r.get("status") in ("advertised", "cancelled", "closed", "awarded") else None,
    }


def seed(client, releases, log=print):
    """Writes one row per (company, release). Returns {company_id: rows written}."""
    by_name = {}
    written = {}
    for r in releases:
        if "company_results" not in r:
            log(f"  SKIPPED {r.get('contract_number')}: written by the pre-fan-out watch_new_tenders.py "
                "(one shared verdict, no company_results) - re-run the watch to score it per company.")
            continue
        for c in r["company_results"]:
            company_id = c.get("company_id")
            if not company_id:
                name = c.get("legal_name")
                if name not in by_name:
                    rows = client.select("companies", {"legal_name": name}) if name else []
                    by_name[name] = rows[0]["id"] if rows else None
                company_id = by_name[name]
                if not company_id:
                    log(f"  SKIPPED {r.get('contract_number')} for '{name}': no company row with that legal name.")
                    continue
            row = to_row(r, company_id, c)
            if row["ocid"]:
                client.upsert("discovered_opportunities", [row], "company_id,ocid")
            else:
                client.insert("discovered_opportunities", row)
            written[company_id] = written.get(company_id, 0) + 1
    return written


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("releases_path", help="JSON file written by watch_new_tenders.py's --out")
    args = ap.parse_args()

    client = company_profiles.RestClient.from_env()
    if client is None:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
              "(see app/.env.local.example) before running this.")
        sys.exit(1)

    releases = json.load(open(args.releases_path))
    if not releases:
        print("No releases in this file - nothing to seed.")
        return
    written = seed(client, releases)
    total = sum(written.values())
    print(f"\nDone - seeded {total} discovered opportunity row(s) across {len(written)} compan"
          f"{'y' if len(written) == 1 else 'ies'}: " + ", ".join(f"{k}: {v}" for k, v in written.items()))


if __name__ == "__main__":
    main()
