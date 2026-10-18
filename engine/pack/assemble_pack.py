"""
Builds the ordered, page-numbered SANRAL submission-pack PDFs from local files,
by running the REAL existing fill engines - never a reimplementation of them:

  fingerprint.py           template-change check (refuses on a real mismatch)
  fill_conventional.py /   Technical Submission workbook (family picked by
  fill_tender.py           fingerprint.detect_family, the same rule fingerprint.py uses)
  print_reports.py         Forms B1-B2 per position, B3, B4, B5, B7 as PDF
  fill_financial.py        Financial workbook, mechanical fields only
  fill_financial_hours.py  hours sheets, only when a complete human capture exists
  print_financial.py       the filled Financial workbook's visible sheets as PDF
  run_forms_pipeline.py    C.1.1.1, C.1.2.3, A-Forms bundle, ACTIONS_TO_SIGN.md,
                           merged field_provenance.json
  fill_authority_letter.py A2 authority letter: the company's own uploaded letter
                           as-is, or generated from its own guideline, or listed
                           as not set up (engine/company_documents.py)
  make_envelope_covers.py  outer / technical / financial covers

then merges those with the company's vault documents and any CVs into two
PDFs (engine/pack/pdf_merge.py), each with a contents page that also lists, with a
reason, everything that is NOT in it:

  - the submission pack PDF: outer envelope cover + Envelope 1 (Technical);
  - a SEPARATE Envelope 2 (Financial) PDF: its cover, the Form of Offer and
    the printed Financial workbook.

Two PDFs, not one, because that is the documented two-envelope convention:
the two envelopes are sealed separately and Envelope 2 is opened only after
technical evaluation, so nothing with pricing may sit in the technical pack
(docs/specs/Tender-Tool-Claude-Code-Handover.md section 5 "pricing guard" and
section 7 "one PDF per envelope"; Tender-Tool-Competitor-Feature-Deep-Dive.md
"Two-envelope submissions": "build the technical and pricing packs
separately, each as its own PDF ... page numbering"). Klipcorp's real
completed submission keeps its "Pricing Schedule" set (Form of Offer, Form
C2.4, printed pricing workbook) apart from its technical returnables too.

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
import company_documents  # noqa: E402
from provenance import ProvenanceLog  # noqa: E402
import make_envelope_covers  # noqa: E402
import sanral_b7  # noqa: E402
from sanral_fill import Workbook, n2col  # noqa: E402
from generate_cv import _convert_to_pdf  # noqa: E402
from pdf_merge import merge_with_contents, expiry_warning  # noqa: E402

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
                          vault_docs=None, cv_docs=None, fingerprint_store=None, subcontracting_plan=None):
    """
    profile:     dict in config/*_profile.json shape (key_people[0] = the signatory,
                 same convention fill_docx_forms.py / fill_a_forms.py already use)
    pack_yaml:   path to a confirmed pack.yaml (engine/pack_generator/confirm_pack.py output)
    tender:      {"contract_no", "nra_reference", "description", "closing_date" (YYYY-MM-DD),
                  "closing_time" ("HH:MM")} - contract/closing fall back to the template's
                 own SETUP sheet; nothing else is ever invented
    vault_docs:  {key: local path or None} for the keys in VAULT_ORDER / ISO_KEY
    cv_docs:     {position_code: {"path", "person", "source"}} or {position_code: None}
    subcontracting_plan: the company's own Form B7 answer (tender_subcontracting_plans
                 row shape: {"mode": "subcontract"|"waived_by_tender", ...}) or None -
                 see engine/sanral_b7.py. Never defaulted: with no answer, a B7 that
                 applies is listed as NOT INCLUDED, required and unanswered.
    Returns (pdf_path, manifest). pdf_path is the technical pack; the separate
    Envelope 2 PDF is manifest["outputs"]["financial_pdf"], described by
    manifest["financial"] (same shape as the top-level manifest's
    page_count/sections/omitted, so pdf_merge.verify_pack() reads it back too).
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

    # 1b. Form B7 (Targeted Enterprise subcontracting): does it apply to this
    # tender and this company (category from the template's own SETUP sheet +
    # SANRAL's matrix there + the company's size), and what did the company
    # answer? sanral_b7.py. A plan with errors refuses here (ValueError, the
    # user's to fix) rather than half-filling the form.
    pack_data = yaml.safe_load(open(pack_yaml)) or {}
    b7_setup = sanral_b7.read_setup(wb)
    legacy_te = (pack_data.get("tender") or {}).get("targeted_enterprise")
    b7_plan = subcontracting_plan or (pack_data.get("tender") or {}).get("subcontracting_plan")
    b7_applies = sanral_b7.applicability(b7_setup, (profile.get("company") or {}).get("status"), b7_plan)
    b7_warnings = []
    if b7_plan:
        b7_errors, b7_warnings = sanral_b7.check_plan(b7_plan, b7_applies)
        if b7_errors:
            raise ValueError("Form B7 subcontracting plan: " + "; ".join(b7_errors)
                             + " - correct it on the Tender Workspace (Form B7 card).")
    # The filler reads the plan from its pack.yaml: a copy with it added, used
    # for the Technical workbook fill only (the other steps keep the confirmed
    # pack.yaml and its pack_suggestions.json sibling).
    fill_yaml = pack_yaml
    if subcontracting_plan:
        pack_data.setdefault("tender", {})["subcontracting_plan"] = subcontracting_plan
        fill_yaml = os.path.join(work_dir, "pack_with_b7.yaml")
        yaml.safe_dump(pack_data, open(fill_yaml, "w"), sort_keys=False)
    b7_filled = (b7_plan or {}).get("mode") == "subcontract" or (bool(legacy_te) and not b7_plan)

    # 2. Technical Submission workbook (the real filler for this family)
    filled_xlsm = os.path.join(tech_dir, f"{slug}_FILLED.xlsm")
    # Returns notes for projects left off a position's Form B1 because that
    # position's form doesn't offer their project type (sanral_fill.
    # projects_for_block) - surfaced on the contents page, never silent.
    warnings += FILLERS[family].main(technical_tpl, fill_yaml, filled_xlsm) or []

    # 3. Form B print reports (print_reports.py, LibreOffice headless). Imported
    # here, not at module top: it needs the `uno` bridge, which only exists on
    # a machine with LibreOffice - same requirement process_cv_jobs.py has.
    import print_reports
    reports_dir = os.path.join(work_dir, "reports")
    try:
        made, skipped, _ = print_reports.export(filled_xlsm, reports_dir)
    except Exception as e:
        # A LibreOffice/UNO failure ("illegal object given!", "cannot get value
        # Control") is a worker problem, not the company's data - say so,
        # instead of handing the Tender Workspace a raw UNO exception.
        # RuntimeError (not ValueError) so the harness still counts it as a
        # run failure rather than a data refusal.
        raise RuntimeError("LibreOffice failed while printing Forms B1-B7 from the filled workbook - a worker "
                           f"problem, not your data; request the pack again ({type(e).__name__}: {str(e)[:160]})") from e
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

    # 4b. Print the filled Financial workbook (its visible sheets - the same set
    # Klipcorp's real submission printed; see print_financial.py). Imported here
    # for the same `uno` reason as print_reports below.
    financial_pdf = c24_pdf = None
    c24_note = financial_note
    if financial_out:
        import print_financial
        financial_pdf = os.path.join(work_dir, "financial_print", f"{slug}_Financial_workbook.pdf")
        c24_pdf = os.path.join(work_dir, "financial_print", f"{slug}_Form_C2.4_FIN.pdf")
        try:
            print_financial.export(financial_out, financial_pdf, c24_pdf)
            if not os.path.exists(c24_pdf):
                c24_pdf, c24_note = None, "this Financial workbook has no visible FORM C2.4 FIN sheet"
        except Exception as e:  # a print failure must not lose the technical pack
            financial_pdf = c24_pdf = None
            financial_note = c24_note = (f"the filled workbook could not be printed to PDF ({type(e).__name__}: {e}) - "
                                         "print it from Excel; the filled .xlsm is supplied with this pack")

    # 5. docx returnables: C.1.1.1, C.1.2.3, A-Forms + checklist + provenance
    run_forms_pipeline.main(forms_dir, profile_path, forms_out, contract_label, nra_ref or "", pack_yaml)

    # 6. Authority letter: the company's own choice (company_documents.py,
    # table company_document_templates) - its uploaded letter as-is, or its own
    # guideline filled with this tender's details, or "not set up". Never
    # another company's wording.
    signatory = profile["key_people"][0]
    rfp_number = (f"SANRAL {nra_ref} / Contract {contract_no}" if nra_ref and contract_no
                  else (f"Contract {contract_no}" if contract_no else None))
    letter_log = ProvenanceLog("company_documents.py")
    letter = fill_authority_letter.produce_letter(
        profile, os.path.join(forms_out, "company_documents"), signatory,
        {"contract_no": contract_no, "nra_reference": nra_ref, "description": description, "closing_date": closing},
        rfp_number, letter_log, logo_path=logo_path, llm=company_documents.default_llm_client())
    if letter["status"] in ("not_set_up", "failed"):
        warnings.append(letter["reason"])
    elif letter["method"] == "verbatim":
        warnings.append("Authority letter: generated from your guideline word for word - no {{fields}} were placed; "
                        "check it names this tender before signing.")
    # Its provenance joins the forms' own, so ACTIONS_TO_SIGN.md lists any
    # [NOT ON FILE] field or "not set up" item too.
    merged = os.path.join(forms_out, "field_provenance.json")
    if os.path.exists(merged):
        entries = json.load(open(merged)) + letter_log.entries
        json.dump(entries, open(merged, "w"), indent=2)
        run_forms_pipeline.generate_action_checklist.main(
            forms_out, contract_label, merged, run_forms_pipeline.specialism_note_from_pack(pack_yaml))

    # Envelope covers (need the tender's own description/NRA ref).
    covers = None
    cover_reason = None
    if not (nra_ref and description and closing):
        missing = [k for k, v in (("NRA reference", nra_ref), ("description", description),
                                  ("closing date", closing)) if not v]
        cover_reason = f"tender record has no {', '.join(missing)} - never invented"
    else:
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

    def sec(title, envelope, pdf, reason=None, warning=None):
        return {"title": title, "envelope": envelope, "pdf": pdf,
                "omitted_reason": None if pdf else (reason or "could not be produced"),
                "warning": warning if pdf else None}

    # 7. Ordered sections. Order follows the two-envelope structure of the real
    # completed submission (templates/incoming/completed_sample): returnables and
    # Form B reports in the technical envelope, Form of Offer with pricing.
    # Envelope 2 goes into its own PDF (fin_sections) - see the module docstring.
    sections = []
    sections.append(sec("Outer envelope cover", OUTER, docx_pdf(covers and covers["outer"]), cover_reason))

    sections.append(sec("Envelope 1 cover - Technical Submission", TECHNICAL,
                        docx_pdf(covers and covers["technical"]), cover_reason))
    if letter["path"]:
        letter_pdf, letter_err = _to_pdf(letter["path"], conv_dir)
    else:
        letter_pdf, letter_err = None, letter["reason"]
    letter_how = {"uploaded": "your own letter, as uploaded",
                  "fields": "generated from your own guideline", "ai_placed": "generated from your own guideline",
                  "verbatim": "your own guideline, word for word"}.get(letter.get("method"), "")
    sections.append(sec(f"A2 - Letter of authority to sign ({letter_how}; to be signed)" if letter_how
                        else "A2 - Letter of authority to sign", TECHNICAL, letter_pdf,
                        letter_err if letter["path"] else letter["reason"]))
    sections.append(sec("A-Forms bundle (A2-A23), completed", TECHNICAL,
                        docx_pdf(os.path.join(forms_out, "A_Forms_FILLED.docx"))))

    def vault_section(key, form, label, envelope):
        entry = vault_docs.get(key)
        # Either a bare path, or {"path": ..., "expiry": "YYYY-MM-DD"}. An
        # expired copy is still INCLUDED - it is the copy on file, and leaving
        # it out would only hide the problem - but its checklist row carries a
        # WARNING to replace it before submission (Sarel, 2026-10-17: "Dont
        # include. Add as a warning." - i.e. don't move it to "Not included").
        path = entry.get("path") if isinstance(entry, dict) else entry
        expiry = entry.get("expiry") if isinstance(entry, dict) else None
        if not path:
            return sec(f"{form} - {label}", envelope, None, "no copy uploaded to the Document Vault")
        pdf, reason = _to_pdf(path, conv_dir)
        return sec(f"{form} - {label}", envelope, pdf, reason and f"vault copy unusable: {reason}",
                   warning=expiry_warning(expiry, closing))

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
    sections.append(sec("Form B5", TECHNICAL, reports.get("Form B5")))
    # SANRAL's own note on the FORM C2.4 FIN sheet: "to be completed, printed and
    # included in the tenderer's technical proposal as a PDF copy" - zero points
    # for workplan appropriateness otherwise. Hours only, no rand amounts, so it
    # is the one Financial-workbook page that belongs in Envelope 1 as well.
    sections.append(sec("Form C2.4 FIN - key persons' normalised hours (copy from the Financial workbook, "
                        "as generated)", TECHNICAL, c24_pdf, c24_note))
    if b7_filled:
        sections.append(sec("Form B7 - Subcontracting to Targeted Enterprises (sign with each Targeted Enterprise)",
                            TECHNICAL, reports.get("Form B7"),
                            warning="; ".join(b7_warnings) or None))
        warnings.append("Form B7: SANRAL asks for a duplicate hard copy signed by both the tenderer and each "
                        "Targeted Enterprise / sub-contractor, with each one's B-BBEE proof (and proof of address "
                        "for one based in the project's province).")
    elif b7_applies["needs_plan"]:
        b7_reason = ("REQUIRED but not answered - " + b7_applies["reason"]
                     + ". Give your subcontracting plan on the Tender Workspace (Form B7 card)")
        sections.append(sec("Form B7 - Subcontracting to Targeted Enterprises", TECHNICAL, None, b7_reason))
        warnings.append("Form B7 is not in this pack: " + b7_reason + ".")
    else:
        sections.append(sec("Form B7 - Subcontracting to Targeted Enterprises", TECHNICAL, None,
                            b7_applies["reason"][:1].upper() + b7_applies["reason"][1:]))

    fin_sections = [
        sec("Envelope 2 cover - Financial Submission", FINANCIAL,
            docx_pdf(covers and covers["financial"]), cover_reason),
        sec("C.1.1.1 - Form of Offer and Acceptance, completed", FINANCIAL,
            docx_pdf(os.path.join(forms_out, "C.1.1.1_Form_of_Offer_FILLED.docx"))),
        # "as generated": pricing and hours are typed into the .xlsm by the
        # tenderer, so this print only shows what was on file when the pack was
        # built - the title says so rather than passing it off as final.
        sec("Financial Submission workbook (Tenderer Input Data, hours, Form C2.4 FIN, Pricing Schedule, "
            "Summary Tendered Fee) - as generated; re-print after entering pricing", FINANCIAL,
            financial_pdf, financial_note),
    ]
    fin_name = f"{slug}_Envelope2_Financial_Submission.pdf"

    notes = [
        "DRAFT FOR REVIEW AND SIGNATURE. Generated by Tender Tool from the data on file. Signatures, the "
        "witness, initials on every page, pricing and the Form B4/B5 narrative are completed by hand - see "
        "ACTIONS_TO_SIGN.md, supplied with this pack.",
    ]
    if closing_time:
        notes.append(f"Closing time {closing_time} is taken from the tender record - confirm it against the "
                     "Tender Data (C2.15) before submission.")
    notes += warnings
    tech_notes = notes + [f"Envelope 2 (Financial Submission: cover, Form of Offer, Financial workbook) is a "
                          f"SEPARATE PDF, {fin_name} - it is sealed in its own envelope and opened only after "
                          "technical evaluation, so no pricing is bound into this one."]

    out_pdf = os.path.join(work_dir, f"{slug}_Submission_Pack.pdf")
    company = profile["company"]["legal_name"]
    heading = [f"Contract {contract_no}" + (f"  |  {nra_ref}" if nra_ref else ""),
               (description or "")[:160],
               f"Tenderer: {company}",
               f"Closing: {closing}" + (f" at {closing_time}" if closing_time else ""),
               f"Generated {datetime.date.today().isoformat()}"]
    manifest = merge_with_contents(sections, out_pdf, os.path.join(work_dir, "contents"),
                                   [h for h in heading if h], notes=tech_notes,
                                   front_count=1 if sections[0]["pdf"] else 0, stamp_label=contract_no)

    # Envelope 2 as its own PDF: own contents page, own "Page X of N".
    fin_pdf = os.path.join(work_dir, fin_name)
    fin_manifest = merge_with_contents(
        fin_sections, fin_pdf, os.path.join(work_dir, "contents_financial"),
        [h for h in heading if h], notes=notes, front_count=1 if fin_sections[0]["pdf"] else 0,
        stamp_label=f"{contract_no} Envelope 2", title="ENVELOPE 2 - FINANCIAL SUBMISSION - CONTENTS",
        pdf_title=f"Financial submission (Envelope 2) {contract_no}")
    fin_manifest["file"] = fin_name
    manifest.update({
        "family": family,
        "contract_no": contract_no,
        "warnings": warnings,
        "financial": fin_manifest,
        # Each company-owned document and how it was produced (uploaded as-is /
        # generated from the company's guideline / not set up).
        # Form B7: whether it applied, why, and what was filled (sanral_b7.py).
        "form_b7": {"setup": b7_setup, "applicability": b7_applies, "included": bool(b7_filled),
                    "plan_mode": (b7_plan or {}).get("mode") or ("legacy_pack_yaml" if legacy_te else None),
                    "targeted_enterprises": len((b7_plan or {}).get("targeted_enterprises") or [])
                    if b7_plan else (1 if legacy_te else 0),
                    "warnings": b7_warnings},
        "company_documents": {"authority_to_sign": {k: letter.get(k) for k in ("status", "method", "path", "reason")}},
        "outputs": {
            "pdf": out_pdf,
            "financial_pdf": fin_pdf,
            "technical_xlsm": filled_xlsm,
            "financial_xlsm": financial_out,
            "actions_to_sign": os.path.join(forms_out, "ACTIONS_TO_SIGN.md"),
            "field_provenance": os.path.join(forms_out, "field_provenance.json"),
        },
    })
    json.dump(manifest, open(os.path.join(work_dir, "pack_manifest.json"), "w"), indent=2, default=str)
    return out_pdf, manifest
