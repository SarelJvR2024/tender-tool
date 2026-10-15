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
from sanral_fill import Workbook, split, n2col, col2n

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

def fill_person(wb, base, person, projects_lib):
    wb.set_value(T, at(B["name"], base), person["name"])
    wb.set_value(T, at(B["id"], base), int(person["id_number"]))
    wb.set_value(T, at(B["description"], base), person.get("description", ""))
    projs = [projects_lib[p] if isinstance(p, str) else p for p in person["projects"]]
    if len(projs) > B["max_projects"]:
        raise ValueError(f"{person['name']}: form accepts {B['max_projects']} projects")
    for i, pr in enumerate(projs):
        r = base + B["proj_first"] + i
        wb.set_value(T, f"B{r}", pr["client_and_number"])
        wb.set_dropdown(T, f"C{r}", pr["client_type"])
        wb.set_dropdown(T, f"F{r}", pr["project_type"])
        wb.set_date(T, f"P{r}", pr["start"])
        wb.set_date(T, f"P{base + B['proj_end_first'] + i}", pr["end"])
        wb.set_value(T, f"I{r}", pr["value_rm"])
        wb.set_value(T, f"J{r}", pr["position_held"])
        wb.set_dropdown(T, f"K{r}", pr["position_code"])
        wb.set_value(T, f"L{r}", pr["contact"])
        wb.set_value(T, f"M{r}", pr["contact_number"])
    q = person["qualifications"]
    wb.set_dropdown(T, at(B["employment"], base), person["employment"])
    wb.set_dropdown(T, at(B["ecsa_level"], base), q["ecsa_level"])
    if q.get("ecsa_number"): wb.set_value(T, at(B["ecsa_number"], base), q["ecsa_number"])
    if q.get("ecsa_date"): wb.set_date(T, at(B["ecsa_date"], base), q["ecsa_date"])
    if q.get("sacpcmp_number"): wb.set_value(T, at(B["sacpcmp_number"], base), q["sacpcmp_number"])
    if q.get("sacpcmp_date"): wb.set_date(T, at(B["sacpcmp_date"], base), q["sacpcmp_date"])
    wb.set_dropdown(T, at(B["highest_qual"], base), q["highest_level"])
    wb.set_value(T, at(B["highest_desc"], base), q["highest_description"])
    wb.set_value(T, at(B["highest_inst"], base), q["highest_institution"])
    wb.set_date(T, at(B["highest_date"], base), q["highest_graduated"])
    wb.set_dropdown(T, at(B["years_exp"], base), str(q["years_experience"]))
    wb.set_value(T, at(B["initial_desc"], base), q["initial_description"])
    wb.set_value(T, at(B["initial_inst"], base), q["initial_institution"])
    wb.set_date(T, at(B["initial_date"], base), q["initial_graduated"])

def main(tpl, pack_path, out):
    pack = yaml.safe_load(open(pack_path))
    wb = Workbook(tpl)
    co, td = pack["company"], pack["tender"]

    # Company front page. K33 (BEE level, validation whole 1-9) and L33 (black
    # ownership %) are unlocked inputs although not yellow; SANRAL ships K33 = 9.
    wb.set_value(T, "D1", co["name"])
    wb.set_value(T, "K33", co["bee_level"]); wb.set_value(T, "L33", co["black_ownership_pct"])
    wb.set_value(T, "H34", co["status"])
    for ref, key in [("F3339","head_office"),("F3340","other_offices"),("F3341","ecsa_registered"),
                     ("F3342","sacpcmp_registered"),("F3344","total_employees"),("F3345","jv_share_pct")]:
        wb.set_value(T, ref, co[key])

    # C2.4 summary: this template carries only the two totals (no value/category
    # fields exist here - the full C2.4 lives in the separate Financial workbook).
    c24 = td.get("c2_4")
    if c24:
        wb.set_value("FORM C2.4 TECH", "E10", c24["hours_tendered"])
        wb.set_value("FORM C2.4 TECH", "E11", c24["normalised_hours"])
    else:
        print("NOTE: no C2.4 figures in this pack yet - FORM C2.4 TECH left exactly as SANRAL shipped it")

    te = td.get("targeted_enterprise")
    if te:   # Form B7 (same cells as the RRM template)
        wb.set_value(T, "C3906", te["name"]); wb.set_value(T, "J3906", te["status"])
        wb.set_value(T, "M3906", te["pct_of_contract"]); wb.set_value(T, "D3908", te["black_ownership"])
        wb.set_value(T, "H3908", te["bee_level"]); wb.set_value(T, "M3908", te["pct_excl_provisional"])

    if td.get("overrides"):
        raise ValueError("Tender pack must not override SANRAL's SETUP details - "
                         "they come pre-filled in each new template")
    serial = lambda v: (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))) if isinstance(v, (int, float)) else v
    print("Tender (from SANRAL template): contract", wb.cached("SETUP", "C2"),
          "| closes", serial(wb.cached("SETUP", "C3")))

    # Key persons
    for a in pack["key_persons"]:
        bases = [a["block_row"]] if a.get("block_row") else blocks_for(wb, a["position"])
        for base in bases:
            fill_person(wb, base, pack["people"][a["person"]], pack.get("projects", {}))

    wb.save(out)
    print(f"Wrote {out}: {len(wb.log)} cell writes")

if __name__ == "__main__":
    main(*sys.argv[1:4])
