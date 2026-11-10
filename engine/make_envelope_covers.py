"""
Generates the three envelope cover sheets for a two-envelope SANRAL submission:
Outer Envelope, Inner Envelope 1 (Technical Submission), Inner Envelope 2 (Financial
Submission). Mirrors the structure of SANRAL's own real public-sector reference example
(found in Drive: "00_Envelope_Cover_Pages_Outer_E1_E2.pdf") - addressee block, contract
number, project description, closing date/time, bidder details, and the envelope-specific
contents/pricing statement that is the whole point of splitting the submission in two.

Does NOT invent any tender fact: contract number, NRA reference, description and closing
date must be passed in explicitly (read from the real SETUP sheet / docx headers, not
guessed). Bidder details come from the company profile.

Usage:
    python3 make_envelope_covers.py <profile.json> <logo.png> <output_dir> \\
        --contract-no "SANRAL R.334-030-2025/1F" \\
        --nra-ref "NRA 2026/0073" \\
        --description "..." \\
        --closing-date "2026-10-22" --closing-time "11:00 (TIME NOT CONFIRMED - check Book 1/Tender Data C2.15)"
"""
import json
import re
import argparse
import docx
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH

# QA pass, 2026-11-04: python-docx (via lxml) raises ValueError("All strings
# must be XML compatible...") on a control character/NULL byte - confirmed
# directly. Every text field this file prints is read from a real,
# uncontrolled source: `description`/`nra_ref`/`delivery_address` are read
# straight out of a tender's own scanned/OCR'd document text
# (classify_tender.find_nra_reference()/find_delivery_address(), the same
# OCR path already confirmed capable of misreading characters - see
# generate_cv.py's own identically-named fix for the sibling bug this exact
# codebase already found and fixed once in a different file), and
# `contract_no` is read from the template's own SETUP cell. Before this fix,
# a single stray control character anywhere in any of those fields crashed
# EVERY paragraph in all three envelope covers (outer + both inner) - not a
# minor cosmetic miss: assemble_pack.py's own envelope-covers step has no
# try/except around it, so this took down the WHOLE pack build (every form,
# every returnable, the merged PDF), not just the cover sheets.
_XML_INVALID_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")


def _safe_text(value):
    """Never called on None - every call site below already only calls
    this with a string (truthiness-checked first where the field is
    optional), same convention as generate_cv.py's own _safe_text()."""
    return _XML_INVALID_RE.sub("", value)


def _set_margins(d):
    """Default python-docx margins (1in top/bottom, 1.25in sides) leave too little
    room for a cover with a letterhead, 3 heading blocks and a full address/bidder
    block - confirmed by testing: every outer cover generated so far spills exactly
    one line (the CIPC registration number) onto an otherwise-blank second page.
    Tightening margins is purely a page-layout change - it touches no tender fact
    or field, same principle as the dots-vs-text-above-dots fix below."""
    s = d.sections[0]
    s.top_margin = s.bottom_margin = Inches(0.75)
    s.left_margin = s.right_margin = Inches(0.9)


def _letterhead(d, logo_path):
    # No logo on file (companies.logo_storage_path null): same cover, no logo,
    # rather than refusing to make the cover at all.
    if not logo_path:
        return
    p = d.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(logo_path, width=Inches(1.6))
    d.add_paragraph()


def _heading(d, text, size=16):
    p = d.add_paragraph(text)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.runs[0].bold = True
    p.runs[0].font.size = Pt(size)
    return p


def _addressee_block(d, delivery_address=None):
    """The employer, then the tender's OWN delivery address (its Tender Notice,
    C.2.13.5: "The Employer's address for delivery of tender offers ... are as
    indicated in the Tender Notice"). Until 2026-10-18 every cover carried
    SANRAL head office's "The Chief Executive Officer / PO Box 415 / PRETORIA
    0001" (copied from one reference example) - R.396's own Tender Notice says
    the tender box is at 20 Shoreward Drive, Bay West, Gqeberha. No address on
    file = no address printed (the pack says to write it on), never a guess."""
    lines = ["The South African National Roads Agency SOC Limited"] + [l for l in (delivery_address or []) if l]
    for line in lines:
        p = d.add_paragraph(_safe_text(line))
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER


def _tender_block(d, contract_no, nra_ref, description, closing_date, closing_time):
    # `nra_ref`/`description` are read straight out of a tender's own
    # scanned/OCR'd document text (same reachability as _safe_text()'s own
    # header comment) - _safe_text() strips invalid XML control characters,
    # but if ONE of these fields is made up ENTIRELY of such characters (not
    # just containing a stray one, the case Finding 125 already fixed), the
    # sanitized result is an EMPTY string. python-docx's own add_paragraph()
    # only adds a run when its `text` argument is truthy, so `d.add_paragraph("")`
    # silently returns a paragraph with ZERO runs - and the very next line,
    # `p.runs[0].bold = True`, then raises IndexError, crashing the whole pack
    # build exactly the way Finding 125's own fix describes (no try/except
    # around assemble_pack.py's envelope-covers step). Confirmed live:
    # nra_ref="\x01\x02\x03" raised `IndexError: list index out of range`
    # before this fix. `contract_no`/`closing_date`/`closing_time` can't hit
    # this - each is always wrapped in fixed literal text ("CONTRACT "/
    # "TENDER CLOSES: "/" AT ") that keeps the line non-empty regardless of
    # what the variable itself sanitizes down to. Skipping a line that
    # sanitizes to nothing (rather than printing a blank bold paragraph)
    # matches this file's own established "only print what's really there"
    # convention (_bidder_block's optional address/CIPC lines, _addressee_block's
    # "No address on file = no address printed, never a guess"). QA pass, 2026-11-10.
    for line in [f"CONTRACT {contract_no}", nra_ref, description.upper()]:
        text = _safe_text(line)
        if not text:
            continue
        p = d.add_paragraph(text)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.runs[0].bold = True
    d.add_paragraph()
    p = d.add_paragraph(_safe_text(f"TENDER CLOSES: {closing_date} AT {closing_time}"))
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.runs[0].bold = True


def _bidder_block(d, comp):
    d.add_paragraph()
    p = d.add_paragraph("TENDERER:")
    p.runs[0].bold = True
    d.add_paragraph(_safe_text(comp["legal_name"]))
    # only what is on file - an empty address / "CIPC Registration No: " line
    # used to be printed for a company without them
    if comp.get("registered_address"):
        d.add_paragraph(_safe_text(comp["registered_address"]))
    if comp.get("cipc_registration_number"):
        d.add_paragraph(_safe_text(f"CIPC Registration No: {comp['cipc_registration_number']}"))


def make_outer(profile, logo_path, out_dir, contract_no, nra_ref, description,
               closing_date, closing_time, delivery_address=None):
    comp = profile["company"]
    d = docx.Document()
    _set_margins(d)
    _letterhead(d, logo_path)
    _heading(d, "OUTER ENVELOPE", 18)
    d.add_paragraph()
    _addressee_block(d, delivery_address)
    d.add_paragraph()
    _tender_block(d, contract_no, nra_ref, description, closing_date, closing_time)
    d.add_paragraph()
    p = d.add_paragraph(
        "This envelope contains TWO SEPARATELY SEALED ENVELOPES:\n"
        "ENVELOPE 1 - TECHNICAL SUBMISSION\n"
        "ENVELOPE 2 - FINANCIAL SUBMISSION (PRICING)\n\n"
        "DO NOT OPEN BEFORE THE OFFICIAL TENDER CLOSING TIME."
    )
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _bidder_block(d, comp)
    path = f"{out_dir}/00_Envelope_Cover_Outer.docx"
    d.save(path)
    return path


def make_inner(profile, logo_path, out_dir, contract_no, nra_ref, description,
               closing_date, closing_time, envelope_no, envelope_name, pricing_statement, delivery_address=None):
    comp = profile["company"]
    d = docx.Document()
    _set_margins(d)
    _letterhead(d, logo_path)
    _heading(d, f"ENVELOPE {envelope_no} - {envelope_name}", 18)
    d.add_paragraph()
    _addressee_block(d, delivery_address)
    d.add_paragraph()
    _tender_block(d, contract_no, nra_ref, description, closing_date, closing_time)
    d.add_paragraph()
    p = d.add_paragraph(pricing_statement)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.runs[0].bold = True
    _bidder_block(d, comp)
    fname = f"0{envelope_no}_Envelope_Cover_{envelope_name.replace(' ', '_')}.docx"
    path = f"{out_dir}/{fname}"
    d.save(path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("profile_path")
    ap.add_argument("logo_path")
    ap.add_argument("out_dir")
    ap.add_argument("--contract-no", required=True)
    ap.add_argument("--nra-ref", required=True)
    ap.add_argument("--description", required=True)
    ap.add_argument("--closing-date", required=True)
    ap.add_argument("--closing-time", required=True)
    ap.add_argument("--delivery-address", action="append", default=None,
                    help="one line of the tender-box address from the Tender Notice (repeat per line)")
    args = ap.parse_args()

    profile = json.load(open(args.profile_path))

    outer = make_outer(profile, args.logo_path, args.out_dir, args.contract_no,
                        args.nra_ref, args.description, args.closing_date, args.closing_time,
                        delivery_address=args.delivery_address)
    e1 = make_inner(profile, args.logo_path, args.out_dir, args.contract_no, args.nra_ref,
                     args.description, args.closing_date, args.closing_time,
                     1, "TECHNICAL SUBMISSION",
                     "CONTAINS NO PRICING INFORMATION", delivery_address=args.delivery_address)
    e2 = make_inner(profile, args.logo_path, args.out_dir, args.contract_no, args.nra_ref,
                     args.description, args.closing_date, args.closing_time,
                     2, "FINANCIAL SUBMISSION",
                     "CONTAINS PRICING - TO BE OPENED ONLY AFTER TECHNICAL EVALUATION IS COMPLETE",
                     delivery_address=args.delivery_address)
    print(f"Wrote {outer}\nWrote {e1}\nWrote {e2}")


if __name__ == "__main__":
    main()
