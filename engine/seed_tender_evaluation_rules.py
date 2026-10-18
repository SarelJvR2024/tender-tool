"""
Reads a tender's OWN document and stores what it says about how experience
is evidenced (and any locality rows) on tenders.evaluation_rules (migration
0016), so the Tender Workspace compliance check uses the tender's stated rule
instead of assuming SANRAL's Form B6 pattern.

Sarel, 2026-10-16: "experience evidence is specific to each tender, need to
assess each tender what counts as evidence they normally specify in the
functional requirements."

Extraction is engine/discovery/score_outlook.py's extract_experience_evidence()
and extract_locality() - the same code the discovery outlook runs - over
`pdftotext -layout` output (or a .txt you already extracted).

Also the tender's own key-person minimum requirements (C3.1.11(d) "Minimum
requirements" table, engine/discovery/key_person_minimums.py - audit Q5): the
compliance check uses THIS table when it was read, and R.396's table,
labelled as an assumption, only when it wasn't. For SANRAL the experience rule
is in Book 1 and C3.1.11 in Book 2/3, so pass --document once per book.

Without --write it only prints what it found (dry run), so the extraction can
be checked by eye against the document before anything is stored.

Requires, for --write only (read from the environment, never hardcoded):
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
tenders is shared data written only by the service role (0001), same as
seed_tenders.sql / the discovery pipeline.

Usage:
    python3 engine/seed_tender_evaluation_rules.py --contract-no "R.396-010-2025/1F" \
        --document "templates/incoming/R.396-010-2025.1F/.../Book 1.pdf" \
        --document "templates/incoming/R.396-010-2025.1F/.../Book 2  3  - Aug 2025.pdf" [--write]
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "discovery"))
from score_outlook import describe_evidence_rule, extract_experience_evidence, extract_locality  # noqa: E402
from key_person_minimums import describe_minimum, extract_key_person_minimums  # noqa: E402
from company_profiles import RestClient  # noqa: E402


def document_text(path):
    if path.lower().endswith(".txt"):
        return open(path, encoding="utf-8", errors="replace").read()
    out = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        sys.exit(f"pdftotext could not read {path}: {out.stderr.strip()[:200]}")
    return out.stdout


def build_rules(text, source_document):
    loc = extract_locality(text)
    return {
        "experience_evidence": extract_experience_evidence(text),
        "locality": {"rows": loc["rows"], "mandatory_local_office": loc["mandatory_local_office"]},
        "key_person_minimums": extract_key_person_minimums(text),
        "source_document": source_document,
        "extracted_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--contract-no", required=True, help='tenders.contract_no, e.g. "R.396-010-2025/1F"')
    ap.add_argument("--document", required=True, action="append",
                    help="a tender document (.pdf) or its extracted text (.txt); repeat for each book "
                         "(SANRAL: Book 1 for the experience rule, Book 2/3 for C3.1.11)")
    ap.add_argument("--write", action="store_true", help="store on tenders.evaluation_rules (service role)")
    args = ap.parse_args()

    rules = build_rules("\n\f".join(document_text(d) for d in args.document),
                        "; ".join(os.path.basename(d) for d in args.document))
    ev = rules["experience_evidence"]
    print(f"{args.contract_no}: experience evidence {ev['source']}")
    for r in ev["rules"]:
        print(f"  - {describe_evidence_rule(r)}")
        print(f"    \"{r['quote'][:220]}\"")
    for row in rules["locality"]["rows"]:
        print(f"  locality: {row['kind']} {row['level']} '{row['area']}' {row['points']:g} {row['system'] or ''}")
    if rules["locality"]["mandatory_local_office"]:
        print(f"  locality: MANDATORY local office in {rules['locality']['mandatory_local_office']['area']}")
    if not rules["locality"]["rows"]:
        print("  locality: no locality rows in this document")
    kpm = rules["key_person_minimums"]
    print(f"  key-person minimums: {kpm['source']} - {kpm['reason']}")
    for r in kpm["rows"]:
        print(f"    {r['position_code'] or r['specialist'] or '-':>28}  {r['position']}: {describe_minimum(r)}")

    if not args.write:
        print("\n(dry run - pass --write to store this on tenders.evaluation_rules)")
        print(json.dumps(rules, indent=2)[:4000])
        return
    client = RestClient.from_env()
    if client is None:
        sys.exit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to --write.")
    # (seed_supabase_opportunities.supabase_request, which this used, was
    # replaced by company_profiles.RestClient in the per-company fan-out.)
    res = client.update("tenders", {"contract_no": args.contract_no}, {"evaluation_rules": rules})
    print(f"Updated {len(res or [])} tender row(s).")
    if not res:
        sys.exit(f"No tenders row with contract_no {args.contract_no!r} - seed_tenders.sql first.")


if __name__ == "__main__":
    main()
