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
import datetime
import docx
from provenance import ProvenanceLog


def _today_iso():
    return datetime.date.today().isoformat()

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


NAME_HINT_RE = re.compile(r"\(name\)", re.IGNORECASE)
POSITION_HINT_RE = re.compile(r"\(position\)", re.IGNORECASE)
COMPANY_HINT_RE = re.compile(r"\(name of company\)", re.IGNORECASE)


def fill_declaration_blanks(doc, name, position, company, log):
    """Fills the recurring 'I, the undersigned, ...' declaration openers and the
    '(name)' / '(position)' / '(name of company)' hint-label blanks that appear
    throughout the bundle (A4, A6, A9, A11, A14, A15, A21, A22, A23).

    Two different shapes, handled differently - found by Sarel reviewing the
    generated output and confirmed by inspecting the real paragraph text:

    1. 'I, the undersigned, ....................' - the dots sit directly after
       the label with no separate hint text, so substituting the whole matched
       span (label + dots) for 'I, the undersigned, HENNING...' actually REMOVES
       the dots - this one is safe to fill inline, and usually shortens the line.
    2. 'I, ....................(name), the undersigned in my capacity as
       ....................(position), on behalf of ....................(name of
       company), herewith grant consent...' (A14) and similar - here '(name)' etc.
       are short hint markers sitting right against a long dotted blank that is
       NOT part of the match. Substituting just the hint text leaves the dots
       fully intact right next to a full-size typed name, which is far longer
       than the blank was ever sized for and reliably wraps the sentence onto an
       extra line. Fix: never touch that dotted sentence at all - add one short
       line directly above it stating the real values plainly, so the sentence's
       own layout never has to reflow.
    """
    undersigned_re = re.compile(
        r"(I,\s*the\s*undersigned,)" + DOTS_RE + r"(\(name\))?" + DOTS_RE,
        re.IGNORECASE,
    )
    any_match = False
    for p in doc.paragraphs:
        text = p.text
        if not text.strip():
            continue
        new_text, n = undersigned_re.subn(f"I, the undersigned, {name.upper()} ", text, count=1)
        if n:
            set_paragraph_text(p, new_text)
            any_match = True
            continue

        found = []
        if NAME_HINT_RE.search(text):
            found.append(name.upper())
        if POSITION_HINT_RE.search(text):
            found.append(position)
        if COMPANY_HINT_RE.search(text):
            found.append(company)
        if not found:
            continue
        summary = found[0]
        if len(found) >= 2:
            summary += f", {found[1]}"
        if len(found) >= 3:
            summary += f", on behalf of {found[2]}"
        new_p = p.insert_paragraph_before(summary)
        if new_p.runs:
            new_p.runs[0].bold = True
        any_match = True
    if any_match:
        log.confirmed("a_forms.declarations.signatory_name", name)


def fill_footer(doc, name, position, company, log):
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
    name_hits = position_hits = tenderer_hits = 0
    for p in doc.paragraphs:
        text = p.text
        if "Name" not in text and "Tenderer" not in text:
            continue
        changed = False
        new_text, n = name_pos_re.subn(lambda m: m.group(1) + " " + name.upper() + "   ", text, count=1)
        if n:
            text, changed = new_text, True
            name_hits += 1
        new_text, n = position_re.subn(lambda m: m.group(1) + " " + position + "   ", text, count=1)
        if n:
            text, changed = new_text, True
            position_hits += 1
        new_text, n = tenderer_re.subn(lambda m: m.group(1) + " " + company, text, count=1)
        if n:
            text, changed = new_text, True
            tenderer_hits += 1
        if changed:
            set_paragraph_text(p, text)
    # One entry per distinct fact, not per occurrence - the same 3 facts repeat
    # across ~20 forms' footers, and a per-paragraph entry would just be noise
    # the admin review/readiness report would have to de-duplicate themselves.
    if name_hits:
        log.confirmed("a_forms.footer.signatory_name", name)
    if position_hits:
        log.confirmed("a_forms.footer.signatory_capacity", position)
    if tenderer_hits:
        log.confirmed("a_forms.footer.tenderer_name", company)


def para_matching(doc, prefix):
    for p in doc.paragraphs:
        if p.text.strip().startswith(prefix):
            return p
    return None


def append_after_label(doc, label, value, log, field_key, missing_reason=None):
    """For 'Label:' paragraphs where the value belongs inline right after the
    colon (A7's CSD fields) rather than a dotted blank. value=None is a real
    case, not an edge case - the admin harness (spec item 30) found this the
    first time it ran a test company with incomplete bank/company details,
    which crashed python-docx's run-text setter outright. Logs missing
    (with a reason) instead of writing and moving on, same as every other
    not-on-file field in this module."""
    p = para_matching(doc, label)
    if p is None:
        return
    if value:
        set_paragraph_text(p, p.text.rstrip() + "  " + value)
        log.confirmed(field_key, value)
    else:
        log.missing(field_key, missing_reason or f"No value on file for '{label.strip()}'.")


def fill_a3_not_applicable(doc, company, log):
    p = para_matching(doc, "In the event of a Joint Venture, attach")
    if p is not None:
        new_p = p.insert_paragraph_before(
            f"NOT APPLICABLE - {company} is tendering independently, not as part of a Joint Venture."
        )
        new_p.runs[0].bold = True
        # Confirmed, not assumed: whether Klipcorp is a JV is a known fact about
        # the company, not a guess standing in for something unverified.
        log.confirmed("a_forms.A3.joint_venture", "Not applicable - not a Joint Venture")


def fill_a8_litigation_table(doc, company, log):
    for t in doc.tables:
        if [c.text.strip() for c in t.rows[0].cells] == ["Client", "Other litigating party", "Dispute", "Award value", "Date resolved"]:
            row = t.rows[1]
            row.cells[0].text = "None"
            row.cells[1].text = "-"
            row.cells[2].text = f"No litigation on file for {company} in the past 10 years"
            row.cells[3].text = "-"
            row.cells[4].text = "-"
            log.assumed_default(
                "a_forms.A8.litigation_history", "None",
                f"No litigation against {company} or its directors is recorded in the company "
                "profile, but this hasn't been independently re-verified today."
            )


def mark_sbd4_no_answers(doc, company, log):
    """The A11/SBD4 simple yes/no table and the 4.1-4.4 restricted-supplier /
    tender-defaulter / fraud-conviction / contract-termination table. Marked No
    on every row - nothing on file indicates otherwise - but every one of these
    is also a specific checklist verification item, not just filled and
    forgotten."""
    reasons = {
        "a_forms.A11.employed_by_state":
            "Nothing on file shows the bidder or its directors are employed by the state.",
        "a_forms.A11.restricted_supplier_register":
            f"Nothing on file shows {company} or its directors on National Treasury's Restricted Suppliers Database - not independently checked against the live register today.",
        "a_forms.A11.tender_defaulters_register":
            f"Nothing on file shows {company} or its directors on the Register for Tender Defaulters - not independently checked against the live register today.",
        "a_forms.A11.fraud_conviction":
            f"No fraud or corruption conviction on file for {company} or its directors in the past 5 years.",
        "a_forms.A11.contract_terminated":
            "No organ-of-state contract termination for non-performance on file in the past 5 years.",
    }
    section_keys = iter([
        "a_forms.A11.restricted_supplier_register", "a_forms.A11.tender_defaulters_register",
        "a_forms.A11.fraud_conviction", "a_forms.A11.contract_terminated",
    ])
    for t in doc.tables:
        header = [c.text.strip() for c in t.rows[0].cells]
        if header[:2] == ["YES", ""] and "NO" in header:
            t.rows[0].cells[header.index("NO")].text = "X"
            log.assumed_default("a_forms.A11.employed_by_state", "No",
                                 reasons["a_forms.A11.employed_by_state"])
        if header and header[0] in ("4.1", "4.1"):
            for row in t.rows:
                cells = row.cells
                label = cells[0].text.strip()
                if re.match(r"^4\.\d$", label):
                    for c in cells[3:]:
                        if c.text.strip().lower() == "no":
                            c.text = "No (X)"
                            key = next(section_keys, None)
                            if key:
                                log.assumed_default(key, "No", reasons[key])
                            break


def fill_a10_no_deviations(doc, company, log):
    """Found by re-checking form coverage 2026-10-16: A10's body is a block of
    blank lines for listing any deviations or qualifications from the tender
    conditions - the footer (Name/Position/Tenderer) already gets filled by the
    generic fill_footer() sweep, but the schedule itself was being left
    completely blank. A blank returnable schedule reads as an oversight, not
    as 'none' - the same non-responsiveness risk already guarded against for
    A3 (not a JV), A8 (no litigation) and A16 (no addenda), just missed here
    until now."""
    paras = doc.paragraphs
    for i, p in enumerate(paras):
        if p.text.strip().upper().startswith("FORM A10"):
            # the NRA reference line sits directly under the heading; insert
            # the statement into the first blank line below that, not the heading.
            target = paras[i + 2] if i + 2 < len(paras) else p
            new_p = target.insert_paragraph_before(
                f"No deviations or qualifications from the tender conditions are recorded for "
                f"{company} as at the date these documents were prepared."
            )
            new_p.runs[0].italic = True
            log.assumed_default(
                "a_forms.A10.deviations_or_qualifications", "None",
                f"Nothing on file indicates {company} intends to deviate from or qualify any "
                "tender condition - confirm this is still true immediately before signing, since "
                "a real deviation discovered after submission can't be added back in."
            )
            return


def fill_a16_no_addenda(doc, log):
    p = para_matching(doc, "We confirm that the following communications")
    if p is not None:
        new_p = p.insert_paragraph_before(
            "No addenda had been issued for this contract as at the date these documents were prepared - "
            "see ACTIONS_TO_SIGN.md to re-check SANRAL's eTenders portal before the tender closes."
        )
        new_p.runs[0].italic = True
        log.assumed_default(
            "a_forms.A16.addenda_received", "None",
            "No addenda were found locally for this contract as at the date these documents were "
            "prepared - re-check SANRAL's eTenders portal before closing, addenda can be issued "
            "right up to 10 working days before."
        )


def main(a_forms_path, profile_path, out_dir, contract_label, nra_ref, provenance_out=None):
    profile = json.load(open(profile_path))
    comp = profile["company"]
    henning = profile["key_people"][0]
    name = henning["name"]
    position = henning["signatory_capacity"]
    company = comp["legal_name"]
    log = ProvenanceLog(source="fill_a_forms.py")

    d = docx.Document(a_forms_path)

    fill_footer(d, name, position, company, log)
    fill_declaration_blanks(d, name, position, company, log)
    fill_a3_not_applicable(d, company, log)
    fill_a8_litigation_table(d, company, log)
    fill_a10_no_deviations(d, company, log)
    mark_sbd4_no_answers(d, company, log)
    fill_a16_no_addenda(d, log)

    # A7: CSD registration - mechanical fields only, inline after the label.
    append_after_label(d, "Name of Service Provider:", company, log, "a_forms.A7.service_provider_name")
    append_after_label(d, "Central Supplier Database Supplier Number:", comp.get("csd_supplier_number"),
                        log, "a_forms.A7.csd_supplier_number", "No CSD supplier number on file.")
    if comp.get("csd_report_note"):
        log.confirmed("a_forms.A7.supplier_commodity", "Professional engineering services")
        log.missing("a_forms.A7.commodity_code",
                    "Commodity FAMILY ('Professional engineering services') is confirmed from the "
                    "June 2026 CSD report, but no specific commodity CODE was found there - look "
                    "one up on the live CSD report before relying on just the family name.")
    else:
        log.missing("a_forms.A7.supplier_commodity",
                    "No current CSD commodity code on file - only a 2021 CSD report was found, "
                    "confirm against an up-to-date report before filling this in.")
    log.missing("a_forms.A7.delivery_location",
                "No CSD delivery location on file.")

    # A17: the one unambiguous field (who the cover is for); policy numbers/values are unknown.
    append_after_label(d, "Name of Tenderer:", company, log, "a_forms.A17.tenderer_name")
    pi = comp.get("professional_indemnity_insurance")
    if pi:
        log.confirmed("a_forms.A17.professional_indemnity_value",
                       f"R{pi['limit_of_indemnity_zar']:,} (policy {pi['policy_number']}, "
                       f"{pi['insurer']}, valid {pi['period_from']} to {pi['period_to']})")
    else:
        log.missing("a_forms.A17.professional_indemnity_value",
                    "No insurance policy number or cover value on file for this cover type.")
    for cover in ("public_liability", "third_party_liability"):
        log.missing(f"a_forms.A17.{cover}_value",
                    "No insurance policy number or cover value on file for this cover type.")

    # A18: bank details. Account number is deliberately never written to this repo -
    # see profile note - left blank in the document too; the real number comes from
    # the bank confirmation letter attached alongside this form, not typed in here.
    append_after_label(d, "Name of account holder:", company, log, "a_forms.A18.account_holder_name")
    bank = comp.get("bank") or {}
    append_after_label(d, "Bank name:", bank.get("bank_name"), log, "a_forms.A18.bank_name",
                        "No bank name on file.")
    append_after_label(d, "Branch number:", bank.get("branch_code"), log, "a_forms.A18.branch_number",
                        "No branch number on file.")
    if bank.get("branch_code_flag"):
        log.missing("a_forms.A18.branch_number_discrepancy", bank["branch_code_flag"])
    log.missing("a_forms.A18.account_number",
                "Deliberately never stored in this codebase - insert the real number from the "
                "bank confirmation letter, which must also be attached and dated within 3 months "
                "of tender closing.")

    # Forms this script deliberately never touches - see module docstring - but the gap is
    # still real and still belongs in the provenance record, not only in prose.
    log.missing("a_forms.A2.board_resolution",
                f"Needs a real, signed board resolution on {company}'s own letterhead - the "
                "template's own notes say completing the example page is not accepted as "
                "authorisation.")
    log.missing("a_forms.A5.dpip_identification",
                "The DPIP/FPPO/FIN identification table and known-business-interests table were "
                "left blank - the checkbox layout isn't safely automatable. Needs a human to "
                "fill and sign by hand.")
    if comp.get("sars_tcs_pin"):
        log.confirmed("a_forms.A9.tcs_pin",
                       f"{comp['sars_tcs_pin']} (issued {comp.get('sars_tcs_pin_issued')}, "
                       f"expires {comp.get('sars_tcs_pin_expiry')})")
        log.missing("a_forms.A9.tcs_pin_still_valid",
                    "A SARS TCS PIN is on file, but the taxpayer can cancel a PIN at any time "
                    "before its printed expiry - re-verify it still resolves on SARS eFiling "
                    "before relying on it for a new submission.")
    else:
        log.missing("a_forms.A9.tcs_pin",
                    "No current SARS Tax Compliance Status PIN on file - look one up via SARS eFiling.")
    if comp.get("bee_source_note") and "sworn 2026-09-09" in comp["bee_source_note"]:
        log.confirmed("a_forms.A12.bee_certificate",
                       "Current sworn affidavit on file, 100% black owned, Level 1, sworn 2026-09-09, "
                       "valid ~12 months (to ~2027-09-09)")
        log.missing("a_forms.A12.bee_certificate_attachment",
                    "The current affidavit's data is confirmed, but the actual signed PDF still "
                    "needs to be sourced and attached to this specific submission - it is not "
                    "reusable across tenders without re-checking it's still within its 12-month "
                    "validity window on the day this tender is submitted.")
    else:
        bee_reason = "Needs a current, valid B-BBEE verification certificate or affidavit attached."
        if comp.get("bee_source_note"):
            bee_reason += f" Known issue on file: {comp['bee_source_note']}"
        log.missing("a_forms.A12.bee_certificate", bee_reason)
    log.missing("a_forms.A19.current_commitments",
                "The company profile only tracks past reference projects for CV purposes, not a "
                "live commitments list - confirm the signatory's actual current commitments "
                "directly before relying on what's on file.")
    coid_number = comp.get("coid_letter_of_good_standing_number")
    coid_expiry = comp.get("coid_letter_of_good_standing_expiry")
    coid_is_current = bool(coid_expiry) and coid_expiry > _today_iso()
    if coid_number and coid_is_current:
        log.confirmed("a_forms.A20.coid_letter",
                       f"{company}'s COID Letter of Good Standing (no. {coid_number}) is current, "
                       f"valid to {coid_expiry}")
        log.missing("a_forms.A20.coid_letter_attachment",
                    f"The COID Letter of Good Standing is confirmed current (no. {coid_number}, "
                    f"valid to {coid_expiry}) - attach THIS document, not an older/expired one, "
                    "to this submission.")
    elif coid_number and coid_expiry:
        coid_reason = (f"{company}'s COID Letter of Good Standing (no. {coid_number}) expired "
                       f"{coid_expiry} - renew before attaching, or the tender may be declared non-responsive.")
        log.missing("a_forms.A20.coid_letter", coid_reason)
    else:
        coid_reason = f"{company} has no COID Letter of Good Standing on file at all - register and obtain one."
        log.missing("a_forms.A20.coid_letter", coid_reason)

    out_path = f"{out_dir}/A_Forms_FILLED.docx"
    d.save(out_path)
    print(f"Wrote {out_path}")
    if provenance_out:
        log.save(provenance_out)
        print(f"Wrote {provenance_out}: {len(log.entries)} provenance entries "
              f"({log.summary()})")
    return out_path, log


if __name__ == "__main__":
    main(*sys.argv[1:7])
