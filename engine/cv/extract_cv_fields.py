"""
CV AI-extraction bridge: reads an uploaded CV (cv_uploads.mode = 'ai_extract')
and PROPOSES people/projects field values for a human to confirm or correct on
the People page. It never writes to `people` or `projects` itself.

Spec: "CVs: upload once, never recapture" in
docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md. Evidence and design
reasoning: docs/specs/CV-Extraction-Findings.md.

Pipeline for one upload (same async request/fulfil shape as
process_cv_jobs.py; the web app on Vercel can't run Python/LibreOffice):

  1. claim:   cv_uploads.status extraction_requested -> extracting (atomic,
              only if still extraction_requested), extraction_claimed_at set.
  2. read:    download the original from the private cv-documents bucket and
              pull its text layer - pdftotext for PDF, python-docx for .docx,
              LibreOffice -> .docx for legacy .doc. These are the helpers
              engine/general/requirements.py already uses for tender
              documents (imported, not re-written).
  3. gate:    refuse, with a plain reason, anything we can't read honestly:
              an image upload, a scanned PDF with no text layer, garbled text
              (bad font encoding), a file far too long to be one person's CV.
              Nothing is guessed from a file we can't read.
  4. redact:  South African ID numbers (13 digits, valid checksum) are found
              locally and replaced with a placeholder BEFORE any text leaves
              this machine. The ID is proposed from the local match.
  5. parse:   one Claude Messages API call with a JSON-schema structured
              output: every proposed value comes with the verbatim line of
              the CV it was read from. Needs ANTHROPIC_API_KEY (see
              CV-Extraction-Findings.md "What Sarel needs to set up").
  6. check:   every quote is looked up in the CV text again. A value whose
              quote isn't really in the CV, a registration number whose
              digits don't appear in the CV, a date the CV only gives as a
              year, a value outside SANRAL's own dropdown list - each is
              flagged, so the review screen leaves it unticked by default.
              The model saying the document isn't a CV, or finding nothing,
              fails the job with that reason.
  7. store:   cv_extraction_results row (migration 0023), review_status
              'pending_review'; cv_uploads.status -> extracted. A failure sets
              cv_uploads.status = extraction_failed with extraction_error.

The People page then shows proposed-vs-current per field; only the user's
"Save selected fields" action (app/app/people/actions.ts applyCvExtraction)
writes to people/projects.

Usage:
    python3 extract_cv_fields.py [--once]                  # process the queue once (default)
    python3 extract_cv_fields.py --loop [--interval 30]    # always-on mode
    python3 extract_cv_fields.py --file CV.pdf --text-only # local: show what text we read
    python3 extract_cv_fields.py --file CV.docx            # local: full extraction (needs ANTHROPIC_API_KEY)

Environment:
    NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   queue mode only
    ANTHROPIC_API_KEY                                    needed only when there is a CV to parse
    CV_EXTRACTION_MODEL                                  optional, default claude-opus-5-5

Missing ANTHROPIC_API_KEY with CVs waiting: the pass exits 1 with a clear
message and the uploads stay 'extraction_requested' (not failed), so they are
picked up as soon as the key is set - the user never has to re-upload.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ENGINE, "worker"))
sys.path.insert(0, os.path.join(ENGINE, "general"))

from poll_loop import poll_forever, DEFAULT_INTERVAL_SECONDS, system_alerts  # noqa: E402
from process_cv_jobs import supabase_request  # noqa: E402  (same REST helper, same env vars)
from requirements import docx_text, pdf_text, convert_with_soffice  # noqa: E402
sys.path.insert(0, os.path.join(ENGINE, "ocr"))
import scan_ocr  # noqa: E402  (EXPERIMENTAL - docs/specs/OCR-Evaluation.md)

DEFAULT_MODEL = "claude-opus-5-5"
# A real text pull + one structured-output call normally takes well under a
# minute. 180s is generous headroom for a large CV, well short of
# STALE_AFTER_MINUTES below, so a genuinely hung call times out and retries
# (TransientError) long before a row would ever need the stale-reclaim.
LLM_TIMEOUT_SECONDS = 180
# Lowered from 30 (UX audit, 2026-10-23: "CV extractions dying... stuck in
# 'extracting' for over 30 minutes" - 30 minutes was itself the problem, not
# just the worst case). 10 minutes is still generous above LLM_TIMEOUT_SECONDS
# and the Supabase REST calls' own 30s timeouts - real room for one slow
# pass, not a half-hour wait before any safety net acts.
STALE_AFTER_MINUTES = 10  # one API call + a text pull; this long means the worker died

# ---------------------------------------------------------------------------
# SANRAL's own closed lists. Read out of the real R.396-010-2025/1F
# Conventional workbook's Form B2.1 dropdowns (templates/samples/
# R.396-010-2025.1F_ran.xlsm, sheet 'TEND 1X', D76 and H76) with
# engine/sanral_fill.Workbook.options(). engine/fill_conventional.py /
# fill_tender.py call set_dropdown() with people.ecsa_level /
# qualifications.highest_level and raise on any label not in these lists, so
# a proposal outside them would break pack generation later - it is flagged.
# ---------------------------------------------------------------------------
ECSA_LEVELS = [
    "Professional Engineer", "Professional Engineering Technologist", "Professional Certificated Engineer",
    "Professional Engineering Technician", "Candidate Engineer", "Candidate Engineering Technologist",
    "Candidate Certificated Engineer", "Candidate Engineering Technician", "Unregistered",
]
QUALIFICATION_LEVELS = [
    "Higher Certificates and Advanced National (vocational) Cert.", "Diploma and Advanced certificates",
    "Bachelors Degree and Advanced Diplomas", "Honours, Post Grad diploma and Professional Qualifications",
    "Masters Degree", "Doctoral Degree",
    "National Senior Certificate and National (vocational) Cert. level 4",
]

# people columns this step proposes (0001_init_schema.sql). Deliberately not:
# description / signatory_capacity (company decisions, not CV facts) and any
# years_experience (never stored - computed per tender from initial_graduated).
PERSON_TEXT_FIELDS = [
    "name", "role", "phone", "email",
    "ecsa_number", "sacpcmp_number",
    "highest_description", "highest_institution",
    "initial_description", "initial_institution",
]
PERSON_DATE_FIELDS = ["ecsa_date", "sacpcmp_date", "highest_graduated", "initial_graduated"]
PERSON_ENUM_FIELDS = {"ecsa_level": ECSA_LEVELS, "highest_level": QUALIFICATION_LEVELS}
LLM_PERSON_FIELDS = PERSON_TEXT_FIELDS + PERSON_DATE_FIELDS + list(PERSON_ENUM_FIELDS)
PERSON_FIELDS = LLM_PERSON_FIELDS + ["id_number"]  # id_number is matched locally, never by the model

PROJECT_FIELDS = ["client_and_number", "position_held", "value_rm", "start_date", "end_date",
                  "contact_name", "contact_phone", "contact_email"]

# Text-quality gates (see CV-Extraction-Findings.md for how they were set).
MIN_TEXT_CHARS = 200          # a real one-page CV has well over 1,000
MIN_CHARS_PER_PAGE = 80       # below this a page is treated as having no text layer
MIN_LETTER_RATIO = 0.35       # letters / non-space chars; garbled font encodings fall far below
MAX_TEXT_CHARS = 150_000      # ~40+ pages of dense text - not one person's CV

IMAGE_EXTS = {"png", "jpg", "jpeg", "tif", "tiff", "bmp", "gif", "heic", "webp"}

# EXPERIMENTAL OCR (engine/ocr/scan_ocr.py): what the reviewer is told when
# any of the CV's text came from OCR of a scan instead of a real text layer.
OCR_FIELD_WARNING = ("Read by OCR from a scan, not from a text layer - OCR can misread letters and digits, so "
                     "check this against the scan before saving.")


class ExtractionFailed(Exception):
    """A reason the user should see, in plain words. The job is marked failed."""


class SetupError(Exception):
    """Server not set up (no API key, bad key). Job is put back in the queue."""


class TransientError(Exception):
    """Rate limit / overload / network. Job is put back in the queue."""


# ============================================================================
# 2-3. Text extraction and quality gates
# ============================================================================

def read_cv_text(path, work_dir):
    """Returns {"text", "method", "pages", "empty_pages"}; raises
    ExtractionFailed with a user-facing reason when the file has no usable
    text. Re-uses engine/general/requirements.py's readers."""
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    pages, empty_pages, verify_extra = None, [], ""

    ocr = None
    if ext in IMAGE_EXTS:
        try:
            res = scan_ocr.ocr_image_file(path, work_dir) if ext in scan_ocr.IMAGE_EXTS else None
        except Exception as e:  # experimental step: never worse than no OCR
            system_alerts.record("ocr", f"OCR crashed on an uploaded CV image: {type(e).__name__}: {e}", "error",
                                 exc=e, context={"file": os.path.basename(path)})
            res = {"pages": {}, "read": [], "failed": [], "skipped": [], "engine": None,
                   "error": f"OCR failed on it ({type(e).__name__})"}
        if not res or not res["read"]:
            raise ExtractionFailed(
                "This is a photo or scanned image, not a document with text in it, and "
                f"{scan_ocr.failure_sentence(res)}. Nothing was guessed. Upload the Word or PDF version of the "
                "CV, or choose 'use as-is' to attach this file unchanged.")
        n = max(res["pages"]) if res["pages"] else 1
        text = "\n".join(res["pages"][i]["text"] for i in sorted(res["read"]))
        ocr = scan_ocr.summary(res, total_pages=n)
        pages, method = n, f"OCR ({ocr['engine']}) - image upload"
        empty_pages = [f["page"] for f in ocr["pages_failed"]]
        assess_text_quality(text, pages)
        return {"text": text, "method": method, "pages": pages, "empty_pages": empty_pages,
                "verify_text": text, "native_text": "", "ocr": ocr}
    if ext == "pdf":
        raw = pdf_text(path)
        page_texts = raw.split("\f")
        if page_texts and not page_texts[-1].strip():
            page_texts = page_texts[:-1]
        pages = len(page_texts)
        empty_pages = [i + 1 for i, t in enumerate(page_texts) if len(re.sub(r"\s", "", t)) < MIN_CHARS_PER_PAGE]
        native_text = raw.replace("\f", "\n")
        ocr_failure = None
        if empty_pages:
            # EXPERIMENTAL: OCR the pages with no text layer; a page OCR can't
            # read clearly stays empty and is reported, exactly as before.
            try:
                res = scan_ocr.ocr_pdf_pages(path, empty_pages, work_dir=work_dir)
            except Exception as e:  # experimental step: never worse than no OCR
                system_alerts.record("ocr", f"OCR crashed on a scanned CV PDF: {type(e).__name__}: {e}", "error",
                                     exc=e, context={"file": os.path.basename(path)})
                res = {"pages": {}, "read": [], "failed": [], "skipped": [], "engine": None,
                       "error": f"OCR failed on it ({type(e).__name__})"}
            used = [n for n in res["read"]
                    if len(re.sub(r"\s", "", res["pages"][n]["text"])) > len(re.sub(r"\s", "", page_texts[n - 1]))]
            res["read"] = used
            if used:
                for n in used:
                    page_texts[n - 1] = res["pages"][n]["text"]
                ocr = scan_ocr.summary(res, total_pages=pages)
                empty_pages = [n for n in empty_pages if n not in used]
            else:
                ocr_failure = scan_ocr.failure_sentence(res)
        text = "\n".join(page_texts)
        method = "pdftotext -layout" if not ocr else (
            f"OCR ({ocr['engine']}) - scanned PDF, no text layer" if not empty_pages and len(ocr["pages_ocr"]) == pages
            else f"pdftotext -layout + OCR ({ocr['engine']}) of scanned page(s) {', '.join(map(str, ocr['pages_ocr']))}")
        # Reading-order text too, used only to check the model's quotes: -layout
        # interleaves a table's columns line by line, so a cell that wraps
        # ("Test Metro" / "Roads Agency") is split up; reading order keeps each
        # cell's lines together. The model gets the -layout text, which keeps
        # SANRAL-form labels next to their values.
        verify_extra = _pdf_reading_order_text(path)
        if pages and len(empty_pages) == pages:
            raise ExtractionFailed(
                f"This PDF has no text layer on any of its {pages} page(s) - it is a scan (a photo of paper) - "
                f"and {ocr_failure or 'OCR found no readable text'}. Nothing was guessed. "
                "Upload the original Word/PDF export of the CV, or choose 'use as-is' to attach the scan unchanged.")
    elif ext == "docx":
        try:
            text = docx_text(path)
        except Exception as e:
            raise ExtractionFailed(f"This .docx file could not be opened ({e}). It may be damaged or not really a Word file.")
        method = "python-docx"
    elif ext == "doc":
        conv = convert_with_soffice(path, "docx", work_dir)
        if not conv:
            raise ExtractionFailed("This old-style Word .doc file could not be converted to read its text. "
                                   "Save it as .docx or PDF and upload that instead.")
        text, method = docx_text(conv), "LibreOffice .doc->.docx, python-docx"
    elif ext == "txt":
        with open(path, encoding="utf-8", errors="replace") as f:
            text, method = f.read(), "plain text"
    else:
        raise ExtractionFailed(f"'.{ext}' files can't be read for AI extraction. Upload the CV as PDF or Word (.docx/.doc).")

    assess_text_quality(text, pages)
    if ext != "pdf":
        native_text = text
    return {"text": text, "method": method, "pages": pages, "empty_pages": empty_pages,
            "verify_text": text + "\n" + verify_extra,
            # the text-layer part only, so a value quoted from it isn't marked as OCR'd
            "native_text": native_text + "\n" + verify_extra if ocr else text + "\n" + verify_extra,
            "ocr": ocr}


def _pdf_reading_order_text(path):
    import subprocess
    try:
        out = subprocess.run(["pdftotext", path, "-"], capture_output=True, text=True, timeout=120)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""
    return out.stdout if out.returncode == 0 else ""


def assess_text_quality(text, pages=None):
    compact = re.sub(r"\s", "", text or "")
    if len(compact) < MIN_TEXT_CHARS:
        raise ExtractionFailed(
            f"Only {len(compact)} characters of text could be read from this file"
            + (f" ({pages} page(s))" if pages else "")
            + ". It is most likely a scan or an image saved inside a PDF/Word file, and too little could be read "
              "from it (by OCR too, where it was tried), so nothing was guessed. Upload the original Word/PDF export "
              "of the CV, or choose 'use as-is'.")
    letters = sum(ch.isalpha() for ch in compact)
    if letters / len(compact) < MIN_LETTER_RATIO:
        raise ExtractionFailed(
            "The text in this file reads as garbled symbols (usually a PDF made with an unusual font encoding), "
            "so its fields can't be read reliably and nothing was guessed. Re-export the CV to PDF from Word, or "
            "upload the .docx.")
    if len(compact) > MAX_TEXT_CHARS:
        raise ExtractionFailed(
            f"This file has about {len(compact):,} characters of text"
            + (f" over {pages} pages" if pages else "")
            + " - far more than one person's CV. Upload just this person's CV, not a whole tender submission.")


# ============================================================================
# 4. South African ID numbers: matched and redacted locally
# ============================================================================

# Separator between the 6/4/3 digit groups is [\s-], not just [ -]: a real
# ID number that lands in a narrow table cell/column can be split across a
# LINE BREAK by pdftotext -layout (confirmed 2026-10-21 - the exact artifact
# this module's own "found locally and redacted BEFORE any text leaves this
# machine" promise exists to prevent). A literal space/hyphen-only separator
# let a line-broken ID (e.g. "800101\n5009087") pass through completely
# unredacted - neither half is 13 digits on its own, so the whole-number
# regex never matched at all, and the full ID reached the Anthropic API
# verbatim, split only by a newline a reader skips straight past.
SA_ID_RE = re.compile(r"(?<!\d)(\d{6})[\s-]?(\d{4})[\s-]?(\d{3})(?!\d)")


def _luhn_ok(digits):
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _plausible_sa_id(digits):
    if len(digits) != 13 or not _luhn_ok(digits):
        return False
    mm, dd = int(digits[2:4]), int(digits[4:6])
    return 1 <= mm <= 12 and 1 <= dd <= 31 and digits[10] in "01"


def find_and_redact_sa_ids(text, redact_all_13_digit=False):
    """Returns (redacted_text, [unique ID numbers found]). Only 13-digit
    numbers with a valid SA ID checksum, birth month/day and citizenship digit
    count - registration numbers, phone numbers and contract numbers don't.
    redact_all_13_digit (OCR'd text): an ID number OCR misread by one digit
    fails the checksum but is still someone's ID - every 13-digit run is
    removed before the text leaves this machine; only checksum-valid ones are
    proposed."""
    found = []

    def sub(m):
        digits = "".join(m.groups())
        if not _plausible_sa_id(digits):
            return "[13-DIGIT NUMBER REMOVED]" if redact_all_13_digit else m.group(0)
        if digits not in found:
            found.append(digits)
        return "[SA ID NUMBER REMOVED]"

    return SA_ID_RE.sub(sub, text), found


# ============================================================================
# 5. The LLM call
# ============================================================================

def _nullable(schema):
    return {"anyOf": [schema, {"type": "null"}]}


# Real failure, live, 2026-10-23 (UX audit - the same bug hit
# engine/onboarding/classify_documents.py's `fields`, "the exact same
# pipeline shape" per this module's own docstring): `person` used to be one
# named sub-object per entry in LLM_PERSON_FIELDS (16 of them), each a
# {value, evidence} pair with a nullable type on both - 32 nested parameter
# definitions from `person` alone, on top of `projects`/`other_registrations`
# (~51 total), over the API's real limit ("54 parameters... limit 16" is
# classify_documents.py's own count, but the shape and the failure are
# identical here). `projects`/`other_registrations` were already arrays and
# are untouched; `person` is now one too - an array of {field, value,
# evidence} entries instead of a fixed object with one named property per
# field, so the schema's size is constant regardless of how many person
# fields exist, not just squeezed under today's limit.
PERSON_FIELD_ENTRY_SCHEMA = {
    "type": "object",
    "properties": {
        "field": {"type": "string", "enum": LLM_PERSON_FIELDS},
        "value": _nullable({"type": "string"}),
        "evidence": _nullable({"type": "string"}),
    },
    "required": ["field", "value", "evidence"],
    "additionalProperties": False,
}


def output_schema():
    project_props = {f: _nullable({"type": "number"} if f == "value_rm" else {"type": "string"}) for f in PROJECT_FIELDS}
    project_props["evidence"] = {"type": "string"}
    return {
        "type": "object",
        "properties": {
            "document_kind": {"type": "string", "enum": ["cv", "sanral_key_person_forms", "not_a_cv"]},
            "document_kind_reason": {"type": "string"},
            "person": {"type": "array", "items": PERSON_FIELD_ENTRY_SCHEMA},
            "projects": {"type": "array", "items": {
                "type": "object", "properties": project_props, "required": list(project_props),
                "additionalProperties": False}},
            "other_registrations": {"type": "array", "items": {
                "type": "object",
                "properties": {"body": {"type": "string"}, "level": _nullable({"type": "string"}),
                               "number": _nullable({"type": "string"}), "evidence": {"type": "string"}},
                "required": ["body", "level", "number", "evidence"], "additionalProperties": False}},
            "parse_problems": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["document_kind", "document_kind_reason", "person", "projects", "other_registrations",
                     "parse_problems"],
        "additionalProperties": False,
    }


SYSTEM_PROMPT = """You read the text of one person's CV for a South African engineering consultancy that prepares public-sector tenders (SANRAL and other buyers). Your output pre-fills a form that a person at the company then checks field by field before anything is saved, so a missing value costs them a few seconds and a wrong value can end up on a sworn tender form. When the CV does not clearly state something, leave it null rather than inferring it.

How to fill the output:

- `person` is a list: add ONE entry {"field": <name, e.g. "role" or "ecsa_number">, "value": ..., "evidence": ...} for each field you actually found a real value for. Leave a field OUT of the list entirely if the CV doesn't clearly state it - do not add an entry with a null value.
- Every entry needs `evidence`: a short verbatim quote copied character-for-character from the CV text that shows the value (the line or table cell it came from). The quote is searched for in the CV afterwards; a value whose quote cannot be found is shown to the reviewer as unverified.
- Dates: write `YYYY-MM-DD` only when the CV gives the full date. If it gives only a month and year write `YYYY-MM`; only a year, `YYYY`. Never invent a day or month. Read `2015/3/5`, `05 Mar 2015` and `5 March 2015` all as 2015-03-05; if day/month order is genuinely ambiguous, use the lower precision you are sure of and say so in parse_problems.
- `role`: the person's current job title.
- Registrations: `ecsa_level`/`ecsa_number`/`ecsa_date` are the person's Engineering Council of South Africa registration (category, registration number, date registered). `sacpcmp_number`/`sacpcmp_date` are the SA Council for the Project and Construction Management Professions. `ecsa_level` must be one of the listed options and only when the CV states the category (for example "Pr Eng" or "Professional Engineer" is "Professional Engineer"; "Pr Tech Eng" is "Professional Engineering Technologist"; "Pr Techni Eng" is "Professional Engineering Technician"; a candidate category is the matching "Candidate ..." option). Any other professional body (SACAP, SACPLAN, SACNASP, SAICE membership, PLATO, SACQSP, ECSA-recognised voluntary associations, ...) goes in `other_registrations`, not in the ECSA/SACPCMP fields.
- Qualifications: `initial_*` is the first tertiary qualification relevant to the person's profession (for an engineer usually the first degree or diploma); `highest_*` is the highest one. If the CV lists only one tertiary qualification, it is both initial and highest. `*_description` is the qualification as written (e.g. "BEng (Civil Engineering)"), `*_institution` the university/college, `*_graduated` the date awarded. `highest_level` must be one of the listed options (the South African NQF band of the highest qualification: a BEng/BSc is "Bachelors Degree and Advanced Diplomas", an MEng/MSc is "Masters Degree", a BSc Hons or a postgraduate diploma is "Honours, Post Grad diploma and Professional Qualifications", a National Diploma is "Diploma and Advanced certificates"); null when no tertiary qualification is listed.
- Projects: one entry per project or contract the person worked on that the CV lists (a project-experience table, or project descriptions under employment history). `client_and_number` is the client and the contract/project number as written (put both on one line, client first, e.g. "SANRAL - N.001-012-2026/1F" or "City of Tshwane: Rehabilitation of Lynnwood Road"); `position_held` the person's role on that project; `value_rm` the project/contract value converted to millions of rand as a plain number (R150 million -> 150, R2.5 bn -> 2500, R800 000 -> 0.8), only when the CV states a rand value; start/end dates with the same date rules (end null if ongoing or not given); `contact_*` the client referee for that project if named. `evidence` is a verbatim quote of that project's client/title line. Employment history at a company without any named project is not a project entry. Do not merge two projects into one or split one into two.
- `document_kind`: "cv" for a normal CV; "sanral_key_person_forms" when the text is SANRAL's Form B1.1/B2.1 (Candidate's technical/managerial record, qualification and registration record) - read those the same way; "not_a_cv" when it is not about one person's career at all (a tender document, a certificate on its own, a letter, a form for several people). Explain in `document_kind_reason` in one sentence.
- Identity numbers have been removed from the text before you see it; ignore the placeholder.
- `parse_problems`: anything the reviewer should know - a layout that made a section hard to read, columns that may have run together, an ambiguous date, two different values for the same field, a section in another language. Empty when there were none."""


def compact_for_model(text):
    """pdftotext -layout pads columns with long runs of spaces (the real SANRAL
    Form B1-B2 PDF: 11.9k characters, most of them padding). Runs of 4+ spaces
    become 3 - still a visible column gap, at a fraction of the tokens. Quotes
    are checked against the original text with whitespace collapsed, so this
    doesn't affect verification."""
    text = re.sub(r"[ \t]{4,}", "   ", text)
    return re.sub(r"\n{3,}", "\n\n", text)


def build_user_message(text):
    return ("Here is the text extracted from the uploaded CV file. Table cells may be separated by runs of spaces "
            "or ' | ', and page layout may have moved columns apart.\n\n<cv_text>\n" + text + "\n</cv_text>")


def default_llm_client():
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise SetupError(
            "ANTHROPIC_API_KEY is not set on this worker, so CVs waiting for AI extraction can't be read yet. "
            "They stay queued and will be processed once the key is set (see docs/specs/CV-Extraction-Findings.md, "
            "'What Sarel needs to set up').")
    try:
        import anthropic
    except ImportError:
        raise SetupError("The 'anthropic' Python package isn't installed on this worker "
                         "(pip install -r engine/worker/requirements.txt).")
    # Explicit, bounded timeout - the SDK's own default (read=600s) left a
    # single hung connection able to wedge a whole extraction for 10 minutes
    # before even raising (UX audit, 2026-10-23: "CV extractions dying...
    # stuck in 'extracting' for over 30 minutes"). A timeout here raises
    # anthropic.APITimeoutError, already caught below as APIConnectionError
    # (it subclasses it) -> TransientError -> the job is released back to
    # the queue and retried next pass, never left silently 'extracting'.
    return anthropic.Anthropic(api_key=key, timeout=LLM_TIMEOUT_SECONDS)


def call_llm(text, client=None, model=None):
    """One structured-output Messages API call. Returns (parsed_dict, meta).
    `client` is anything with .beta.messages.create(...) - the real
    anthropic.Anthropic() unless a test passes its own."""
    import anthropic
    client = client or default_llm_client()
    model = model or os.environ.get("CV_EXTRACTION_MODEL") or DEFAULT_MODEL
    try:
        response = client.beta.messages.create(
            model=model,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": build_user_message(text)}],
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": output_schema()}},
            # If a safety classifier declines (unlikely for a CV, but possible),
            # Anthropic re-runs the request on its recommended fallback model
            # inside the same call instead of returning a refusal.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError:
        raise SetupError("ANTHROPIC_API_KEY was rejected by the Anthropic API (invalid or revoked key). "
                         "CVs stay queued until a working key is set.")
    except anthropic.PermissionDeniedError as e:
        raise SetupError(f"The Anthropic API key lacks permission for this request: {e.message}")
    except anthropic.NotFoundError:
        raise SetupError(f"Model '{model}' was not found - check CV_EXTRACTION_MODEL.")
    except anthropic.RateLimitError:
        raise TransientError("Anthropic API rate limit reached; will retry on the next pass.")
    except anthropic.BadRequestError as e:
        raise ExtractionFailed(f"The AI service rejected this CV's request: {e.message}")
    except anthropic.APIStatusError as e:
        if e.status_code >= 500:
            raise TransientError(f"Anthropic API server error {e.status_code}; will retry on the next pass.")
        raise ExtractionFailed(f"The AI service returned an error ({e.status_code}): {e.message}")
    except anthropic.APIConnectionError:
        raise TransientError("Could not reach the Anthropic API; will retry on the next pass.")

    meta = {"model": getattr(response, "model", model),
            "request_id": getattr(response, "_request_id", None),
            "stop_reason": response.stop_reason}
    usage = getattr(response, "usage", None)
    if usage is not None:
        meta["usage"] = {"input_tokens": getattr(usage, "input_tokens", None),
                         "output_tokens": getattr(usage, "output_tokens", None)}

    if response.stop_reason == "refusal":
        raise ExtractionFailed("The AI service declined to read this file, so no fields were proposed. "
                               "Enter the fields by hand or try a different copy of the CV.")
    if response.stop_reason == "max_tokens":
        raise ExtractionFailed("This CV has more content than one extraction pass can return. "
                               "Upload a shorter CV (e.g. without project appendices) and add the rest by hand.")
    texts = [b.text for b in response.content if getattr(b, "type", None) == "text"]
    if not texts:
        raise ExtractionFailed("The AI service returned no answer for this CV.")
    try:
        return json.loads(texts[-1]), meta
    except json.JSONDecodeError:
        raise ExtractionFailed("The AI service's answer wasn't valid structured data, so nothing was proposed.")


# ============================================================================
# 6. Checking the model's answer against the CV text
# ============================================================================

def _norm(s):
    s = (s or "").lower().replace("–", "-").replace("—", "-").replace("’", "'")
    return re.sub(r"[\s|]+", " ", s).strip()


def _digits(s):
    return re.sub(r"\D", "", s or "")


def evidence_in_text(evidence, norm_text):
    if not evidence:
        return False
    e = _norm(evidence)
    if e and e in norm_text:
        return True
    # a quote wrapped mid-token by a narrow table column ("TMRA/2019/04" + "4"),
    # or whose line-end hyphen the PDF text layer dropped: compare letters and
    # digits only
    squeezed = re.sub(r"[^a-z0-9]", "", e)
    if len(squeezed) >= 8 and squeezed in re.sub(r"[^a-z0-9]", "", norm_text):
        return True
    # pdftotext -layout can put a cell on two lines or split a long label from
    # its value; accept the quote when every 4+ char chunk of it is present.
    chunks = [c for c in re.split(r"[^a-z0-9@./()-]+", e) if len(c) >= 4]
    return bool(chunks) and all(c in norm_text for c in chunks)


def normalise_date(raw):
    """Returns (iso_date or None, precision 'day'|'month'|'year'|None, warning)."""
    if raw is None:
        return None, None, None
    raw = raw.strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            return datetime.date.fromisoformat(raw).isoformat(), "day", None
        if re.fullmatch(r"\d{4}-\d{2}", raw):
            datetime.date(int(raw[:4]), int(raw[5:7]), 1)
            return f"{raw}-01", "month", (f"The CV only gives the month ({raw}). The 1st of the month is filled in "
                                          "as a placeholder - correct the day if you know it.")
        if re.fullmatch(r"\d{4}", raw):
            return f"{raw}-01-01", "year", (f"The CV only gives the year ({raw}). 1 January is filled in as a "
                                            "placeholder - correct it if you know the real date.")
    except ValueError:
        pass
    return None, None, f"'{raw}' isn't a date that could be read; enter it by hand."


def _fields_by_name(raw_fields):
    """The model's real answer is a list of {field, value, evidence} entries
    (output_schema()'s PERSON_FIELD_ENTRY_SCHEMA) - a dict keyed by field
    name is also accepted, kept only so hand-written test fixtures (which
    test the logic below, not the wire schema) don't all need rewriting.
    Last entry for a repeated field name wins, same as a dict literal would."""
    if isinstance(raw_fields, list):
        return {e.get("field"): e for e in raw_fields if isinstance(e, dict) and e.get("field")}
    return raw_fields or {}


def validate_proposal(data, text, local_ids):
    """Turns the model's answer into the stored proposal: per field {value,
    evidence, verified, warnings}. Raises ExtractionFailed when the answer
    says the file isn't a CV or found nothing usable."""
    norm_text = _norm(text)
    digits_text = _digits(text)
    overall = [p for p in (data.get("parse_problems") or []) if p]

    if data.get("document_kind") == "not_a_cv":
        raise ExtractionFailed("This doesn't look like one person's CV"
                               + (f": {data.get('document_kind_reason')}" if data.get("document_kind_reason") else ".")
                               + " Nothing was proposed.")

    raw_person = _fields_by_name(data.get("person"))
    person = {}
    for f in LLM_PERSON_FIELDS:
        item = raw_person.get(f) or {}
        value, evidence = item.get("value"), item.get("evidence")
        if isinstance(value, str):
            value = value.strip() or None
        if value is None:
            continue
        warnings = []
        verified = evidence_in_text(evidence, norm_text)
        if not verified:
            warnings.append("The quote this was read from couldn't be found in the CV text - check it against the CV.")
        if f in PERSON_DATE_FIELDS:
            iso, precision, w = normalise_date(value)
            if w:
                warnings.append(w)
            if iso is None:
                verified = False
            elif precision != "day":
                verified = False  # placeholder day/month: needs a human to tick it
            value = iso
        if f in PERSON_ENUM_FIELDS and value not in PERSON_ENUM_FIELDS[f]:
            warnings.append(f"'{value}' isn't one of SANRAL's options for this field; choose one.")
            value, verified = None, False
        if f in ("ecsa_number", "sacpcmp_number", "phone") and _digits(value) and _digits(value) not in digits_text:
            warnings.append("These digits don't appear in the CV text - check them.")
            verified = False
        if f == "email" and value.lower() not in text.lower():
            warnings.append("This address doesn't appear in the CV text - check it.")
            verified = False
        person[f] = {"value": value, "evidence": evidence, "verified": verified, "warnings": warnings}

    if len(local_ids) == 1:
        person["id_number"] = {"value": local_ids[0], "evidence": "Found in the CV text (never sent to the AI service).",
                               "verified": True, "warnings": []}
    elif len(local_ids) > 1:
        overall.append(f"The CV contains {len(local_ids)} different SA ID numbers, so none was proposed - enter the "
                       "right one by hand.")

    projects = []
    for p in data.get("projects") or []:
        client = (p.get("client_and_number") or "").strip()
        if not client:
            continue
        warnings = []
        verified = evidence_in_text(p.get("evidence"), norm_text) or evidence_in_text(client, norm_text)
        if not verified:
            warnings.append("This project's client/title couldn't be found in the CV text - check it against the CV.")
        row = {"client_and_number": client, "evidence": p.get("evidence")}
        for f in ("position_held", "contact_name", "contact_phone", "contact_email"):
            v = p.get(f)
            row[f] = v.strip() if isinstance(v, str) and v.strip() else None
        v = p.get("value_rm")
        row["value_rm"] = v if isinstance(v, (int, float)) and v >= 0 else None
        for f in ("start_date", "end_date"):
            iso, precision, w = normalise_date(p.get(f))
            row[f] = iso
            if w:
                warnings.append(("Start: " if f == "start_date" else "End: ") + w)
        if row["contact_phone"] and _digits(row["contact_phone"]) not in digits_text:
            warnings.append("The referee phone number's digits don't appear in the CV text - check them.")
        row["verified"], row["warnings"] = verified, warnings
        projects.append(row)

    other = [r for r in (data.get("other_registrations") or []) if r.get("body")]
    for r in other:
        r["verified"] = evidence_in_text(r.get("evidence"), norm_text)

    if not person and not projects:
        raise ExtractionFailed(
            "None of the CV fields (name, registrations, qualifications, projects) could be found in this file, so "
            "nothing was proposed. The layout may be too unusual to read - enter the fields by hand."
            + (f" Notes: {'; '.join(overall)}" if overall else ""))
    unverified = sum(1 for v in person.values() if not v["verified"]) + sum(1 for p in projects if not p["verified"])
    total = len(person) + len(projects)
    if total >= 4 and unverified / total > 0.6:
        raise ExtractionFailed(
            f"{unverified} of the {total} values the AI proposed couldn't be traced back to the CV's own text, so the "
            "result isn't trustworthy and nothing was proposed. The layout may be too unusual to read reliably - "
            "enter the fields by hand.")

    return {"document_kind": data.get("document_kind"), "person": person, "projects": projects,
            "other_registrations": other}, overall


def extract_from_file(path, work_dir, client=None):
    """Steps 2-6 for one local file. Returns (proposal, warnings, info)."""
    read = read_cv_text(path, work_dir)
    redacted, ids = find_and_redact_sa_ids(read["text"], redact_all_13_digit=bool(read.get("ocr")))
    data, meta = call_llm(compact_for_model(redacted), client=client)
    proposal, warnings = validate_proposal(data, read["verify_text"], ids)
    if read["empty_pages"]:
        warnings.insert(0, f"Page(s) {', '.join(map(str, read['empty_pages']))} of {read['pages']} had no readable "
                           "text (probably scanned"
                           + (", and OCR couldn't read them clearly" if read.get("ocr") or scan_ocr.available()[0] else "")
                           + ") - anything on them was not read.")
    if read.get("ocr"):
        mark_ocr_values(proposal, read["native_text"], read.get("ocr"))
        o = read["ocr"]
        warnings.insert(0, (f"OCR: page(s) {', '.join(map(str, o['pages_ocr']))} of this CV are a scan and were read by "
                            f"OCR (average confidence {o['mean_confidence']:.0f}/100), not from a text layer. Every value "
                            "read from them is left unticked - OCR can misread letters and digits (0/O, 1/l, 5/S) and "
                            "can skip a line, so check each one against the scan."))
    info = {"text_method": read["method"], "source_pages": read["pages"],
            "source_text_chars": len(read["text"]), **meta}
    return proposal, warnings, info


def mark_ocr_values(proposal, native_text, ocr):
    """EXPERIMENTAL OCR: a value whose quote isn't in the CV's real text layer
    came from OCR'd text, so it is never pre-ticked: verified -> False with a
    plain warning. The quote check against the OCR text only proves the AI
    copied the OCR output; it can't prove OCR read the paper right (a blurred
    copy of the real ECSA certificate read 20150155 as 2015015 at high
    confidence - OCR-Evaluation.md)."""
    norm_native, digits_native = _norm(native_text), _digits(native_text)
    for key, item in list(proposal["person"].items()) + [(None, p) for p in proposal["projects"]]:
        if native_text.strip() and (evidence_in_text(item.get("evidence"), norm_native)
                                    or (key == "id_number" and item["value"] in digits_native)):
            continue
        item["verified"] = False
        if OCR_FIELD_WARNING not in item["warnings"]:
            item["warnings"].insert(0, OCR_FIELD_WARNING)
    for r in proposal.get("other_registrations") or []:
        if not (native_text.strip() and evidence_in_text(r.get("evidence"), norm_native)):
            r["verified"] = False


# ============================================================================
# 1 + 7. Queue plumbing (Supabase REST, service role)
# ============================================================================

def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def storage_download(url, key, bucket, object_path, dest):
    quoted = urllib.parse.quote(object_path, safe="/")
    req = urllib.request.Request(f"{url}/storage/v1/object/{bucket}/{quoted}",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
            shutil.copyfileobj(r, f)
    except urllib.error.HTTPError as e:
        raise ExtractionFailed(f"The uploaded file couldn't be fetched from storage ({e.code}). Upload it again.")


def claim_upload(url, key, upload):
    claimed = supabase_request(
        url, key, "PATCH", f"cv_uploads?id=eq.{upload['id']}&status=eq.extraction_requested",
        {"status": "extracting", "extraction_claimed_at": _now_iso(), "extraction_error": None})
    return bool(claimed)


def release_upload(url, key, upload):
    """Put a claimed upload back in the queue (setup or transient problem)."""
    supabase_request(url, key, "PATCH", f"cv_uploads?id=eq.{upload['id']}&status=eq.extracting",
                     {"status": "extraction_requested", "extraction_claimed_at": None})


def fail_upload(url, key, upload, reason):
    supabase_request(url, key, "PATCH", f"cv_uploads?id=eq.{upload['id']}", {
        "status": "extraction_failed", "extraction_error": reason, "extraction_completed_at": _now_iso()})


def fail_stale_uploads(url, key, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(minutes=STALE_AFTER_MINUTES)
    for up in supabase_request(url, key, "GET", "cv_uploads?status=eq.extracting&select=id,extraction_claimed_at"):
        claimed = up.get("extraction_claimed_at")
        if claimed and datetime.datetime.fromisoformat(claimed.replace("Z", "+00:00")) < cutoff:
            supabase_request(url, key, "PATCH", f"cv_uploads?id=eq.{up['id']}&status=eq.extracting", {
                "status": "extraction_failed", "extraction_completed_at": _now_iso(),
                "extraction_error": f"The extraction worker stopped mid-job (no result after {STALE_AFTER_MINUTES} "
                                    "minutes). Nothing was proposed - upload the CV again."})
            print(f"[failed] cv_upload {up['id']}: stale 'extracting' since {claimed}")
            system_alerts.record("cv_extract", f"A CV extraction was stuck in 'extracting' for over "
                                               f"{STALE_AFTER_MINUTES} minutes (the worker died mid-job) and was "
                                               "marked failed", "error", context={"cv_upload_id": up["id"]})


def process_upload(url, key, upload, client_factory=default_llm_client):
    """Returns True if handled (ready or failed), False if skipped. Raises
    SetupError (after putting the upload back) so the pass exits non-zero."""
    if not claim_upload(url, key, upload):
        print(f"[skipped] cv_upload {upload['id']}: already claimed by another worker")
        return False
    work_dir = tempfile.mkdtemp(prefix="cv_extract_")
    try:
        # The path is written by the client and this download uses the
        # service role (no Storage RLS): it must be this company's own file,
        # or another company's CV would be read, sent to the AI and shown
        # here (POPIA-Security-Audit.md; migration 0043 adds the same CHECK).
        sp = upload.get("storage_path") or ""
        if not sp.startswith(f"{upload['company_id']}/") or ".." in sp or "//" in sp:
            raise ExtractionFailed("This upload's file isn't in your company's own storage folder, so it wasn't read. "
                                   "Upload the CV again from the person's page.")
        client = client_factory()  # SetupError here leaves the job queued
        local = os.path.join(work_dir, os.path.basename(upload["storage_path"]))
        storage_download(url, key, "cv-documents", upload["storage_path"], local)
        proposal, warnings, info = extract_from_file(local, work_dir, client=client)
        supabase_request(url, key, "POST", "cv_extraction_results?on_conflict=cv_upload_id", {
            "company_id": upload["company_id"], "person_id": upload["person_id"], "cv_upload_id": upload["id"],
            "proposed": proposal, "warnings": warnings, "review_status": "pending_review",
            "text_method": info["text_method"], "source_pages": info["source_pages"],
            "source_text_chars": info["source_text_chars"], "model": info.get("model"),
            "usage": info.get("usage"),
        })
        supabase_request(url, key, "PATCH", f"cv_uploads?id=eq.{upload['id']}", {
            "status": "extracted", "extraction_completed_at": _now_iso(), "extraction_error": None})
        print(f"[extracted] cv_upload {upload['id']}: {len(proposal['person'])} field(s), "
              f"{len(proposal['projects'])} project(s), {len(warnings)} warning(s)")
        return True
    except (SetupError, TransientError) as e:
        _safe_update(lambda: release_upload(url, key, upload), upload, "release back to the queue")
        if isinstance(e, SetupError):
            raise  # recorded by whoever runs the pass (run_bridges.py's non-zero exit / poll_forever)
        # Retried next pass; recorded so a lasting outage (rate limit, API down) is seen.
        system_alerts.record("cv_extract", f"CV extraction hit a temporary problem and will retry: {e}", "warning",
                             context={"cv_upload_id": upload["id"], "company_id": upload.get("company_id")})
        print(f"[retry] cv_upload {upload['id']}: {e}")
        return False
    except ExtractionFailed as e:
        _safe_update(lambda: fail_upload(url, key, upload, str(e)), upload, "mark as failed")
        system_alerts.record("cv_extract", f"CV extraction refused an upload: {e}", "warning",
                             context={"cv_upload_id": upload["id"], "company_id": upload.get("company_id")})
        print(f"[failed] cv_upload {upload['id']}: {e}")
        return True
    except Exception as e:  # a bug, not a user problem - still never leave it 'extracting'
        system_alerts.record("cv_extract", f"CV extraction crashed: {type(e).__name__}: {e}", "error", exc=e,
                             context={"cv_upload_id": upload["id"], "company_id": upload.get("company_id")})
        _safe_update(lambda: fail_upload(url, key, upload, f"AI extraction hit an unexpected error ({type(e).__name__}). "
                                         "Nothing was proposed - upload the CV again or enter the fields by hand."),
                     upload, "mark as failed")
        print(f"[failed] cv_upload {upload['id']}: unexpected {type(e).__name__}: {e}")
        return True
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _safe_update(write, upload, what):
    """A write that reports an outcome (release back to the queue, or mark
    failed) must never itself leave the row stuck 'extracting' if IT fails
    (a transient Supabase blip right as we're reporting a different error) -
    same reasoning as process_cv_jobs.py's own nested try/except around
    marking a generation job failed, applied here (found missing, UX audit
    2026-10-23: a prior known contributor to a row staying 'extracting'
    past STALE_AFTER_MINUTES until the next stale-reclaim pass caught it)."""
    try:
        write()
    except Exception as e2:
        system_alerts.record("cv_extract", f"Could not {what} for cv_upload {upload['id']}: {type(e2).__name__}: {e2}",
                             "error", exc=e2, context={"cv_upload_id": upload["id"]})


def poll_once(url, key, quiet_when_empty=False, client_factory=default_llm_client):
    fail_stale_uploads(url, key)
    uploads = supabase_request(
        url, key, "GET",
        "cv_uploads?status=eq.extraction_requested&mode=eq.ai_extract&select=*&order=created_at.asc")
    if not uploads:
        if not quiet_when_empty:
            print("No pending CV extraction requests.")
        return 0
    handled = 0
    for up in uploads:
        if process_upload(url, key, up, client_factory=client_factory):
            handled += 1
    return handled


def run(loop=False, interval=DEFAULT_INTERVAL_SECONDS, max_cycles=None):
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
              "(see app/.env.local.example) before running this.")
        return 1
    if not loop:
        try:
            poll_once(url, key)
        except SetupError as e:
            print(f"ERROR: {e}")
            return 1
        return 0
    poll_forever(lambda: poll_once(url, key, quiet_when_empty=True), interval=interval,
                 max_cycles=max_cycles, name="extract_cv_fields", alert_source="cv_extract")
    return 0


def run_local_file(path, text_only):
    work_dir = tempfile.mkdtemp(prefix="cv_extract_")
    try:
        if text_only:
            read = read_cv_text(path, work_dir)
            redacted, ids = find_and_redact_sa_ids(read["text"])
            print(json.dumps({"method": read["method"], "pages": read["pages"], "empty_pages": read["empty_pages"],
                              "chars": len(read["text"]), "sa_id_numbers_found": len(ids)}, indent=2))
            sent = compact_for_model(redacted)
            print(f"----- text that would be sent ({len(sent)} chars; ID numbers removed) -----")
            print(sent)
            return 0
        proposal, warnings, info = extract_from_file(path, work_dir)
        print(json.dumps({"info": info, "warnings": warnings, "proposal": proposal}, indent=2, default=str))
        return 0
    except ExtractionFailed as e:
        print(f"EXTRACTION FAILED (shown to the user as-is): {e}")
        return 2
    except (SetupError, TransientError) as e:
        print(f"ERROR: {e}")
        return 1
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="process queued uploads once and exit (the default)")
    mode.add_argument("--loop", "--daemon", dest="loop", action="store_true", help="keep polling until stopped")
    mode.add_argument("--file", help="run on one local CV file instead of the Supabase queue")
    ap.add_argument("--text-only", action="store_true", help="with --file: only show the text step (no API call)")
    ap.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SECONDS)
    ap.add_argument("--max-cycles", type=int, default=None)
    args = ap.parse_args(argv)
    if args.file:
        return run_local_file(args.file, args.text_only)
    if args.interval <= 0:
        ap.error("--interval must be a positive number of seconds")
    return run(loop=args.loop, interval=args.interval, max_cycles=args.max_cycles)


if __name__ == "__main__":
    sys.exit(main())
