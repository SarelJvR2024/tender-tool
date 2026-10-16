"""
First version of a general (non-SANRAL) filler: National Treasury's Standard
Bidding Documents - SBD1 (Invitation to Bid), SBD4 (Bidder's Disclosure) and
SBD6.1 (Preference Points Claim) - **only when a buyer supplies the editable
.docx edition of the form**.

Why this exists, and why it is this narrow: see
docs/specs/General-Tender-Engine-Findings.md, written from six real,
diverse, currently-open national tenders pulled via
engine/discovery/etenders_national.py and downloaded directly from
etenders.gov.za. Two things that doc confirms with real evidence, not
assumption, and that this script is built around:

1. SBD1/4/6.1 are genuinely common across buyers (same purpose, same core
   fields) but are NOT byte-identical - exact section numbers and legal
   wording differ between buyers (Treasury's own current edition already
   differs from the SALB/RAF/QCTO edition sampled). So this script matches
   fields by their LABEL TEXT (e.g. "NAME OF BIDDER", "VAT REGISTRATION
   NUMBER"), never by fixed paragraph number or position - the same
   discipline fill_a_forms.py already uses for SANRAL's own forms, just with
   label text that is this form family's, not SANRAL's.

2. Every SBD PDF sampled (SALB's, QCTO's) had ZERO fillable AcroForm fields -
   confirmed directly with pypdf's get_fields(). Overlaying text onto a flat,
   non-fillable PDF at guessed coordinates is exactly the kind of silent,
   unverifiable fill this project's provenance model exists to prevent, so
   this script does not attempt it: load_sbd_docx() refuses anything that
   isn't a real .docx and says why, instead of guessing at a PDF layout.

Scope guard (Sarel's own principle, restated in the competitor-deep-dive
spec's "Scope discipline" section): this is its own importer, kept out of
engine/'s SANRAL-specific files, so a buyer-format change here can never
break SANRAL's proven pipeline, and a SANRAL change can't break this.

Every field this script writes is logged through ProvenanceLog exactly like
fill_a_forms.py does - confirmed/computed/assumed_default/missing, with a
reason for the latter two - and generate_action_checklist.py already turns
that log into ACTIONS_TO_SIGN.md with zero changes needed on its side.

Usage:
    python3 fill_sbd_docx.py <profile.json> <out_dir> [--sbd1 path] [--sbd4 path] [--sbd6_1 path]

At least one of --sbd1/--sbd4/--sbd6_1 must be given. Each path must be a
real .docx; anything else (.pdf, .doc, .xlsx) is refused with a clear reason
logged as 'missing', not silently skipped.
"""
import os
import sys
import re
import json
import argparse
import datetime
import docx

# provenance.py lives in engine/, one level up from engine/general/ - this
# stays its own importer (Sarel's scope-guard principle: a template family's
# files live apart from SANRAL's), but still reuses the one shared honesty
# model every other filler in this project uses.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from provenance import ProvenanceLog

DOTS_RE = r"[.…\s]*"


def _today_iso():
    return datetime.date.today().isoformat()


# ---------------------------------------------------------------------------
# Generic label-matching helpers (format-family-agnostic, not SBD-specific) -
# reusable the same way across SBD1/4/6.1 and, later, any other .docx SBD
# form someone confirms with a real sample first.
# ---------------------------------------------------------------------------

def find_label_row(doc, label_substr, label_substr2=None):
    """Returns (table, row) for the first table row whose first non-empty
    cell text contains label_substr (case-insensitive). If label_substr2 is
    given, both must appear somewhere in the row (handles split label cells
    like 'TELEPHONE NUMBER' | 'CODE' | ... | 'NUMBER')."""
    needle = label_substr.lower()
    needle2 = label_substr2.lower() if label_substr2 else None
    for t in doc.tables:
        for row in t.rows:
            texts = [c.text.strip() for c in row.cells]
            joined = " | ".join(texts).lower()
            if needle in joined and (needle2 is None or needle2 in joined):
                return t, row
    return None, None


def fill_table_label(doc, label_substr, value, log, field_key, missing_reason=None, label_substr2=None):
    """Finds the row whose label cell matches label_substr and writes value
    into the first DISTINCT blank cell after the label (merged cells repeat
    the same cell object several times in python-docx - de-duplicated by
    identity, not by text, so a genuinely blank cell that happens to share
    text with another blank cell is still picked correctly)."""
    t, row = find_label_row(doc, label_substr, label_substr2)
    if row is None:
        log.missing(field_key, missing_reason or f"Label '{label_substr}' not found in this form - "
                    "may use different wording in this buyer's edition; fill by hand.")
        return False
    seen_ids = set()
    label_seen = False
    for cell in row.cells:
        if id(cell) in seen_ids:
            continue
        seen_ids.add(id(cell))
        text = cell.text.strip()
        if not label_seen:
            if label_substr.lower() in text.lower() or (label_substr2 and label_substr2.lower() in text.lower()):
                label_seen = True
            continue
        if text == "":
            if value:
                cell.text = str(value)
                log.confirmed(field_key, value)
            else:
                log.missing(field_key, missing_reason or f"No value on file for '{label_substr}'.")
            return True
    log.missing(field_key, missing_reason or f"Found label '{label_substr}' but no blank cell after it "
                "in this buyer's edition - fill by hand.")
    return False


def fill_dotted_paragraph(doc, label_substr, value, log, field_key, missing_reason=None):
    """For the other convention seen in real samples (RAF's SBD6.1): a plain
    paragraph 'Label...........' with a dotted blank, not a table cell. Same
    pattern fill_a_forms.py already uses for SANRAL's own dotted-blank
    fields (DOTS_RE / set_paragraph_text)."""
    pattern = re.compile(re.escape(label_substr) + DOTS_RE, re.IGNORECASE)
    for p in doc.paragraphs:
        if label_substr.lower() in p.text.lower():
            if value:
                # Trailing padding matters here: DOTS_RE also swallows plain
                # whitespace gaps (several real samples use tabs/spaces, not
                # dots, as the blank - e.g. Treasury's SBD4 'Designation ...
                # Name of bidder' on one line) - without it the next label on
                # the same line gets squashed directly against this value.
                new_text = pattern.sub(f"{label_substr} {value}   ", p.text, count=1)
                for r in list(p.runs):
                    r.text = ""
                if p.runs:
                    p.runs[0].text = new_text
                else:
                    p.add_run(new_text)
                log.confirmed(field_key, value)
            else:
                log.missing(field_key, missing_reason or f"No value on file for '{label_substr}'.")
            return True
    log.missing(field_key, missing_reason or f"Label '{label_substr}' not found as a paragraph in this "
                "buyer's edition - fill by hand.")
    return False


def mark_declaration_no(doc, phrase_substr, log, field_key, reason):
    """For 'Is the bidder ... YES/NO' style declarations where nothing on
    file indicates the answer is anything but No. Looks for a paragraph
    containing phrase_substr and appends '(No)' - never silently guessed,
    always logged assumed_default with a reason, same as
    fill_a_forms.py's mark_sbd4_no_answers."""
    for p in doc.paragraphs:
        if phrase_substr.lower() in p.text.lower():
            if not p.text.rstrip().endswith("(No)"):
                p.add_run("  (No)")
            log.assumed_default(field_key, "No", reason)
            return True
    log.missing(field_key, f"Could not find the declaration '{phrase_substr}' in this buyer's edition "
                "to mark the answer - check and answer by hand.")
    return False


# ---------------------------------------------------------------------------
# Per-form fillers
# ---------------------------------------------------------------------------

def fill_sbd1(path, comp, name, position, log):
    d = docx.Document(path)
    fill_table_label(d, "NAME OF BIDDER", comp["legal_name"], log, "sbd1.name_of_bidder")
    fill_table_label(d, "POSTAL ADDRESS", comp.get("postal_address"), log, "sbd1.postal_address",
                      "No postal address on file." if not comp.get("postal_address") else None)
    fill_table_label(d, "STREET ADDRESS", comp.get("registered_address"), log, "sbd1.street_address",
                      "No registered/street address on file." if not comp.get("registered_address") else None)
    log.missing("sbd1.telephone_number",
                "Company-level telephone number is not on file in config/klipcorp_profile.json "
                "(only a key person's cellphone is) - fill by hand or add it to the profile.")
    log.missing("sbd1.facsimile_number", "No fax number on file - most SA bidders no longer use fax; "
                "confirm with Sarel whether to leave this blank or write N/A.")
    log.missing("sbd1.email_address",
                "No company-level email address is on file in config/klipcorp_profile.json - fill by "
                "hand or add one to the profile.")
    fill_table_label(d, "VAT REGISTRATION NUMBER", comp.get("vat_number"), log, "sbd1.vat_registration_number",
                      "No VAT number on file." if not comp.get("vat_number") else None)
    fill_table_label(d, "CSD No", comp.get("csd_supplier_number"), log, "sbd1.csd_number",
                      "No CSD supplier number on file." if not comp.get("csd_supplier_number") else None,
                      label_substr2=None)
    bee_level = comp.get("bee_level")
    if bee_level:
        log.confirmed("sbd1.bee_status_level", str(bee_level))
        log.missing("sbd1.bee_certificate_attachment",
                    "BEE level is confirmed on file, but the current sworn affidavit/certificate "
                    "PDF still needs to be sourced and attached to THIS submission - re-check its "
                    "validity window before relying on it. See company.bee_source_note.")
    else:
        log.missing("sbd1.bee_status_level", "No B-BBEE status level on file.")
    log.missing("sbd1.total_bid_price",
                "Total bid price is tender-specific (depends on this tender's own pricing), not a "
                "company fact - compute it from the actual priced schedule for this tender before "
                "filling it in.")
    log.missing("sbd1.signature_and_date",
                "Needs a real wet (or verified digital) signature and today's date at submission - "
                "never typed in.")
    log.missing("sbd1.capacity_under_which_signed",
                f"Needs the signatory's actual capacity to sign on behalf of {comp['legal_name']} "
                "and proof of authority attached (e.g. a resolution of directors) - not filled "
                "automatically.")
    out = path.rsplit(".", 1)[0] + "_FILLED.docx"
    d.save(out)
    return out


def fill_sbd4(path, comp, name, position, log):
    d = docx.Document(path)
    mark_declaration_no(
        d, "employed by an organ of state", log, "sbd4.employed_by_organ_of_state",
        f"Nothing on file shows {comp['legal_name']} or its directors employed by an organ of "
        "state - not independently re-checked against a live register today.",
    )
    mark_declaration_no(
        d, "relationship with any person who is employed by the procuring institution", log,
        "sbd4.relationship_with_procuring_institution_employee",
        "Nothing on file indicates a relationship between the bidder and anyone employed by "
        "this specific buyer - this is tender-specific, re-check for THIS buyer before relying "
        "on it.",
    )
    mark_declaration_no(
        d, "interest in any other related enterprise", log, "sbd4.interest_in_related_enterprise",
        f"Nothing on file shows {comp['legal_name']}'s directors having an interest in another "
        "enterprise bidding for this contract - not independently re-checked today.",
    )
    fill_dotted_paragraph(d, "Name of bidder", comp["legal_name"], log, "sbd4.name_of_bidder_footer")
    fill_dotted_paragraph(d, "Designation", position, log, "sbd4.designation_footer")
    log.missing("sbd4.signature_and_date",
                "Needs a real signature and date, and the 'I, ....., the undersigned' general "
                "declaration name blank filled in by hand at signing - never typed in advance.")
    out = path.rsplit(".", 1)[0] + "_FILLED.docx"
    d.save(out)
    return out


def fill_sbd6_1(path, comp, name, position, log):
    d = docx.Document(path)
    fill_dotted_paragraph(d, "Name of company/firm", comp["legal_name"], log, "sbd6_1.name_of_company")
    fill_dotted_paragraph(d, "Company registration number", comp.get("cipc_registration_number"), log,
                          "sbd6_1.company_registration_number",
                          "No CIPC registration number on file." if not comp.get("cipc_registration_number") else None)
    log.confirmed("sbd6_1.company_type", "(Pty) Limited")
    log.missing("sbd6_1.specific_goals_points_claimed",
                "Each buyer sets its own specific-goal categories and weightings for this table "
                "(confirmed from real samples: SALB's and RAF's category lists are not identical) "
                "- this is tender-specific, not a company fact, and must be worked out per "
                "submission against this buyer's own stated categories, never copied from another "
                "tender.")
    fill_dotted_paragraph(d, "SURNAME AND NAME", name.upper(), log, "sbd6_1.signatory_name")
    fill_dotted_paragraph(d, "ADDRESS", comp.get("registered_address"), log, "sbd6_1.signatory_address",
                          "No registered address on file." if not comp.get("registered_address") else None)
    log.missing("sbd6_1.signature_and_date",
                "Needs a real signature and date - never typed in advance.")
    out = path.rsplit(".", 1)[0] + "_FILLED.docx"
    d.save(out)
    return out


FORM_FILLERS = {
    "sbd1": fill_sbd1,
    "sbd4": fill_sbd4,
    "sbd6_1": fill_sbd6_1,
}


def require_docx(path, form_key, log):
    if not path.lower().endswith(".docx"):
        log.missing(
            f"{form_key}.unsupported_format",
            f"'{path}' is not a .docx file - this script only fills the editable .docx edition of "
            "an SBD form (see docs/specs/General-Tender-Engine-Findings.md Finding 2: every sampled "
            "PDF edition had zero fillable AcroForm fields, and overlaying text onto a flat PDF at "
            "guessed coordinates is not safe to ship). Source a .docx edition of this form from the "
            "buyer, or complete this one by hand.",
        )
        return False
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("profile_path")
    parser.add_argument("out_dir")
    parser.add_argument("--sbd1")
    parser.add_argument("--sbd4")
    parser.add_argument("--sbd6_1")
    parser.add_argument("--provenance-out")
    args = parser.parse_args()

    forms = {"sbd1": args.sbd1, "sbd4": args.sbd4, "sbd6_1": args.sbd6_1}
    if not any(forms.values()):
        print("No forms given - pass at least one of --sbd1/--sbd4/--sbd6_1", file=sys.stderr)
        sys.exit(1)

    profile = json.load(open(args.profile_path))
    comp = profile["company"]
    henning = profile["key_people"][0]
    name = henning["name"]
    position = henning.get("signatory_capacity", "Signatory")

    log = ProvenanceLog(source="engine/general/fill_sbd_docx.py")
    outputs = {}
    for form_key, path in forms.items():
        if not path:
            continue
        if not require_docx(path, form_key, log):
            continue
        outputs[form_key] = FORM_FILLERS[form_key](path, comp, name, position, log)
        print(f"Wrote {outputs[form_key]}")

    if args.provenance_out:
        log.save(args.provenance_out)
        print(f"Wrote {args.provenance_out}: {len(log.entries)} provenance entries ({log.summary()})")

    return outputs, log


if __name__ == "__main__":
    main()
