"""
Builds one ordered, page-numbered SANRAL submission-pack PDF from local files,
by running the REAL existing fill engines - never a reimplementation of them:

  fingerprint.py           template-change check (refuses on a real mismatch)
  fill_conventional.py /   Technical Submission workbook (family picked by
  fill_tender.py           fingerprint.detect_family, the same rule fingerprint.py uses)
  print_reports.py         Forms B1-B2 per position, B3, B4, B5, B7 as PDF
  fill_financial.py        Financial workbook, mechanical fields only
  fill_financial_hours.py  hours sheets, only when a complete human capture exists
  run_forms_pipeline.py    C.1.1.1, C.1.2.3, A-Forms bundle, ACTIONS_TO_SIGN.md,
                           merged field_provenance.json
  fill_authority_letter.py A2 authority letter (DRAFT, unsigned)
  make_envelope_covers.py  outer / technical / financial covers

then merges those with the company's vault documents and any CVs into one PDF
(engine/pack/pdf_merge.py) with a contents page that also lists, with a
reason, everything that is NOT in the pack.

This module only knows about local files. engine/pack/process_pack_jobs.py is
the Supabase adapter (downloads the inputs, calls build_submission_pack(),
uploads the output); engine/admin_harness.py --pack calls it directly against
the synthetic test companies.

Nothing here signs, prices or invents a tender fact. Signatures, witness,
pricing and B4/B5 narrative content stay human work - the contents page and
ACTIONS_TO_SIGN.md say so.
"""
import os
import re
import sys
import json
import shutil
import datetime

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.abspath(os.path.join(HERE, ".."))
for p in (ENGINE_DIR, os.path.join(ENGINE_DIR, "pack_generator"), os.path.join(ENGINE_DIR, "cv"), HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

import fingerprint  # noqa: E402
import fill_conventional  # noqa: E402
import fill_tender  # noqa: E402
import fill_financial  # noqa: E402
import fill_financial_hours  # noqa: E402
import run_forms_pipeline  # noqa: E402
import fill_authority_letter  # noqa: E402
import make_envelope_covers  # noqa: E402
from sanral_fill import Workbook, n2col  # noqa: E402
from generate_cv import _convert_to_pdf  # noqa: E402
from pdf_merge import merge_with_contents  # noqa: E402

TECHNICAL = "Envelope 1 - Technical Submission"
FINANCIAL = "Envelope 2 - Financial Submission"
OUTER = "Outer envelope"

FILLERS = {
    "Conventional Consultant Tender": fill_conventional,
    "RRM Consultant Tender": fill_tender,
}

# Vault documents (migration 0014) and where each belongs in SANRAL's
# returnable schedule - same form numbers app/lib/tenderCompliance.ts uses.
VAULT_ORDER = [
    ("sars_tcs_pin", "A9", "Tax compliance status (SARS TCS PIN)"),
    ("bee_proof", "A12", "B-BBEE proof (certificate or sworn affidavit)"),
    ("pi_insurance", "A17", "Certificate of professional indemnity insurance"),
    ("bank_letter", "A18", "Bank confirmation letter"),
    ("coid_letter", "A20", "COID Letter of Good Standing"),
]
ISO_KEY = ("iso_9001", "B4", "ISO 9001 certificate")

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif"}
OFFICE_EXT = {".doc", ".docx", ".odt", ".rtf"}


def _to_pdf(path, work_dir):
    """A vault upload or CV can be a PDF, an image (phone scan) or a Word
    file. Returns (pdf_path, None) or (None, reason) - never guesses."""
    if not path or not os.path.exists(path):
        return None, "file not found"
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        try:
            from pypdf import PdfReader
            n = len(PdfReader(path).pages)
            return (path, None) if n else (None, "PDF has no pages")
        except Exception as e:
            return None, f"PDF could not be read ({type(e).__name__})"
    os.makedirs(work_dir, exist_ok=True)
    if ext in IMAGE_EXT:
        from PIL import Image
        out = os.path.join(work_dir, os.path.splitext(os.path.basename(path))[0] + ".pdf")
        try:
            img = Image.open(path)
            img.load()  # full load, not a header check - see playbook section 2
            img.convert("RGB").save(out, "PDF", resolution=150)
            return out, None
        except Exception as e:
            return None, f"image could not be converted ({type(e).__name__})"
    if ext in OFFICE_EXT:
        local = os.path.join(work_dir, os.path.basename(path))
        if os.path.abspath(local) != os.path.abspath(path):
            shutil.copy(path, local)
        pdf = _convert_to_pdf(local, work_dir)
        return (pdf, None) if pdf else (None, "Word file could not be converted to PDF")
    return None, f"unsupported file type '{ext}'"


def _excel_date(v):
    if isinstance(v, (int, float)):
        return datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))
    try:
        return datetime.date.fromisoformat(str(v)[:10])
    except Exception:
        return None


def check_template(technical_tpl, store=None):
    """fingerprint.py's own build/diff - refuses on a blocking mismatch, the
    same rule its CLI enforces. Returns (family, warnings)."""
    store = store or fingerprint.DEFAULT_STORE
    current = fingerprint.build_fingerprint(technical_tpl)
    family = current["family"]
    if family not in FILLERS:
        raise ValueError(f"Template family '{family}' is not one this engine can fill "
                         "(sheet set matches neither Conventional nor RRM)")
    warnings = []
    store_path = os.path.join(store, family.replace(" ", "_") + ".json")
    if not os.path.exists(store_path):
        warnings.append(f"No stored fingerprint baseline for '{family}' - template-change check not possible. "
                        "Run engine/fingerprint.py on a known-good copy to store one.")
        return family, warnings
    changes, soft = fingerprint.diff(json.load(open(store_path)), current)
    if changes:
        keys = ", ".join(k for k, _, _ in changes[:6])
        raise ValueError(f"Template fingerprint MISMATCH against the stored '{family}' baseline ({keys}). "
                         "SANRAL may have changed the template - not filling it. Run engine/fingerprint.py "
                         "on it for the full diff.")
    return family, warnings


def positions_on_setup(xlsm):
    wb = Workbook(xlsm)
    return {p + 1: str(wb.cached("SETUP", f"{n2col(2 + p)}6") or "").strip() for p in range(20)}


def build_submission_pack(*, profile, pack_yaml, technical_tpl, forms_dir, tender, work_dir,
                          financial_tpl=None, financial_hours_capture=None, logo_path=None,
                          vault_docs=None, cv_docs=None, fingerprint_store=None):
    """
    profile:     dict in config/*_profile.json shape (key_people[0] = the signatory,
                 same convention fill_docx_forms.py / fill_a_forms.py already use)
    pack_yaml:   path to a confirmed pack.yaml (engine/pack_generator/confirm_pack.py output)
    tender:      {"contract_no", "nra_reference", "description", "closing_date" (YYYY-MM-DD),
                  "closing_time" ("HH:MM")} - contract/closing fall back to the template's
                 own SETUP sheet; nothing else is ever invented
    vault_docs:  {key: local path or None} for the keys in VAULT_ORDER / ISO_KEY
    cv_docs:     {position_code: {"path", "person", "source"}} or {position_code: None}
    Returns (pdf_path, manifest).
    """
    vault_docs = vault_docs or {}
    cv_docs = cv_docs or {}
    os.makedirs(work_dir, exist_ok=True)
    tech_dir = os.path.join(work_dir, "technical")
    forms_out = os.path.join(work_dir, "forms")
    conv_dir = os.path.join(work_dir, "converted")
    for d in (tech_dir, forms_out, conv_dir):
        os.makedirs(d, exist_ok=True)
    warnings = []

    profile_path = os.path.join(work_dir, "profile.json")
    json.dump(profile, open(profile_path, "w"), indent=2, default=str)

    # 1. Template check + family
    family, fp_warn = check_template(technical_tpl, fingerprint_store)
    warnings += fp_warn

    wb = Workbook(technical_tpl)
    contract_no = tender.get("contract_no") or str(wb.cached("SETUP", "C2") or "").strip()
    setup_close = _excel_date(wb.cached("SETUP", "C3"))
    closing = tender.get("closing_date") or (setup_close.isoformat() if setup_close else None)
    closing_time = tender.get("closing_time")
    nra_ref = tender.get("nra_reference")
    description = tender.get("description")
    slug = re.sub(r"[^A-Za-z0-9.]+", "-", contract_no).strip("-") or "tender"
    contract_label = contract_no

    # 2. Technical Submission workbook (the real filler for this family)
    filled_xlsm = os.path.join(tech_dir, f"{slug}_FILLED.xlsm")
    FILLERS[family].main(technical_tpl, pack_yaml, filled_xlsm)

    # 3. Form B print reports (print_reports.py, LibreOffice headless). Imported
    # here, not at module top: it needs the `uno` bridge, which only exists on
    # a machine with LibreOffice - same requirement process_cv_jobs.py has.
    import print_reports
    reports_dir = os.path.join(work_dir, "reports")
    made, skipped, _ = print_reports.export(filled_xlsm, reports_dir)
    reports = {os.path.splitext(os.path.basename(m))[0]: m for m in made}
    setup_positions = positions_on_setup(filled_xlsm)

    # 4. Financial workbook - mechanical fields, plus hours only from a complete capture
    financial_out, financial_note = None, None
    if financial_tpl:
        financial_out = os.path.join(work_dir, f"{slug}_Financial_FILLED.xlsm")
        try:
            fill_financial.main(financial_tpl, pack_yaml, financial_out)
        except ValueError as e:
            financial_out, financial_note = None, f"fill_financial.py refused: {e}"
        if financial_out and financial_hours_capture:
            cap = os.path.join(work_dir, "financial_capture.yaml")
            yaml.safe_dump(financial_hours_capture, open(cap, "w"), sort_keys=False)
            hours_out = financial_out.replace("_FILLED.xlsm", "_FILLED_hours.xlsm")
            try:
                fill_financial_hours.fill(financial_out, cap, hours_out)
                os.replace(hours_out, financial_out)
            except ValueError as e:
                warnings.append(f"Financial hours not filled: {e}")
        elif financial_out:
            warnings.append("Financial workbook: hours and pricing sheets left exactly as SANRAL shipped them "
                            "(no complete hours capture on file; pricing is always the tenderer's own input).")
    else:
        financial_note = "No blank Financial Submission workbook on file for this tender."

    # 5. docx returnables: C.1.1.1, C.1.2.3, A-Forms + checklist + provenance
    run_forms_pipeline.main(forms_dir, profile_path, forms_out, contract_label, nra_ref or "", pack_yaml)

    # 6. Authority letter + envelope covers (need the tender's own description/NRA ref)
    signatory = profile["key_people"][0]
    letter_docx = covers = None
    cover_reason = None
    if not (nra_ref and description and closing):
        missing = [k for k, v in (("NRA reference", nra_ref), ("description", description),
                                  ("closing date", closing)) if not v]
        cover_reason = f"tender record has no {', '.join(missing)} - never invented"
    else:
        rfp_number = f"SANRAL {nra_ref} / Contract {contract_no}"
        letter_docx = os.path.join(forms_out, "A2_Authority_Letter.docx")
        fill_authority_letter.build_letter(profile_path, logo_path, letter_docx, signatory["name"],
                                           signatory.get("signatory_capacity") or "", rfp_number, description)
        time_txt = closing_time or "the time stated in the Tender Data"
        args = (profile, logo_path, forms_out, f"SANRAL {contract_no}", nra_ref, description, closing, time_txt)
        covers = {
            "outer": make_envelope_covers.make_outer(*args),
            "technical": make_envelope_covers.make_inner(*args, 1, "TECHNICAL SUBMISSION",
                                                         "CONTAINS NO PRICING INFORMATION"),
            "financial": make_envelope_covers.make_inner(
                *args, 2, "FINANCIAL SUBMISSION",
                "CONTAINS PRICING - TO BE OPENED ONLY AFTER TECHNICAL EVALUATION IS COMPLETE"),
        }

    def docx_pdf(path):
        if not path or not os.path.exists(path):
            return None
        return _convert_to_pdf(path, os.path.dirname(path))

    def sec(title, envelope, pdf, reason=None):
        return {"title": title, "envelope": envelope, "pdf": pdf,
                "omitted_reason": None if pdf else (reason or "could not be produced")}

    # 7. Ordered sections. Order follows the two-envelope structure of the real
    # completed submission (templates/incoming/completed_sample): returnables and
    # Form B reports in the technical envelope, Form of Offer with pricing.
    sections = []
    sections.append(sec("Outer envelope cover", OUTER, docx_pdf(covers and covers["outer"]), cover_reason))

    sections.append(sec("Envelope 1 cover - Technical Submission", TECHNICAL,
                        docx_pdf(covers and covers["technical"]), cover_reason))
    sections.append(sec("A2 - Authority for signatory letter (DRAFT, to be signed by the director)", TECHNICAL,
                        docx_pdf(letter_docx), cover_reason))
    sections.append(sec("A-Forms bundle (A2-A23), completed", TECHNICAL,
                        docx_pdf(os.path.join(forms_out, "A_Forms_FILLED.docx"))))

    def vault_section(key, form, label, envelope):
        entry = vault_docs.get(key)
        # Either a bare path, or {"path": ..., "expiry": "YYYY-MM-DD"} so an
        # expired document is still included (it IS the copy on file) but
        # called out on the contents page instead of passing silently.
        path = entry.get("path") if isinstance(entry, dict) else entry
        expiry = entry.get("expiry") if isinstance(entry, dict) else None
        if not path:
            return sec(f"{form} - {label}", envelope, None, "no copy uploaded to the Document Vault")
        if expiry and closing and str(expiry)[:10] < str(closing)[:10]:
            warnings.append(f"{form} {label}: the copy on file expires {str(expiry)[:10]}, before closing "
                            f"({closing}) - replace it before submitting.")
        pdf, reason = _to_pdf(path, conv_dir)
        return sec(f"{form} - {label}", envelope, pdf, reason and f"vault copy unusable: {reason}")

    for key, form, label in VAULT_ORDER:
        sections.append(vault_section(key, form, label, TECHNICAL))

    sections.append(sec("C.1.2.3 - Contract Data, completed", TECHNICAL,
                        docx_pdf(os.path.join(forms_out, "C.1.2.3_Contract_Data_FILLED.docx"))))

    cv_placed = set()
    for slot in range(1, 21):
        code = setup_positions.get(slot) or ""
        if not code:
            continue
        name = f"{37 + 100 * (slot - 1)} Forms B1-B2 Position {slot}"
        sections.append(sec(f"Forms B1-B2 - Position {slot} ({code})", TECHNICAL, reports.get(name),
                            "no key person filled into this slot" if name in skipped else None))
        # A combined tender lists the same code once per bundled contract
        # (fill_tender.blocks_for) - one B1-B2 report per slot, but the person's
        # CV only once, after the first slot for that code.
        if code in cv_docs and code not in cv_placed:
            cv_placed.add(code)
            cv = cv_docs[code]
            if cv and cv.get("path"):
                pdf, reason = _to_pdf(cv["path"], conv_dir)
                sections.append(sec(f"CV - {code}: {cv.get('person', '')} ({cv.get('source', '')})", TECHNICAL,
                                    pdf, reason and f"CV file unusable: {reason}"))
            else:
                sections.append(sec(f"CV - {code}", TECHNICAL, None,
                                    (cv or {}).get("reason") or "no ready CV for this position"))

    for form in ("Form B3", "Form B4"):
        sections.append(sec(form, TECHNICAL, reports.get(form)))
    sections.append(vault_section(*ISO_KEY, TECHNICAL))
    for form in ("Form B5", "Form B7"):
        sections.append(sec(form, TECHNICAL, reports.get(form)))

    sections.append(sec("Envelope 2 cover - Financial Submission", FINANCIAL,
                        docx_pdf(covers and covers["financial"]), cover_reason))
    sections.append(sec("C.1.1.1 - Form of Offer and Acceptance, completed", FINANCIAL,
                        docx_pdf(os.path.join(forms_out, "C.1.1.1_Form_of_Offer_FILLED.docx"))))
    sections.append(sec("Financial Submission workbook (pricing schedule, C2.4 FIN)", FINANCIAL, None,
                        financial_note or "supplied as the filled .xlsm alongside this PDF - pricing and hours "
                        "are the tenderer's own input in Excel; no print-to-PDF path exists for this workbook yet"))

    notes = [
        "DRAFT FOR REVIEW AND SIGNATURE. Generated by Tender Tool from the data on file. Signatures, the "
        "witness, initials on every page, pricing and the Form B4/B5 narrative are completed by hand - see "
        "ACTIONS_TO_SIGN.md, supplied with this pack.",
    ]
    if closing_time:
        notes.append(f"Closing time {closing_time} is taken from the tender record - confirm it against the "
                     "Tender Data (C2.15) before submission.")
    notes += warnings

    out_pdf = os.path.join(work_dir, f"{slug}_Submission_Pack.pdf")
    company = profile["company"]["legal_name"]
    heading = [f"Contract {contract_no}" + (f"  |  {nra_ref}" if nra_ref else ""),
               (description or "")[:160],
               f"Tenderer: {company}",
               f"Closing: {closing}" + (f" at {closing_time}" if closing_time else ""),
               f"Generated {datetime.date.today().isoformat()}"]
    manifest = merge_with_contents(sections, out_pdf, os.path.join(work_dir, "contents"),
                                   [h for h in heading if h], notes=notes,
                                   front_count=1 if sections[0]["pdf"] else 0, stamp_label=contract_no)
    manifest.update({
        "family": family,
        "contract_no": contract_no,
        "warnings": warnings,
        "outputs": {
            "pdf": out_pdf,
            "technical_xlsm": filled_xlsm,
            "financial_xlsm": financial_out,
            "actions_to_sign": os.path.join(forms_out, "ACTIONS_TO_SIGN.md"),
            "field_provenance": os.path.join(forms_out, "field_provenance.json"),
        },
    })
    json.dump(manifest, open(os.path.join(work_dir, "pack_manifest.json"), "w"), indent=2, default=str)
    return out_pdf, manifest
