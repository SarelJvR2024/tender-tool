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
import os, sys, time, shutil, signal, subprocess, tempfile, zipfile, re, queue, threading
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


class LibreOfficeTimeout(RuntimeError):
    """A UNO call (recalculation, PDF export, ...) ran past its wall-clock
    deadline. Confirmed live 2026-10-20: this module had NO timeout at all
    around any UNO call - a malformed workbook (circular formula reference,
    a pathological sheet) could hang `doc.calculateAll()` or a report's own
    `storeToURL` forever. The outer bridge-level watchdog (run_bridges.py's
    30-minute subprocess timeout) does not help here: Office.__enter__
    deliberately spawns soffice with start_new_session=True (its own process
    group, so a kill aimed at one job's soffice never reaches another
    concurrent job's - 2026-10-17 fix) - but that same decoupling means an
    external kill of the PARENT python process never reaches the orphaned
    soffice either. Reproduced directly: killing a real admin_harness.py
    --pack run left a genuinely orphaned soffice.bin running at 97% CPU,
    untouched by the parent's termination."""


def _run_with_deadline(office, fn, deadline_seconds, what):
    """Runs fn() (a zero-arg callable making one or more UNO calls) in a
    daemon thread with a hard wall-clock deadline, the same pattern already
    proven in assess_tender.fetch_pdf_text for a different kind of blocking
    external call. A plain daemon thread, not concurrent.futures: an
    abandoned Future's worker thread is not daemonic and would block process
    exit waiting to join it. On timeout, force-kills the WHOLE LibreOffice
    process immediately rather than waiting for the thread (which may never
    return) - the normal, polite Office.__exit__ path can't be trusted here
    either, since the same hung UNO connection that caused the timeout would
    also hang `desk.terminate()`."""
    result_q = queue.Queue(maxsize=1)

    def runner():
        try:
            result_q.put(("ok", fn()))
        except Exception as e:
            result_q.put(("error", e))

    t = threading.Thread(target=runner, daemon=True)
    t.start()
    try:
        status, value = result_q.get(timeout=deadline_seconds)
    except queue.Empty:
        office.force_kill()
        raise LibreOfficeTimeout(f"{what} did not finish within {deadline_seconds}s "
                                 "(a malformed workbook, or a pathological formula, can hang LibreOffice "
                                 "indefinitely) - LibreOffice was force-killed; nothing further was produced.")
    if status == "error":
        raise value
    return value


class Office:
    def __enter__(self):
        self.prof = tempfile.mkdtemp()
        os.makedirs(self.prof + "/user")
        open(self.prof + "/user/registrymodifications.xcu", "w").write(PROFILE_XCU)
        port = 2100 + os.getpid() % 1000
        self.proc = subprocess.Popen(["soffice", f"-env:UserInstallation=file://{self.prof}", "--headless",
                                      "--invisible", "--nologo", "--norestore",
                                      f"--accept=socket,host=localhost,port={port};urp;"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     start_new_session=True)  # own process group, so __exit__ kills only this soffice
        local = uno.getComponentContext()
        res = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        for _ in range(90):
            try:
                self.ctx = res.resolve(f"uno:socket,host=localhost,port={port};urp;StarOffice.ComponentContext"); break
            except Exception: time.sleep(1)
        self.desk = self.ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", self.ctx)
        self._killed = False
        return self

    def force_kill(self):
        """The hard-kill path: used by _run_with_deadline on a timeout, where
        the document/connection may be wedged and desk.terminate() can't be
        trusted to return. Idempotent - __exit__ also calls this, after its
        own polite attempt, so a prior force_kill() here is a safe no-op."""
        if self._killed:
            return
        self._killed = True
        try: os.killpg(self.proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError): pass
        try: self.proc.wait(timeout=10)
        except Exception: pass

    def __exit__(self, *a):
        if not self._killed:
            try: self.desk.terminate()
            except Exception: pass
            try: self.proc.wait(timeout=30)
            except Exception: pass
        # Kill only THIS instance's process group (soffice -> oosplash ->
        # soffice.bin). This used to be `pkill -9 -x soffice.bin`, which also
        # killed every other LibreOffice on the host mid-conversion - found by
        # the 2026-10-17 scenario pass when a concurrent run died with
        # "illegal object given!" / "cannot get value Control".
        self.force_kill()
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


# Generous, but bounded well under run_bridges.py's 30-minute outer
# watchdog, so a genuinely hung conversion is caught and reported on its own
# terms rather than silently orphaning soffice until the outer kill (which,
# per LibreOfficeTimeout's own docstring, never actually reaches it anyway).
LOAD_AND_CALC_DEADLINE_SECONDS = 300
EXPORT_ONE_DEADLINE_SECONDS = 120


def export(src, outdir, names=None):
    os.makedirs(outdir, exist_ok=True)
    anchors = control_anchors(src)
    made, skipped = [], []
    with Office() as o:
        doc = _run_with_deadline(
            o, lambda: o.desk.loadComponentFromURL("file://" + os.path.abspath(src), "_blank", 0,
                                                    (pv("Hidden", True), pv("ReadOnly", True))),
            LOAD_AND_CALC_DEADLINE_SECONDS, "loading the workbook")
        try:
            _run_with_deadline(o, doc.calculateAll, LOAD_AND_CALC_DEADLINE_SECONDS,
                               "recalculating formulas (a circular reference or a pathological "
                               "formula can hang this step indefinitely)")
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
                _run_with_deadline(
                    o, lambda: uno.invoke(doc, "storeToURL", ("file://" + os.path.abspath(out),
                               (pv("FilterName", "calc_pdf_Export"), pv("FilterData", fd)))),
                    EXPORT_ONE_DEADLINE_SECONDS, f"exporting {name!r} to PDF")
                made.append(out)
        finally:
            if not o._killed:
                try: doc.close(True)
                except Exception: pass
    return made, skipped, (n, shown)


if __name__ == "__main__":
    made, skipped, (n, shown) = export(sys.argv[1], sys.argv[2], sys.argv[3:] or None)
    print(f"{n} controls aligned to Excel positions, {shown} dropdowns showing a selection")
    for m in made: print("PDF", m)
    for s in skipped: print("skipped (no candidate):", s)
