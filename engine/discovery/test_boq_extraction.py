"""
Tests for engine/discovery/boq_extraction.py - real BOQ line-item parsing off
a .xlsx/.xlsm workbook via sanral_fill.Workbook (+ its sheet_grid()/
sheet_names() extension).

No real buyer BOQ file is shipped here (none exists in this repo and a real
one would be a large, buyer-specific binary fixture) - instead every test
builds a MINIMAL, VALID .xlsx in memory with raw zipfile/XML (no openpyxl:
this repo has no spreadsheet-WRITING library either, same reasoning as
sanral_fill.py's own module docstring for why it doesn't use one for
reading). This still exercises the real path: Workbook opens real zip/XML
bytes, sheet_grid() reads them, detect_header_row()/extract_items_from_grid()
run on the real decoded cell values - nothing here is mocked.

    python3 engine/discovery/test_boq_extraction.py
"""
import io
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, ENGINE)
import sanral_fill  # noqa: E402
import boq_extraction as boq  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


# ---------------------------------------------------------------------------
# Minimal .xlsx builder - raw zipfile/XML, no third-party library, mirroring
# sanral_fill.py's own "no openpyxl" discipline.
# ---------------------------------------------------------------------------

def _cell_xml(ref, value):
    if isinstance(value, str):
        escaped = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return f'<c r="{ref}" t="inlineStr"><is><t>{escaped}</t></is></c>'
    return f'<c r="{ref}"><v>{value}</v></c>'


def _sheet_xml(rows):
    body = []
    for i, row in enumerate(rows, start=1):
        cells = []
        for j, value in enumerate(row):
            if value is None:
                continue
            col = sanral_fill.n2col(j + 1)
            cells.append(_cell_xml(f"{col}{i}", value))
        if cells:
            body.append(f'<row r="{i}">' + "".join(cells) + "</row>")
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData>' + "".join(body) + '</sheetData></worksheet>')


def make_workbook_bytes(sheets):
    """sheets: {sheet_name: [[cell, ...], ...]} -> a minimal, valid .xlsx."""
    names = list(sheets)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + "".join(
                f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                for i in range(len(names)))
            + "</Types>")
        z.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="xl/workbook.xml"/></Relationships>')
        sheets_xml = "".join(f'<sheet name="{n}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, n in enumerate(names))
        z.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<sheets>{sheets_xml}</sheets></workbook>')
        rels_xml = "".join(
            f'<Relationship Id="rId{i + 1}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{i + 1}.xml"/>' for i in range(len(names)))
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + rels_xml + "</Relationships>")
        for i, name in enumerate(names):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", _sheet_xml(sheets[name]))
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_basic_boq_parsed_with_totals_excluded():
    data = make_workbook_bytes({"BOQ": [
        ["Description", "Unit", "Qty", "Rate", "Amount"],
        ["Excavate trenches in all materials", "m3", 120, 85.5, 10260],
        ["Supply and lay 300mm diameter pipe", "m", 450, 650, 292500],
        ["Sub Total", None, None, None, 302760],
        ["Backfill and compact in layers", "m3", 120, 45, 5400],
        ["Total", None, None, None, 308160],
    ]})
    result = boq.parse_boq_workbook(io.BytesIO(data))
    check(result["sheet"] == "BOQ", f"should parse the BOQ sheet, got {result['sheet']}")
    check(len(result["items"]) == 3, f"should extract exactly 3 real line items, got {len(result['items'])}")
    descs = [it["description"] for it in result["items"]]
    check("Sub Total" not in descs and "Total" not in descs, "subtotal/total rows must never become line items")
    first = result["items"][0]
    check(first["description"] == "Excavate trenches in all materials", f"wrong description: {first}")
    check(first["unit"] == "m3", f"unit should be read, got {first['unit']}")
    check(first["quantity"] == 120, f"quantity should be parsed as a number, got {first['quantity']}")
    check(first["rate_zar"] == 85.5, f"rate should be parsed as a number, got {first['rate_zar']}")
    check(first["amount_zar"] == 10260, f"amount should be parsed as a number, got {first['amount_zar']}")


def test_header_wording_variants_still_detected():
    """A different buyer's own template, different header wording, same real
    shape - must still be parsed, not require an exact SANRAL-style header."""
    data = make_workbook_bytes({"Pricing Schedule": [
        ["Item Description", "UOM", "Est. Qty", "Unit Rate (R)", "Total (R)"],
        ["Mobilisation and establishment", "sum", 1, 150000, 150000],
        ["Traffic accommodation for duration of works", "month", 18, 22000, 396000],
    ]})
    result = boq.parse_boq_workbook(io.BytesIO(data))
    check(len(result["items"]) == 2, f"should still detect the header and parse 2 items, got {result}")
    check(result["items"][1]["quantity"] == 18, f"quantity wrong: {result['items'][1]}")


def test_no_confident_header_leaves_items_empty_with_note():
    """A table with no quantity-like column at all (a returnable-schedule
    checklist, not a priced BOQ) must never be guessed at - items stays []
    with an honest explanation, not a fabricated line item."""
    data = make_workbook_bytes({"Returnables": [
        ["Document", "Required", "Submitted"],
        ["Tax clearance certificate", "Yes", "Yes"],
        ["B-BBEE certificate", "Yes", "No"],
    ]})
    result = boq.parse_boq_workbook(io.BytesIO(data))
    check(result["items"] == [], f"no BOQ-shaped table should ever produce items, got {result['items']}")
    check(bool(result["note"]), "an honest note must explain why nothing was parsed")
    check(result["sheet"] is None, "no sheet should be reported as the source when nothing was confidently parsed")


def test_non_numeric_quantity_column_rejected_as_false_positive():
    """A header row that happens to literally contain the words
    "description"/"quantity" but whose quantity column is text, not numbers,
    must be rejected - a coincidental header match is not a real BOQ. (Every
    row here also has no rate/amount, so the "at least one real number"
    item rule already empties it - still rejected, just honestly reported as
    "no item rows followed it" rather than a numeric-ratio failure; both are
    the same real outcome: items stay [].)"""
    data = make_workbook_bytes({"Sheet1": [
        ["Description", "Quantity"],
        ["Is a site visit compulsory", "Yes"],
        ["Is subcontracting permitted", "No"],
        ["Is a CIDB grading required", "Unclear"],
    ]})
    result = boq.parse_boq_workbook(io.BytesIO(data))
    check(result["items"] == [], f"a non-numeric 'quantity' column must be rejected, got {result['items']}")
    check(bool(result["note"]), "an honest note must explain why nothing was parsed")

    # The numeric-ratio rejection path specifically: a header row with a
    # genuine description+quantity match where MOST rows have a number in
    # some OTHER column (so they survive the "at least one number" item
    # rule) but the quantity column itself is not numeric for most of them.
    mixed = make_workbook_bytes({"Sheet1": [
        ["Description", "Quantity", "Amount"],
        ["Is a site visit compulsory", "Yes", 0],
        ["Is subcontracting permitted", "No", 0],
        ["Is a CIDB grading required", "Unclear", 0],
    ]})
    result2 = boq.parse_boq_workbook(io.BytesIO(mixed))
    check(result2["items"] == [], f"a non-numeric quantity column must still be rejected, got {result2['items']}")
    check("numeric quantity" in result2["note"] or "false-positive" in result2["note"] or "coincidental" in result2["note"],
          f"the note should explain the numeric-ratio rejection reason, got {result2['note']!r}")


def test_footer_note_in_the_description_column_is_not_fabricated_as_an_item():
    """A narrative note/signature line that happens to land in the same
    column as real descriptions, but carries NO number at all, must never be
    counted as a line item - every real BOQ row has at least one number."""
    data = make_workbook_bytes({"BOQ": [
        ["Description", "Unit", "Qty", "Rate", "Amount"],
        ["Excavate trenches in all materials", "m3", 120, 85.5, 10260],
        ["All rates to be read in conjunction with the specification", None, None, None, None],
        ["Signed on behalf of the Contractor: ______________", None, None, None, None],
    ]})
    result = boq.parse_boq_workbook(io.BytesIO(data))
    check(len(result["items"]) == 1, f"only the real, numbered row should become an item, got {result['items']}")
    check(result["items"][0]["description"] == "Excavate trenches in all materials",
          f"the one real item should be kept, got {result['items']}")


def test_skips_cover_sheet_and_finds_the_real_table_on_a_later_sheet():
    """A real BOQ workbook usually opens on an instructions/cover sheet
    before the priced schedule - the parser must try every sheet, not just
    the first, and report which one it actually used."""
    data = make_workbook_bytes({
        "Instructions": [
            ["Tenderers must complete this Bill of Quantities in full."],
            ["Prices are in South African Rand, excluding VAT."],
        ],
        "BOQ": [
            ["Description", "Unit", "Qty", "Rate", "Amount"],
            ["Supply and install streetlight poles", "no", 24, 8500, 204000],
        ],
    })
    result = boq.parse_boq_workbook(io.BytesIO(data))
    check(result["sheet"] == "BOQ", f"should skip the cover sheet and parse the real BOQ sheet, got {result['sheet']}")
    check(len(result["items"]) == 1, f"should find the one real item, got {result['items']}")


def test_unreadable_file_returns_honest_note_never_crashes():
    result = boq.parse_boq_workbook(io.BytesIO(b"this is not a zip file at all"))
    check(result["items"] == [], "an unreadable file must never produce fabricated items")
    check("opened" in result["note"], f"the note should say it couldn't be opened, got {result['note']!r}")


def main():
    test_basic_boq_parsed_with_totals_excluded()
    test_header_wording_variants_still_detected()
    test_no_confident_header_leaves_items_empty_with_note()
    test_non_numeric_quantity_column_rejected_as_false_positive()
    test_footer_note_in_the_description_column_is_not_fabricated_as_an_item()
    test_skips_cover_sheet_and_finds_the_real_table_on_a_later_sheet()
    test_unreadable_file_returns_honest_note_never_crashes()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
