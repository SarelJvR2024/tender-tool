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
    fill_table_label(d, "TELEPHONE NUMBER", comp.get("telephone"), log, "sbd1.telephone_number",
                      "No company telephone number on file - fill by hand or add it to the company profile."
                      if not comp.get("telephone") else None)
    log.missing("sbd1.facsimile_number", "No fax number on file - most SA bidders no longer use fax; "
                "confirm with Sarel whether to leave this blank or write N/A.")
    fill_table_label(d, "E-MAIL ADDRESS", comp.get("email"), log, "sbd1.email_address",
                      "No company e-mail address on file - fill by hand or add it to the company profile."
                      if not comp.get("email") else None)
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
        f"Nothing on file shows {comp['legal_name']}'s directors having an interest in any other "
        "related enterprise (the form asks whether or not that enterprise is bidding for this "
        "contract) - not independently re-checked today. If any director holds another "
        "CSD-registered company, the answer is Yes and every such company must be listed.",
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
    # Klipcorp's legal name happens to say "(Pty) Limited"; this stood
    # hardcoded for every company until this pass (round-1 CLI, superseded by
    # fill_sbd_document()'s own correct conditional check for the real
    # pipeline - see Hardcoded-Assumptions-Audit.md 3.2 for the sibling
    # telephone/email fix on this same legacy path) - a CC, sole proprietor,
    # trust or public company run through this CLI would have had a false
    # "(Pty) Limited" declaration confirmed on a real SBD6.1 form.
    if re.search(r"\(Pty\)", comp.get("legal_name") or ""):
        log.confirmed("sbd6_1.company_type", "(Pty) Limited")
    else:
        log.missing("sbd6_1.company_type", "Tick the company type by hand on this form.")
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


# ---------------------------------------------------------------------------
# Document-level filler (round 3, docs/specs/General-Tender-Preparation-
# Findings.md). The per-form functions above assume one form per file and fill
# the FIRST matching label. Real editions found since then break both
# assumptions:
#   - bundles: DSTI "0) SBD FORMS.docx" (SBD 1+4+6.1 in one file), SSA's whole
#     tender document, SITA "Annexure 6a", Mthashana TVET (SBD 1/4/6.1/8/9);
#   - SBD 1's bidder block and the buyer's own enquiries block share labels
#     (TELEPHONE NUMBER / E-MAIL ADDRESS) - DSTI puts enquiries BEFORE the
#     bidder block, Treasury AFTER it, so "first match" writes the bidder's
#     phone into the buyer's technical-enquiries cell;
#   - blanks are dots (RAF), underscores (Treasury SBD 6.1) or empty cells;
#   - Yes/No answers are a "YES/NO" cell (DSTI SBD 4), separate Yes/No cells
#     (Mthashana SBD 8), a "Yes  No" cell (SBD 1 Part B) or "YES/NO" at the end
#     of the question paragraph (Treasury/Tourism SBD 4).
# fill_sbd_document() handles all of these on one python-docx Document, fills
# EVERY occurrence of a bidder field, takes the human's answers from the
# Tender Workspace (tender_answers, migration 0017) instead of assuming "No",
# and still logs every field through ProvenanceLog.
# ---------------------------------------------------------------------------

def _distinct_cells(row):
    seen, out = set(), []
    for c in row.cells:
        if id(c._tc) in seen:
            continue
        seen.add(id(c._tc))
        out.append(c)
    return out


def _bidder_rows(table):
    """SBD 1's supplier block: from the NAME OF BIDDER / SUPPLIER INFORMATION
    row to the next ENQUIRIES row (or the end of the table)."""
    rows, inside = [], False
    for row in table.rows:
        text = " ".join(c.text for c in _distinct_cells(row)).upper()
        if re.search(r"NAME\s+OF\s+BIDDER|SUPPLIER\s+INFORMATION", text):
            inside = True
        elif inside and "ENQUIRIES" in text:
            inside = False
        if inside:
            rows.append(row)
    return rows


def _set_cell(cell, value):
    cell.text = str(value)


def fill_cells(doc, label_re, value, scope="any", prefill_ok=None):
    """Writes value into the distinct cell right after every cell whose text
    starts with label_re, when that next cell is blank (or holds only a known
    prefix, e.g. DSTI's 'MAAA' CSD prefix). scope='bidder' limits it to SBD 1's
    supplier block. Returns the number of cells written."""
    rx = re.compile(r"^\s*(?:" + label_re + r")", re.IGNORECASE)
    n = 0
    for t in doc.tables:
        rows = _bidder_rows(t) if scope == "bidder" else t.rows
        for row in rows:
            cells = _distinct_cells(row)
            for i, c in enumerate(cells[:-1]):
                txt = c.text.strip()
                if len(txt) > 140 or not rx.match(txt):
                    continue
                nxt = cells[i + 1].text.strip()
                if nxt == "" or (prefill_ok and re.fullmatch(prefill_ok, nxt)):
                    _set_cell(cells[i + 1], value)
                    n += 1
    return n


def fill_phone_cells(doc, label_re, number):
    """TELEPHONE NUMBER | CODE | _ | NUMBER | _ (Treasury, DSTI): dialling code
    and number go into their own cells; anything else gets the whole number."""
    m = re.match(r"^\s*(\(?0\d{2}\)?)[\s-]*(.+)$", number)
    code, rest = (m.group(1).strip("()"), m.group(2)) if m else (None, number)
    rx = re.compile(r"^\s*(?:" + label_re + r")", re.IGNORECASE)
    n = 0
    for t in doc.tables:
        for row in _bidder_rows(t):
            cells = _distinct_cells(row)
            if not cells or not rx.match(cells[0].text.strip()):
                continue
            texts = [c.text.strip().upper() for c in cells]
            if "CODE" in texts and "NUMBER" in texts and code:
                ci, ni = texts.index("CODE"), texts.index("NUMBER")
                if ci + 1 < len(cells) and texts[ci + 1] == "" and ni + 1 < len(cells) and texts[ni + 1] == "":
                    _set_cell(cells[ci + 1], code)
                    _set_cell(cells[ni + 1], rest)
                    n += 1
                    continue
            if len(cells) > 1 and texts[1] == "":
                _set_cell(cells[1], number)
                n += 1
    return n


def _replace_paragraph_text(p, new_text):
    for r in list(p.runs):
        r.text = ""
    if p.runs:
        p.runs[0].text = new_text
    else:
        p.add_run(new_text)


def fill_blank_paragraphs(doc, label_re, value, anchored=False):
    """'LABEL: .........' / 'LABEL________' paragraphs (RAF, Treasury SBD 6.1,
    Mthashana SBD 1). Only replaces a real blank run (3+ dots/underscores) right
    after the label, so a label that merely appears in prose is left alone.
    Every occurrence is filled. Returns the count."""
    rx = re.compile(("^\\s*" if anchored else "") + r"(" + label_re + r")(\s*:?\s*)([.…_]{3,}[.…_\s]*)", re.IGNORECASE)
    n = 0
    for p in _all_paragraphs(doc):
        if not rx.search(p.text):
            continue
        new = rx.sub(lambda m: f"{m.group(1)}{m.group(2) if m.group(2).strip() else ' '}{value}   ", p.text, count=1)
        if new != p.text:
            _replace_paragraph_text(p, new)
            n += 1
    return n


def _all_paragraphs(doc):
    yield from doc.paragraphs
    for t in doc.tables:
        for row in t.rows:
            for c in _distinct_cells(row):
                yield from c.paragraphs


def answer_yes_no(doc, question_re, answer):
    """Marks a Yes/No answer in whichever of the four real layouts this
    question uses. Returns the number of places marked."""
    ans = "Yes" if str(answer).lower() in ("yes", "true", "y") else "No"
    rx = re.compile(question_re, re.IGNORECASE)
    n = 0
    for t in doc.tables:
        for row in t.rows:
            cells = _distinct_cells(row)
            for i, c in enumerate(cells):
                if not rx.search(c.text):
                    continue
                rest = cells[i + 1:]
                if not rest:
                    continue
                # separate Yes / No cells (Mthashana SBD 8 4.1-4.4)
                yes = next((x for x in rest[:3] if x.text.strip().lower() == "yes"), None)
                no = next((x for x in rest[:3] if x.text.strip().lower() == "no"), None)
                if yes is not None and no is not None:
                    _set_cell(yes if ans == "Yes" else no, f"[X] {ans}")
                    n += 1
                    break
                nxt = rest[0]
                if re.fullmatch(r"\s*YES\s*/\s*NO\s*", nxt.text, re.IGNORECASE):  # DSTI SBD 4 2.1-2.3
                    _set_cell(nxt, ans.upper())
                    n += 1
                    break
                if re.search(r"\bYes\b", nxt.text) and re.search(r"\bNo\b", nxt.text):  # SBD 1 Part B
                    _set_cell(nxt, re.sub(rf"\b{ans}\b", f"[X] {ans}", nxt.text, count=1))
                    n += 1
                    break
    if n == 0:
        # Paragraph layout: only a paragraph that IS the question (has a "?" or
        # its own YES/NO), and only the first one - the older SBD 4 edition
        # (Mthashana) repeats "employed by the state" in several prose bullets.
        for p in doc.paragraphs:
            t = p.text
            if not rx.search(t) or re.search(r"\((?:Yes|No)\)\s*$", t.rstrip()):
                continue
            if "?" in t or re.search(r"\bYES\s*(?:/|or)?\s*NO\b", t, re.IGNORECASE):
                p.add_run(f"  ({ans})")
                n += 1
                break
    return n


def fill_line_above_caption(doc, caption_re, value, line_must_contain=None):
    """SBD 9: '______________' line with the caption '(Name of Bidder)' /
    '(Bid Number and Description)' on the paragraph BELOW it."""
    paras = doc.paragraphs
    rx = re.compile(r"^\s*\(?\s*(?:" + caption_re + r")\s*\)?(?:\s*$|\s*\t)", re.IGNORECASE)
    n = 0
    for i, p in enumerate(paras):
        if not rx.match(p.text):
            continue
        j = i - 1
        while j >= 0 and not paras[j].text.strip():
            j -= 1
        if j < 0:
            continue
        above = paras[j]
        if line_must_contain and line_must_contain.lower() not in above.text.lower():
            continue
        m = re.search(r"_{5,}|[.…]{5,}", above.text)
        if m:
            _replace_paragraph_text(above, above.text[:m.start()] + f" {value} " + above.text[m.end():])
            n += 1
    return n


def _log_fill(log, key, value, n, missing_reason):
    if value and n:
        log.confirmed(key, value)
    elif value:
        log.missing(key, missing_reason or "Label not found in this buyer's edition - fill by hand.")
    else:
        log.missing(key, missing_reason or "No value on file.")


SBD4_QUESTIONS = [
    ("sbd4.employed_by_state",
     r"employed\s+by\s+(?:the\s+state|an\s+organ\s+of\s+state)|presently\s+in\s+the\s+service\s+of\s+the\s+state"),
    ("sbd4.relationship_with_employee",
     r"relationship\s+with\s+any\s+person\s+who\s+is\s+employed\s+by\s+the\s+procuring|"
     # older edition (Mthashana TVET): "...relationship with persons/a person who are/is involved in the evaluation"
     r"relationship\s+with\s+persons/a\s+person\s+who\s+are/is\s+involved\s+in\s+the\s+evaluation"),
    ("sbd4.interest_in_related_enterprise", r"interest\s+in\s+any\s+other\s+related\s+(?:enterprise|compan)"),
]
SBD8_QUESTIONS = [
    ("sbd8.restricted_supplier", r"Database\s+of\s+Restricted\s+Suppliers"),
    ("sbd8.tender_defaulter", r"Register\s+for\s+Tender\s+Defaulters"),
    ("sbd8.convicted", r"convicted\s+(?:for|of|by)"),
    ("sbd8.contract_terminated", r"contract\s+between\s+the\s+bidder\s+and\s+any\s+organ\s+of\s+state\s+terminated"),
]


def fill_sbd_document(doc, ctx, log, forms):
    """doc: python-docx Document. forms: codes present in it ('1','4','6.1','8','9').
    ctx: {company: companies-row-shaped dict, signatory: {name, capacity} | None,
          answers: {tender_answers.field_key: value}, tender: {contract_no, description, buyer}}"""
    comp = ctx["company"]
    sig = ctx.get("signatory") or {}
    answers = ctx.get("answers") or {}
    tender = ctx.get("tender") or {}
    legal = comp.get("legal_name")

    if "1" in forms:
        n = fill_cells(doc, r"NAME\s+OF\s+BIDDER", legal, "bidder") + fill_blank_paragraphs(doc, r"NAME\s+OF\s+BIDDER", legal)
        _log_fill(log, "sbd1.name_of_bidder", legal, n, None)
        for key, lab, val in [
            ("sbd1.postal_address", r"POSTAL\s+ADDRESS", comp.get("postal_address")),
            ("sbd1.street_address", r"STREET\s+ADDRESS", comp.get("registered_address")),
            ("sbd1.cellphone_number", r"CELLPHONE\s+NUMBER", comp.get("cellphone")),
            ("sbd1.email_address", r"E-?MAIL\s+ADDRESS", comp.get("email")),
            ("sbd1.vat_registration_number", r"VAT\s+REGISTRATION\s+NUMBER", comp.get("vat_number")),
        ]:
            n = (fill_cells(doc, lab, val, "bidder") + fill_blank_paragraphs(doc, lab, val)) if val else 0
            _log_fill(log, key, val, n, None if val else f"No {key.split('.', 1)[1].replace('_', ' ')} on file - add it on the Tender Workspace (saved to the company).")
        tel = comp.get("telephone")
        n = 0
        if tel:
            n = fill_phone_cells(doc, r"TELEPHONE\s+NUMBER", tel)
            m = re.match(r"^\s*\(?(0\d{2})\)?[\s-]*(.+)$", tel)
            code, rest = (m.group(1), m.group(2)) if m else ("", tel)
            for p in _all_paragraphs(doc):
                pm = re.search(r"(TELEPHONE\s+NUMBER\s*:?\s*)CODE[.…_]{3,}\s*NUMBER[.…_]{3,}", p.text, re.IGNORECASE)
                if pm:
                    _replace_paragraph_text(p, p.text[:pm.start()] + f"{pm.group(1)}CODE {code} NUMBER {rest}   " + p.text[pm.end():])
                    n += 1
        _log_fill(log, "sbd1.telephone_number", tel, n, None if tel else "No company telephone number on file - add it on the Tender Workspace (saved to the company).")
        log.missing("sbd1.facsimile_number", "No fax number on file - most SA bidders no longer use fax; leave blank or write N/A by hand.")
        csd = comp.get("csd_supplier_number")
        n = (fill_cells(doc, r"CSD\s+No|CENTRAL\s+SUPPLIER\s+DATABASE\s+No", csd, "any", prefill_ok=r"MAAA") +
             fill_blank_paragraphs(doc, r"CSD\s+(?:No|NUMBER)|CENTRAL\s+SUPPLIER\s+DATABASE\s+No", csd)) if csd else 0
        _log_fill(log, "sbd1.csd_number", csd, n, None if csd else "No CSD supplier number on file.")
        pin = comp.get("sars_tcs_pin")
        n = (fill_cells(doc, r"TCS\s+PIN|TAX\s+COMPLIANCE\s+SYSTEM\s+PIN", pin, "any") +
             fill_blank_paragraphs(doc, r"TCS\s+PIN|TAX\s+COMPLIANCE\s+SYSTEM\s+PIN", pin)) if pin else 0
        _log_fill(log, "sbd1.tcs_pin", pin, n, None if pin else "No SARS TCS PIN in the vault.")
        proof = comp.get("bee_proof_type")
        if proof:
            want = r"VERIFICATION\s+CERTIFICATE" if proof == "certificate" else r"SWORN\s+AFFIDAVIT"
            n = answer_yes_no(doc, r"B-?BBEE\s+STATUS\s+LEVEL\s+" + want, "yes")
            if n:
                log.confirmed("sbd1.bee_proof_ticked", "certificate" if proof == "certificate" else "sworn affidavit")
            else:
                log.missing("sbd1.bee_proof_ticked", "Couldn't find the B-BBEE certificate/affidavit tick boxes in this edition - tick by hand.")
        else:
            log.missing("sbd1.bee_proof_ticked", "No B-BBEE proof type in the vault - tick the certificate/affidavit box by hand.")
        for key, qre in [("sbd1.accredited_representative", r"ACCREDITED\s+REPRESENTATIVE"),
                         ("sbd1.foreign_based", r"FOREIGN[- ]BASED\s+SUPPLIER")]:
            val = answers.get(key)
            if val is None and key == "sbd1.foreign_based" and comp.get("cipc_registration_number"):
                n = answer_yes_no(doc, qre, "no")
                if n:
                    log.assumed_default(key, "No", "CIPC-registered South African company - not answered on the Tender Workspace, confirm there.")
                else:
                    log.missing(key, "Question not found in this edition - answer by hand.")
            elif val is None:
                log.missing(key, "Not answered yet on the Tender Workspace - answer by hand or there.")
            else:
                n = answer_yes_no(doc, qre, val)
                if n:
                    log.confirmed(key, val.capitalize())
                else:
                    log.missing(key, f"Answered '{val}', but the question wasn't found in this edition - mark it by hand.")
        cap = sig.get("capacity")
        cap_re = r"CAPACITY\s+UNDER\s+WHICH\s+THIS\s+(?:BID|RESPONSE|TENDER|QUOTATION)\s+IS\s+SIGNED"
        n = (fill_cells(doc, cap_re, cap) + fill_blank_paragraphs(doc, cap_re, cap)) if cap else 0
        _log_fill(log, "sbd1.capacity_under_which_signed", cap, n,
                  None if cap else "Pick the signatory on the Tender Workspace (their capacity comes from the People page).")
        if sig.get("name"):  # SITA's SBD 1 variant: "Bidder Representative: ____"
            n = fill_blank_paragraphs(doc, r"(?:Name\s+of\s+)?Bidder[’']?s?\s+Representative", sig["name"], anchored=True)
            if n:
                log.confirmed("sbd1.representative_name", sig["name"])
        price = answers.get("total_bid_price")
        n = (fill_cells(doc, r"TOTAL\s+BID\s+PRICE", price) + fill_blank_paragraphs(doc, r"TOTAL\s+BID\s+PRICE", price)) if price else 0
        _log_fill(log, "sbd1.total_bid_price", price, n,
                  None if price else "Total bid price is tender-specific and was left blank - write it in from the priced schedule.")
        log.missing("sbd1.signature_and_date", "Needs a real wet (or verified digital) signature and the date at submission - never typed in.")

    if "4" in forms:
        for key, qre in SBD4_QUESTIONS:
            val = answers.get(key)
            n = answer_yes_no(doc, qre, val or "no")
            if not n:
                log.missing(key, "Declaration not found in this edition - answer by hand.")
            elif val is None:
                log.assumed_default(key, "No", "Not answered on the Tender Workspace - nothing on file says otherwise; confirm it there before signing.")
            else:
                log.confirmed(key, val.capitalize())
        name = sig.get("name")
        n = 0
        if name:
            for p in doc.paragraphs:
                # "I, ......, the undersigned" (Treasury/Tourism) or
                # "I, the undersigned, (name).........." (DSTI, Mthashana)
                m = (re.search(r"\bI,\s*([.…_]{5,}[.…_\s]*),?\s*the\s+undersigned", p.text, re.IGNORECASE) or
                     re.search(r"\bI,\s*the\s+undersigned,?\s*\(name\)\s*([.…_]{5,}[.…_]*)", p.text, re.IGNORECASE))
                if m:
                    _replace_paragraph_text(p, p.text[:m.start(1)] + f" {name}" + p.text[m.end(1):])
                    n += 1
        _log_fill(log, "sbd4.declarant_name", name, n, None if name else "Pick the signatory on the Tender Workspace.")
        if name:  # MBD 4 / older SBD 4 3.1 "Full Name of bidder or his or her representative: ......"
            if fill_blank_paragraphs(doc, r"Full\s+Name\s+of\s+bidder\s+or\s+his\s+or\s+her\s+representative", name):
                log.confirmed("sbd4.representative_full_name", name)
        n = fill_dotted_paragraph_count(doc, "Name of bidder", legal)
        _log_fill(log, "sbd4.name_of_bidder_footer", legal, n, None)
        if sig.get("capacity"):
            n = fill_dotted_paragraph_count(doc, "Designation", sig["capacity"])
            _log_fill(log, "sbd4.designation_footer", sig["capacity"], n, None)
        log.missing("sbd4.signature_and_date", "Needs a real signature and date - never typed in advance.")

    if "6.1" in forms:
        n = fill_blank_paragraphs(doc, r"Name\s+of\s+company\s*/\s*firm", legal)
        _log_fill(log, "sbd6_1.name_of_company", legal, n, None)
        reg = comp.get("cipc_registration_number")
        n = fill_blank_paragraphs(doc, r"Company\s+registration\s+number", reg) if reg else 0
        _log_fill(log, "sbd6_1.company_registration_number", reg, n, None if reg else "No CIPC registration number on file.")
        vat = comp.get("vat_number")
        if vat:
            n = fill_blank_paragraphs(doc, r"VAT\s+Registration\s+number", vat)
            if n:
                log.confirmed("sbd6_1.vat_registration_number", vat)
        n = 0
        if re.search(r"\(Pty\)", legal or ""):
            for p in doc.paragraphs:
                if re.fullmatch(r"\s*\(Pty\)\s+Limited\s*", p.text) or re.fullmatch(r"\s*\(Pty\)\s+Ltd\.?\s*", p.text):
                    p.add_run("  [X]")
                    n += 1
        if n:
            log.confirmed("sbd6_1.company_type", "(Pty) Limited")
        else:
            log.missing("sbd6_1.company_type", "Tick the company type by hand - the tick list wasn't found in this edition.")
        claimed = answers.get("sbd6_1.points_claimed")
        log.missing("sbd6_1.specific_goals_points_claimed",
                    ("Tick/enter by hand in the buyer's own table: " + claimed) if claimed else
                    "Each buyer sets its own specific-goal categories and weightings for this table - enter the points "
                    "you claim on the Tender Workspace, then complete the table by hand.")
        name = sig.get("name")
        n = (fill_blank_paragraphs(doc, r"SURNAME\s+AND\s+NAME", name.upper()) +
             # Treasury: caption BELOW an underscore line; Mthashana: "SURNAME AND
             # INITIALS OF REPRESENTATIVE <tab> DATE" below a dotted line
             fill_line_above_caption(doc, r"NAME\s+OF\s+BIDDER[’']?S\s+REPRESENTATIVE|SURNAME\s+AND\s+(?:NAME|INITIALS)", name)) if name else 0
        _log_fill(log, "sbd6_1.signatory_name", name, n, None if name else "Pick the signatory on the Tender Workspace.")
        addr = comp.get("registered_address")
        n = fill_blank_paragraphs(doc, r"ADDRESS", addr, anchored=True) if addr else 0
        _log_fill(log, "sbd6_1.signatory_address", addr, n, None if addr else "No registered address on file.")
        log.missing("sbd6_1.signature_and_date", "Needs a real signature and date - never typed in advance.")

    if "8" in forms:
        for key, qre in SBD8_QUESTIONS:
            val = answers.get(key)
            if val is None:
                log.missing(key, "Not answered on the Tender Workspace - answer by hand (Tender Tool never assumes this one).")
                continue
            n = answer_yes_no(doc, qre, val)
            if n:
                log.confirmed(key, val.capitalize())
            else:
                log.missing(key, f"Answered '{val}', but the question wasn't found in this edition - mark it by hand.")

    if "9" in forms:
        bid = " - ".join(x for x in [tender.get("contract_no"), tender.get("description")] if x)
        n = fill_line_above_caption(doc, r"Bid\s+Number\s+and\s+Description", bid) if bid else 0
        _log_fill(log, "sbd9.bid_number_and_description", bid, n, None if bid else "No bid number on file.")
        buyer = tender.get("buyer")
        n = fill_line_above_caption(doc, r"Name\s+of\s+Institution", buyer) if buyer else 0
        _log_fill(log, "sbd9.name_of_institution", buyer, n, None if buyer else "No buyer name on file.")
        n = fill_line_above_caption(doc, r"Name\s+of\s+Bidder", legal, line_must_contain="behalf of")
        _log_fill(log, "sbd9.name_of_bidder", legal, n, None)
        log.missing("sbd9.signature_and_date", "Needs a real signature and date - never typed in advance.")
    return doc


def fill_dotted_paragraph_count(doc, label_substr, value):
    """fill_dotted_paragraph()'s whitespace-or-dots convention (Treasury SBD 4
    footer 'Designation ... Name of bidder'), applied to EVERY occurrence and
    without logging - the caller logs once. Skips paragraphs that are prose."""
    # the label must be followed by its blank (dots, a tab, or line end) - not
    # by more words ("Full Name of bidder or his or her representative:")
    pattern = re.compile(re.escape(label_substr) + r"(?=\s*(?:[.…]|\t|$))" + DOTS_RE, re.IGNORECASE)
    n = 0
    for p in doc.paragraphs:
        t = p.text
        if label_substr.lower() not in t.lower() or len(re.sub(r"\s+", " ", t).strip()) > 120:
            continue
        if value and value in t:  # already filled by the blank-paragraph filler
            continue
        if not re.search(r"^\s*(?:" + re.escape(label_substr) + r"|\S.{0,60}\t)", t, re.IGNORECASE) and "\t" not in t:
            continue
        new = pattern.sub(f"{label_substr} {value}   ", t, count=1)
        if new != t:
            _replace_paragraph_text(p, new)
            n += 1
    return n


def fill_sbd_file(path_in, path_out, ctx, log, forms):
    d = docx.Document(path_in)
    fill_sbd_document(d, ctx, log, forms)
    d.save(path_out)
    return path_out


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
