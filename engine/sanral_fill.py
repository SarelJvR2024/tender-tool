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


# Project-type codes that are the SAME real experience under two spellings
# (Sarel, 2026-10-17, audit Q1): the Conventional PL/CE/RE matrix's "MO/MA"
# (Maintenance Operations and Adhoc Maintenance) is the code the RRM CE/RM/ARM
# form renames to "MO/MA (Excl. RRM)" - RRM's form doesn't offer a plain
# "MO/MA" at all, and lists RRM work under its own separate "RRM" code. A
# project tagged either spelling fits a block offering the other. "RRM" stays
# a distinct code. Add a group here only when SANRAL's own forms show the same
# code renamed, never to merge genuinely different codes.
PROJECT_TYPE_EQUIVALENTS = (
    ("MO/MA", "MO/MA (Excl. RRM)"),
)


def equivalent_codes(label):
    """The other spellings of `label` per PROJECT_TYPE_EQUIVALENTS (normalised;
    empty when it has none)."""
    want = norm(label)
    for group in PROJECT_TYPE_EQUIVALENTS:
        g = [norm(x) for x in group]
        if want in g:
            return [x for x in g if x != want]
    return []


def resolve_option(opts, label):
    """1-based index of `label` in a dropdown's options, or None. Exact match
    first (case/space-insensitive); then the toll-code spelling (code_alias);
    then an equivalent spelling of the same project type
    (PROJECT_TYPE_EQUIVALENTS: "MO/MA" <-> RRM's "MO/MA (Excl. RRM)");
    then, for a combined option such as Book 1's DS-Pavement "DI/DN"
    ("Development Improvement / New Facilities"), a label equal to one of its
    parts ("DI" or "DN" - both codes the PL/CE/RE matrix lists separately)."""
    want = norm(label)
    if not want:
        return None
    alias = norm(code_alias(label)) if code_alias(label) else None
    for cand in [want, alias, *equivalent_codes(label)]:
        if cand:
            idx = next((i + 1 for i, o in enumerate(opts) if norm(o) == cand), None)
            if idx is not None:
                return idx
    if "/" not in want:
        return next((i + 1 for i, o in enumerate(opts)
                     if isinstance(o, str) and "/" in o and want in [norm(x) for x in o.split("/")]), None)
    return None


def code_alias(label):
    """'PL(T)' <-> 'PL(Toll)' (see Workbook.set_dropdown). None when the label
    has neither form."""
    s = str(label or "").strip()
    m = re.match(r"^(.*)\(\s*(t|toll)\s*\)$", s, re.IGNORECASE)
    if not m: return None
    return f"{m.group(1).strip()}({'Toll' if m.group(2).lower() == 't' else 'T'})"


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

    def dropdown_options(self, sheet, ref):
        """The dropdown's own option list, read from the template (blank/0
        padding rows dropped). [] when no dropdown is linked to the cell."""
        ctrls = self.controls.get(sheet, {}).get(ref.replace("$", ""))
        if not ctrls: return []
        rng = next((r for _, r in ctrls if r), None)
        if not rng: return []
        return [o for o in self.options(rng, sheet) if o not in (None, 0, "")]

    def set_dropdown(self, sheet, ref, label):
        ref = ref.replace("$", "")
        ctrls = self.controls.get(sheet, {}).get(ref)
        if not ctrls: raise KeyError(f"No dropdown linked to {sheet}!{ref}")
        rng = next(r for _, r in ctrls if r)
        opts = self.options(rng, sheet)
        # resolve_option: exact label, else SANRAL's other spelling of the same
        # code - Book 1's key-person list (T-24/T-26) prints "PL(T)", "DS(T)"...
        # where the workbook's own position-held list (WORKINGS MATRIX C80:C102)
        # says "PL(Toll)", "DS(Toll)"... - else one part of a combined option.
        idx = resolve_option(opts, label)
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


def fits_dropdown(wb, sheet, ref, label):
    """Does `label` match one of this dropdown's own options (case/space
    insensitive, toll-code spellings aliased)? Returns (fits, options)."""
    opts = wb.dropdown_options(sheet, ref)
    return resolve_option(opts, label) is not None, opts


def projects_for_block(wb, sheet, first_row, person_name, projects, max_projects, slot_label=None):
    """Which of a person's projects go into ONE Form B1/B2 key-person block.

    The project-type dropdown is per key-person block, not per tender: each
    block reads its option list from its own SETUP column (rows 10-22), i.e.
    from the Book 1 project-type matrix of THAT position (verified on all six
    Conventional samples and the RRM X.002-188-2023/1F workbook: the PL block
    offers NONE/MO/MA/MP/MS/DS/DI/DN/CD, the DS-Pavement block on the same
    tender NONE/MP/MS/MSC/DS/DI/DN, the RRM CE block NONE/RRM/MO/MA (Excl.
    RRM)/MP/MS/DS/DI/DN/CD). A real project can therefore carry a code that is
    valid for one position and simply not offered for another. (A project
    tagged plain "MO/MA" DOES fit the RRM block's "MO/MA (Excl. RRM)" option
    and vice versa - same code, renamed; see PROJECT_TYPE_EQUIVALENTS.)

    Sarel's rule for that case (2026-10-17): don't refuse the whole pack -
    leave that one project off the block it doesn't fit and say so. Projects
    are taken in the order given (most recent first), skipping ones whose
    project type this block doesn't offer, until the block's rows are full.
    Returns (chosen_projects, notes). A project with NO project type recorded
    is kept: set_dropdown_for() then stops with "not recorded" - a missing
    value is a data gap to fill, not a code that doesn't apply here."""
    chosen, notes = [], []
    where = f" ({slot_label})" if slot_label else ""
    for pr in projects:
        if len(chosen) >= max_projects:
            break  # Form B1 has max_projects rows; the most recent fitting ones are cited
        ptype = pr.get("project_type")
        if ptype not in (None, ""):
            fits, opts = fits_dropdown(wb, sheet, f"F{first_row + len(chosen)}", ptype)
            if not fits and opts:
                label = str(pr.get("client_and_number") or "").replace("\n", " / ")
                notes.append(f"{person_name}{where}: project '{label}' left off this position's Form B1 - its project "
                             f"type '{ptype}' is not one this position's SANRAL project-type matrix offers "
                             f"({', '.join(str(o) for o in opts)}). It still counts on any position whose form "
                             f"offers that type.")
                continue
        chosen.append(pr)
    return chosen, notes


# ---------------------------------------------------------------------------
# TEND 1X company front page + Form B3 company block (both template families:
# the cells are identical in the Conventional and RRM workbooks).
#
# Form-Field-Audit 2026-10-18. Before, every value was written as-is from the
# pack, with no record of where it came from:
#   - a value not on file was written as an EMPTY cell, wiping the answer
#     SANRAL ships (K33 = 9, "non compliant contributor"; H34 = "GENERIC");
#   - Form B3's counts (other offices, ECSA / SACPCMP-registered staff) were
#     written as 0 for every company created in the app - the database default
#     (0001), not anything the company said, and there was no field to change
#     it; a head office not on file was written as the literal text
#     "CHECK PROFILE - head_office not set";
#   - "% SHARE OF JV AGREEMENT" came from a company-wide "typical JV share";
#   - C33 "Verification Certificate Attached?" was never touched, so SANRAL's
#     shipped answer "Verification Certificate" went out for every company -
#     including ones with an affidavit, an expired certificate or nothing.
# Now each cell is written only from a value on file, and anything assumed or
# not on file is logged (assumed_default / missing) and returned as a pack note.
# ---------------------------------------------------------------------------

B3_COUNTS = [  # (cell, pack company key, Form B3 label)
    ("F3340", "other_offices", "OTHER OFFICES (number)"),
    ("F3341", "ecsa_registered", "REGISTERED PROFESSIONALS: ECSA"),
    ("F3342", "sacpcmp_registered", "REGISTERED PROFESSIONALS: SACPCMP"),
    ("F3344", "total_employees", "TOTAL EMPLOYEES"),
]
CERT_CELL = "C33"
CERT_YES, CERT_NO = "Verification Certificate", "No Valid Certificate"


def _log(log, kind, key, value=None, reason=None):
    if log is None:
        return
    if kind == "confirmed":
        log.confirmed(key, value)
    elif kind == "assumed":
        log.assumed_default(key, value, reason)
    else:
        log.missing(key, reason)


def fill_company_front(wb, co, closing_date=None, log=None, sheet="TEND 1X"):
    """Writes the TEND 1X company front page and the Form B3 company block
    from the pack's `company` block. Returns notes for the pack."""
    notes = []
    T = sheet
    name = co.get("name")
    wb.set_value(T, "D1", name)
    _log(log, "confirmed", "tend1x.company_name", name)

    # B-BBEE level (K33, whole 1-9; SANRAL ships 9 = non-compliant contributor)
    if co.get("bee_level"):
        wb.set_value(T, "K33", co["bee_level"])
        _log(log, "confirmed", "tend1x.bee_level", co["bee_level"])
    else:
        notes.append("TEND 1X: no B-BBEE level on file - SANRAL's own answer (9, non-compliant contributor) is left "
                     "in K33, which scores 0 specific-goal points. Add the level on the Company page if you have one.")
        _log(log, "missing", "tend1x.bee_level", reason="No B-BBEE level on file - K33 left as SANRAL shipped it (9).")
    if co.get("black_ownership_pct") is not None:
        wb.set_value(T, "L33", co["black_ownership_pct"])
        _log(log, "confirmed", "tend1x.black_ownership_pct", co["black_ownership_pct"])
    else:
        _log(log, "missing", "tend1x.black_ownership_pct", reason="No black ownership % on file - L33 left blank.")
    if co.get("status"):
        wb.set_value(T, "H34", co["status"])
        _log(log, "confirmed", "tend1x.company_status", co["status"])
    else:
        notes.append("TEND 1X: the company's B-BBEE status (EME / QSE / Generic) is not on file - SANRAL's own "
                     "answer 'GENERIC' is left in H34 (it also sets Form B7's main-tenderer size).")
        _log(log, "missing", "tend1x.company_status",
             reason="No B-BBEE status (EME/QSE/Generic) on file - H34 left as SANRAL shipped it ('GENERIC').")

    # C33 "Verification Certificate Attached?"
    proof, expiry = co.get("bee_proof_type"), co.get("bee_proof_expiry")
    valid = bool(expiry) and (closing_date is None or str(expiry)[:10] >= str(closing_date)[:10])
    if wb.controls.get(T, {}).get(CERT_CELL):
        if proof == "certificate" and valid:
            wb.set_dropdown(T, CERT_CELL, CERT_YES)
            _log(log, "confirmed", "tend1x.verification_certificate", CERT_YES)
        elif proof in ("qse_affidavit", "eme_affidavit") and valid:
            notes.append("TEND 1X C33 'Verification Certificate Attached?' is left as SANRAL ships it ('Verification "
                         f"Certificate'), but the proof on file is a {'QSE' if proof == 'qse_affidavit' else 'EME'} sworn "
                         "affidavit. R.396's Form A12 accepts an affidavit only from an EME with annual revenue under "
                         "R1.8 million - if this tender's A12 doesn't accept yours, change C33 to 'No Valid Certificate'.")
            _log(log, "assumed", "tend1x.verification_certificate", CERT_YES,
                 "SANRAL's shipped answer kept; the B-BBEE proof on file is a sworn affidavit, not a certificate - "
                 "check this tender's Form A12 accepts it.")
        else:
            wb.set_dropdown(T, CERT_CELL, CERT_NO)
            why = ("no B-BBEE proof is recorded" if not proof else
                   "the B-BBEE proof on file has no expiry date" if not expiry else
                   f"the B-BBEE proof on file expires {expiry}, before this tender closes")
            notes.append(f"TEND 1X C33 set to 'No Valid Certificate' because {why} (SANRAL ships 'Verification "
                         "Certificate'; with no valid certificate the B-BBEE score is 0). Update the vault and "
                         "regenerate if you do hold a valid certificate.")
            _log(log, "assumed", "tend1x.verification_certificate", CERT_NO,
                 f"Set to 'No Valid Certificate' because {why}.")

    # Form B3 company block
    head = co.get("head_office")
    if head:
        wb.set_value(T, "F3339", head)
        _log(log, "confirmed", "form_b3.head_office", head)
    else:
        notes.append("Form B3: HEAD OFFICE (city/town) is not on file - left blank; add it on the Company page.")
        _log(log, "missing", "form_b3.head_office", reason="Head office city/town not on file - Form B3 F3339 left blank.")
    # A company row created in the app before migration 0057 holds 0 in the
    # three counts that had a column DEFAULT 0 (other offices, ECSA, SACPCMP)
    # whether or not anyone entered them. total_employees never had a default,
    # so "all three 0 and total employees not recorded" is the untouched
    # default, not three answers - treated as not on file.
    untouched = co.get("total_employees") is None and all(
        co.get(k) in (0, None) for k in ("other_offices", "ecsa_registered", "sacpcmp_registered"))
    for cell, key, label in B3_COUNTS:
        v = co.get(key)
        if untouched and v == 0:
            v = None
        if v is None:
            notes.append(f"Form B3: {label} is not on file - left blank; add it on the Company page.")
            _log(log, "missing", f"form_b3.{key}", reason=f"{label} not on file - Form B3 {cell} left blank.")
            continue
        wb.set_value(T, cell, v)
        if v == 0 and key != "other_offices":
            notes.append(f"Form B3: {label} = 0 is on file - check it, a company record holds 0 until someone enters "
                         "the real number (Company page).")
            _log(log, "assumed", f"form_b3.{key}", 0, f"{label} is 0 on file - confirm it is the real number.")
        else:
            _log(log, "confirmed", f"form_b3.{key}", v)
    jv = co.get("jv_share_pct")
    if jv is None:
        notes.append("Form B3: % SHARE OF JV AGREEMENT is not on file - left blank (a tenderer bidding on its own "
                     "normally enters 100).")
        _log(log, "missing", "form_b3.jv_share_pct", reason="% share of JV agreement not on file - F3345 left blank.")
    else:
        wb.set_value(T, "F3345", jv)
        why = ("the company's standing JV share on file - whether this bid is a JV, and the share, are decided per "
               "tender; confirm it.")
        if jv != 100:
            notes.append(f"Form B3: % SHARE OF JV AGREEMENT = {jv} is {why}")
        _log(log, "assumed", "form_b3.jv_share_pct", jv, f"{jv}% is {why}")
    return notes
