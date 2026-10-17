"""
Usage:  python fill_tender.py <SANRAL template.xlsm> <tender_pack.yaml> <output.xlsm>

The tender pack holds everything the tenderer types in. People and projects live
in a reusable library section, so the next tender only needs a new
'tender' block and a new 'key_persons' assignment list.
"""
import sys, yaml, datetime
from sanral_fill import Workbook, split, n2col, col2n, set_dropdown_for

T = "TEND 1X"

# Offsets inside one Form B1/B2 key-person block, relative to the block's first
# row  row 37 for position 1, 137 for position 2, ... every 100 rows).
B = dict(name="B4", id="E4", description="I4",
         proj_first=10, proj_end_first=15, max_projects=3,
         employment="H35", ecsa_level="D39", ecsa_number="D40", ecsa_date="P40",
         sacpcmp_date="P41", highest_qual="H39", highest_desc="J39",
         highest_inst="L39", highest_date="P38", years_exp="H41",
         initial_desc="J41", initial_inst="L41", initial_date="P39")

def at(spec, base):
    col, off = split(spec)
    return f"{col}{base + off}"

def blocks_for(wb, code):
    """SANRAL puts the required positions on SETUP row 6 (cols B..U), one column
    per slot - a 'combined tender' can list the same code (e.g. CE1) more than
    once, once per contract bundled into the submission. Returns every matching
    slot's Form B1/B2 block start row (row 37 for slot 1, 137 for slot 2, ...)."""
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

def fill_person(wb, base, person, projects_lib):
    wb.set_value(T, at(B["name"], base), person["name"])
    # Written as text, not int(): see fill_conventional.py for why - int() silently
    # drops a leading zero, which a real SA ID number can start with.
    wb.set_value(T, at(B["id"], base), str(person["id_number"]))
    wb.set_value(T, at(B["description"], base), person.get("description", ""))
    projs = [projects_lib[p] if isinstance(p, str) else p for p in person["projects"]]
    if len(projs) > B["max_projects"]:
        raise ValueError(f"{person['name']}: form accepts {B['max_projects']} projects")
    for i, pr in enumerate(projs):
        r = base + B["proj_first"] + i
        wb.set_value(T, f"B{r}", pr["client_and_number"])
        proj = f"{person['name']}, project '{str(pr.get('client_and_number') or '').replace(chr(10), ' / ')}'"
        set_dropdown_for(wb, T, f"C{r}", pr["client_type"], proj, "client type")
        set_dropdown_for(wb, T, f"F{r}", pr["project_type"], proj, "project type")
        wb.set_value(T, f"I{r}", pr["value_rm"])
        wb.set_value(T, f"J{r}", pr["position_held"])
        set_dropdown_for(wb, T, f"K{r}", pr["position_code"], proj, "position held (code)")
        wb.set_value(T, f"L{r}", pr["contact"])
        wb.set_value(T, f"M{r}", pr["contact_number"])
        wb.set_date(T, f"P{r}", pr["start"])
        wb.set_date(T, f"P{base + B['proj_end_first'] + i}", pr["end"])
    q = person["qualifications"]
    who = person["name"]
    set_dropdown_for(wb, T, at(B["employment"], base), person["employment"], who, "employment type")
    set_dropdown_for(wb, T, at(B["ecsa_level"], base), q["ecsa_level"], who, "ECSA registration level")
    if q.get("ecsa_number"): wb.set_value(T, at(B["ecsa_number"], base), q["ecsa_number"])
    if q.get("ecsa_date"): wb.set_date(T, at(B["ecsa_date"], base), q["ecsa_date"])
    if q.get("sacpcmp_date"): wb.set_date(T, at(B["sacpcmp_date"], base), q["sacpcmp_date"])
    set_dropdown_for(wb, T, at(B["highest_qual"], base), q["highest_level"], who, "highest qualification level")
    wb.set_value(T, at(B["highest_desc"], base), q["highest_description"])
    wb.set_value(T, at(B["highest_inst"], base), q["highest_institution"])
    wb.set_date(T, at(B["highest_date"], base), q["highest_graduated"])
    set_dropdown_for(wb, T, at(B["years_exp"], base),
                     None if q.get("years_experience") is None else str(q["years_experience"]), who, "years of experience")
    wb.set_value(T, at(B["initial_desc"], base), q["initial_description"])
    wb.set_value(T, at(B["initial_inst"], base), q["initial_institution"])
    wb.set_date(T, at(B["initial_date"], base), q["initial_graduated"])

def main(tpl, pack_path, out):
    pack = yaml.safe_load(open(pack_path))
    wb = Workbook(tpl)
    co, td = pack["company"], pack["tender"]

    # Company front page
    wb.set_value(T, "D1", co["name"])
    wb.set_value(T, "K33", co["bee_level"]); wb.set_value(T, "L33", co["black_ownership_pct"])
    wb.set_value(T, "H34", co["status"])
    for ref, key in [("F3339","head_office"),("F3340","other_offices"),("F3341","ecsa_registered"),
                     ("F3342","sacpcmp_registered"),("F3344","total_employees"),("F3345","jv_share_pct")]:
        wb.set_value(T, ref, co[key])

    # Tender-specific: C2.4 financials (hours, value, category) are supplied
    # per real quote, not guessed. Skip cleanly when the pack doesn't have them
    # yet, and say so, rather than writing a placeholder into a live submission.
    c24_fields = td.get("c2_4")
    if c24_fields:
        for n, vals in c24_fields.items():
            sheet = f"FORM C2.4 TECH  -TENDER {n}"
            wb.set_value(sheet, "E10", vals["hours_tendered"]); wb.set_value(sheet, "E11", vals["normalised_hours"])
            wb.set_value(sheet, "B13", vals["tender_value_incl_vat"]); wb.set_value(sheet, "E13", vals["category"])
    else:
        print("NOTE: no C2.4 figures in this pack yet - every Form C2.4 sheet left exactly as SANRAL shipped it")
    te = td.get("targeted_enterprise")
    if te:
        wb.set_value(T, "C3906", te["name"]); wb.set_value(T, "J3906", te["status"])
        wb.set_value(T, "M3906", te["pct_of_contract"]); wb.set_value(T, "D3908", te["black_ownership"])
        wb.set_value(T, "H3908", te["bee_level"]); wb.set_value(T, "M3908", te["pct_excl_provisional"])
    # SANRAL pre-fills the project name/number, closing date and positions on
    # the SETUP sheet of each new template. Never overwrite them from a pack.
    if td.get("overrides"):
        raise ValueError("Tender pack must not override SANRAL's SETUP details - "
                         "they come pre-filled in each new template")
    serial = lambda v: (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))) if isinstance(v, (int, float)) else v
    close, b7 = serial(wb.cached("SETUP", "C3")), serial(wb.cached(T, "F125"))
    # Contract number lives at SETUP!C2 (B2 holds the "Contract Number:" label) -
    # O2/P2 are blank on the real template; this print was reading the wrong cells.
    print("Tender (from SANRAL template):", wb.cached("SETUP", "C2"), "| closes", close)
    if close != b7:
        print(f"WARNING: Form B7 closing date {b7} differs from SETUP closing date {close}")

    # Every bundled contract gets its own "TENDDER n" row (17, 19, 21, ...) with a
    # YES/NO the SANRAL template ships pre-filled. Never write to these - only
    # report what's there, and flag any that isn't YES or whose own Form C2.4
    # financial figures (hours, value, category) are still empty.
    for r in range(17, 40, 2):
        contract = wb.cached(T, f"D{r}")
        if contract in (None, "", 0):
            break
        answer = wb.cached(T, f"F{r}")
        n = (r - 17) // 2 + 1
        print(f"  TENDER {n} ({contract}): {answer}" + ("" if str(answer).upper() == "YES"
              else "  <-- WARNING: not YES, check before relying on this"))
        if str(answer).upper() == "YES":
            sheet = f"FORM C2.4 TECH  -TENDER {n}"
            if wb.cached(sheet, "B13") in (None, "", 0):
                print(f"    WARNING: {sheet} has no tender value/hours/category filled in yet - "
                      "pending real figures from Sarel")

    # Key persons
    for a in pack["key_persons"]:
        bases = [a["block_row"]] if a.get("block_row") else blocks_for(wb, a["position"])
        for base in bases:
            fill_person(wb, base, pack["people"][a["person"]], pack.get("projects", {}))

    wb.save(out)
    print(f"Wrote {out}: {len(wb.log)} cell writes")

if __name__ == "__main__":
    main(*sys.argv[1:4])
