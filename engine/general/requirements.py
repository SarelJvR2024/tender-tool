"""
"What does THIS non-SANRAL tender require?" - reads a tender's own document
set (whatever the buyer published: one bundled PDF, a folder of SBD/MBD .docx
forms, a zip of buyer-specific templates) and returns a requirement manifest
the Tender Workspace renders and the pack generator follows.

Why this exists (docs/specs/General-Tender-Engine-Findings.md, plus the round
3 corpus in docs/specs/General-Tender-Preparation-Findings.md): non-SANRAL
buyers do NOT share one returnable list.
  - National/provincial departments, SOEs and smaller entities use National
    Treasury's SBD suite (SBD 1/4/6.1, sometimes 3.x/5/7/8/9).
  - Municipalities use the MFMA twin, the MBD suite (MBD 1/4/6.1/7.1/8/9) -
    same purpose and field set, different numbering prefix, usually inside
    one bundled PDF (Dawid Kruiper, Overberg, Cape Winelands, uMlalazi, BCMDA).
  - ESKOM runs its own forms (Form A, Declaration of Shareholding, Supplier
    Declaration of Interest, NEC3 contract) - no SBD/MBD form at all.
  - Each buyer's own wording decides which supporting documents, roles,
    experience evidence and locality rows apply.
So the manifest is read from the documents, never assumed from the buyer type.

Re-used, not re-implemented:
  - experience evidence + locality: engine/discovery/score_outlook.py
    extract_experience_evidence() / extract_locality() (built buyer-agnostic,
    confirmed on 12 non-SANRAL rules + 6 locality tables).
  - preference system / functionality / specific-goal bases:
    score_outlook.estimate_score_outlook().
  - CIDB grading / compulsory briefing: assess_tender.CIDB_RE / BRIEFING_RE.
  - role codes: the 17 non-SANRAL rows of migration 0016's tender_roles.

Every item carries a verbatim `quote` from the document it came from, so the
UI can show WHY something is listed. Nothing is added that the documents don't
mention. A form or document this engine can't fill is listed as "by hand" with
the reason - never silently dropped and never faked.

Usage (dry run, prints the manifest):
    python3 engine/general/requirements.py <file-or-dir> [<file-or-dir> ...] [--json out.json]
"""
import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "discovery"))
from score_outlook import estimate_score_outlook, extract_experience_evidence, extract_locality  # noqa: E402
from assess_tender import CIDB_RE, BRIEFING_RE  # noqa: E402

MANIFEST_VERSION = 1

# ---------------------------------------------------------------------------
# Text extraction for every format seen in the real corpus
# (pdf 476 / docx 35 / zip 25 / xlsx 7 / doc 5 across 300 live releases,
# 2026-10-16 - see the findings doc)
# ---------------------------------------------------------------------------


def docx_text(path):
    import docx
    d = docx.Document(path)
    parts = [p.text for p in d.paragraphs]
    for t in d.tables:
        for row in t.rows:
            seen, cells = set(), []
            for c in row.cells:
                if id(c._tc) in seen:
                    continue
                seen.add(id(c._tc))
                cells.append(c.text.strip())
            parts.append(" | ".join(cells))
    return "\n".join(parts)


def convert_with_soffice(path, target_ext, out_dir):
    """LibreOffice headless conversion (.doc -> .docx, .docx -> .pdf). Returns
    the converted path or None. Same soffice dependency engine/cv/generate_cv.py
    and engine/print_reports.py already have."""
    try:
        subprocess.run(["soffice", "--headless", "--convert-to", target_ext, "--outdir", out_dir, path],
                       capture_output=True, timeout=180)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    out = os.path.join(out_dir, os.path.splitext(os.path.basename(path))[0] + "." + target_ext.split(":")[0])
    return out if os.path.exists(out) else None


def pdf_text(path):
    return pdf_text_or_error(path)[0]


def pdf_text_or_error(path):
    """(text, error). A file pdftotext can't open at all (truncated download,
    an HTML error page saved as .pdf, a password-protected PDF) is a different
    problem from a scanned PDF with no text layer, and the user fixes it
    differently (re-download vs. ask for a text copy / OCR) - so the two are
    never reported with the same words. Before 2026-10-17 both came out as
    "no text layer (scanned image)"."""
    try:
        out = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return "", "pdftotext timed out reading it (very large or damaged PDF)"
    except FileNotFoundError:
        return "", "pdftotext (poppler-utils) is not installed on this worker"
    if out.returncode != 0:
        first = next((ln.strip() for ln in (out.stderr or "").splitlines() if ln.strip()), "")
        return "", "not a readable PDF - corrupt, truncated or not really a PDF" + (f" ({first[:120]})" if first else "") + " - re-download it"
    return out.stdout, None


def collect_documents(paths, work_dir):
    """Expands dirs and zips into a flat list of {name, path, format}. Zips are
    unpacked into work_dir (ESKOM publishes everything as zips)."""
    found = []

    def add(path, display):
        ext = os.path.splitext(path)[1].lower().lstrip(".")
        if ext == "zip":
            dest = os.path.join(work_dir, re.sub(r"[^A-Za-z0-9_.-]", "_", os.path.basename(path)) + "_unz")
            try:
                with zipfile.ZipFile(path) as z:
                    for member in z.namelist():
                        # zip-slip guard: never extract outside dest
                        target = os.path.realpath(os.path.join(dest, member))
                        if not target.startswith(os.path.realpath(dest) + os.sep):
                            continue
                        if member.endswith("/"):
                            continue
                        os.makedirs(os.path.dirname(target), exist_ok=True)
                        with z.open(member) as src, open(target, "wb") as dst:
                            shutil.copyfileobj(src, dst)
                        add(target, f"{display} > {member}")
            except zipfile.BadZipFile:
                found.append({"name": display, "path": path, "format": "zip", "unreadable": "corrupt zip"})
            return
        found.append({"name": display, "path": path, "format": ext or "unknown"})

    for p in paths:
        if os.path.isdir(p):
            for root, _, files in os.walk(p):
                for f in sorted(files):
                    if f.startswith(".") or f == "meta.json":
                        continue
                    full = os.path.join(root, f)
                    add(full, os.path.relpath(full, p))
        else:
            add(p, os.path.basename(p))
    return found


def read_document(doc, work_dir):
    """Fills doc['text'] and, for a legacy .doc, doc['converted_docx'] (the
    LibreOffice .docx conversion the filler can work on)."""
    fmt = doc["format"]
    text = ""
    if fmt == "pdf":
        text, err = pdf_text_or_error(doc["path"])
        if err:
            doc["unreadable"] = err
    elif fmt == "docx":
        try:
            text = docx_text(doc["path"])
        except Exception as e:  # corrupt / not really a docx
            doc["unreadable"] = f"python-docx could not open it: {e}"
    elif fmt == "doc":
        conv = convert_with_soffice(doc["path"], "docx", work_dir)
        if conv:
            doc["converted_docx"] = conv
            text = docx_text(conv)
        else:
            doc["unreadable"] = "LibreOffice could not convert this legacy .doc"
    elif fmt == "txt":
        text = open(doc["path"], encoding="utf-8", errors="replace").read()
    doc["text"] = text or ""
    if not doc.get("unreadable") and fmt in ("pdf", "docx", "doc") and len(doc["text"].strip()) < 50:
        doc["unreadable"] = "no text layer (scanned image) - read it by eye"
    return doc


# ---------------------------------------------------------------------------
# Standard bidding forms (SBD = National Treasury, MBD = municipal twin)
# ---------------------------------------------------------------------------

# code -> (title, what the engine can do with a .docx edition). Titles are the
# real form headings seen in the corpus.
FORMS = {
    "1": ("Invitation to bid", "fill"),
    "2": ("Tax clearance / tax compliance status", "attach"),
    "3": ("Pricing schedule", "by_hand"),  # price is tender-specific - never auto-filled
    "4": ("Bidder's disclosure / declaration of interest", "fill"),
    "5": ("National Industrial Participation Programme", "by_hand"),
    "6.1": ("Preference points claim (PPR 2022)", "fill"),
    "6.2": ("Declaration certificate for local production and content", "by_hand"),
    "7": ("Contract form", "by_hand"),
    "8": ("Declaration of bidder's past supply chain management practices", "fill"),
    "9": ("Certificate of independent bid determination", "fill"),
}

FORM_RE = re.compile(r"\b([SM])\s?B\s?D\s*[-–]?\s*(\d{1,2})(?:\s*[.(]\s*(\d)\s*\)?)?(?:\s*\(\s*[a-z]\s*\))?", re.IGNORECASE)
# "MDB 7.1" typo seen verbatim in Dawid Kruiper TN051 3.4
FORM_TYPO_RE = re.compile(r"\bMDB\s*(\d)(?:\.(\d))?", re.IGNORECASE)


def _form_code(major, minor):
    major = str(int(major))
    if major == "6" and minor in ("1", "2"):
        return f"6.{minor}"
    if major == "3":
        return "3"
    if major == "7":
        return "7"
    return major if major in FORMS else None


def forms_in_text(text):
    """{(suite, code): count} for every SBD/MBD reference in a text."""
    counts = {}
    for m in FORM_RE.finditer(text):
        code = _form_code(m.group(2), m.group(3))
        if code:
            key = ("SBD" if m.group(1).upper() == "S" else "MBD", code)
            counts[key] = counts.get(key, 0) + 1
    for m in FORM_TYPO_RE.finditer(text):
        code = _form_code(m.group(1), m.group(2))
        if code:
            counts[("MBD", code)] = counts.get(("MBD", code), 0) + 1
    return counts


# Field labels that make a document an EDITION of the form (not just a
# mention). Taken from the real Treasury / RAF / DSTI / SSA / SITA / Mthashana
# / Tourism editions (findings doc, round 3).
EDITION_MARKERS = {
    # SBD 4 / 6.1 editions also say "NAME OF BIDDER" / "invitation to bid", so
    # SBD 1 needs its own bidder-detail block, 3 of these 4.
    "1": ([r"VAT\s+REGISTRATION\s+NUMBER", r"TCS\s*PIN|CSD\s*No|SUPPLIER\s+COMPLIANCE\s+STATUS|TAX\s+COMPLIANCE\s+SYSTEM\s+PIN",
           r"ACCREDITED\s+REPRESENTATIVE|FOREIGN\s+BASED\s+SUPPLIER", r"POSTAL\s+ADDRESS"], 3),
    "4": ([r"employed\s+by\s+(?:the\s+state|an\s+organ\s+of\s+state)|EMPLOYMENT\s+BY\s+(?:AN\s+)?ORGAN\s+OF\s+STATE",
           r"relationship\s+with\s+any\s+person", r"interest\s+in\s+any\s+other\s+related",
           # MBD 4, the older municipal "Declaration of Interest" layout (Dawid Kruiper TN051 p.30)
           r"DECLARATION\s+OF\s+INTEREST", r"in\s+the\s+service\s+of\s+the\s+state"], 2),
    "6.1": ([r"Name\s+of\s+company/firm", r"Company\s+registration\s+number", r"POINTS\s+CLAIMED|points\s+claimed"], 2),
    # The CSD supplier leaflet also names both registers - SBD 8 needs its heading.
    "8": ([r"PAST\s+SUPPLY\s+CHAIN\s+MANAGEMENT\s+PRACTICES", r"Database\s+of\s+Restricted\s+Suppliers|Register\s+for\s+Tender\s+Defaulters"], 2),
    "9": ([r"INDEPENDENT\s+BID\s+DETERMINATION"], 1),
}


def edition_forms(text):
    out = []
    for code, (pats, need) in EDITION_MARKERS.items():
        if sum(1 for p in pats if re.search(p, text, re.IGNORECASE)) >= need:
            out.append(code)
    return out


# ---------------------------------------------------------------------------
# Supporting documents ("returnables"). Each key was seen in the round-3
# corpus (counts per tender in the findings doc); vault = the companies column
# that already answers it (migrations 0001/0014), upload = the user attaches a
# copy for this tender when no vault field exists.
# ---------------------------------------------------------------------------

RETURNABLES = [
    {"key": "csd_report", "label": "Central Supplier Database (CSD) registration / summary report",
     "re": r"central\s+supplier\s+database|\bCSD\s+(?:registration|report|summary|number|supplier)", "vault": "csd"},
    {"key": "tax_compliance", "label": "Tax compliance status (SARS TCS PIN)",
     "re": r"tax\s+compliance\s+status|TCS\s*PIN|tax\s+clearance\s+certificate", "vault": "tax"},
    {"key": "bbbee_proof", "label": "B-BBEE certificate or sworn affidavit",
     "re": r"B-?BBEE\s+(?:status\s+level\s+)?(?:verification\s+)?certificate|sworn\s+affidavit", "vault": "bbbee"},
    {"key": "coid", "label": "COID letter of good standing",
     "re": r"\bCOID\b|compensation\s+(?:for\s+)?occupational\s+injuries|letter\s+of\s+good\s+standing", "vault": "coid"},
    {"key": "cidb", "label": "CIDB registration / grading",
     "re": r"\bCIDB\b", "vault": "cidb"},
    {"key": "cipc_documents", "label": "CIPC company registration documents",
     "re": r"\bCIPC\b|company\s+registration\s+(?:documents|certificate)", "vault": None},
    {"key": "director_ids", "label": "Certified ID copies of directors / members",
     "re": r"(?:certified\s+)?cop(?:y|ies)\s+of\s+(?:the\s+)?(?:directors'?\s+|members'?\s+)?(?:ID|identity)", "vault": None},
    {"key": "municipal_account", "label": "Municipal rates account / proof not in arrears",
     "re": r"municipal\s+(?:rates|account|services)|rates\s+(?:and\s+taxes|clearance)|not\s+in\s+arrears", "vault": None},
    {"key": "bank_letter", "label": "Bank confirmation letter / bank rating",
     "re": r"bank\s+(?:confirmation\s+)?letter|bank\s+rating|letter\s+from\s+(?:the\s+|your\s+)?bank", "vault": "bank"},
    {"key": "public_liability", "label": "Public liability insurance",
     "re": r"public\s+liability", "vault": None},
    {"key": "pi_insurance", "label": "Professional indemnity insurance",
     "re": r"professional\s+indemnity", "vault": "insurance"},
    {"key": "psira", "label": "PSIRA registration certificate",
     "re": r"\bPSIRA\b", "vault": None},
    {"key": "financial_statements", "label": "Audited / annual financial statements",
     "re": r"audited\s+(?:annual\s+)?financial\s+statements|annual\s+financial\s+statements", "vault": None},
    {"key": "she_plan", "label": "Health & safety (SHE) plan / file",
     "re": r"health\s+and\s+safety\s+(?:plan|file)|SHE\s+(?:plan|file)|safety\s+plan", "vault": None},
    {"key": "jv_agreement", "label": "Joint venture / consortium agreement (if bidding as a JV)",
     "re": r"joint\s+venture\s+agreement|consortium\s+agreement", "vault": None, "conditional": "jv"},
]

REQUIRED_CONTEXT_RE = re.compile(
    r"\bmust\b|\bshall\b|attach|submit|compulsory|mandatory|non-?\s*responsive|disqualif|requir|proof\s+of|provide",
    re.IGNORECASE)


def _quote(text, start, end, width=110):
    a = max(0, start - min(width, 70))
    b = min(len(text), end + width + 40)
    s = re.sub(r"\s+", " ", text[a:b]).strip()
    return s[:240]


def find_returnables(docs):
    out = []
    for r in RETURNABLES:
        rx = re.compile(r["re"], re.IGNORECASE)
        best = None
        mentions = 0
        for d in docs:
            t = d.get("text") or ""
            for m in rx.finditer(t):
                mentions += 1
                ctx = t[max(0, m.start() - 200): m.end() + 200]
                strong = bool(REQUIRED_CONTEXT_RE.search(ctx))
                if best is None or (strong and not best[0]):
                    best = (strong, d["name"], _quote(t, m.start(), m.end()))
                if best[0]:
                    break
            if best and best[0]:
                break
        if best:
            out.append({
                "key": r["key"], "label": r["label"], "vault": r["vault"],
                "conditional": r.get("conditional"),
                "strength": "required" if best[0] else "mentioned",
                "mentions": mentions, "document": best[1], "quote": best[2],
            })
    return out


# ---------------------------------------------------------------------------
# Key-person roles (migration 0016's non-SANRAL tender_roles rows). Each
# regex was checked against the tender its role row cites.
# ---------------------------------------------------------------------------

ROLE_PATTERNS = [
    ("contractor.contract_manager", r"\bcontracts?\s+manager\b"),
    ("contractor.site_agent", r"\bsite\s+agent\b"),
    ("contractor.foreman", r"\bforem[ae]n\b"),
    # NEC3's "Employer's / Client's Project Manager" is the buyer's own agent, not a bidder role.
    ("contractor.project_manager", r"(?<!employer's\s)(?<!employer’s\s)(?<!client's\s)\bproject\s+manager\b"),
    ("hs.safety_officer", r"(?<!purchaser's\s)(?<!purchaser’s\s)(?<!employer's\s)\bsafety\s+officer\b"),
    ("psp.professional_engineer", r"\bprofessional\s+engineer\b(?!ing)|\bPr\.?\s?Eng\b"),
    ("psp.professional_architect", r"\bprofessional\s+architect\b"),
    ("psp.architectural_technologist", r"\barchitectural\s+technologist\b"),
    ("psp.quantity_surveyor", r"\bquantity\s+surveyor\b"),
    ("psp.town_planner", r"\btown\s+(?:and\s+regional\s+)?planner\b"),
    ("psp.property_valuer", r"\b(?:property\s+)?valuer\b|\bSACPVP\b"),
    ("trades.mechanic", r"\bmechanic\s+trade\s+test|\bmechanical\s+engineering\s+diploma"),
    ("trades.auto_electrician", r"\bauto\s+electrician\b|\bmillwright\b"),
    ("trades.carpenter", r"\bcarpenter\b"),
    ("services.pest_control_operator", r"(?<!assistant\s)\bpest\s+control\s+operator\b"),
    ("services.assistant_pest_control_operator", r"\bassistant\s+pest\s+control\s+operator\b"),
    ("services.security_officer", r"\bsecurity\s+officers?\b|\bPSIRA[- ]registered\b"),
]


ROLE_CONTEXT_RE = re.compile(
    r"key\s+(?:personnel|staff)|\bCVs?\b|curriculum|experience|qualifi|registered|registration|certificate|"
    r"years|\bmust\b|\bshall\b|required|appoint|organogram|team",
    re.IGNORECASE)
# "Pr.CPM   Professional Construction Project Manager" - an abbreviations
# list (Treasury RT83's glossary) names roles nobody is asked to field.
GLOSSARY_LINE_RE = re.compile(r"^\s*[A-Z][A-Za-z.()/&]{0,14}\s{2,}[A-Z]")


def _line_at(text, pos):
    a = text.rfind("\n", 0, pos) + 1
    b = text.find("\n", pos)
    return text[a: b if b != -1 else len(text)]


def find_roles(docs):
    out = []
    for code, pat in ROLE_PATTERNS:
        rx = re.compile(pat, re.IGNORECASE)
        hit = None
        n = 0
        for d in docs:
            t = d.get("text") or ""
            for m in rx.finditer(t):
                if GLOSSARY_LINE_RE.match(_line_at(t, m.start())):
                    continue
                if not ROLE_CONTEXT_RE.search(t[max(0, m.start() - 250): m.end() + 250]):
                    continue
                n += 1
                if hit is None:
                    hit = (d["name"], _quote(t, m.start(), m.end()))
        if hit:
            out.append({"role_code": code, "mentions": n, "document": hit[0], "quote": hit[1]})
    return out


# ---------------------------------------------------------------------------
# Buyer-specific forms: things a bidder must complete that are not an SBD/MBD
# form. The engine has no template for these - they are listed honestly as
# "complete by hand" (findings doc: ESKOM Form A / declarations / NEC3,
# municipal Form of Quotation, Sentech consent form, QCTO CV template).
# ---------------------------------------------------------------------------

BUYER_FORM_NAME_RE = re.compile(
    r"declaration|form\b|questionnaire|affidavit|consent|template|acknowledg|annexure|schedule|certificate|"
    r"returnable|method\s+statement|quality\s+(?:control|plan)|attendance",
    re.IGNORECASE)
REFERENCE_NAME_RE = re.compile(
    r"conditions\s+of\s+(?:contract|tender)|\bGCC\b|manual|leaflet|fact\s*sheet|read\s*me|help|exchange\s+rates|"
    r"instruction|specification|scope\s+of\s+work|terms\s+of\s+reference|\bToR\b|strategy|drawings?|fraud\s+notice|"
    r"contact\s+details|explanation",
    re.IGNORECASE)
IN_TEXT_BUYER_FORMS = [
    ("form_of_quotation", "Form of Quotation", r"FORM\s+OF\s+QUOTATION"),
    ("form_of_offer", "Form of Offer and Acceptance", r"FORM\s+OF\s+OFFER(?:\s+AND\s+ACCEPTANCE)?"),
    ("nec3_contract", "NEC3 contract (ESKOM / Transnet contract family)", r"\bNEC\s*3\b"),
    ("compulsory_enterprise_questionnaire", "Compulsory Enterprise Questionnaire", r"COMPULSORY\s+ENTERPRISE\s+QUESTIONNAIRE"),
    ("record_of_addenda", "Record of Addenda", r"RECORD\s+OF\s+ADDENDA"),
    ("certificate_of_authority", "Certificate / resolution of authority for signatory",
     r"(?:CERTIFICATE|RESOLUTION)\s+OF\s+AUTHORITY"),
    ("declaration_of_shareholding", "Declaration of Shareholding and Directorship", r"DECLARATION\s+OF\s+SHAREHOLDING"),
]


def classify_document(doc, mentioned_forms):
    """kind: 'standard_form' (an SBD/MBD edition), 'buyer_form', 'tender_document'
    (the main bundle / RFQ), 'reference' (conditions, manuals, specs), 'unreadable'."""
    name = os.path.basename(doc["name"])
    text = doc.get("text") or ""
    if REFERENCE_NAME_RE.search(name) and not forms_in_text(name):
        doc["edition_of"] = []
        return "reference"
    eds = edition_forms(text)
    doc["edition_of"] = eds
    in_doc = forms_in_text(text) if text else {}
    name_forms = forms_in_text(name)
    if doc.get("unreadable") and not name_forms:
        return "unreadable"
    big = len(text) > 60000
    if eds and (name_forms or not big):
        return "standard_form"
    if eds and big:
        return "tender_document"  # a bundle that contains forms (Mthashana, SSA, Dawid Kruiper)
    if name_forms:
        return "standard_form"
    if REFERENCE_NAME_RE.search(name):
        return "reference"
    if BUYER_FORM_NAME_RE.search(name) and len(text) < 60000:
        return "buyer_form"
    return "tender_document"


# ---------------------------------------------------------------------------
# Questions only a human can answer for THIS tender. Each one is tied to a
# real field on a real form edition (quoted labels from the corpus), and is
# only asked when that form (or condition) is actually required.
# ---------------------------------------------------------------------------

YES_NO = ["no", "yes"]

QUESTIONS = [
    # --- SBD/MBD 1 -------------------------------------------------------
    {"key": "signatory_person_id", "form": "1", "group": "Signatory", "type": "person",
     "label": "Who signs this bid?",
     "help": "Fills SBD 1 'capacity under which this bid is signed', SBD 4 'Designation' and SBD 6.1 'Surname and name'. "
             "Their capacity comes from the person's record (People page)."},
    {"key": "total_bid_price", "form": "1", "group": "Price", "type": "text", "optional": True,
     "label": "Total bid price (incl. VAT)",
     "help": "SBD 1 'TOTAL BID PRICE'. Tender-specific - Tender Tool never computes it. Leave blank to write it by hand."},
    {"key": "sbd1.accredited_representative", "form": "1", "group": "SBD 1 questions", "type": "yes_no",
     "label": "Are you the accredited representative in South Africa for the goods/services/works offered?",
     "help": "SBD 1 Part B. If yes, the form says to enclose proof."},
    {"key": "sbd1.foreign_based", "form": "1", "group": "SBD 1 questions", "type": "yes_no", "derived_default": "no",
     "label": "Are you a foreign-based supplier for the goods/services/works offered?",
     "help": "SBD 1 Part B. Defaults to No for a CIPC-registered South African company."},
    # --- SBD/MBD 4 -------------------------------------------------------
    {"key": "sbd4.employed_by_state", "form": "4", "group": "Declarations (SBD 4)", "type": "yes_no",
     "label": "Is the bidder, or any director / shareholder / member / person with a controlling interest, employed by the state?",
     "help": "SBD 4 2.1 (Treasury: 'employed by the state'; RAF/SALB/QCTO: 'DECLARATION ON EMPLOYMENT BY ORGAN OF STATE')."},
    {"key": "sbd4.relationship_with_employee", "form": "4", "group": "Declarations (SBD 4)", "type": "yes_no",
     "label": "Does anyone connected with the bidder have a relationship with an employee of THIS buyer?",
     "help": "SBD 4 2.2 - specific to this buyer, so it's asked per tender."},
    {"key": "sbd4.interest_in_related_enterprise", "form": "4", "group": "Declarations (SBD 4)", "type": "yes_no",
     "label": "Does the bidder or any director have an interest in another related enterprise bidding for this contract?",
     "help": "SBD 4 2.3."},
    # --- SBD/MBD 6.1 -----------------------------------------------------
    {"key": "sbd6_1.points_claimed", "form": "6.1", "group": "Preference points (SBD 6.1)", "type": "text", "optional": True,
     "label": "Specific-goal points you claim, per this buyer's table",
     "help": "Each buyer sets its own specific-goal categories (B-BBEE level, ownership, locality...). "
             "Written on the completion guide; the points table itself is ticked by hand."},
    # --- SBD/MBD 8 -------------------------------------------------------
    {"key": "sbd8.restricted_supplier", "form": "8", "group": "Past SCM practices (SBD 8)", "type": "yes_no",
     "label": "Is the bidder or any director listed on National Treasury's Database of Restricted Suppliers?",
     "help": "SBD 8 4.1."},
    {"key": "sbd8.tender_defaulter", "form": "8", "group": "Past SCM practices (SBD 8)", "type": "yes_no",
     "label": "Is the bidder or any director listed on the Register for Tender Defaulters?",
     "help": "SBD 8 4.2."},
    {"key": "sbd8.convicted", "form": "8", "group": "Past SCM practices (SBD 8)", "type": "yes_no",
     "label": "Was the bidder or any director convicted of fraud or corruption in the past five years?",
     "help": "SBD 8 4.3."},
    {"key": "sbd8.contract_terminated", "form": "8", "group": "Past SCM practices (SBD 8)", "type": "yes_no",
     "label": "Was any contract with an organ of state terminated in the past five years for failure to perform?",
     "help": "SBD 8 4.4."},
    # --- conditional ---------------------------------------------------------
    {"key": "bidding_as_jv", "condition": "jv", "group": "Bid structure", "type": "yes_no",
     "label": "Are you bidding as a joint venture / consortium?",
     "help": "This tender mentions a JV agreement. If yes, upload the signed agreement below."},
    {"key": "briefing_attended", "condition": "briefing", "group": "Briefing", "type": "yes_no",
     "label": "Did you attend the compulsory briefing / site meeting?",
     "help": "Missing a compulsory briefing usually makes the bid non-responsive. Upload the attendance certificate if one was issued."},
]

# Company facts SBD 1 asks for that 0001's companies table had no column for
# (added by 0017). Asked once on the workspace, saved to the company.
COMPANY_FIELDS = [
    {"key": "company.telephone", "column": "telephone", "form": "1", "label": "Company telephone number",
     "help": "SBD 1 'TELEPHONE NUMBER' (bidder section)."},
    {"key": "company.cellphone", "column": "cellphone", "form": "1", "label": "Company cellphone number", "optional": True,
     "help": "SBD 1 'CELLPHONE NUMBER'."},
    {"key": "company.email", "column": "email", "form": "1", "label": "Company e-mail address",
     "help": "SBD 1 'E-MAIL ADDRESS' (bidder section)."},
    {"key": "company.cidb_grading", "column": "cidb_grading", "condition": "cidb", "label": "CIDB grading (e.g. 6CE)",
     "help": "This tender names a CIDB grading. Leave blank if you have none."},
]


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

def extract_requirements(paths, work_dir=None, source_label=None, keep_text=False):
    """paths: files and/or directories (zips are unpacked). Returns the manifest
    dict (JSON-safe). Document dicts keep local paths under `_local` so the pack
    generator can reuse the downloaded copies; strip_local() removes them before
    the manifest is stored."""
    own_tmp = work_dir is None
    work_dir = work_dir or tempfile.mkdtemp(prefix="tt_req_")
    docs = [read_document(d, work_dir) for d in collect_documents(paths, work_dir)]
    all_text = "\n".join(d.get("text") or "" for d in docs)

    mentioned = {}
    for d in docs:
        for k, n in forms_in_text(d.get("text") or "").items():
            mentioned[k] = mentioned.get(k, 0) + n
        for k, n in forms_in_text(os.path.basename(d["name"])).items():
            mentioned[k] = mentioned.get(k, 0) + n

    doc_entries = []
    for d in docs:
        kind = classify_document(d, mentioned)
        editable = d["format"] == "docx" or bool(d.get("converted_docx"))
        doc_entries.append({
            "name": d["name"], "format": d["format"], "kind": kind,
            "forms": d.get("edition_of", []), "editable": editable and kind in ("standard_form", "tender_document"),
            "converted_from_doc": bool(d.get("converted_docx")),
            "unreadable": d.get("unreadable"),
            "chars": len(d.get("text") or ""),
            "_local": d.get("converted_docx") or d["path"],
        })

    suites = {s for (s, _), n in mentioned.items()}
    if "MBD" in suites and "SBD" not in suites:
        suite = "MBD"
    elif "SBD" in suites:
        suite = "SBD"
    else:
        suite = None

    forms = []
    codes = sorted({c for (_, c) in mentioned} | {c for e in doc_entries for c in e["forms"]},
                   key=lambda c: float(c))
    for code in codes:
        title, capability = FORMS[code]
        editions = [e for e in doc_entries if code in e["forms"]]
        fillable = [e for e in editions if e["editable"]]
        prefix = suite or "SBD"
        n_mentions = mentioned.get((prefix, code), 0) + mentioned.get(("SBD" if prefix == "MBD" else "MBD", code), 0)
        quote = None
        for d in docs:
            m = re.search(rf"\b{prefix[0]}\s?B\s?D\s*{re.escape(code).replace(r'\.', r'\s*[.(]\s*')}", d.get("text") or "", re.IGNORECASE)
            if m:
                quote = _quote(d["text"], m.start(), m.end(), 80)
                break
        if capability == "fill" and fillable:
            status, reason = "auto", f"Filled from your data in {fillable[0]['name']}" + (
                " (converted from .doc by LibreOffice - check the layout)" if fillable[0]["converted_from_doc"] else "")
        elif capability == "fill" and editions:
            status, reason = "by_hand", (f"Only a {editions[0]['format'].upper()} edition was published ({editions[0]['name']}) - "
                                         "flat PDFs have no fillable fields, so it's completed by hand from the completion guide.")
        elif capability == "fill":
            status, reason = "by_hand", ("Named in the tender documents but no copy of the form was found in them - "
                                         "it's usually inside the main bundle; complete it by hand from the completion guide.")
        elif capability == "attach":
            status, reason = "attach", "Satisfied by the tax compliance status (TCS PIN) - attached from the vault."
        else:
            status, reason = "by_hand", {
                "3": "Pricing is tender-specific - Tender Tool never fills prices.",
                "5": "National Industrial Participation applies only to large imported content - complete by hand if it applies.",
                "6.2": "Local-content declaration needs this bid's own product data - complete by hand.",
                "7": "Contract form - signed by hand (some buyers want it with the bid, most only after award).",
            }.get(code, "Complete by hand.")
        forms.append({"code": code, "label": f"{prefix} {code}", "title": title, "status": status, "reason": reason,
                      "mentions": n_mentions, "quote": quote,
                      "editions": [{"document": e["name"], "format": e["format"], "editable": e["editable"]} for e in editions]})

    buyer_forms = []
    for e in doc_entries:
        if e["kind"] == "buyer_form":
            buyer_forms.append({"key": "doc:" + os.path.basename(e["name"]), "label": os.path.basename(e["name"]),
                                "document": e["name"], "format": e["format"],
                                "reason": "Buyer-specific form - no Tender Tool template for it; complete by hand and attach."})
    for key, label, pat in IN_TEXT_BUYER_FORMS:
        for d in docs:
            m = re.search(pat, d.get("text") or "", re.IGNORECASE)
            if m:
                buyer_forms.append({"key": key, "label": label, "document": d["name"], "format": d["format"],
                                    "quote": _quote(d["text"], m.start(), m.end(), 80),
                                    "reason": "Buyer-specific form inside the tender document - complete by hand."})
                break

    cidb_m = CIDB_RE.search(all_text)
    brief_m = BRIEFING_RE.search(all_text)
    non_compulsory = bool(re.search(r"non[- ]compulsory\s+(?:clarification\s+)?brief", all_text, re.IGNORECASE))
    outlook = estimate_score_outlook(all_text, "full_document" if all_text.strip() else "no_extractable_text",
                                     {"disciplines": [], "bee_level": None, "offices": []})
    loc = extract_locality(all_text) if all_text.strip() else {"rows": [], "mandatory_local_office": None}
    returnables = find_returnables(docs)
    conditions = {
        "cidb": bool(cidb_m) or any(r["key"] == "cidb" and r["strength"] == "required" for r in returnables),
        "briefing": bool(brief_m) and not non_compulsory,
        "jv": any(r["key"] == "jv_agreement" for r in returnables),
    }
    required_form_codes = {f["code"] for f in forms}
    questions = [q for q in QUESTIONS
                 if (q.get("form") and q["form"] in required_form_codes) or (q.get("condition") and conditions.get(q["condition"]))]
    company_fields = [c for c in COMPANY_FIELDS
                      if (c.get("form") and c["form"] in required_form_codes) or (c.get("condition") and conditions.get(c["condition"]))]

    manifest = {
        "version": MANIFEST_VERSION,
        "extracted_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "source": source_label,
        "form_suite": suite,
        "documents": doc_entries,
        "forms": forms,
        "buyer_forms": buyer_forms,
        "returnables": returnables,
        "roles": find_roles(docs),
        "cidb": {"grading": cidb_m.group(1).replace(" ", "").upper(), "quote": _quote(all_text, cidb_m.start(), cidb_m.end())} if cidb_m else None,
        "briefing": {"compulsory": conditions["briefing"], "quote": _quote(all_text, brief_m.start(), brief_m.end())} if brief_m else None,
        "scoring": {
            "preference_system": outlook["preference_system"],
            "functionality": outlook["functionality"],
            "specific_goal_bases": outlook["specific_goals"].get("bases", []),
        },
        "experience_evidence": extract_experience_evidence(all_text) if all_text.strip() else {"source": "not_found", "rules": []},
        "locality": {"rows": loc["rows"], "mandatory_local_office": loc["mandatory_local_office"]},
        "questions": questions,
        "company_fields": company_fields,
        "gaps": _gaps(doc_entries, forms, suite, buyer_forms),
    }
    if own_tmp:
        manifest["_work_dir"] = work_dir
    if keep_text:
        # for the intake step (engine/intake/classify_tender.py): fit scoring
        # reads the same text instead of extracting every document twice.
        manifest["_all_text"] = all_text
    return manifest


def _gaps(doc_entries, forms, suite, buyer_forms):
    """Plain statements of what this engine can't do for this tender - shown
    in the UI and the pack index instead of being hidden."""
    gaps = []
    readable = [e for e in doc_entries if e["chars"] > 0 and not e["unreadable"]]
    if not readable:
        # Nothing was read, so nothing can be concluded about the forms - the
        # old wording ("uses no SBD/MBD standard forms") was a confident
        # statement made from zero evidence.
        gaps.append("None of this tender's documents could be read, so what it requires is unknown - nothing below "
                    "was checked against its documents. Upload a text PDF or Word copy.")
    elif suite is None and any(e["unreadable"] for e in doc_entries):
        gaps.append("No SBD/MBD standard forms were found in the documents that could be read - but some couldn't be "
                    "read (listed below), and the forms may be in those.")
    elif suite is None:
        gaps.append("This tender uses no SBD/MBD standard forms - its returnable forms are the buyer's own, which "
                    "Tender Tool has no templates for. The pack orders your supporting documents; the buyer's forms are "
                    "completed by hand.")
    for f in forms:
        if f["status"] == "by_hand" and FORMS[f["code"]][1] == "fill":
            gaps.append(f"{f['label']} must be completed by hand: {f['reason']}")
    unread = [e["name"] for e in doc_entries if e["kind"] == "unreadable"]
    if unread:
        gaps.append("Couldn't read: " + "; ".join(unread[:5]) + " - check these documents by eye.")
    return gaps


def strip_local(manifest):
    m = json.loads(json.dumps(manifest))
    m.pop("_work_dir", None)
    m.pop("_all_text", None)
    for d in m.get("documents", []):
        d.pop("_local", None)
    return m


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--json", help="write the manifest here")
    args = ap.parse_args()
    m = extract_requirements(args.paths)
    clean = strip_local(m)
    if args.json:
        json.dump(clean, open(args.json, "w"), indent=2)
    print(f"form suite: {clean['form_suite']}")
    for d in clean["documents"]:
        print(f"  doc [{d['kind']}] {d['name']} ({d['format']}{', editable' if d['editable'] else ''}) forms={d['forms']}"
              + (f" UNREADABLE: {d['unreadable']}" if d["unreadable"] else ""))
    for f in clean["forms"]:
        print(f"  form {f['label']:8} {f['status']:8} x{f['mentions']} - {f['reason'][:110]}")
    for b in clean["buyer_forms"]:
        print(f"  buyer form: {b['label']}")
    for r in clean["returnables"]:
        print(f"  returnable {r['key']:22} {r['strength']:9} x{r['mentions']}: {r['quote'][:100]}")
    for r in clean["roles"]:
        print(f"  role {r['role_code']:38} x{r['mentions']}: {r['quote'][:90]}")
    print(f"  cidb: {clean['cidb'] and clean['cidb']['grading']}  briefing: {clean['briefing'] and clean['briefing']['compulsory']}")
    print(f"  pref: {clean['scoring']['preference_system']['system']}  functionality: {clean['scoring']['functionality'].get('threshold')}"
          f"  evidence rules: {len(clean['experience_evidence']['rules'])}  locality rows: {len(clean['locality']['rows'])}")
    print(f"  questions: {[q['key'] for q in clean['questions']]}")
    print(f"  company fields: {[c['key'] for c in clean['company_fields']]}")
    for g in clean["gaps"]:
        print(f"  GAP: {g[:160]}")
    if m.get("_work_dir"):
        shutil.rmtree(m["_work_dir"], ignore_errors=True)


if __name__ == "__main__":
    main()
