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
import argparse
import docx
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH


def _letterhead(d, logo_path):
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


def _addressee_block(d):
    for line in ["The Chief Executive Officer", "The South African National Roads Agency SOC Limited",
                 "PO Box 415", "PRETORIA", "0001"]:
        p = d.add_paragraph(line)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER


def _tender_block(d, contract_no, nra_ref, description, closing_date, closing_time):
    for line in [f"CONTRACT {contract_no}", nra_ref, description.upper()]:
        p = d.add_paragraph(line)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.runs[0].bold = True
    d.add_paragraph()
    p = d.add_paragraph(f"TENDER CLOSES: {closing_date} AT {closing_time}")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.runs[0].bold = True


def _bidder_block(d, comp):
    d.add_paragraph()
    p = d.add_paragraph("TENDERER:")
    p.runs[0].bold = True
    d.add_paragraph(comp["legal_name"])
    d.add_paragraph(comp["registered_address"])
    d.add_paragraph(f"CIPC Registration No: {comp['cipc_registration_number']}")


def make_outer(profile, logo_path, out_dir, contract_no, nra_ref, description,
               closing_date, closing_time):
    comp = profile["company"]
    d = docx.Document()
    _letterhead(d, logo_path)
    _heading(d, "OUTER ENVELOPE", 18)
    d.add_paragraph()
    _addressee_block(d)
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
               closing_date, closing_time, envelope_no, envelope_name, pricing_statement):
    comp = profile["company"]
    d = docx.Document()
    _letterhead(d, logo_path)
    _heading(d, f"ENVELOPE {envelope_no} - {envelope_name}", 18)
    d.add_paragraph()
    _addressee_block(d)
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
    args = ap.parse_args()

    profile = json.load(open(args.profile_path))

    outer = make_outer(profile, args.logo_path, args.out_dir, args.contract_no,
                        args.nra_ref, args.description, args.closing_date, args.closing_time)
    e1 = make_inner(profile, args.logo_path, args.out_dir, args.contract_no, args.nra_ref,
                     args.description, args.closing_date, args.closing_time,
                     1, "TECHNICAL SUBMISSION",
                     "CONTAINS NO PRICING INFORMATION")
    e2 = make_inner(profile, args.logo_path, args.out_dir, args.contract_no, args.nra_ref,
                     args.description, args.closing_date, args.closing_time,
                     2, "FINANCIAL SUBMISSION",
                     "CONTAINS PRICING - TO BE OPENED ONLY AFTER TECHNICAL EVALUATION IS COMPLETE")
    print(f"Wrote {outer}\nWrote {e1}\nWrote {e2}")


if __name__ == "__main__":
    main()
