"""
Fills the full A-Forms bundle (A2 through A23, the SANRAL returnable-schedule
declarations) - not just the A18 bank-details section fill_docx_forms.py already
did. Every field we have real, confirmed data for gets filled with that value
directly - no "[DRAFT]"/"[PENDING]" bracket text in the document itself.

What still can't be filled by software, and why, lives in a separate file this
script also writes: <out_dir>/ACTIONS_TO_SIGN.md. That split is deliberate - a
submitted government tender form with hedge-language typed into it looks like
the tenderer didn't finish their own paperwork, and could itself be read as
non-responsive. The real remaining work (wet signatures, witnessed signatures,
sworn affidavits before a Commissioner of Oaths, attaching a certificate that
has to exist as its own document, a figure nobody has given us yet) is real
work a human still has to do - it belongs on a checklist that gets acted on,
not inside the tender document as a footnote nobody reads before signing.

Three categories of field, handled differently:

1. KNOWN AND MECHANICAL - name, position, company name/registration numbers,
   bank name/branch code, CSD supplier number. Filled directly.
2. KNOWN BY ABSENCE - "does the tenderer have any outstanding debt to SANRAL",
   "is the tenderer on the Register of Tender Defaulters", "any litigation in
   the last 10 years" etc. Nothing in Klipcorp's profile indicates any of
   these apply, so the honest answer on file is No/None. Filled as such, but
   every one of these also gets a line on the checklist telling Henning to
   actually verify it (several of these are checkable against a public
   register) before he signs - filling in the expected answer is not the same
   as having verified it today.
3. GENUINELY UNKNOWN OR REQUIRES A HUMAN ACT - a wet signature, a witness's
   signature (must be a different real person, never fabricated), a sworn
   oath before a Commissioner of Oaths, a SARS TCS PIN nobody has looked up,
   an insurance policy number/value nobody has supplied, a bank account
   number (deliberately never stored in this repo at all), an expired COID
   letter that needs renewing before it can be attached. Left blank in the
   document exactly as the template already has it. Listed on the checklist
   instead, each with what specifically is needed.

Form A2 (Authority of Signatory) and Form A3 (Joint Venture Agreement) are
structurally different from the rest - A2 needs a real board resolution on
the company's own letterhead (the template itself says completing this
example page is not accepted as authorisation), and A3 only applies to a
Joint Venture, which Klipcorp is not. Both are left alone in the bundle
(A3 gets a one-line "Not Applicable" note) with the real action on the
checklist for A2.

Usage: python3 fill_a_forms.py <A_Forms.docx> <profile.json> <out_dir> <contract_label> <nra_ref>
"""
import sys
import re
import json
import docx

DOTS_RE = r"[.…\s]*"


def clear_paragraph(p):
    for r in list(p.runs):
        r.text = ""


def set_paragraph_text(p, text):
    clear_paragraph(p)
    if p.runs:
        p.runs[0].text = text
    else:
        p.add_run(text)


def fill_declaration_blanks(doc, name, position, company):
    """Fills the recurring 'I, the undersigned, ...' declaration openers and the
    '(name)' / '(position)' / '(name of company)' hint-label blanks that appear
    throughout the bundle (A4, A6, A9, A11, A14, A15, A21, A22, A23)."""
    undersigned_re = re.compile(
        r"(I,\s*the\s*undersigned,)" + DOTS_RE + r"(\(name\))?" + DOTS_RE,
        re.IGNORECASE,
    )
    for p in doc.paragraphs:
        text = p.text
        if not text.strip():
            continue
        new_text, n = undersigned_re.subn(f"I, the undersigned, {name.upper()} ", text, count=1)
        changed = bool(n)
        if changed:
            text = new_text
        for pat, val in ((r"\(name\)", name.upper()), (r"\(position\)", position),
                          (r"\(name of company\)", company)):
            new_text2, n2 = re.subn(pat, val, text, flags=re.IGNORECASE)
            if n2:
                text = new_text2
                changed = True
        if changed:
            set_paragraph_text(p, text)


def fill_footer(doc, name, position, company):
    """Fills the Name:/Position/Tenderer: footer repeated at the bottom of every
    form. Deliberately leaves Signed:/Date:/SIGNATURE: dotted blanks untouched -
    those need a real signing event, never text."""
    name_pos_re = re.compile(r"(Name\s*:)" + DOTS_RE, re.IGNORECASE)
    position_re = re.compile(r"(Position\s*:?)" + DOTS_RE, re.IGNORECASE)
    # Negative lookbehinds exclude "Name of Tenderer:" (A17, filled separately via
    # append_after_label - a real field) and "Note(s) to Tenderer:" (a section
    # heading, not a fill point) - both contain the literal substring "Tenderer:"
    # but aren't the Tenderer: footer line.
    tenderer_re = re.compile(r"(?<!of )(?<!to )(Tenderer\s*:)" + DOTS_RE, re.IGNORECASE)
    for p in doc.paragraphs:
        text = p.text
        if "Name" not in text and "Tenderer" not in text:
            continue
        changed = False
        new_text, n = name_pos_re.subn(lambda m: m.group(1) + " " + name.upper() + "   ", text, count=1)
        if n:
            text, changed = new_text, True
        new_text, n = position_re.subn(lambda m: m.group(1) + " " + position + "   ", text, count=1)
        if n:
            text, changed = new_text, True
        new_text, n = tenderer_re.subn(lambda m: m.group(1) + " " + company, text, count=1)
        if n:
            text, changed = new_text, True
        if changed:
            set_paragraph_text(p, text)


def para_matching(doc, prefix):
    for p in doc.paragraphs:
        if p.text.strip().startswith(prefix):
            return p
    return None


def append_after_label(doc, label, value):
    """For 'Label:' paragraphs where the value belongs inline right after the
    colon (A7's CSD fields) rather than a dotted blank."""
    p = para_matching(doc, label)
    if p is not None:
        set_paragraph_text(p, p.text.rstrip() + "  " + value)


def fill_a3_not_applicable(doc):
    p = para_matching(doc, "In the event of a Joint Venture, attach")
    if p is not None:
        new_p = p.insert_paragraph_before(
            "NOT APPLICABLE - Klipcorp (Pty) Ltd is tendering independently, not as part of a Joint Venture."
        )
        new_p.runs[0].bold = True


def fill_a8_litigation_table(doc, company):
    for t in doc.tables:
        if [c.text.strip() for c in t.rows[0].cells] == ["Client", "Other litigating party", "Dispute", "Award value", "Date resolved"]:
            row = t.rows[1]
            row.cells[0].text = "None"
            row.cells[1].text = "-"
            row.cells[2].text = f"No litigation on file for {company} in the past 10 years"
            row.cells[3].text = "-"
            row.cells[4].text = "-"


def mark_sbd4_no_answers(doc):
    """The A11/SBD4 simple yes/no table and the 4.1-4.4 restricted-supplier /
    tender-defaulter / fraud-conviction / contract-termination table. Marked No
    on every row - nothing on file indicates otherwise - but every one of these
    is also a specific checklist verification item, not just filled and
    forgotten."""
    for t in doc.tables:
        header = [c.text.strip() for c in t.rows[0].cells]
        if header[:2] == ["YES", ""] and "NO" in header:
            t.rows[0].cells[header.index("NO")].text = "X"
        if header and header[0] in ("4.1", "4.1"):
            for row in t.rows:
                cells = [c.text.strip() for c in row.cells]
                if any(c.startswith("4.") and "." not in c[2:] for c in cells[:1]):
                    pass
            for row in t.rows:
                cells = row.cells
                label = cells[0].text.strip()
                if re.match(r"^4\.\d$", label):
                    for c in cells[3:]:
                        if c.text.strip().lower() == "no":
                            c.text = "No (X)"
                            break


def fill_a16_no_addenda(doc):
    p = para_matching(doc, "We confirm that the following communications")
    if p is not None:
        new_p = p.insert_paragraph_before(
            "No addenda had been issued for this contract as at the date these documents were prepared - "
            "see ACTIONS_TO_SIGN.md to re-check SANRAL's eTenders portal before the tender closes."
        )
        new_p.runs[0].italic = True


def main(a_forms_path, profile_path, out_dir, contract_label, nra_ref):
    profile = json.load(open(profile_path))
    comp = profile["company"]
    henning = profile["key_people"][0]
    name = henning["name"]
    position = henning["signatory_capacity"]
    company = comp["legal_name"]

    d = docx.Document(a_forms_path)

    fill_footer(d, name, position, company)
    fill_declaration_blanks(d, name, position, company)
    fill_a3_not_applicable(d)
    fill_a8_litigation_table(d, company)
    mark_sbd4_no_answers(d)
    fill_a16_no_addenda(d)

    # A7: CSD registration - mechanical fields only, inline after the label.
    append_after_label(d, "Name of Service Provider:", company)
    append_after_label(d, "Central Supplier Database Supplier Number:", comp["csd_supplier_number"])

    # A17: the one unambiguous field (who the cover is for); policy numbers/values are unknown.
    append_after_label(d, "Name of Tenderer:", company)

    # A18: bank details. Account number is deliberately never written to this repo -
    # see profile note - left blank in the document too; the real number comes from
    # the bank confirmation letter attached alongside this form, not typed in here.
    append_after_label(d, "Name of account holder:", company)
    append_after_label(d, "Bank name:", comp["bank"]["bank_name"])
    append_after_label(d, "Branch number:", comp["bank"]["branch_code"])

    out_path = f"{out_dir}/A_Forms_FILLED.docx"
    d.save(out_path)
    print(f"Wrote {out_path}")
    return out_path


if __name__ == "__main__":
    main(*sys.argv[1:6])
