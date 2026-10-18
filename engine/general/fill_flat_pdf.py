"""
Types the company's details onto a FLAT (non-fillable) PDF form - the municipal
MBD editions and the CIDB-style returnables (Compulsory Enterprise
Questionnaire, Form of Offer signatory block) that buyers publish only inside
a printed-to-PDF bundle. Until this existed every such form was completed by
hand from the completion guide (General-Tender-Preparation-Findings.md gap 1).

Why NOT fixed x/y coordinates (the obvious approach, investigated first): the
same MBD 1 is laid out differently by every municipality. Read 2026-10-17 from
the live eTenders feed (findings doc, "Round 4"): Dawid Kruiper's label column
ends at x~95pt and its value cells start at 116pt; Umzinyathi's start at
200pt, 40pt lower on the page, below a letterhead; Joe Gqabi has no grid at
all; Nama Khoi wraps "TELEPHONE / NUMBER" over two lines; Cape Winelands
pre-prints "MAAA" in the CSD cell; Ratlou's MBD 1 is a scan with no text. MBD 4
is a ruled table at Overberg, dotted leaders on the same line at Ingquza and
Kareeberg, and dotted leaders on the NEXT line at uMlalazi. A per-buyer x/y
template would be wrong on the next municipality.

What IS consistent is the wording of the labels (they're all copies of the
same Treasury/MFMA forms). So every value is placed relative to its label,
found in the PDF's own text layer, in one of four layouts:

  cell      the label sits in a ruled table row -> the first EMPTY cell to its
            right in the same row (pdfplumber's table finder gives the cells);
            "TELEPHONE NUMBER | CODE | _ | NUMBER | _" -> the cell after
            CODE / after NUMBER.
  leader    "Label: ............" on the same line -> written over the dots
            (on a white patch, so it reads as typed).
  next      "Label:" with the dots on the line below (uMlalazi MBD 4).
  caption   a dotted/underscored line with the caption "(Name of Bidder)"
            BELOW it (MBD 9, signature blocks).

and Yes/No answers are ticked in the box next to the chosen word, or the word
is circled when there is no box ("YES / NO").

A value is only written when the target is provably blank (no other text in
it) and the text fits; otherwise the field is reported "not placed" with the
reason and stays on the completion guide. Every placement is read back from
the written PDF (the text must come out of the target box) before it counts -
nothing is assumed to have worked. Signature, date, prices and anything the
company record doesn't hold are never typed.

Libraries: pypdf (already the pack merger's) writes the overlay with raw PDF
text operators and the built-in Helvetica - the same technique as
engine/pack/pdf_merge.py's page stamp, no drawing library. pdfplumber (added to
engine/worker/requirements.txt for this) reads word, character and table-cell
positions; poppler's pdftotext (already used by requirements.py) finds which
pages hold which form.

CLI (local check):
    python3 engine/general/fill_flat_pdf.py IN.pdf OUT.pdf --profile config/test_companies/complete_co.json \
        [--forms 1,4,9,ceq,form_of_offer] [--answers answers.json] [--png DIR]
"""
import argparse
import json
import os
import re
import subprocess
import sys

from pypdf import PdfReader, PdfWriter, PageObject
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject

# ---------------------------------------------------------------------------
# Helvetica metrics (AFM widths, 1/1000 em) - enough to measure what we write
# without a font library. Characters outside are measured as 556 (digit width).
# ---------------------------------------------------------------------------
_HELV = dict(zip(
    " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
    [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278] + [556] * 10 +
    [278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722,
     778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500,
     556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500,
     500, 500, 334, 260, 334, 584]))


def text_width(s, size):
    return sum(_HELV.get(ch, 556) for ch in s) * size / 1000.0


def _pdf_str(s):
    s = s.encode("latin-1", "replace").decode("latin-1")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


LEADER_CHARS = set("._…·‥-–—_  ")
MAX_SIZE, MIN_SIZE = 9.0, 6.0

# ---------------------------------------------------------------------------
# Form definitions. Labels are the wordings seen in the real editions
# (findings doc Round 4 lists which buyer uses which). `v` names the value in
# values_for(); a field whose value is None is reported, never written.
# ---------------------------------------------------------------------------

FORMS = {
    "1": {
        "title": "MBD/SBD 1 Invitation to bid",
        "page": [r"INVITATION\s+TO\s+BID"],
        "needs": [r"NAME\s+OF\s+BIDDER|Name\s+of\s+bidder", r"VAT\s+REGISTRATION|VAT\s+registration|POSTAL\s+ADDRESS|Postal\s+address"],
        # The buyer's own enquiries block repeats TELEPHONE/E-MAIL - only the
        # supplier block is the bidder's (findings doc Finding 4).
        "scope": (r"SUPPLIER\s+INFORMATION|NAME\s+OF\s+BIDDER|Name\s+of\s+bidder", r"ENQUIRIES|BIDDING\s+PROCEDURE|TECHNICAL\s+INFORMATION"),
        "fields": [
            {"key": "sbd1.name_of_bidder", "label": r"NAME\s+OF\s+BIDDER", "v": "legal_name"},
            {"key": "sbd1.postal_address", "label": r"POSTAL\s+ADDRESS", "v": "postal_address"},
            {"key": "sbd1.street_address", "label": r"STREET\s+ADDRESS|PHYSICAL\s+ADDRESS", "v": "registered_address"},
            # Form-Field-Audit 2026-10-18: the contact person is the signatory only by
            # assumption (true of a one-person company) - logged assumed_default.
            {"key": "sbd1.contact_person", "label": r"CONTACT\s+PERSON", "v": "signatory_name",
             "assumed_reason": "Written as the bid's signatory - nothing on file names a separate contact person for this bid; change it by hand if someone else handles the buyer's enquiries."},
            {"key": "sbd1.telephone_number", "label": r"TELEPHONE(?:\s+NUMBER)?", "v": "telephone", "phone": True},
            {"key": "sbd1.cellphone_number", "label": r"CELL\s*PHONE(?:\s+NUMBER)?", "v": "cellphone"},
            {"key": "sbd1.email_address", "label": r"E-?\s?MAIL(?:\s+ADDRESS)?", "v": "email"},
            {"key": "sbd1.vat_registration_number", "label": r"VAT\s*REGISTRATION", "v": "vat_number"},
            {"key": "sbd1.tcs_pin", "label": r"TCS\s*PIN:?|TAX\s+COMPLIANCE\s+SYSTEM\s+PIN", "v": "sars_tcs_pin", "cell_only": True},
            {"key": "sbd1.csd_number", "label": r"CSD\s+No\.?:?|CSD\s+NUMBER|CENTRAL\s+SUPPLIER\s+DATABASE\s+No", "v": "csd_supplier_number",
             "prefix": "MAAA"},
            {"key": "sbd1.total_bid_price", "label": r"TOTAL\s+BID\s+PRICE", "v": "total_bid_price", "prefix": "R"},
            {"key": "sbd1.capacity_under_which_signed", "label": r"CAPACITY\s+UNDER", "v": "signatory_capacity"},
        ],
        "choices": [
            # the label wraps one word per line in a narrow cell (Dawid Kruiper) - anchor on one
            # word, but not SALB's "A VERIFICATION AGENCY ACCREDITED BY ... (SANAS)"
            {"key": "sbd1.accredited_representative", "label": r"(?<!AGENCY\s)\bACCREDITED\b(?!\s+BY)", "v": "accredited_representative"},
            {"key": "sbd1.foreign_based", "label": r"FOREIGN\s+BASED|FOREIGN-BASED|ARE\s+YOU\s+A\s+FOREIGN", "v": "foreign_based",
             "assumed_flag": "foreign_based_assumed",
             "assumed_reason": "CIPC-registered South African company - not answered on the Tender Workspace, confirm there."},
            # "B-BBEE STATUS LEVEL VERIFICATION CERTIFICATE [TICK APPLICABLE BOX] Yes/No" and
            # "B-BBEE STATUS LEVEL SWORN AFFIDAVIT Yes/No" (Joe Gqabi, Cape Winelands)
            {"key": "sbd1.bee_certificate_ticked", "label": r"VERIFICATION\s+CERTIFICATE|STATUS\s+LEVEL\s+VERIFICATION", "v": "bee_certificate"},
            {"key": "sbd1.bee_affidavit_ticked", "label": r"SWORN\s+AFFIDAVIT|LEVEL\s+SWORN", "v": "bee_affidavit"},
        ],
    },
    "4": {
        "title": "MBD/SBD 4 Declaration of interest",
        "page": [r"DECLARATION\s+OF\s+INTEREST|BIDDER.?S\s+DISCLOSURE"],
        "needs": [r"Identity\s+Number|Full\s+Name|Registered\s+name|Position\s+occupied|Name\s+of\s+bidder"],
        "scope": (None, None),
        "fields": [
            {"key": "sbd4.registered_name", "label": r"Registered\s+name\s+of\s+supplier", "v": "legal_name"},
            {"key": "sbd4.representative_full_name",
             "label": r"Full\s+Name\s+of\s+(?:bidder\s+or\s+his\s+or\s+her\s+)?representative:?|^\s*(?:\d+(?:\.\d+)*\.?\s+)?Full\s+Name\s*:",
             "v": "signatory_name"},
            {"key": "sbd4.representative_id_number", "label": r"Identity\s*Number(?:\s+of\s+representative)?:?", "v": "signatory_id_number", "first_only": True},
            {"key": "sbd4.representative_position", "label": r"Position\s+(?:of\s+representative\s+)?occupied\s+in\s+the\s+Company[^:\n]{0,60}?(?:\)|:)+|"
                      r"Position\s+(?:of\s+representative\s+)?occupied\s+in\s+the\s*(?:Company)?\s*$",
             "v": "signatory_capacity"},
            {"key": "sbd4.company_registration_number", "label": r"Company\s*Registration\s*Number:?", "v": "cipc_registration_number"},
            {"key": "sbd4.tax_reference_number", "label": r"Tax\s*Reference\s*Number:?", "v": "income_tax_number"},
            {"key": "sbd4.vat_registration_number", "label": r"VAT\s*Registration\s*Number:?", "v": "vat_number"},
            {"key": "sbd4.declarant_name", "label": r"I,?\s+(?:THE\s+)?UNDERSIGNED,?\s*\(NAME\)", "v": "signatory_name"},
            {"key": "sbd4.csd_number", "label": r"\(CSD\)\s+Registration|CSD\s+Registration\s+number", "v": "csd_supplier_number", "prefix": "MAAA"},
        ],
        "choices": [
            {"key": "sbd4.employed_by_state", "label": r"presently\s+in\s+the\s+service|presently\s+in\s+the\s*$", "v": "employed_by_state"},
        ],
        "captions": [
            {"key": "sbd4.name_of_bidder_footer", "caption": r"Name\s+of\s+(?:Bidder|bidder)", "v": "legal_name"},
            {"key": "sbd4.designation_footer", "caption": r"Capacity|Position|Designation", "v": "signatory_capacity"},
        ],
    },
    "9": {
        "title": "MBD/SBD 9 Certificate of independent bid determination",
        "page": [r"INDEPENDENT\s+BID\s+DETERMINATION"],
        "needs": [r"undersigned"],
        "scope": (None, None),
        "fields": [
            {"key": "sbd9.name_of_bidder", "label": r"on\s+behalf\s+of\s*:?", "v": "legal_name"},
        ],
        "captions": [
            {"key": "sbd9.bid_number_and_description", "caption": r"\(\s*Bid\s+Number\s+and\s+Description\s*\)", "v": "bid_number_and_description"},
            {"key": "sbd9.name_of_institution", "caption": r"\(\s*Name\s+of\s+(?:Municipality|Institution|Municipal)[^)]*\)|\(\s*[A-Z][A-Za-z ]+(?:Municipality|Municipal\s+Entity)\s*\)",
             "v": "buyer"},
            {"key": "sbd9.name_of_bidder", "caption": r"\(\s*Name\s+of\s+Bidder\s*\)", "v": "legal_name"},
            {"key": "sbd9.position_footer", "caption": r"^Position$", "v": "signatory_capacity"},
        ],
    },
    "ceq": {
        "title": "Compulsory Enterprise Questionnaire",
        "page": [r"COMPULSORY\s+ENTERPRISE\s+QUESTIONNAIRE|Compulsory\s+Enterprise\s+[Qq]uestionnaire"],
        "needs": [r"Name\s+of\s+enterprise"],
        "scope": (None, r"The\s+undersigned|Signed\b"),
        "fields": [
            {"key": "ceq.name_of_enterprise", "label": r"Name\s+of\s+enterprise:?", "v": "legal_name"},
            {"key": "ceq.contact_person", "label": r"Contact\s+Person", "v": "signatory_name",
             "assumed_reason": "Written as the bid's signatory - nothing on file names a separate contact person for this bid; change it by hand if someone else handles the buyer's enquiries."},
            {"key": "ceq.email", "label": r"^Email|^E-mail", "v": "email"},
            {"key": "ceq.telephone", "label": r"^Telephone", "v": "telephone"},
            {"key": "ceq.cellphone", "label": r"^Cell\s*phone", "v": "cellphone"},
            {"key": "ceq.physical_address", "label": r"Physical\s+Address", "v": "registered_address"},
            {"key": "ceq.postal_address", "label": r"Postal\s+Address", "v": "postal_address"},
            {"key": "ceq.vat_registration_number", "label": r"VAT\s+registration\s+number,?\s*(?:if\s+any)?:?", "v": "vat_number"},
            {"key": "ceq.cidb_registration_number", "label": r"CIDB\s+registration\s+number,?\s*(?:if\s+any)?:?", "v": "cidb_registration_number"},
            {"key": "ceq.csd_number", "label": r"CSD\s+number:?|Central\s+supplier\s+database", "v": "csd_supplier_number", "prefix": "MAAA"},
            {"key": "ceq.company_registration_number",
             "label": r"Company(?:\s*/\s*Close\s+Corporation)?\s+registration\s+number:?|^Company\s*/\s*Close\s+Corporation\s*$", "v": "cipc_registration_number"},
            {"key": "ceq.tax_reference_number", "label": r"Tax\s+reference\s+number:?", "v": "income_tax_number"},
            {"key": "ceq.bank_name_and_branch", "label": r"Bank\s+name\s+and\s+branch:?", "v": "bank_name_and_branch"},
        ],
    },
    "form_of_offer": {
        "title": "Form of Offer and Acceptance (offer signatory block)",
        "page": [r"FORM\s+OF\s+OFFER"],
        # the CIDB standard wording, so a contents page that lists the form doesn't count
        "needs": [r"\bOFFER\b", r"(?i)solicited\s+offers|identified\s+in\s+the\s+(?:acceptance|offer)\s+signature\s+block"],
        # Only the tenderer's OFFER part - the ACCEPTANCE part (a heading on its
        # own line, in capitals) is the employer's. Case-sensitive: the offer
        # paragraph itself wraps onto a line starting "acceptance and returning".
        "scope": (None, r"^\s*ACCEPTANCE\s*$"),
        "pages_after": 3,
        # the offer's signature block is ONE block: once something is typed on
        # a page, later pages (the employer's acceptance block often repeats
        # "Name(s) / Capacity" without its own ACCEPTANCE heading - Overberg
        # p.26) are never searched
        "single_block": True,
        "fields": [
            {"key": "form_of_offer.signatory_name",
             "label": r"Name\s*:?\s*\(of\s+signatory\s+in\s+capitals\)\s*:?|^Name\(s\)|^Name\s+of\s+signatory\s*:?|^Name\s*:|^\(Names?",
             "v": "signatory_name_upper", "first_only": True},
            {"key": "form_of_offer.capacity", "label": r"Capacity\s*(?:for\s+the\s+[Tt]enderer)?\s*:?\s*(?:\(of\s+[Ss]ignatory\)\s*:?)?", "v": "signatory_capacity", "first_only": True},
            {"key": "form_of_offer.tenderer", "label": r"Name\s+of\s+[Tt]enderer\s*:?\s*(?:\(organi[sz]ation\)\s*:?)?|^Company\s+Name|^Name\s+of\s+organi[sz]ation\s*:?|^for\s+the\s+tenderer\s*:?|Tender(?:er)?.s\s+Name\(s\)",
             "v": "legal_name", "first_only": True},
            {"key": "form_of_offer.address", "label": r"^Address\s*:?", "v": "registered_address", "first_only": True},
            {"key": "form_of_offer.telephone", "label": r"^Telephone\s+number\s*:?", "v": "telephone", "first_only": True},
        ],
    },
}


def values_for(ctx):
    """Every value any form above can write, from the same ctx
    build_general_pack / fill_sbd_docx use: {company, signatory, answers, tender}."""
    c, s, a, t = ctx.get("company") or {}, ctx.get("signatory") or {}, ctx.get("answers") or {}, ctx.get("tender") or {}
    bank = " ".join(x for x in [c.get("bank_name"), (f"(branch {c['bank_branch_code']})" if c.get("bank_branch_code") else None)] if x) or None
    yn = lambda v: (v or "").lower() if (v or "").lower() in ("yes", "no") else None  # noqa: E731
    foreign = yn(a.get("sbd1.foreign_based"))
    if os.path.dirname(os.path.abspath(__file__)) not in sys.path:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fill_sbd_docx import bee_proof_lapse  # one rule for both fillers
    lapsed = bool(bee_proof_lapse(c, t.get("closing_date")))
    return {
        "legal_name": c.get("legal_name"),
        "postal_address": c.get("postal_address"),
        "registered_address": c.get("registered_address"),
        "telephone": c.get("telephone"),
        "cellphone": c.get("cellphone"),
        "email": c.get("email"),
        "vat_number": c.get("vat_number"),
        "sars_tcs_pin": c.get("sars_tcs_pin"),
        "csd_supplier_number": c.get("csd_supplier_number"),
        "cipc_registration_number": c.get("cipc_registration_number"),
        "income_tax_number": c.get("income_tax_number"),
        "cidb_registration_number": c.get("cidb_registration_number"),  # no column yet - reported "not on file"
        "bank_name_and_branch": bank,
        "signatory_name": s.get("name"),
        "signatory_name_upper": (s.get("name") or "").upper() or None,
        "signatory_capacity": s.get("capacity"),
        "signatory_id_number": s.get("id_number"),
        "total_bid_price": a.get("total_bid_price"),
        "bid_number_and_description": " - ".join(x for x in [t.get("contract_no"), t.get("description")] if x) or None,
        "buyer": t.get("buyer"),
        "accredited_representative": yn(a.get("sbd1.accredited_representative")),
        # Same assumption fill_sbd_docx makes, recorded as assumed_default.
        "foreign_based": foreign or ("no" if c.get("cipc_registration_number") else None),
        "foreign_based_assumed": foreign is None and bool(c.get("cipc_registration_number")),
        "employed_by_state": yn(a.get("sbd4.employed_by_state")),
        # not ticked at all when the proof lapses before closing (fill_sbd_docx.bee_proof_lapse)
        "bee_certificate": None if lapsed else {"certificate": "yes", "qse_affidavit": "no", "eme_affidavit": "no"}.get(c.get("bee_proof_type")),
        "bee_affidavit": None if lapsed else {"certificate": "no", "qse_affidavit": "yes", "eme_affidavit": "yes"}.get(c.get("bee_proof_type")),
    }


# ---------------------------------------------------------------------------
# Finding the form pages (cheap: pdftotext over the whole file once)
# ---------------------------------------------------------------------------

def page_texts(pdf_path):
    try:
        out = subprocess.run(["pdftotext", "-layout", pdf_path, "-"], capture_output=True, text=True, timeout=180)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []
    return out.stdout.split("\f") if out.returncode == 0 else []


def find_form_pages(texts, code):
    """Page indexes (0-based) where form `code` starts: its heading in the top
    part of the page plus at least one of its own field labels on the page.
    A contents page that merely lists "MBD 1" doesn't qualify."""
    spec = FORMS[code]
    starts = []
    for i, t in enumerate(texts):
        lines = [ln for ln in t.splitlines() if ln.strip()]
        head = "\n".join(lines[:18])
        if not any(re.search(p, head, re.IGNORECASE) for p in spec["page"]):
            continue
        if all(re.search(p, t) for p in spec["needs"]):
            starts.append(i)
    return starts


# ---------------------------------------------------------------------------
# Page geometry (pdfplumber): words with their characters, lines, table cells
# ---------------------------------------------------------------------------

class PageModel:
    def __init__(self, plumber_page):
        p = plumber_page
        self.width, self.height = float(p.width), float(p.height)
        self.words = p.extract_words(keep_blank_chars=False, use_text_flow=False, extra_attrs=[], return_chars=True)
        self.lines = self._lines(self.words)
        try:
            tables = p.find_tables()
        except Exception:
            tables = []
        self.rows = []
        for tb in tables:
            for r in tb.rows:
                cells = [c for c in r.cells if c is not None]
                if cells:
                    self.rows.append({"top": r.bbox[1], "bottom": r.bbox[3], "cells": cells})
        self.rects = [r for r in p.rects if 4 <= r["width"] <= 16 and 4 <= r["height"] <= 16]
        # drawn underlines ("Name of enterprise: ________" made with a Word
        # underline/tab leader prints as a thin filled rect or a line - TNPA)
        self.hrules = sorted(
            [(r["x0"], r["x1"], r["top"]) for r in p.rects if r["height"] <= 2.5 and r["width"] >= 30] +
            [(ln["x0"], ln["x1"], ln["top"]) for ln in p.lines if abs(ln["bottom"] - ln["top"]) <= 1 and ln["x1"] - ln["x0"] >= 30],
            key=lambda h: (h[2], h[0]))

    @staticmethod
    def _lines(words):
        lines = []
        for w in sorted(words, key=lambda w: ((w["top"] + w["bottom"]) / 2, w["x0"])):
            mid = (w["top"] + w["bottom"]) / 2
            for ln in lines:
                if abs(ln["mid"] - mid) <= 2.6:
                    ln["words"].append(w)
                    break
            else:
                lines.append({"mid": mid, "words": [w]})
        for ln in lines:
            ln["words"].sort(key=lambda w: w["x0"])
            ln["top"] = min(w["top"] for w in ln["words"])
            ln["bottom"] = max(w["bottom"] for w in ln["words"])
            ln["text"], ln["spans"] = "", []
            for w in ln["words"]:
                if ln["text"]:
                    ln["text"] += " "
                ln["spans"].append((len(ln["text"]), w))
                ln["text"] += w["text"]
        lines.sort(key=lambda ln: ln["mid"])
        return lines

    def words_in(self, x0, top, x1, bottom, ignore=None):
        out = []
        for w in self.words:
            cx, cy = (w["x0"] + w["x1"]) / 2, (w["top"] + w["bottom"]) / 2
            if x0 <= cx <= x1 and top <= cy <= bottom and (ignore is None or not ignore(w)):
                out.append(w)
        return out


def _is_leader(s):
    s = s.strip()
    return len(s) >= 3 and all(ch in LEADER_CHARS for ch in s)


def _x_at(line, offset):
    """x position in the line at character `offset` of line['text'] (the end of
    a regex match), using the per-character boxes - a label glued to its dots
    ('representative:..........') ends inside a word."""
    for start, w in line["spans"]:
        end = start + len(w["text"])
        if start <= offset <= end:
            k = offset - start
            chars = w.get("chars") or []
            if k <= 0:
                return w["x0"]
            if chars and k <= len(chars):
                return chars[k - 1]["x1"]
            return w["x1"]
    return line["words"][-1]["x1"]


def _leader_run(line, x_from, max_gap=30):
    """The dotted/underscored blank on `line` starting at or after x_from:
    (x0, x1) of the run of leader characters, or None. Stops at the first real
    text (e.g. 'YES / NO', 'that:')."""
    chars = [c for w in line["words"] for c in (w.get("chars") or []) if c["x0"] >= x_from - 0.5]
    chars.sort(key=lambda c: c["x0"])
    run = None
    for c in chars:
        if c["text"] in LEADER_CHARS:
            if run is None:
                if c["x0"] - x_from > max_gap:
                    return None
                run = [c["x0"], c["x1"]]
            else:
                run[1] = c["x1"]
        elif c["text"] in ":;" and run is None:
            continue
        else:
            break
    if run and run[1] - run[0] >= 25:
        return tuple(run)
    return None


# ---------------------------------------------------------------------------
# Placement
# ---------------------------------------------------------------------------

def _fit(value, width, height=None):
    """Font size that fits `value` in width (and one line of height)."""
    size = MAX_SIZE
    if height:
        size = min(size, max(MIN_SIZE, height * 0.62))
    while size >= MIN_SIZE and text_width(value, size) > width:
        size -= 0.25
    return size if size >= MIN_SIZE else None


def _row_for(model, y):
    rows = [r for r in model.rows if r["top"] - 1 <= y <= r["bottom"] + 1]
    return min(rows, key=lambda r: r["bottom"] - r["top"]) if rows else None


def _cell_words(model, c, ignore):
    # a word belongs to a cell when its centre is inside it, with 2pt of slack:
    # a pre-printed "R" or "MAAA" often sits right on the cell's bottom rule
    return model.words_in(c[0] - 1, c[1] - 2, c[2] + 1, c[3] + 2, ignore=ignore)


def _cell_target(model, line, label_x1, field, label_word_ids, value):
    """[(box, mode, text)] for a label inside a ruled table row, [] when the
    label isn't in a table, or a string reason when it is but there's no safe
    blank."""
    row = _row_for(model, line["mid"])
    if not row:
        return []
    ignore = lambda w: id(w) in label_word_ids or _is_leader(w["text"])  # noqa: E731
    cells = sorted((c for c in row["cells"] if c[0] >= label_x1 - 3), key=lambda c: c[0])
    if field.get("phone"):
        # "TELEPHONE NUMBER | CODE | _ | NUMBER | _" (every MBD 1 seen): the
        # dialling code after CODE, the rest after NUMBER - same split as
        # fill_sbd_docx.fill_phone_cells()
        row_words = [w for w in model.words if row["top"] - 1 <= (w["top"] + w["bottom"]) / 2 <= row["bottom"] + 1 and w["x0"] > label_x1]
        code_w = next((w for w in row_words if w["text"].upper().strip(":") == "CODE"), None)
        num_w = next((w for w in row_words if w["text"].upper().strip(":") == "NUMBER"), None)
        m = re.match(r"^\s*\(?(0\d{2})\)?[\s-]*(.+)$", value)
        after = lambda w: next((c for c in cells if c[0] >= w["x1"] - 3 and not _cell_words(model, c, ignore)), None)  # noqa: E731
        if code_w and num_w and m and after(code_w) and after(num_w):
            cc, nc = after(code_w), after(num_w)
            return [((cc[0] + 3, cc[1], cc[2] - 3, cc[3]), "cell", m.group(1)), ((nc[0] + 3, nc[1], nc[2] - 3, nc[3]), "cell", m.group(2))]
        if num_w and after(num_w):
            nc = after(num_w)
            return [((nc[0] + 3, nc[1], nc[2] - 3, nc[3]), "cell", value)]
    for c in cells:
        inside = _cell_words(model, c, ignore)
        texts = [w["text"] for w in inside]
        if not texts:
            return [((c[0] + 3, c[1], c[2] - 3, c[3]), "cell", value)]
        pre = field.get("prefix")
        if pre and " ".join(texts).strip().upper() == pre.upper():
            # Cape Winelands pre-prints "MAAA" in the CSD cell, Joe Gqabi / Nama
            # Khoi an "R" in the bid-price cell: write the rest after it, on
            # the printed prefix's own baseline
            text = value[len(pre):].lstrip() if value.upper().startswith(pre.upper()) else value
            x = max(w["x1"] for w in inside) + 2
            return [((x, min(w["top"] for w in inside), c[2] - 3, max(w["bottom"] for w in inside)), "inline", text)]
        # a short sub-label ("CODE", "TCS PIN:") - keep looking to its right
        if len(texts) <= 2 and len(" ".join(texts)) <= 9 and re.fullmatch(r"[A-Za-z :.]+", " ".join(texts)):
            continue
        return f"the space next to the label already holds text ({' '.join(texts)[:40]})"
    # The label's row has no cell to its right (Nama Khoi's E-MAIL ADDRESS row
    # has no right-hand rule): use the row's blank width if it's truly blank.
    right = max(c[2] for c in row["cells"])
    x0 = max([c[2] for c in row["cells"] if c[0] <= label_x1 <= c[2] + 1] + [label_x1 + 6])
    if right - x0 > 60 and not model.words_in(x0, row["top"] + 1, right, row["bottom"] - 1, ignore=ignore):
        return [((x0 + 3, row["top"], right - 3, row["bottom"]), "cell", value)]
    return []


def _locate_label(model, rx, lines_scope, used):
    for li, line in enumerate(model.lines):
        if not lines_scope(line):
            continue
        for m in rx.finditer(line["text"]):
            key = (li, m.start())
            if key in used:
                continue
            return li, line, m
    return None, None, None


class Placement:
    def __init__(self, key, value, page, box, mode, size, kind="text", whiteout=False, assumed=None):
        self.key, self.value, self.page, self.box, self.mode, self.size = key, value, page, box, mode, size
        self.kind, self.whiteout, self.assumed = kind, whiteout, assumed
        self.verified = False


def _free_right(model, line, x_from):
    """How far right of x_from the line stays blank (to the text column's
    right edge) - lets a short dotted run be extended into empty margin."""
    col_right = max((w["x1"] for w in model.words), default=x_from)
    nxt = [w["x0"] for w in line["words"] if w["x0"] > x_from + 1 and not _is_leader(w["text"])]
    return min(nxt + [col_right])


def place_text_fields(model, page_no, fields, vals, scope_fn, done, results):
    used = set()
    for f in fields:
        if f["key"] in done:
            continue
        value = vals.get(f["v"])
        rx = re.compile(f["label"], re.IGNORECASE | re.MULTILINE)
        li, line, m = _locate_label(model, rx, scope_fn, used)
        if line is None:
            continue
        used.add((li, m.start()))
        if not value:
            results.setdefault(f["key"], ("missing", None, "not on file"))
            continue
        label_x1 = _x_at(line, m.end())
        # only the words the label itself spans - a pre-printed "MAAA" on the
        # same text line (Overberg CEQ) is cell content, not label
        label_ids = {id(w) for st, w in line["spans"] if st < m.end() and st + len(w["text"]) > m.start()}
        # 1. table cell(s) to the right
        cell = _cell_target(model, line, label_x1, f, label_ids, value)
        if isinstance(cell, str):
            results[f["key"]] = ("not_placed", None, cell)
            continue
        if cell:
            pls = []
            for box, mode, text in cell:
                size = _fit(text, box[2] - box[0], None if mode == "inline" else box[3] - box[1])
                if not size:
                    break
                pls.append(Placement(f["key"], text, page_no, box, mode, size, assumed=f.get("assumed_reason")))
            if len(pls) == len(cell):
                results[f["key"]] = ("placed", pls, None)
                done.add(f["key"])
            else:
                results[f["key"]] = ("not_placed", None, "too long for the cell on the form")
            continue
        if f.get("cell_only"):
            results.setdefault(f["key"], ("not_placed", None, "no blank cell next to the label"))
            continue
        # 2. dots on the same line
        run = _leader_run(line, label_x1)
        mode = "leader"
        if run is None:
            # 3. dots on the next line (uMlalazi MBD 4: "2.1 Full Name...:" then a dotted line)
            nxt = model.lines[li + 1] if li + 1 < len(model.lines) else None
            if nxt and 4 < nxt["top"] - line["bottom"] < 22 and all(_is_leader(w["text"]) for w in nxt["words"]):
                run = (nxt["words"][0]["x0"], nxt["words"][-1]["x1"])
                line = nxt
                mode = "next"
        if run is None and not _row_for(model, line["mid"]):
            # 4. a drawn underline to the right of the label, on its baseline (TNPA CEQ)
            rules = [h for h in model.hrules if h[0] >= label_x1 - 4 and -3 <= h[2] - line["bottom"] <= 7
                     and not [w for w in line["words"] if label_x1 + 1 < w["x0"] < h[0] - 1 and not _is_leader(w["text"])]]
            if rules:
                h = min(rules, key=lambda h: h[0])
                run = (h[0], h[1])
                line = dict(line, top=line["top"], bottom=h[2])
                mode = "rule"
        if run is None:
            results.setdefault(f["key"], ("not_placed", None, "no blank cell or dotted line next to the label"))
            continue
        size = _fit(value, run[1] - run[0] - 2)
        if (size is None or size < 7.5) and mode == "leader":
            # a short dotted run with blank margin after it (Ingquza 3.3)
            far = _free_right(model, line, run[1])
            if far - run[1] > 20:
                run = (run[0], max(run[1], far - 4))
                size = _fit(value, run[1] - run[0] - 2)
        if not size:
            results[f["key"]] = ("not_placed", None, "too long for the dotted line on the form")
            continue
        box = (run[0] + 1, line["top"] - 1, run[1], line["bottom"] + (0 if mode == "rule" else 1))
        results[f["key"]] = ("placed", [Placement(f["key"], value, page_no, box, mode, size, whiteout=mode != "rule",
                                                  assumed=f.get("assumed_reason"))], None)
        done.add(f["key"])


def _caption_match(line, rx):
    """A caption is a short line (signature-block captions share a line:
    'Signature   Date', 'Position   Name of Bidder') - a run of whole words
    matching rx exactly. Returns (x0, x1) or None."""
    if len(line["words"]) > 8:
        return None
    ws = line["words"]
    for i in range(len(ws)):
        for j in range(i + 1, min(len(ws), i + 6) + 1):
            frag = " ".join(w["text"] for w in ws[i:j])
            # a caption stands alone: line edge or a wide gap on both sides
            # ("Position   Name of Bidder"), never the first word of a sentence
            # ("Position occupied in the state institution:")
            alone = (i == 0 or ws[i]["x0"] - ws[i - 1]["x1"] > 12) and (j == len(ws) or ws[j]["x0"] - ws[j - 1]["x1"] > 12)
            if alone and rx.fullmatch(frag):
                return ws[i]["x0"], ws[j - 1]["x1"]
    return None


def place_captions(model, page_no, captions, vals, done, results):
    for f in captions:
        if f["key"] in done:
            continue
        value = vals.get(f["v"])
        rx = re.compile(f["caption"].strip("^$"), re.IGNORECASE)
        for li, line in enumerate(model.lines):
            hit = _caption_match(line, rx)
            if not hit:
                continue
            cap_x0, cap_x1 = hit
            # the blank line ABOVE the caption: the nearest line above with a
            # dotted/underscored run horizontally over the caption
            for up in range(li - 1, max(-1, li - 3), -1):
                above = model.lines[up]
                if line["top"] - above["bottom"] > 26:
                    break
                leaders = [w for w in above["words"] if _is_leader(w["text"]) and w["x1"] > cap_x0 - 60 and w["x0"] < cap_x1 + 60]
                if not leaders:
                    continue
                cover = [w for w in leaders if w["x0"] <= cap_x1 + 10 and w["x1"] >= cap_x0 - 10] or leaders
                cover.sort(key=lambda w: abs((w["x0"] + w["x1"]) / 2 - (cap_x0 + cap_x1) / 2))
                run = (cover[0]["x0"], cover[0]["x1"])
                others = [w for w in above["words"] if not _is_leader(w["text"]) and run[0] - 2 <= w["x0"] < run[1]]
                band = [w for w in model.words_in(run[0], above["top"] - 13, run[1], above["top"] - 0.5)
                        if not _is_leader(w["text"]) and above["top"] - w["bottom"] < 4]
                # text just above the line is the buyer's pre-print (uMlalazi's
                # centred "UMlalazi Municipality") unless it is the prompt that
                # introduces the line ("...made by:", "...accompanying bid:")
                band_text = " ".join(w["text"] for w in sorted(band, key=lambda w: w["x0"])).strip()
                if band_text.endswith(":"):
                    band = []
                if others or band:
                    results.setdefault(f["key"], ("prefilled", None, "already printed on the form by the buyer"))
                    done.add(f["key"])
                    break
                if not value:
                    results.setdefault(f["key"], ("missing", None, "not on file"))
                    break
                size = _fit(value, run[1] - run[0] - 2)
                if not size:
                    results[f["key"]] = ("not_placed", None, "too long for the line on the form")
                    break
                box = (run[0] + 1, above["top"] - 1, run[1], above["bottom"] + 1)
                results[f["key"]] = ("placed", [Placement(f["key"], value, page_no, box, "caption", size, whiteout=True)], None)
                done.add(f["key"])
                break
            if f["key"] in done:
                break


def _small_box_for(model, w):
    """The tick box that belongs to a 'Yes'/'No' word: immediately left of it
    (Dawid Kruiper, Umzinyathi) or directly below it (Nama Khoi)."""
    cy, cx = (w["top"] + w["bottom"]) / 2, (w["x0"] + w["x1"]) / 2
    best = None
    for r in model.rects:
        rcy = (r["top"] + r["bottom"]) / 2
        if abs(rcy - cy) <= 6 and 0 <= w["x0"] - r["x1"] <= 14:
            if best is None or r["x1"] > best["x1"]:
                best = r
    if best:
        return best
    for r in model.rects:
        if r["x0"] - 3 <= cx <= r["x1"] + 3 and 0 <= r["top"] - w["bottom"] <= 12:
            return r
    return None


def place_choices(model, page_no, choices, vals, scope_fn, done, results):
    for f in choices:
        if f["key"] in done:
            continue
        ans = vals.get(f["v"])
        rx = re.compile(f["label"], re.IGNORECASE)
        li, line, m = _locate_label(model, rx, scope_fn, set())
        if line is None:
            continue
        if ans not in ("yes", "no"):
            results.setdefault(f["key"], ("missing", None, "not answered on the Tender Workspace"))
            continue
        label_x1 = _x_at(line, m.end())
        rows = [r for r in model.rows if r["top"] - 1 <= line["mid"] <= r["bottom"] + 1]
        # the TALLEST row holding the label: Part B's question cells are split
        # into sub-rows by the neighbouring question's wrapped text (Ingquza)
        row = max(rows, key=lambda r: r["bottom"] - r["top"]) if rows else None
        if row:
            # the question's own table row, right of the label (SBD 1 Part B
            # puts two questions in one row - the nearest Yes/No is this one's)
            cand = [w for w in model.words if w["x0"] >= label_x1 - 2
                    and row["top"] - 1 <= (w["top"] + w["bottom"]) / 2 <= row["bottom"] + 1]
        else:
            # paragraph layout: "3.8 Are you presently in the service of the
            # state?   YES / NO" - the YES/NO is on the question's line or, when
            # the question wraps, the next line (never further: 3.9 follows)
            nxt = model.lines[li + 1] if li + 1 < len(model.lines) else None
            lines = [line] + ([nxt] if nxt and nxt["top"] - line["bottom"] < 8 else [])
            x_min = line["words"][0]["x0"]
            cand = [w for ln in lines for w in ln["words"] if w["x0"] >= x_min]
            cand = [w for w in cand if w["x0"] >= label_x1 - 2 or lines.index(next(ln for ln in lines if w in ln["words"])) > 0]
        # nearest to the question first: its own Yes/No is the left-most one
        # right of it (the neighbouring question's sits further right, even
        # when it's printed a line higher - Ingquza Part B)
        cand.sort(key=lambda w: w["x0"])
        target = None
        for w in cand:
            t = w["text"].strip("[]():").upper()
            if t == ans.upper():
                target = (w, None)
                break
            if re.fullmatch(r"YES\s*/\s*NO", t):  # "YES/NO" glued in one word: circle the right half
                target = (w, ans)
                break
        if not target:
            results[f["key"]] = ("not_placed", None, "no Yes/No to mark next to the question")
            continue
        w, glued = target
        box = _small_box_for(model, w) if not glued else None
        if box:
            pl = Placement(f["key"], "X", page_no, (box["x0"], box["top"], box["x1"], box["bottom"]), "tick", 8, kind="tick")
        else:
            x0, x1 = w["x0"], w["x1"]
            if glued:
                chars = w.get("chars") or []
                txt = "".join(c["text"] for c in chars).upper()
                k = txt.find(ans.upper())
                if k >= 0 and chars:
                    x0, x1 = chars[k]["x0"], chars[k + len(ans) - 1]["x1"]
            pl = Placement(f["key"], ans.capitalize(), page_no, (x0 - 2, w["top"] - 2, x1 + 2, w["bottom"] + 2), "circle", 0, kind="circle")
        if f.get("assumed_flag") and vals.get(f["assumed_flag"]):
            pl.assumed = f["assumed_reason"]
        results[f["key"]] = ("placed", [pl], None)
        done.add(f["key"])


# ---------------------------------------------------------------------------
# Drawing (raw PDF operators, Helvetica, same as pdf_merge._stamp)
# ---------------------------------------------------------------------------

def _ops_for(pl, page_h, x_off, y_off):
    x0, top, x1, bottom = pl.box
    X = lambda x: x + x_off  # noqa: E731
    Y = lambda t: page_h - t + y_off  # noqa: E731  (pdfplumber "top" -> PDF user space)
    if pl.kind == "tick":
        cx, cy = X((x0 + x1) / 2), Y((top + bottom) / 2)
        d = min(x1 - x0, bottom - top) * 0.32
        return (f"q 0 0 0.55 RG 1.2 w {cx - d:.2f} {cy - d:.2f} m {cx + d:.2f} {cy + d:.2f} l S "
                f"{cx - d:.2f} {cy + d:.2f} m {cx + d:.2f} {cy - d:.2f} l S Q ")
    if pl.kind == "circle":
        cx, cy = X((x0 + x1) / 2), Y((top + bottom) / 2)
        rx, ry = (x1 - x0) / 2 + 1, (bottom - top) / 2 + 1
        k = 0.5523
        return (f"q 0 0 0.55 RG 1 w {cx + rx:.2f} {cy:.2f} m "
                f"{cx + rx:.2f} {cy + ry * k:.2f} {cx + rx * k:.2f} {cy + ry:.2f} {cx:.2f} {cy + ry:.2f} c "
                f"{cx - rx * k:.2f} {cy + ry:.2f} {cx - rx:.2f} {cy + ry * k:.2f} {cx - rx:.2f} {cy:.2f} c "
                f"{cx - rx:.2f} {cy - ry * k:.2f} {cx - rx * k:.2f} {cy - ry:.2f} {cx:.2f} {cy - ry:.2f} c "
                f"{cx + rx * k:.2f} {cy - ry:.2f} {cx + rx:.2f} {cy - ry * k:.2f} {cx + rx:.2f} {cy:.2f} c S Q ")
    size = pl.size
    h = bottom - top
    if pl.mode == "cell":
        base = bottom - (h - size * 0.72) / 2  # optical centre of caps/digits in the cell
    elif pl.mode == "inline":
        base = bottom - h * 0.22  # the neighbouring printed word's baseline
    elif pl.mode == "rule":
        base = bottom - 1.8  # just above the drawn underline
    else:
        base = bottom - 2.2  # on the dotted line
    ops = ""
    if pl.whiteout:
        w = text_width(pl.value, size)
        ops += f"q 1 g {X(x0) - 1:.2f} {Y(base) - 2.2:.2f} {w + 3:.2f} {size + 2.4:.2f} re f Q "
    ops += f"BT /TTOverlay {size:.2f} Tf 0 0 0.45 rg {X(x0):.2f} {Y(base):.2f} Td ({_pdf_str(pl.value)}) Tj ET "
    return ops


def _overlay_page(page, ops):
    page.transfer_rotation_to_content()
    box = page.mediabox
    overlay = PageObject.create_blank_page(width=float(box.right), height=float(box.top))
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"), NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
    })
    overlay[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({NameObject("/TTOverlay"): font}),
        NameObject("/ProcSet"): ArrayObject([NameObject("/PDF"), NameObject("/Text")]),
    })
    stream = DecodedStreamObject()
    stream.set_data(ops.encode("latin-1"))
    overlay[NameObject("/Contents")] = stream
    page.merge_page(overlay)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def fill_flat_pdf(pdf_in, pdf_out, ctx, codes, texts=None):
    """Types the values for every form in `codes` (keys of FORMS) found in
    pdf_in onto a copy at pdf_out. Returns a report:
      {"forms": {code: {"pages": [1-based], "fields": {key: {"status", "value", "reason", "mode", "page"}}}},
       "placed": n, "written": bool}
    status: placed (written AND read back), missing (label found, no value on
    file), not_placed (label found, no safe spot / didn't read back),
    prefilled (the buyer printed it already), not_found (label not on the form).
    pdf_out is only written when at least one field was placed."""
    import pdfplumber
    texts = texts if texts is not None else page_texts(pdf_in)
    vals = values_for(ctx)
    report = {"forms": {}, "placed": 0, "written": False}
    placements = []
    with pdfplumber.open(pdf_in) as pdf:
        n_pages = len(pdf.pages)
        for code in codes:
            if code not in FORMS:
                continue
            spec = FORMS[code]
            starts = find_form_pages(texts, code)
            if not starts:
                report["forms"][code] = {"pages": [], "fields": {}, "reason": "form not found in this document's text"}
                continue
            start = starts[0]
            # the form's pages: its first page plus continuation pages, up to
            # the next page that starts another known form
            other_starts = sorted({s for c in FORMS if c != code for s in find_form_pages(texts, c)} | set(starts[1:]))
            end = min([s for s in other_starts if s > start] + [start + 1 + spec.get("pages_after", 2), n_pages])
            pages = list(range(start, end))
            results, done = {}, set()
            scope_open = spec["scope"][0] is None
            scope_closed = False
            for idx, pno in enumerate(pages):
                if scope_closed:
                    break
                pg = pdf.pages[pno]
                if int(pg.rotation or 0) % 360:
                    for fld in spec.get("fields", []):
                        results.setdefault(fld["key"], ("not_placed", None, "rotated page - not typed"))
                    continue
                model = PageModel(pg)
                lo, hi = -1.0, model.height + 1
                s_re, e_re = spec["scope"]
                if s_re and not scope_open:
                    hit = next((ln for ln in model.lines if re.search(s_re, ln["text"])), None)
                    if hit:
                        lo, scope_open = hit["top"] - 2, True
                    else:
                        continue
                if e_re:
                    hit = next((ln for ln in model.lines if ln["top"] > lo + 4 and re.search(e_re, ln["text"])), None)
                    if hit:
                        hi, scope_closed = hit["top"] - 1, True
                in_scope = lambda ln, lo=lo, hi=hi: lo <= ln["top"] and ln["bottom"] <= hi  # noqa: E731
                place_text_fields(model, pno, spec.get("fields", []), vals, in_scope, done, results)
                place_choices(model, pno, spec.get("choices", []), vals, in_scope, done, results)
                place_captions(model, pno, spec.get("captions", []), vals, done, results)
                if spec.get("single_block") and any(st[0] == "placed" and st[1] and st[1][0].page == pno for st in results.values()):
                    break
            fields = {}
            for fld in spec.get("fields", []) + spec.get("choices", []) + spec.get("captions", []):
                st = results.get(fld["key"])
                if st is None:
                    if fld["key"] not in fields:
                        fields[fld["key"]] = {"status": "not_found", "value": vals.get(fld["v"]), "reason": "label not on this edition"}
                    continue
                status, pls, reason = st
                if pls:
                    placements.extend(pls)
                    fields[fld["key"]] = {"status": "placed", "value": vals.get(fld["v"]),
                                          "reason": pls[0].assumed, "mode": pls[0].mode, "page": pls[0].page + 1, "_pl": pls}
                else:
                    fields[fld["key"]] = {"status": status, "value": vals.get(fld["v"]), "reason": reason}
            report["forms"][code] = {"pages": [p + 1 for p in pages], "fields": fields}

    # Two fields aimed at the same spot means one of them read the layout
    # wrong - neither is typed (both stay on the completion guide).
    clash = set()
    for i, a in enumerate(placements):
        for b in placements[i + 1:]:
            if a.page == b.page and a.key != b.key and _overlap(a.box, b.box) > 0.3:
                clash.update({id(a), id(b)})
    if clash:
        placements = [p for p in placements if id(p) not in clash]
        for fr in report["forms"].values():
            for f in fr["fields"].values():
                if f.get("_pl") and any(id(p) in clash for p in f["_pl"]):
                    f["status"], f["reason"], f["_pl"] = "not_placed", "two fields matched the same spot - check by hand", None
    if not placements:
        return _strip(report)

    reader = PdfReader(pdf_in)
    writer = PdfWriter(clone_from=reader)
    by_page = {}
    for pl in placements:
        by_page.setdefault(pl.page, []).append(pl)
    for pno, pls in by_page.items():
        page = writer.pages[pno]
        mb = page.mediabox
        ph = float(mb.top) - float(mb.bottom)
        ops = "".join(_ops_for(pl, ph, float(mb.left), float(mb.bottom)) for pl in pls)
        _overlay_page(page, ops)
    with open(pdf_out, "wb") as fh:
        writer.write(fh)
    report["written"] = True
    verify_placements(pdf_out, placements)
    for code, fr in report["forms"].items():
        for key, f in fr["fields"].items():
            pls = f.get("_pl")
            if pls and not all(p.verified for p in pls):
                f["status"], f["reason"] = "not_placed", "written but did not read back from the PDF - check by eye"
    report["placed"] = sum(1 for fr in report["forms"].values() for f in fr["fields"].values() if f["status"] == "placed")
    return _strip(report)


def _overlap(a, b):
    """Intersection area as a share of the smaller box."""
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    small = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])) or 1
    return w * h / small


def _strip(report):
    for fr in report["forms"].values():
        for f in fr["fields"].values():
            f.pop("_pl", None)
    return report


def verify_placements(pdf_path, placements):
    """Reads the written PDF back: each typed value must be extractable from
    inside its own target box; a tick/circle must have added a drawn path
    there. Sets pl.verified."""
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        for pl in placements:
            pg = pdf.pages[pl.page]
            x0, top, x1, bottom = pl.box
            if pl.kind in ("tick", "circle"):
                objs = [o for o in pg.curves + pg.lines if o["x0"] >= x0 - 4 and o["x1"] <= x1 + 4
                        and o["top"] >= top - 4 and o["bottom"] <= bottom + 4]
                pl.verified = bool(objs)
                continue
            crop = pg.within_bbox((max(0, x0 - 2), max(0, top - 4), min(pg.width, x1 + 2), min(pg.height, bottom + 4)))
            got = re.sub(r"\s+", "", "".join(c["text"] for c in crop.chars if c.get("fontname", "").endswith("Helvetica")))
            want = re.sub(r"\s+", "", pl.value.encode("latin-1", "replace").decode("latin-1"))
            pl.verified = want in got


def render_pages(pdf_path, pages, out_dir, dpi=70):
    """PNG renders of the given 1-based pages (for a human / the harness to look at)."""
    os.makedirs(out_dir, exist_ok=True)
    out = []
    for p in pages:
        stem = os.path.join(out_dir, f"p{p:03d}")
        subprocess.run(["pdftoppm", "-f", str(p), "-l", str(p), "-r", str(dpi), "-png", "-singlefile", pdf_path, stem],
                       capture_output=True, timeout=120)
        if os.path.exists(stem + ".png"):
            out.append(stem + ".png")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf_in")
    ap.add_argument("pdf_out")
    ap.add_argument("--profile", required=True)
    ap.add_argument("--answers")
    ap.add_argument("--forms", default="1,4,9,ceq,form_of_offer")
    ap.add_argument("--buyer")
    ap.add_argument("--contract-no")
    ap.add_argument("--png", help="render the touched pages here")
    args = ap.parse_args()
    prof = json.load(open(args.profile))
    comp = dict(prof["company"])
    if isinstance(comp.get("bank"), dict):
        comp.setdefault("bank_name", comp["bank"].get("bank_name"))
        comp.setdefault("bank_branch_code", comp["bank"].get("branch_code"))
    person = prof["key_people"][0]
    ctx = {"company": comp, "signatory": {"name": person["name"], "capacity": person.get("signatory_capacity") or "Director",
                                          "id_number": person.get("id_number")},
           "answers": json.load(open(args.answers)) if args.answers else {},
           "tender": {"contract_no": args.contract_no, "buyer": args.buyer, "description": None}}
    rep = fill_flat_pdf(args.pdf_in, args.pdf_out, ctx, args.forms.split(","))
    for code, fr in rep["forms"].items():
        print(f"{code}: pages {fr['pages']} {fr.get('reason') or ''}")
        for k, f in fr["fields"].items():
            print(f"   {f['status']:10} {k:40} {f.get('mode') or '':8} {str(f.get('value'))[:40]:40} {f.get('reason') or ''}")
    print(f"placed {rep['placed']}, written {rep['written']}")
    if args.png and rep["written"]:
        pages = sorted({p for fr in rep["forms"].values() for p in fr["pages"]})
        print(render_pages(args.pdf_out, pages, args.png))


if __name__ == "__main__":
    main()
