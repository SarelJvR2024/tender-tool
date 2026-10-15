## Appendix A — Source code (verbatim)

Companion to "SANRAL Tender Automation Specification.md". The four files below are the complete engine, reproduced unmodified. Save each block under the file name in its heading, in one folder, together with `packs/` (see section 4.4 of the specification for the pack format). Run scripts with `python3 <script>` (not `python3 -I`).

### A.1 `sanral_fill.py`

```python
"""
SANRAL technical-submission workbook filler (proof of concept).

Writes directly into the .xlsm XML instead of going through openpyxl, because
openpyxl silently drops this workbook's data-validation and conditional-format
extensions and does not understand the 873 form-control dropdowns.

What it does:
  * writes plain values into input cells (never overwrites a formula)
  * sets form-control dropdowns BY LABEL: looks the label up in the dropdown's
    own source list (read from the template, so a new SANRAL version with a
    changed list is picked up automatically), writes the index to the linked
    cell, and updates every control linked to that cell so it displays right
  * sets dates that SANRAL captures as Year / Month / Day dropdown triplets
  * flags the workbook to fully recalculate when Excel opens it
The VBA project, drawings and controls are copied through byte-for-byte.
"""
import re, sys, zipfile, datetime, json
from lxml import etree

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PNS = "http://schemas.openxmlformats.org/package/2006/relationships"
N = {"m": NS}
MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]


def col2n(c):
    n = 0
    for ch in c: n = n * 26 + ord(ch) - 64
    return n

def n2col(n):
    s = ""
    while n: n, r = divmod(n - 1, 26); s = chr(65 + r) + s
    return s

def split(ref):
    m = re.match(r"\$?([A-Z]+)\$?(\d+)$", ref)
    return m.group(1), int(m.group(2))

def norm(v):
    if v is None: return ""
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).strip().casefold()


class Workbook:
    def __init__(self, path):
        self.zin = zipfile.ZipFile(path)
        self.files = {i.filename: self.zin.read(i.filename) for i in self.zin.infolist()}
        self.order = [i.filename for i in self.zin.infolist()]
        self.trees = {}
        self.log = []
        self.dirty = set()
        self._map_sheets()
        self._shared = self._load_shared()
        self._map_controls()

    # ---------- structure ----------
    def _xml(self, name):
        if name not in self.trees:
            self.trees[name] = etree.fromstring(self.files[name])
        return self.trees[name]

    def _map_sheets(self):
        wb = self._xml("xl/workbook.xml")
        rels = self._xml("xl/_rels/workbook.xml.rels")
        rid = {r.get("Id"): r.get("Target") for r in rels}
        self.sheet_path = {}
        for s in wb.find("m:sheets", N):
            t = rid[s.get("{%s}id" % RNS)].lstrip("/")
            self.sheet_path[s.get("name")] = t if t.startswith("xl/") else "xl/" + t

    def _load_shared(self):
        if "xl/sharedStrings.xml" not in self.files: return []
        out = []
        for si in self._xml("xl/sharedStrings.xml").findall("m:si", N):
            out.append("".join(si.itertext()))
        return out

    def _map_controls(self):
        """controls[sheet][linked cell] -> list of (ctrlProp path, list range)"""
        self.controls = {}
        for sheet, path in self.sheet_path.items():
            relp = path.replace("worksheets/", "worksheets/_rels/") + ".rels"
            if relp not in self.files: continue
            for r in self._xml(relp):
                if not r.get("Type", "").endswith("/ctrlProp"): continue
                cp = "xl/" + r.get("Target").replace("../", "")
                x = self.files[cp].decode()
                link = re.search(r'fmlaLink="([^"]+)"', x)
                rng = re.search(r'fmlaRange="([^"]+)"', x)
                if not link: continue
                cell = link.group(1).replace("$", "")
                self.controls.setdefault(sheet, {}).setdefault(cell, []).append(
                    (cp, rng.group(1) if rng else None))

    # ---------- reading ----------
    def _cell_el(self, sheet, ref, create=False):
        root = self._xml(self.sheet_path[sheet])
        data = root.find("m:sheetData", N)
        col, row = split(ref)
        ref = f"{col}{row}"
        rows = data.findall("m:row", N)
        rowel = None
        for i, r in enumerate(rows):
            rn = int(r.get("r"))
            if rn == row: rowel = r; break
            if rn > row:
                if not create: return None
                rowel = etree.Element("{%s}row" % NS, r=str(row))
                r.addprevious(rowel); break
        if rowel is None:
            if not create: return None
            rowel = etree.SubElement(data, "{%s}row" % NS, r=str(row))
        for c in rowel.findall("m:c", N):
            cc, _ = split(c.get("r"))
            if cc == col: return c
            if col2n(cc) > col2n(col):
                if not create: return None
                new = etree.Element("{%s}c" % NS, r=ref); c.addprevious(new); return new
        if not create: return None
        return etree.SubElement(rowel, "{%s}c" % NS, r=ref)

    def cached(self, sheet, ref):
        c = self._cell_el(sheet, ref)
        if c is None: return None
        t = c.get("t"); v = c.find("m:v", N)
        if t == "inlineStr": return "".join(c.find("m:is", N).itertext())
        if v is None: return None
        if t == "s": return self._shared[int(v.text)]
        if t in ("str", "e"): return v.text
        if t == "b": return v.text == "1"
        f = float(v.text); return int(f) if f.is_integer() else f

    def options(self, rng, host_sheet):
        if "!" in rng:
            sh, a = rng.rsplit("!", 1); sh = sh.strip("'")
        else:
            sh, a = host_sheet, rng
        a = a.replace("$", "")
        c1, r1 = split(a.split(":")[0]); c2, r2 = split(a.split(":")[1])
        return [self.cached(sh, f"{n2col(c)}{r}")
                for r in range(r1, r2 + 1) for c in range(col2n(c1), col2n(c2) + 1)]

    # ---------- writing ----------
    def set_value(self, sheet, ref, value, allow_formula=False):
        self.dirty.add(self.sheet_path[sheet])
        c = self._cell_el(sheet, ref, create=True)
        if c.find("m:f", N) is not None and not allow_formula:
            raise ValueError(f"{sheet}!{ref} holds a formula - refusing to overwrite")
        for child in list(c): c.remove(child)
        c.attrib.pop("t", None)
        if value is None or value == "":
            self.log.append((sheet, ref, None)); return
        if isinstance(value, (datetime.date, datetime.datetime)):
            value = (datetime.datetime(value.year, value.month, value.day)
                     - datetime.datetime(1899, 12, 30)).days
        if isinstance(value, bool):
            c.set("t", "b"); etree.SubElement(c, "{%s}v" % NS).text = "1" if value else "0"
        elif isinstance(value, (int, float)):
            etree.SubElement(c, "{%s}v" % NS).text = repr(value) if isinstance(value, float) else str(value)
        else:
            c.set("t", "inlineStr")
            t = etree.SubElement(etree.SubElement(c, "{%s}is" % NS), "{%s}t" % NS)
            t.text = str(value)
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        self.log.append((sheet, ref, value))

    def set_dropdown(self, sheet, ref, label):
        ref = ref.replace("$", "")
        ctrls = self.controls.get(sheet, {}).get(ref)
        if not ctrls: raise KeyError(f"No dropdown linked to {sheet}!{ref}")
        rng = next(r for _, r in ctrls if r)
        opts = self.options(rng, sheet)
        want = norm(label)
        idx = next((i + 1 for i, o in enumerate(opts) if norm(o) == want), None)
        if idx is None:
            raise ValueError(f"'{label}' is not an option for {sheet}!{ref}. "
                             f"Options: {[o for o in opts if o not in (None, 0)]}")
        self.set_value(sheet, ref, idx)
        for cp, _ in ctrls:
            x = self.files[cp].decode()
            x = re.sub(r' sel="\d+"', f' sel="{idx}"', x) if " sel=" in x else \
                x.replace("<formControlPr ", f'<formControlPr sel="{idx}" ', 1)
            self.files[cp] = x.encode()
        return idx

    def set_date(self, sheet, yref, d):
        """Dates are captured as Year | Month | Day dropdowns in three adjacent columns."""
        if isinstance(d, str): d = datetime.date.fromisoformat(d)
        col, row = split(yref); n = col2n(col)
        self.set_dropdown(sheet, f"{col}{row}", str(d.year))
        self.set_dropdown(sheet, f"{n2col(n+1)}{row}", MONTHS[d.month - 1])
        self.set_dropdown(sheet, f"{n2col(n+2)}{row}", str(d.day))

    def save(self, path):
        wb = self._xml("xl/workbook.xml")
        cp = wb.find("m:calcPr", N)
        if cp is None: cp = etree.SubElement(wb, "{%s}calcPr" % NS)
        cp.set("fullCalcOnLoad", "1")
        self.dirty.add("xl/workbook.xml")
        for name, tree in self.trees.items():
            if name not in self.dirty: continue   # only re-save sheets we wrote to
            self.files[name] = etree.tostring(tree, xml_declaration=True,
                                              encoding="UTF-8", standalone=True)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for name in self.order:
                z.writestr(self.zin.getinfo(name), self.files[name],
                           compress_type=zipfile.ZIP_DEFLATED)
```

### A.2 `fill_conventional.py`

```python
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
```

### A.3 `fill_tender.py` (RRM family)

```python
"""
Usage:  python fill_tender.py <SANRAL template.xlsm> <tender_pack.yaml> <output.xlsm>

The tender pack holds everything the tenderer types in. People and projects live
in a reusable library section, so the next tender only needs a new
'tender' block and a new 'key_persons' assignment list.
"""
import sys, yaml, datetime
from sanral_fill import Workbook, split, n2col, col2n

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
        wb.set_value(T, f"I{r}", pr["value_rm"])
        wb.set_value(T, f"J{r}", pr["position_held"])
        wb.set_dropdown(T, f"K{r}", pr["position_code"])
        wb.set_value(T, f"L{r}", pr["contact"])
        wb.set_value(T, f"M{r}", pr["contact_number"])
        wb.set_date(T, f"P{r}", pr["start"])
        wb.set_date(T, f"P{base + B['proj_end_first'] + i}", pr["end"])
    q = person["qualifications"]
    wb.set_dropdown(T, at(B["employment"], base), person["employment"])
    wb.set_dropdown(T, at(B["ecsa_level"], base), q["ecsa_level"])
    if q.get("ecsa_number"): wb.set_value(T, at(B["ecsa_number"], base), q["ecsa_number"])
    if q.get("ecsa_date"): wb.set_date(T, at(B["ecsa_date"], base), q["ecsa_date"])
    if q.get("sacpcmp_date"): wb.set_date(T, at(B["sacpcmp_date"], base), q["sacpcmp_date"])
    wb.set_dropdown(T, at(B["highest_qual"], base), q["highest_leevle"])
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
    print("Tender (from SANRAL template):", wb.cached("SETUP", "O2"), "|",
          wb.cached("SETUP", "P2"), "| closes", close)
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
```

### A.4 `print_reports.py`

```python
"""
Generate SANRAL's print reports as PDF without Excel.

    python print_reports.py <filled tender .xlsm> <output folder> [report ...]

How it works (LibreOffice, driven headless through its API):
  1. Opens the tender file read-only, with the settings needed to reproduce
     Excel's results: locale-aware text-to-date conversion (yyyy/m/d), which SANRAL's date formulas rely on.
  2. Recalculates every formula.
  3. Fixes the two things LibreOffice gets wrong with SANRAL's dropdowns:
       - puts each dropdown back at the cell position Excel anchors it to
       - shows the selected option (read from the dropdown's linked cell)
     and stops the buttons printing, as Excel does.
  4. For each report applies the print area and page setup copied from
     SANRAL's own button macro and exports it to PDF.
The tender file is never saved or modified.
"""
import os, sys, time, shutil, subprocess, tempfile, zipfile, re
import uno
from com.sun.star.beans import PropertyValue
from com.sun.star.awt import Point, Size

# From SANRAL's VBA: (print area, pages wide, pages tall (0 = automatic), top margin inches, name cell)
REPORTS = {
    "Form B3": ("A3337:N3425", 1, 1, 0.5, None),
    "Form B4": ("A3438:N3561", 1, 2, 0.0, None),
    "Form B5": ("A3638:N3761", 1, 2, 0.0, None),
    "Form B7": ("A3901:N3951", 1, 1, 0.5, None),
    "Notes to Tenderer": ("CS1:DH60", 1, 2, 0.5, None),
}
for p in range(1, 21):          # SANRAL printposition1..20 -> A37:N101, A137:N201, ...
    top = 37 + 100 * (p - 1)
    REPORTS[f"{top} Forms B1-B2 Position {p}"] = (f"A{top}:N{top+64}", 1, 0, 0.5, f"B{top+4}")
DEFAULT = [k for k in REPORTS if "Position" in k] + ["Form B3", "Form B4", "Form B5", "Form B7"]
SHEET = "TEND 1X"

PROFILE_XCU = """<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Setup/L10N"><prop oor:name="ooSetupSystemLocale" oor:op="fuse"><value>en-US</value></prop></item>
<item oor:path="/org.openoffice.Setup/L10N"><prop oor:name="DateAcceptancePatterns" oor:op="fuse"><value>Y/M/D;M/D/Y;M/D</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Syntax"><prop oor:name="StringConversion" oor:op="fuse"><value>3</value></prop></item>
</oor:items>"""


def pv(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p


def col_num(letters):
    n = 0
    for ch in letters: n = n * 26 + ord(ch) - 64
    return n


def control_anchors(path):
    """Excel's anchor for every control on TEND 1X, in drawing order."""
    z = zipfile.ZipFile(path)
    sh = z.read("xl/worksheets/sheet1.xml").decode()
    rels = z.read("xl/worksheets/_rels/sheet1.xml.rels").decode()
    rid = {}
    for m in re.finditer(r"<Relationship [^>]*>", rels):
        rid[re.search(r'Id="([^"]+)"', m.group()).group(1)] = re.search(r'Target="([^"]+)"', m.group()).group(1)
    info = {}
    for m in re.finditer(r'<control shapeId="(\d+)" r:id="([^"]+)"', sh):
        cp = z.read("xl/" + rid[m.group(2)].replace("../", "")).decode()
        l = re.search(r'fmlaLink="([^"]+)"', cp); t = re.search(r'objectType="(\w+)"', cp)
        info[m.group(1)] = (t.group(1) if t else None, l.group(1).replace("$", "") if l else None)
    d = z.read("xl/drawings/drawing1.xml").decode()
    num = r"<xdr:col>(\d+)</xdr:col><xdr:colOff>(-?\d+)</xdr:colOff><xdr:row>(\d+)</xdr:row><xdr:rowOff>(-?\d+)</xdr:rowOff>"
    out = []
    for m in re.finditer(r"<mc:Choice[^>]*>(.*?)</mc:Choice>", d, re.S):
        blk = m.group(1); s = re.search(r'compatExt spid="_x0000_s(\d+)"', blk)
        if not s: continue
        fr = re.search("<xdr:from>" + num, blk); to = re.search("<xdr:to>" + num, blk)
        typ, link = info.get(s.group(1), (None, None))
        nm = re.search(r'<xdr:cNvPr id="\d+" name="([^"]+)"', blk).group(1)
        out.append(dict(name=nm, type=typ, link=link, frm=tuple(map(int, fr.groups())), to=tuple(map(int, to.groups()))))
    return out


class Office:
    def __enter__(self):
        self.prof = tempfile.mkdtemp()
        os.makedirs(self.prof + "/user")
        open(self.prof + "/user/registrymodifications.xcu", "w").write(PROFILE_XCU)
        port = 2100 + os.getpid() % 1000
        self.proc = subprocess.Popen(["soffice", f"-env:UserInstallation=file://{self.prof}", "--headless",
                                      "--invisible", "--nologo", "--norestore",
                                      f"--accept=socket,host=localhost,port={port};urp;"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        local = uno.getComponentContext()
        res = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        for _ in range(90):
            try:
                self.ctx = res.resolve(f"uno:socket,host=localhost,port={port};urp;StarOffice.ComponentContext"); break
            except Exception: time.sleep(1)
        self.desk = self.ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", self.ctx)
        return self

    def __exit__(self, *a):
        try: self.desk.terminate()
        except Exception: pass
        try: self.proc.wait(timeout=30)
        except Exception: pass
        subprocess.run(["pkill", "-9", "-x", "soffice.bin"], capture_output=True)
        shutil.rmtree(self.prof, ignore_errors=True)


def fix_controls(sh, anchors):
    """Match each LibreOffice control to Excel's by its name ('Drop Down 41'), put it at
    Excel's anchor position and show the option stored in its linked cell."""
    dp = sh.DrawPage
    for _ in range(60):                        # LibreOffice creates control models lazily
        ctrls = [s for s in (dp.getByIndex(i) for i in range(dp.Count))
                 if s.ShapeType == "com.sun.star.drawing.ControlShape"]
        if all(s.Control is not None for s in ctrls): break
        time.sleep(1)
    else:
        raise RuntimeError("LibreOffice did not finish loading the dropdowns")
    xl = {a["name"]: a for a in anchors}
    lo = {s.Control.Name: s for s in ctrls}
    if set(xl) != set(lo):
        raise RuntimeError(f"controls differ: {len(set(xl) ^ set(lo))} unmatched - aborting rather than guessing")
    def xy(col, coff, row, roff):
        c = sh.getCellByPosition(col, row).Position
        return c.X + round(coff / 360), c.Y + round(roff / 360)      # EMU -> 1/100 mm
    drops = shown = 0
    for name, a in xl.items():
        s = lo[name]
        if a["type"] != "Drop":
            s.Printable = False                # Excel's buttons are set not to print
            continue
        drops += 1
        m = re.match(r"([A-Z]+)(\d+)", a["link"])
        col, row = col_num(m.group(1)) - 1, int(m.group(2)) - 1
        model = s.Control
        vb = model.ValueBinding
        if vb is not None:
            b = vb.getPropertyValue("BoundCell")
            if (b.Column, b.Row) != (col, row):
                raise RuntimeError(f"{name}: linked cell mismatch - aborting")
            model.setValueBinding(None)        # show the choice without writing back to the cell
        x1, y1 = xy(*a["frm"]); x2, y2 = xy(*a["to"])
        s.Position = Point(x1, y1); s.Size = Size(max(x2 - x1, 100), max(y2 - y1, 100))
        idx = int(sh.getCellByPosition(col, row).Value)
        ok = 1 <= idx <= len(model.StringItemList)
        model.SelectedItems = (idx - 1,) if ok else ()
        shown += ok
    return drops, shown


def export(src, outdir, names=None):
    os.makedirs(outdir, exist_ok=True)
    anchors = control_anchors(src)
    made, skipped = [], []
    with Office() as o:
        doc = o.desk.loadComponentFromURL("file://" + os.path.abspath(src), "_blank", 0,
                                          (pv("Hidden", True), pv("ReadOnly", True)))
        try:
            doc.calculateAll()
            sh = doc.Sheets.getByName(SHEET)
            n, shown = fix_controls(sh, anchors)
            ps = doc.StyleFamilies.getByName("PageStyles").getByName(sh.PageStyle)
            for name in names or DEFAULT:
                area, wide, tall, top_in, name_cell = REPORTS[name]
                if name_cell and not sh.getCellRangeByName(name_cell).String.strip():
                    skipped.append(name); continue
                ps.IsLandscape = True; ps.Width, ps.Height = 29700, 21000
                ps.LeftMargin = ps.RightMargin = ps.BottomMargin = 0
                ps.TopMargin = round(top_in * 2540)
                ps.HeaderIsOn = False; ps.FooterIsOn = False
                ps.CenterHorizontally = True; ps.CenterVertically = False
                ps.PrintGrid = False; ps.PrintHeaders = False
                ps.ScaleToPagesX = wide; ps.ScaleToPagesY = tall
                rng = sh.getCellRangeByName(area)
                sh.setPrintAreas((rng.RangeAddress,))
                fd = uno.Any("[]com.sun.star.beans.PropertyValue", ((pv("Selection", rng),)))
                out = os.path.join(outdir, name + ".pdf")
                uno.invoke(doc, "storeToURL", ("file://" + os.path.abspath(out),
                           (pv("FilterName", "calc_pdf_Export"), pv("FilterData", fd))))
                made.append(out)
        finally:
            doc.close(True)
    return made, skipped, (n, shown)


if __name__ == "__main__":
    made, skipped, (n, shown) = export(sys.argv[1], sys.argv[2], sys.argv[3:] or None)
    print(f"{top} controls aligned to Excel positions, {shown} dropdowns showing a selection")
    for m in made: print("PDF", m)
    for s in skipped: print("skipped (no candidate):", s)
```

**Observed note on `print_reports.py`:** `control_anchors` reads `xl/worksheets/sheet1.xml` and `xl/drawings/drawing1.xml`, i.e. it assumes `TEND 1X` is the first sheet part and its drawing is `drawing1.xml` (true in all templates handled).
