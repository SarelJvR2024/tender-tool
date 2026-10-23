"""
Bulk onboarding document scan: reads ONE uploaded file (onboarding_uploads,
migration 0063) and PROPOSES what it is and what its key fields are, for a
human to confirm or correct on the review screen before anything is written
to a real table. It never writes to companies/held_registrations/
experience_items/cv_uploads itself - see app/app/company/document-scan/
actions.ts for the only code that does, and only on explicit confirm.

This is the exact same pipeline shape as engine/cv/extract_cv_fields.py
(read this file's own docstring and extract_cv_fields.py side by side - the
precedent this is modelled on, not reinvented): claim -> extract text (OCR
fallback) -> one structured-output LLM call -> check every quote against the
source text again -> store a proposal, review_status 'pending_review'. Code
that is identical in both (SA ID redaction, quote-verification, date
normalisation) is imported from extract_cv_fields.py, not copied.

What is different from the CV pipeline, and why:

  - One file here can be ANY of several document types (a CIDB certificate,
    a bank letter, a reference letter, ...), not always a CV, so the
    structured-output schema has one `document_kind` field (the v1 type
    list + "unknown") and one flat `fields` object whose keys cover every
    kind - the model is told which keys apply to the kind it picked and to
    leave the rest null. This mirrors how extract_cv_fields.py itself
    already handles two kinds ("cv" vs "sanral_key_person_forms") with one
    shared field set.
  - A filename/keyword pre-filter (`keyword_hint`) is run first and passed
    to the model as a HINT in the prompt, never as the answer - a filename
    saying "CIDB_Certificate.pdf" does not skip the LLM call or the
    quote-verification step. Certificates are exactly the documents most
    likely to be a scan with no clean text layer, which is exactly where
    OCR confidence is lowest - trusting a filename there would be the
    opposite of this feature's whole point. The hint only shortens the
    system prompt's guessing when the text itself is too thin to tell two
    close kinds apart (e.g. "pi_insurance_certificate" vs a generic letter).
  - When the model's own classification says "cv", NO field extraction is
    attempted here at all - see "CV handoff" below. That keeps this to
    still one LLM call per document (the call still has to run to know the
    kind), while never duplicating extract_cv_fields.py's own, more detailed
    CV extraction.
  - "professional_registration_other" (ECSA/SACPCMP/SACNASP/SAGC/PSIRA/...)
    is deliberately never auto-routed on confirm - these have dedicated
    per-person UI (People page for ECSA/SACPCMP/SACNASP/SAGC;
    /company/registrations for the rest) and higher stakes than a generic
    vault slot. The review screen shows it as "needs manual review" with a
    link, same as "unknown".

CV handoff (never re-implemented here): when document_kind is "cv", the
review screen's confirm action does not read `fields` at all - it copies the
file into the 'cv-documents' bucket and inserts a cv_uploads row with
mode='ai_extract', exactly the row the existing /people upload flow inserts.
engine/cv/extract_cv_fields.py then picks it up completely unchanged. The
only thing this module's LLM call does for a CV is recognise one.

Usage:
    python3 classify_documents.py --file DOC.pdf [--text-only]   # local, one file
    (the queue runner is engine/onboarding/process_onboarding_jobs.py)

Environment: same as extract_cv_fields.py - ANTHROPIC_API_KEY,
ONBOARDING_CLASSIFY_MODEL (optional, default claude-opus-5-5).
"""
import argparse
import json
import os
import re
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ENGINE, "worker"))
sys.path.insert(0, os.path.join(ENGINE, "general"))
sys.path.insert(0, os.path.join(ENGINE, "cv"))
sys.path.insert(0, os.path.join(ENGINE, "ocr"))

from poll_loop import system_alerts  # noqa: E402
from requirements import docx_text, pdf_text, convert_with_soffice  # noqa: E402
import scan_ocr  # noqa: E402  (EXPERIMENTAL - docs/specs/OCR-Evaluation.md)
# Reused outright, not re-implemented: the CV pipeline's own SA-ID redaction,
# quote-verification, date normalisation and digit/text helpers.
import extract_cv_fields as cvx  # noqa: E402

DEFAULT_MODEL = "claude-opus-5-5"

IMAGE_EXTS = cvx.IMAGE_EXTS
MIN_TEXT_CHARS, MIN_LETTER_RATIO, MAX_TEXT_CHARS = cvx.MIN_TEXT_CHARS, cvx.MIN_LETTER_RATIO, cvx.MAX_TEXT_CHARS

# v1 document types - keep in sync with migration 0063's document_kind check.
DOCUMENT_KINDS = [
    "cidb_registration", "bbbee_certificate", "sars_tax_clearance", "id_document", "cv",
    "bank_confirmation_letter", "pi_insurance_certificate", "iso_9001_certificate",
    "experience_reference_letter", "professional_registration_other", "unknown",
]
# Out of v1 routing scope: flagged for manual review, never auto-filed.
UNROUTED_KINDS = {"professional_registration_other", "unknown"}

# Every field any kind can propose, one flat set (same flat-list pattern
# extract_cv_fields.py uses for its own two document kinds). The model is
# told in the system prompt which keys belong to the kind it picked; the
# rest come back null and are dropped in validate_proposal().
KIND_FIELDS = {
    "cidb_registration": ["registration_number", "grade_class", "expiry_date", "contractor_name"],
    "bbbee_certificate": ["bee_level", "proof_type", "expiry_date", "entity_name"],
    "sars_tax_clearance": ["pin", "expiry_date"],
    "id_document": ["full_name"],  # id_number is matched locally (SA ID redaction), never by the model
    "cv": [],  # handoff only - see module docstring
    "bank_confirmation_letter": ["bank_name", "account_holder", "letter_date"],
    "pi_insurance_certificate": ["insurer", "policy_number", "cover_zar", "expiry_date"],
    "iso_9001_certificate": ["certificate_number", "expiry_date", "certified_entity_name"],
    "experience_reference_letter": [
        "client_name", "project_name", "contract_number", "project_value_rm",
        "completion_date", "referee_name", "referee_phone", "referee_email",
    ],
    "professional_registration_other": ["body", "holder_name", "registration_number", "expiry_date"],
    "unknown": [],
}
ALL_FIELDS = sorted({f for fs in KIND_FIELDS.values() for f in fs})
DATE_FIELDS = {"expiry_date", "letter_date", "completion_date"}
NUMBER_FIELDS = {"cover_zar", "project_value_rm"}


class ClassificationFailed(Exception):
    """A reason the user should see, in plain words. The job is marked failed."""


class SetupError(cvx.SetupError):
    pass


class TransientError(cvx.TransientError):
    pass


# ============================================================================
# 1. Keyword/filename pre-filter - a HINT for the prompt only (see module
#    docstring: never the sole classifier, never skips the LLM call or the
#    quote-verification step below).
# ============================================================================

_KEYWORD_HINTS = [
    ("cidb_registration", re.compile(r"cidb|contractor grading|csd registration", re.I)),
    ("bbbee_certificate", re.compile(r"b-?bbee|bee certificate|bee affidavit|sworn affidavit|sanas", re.I)),
    ("sars_tax_clearance", re.compile(r"sars|tax clearance|tax compliance|\btcs\b|\bpin\b", re.I)),
    ("id_document", re.compile(r"\bid\b|identity document|certified.?id|\bidcopy\b", re.I)),
    ("cv", re.compile(r"\bcv\b|curriculum vitae|resume", re.I)),
    ("bank_confirmation_letter", re.compile(r"bank.?(confirmation|letter)|proof of (banking|account)", re.I)),
    ("pi_insurance_certificate", re.compile(r"professional indemnity|\bp\.?i\.?\s*insurance|insurance (schedule|certificate)", re.I)),
    ("iso_9001_certificate", re.compile(r"iso\s*9001", re.I)),
    ("experience_reference_letter", re.compile(r"reference letter|completion certificate|closeout report|letter of award|performance report", re.I)),
    ("professional_registration_other", re.compile(r"\becsa\b|\bsacpcmp\b|\bsacnasp\b|\bsagc\b|\bpsira\b|professional registration", re.I)),
]


def keyword_hint(filename):
    """Returns a document_kind the filename suggests, or None. Advisory only."""
    for kind, pattern in _KEYWORD_HINTS:
        if pattern.search(filename or ""):
            return kind
    return None


# ============================================================================
# 2-3. Text extraction and quality gates (OCR fallback via scan_ocr.py, the
# same module and the same thresholds extract_cv_fields.py uses).
# ============================================================================

def assess_text_quality(text, pages=None):
    compact = re.sub(r"\s", "", text or "")
    if len(compact) < MIN_TEXT_CHARS:
        raise ClassificationFailed(
            f"Only {len(compact)} characters of text could be read from this file"
            + (f" ({pages} page(s))" if pages else "")
            + ". It is most likely a scan or an image with no usable text layer (OCR tried where available), "
              "so nothing was guessed. Upload the original Word/PDF export, or file it manually.")
    letters = sum(ch.isalpha() for ch in compact)
    if letters / len(compact) < MIN_LETTER_RATIO:
        raise ClassificationFailed(
            "The text in this file reads as garbled symbols (usually an unusual PDF font encoding), so its "
            "fields can't be read reliably and nothing was guessed. Re-export it, or file it manually.")
    if len(compact) > MAX_TEXT_CHARS:
        raise ClassificationFailed(
            f"This file has about {len(compact):,} characters of text - far more than one compliance document. "
            "Upload documents one at a time if this is really several things in one file.")


def read_document_text(path, work_dir):
    """Returns {"text", "method", "pages", "empty_pages", "verify_text", "native_text", "ocr"}.
    Raises ClassificationFailed with a user-facing reason. Deliberately a
    separate function from extract_cv_fields.read_cv_text, not a thin
    wrapper around it: the user-facing failure messages there say "CV",
    which would be wrong here - the OCR/PDF/docx machinery itself (scan_ocr,
    pdf_text, docx_text, convert_with_soffice) is the same, imported, code."""
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    pages, empty_pages, verify_extra, ocr, native_text = None, [], "", None, None

    if ext in IMAGE_EXTS:
        try:
            res = scan_ocr.ocr_image_file(path, work_dir) if ext in scan_ocr.IMAGE_EXTS else None
        except Exception as e:
            system_alerts.record("onboarding_scan", f"OCR crashed on an onboarding upload image: {type(e).__name__}: {e}",
                                 "error", exc=e, context={"file": os.path.basename(path)})
            res = {"pages": {}, "read": [], "failed": [], "skipped": [], "engine": None,
                   "error": f"OCR failed on it ({type(e).__name__})"}
        if not res or not res["read"]:
            raise ClassificationFailed(
                "This is a photo or scanned image with no text in it, and "
                f"{scan_ocr.failure_sentence(res)}. Nothing was guessed - file it manually.")
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
        empty_pages = [i + 1 for i, t in enumerate(page_texts) if len(re.sub(r"\s", "", t)) < 80]
        native_text = raw.replace("\f", "\n")
        ocr_failure = None
        if empty_pages:
            try:
                res = scan_ocr.ocr_pdf_pages(path, empty_pages, work_dir=work_dir)
            except Exception as e:
                system_alerts.record("onboarding_scan", f"OCR crashed on a scanned onboarding PDF: {type(e).__name__}: {e}",
                                     "error", exc=e, context={"file": os.path.basename(path)})
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
        verify_extra = cvx._pdf_reading_order_text(path)
        if pages and len(empty_pages) == pages:
            raise ClassificationFailed(
                f"This PDF has no text layer on any of its {pages} page(s) - it is a scan - and "
                f"{ocr_failure or 'OCR found no readable text'}. Nothing was guessed - file it manually.")
    elif ext == "docx":
        try:
            text = docx_text(path)
        except Exception as e:
            raise ClassificationFailed(f"This .docx file could not be opened ({e}). It may be damaged or not a Word file.")
        method = "python-docx"
    elif ext == "doc":
        conv = convert_with_soffice(path, "docx", work_dir)
        if not conv:
            raise ClassificationFailed("This old-style Word .doc file could not be converted to read its text. "
                                       "Save it as .docx or PDF and upload that instead.")
        text, method = docx_text(conv), "LibreOffice .doc->.docx, python-docx"
    elif ext == "txt":
        with open(path, encoding="utf-8", errors="replace") as f:
            text, method = f.read(), "plain text"
    else:
        raise ClassificationFailed(f"'.{ext}' files can't be read for AI classification. Upload PDF, Word or an image, "
                                   "or file it manually.")

    assess_text_quality(text, pages)
    if native_text is None:
        native_text = text
    return {"text": text, "method": method, "pages": pages, "empty_pages": empty_pages,
            "verify_text": text + "\n" + verify_extra,
            "native_text": native_text + "\n" + verify_extra if ocr else text + "\n" + verify_extra,
            "ocr": ocr}


# ============================================================================
# 4. The LLM call
# ============================================================================

# Real failure, live, 2026-10-23 (UX audit): the previous schema gave `fields`
# one named sub-object per entry in ALL_FIELDS (27 of them), each a {value,
# evidence} pair with a nullable (union) type on both - 54 nested parameter
# definitions in one request, rejected by the API ("54 parameters with union
# types... limit 16"). Every upload failed outright, not just some.
#
# Fixed by making `fields` an ARRAY of {field, value, evidence} entries
# instead of a fixed object with one named property per field. This is a
# structural fix, not a today-sized one: the schema's parameter count is now
# constant (a handful) no matter how many document kinds or fields exist -
# adding a 28th field to KIND_FIELDS can never regress this again, unlike
# trimming ALL_FIELDS down to fit under today's limit would have been.
# validate_proposal() below accepts either shape for `data["fields"]` (a
# list - what the API actually returns now - or a dict, kept for the
# existing hand-written test fixtures, which test the verification/filtering
# logic below, not this wire schema - test_validate_proposal_schema is the
# one test that validates a fixture against output_schema() directly, so it
# alone needed updating to the new array shape).
FIELD_ENTRY_SCHEMA = {
    "type": "object",
    "properties": {
        "field": {"type": "string", "enum": ALL_FIELDS},
        "value": cvx._nullable({"type": "string"}),
        "evidence": cvx._nullable({"type": "string"}),
    },
    "required": ["field", "value", "evidence"],
    "additionalProperties": False,
}


def output_schema():
    return {
        "type": "object",
        "properties": {
            "document_kind": {"type": "string", "enum": DOCUMENT_KINDS},
            "document_kind_reason": {"type": "string"},
            "fields": {"type": "array", "items": FIELD_ENTRY_SCHEMA},
            "parse_problems": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["document_kind", "document_kind_reason", "fields", "parse_problems"],
        "additionalProperties": False,
    }


def _kind_field_list():
    return "\n".join(f"- {k}: {', '.join(v) if v else '(no fields - see note on cv below)'}" for k, v in KIND_FIELDS.items())


SYSTEM_PROMPT = f"""You read the text of ONE uploaded document for a South African company's compliance "document vault" - the documents it keeps on file to answer public-sector tender questions (CIDB grading, B-BBEE, tax clearance, insurance, ISO certification, bank details, project reference letters, CVs, professional registrations). Your output pre-fills a review screen that a person at the company checks field by field before anything is saved anywhere, so a missing value costs a few seconds and a wrong one could end up filed as a real compliance record. When the document does not clearly state something, leave it null rather than inferring it.

First decide `document_kind`, one of exactly: {", ".join(DOCUMENT_KINDS)}.
- cidb_registration: a CIDB (Construction Industry Development Board) contractor registration/grading certificate.
- bbbee_certificate: a B-BBEE verification certificate (SANAS-accredited agency) or a sworn QSE/EME B-BBEE affidavit.
- sars_tax_clearance: a SARS Tax Compliance Status (TCS) PIN letter / tax clearance certificate.
- id_document: a South African identity document or a certified copy of one (a person's ID, not a company document).
- cv: a person's curriculum vitae / résumé, OR SANRAL's own Form B1.1/B2.1 key-person forms (read the same way).
- bank_confirmation_letter: a bank's confirmation-of-account letter.
- pi_insurance_certificate: a professional indemnity insurance policy schedule or certificate.
- iso_9001_certificate: an ISO 9001 quality-management certification.
- experience_reference_letter: a client reference letter, completion certificate, closeout report, letter of award, or performance report about a completed/awarded project.
- professional_registration_other: a professional-body registration/membership that is NOT a CV and NOT one of the above - ECSA, SACPCMP, SACNASP, SAGC, SACAP, PSIRA, or similar. Do not guess which person or body it is for beyond what `fields.body`/`fields.holder_name` can honestly quote; this is never filed automatically.
- unknown: anything else, or you genuinely cannot tell. Say why in `document_kind_reason`.

The filename may be given as a hint below - it is ONLY a hint. Decide from what the text actually says; a wrongly-named file is common and must not be trusted over the content.

Then fill ONLY the fields that belong to that document_kind:
{_kind_field_list()}

`fields` is a list: add ONE entry {{"field": <name from the list above>, "value": ..., "evidence": ...}} for each field you actually found a real value for. Leave a field OUT of the list entirely if the document doesn't clearly state it - do not add an entry with a null value, and never add an entry for a field that doesn't belong to the document_kind you picked.

For `cv`, add no entries to `fields` at all - a person's CV and project history is handled by a separate, dedicated pipeline; your only job for a CV is to recognise it as one.

How to fill each field entry you do add:
- Every entry needs `evidence`: a short verbatim quote copied character-for-character from the document's text that shows the value. The quote is searched for in the text afterwards; a value whose quote cannot be found is shown to the reviewer as unverified.
- Dates (`expiry_date`, `letter_date`, `completion_date`): `YYYY-MM-DD` only when the document gives the full date; `YYYY-MM` for month+year only; `YYYY` for year only. Never invent a day or month.
- `grade_class` (CIDB): the grading as printed, e.g. "8CE" or "Grade 7GB".
- `bee_level`: the B-BBEE status level as stated, e.g. "Level 2" or "Non-compliant".
- `proof_type`: "certificate" for a SANAS verification certificate, "qse_affidavit" or "eme_affidavit" for a sworn affidavit - read which one the document itself is.
- `cover_zar`/`project_value_rm`: a plain number in rand (cover_zar) or rand MILLIONS (project_value_rm; R150 million -> 150, R800 000 -> 0.8), written as a plain numeral string with no "R" or thousand separators (e.g. "5000000", "120"). Only when the document states a rand amount.
- `full_name`/`holder_name`: the person's full name as printed.
- `body` (professional_registration_other): the professional body/council's name as printed (e.g. "ECSA", "PSIRA"), not guessed from context.
- Identity numbers have been removed from the text before you see it; ignore any placeholder.
- `parse_problems`: anything the reviewer should know (hard-to-read layout, an ambiguous date, two conflicting values, a language you had to work through). Empty when there were none."""


def compact_for_model(text):
    text = re.sub(r"[ \t]{4,}", "   ", text)
    return re.sub(r"\n{3,}", "\n\n", text)


def build_user_message(text, filename):
    hint = keyword_hint(filename)
    hint_line = f"\nFilename hint (advisory only, may be wrong): this file is named \"{filename}\", which often means {hint}.\n" if hint else ""
    return (f"Here is the text extracted from an uploaded document.{hint_line}\n<document_text>\n{text}\n</document_text>")


def default_llm_client():
    return cvx.default_llm_client()


def call_llm(text, filename, client=None, model=None):
    import anthropic
    client = client or default_llm_client()
    model = model or os.environ.get("ONBOARDING_CLASSIFY_MODEL") or DEFAULT_MODEL
    try:
        response = client.beta.messages.create(
            model=model,
            max_tokens=4000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": build_user_message(text, filename)}],
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": output_schema()}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError:
        raise SetupError("ANTHROPIC_API_KEY was rejected by the Anthropic API. Uploads stay queued until a working key is set.")
    except anthropic.PermissionDeniedError as e:
        raise SetupError(f"The Anthropic API key lacks permission for this request: {e.message}")
    except anthropic.NotFoundError:
        raise SetupError(f"Model '{model}' was not found - check ONBOARDING_CLASSIFY_MODEL.")
    except anthropic.RateLimitError:
        raise TransientError("Anthropic API rate limit reached; will retry on the next pass.")
    except anthropic.BadRequestError as e:
        raise ClassificationFailed(f"The AI service rejected this document's request: {e.message}")
    except anthropic.APIStatusError as e:
        if e.status_code >= 500:
            raise TransientError(f"Anthropic API server error {e.status_code}; will retry on the next pass.")
        raise ClassificationFailed(f"The AI service returned an error ({e.status_code}): {e.message}")
    except anthropic.APIConnectionError:
        raise TransientError("Could not reach the Anthropic API; will retry on the next pass.")

    meta = {"model": getattr(response, "model", model), "stop_reason": response.stop_reason}
    usage = getattr(response, "usage", None)
    if usage is not None:
        meta["usage"] = {"input_tokens": getattr(usage, "input_tokens", None), "output_tokens": getattr(usage, "output_tokens", None)}
    if response.stop_reason == "refusal":
        raise ClassificationFailed("The AI service declined to read this file, so nothing was proposed. File it manually.")
    if response.stop_reason == "max_tokens":
        raise ClassificationFailed("This document has more content than one classification pass can return. File it manually.")
    texts = [b.text for b in response.content if getattr(b, "type", None) == "text"]
    if not texts:
        raise ClassificationFailed("The AI service returned no answer for this document.")
    try:
        return json.loads(texts[-1]), meta
    except json.JSONDecodeError:
        raise ClassificationFailed("The AI service's answer wasn't valid structured data, so nothing was proposed.")


# ============================================================================
# 5. Checking the model's answer against the document text (reuses
#    extract_cv_fields's own quote/date/digit helpers outright).
# ============================================================================

def _fields_by_name(raw_fields):
    """The model's real answer is a list of {field, value, evidence} entries
    (output_schema()) - a dict keyed by field name is also accepted, kept
    only so the hand-written test fixtures (which test the logic below, not
    the wire schema) don't all need rewriting for this. Last entry for a
    repeated field name wins, same as a dict literal would."""
    if isinstance(raw_fields, list):
        return {e.get("field"): e for e in raw_fields if isinstance(e, dict) and e.get("field")}
    return raw_fields or {}


def validate_proposal(data, text, local_ids):
    norm_text = cvx._norm(text)
    digits_text = cvx._digits(text)
    overall = [p for p in (data.get("parse_problems") or []) if p]
    kind = data.get("document_kind") or "unknown"
    if kind not in DOCUMENT_KINDS:
        kind = "unknown"

    raw_fields = _fields_by_name(data.get("fields"))
    fields = {}
    for f in KIND_FIELDS.get(kind, []):
        item = raw_fields.get(f) or {}
        value, evidence = item.get("value"), item.get("evidence")
        if isinstance(value, str):
            value = value.strip() or None
        if value is None:
            continue
        if f in NUMBER_FIELDS and isinstance(value, str):
            try:
                value = float(value.replace(",", "").replace(" ", ""))
            except ValueError:
                pass  # falls through to the "not a number" warning below, same as before
        warnings = []
        verified = cvx.evidence_in_text(evidence, norm_text)
        if not verified:
            warnings.append("The quote this was read from couldn't be found in the document's text - check it against the document.")
        if f in DATE_FIELDS:
            iso, precision, w = cvx.normalise_date(str(value))
            if w:
                warnings.append(w)
            if iso is None:
                verified = False
            elif precision != "day":
                verified = False
            value = iso
        if f in NUMBER_FIELDS and not isinstance(value, (int, float)):
            warnings.append(f"'{value}' isn't a number; check it.")
            value, verified = None, False
        if value is not None:
            fields[f] = {"value": value, "evidence": evidence, "verified": verified, "warnings": warnings}

    if kind == "id_document":
        if len(local_ids) == 1:
            fields["id_number"] = {"value": local_ids[0], "evidence": "Found in the document text (never sent to the AI service).",
                                   "verified": True, "warnings": []}
        elif len(local_ids) > 1:
            overall.append(f"This document contains {len(local_ids)} different SA ID numbers, so none was proposed.")
        elif not local_ids:
            overall.append("No valid South African ID number was found in this document's text - enter it by hand if you file this.")

    if kind == "unknown" and not fields:
        raise ClassificationFailed(
            "This doesn't look like one of the document types this tool recognises"
            + (f": {data.get('document_kind_reason')}" if data.get("document_kind_reason") else ".")
            + " It will be listed as 'needs manual review' rather than guessed at.")

    return {"document_kind": kind, "document_kind_reason": data.get("document_kind_reason"), "fields": fields}, overall


def extract_from_file(path, filename, work_dir, client=None):
    read = read_document_text(path, work_dir)
    redacted, ids = cvx.find_and_redact_sa_ids(read["text"], redact_all_13_digit=bool(read.get("ocr")))
    data, meta = call_llm(compact_for_model(redacted), filename, client=client)
    proposal, warnings = validate_proposal(data, read["verify_text"], ids)
    if read["empty_pages"]:
        warnings.insert(0, f"Page(s) {', '.join(map(str, read['empty_pages']))} of {read['pages']} had no readable text "
                           "(probably scanned) - anything on them was not read.")
    if read.get("ocr"):
        mark_ocr_values(proposal, read["native_text"])
        o = read["ocr"]
        warnings.insert(0, (f"OCR: page(s) {', '.join(map(str, o['pages_ocr']))} are a scan and were read by OCR "
                            f"(average confidence {o['mean_confidence']:.0f}/100), not from a text layer. Every value "
                            "read from them is left unticked - check each one against the scan."))
    info = {"text_method": read["method"], "source_pages": read["pages"], "source_text_chars": len(read["text"]), **meta}
    return proposal, warnings, info


def mark_ocr_values(proposal, native_text):
    norm_native, digits_native = cvx._norm(native_text), cvx._digits(native_text)
    for key, item in list(proposal["fields"].items()):
        if native_text.strip() and (cvx.evidence_in_text(item.get("evidence"), norm_native)
                                    or (key == "id_number" and str(item["value"]) in digits_native)):
            continue
        item["verified"] = False
        if cvx.OCR_FIELD_WARNING not in item["warnings"]:
            item["warnings"].insert(0, cvx.OCR_FIELD_WARNING)


# ============================================================================
# Local CLI (queue mode lives in process_onboarding_jobs.py)
# ============================================================================

def run_local_file(path, text_only):
    work_dir = tempfile.mkdtemp(prefix="onboarding_classify_")
    try:
        if text_only:
            read = read_document_text(path, work_dir)
            redacted, ids = cvx.find_and_redact_sa_ids(read["text"])
            print(json.dumps({"method": read["method"], "pages": read["pages"], "empty_pages": read["empty_pages"],
                              "chars": len(read["text"]), "sa_id_numbers_found": len(ids),
                              "keyword_hint": keyword_hint(os.path.basename(path))}, indent=2))
            return 0
        proposal, warnings, info = extract_from_file(path, os.path.basename(path), work_dir)
        print(json.dumps({"info": info, "warnings": warnings, "proposal": proposal}, indent=2, default=str))
        return 0
    except ClassificationFailed as e:
        print(f"CLASSIFICATION FAILED (shown to the user as-is): {e}")
        return 2
    except (SetupError, TransientError) as e:
        print(f"ERROR: {e}")
        return 1
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", required=True, help="run on one local file")
    ap.add_argument("--text-only", action="store_true", help="only show the text step (no API call)")
    args = ap.parse_args(argv)
    return run_local_file(args.file, args.text_only)


if __name__ == "__main__":
    sys.exit(main())
