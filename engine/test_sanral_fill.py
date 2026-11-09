"""
Regression test for sanral_fill.Workbook.set_value()'s control-character
sanitization (standing review, 2026-11-04).

This session already found and fixed the identical crash three times in the
docx-writing side of these same pack pipelines (make_envelope_covers.py,
pdf_merge.py, build_general_pack.py): python-docx raises
`ValueError("All strings must be XML compatible...")` when a tender's own
OCR'd/human-typed text contains a stray control character.

sanral_fill.py writes the Excel-side of the SANRAL pack (fill_tender.py's
RRM family, fill_conventional.py's Conventional family) directly as raw XML
via lxml instead of going through openpyxl (see this module's own header
comment on why) - the same library python-docx is built on, and the same
crash is reachable there too: Workbook.set_value() is this file's one real
free-text writer, with zero sanitization before this fix.

Uses a real committed SANRAL sample (templates/samples/) rather than a
synthetic file, the same convention test_sanral_b7.py already uses -
set_value() only edits the in-memory XML tree, never writes back to the
sample file on disk unless .save() is called, which this test never does.

Run: python3 engine/test_sanral_fill.py
"""
import os
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sanral_fill import Workbook  # noqa: E402

SAMPLE = os.path.join(HERE, "..", "templates", "samples", "R.334-030-2025.1F_ran.xlsm")
SHEET = "TEND 1X"

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


print("Workbook.set_value(): a control character anywhere in a free-text value must not crash the write")
wb = Workbook(SAMPLE)
try:
    wb.set_value(SHEET, "B4", "Jane\x0bSmith")
    crashed = False
except ValueError:
    crashed = True
check("a vertical-tab control character does not crash set_value()", not crashed)

t = wb._cell_el(SHEET, "B4").find(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
check("the control character itself is stripped, not left in the written value",
      t is not None and "\x0b" not in (t.text or ""), repr(t.text if t is not None else None))
check("the surrounding real text survives unchanged", t is not None and t.text == "JaneSmith",
      repr(t.text if t is not None else None))

wb2 = Workbook(SAMPLE)
wb2.set_value(SHEET, "B4", "Ordinary Name")
t2 = wb2._cell_el(SHEET, "B4").find(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
check("an ordinary name with no control characters is written unchanged (no over-stripping)",
      t2 is not None and t2.text == "Ordinary Name", repr(t2.text if t2 is not None else None))

print("\nStanding review (2026-11-09): Workbook.__init__ decompresses EVERY zip "
      "member into memory unconditionally, before any real structure check runs - "
      "a SEPARATE path from engine/general/requirements.py's docx/zip-bundle "
      "guards, since every uploaded .xlsm/.xlsx reaches this exact class "
      "(engine/intake/classify_tender.py's classify_workbook(), among others) "
      "with no subprocess boundary. Must be capped the same way.")
with tempfile.TemporaryDirectory() as d:
    # A small, perfectly plausible .xlsm on disk whose one bogus, otherwise
    # unused member decompresses to gigabytes - doesn't need to look like a
    # real workbook at all, since __init__ reads every member before ever
    # checking xl/workbook.xml.
    bomb = os.path.join(d, "bomb.xlsm")
    chunk = b"A" * (1024 * 1024)
    with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        zi = zipfile.ZipInfo("xl/junk.bin")
        zi.compress_type = zipfile.ZIP_DEFLATED
        with z.open(zi, "w", force_zip64=True) as f:
            for _ in range(4000):  # ~3.9GB decompressed from a ~3.9MB file
                f.write(chunk)
    bomb_mb = os.path.getsize(bomb) / (1024 * 1024)
    check(f"the bomb fixture itself is a realistic upload size (~{bomb_mb:.1f}MB, "
          "under the app's 4.4MB/50MB upload caps)", bomb_mb < 4.4, bomb_mb)
    try:
        Workbook(bomb)
        check("Workbook() rejects the bomb instead of fully decompressing it", False, "no exception raised")
    except ValueError as e:
        check("Workbook() raises a clean ValueError, not an unbounded parse", "guard" in str(e), str(e))
    except MemoryError:
        check("Workbook() rejects the bomb instead of fully decompressing it", False, "MemoryError - guard did not run")

# A genuinely ordinary, real sample workbook must still open normally - the
# guard must not false-positive on a real document.
wb3 = Workbook(SAMPLE)
check("a real sample workbook still opens normally, unaffected by the guard",
      SHEET in wb3.sheet_path, list(wb3.sheet_path))

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): " + ", ".join(FAILS))
    sys.exit(1)
print("\n0 failure(s)")
