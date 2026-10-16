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

Without --write it only prints what it found (dry run), so the extraction can
be checked by eye against the document before anything is stored.

Requires, for --write only (read from the environment, never hardcoded):
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
tenders is shared data written only by the service role (0001), same as
seed_tenders.sql / the discovery pipeline.

Usage:
    python3 engine/seed_tender_evaluation_rules.py --contract-no "R.396-010-2025/1F" \
        --document "templates/incoming/R.396-010-2025.1F/.../Book 1.pdf" [--write]
"""
import argparse
import datetime
import json
import os
import subprocess
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "discovery"))
from score_outlook import describe_evidence_rule, extract_experience_evidence, extract_locality  # noqa: E402
from seed_supabase_opportunities import supabase_request  # noqa: E402


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
        "source_document": source_document,
        "extracted_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--contract-no", required=True, help='tenders.contract_no, e.g. "R.396-010-2025/1F"')
    ap.add_argument("--document", required=True, help="the tender document (.pdf) or its extracted text (.txt)")
    ap.add_argument("--write", action="store_true", help="store on tenders.evaluation_rules (service role)")
    args = ap.parse_args()

    rules = build_rules(document_text(args.document), os.path.basename(args.document))
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

    if not args.write:
        print("\n(dry run - pass --write to store this on tenders.evaluation_rules)")
        print(json.dumps(rules, indent=2)[:4000])
        return
    url, key = os.environ.get("NEXT_PUBLIC_SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to --write.")
    path = f"tenders?contract_no=eq.{urllib.parse.quote(args.contract_no, safe='')}"
    res = supabase_request(url, key, "PATCH", path, {"evaluation_rules": rules}, prefer="return=representation")
    print(f"Updated {len(res or [])} tender row(s).")
    if not res:
        sys.exit(f"No tenders row with contract_no {args.contract_no!r} - seed_tenders.sql first.")


if __name__ == "__main__":
    main()
