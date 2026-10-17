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

class FieldError(ValueError):
    """A dropdown value from the company's own data that the template can't
    take, phrased for the person who has to fix it (which person / project /
    field, what the data says, what SANRAL accepts, where to fix it) instead
    of a bare cell reference. Still a ValueError, so every existing caller
    (assemble_pack, harness_pack, process_pack_jobs) keeps treating it as a
    refusal with a reason."""


def set_dropdown_for(wb, sheet, ref, label, who, what, fix_where="the People page"):
    """wb.set_dropdown() with a human error (2026-10-17 scenario pass: the
    refusal for a test company used to read "'None' is not an option for TEND
    1X!D76" - true, but it named a cell, not the person or the field)."""
    if label is None or str(label).strip() == "":
        raise FieldError(f"{who}: {what} is not recorded - fill it in on {fix_where} before generating the pack "
                         f"(SANRAL's form needs it; template cell {sheet}!{ref}).")
    try:
        return wb.set_dropdown(sheet, ref, label)
    except ValueError as e:
        opts = str(e).split("Options: ", 1)[-1] if "Options: " in str(e) else ""
        raise FieldError(f"{who}: {what} '{label}' is not one of the options this SANRAL template accepts"
                         + (f" ({opts})" if opts else "") + f" - correct it on {fix_where} (template cell {sheet}!{ref}).") from e
