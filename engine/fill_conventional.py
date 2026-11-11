"""
Usage:  python fill_conventional.py <SANRAL Conventional Consultant .xlsm> <pack.yaml> <output.xlsm>

Fills SANRAL's "Conventional Consultant Tender" technical-submission template.
This is a DIFFERENT template family from the "RRM Consultant Tender" template
(fill_tender.py) - fewer sheets (9 vs 15) and a single C2.4 summary sheet (not six
per-contract sheets). The TEND 1X key-person block layout, date triplets and
Form B3/B7 cells turned out to be IDENTICAL to the RRM template. Inputs are the
UNLOCKED, non-formula cells (not only the yellow ones: BEE level K33/L33 and the
Form B7 targeted-enterprise cells are unlocked but not yellow).
"""
import sys, yaml, datetime
import sanral_b7
from sanral_fill import Workbook, split, n2col, col2n, set_dropdown_for, projects_for_block, fill_company_front, _log

T = "TEND 1X"

# Offsets inside one Form B1/B2 key-person block, relative to the block's first
# row (row 37 for slot 1, 137 for slot 2, ... every 100 rows).
#
# The visible G/H "experience started/ended" and D/F/M qualification-date cells
# (same formula chains as the RRM template) are NOT the real inputs - each is a formula that chains through several
# helper columns (Z/Y/V-X/S-T) back to a genuine Year/Month/Day dropdown
# triplet in columns P/Q/R on a specific row. Confirmed by tracing every
# formula by hand against this template's own cells, not assumed from RRM.
# The resulting offsets happen to match the RRM template's exactly.
B = dict(name="B4", id="E4", description="I4",
         proj_first=10, proj_end_first=15, max_projects=3,
         employment="H35", ecsa_level="D39", ecsa_number="D40", ecsa_date="P40",
         sacpcmp_number="F40", sacpcmp_date="P41",
         highest_qual="H39", highest_desc="J39", highest_inst="L39", highest_date="P38",
         years_exp="H41", initial_desc="J41", initial_inst="L41", initial_date="P39")

def at(spec, base):
    col, off = split(spec)
    return f"{col}{base + off}"

def blocks_for(wb, code):
    """SANRAL puts the required positions on SETUP row 6 (cols B..U). Returns
    every matching slot's Form B1/B2 block start row (row 37 for slot 1, ...)."""
    bases = []
    for p in range(20):
        if str(wb.cached("SETUP", f"{n2col(2+p)}6") or "").strip() == code:
            base = 37 + 100 * p
            if wb._cell_el(T, f"B{base}") is None:
                raise ValueError(f"Position {code} (slot {p+1}) has no Form B1 block in this template")
            bases.append(base)
    if not bases:
        raise ValueError(f"Position '{code}' is not listed on this tender's SETUP sheet")
    return bases

def b7_closing_date_note(close, b7):
    """Form B7's own pre-filled closing date (TEND 1X!F125, label 'Tender
    Closing date:' right beside 'B7 Info:') vs the SETUP sheet's own closing
    date (SETUP!C3) - SANRAL ships both independently on every new template,
    and they can disagree. fill_tender.py's own tender_check_notes() already
    found and fixed this exact check for the RRM Consultant Tender family
    (Finding 114, 2026-11-01) - this template family's own docstring states
    the Form B3/B7 cells "turned out to be IDENTICAL to the RRM template",
    confirmed directly against the real committed sample
    (templates/samples/R.334-030-2025.1F_ran.xlsm: TEND 1X!F125 is the same
    'Tender Closing date:' serial as SETUP!C3) - but the matching check was
    never ported to this sibling, so the identical real-world mismatch risk
    went completely unwarned for every Conventional Consultant Tender pack.
    Returns a list (0 or 1 note), the same shape tender_check_notes() uses,
    so main() can extend its own `notes` with it directly."""
    notes = []
    if close != b7:
        notes.append(f"Form B7 closing date ({b7}) differs from the SETUP sheet's own closing date ({close}) - "
                     "check which is correct before relying on this.")
    return notes


def fill_person(wb, base, person, projects_lib, slot=None, log=None):
    """Fills one Form B1/B2 block. Returns notes (projects left off this block
    because this position's form doesn't offer their project type - see
    sanral_fill.projects_for_block)."""
    wb.set_value(T, at(B["name"], base), person["name"])
    # Written as text, not int(): SA ID numbers routinely start with 0 (anyone born
    # 2000 or later), and int() silently drops leading zeros - confirmed as a real
    # defect 2026-10-15 by rendering a sample PDF: the template itself prints "ID
    # NUMBER SHOULD BE 13 DIGITS" right next to the field, and a leading-zero ID
    # written via int() would visibly fail that on a real submission.
    wb.set_value(T, at(B["id"], base), str(person["id_number"]))
    wb.set_value(T, at(B["description"], base), person.get("description", ""))
    projs = [projects_lib[p] if isinstance(p, str) else p for p in person["projects"]]
    projs, notes = projects_for_block(wb, T, base + B["proj_first"], person["name"], projs, B["max_projects"], slot)
    for i, pr in enumerate(projs):
        r = base + B["proj_first"] + i
        wb.set_value(T, f"B{r}", pr["client_and_number"])
        proj = f"{person['name']}, project '{str(pr.get('client_and_number') or '').replace(chr(10), ' / ')}'"
        set_dropdown_for(wb, T, f"C{r}", pr["client_type"], proj, "client type")
        set_dropdown_for(wb, T, f"F{r}", pr["project_type"], proj, "project type")
        wb.set_date(T, f"P{r}", pr["start"])
        wb.set_date(T, f"P{base + B['proj_end_first'] + i}", pr["end"])
        wb.set_value(T, f"I{r}", pr["value_rm"])
        wb.set_value(T, f"J{r}", pr["position_held"])
        set_dropdown_for(wb, T, f"K{r}", pr["position_code"], proj, "position held (code)")
        wb.set_value(T, f"L{r}", pr["contact"])
        wb.set_value(T, f"M{r}", pr["contact_number"])
    q = person["qualifications"]
    who = person["name"]
    set_dropdown_for(wb, T, at(B["employment"], base), person["employment"], who, "employment type")
    if "employment_status" in person and not person["employment_status"]:
        notes.append(f"{who}: Form B1 declares them a full-time employee of the tenderer - not recorded on their "
                     "People page (employment status); confirm before signing, SANRAL's minimums require permanent "
                     "employment for several key positions.")
    set_dropdown_for(wb, T, at(B["ecsa_level"], base), q["ecsa_level"], who, "ECSA registration level")
    # ecsa_number/ecsa_date/sacpcmp_number/sacpcmp_date are the one group of
    # fields in this function that were conditionally written (`if q.get(...)`)
    # with NO log call in either branch - unlike every other optional field
    # this pipeline fills (sanral_fill.fill_company_front's own bee_level/
    # black_ownership_pct two-way `_log()` above, or the already-fixed SARS
    # TCS PIN/VAT-number siblings in fill_a_forms.py/fill_sbd_docx.py). A key
    # person with no ECSA/SACPCMP number or date on file silently got a blank
    # Form B1/B2 cell with zero trace in field_provenance.json, so
    # ACTIONS_TO_SIGN.md never told anyone to go fill it in before signing.
    # Identical gap and fix to fill_tender.py's own sibling. QA pass,
    # 2026-11-11 (Finding 376).
    if q.get("ecsa_number"):
        wb.set_value(T, at(B["ecsa_number"], base), q["ecsa_number"])
        _log(log, "confirmed", f"tend1x.{slot}.ecsa_number", q["ecsa_number"])
    else:
        _log(log, "missing", f"tend1x.{slot}.ecsa_number",
             reason=f"{who}: no ECSA registration number on file - Form B1/B2's own cell was left blank.")
    if q.get("ecsa_date"):
        wb.set_date(T, at(B["ecsa_date"], base), q["ecsa_date"])
        _log(log, "confirmed", f"tend1x.{slot}.ecsa_date", q["ecsa_date"])
    else:
        _log(log, "missing", f"tend1x.{slot}.ecsa_date",
             reason=f"{who}: no ECSA registration date on file - Form B1/B2's own cell was left blank.")
    if q.get("sacpcmp_number"):
        wb.set_value(T, at(B["sacpcmp_number"], base), q["sacpcmp_number"])
        _log(log, "confirmed", f"tend1x.{slot}.sacpcmp_number", q["sacpcmp_number"])
    else:
        _log(log, "missing", f"tend1x.{slot}.sacpcmp_number",
             reason=f"{who}: no SACPCMP registration number on file - Form B1/B2's own cell was left blank.")
    if q.get("sacpcmp_date"):
        wb.set_date(T, at(B["sacpcmp_date"], base), q["sacpcmp_date"])
        _log(log, "confirmed", f"tend1x.{slot}.sacpcmp_date", q["sacpcmp_date"])
    else:
        _log(log, "missing", f"tend1x.{slot}.sacpcmp_date",
             reason=f"{who}: no SACPCMP registration date on file - Form B1/B2's own cell was left blank.")
    set_dropdown_for(wb, T, at(B["highest_qual"], base), q["highest_level"], who, "highest qualification level")
    # highest_description/highest_institution/highest_graduated and their
    # initial_* siblings are independently-nullable columns (0001_init_schema.sql
    # - confirmed no check constraint ties any of them to highest_level, and the
    # People page's own form, app/app/people/[id]/page.tsx, never marks any of
    # these six inputs `required`) - unlike confirm_pack.py's own hard-stop on
    # initial_graduated (needed to compute years_experience), NONE of these six
    # is validated anywhere before reaching this function. Until this fix,
    # `highest_graduated`/`initial_graduated` were passed straight into
    # wb.set_date(), which calls `.year` on whatever it's given with no None
    # guard - a key person with no highest-qualification graduation date on
    # file crashed the entire pack-generation job with a raw
    # AttributeError: 'NoneType' object has no attribute 'year', not a clean,
    # actionable refusal (confirmed reachable: process_pack_jobs.py's own
    # generic `except Exception` catches it, but Sarel sees an opaque crash,
    # not "no graduation date on file"). The four text siblings didn't crash
    # (wb.set_value() already tolerates None), but like the already-fixed
    # ecsa_number/ecsa_date/sacpcmp_number/sacpcmp_date gap two lines above
    # (Finding 376), they were written with NO log call in either branch - a
    # genuinely missing value left zero trace in field_provenance.json, so
    # ACTIONS_TO_SIGN.md never flagged it. Identical gap and fix to
    # fill_tender.py's own sibling. QA pass, 2026-11-11 (Finding 388).
    if q.get("highest_description"):
        wb.set_value(T, at(B["highest_desc"], base), q["highest_description"])
        _log(log, "confirmed", f"tend1x.{slot}.highest_description", q["highest_description"])
    else:
        _log(log, "missing", f"tend1x.{slot}.highest_description",
             reason=f"{who}: no highest qualification description on file - Form B1/B2's own cell was left blank.")
    if q.get("highest_institution"):
        wb.set_value(T, at(B["highest_inst"], base), q["highest_institution"])
        _log(log, "confirmed", f"tend1x.{slot}.highest_institution", q["highest_institution"])
    else:
        _log(log, "missing", f"tend1x.{slot}.highest_institution",
             reason=f"{who}: no highest qualification institution on file - Form B1/B2's own cell was left blank.")
    if q.get("highest_graduated"):
        wb.set_date(T, at(B["highest_date"], base), q["highest_graduated"])
        _log(log, "confirmed", f"tend1x.{slot}.highest_graduated", q["highest_graduated"])
    else:
        _log(log, "missing", f"tend1x.{slot}.highest_graduated",
             reason=f"{who}: no highest qualification graduation date on file - Form B1/B2's own cell was left blank.")
    set_dropdown_for(wb, T, at(B["years_exp"], base),
                     None if q.get("years_experience") is None else str(q["years_experience"]), who, "years of experience")
    if q.get("initial_description"):
        wb.set_value(T, at(B["initial_desc"], base), q["initial_description"])
        _log(log, "confirmed", f"tend1x.{slot}.initial_description", q["initial_description"])
    else:
        _log(log, "missing", f"tend1x.{slot}.initial_description",
             reason=f"{who}: no initial qualification description on file - Form B1/B2's own cell was left blank.")
    if q.get("initial_institution"):
        wb.set_value(T, at(B["initial_inst"], base), q["initial_institution"])
        _log(log, "confirmed", f"tend1x.{slot}.initial_institution", q["initial_institution"])
    else:
        _log(log, "missing", f"tend1x.{slot}.initial_institution",
             reason=f"{who}: no initial qualification institution on file - Form B1/B2's own cell was left blank.")
    if q.get("initial_graduated"):
        wb.set_date(T, at(B["initial_date"], base), q["initial_graduated"])
        _log(log, "confirmed", f"tend1x.{slot}.initial_graduated", q["initial_graduated"])
    else:
        _log(log, "missing", f"tend1x.{slot}.initial_graduated",
             reason=f"{who}: no initial qualification graduation date on file - Form B1/B2's own cell was left blank.")
    return notes

def main(tpl, pack_path, out, log=None):
    pack = yaml.safe_load(open(pack_path))
    wb = Workbook(tpl)
    co, td = pack["company"], pack["tender"]

    # Company front page + Form B3 company block. K33 (BEE level, validation
    # whole 1-9) and L33 (black ownership %) are unlocked inputs although not
    # yellow; SANRAL ships K33 = 9. Only values on file are written - see
    # sanral_fill.fill_company_front for what is left as shipped and noted.
    front_notes = fill_company_front(wb, co, td.get("closing_date"), log, T)

    # C2.4 summary: this template carries only the two totals (no value/category
    # fields exist here - the full C2.4 lives in the separate Financial workbook).
    c24 = td.get("c2_4")
    if c24:
        wb.set_value("FORM C2.4 TECH", "E10", c24["hours_tendered"])
        wb.set_value("FORM C2.4 TECH", "E11", c24["normalised_hours"])
    else:
        print("NOTE: no C2.4 figures in this pack yet - FORM C2.4 TECH left exactly as SANRAL shipped it")

    # Form B7 (same cells as the RRM template): the company's own captured
    # subcontracting plan (sanral_b7.py, Tender Workspace), else the legacy
    # single hand-written `targeted_enterprise` block of a CLI pack.yaml.
    # An EXPLICIT plan of any mode - including "waived_by_tender" - must win
    # over the legacy block, not just a "subcontract" one: see fill_tender.py's
    # identical sibling fix for the full explanation (same bug, same cells,
    # same fix). QA pass, 2026-10-26.
    te = td.get("targeted_enterprise")
    if (td.get("subcontracting_plan") or {}).get("mode") == "subcontract":
        n = sanral_b7.fill_b7(wb, td["subcontracting_plan"])
        print(f"Form B7: {n} Targeted Enterprise(s) from the company's subcontracting plan")
    elif te and not td.get("subcontracting_plan"):
        wb.set_value(T, "C3906", te["name"]); wb.set_value(T, "J3906", te["status"])
        wb.set_value(T, "M3906", te["pct_of_contract"]); wb.set_value(T, "D3908", te["black_ownership"])
        wb.set_value(T, "H3908", te["bee_level"]); wb.set_value(T, "M3908", te["pct_excl_provisional"])

    if td.get("overrides"):
        raise ValueError("Tender pack must not override SANRAL's SETUP details - "
                         "they come pre-filled in each new template")
    serial = lambda v: (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))) if isinstance(v, (int, float)) else v
    close, b7 = serial(wb.cached("SETUP", "C3")), serial(wb.cached(T, "F125"))
    print("Tender (from SANRAL template): contract", wb.cached("SETUP", "C2"), "| closes", close)
    extra_notes = b7_closing_date_note(close, b7)
    if close != b7:
        print(f"WARNING: Form B7 closing date {b7} differs from SETUP closing date {close}")

    # Key persons
    notes = list(front_notes) + extra_notes
    for a in pack["key_persons"]:
        person_key = a.get("person")
        person = (pack.get("people") or {}).get(person_key)
        if person is None:
            # Same malformed-pack shape fill_financial.py (2026-11-05) was just
            # fixed for: a raw pack["people"][...] KeyError here crashes the
            # whole SANRAL pack job (no caller around FILLERS[family].main()
            # in assemble_pack.py catches ValueError the way fill_financial.py's
            # own caller does - process_pack_jobs.py's generic except Exception
            # stops the worker crashing, but with an unhelpful raw KeyError
            # instead of this clean, actionable message).
            raise ValueError(
                f"key_persons entry for position '{a.get('position')}' references person '{person_key}', which "
                "has no entry in pack.yaml's own people map - fill the name in by hand"
            )
        bases = [a["block_row"]] if a.get("block_row") else blocks_for(wb, a["position"])
        for base in bases:
            notes += fill_person(wb, base, person, pack.get("projects", {}), a.get("position"), log)
    notes = list(dict.fromkeys(notes))  # an ALT slot repeats its primary's block notes

    wb.save(out)
    print(f"Wrote {out}: {len(wb.log)} cell writes")
    for n in notes:
        print(f"NOTE: {n}")
    return notes

if __name__ == "__main__":
    main(*sys.argv[1:4])
