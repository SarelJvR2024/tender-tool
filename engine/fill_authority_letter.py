"""
The letter of authority to sign (for SANRAL Form A2, "Certificate of
Authority for Signatory"), produced the way THIS company has chosen - never in
another company's wording.

Form A2's own notes say the completed example page "shall not be accepted as
authorisation": the buyer wants the tenderer's own letter or resolution. Until
2026-10-17 this script reproduced Klipcorp's historical letter ("Letter of
Authority to Sign_Klipcorp .docx", 2023-07-20) for every company, which put one
company's legal wording into every tenant's submission (Hardcoded-Assumptions-
Audit Q7). It now goes through engine/company_documents.py, the per-company
upload-or-guideline mechanism (table company_document_templates, 0037):

  uploaded      the company's own letter, used exactly as uploaded;
  ai_guideline  the company's own wording with {{field}} marks, filled with
                this tender's details - nothing added, nothing paraphrased;
  not set up    no letter; the pack says "not set up" instead.

Nothing is signed: whoever holds authority signs a printed copy.

Usage (local; the pack builder calls company_documents.produce directly):
    python3 fill_authority_letter.py <profile.json> <out_dir> [--logo logo.png]
        --signatory-name NAME --signatory-capacity CAPACITY
        --rfp-number REF --rfp-description TEXT
        [--uploaded FILE | --guideline-file FILE]
Without --uploaded/--guideline-file, the profile's own
document_templates.authority_to_sign is used (the same shape the pack bridge
builds from the company's row); without that, the letter is "not set up".
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import company_documents  # noqa: E402
from provenance import ProvenanceLog  # noqa: E402

DOCUMENT_TYPE = "authority_to_sign"


def produce_letter(profile, out_dir, signatory, tender, rfp_number, log, logo_path=None, llm=None, template=None):
    """The company's authority letter for one tender (company_documents.produce result)."""
    if template is None:
        template = (profile.get("document_templates") or {}).get(DOCUMENT_TYPE)
    facts = company_documents.authority_facts(profile, signatory, tender, rfp_number)
    return company_documents.produce(DOCUMENT_TYPE, template, facts, out_dir, log,
                                     company=(profile.get("company") or {}).get("legal_name"),
                                     logo_path=logo_path, llm=llm)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("profile_path")
    ap.add_argument("out_dir")
    ap.add_argument("--logo", default=None)
    ap.add_argument("--signatory-name", required=True)
    ap.add_argument("--signatory-capacity", default=None)
    ap.add_argument("--rfp-number", default=None)
    ap.add_argument("--rfp-description", default=None)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--uploaded", default=None, help="the company's own letter, used as-is")
    g.add_argument("--guideline-file", default=None, help="the company's own wording, with {{field}} marks")
    args = ap.parse_args()
    profile = json.load(open(args.profile_path))
    template = None
    if args.uploaded:
        template = {"mode": "uploaded", "path": args.uploaded, "original_filename": os.path.basename(args.uploaded)}
    elif args.guideline_file:
        template = {"mode": "ai_guideline", "guideline": open(args.guideline_file).read()}
    log = ProvenanceLog("fill_authority_letter.py")
    res = produce_letter(profile, args.out_dir,
                         {"name": args.signatory_name, "signatory_capacity": args.signatory_capacity},
                         {"description": args.rfp_description}, args.rfp_number, log,
                         logo_path=args.logo, llm=company_documents.default_llm_client(), template=template)
    print(f"{res['status']}: {res.get('path') or res.get('reason')}")
    for e in log.entries:
        if e["status"] in ("missing", "assumed_default"):
            print(f"  {e['status'].upper()}: {e['reason']}")


if __name__ == "__main__":
    main()
