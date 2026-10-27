"""
Offline tests for fingerprint.py's named_ranges(), the one function found to
silently collapse real structural differences (QA pass, 2026-10-27 - see its
own docstring). No network, no real SANRAL template required: a minimal
synthetic .xlsm built in-memory, just enough structure for sanral_fill.Workbook
to open it (xl/workbook.xml, its rels, two blank worksheet parts).

Run: python3 engine/test_fingerprint.py   (exit 1 on any failure)
"""
import io
import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sanral_fill import Workbook  # noqa: E402
import fingerprint as fp  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _synthetic_workbook(defined_names_xml):
    wb_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="SheetA" sheetId="1" r:id="rId1"/>
<sheet name="SheetB" sheetId="2" r:id="rId2"/>
</sheets>
{defined_names_xml}
</workbook>'''
    rels_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>'''
    sheet_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", wb_xml)
        z.writestr("xl/_rels/workbook.xml.rels", rels_xml)
        z.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        z.writestr("xl/worksheets/sheet2.xml", sheet_xml)
    buf.seek(0)

    tmp = tempfile.NamedTemporaryFile(suffix=".xlsm", delete=False)
    tmp.write(buf.getvalue())
    tmp.close()
    try:
        return Workbook(tmp.name)
    finally:
        os.unlink(tmp.name)


# --- named_ranges(): two sheets, each with their OWN "_xlnm.Print_Area" -------
# Excel auto-creates one of these per sheet the moment any sheet has a print
# area set - the same name, genuinely different ranges. Confirmed reachable
# in this repo's own real committed baseline (fingerprints/Conventional_
# Consultant_Tender.json), which shows exactly one despite being a
# multi-sheet workbook.
wb = _synthetic_workbook('''<definedNames>
<definedName name="_xlnm.Print_Area" localSheetId="0">SheetA!$A$1:$B$2</definedName>
<definedName name="_xlnm.Print_Area" localSheetId="1">SheetB!$A$1:$C$9</definedName>
</definedNames>''')
result = fp.named_ranges(wb)
check("two sheet-scoped names with the same Excel name both survive, not collapsed to one",
      len(result) == 2, result)
check("SheetA's own print area is present under its own key",
      result.get("_xlnm.Print_Area#sheet0") == "SheetA!$A$1:$B$2", result)
check("SheetB's own print area is present under its own key, distinct from SheetA's",
      result.get("_xlnm.Print_Area#sheet1") == "SheetB!$A$1:$C$9", result)

# --- a workbook-scoped name (no localSheetId) keeps its bare name, unchanged ---
wb2 = _synthetic_workbook('''<definedNames>
<definedName name="MarkupCost">'[1]Break down'!$L$5</definedName>
</definedNames>''')
result2 = fp.named_ranges(wb2)
check("a workbook-scoped name (no localSheetId) is keyed by its bare name, same as before this fix",
      result2 == {"MarkupCost": "'[1]Break down'!$L$5"}, result2)

# --- no <definedNames> element at all -> {} ------------------------------------
wb3 = _synthetic_workbook("")
check("no definedNames element at all returns an empty dict, not an error", fp.named_ranges(wb3) == {})

# --- diff() actually catches a change only visible once names are disambiguated
stored = {"named_ranges": {"_xlnm.Print_Area#sheet0": "SheetA!$A$1:$B$2",
                            "_xlnm.Print_Area#sheet1": "SheetB!$A$1:$C$9"}}
current_changed = {"named_ranges": {"_xlnm.Print_Area#sheet0": "SheetA!$A$1:$B$2",
                                     "_xlnm.Print_Area#sheet1": "SheetB!$A$1:$C$20"}}  # SheetB's own area widened
changes, _ = fp.diff({**stored, "family": "x", "sheet_names": [], "zip_part_count": 0,
                       "dropdown_counts": {}, "dropdown_total": 0, "macro": {"present": False}},
                      {**current_changed, "family": "x", "sheet_names": [], "zip_part_count": 0,
                       "dropdown_counts": {}, "dropdown_total": 0, "macro": {"present": False}})
check("a change to just ONE sheet's own named range is now caught by diff() (would have been invisible before this fix)",
      any(c[0] == "named_ranges" for c in changes), changes)

print(f"\n{len(FAILS)} failure(s)")
if FAILS:
    sys.exit(1)
