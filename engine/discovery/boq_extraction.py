"""
Real BOQ (bill of quantities) line-item extraction from a buyer's own priced
schedule spreadsheet (.xlsx/.xlsm) - the "future real-extraction pass" that
tender_scope_records.boq_summary's own column comment (migration 0060) and
tender_enrichment.detect_boq_reference()'s own docstring both anticipated
("no BOQ/.xlsm line-item parser exists in this repo... real BOQ line-item
extraction would need a new document-reading pipeline").

Deterministic spreadsheet parsing, not an LLM call - a quantity or a rand
amount deserves exact parsing from the cell that actually holds it, not a
model's best guess at one (same "we stop, we never guess" principle as
engine/fill_financial.py's own docstring, applied here to a document read
instead of a hand-captured figure).

Reuses engine/sanral_fill.Workbook (this repo's own hand-rolled .xlsx/.xlsm
reader - zip + XML, stdlib only) rather than adding a third-party spreadsheet
library: no openpyxl (or anything else) exists anywhere in this repo today
(confirmed by grep before writing this module), and the daily discovery
pipeline is deliberately pure standard library
(.github/workflows/daily-discovery.yml's own comment: "No pip install step").
Workbook already did everything this needs except read a sheet's shape
without already knowing which cell holds what - sheet_grid()/sheet_names(),
added to Workbook for this module (a narrowly-scoped, read-only extension;
every existing Workbook caller - fingerprint.py, fill_financial.py, this
file's own SANRAL-specific code - is untouched and reads known, fixed cell
references exactly as before).

Different buyers' BOQ templates vary enormously (column order, header
wording, a title/preamble before the real table starts, merged
section-heading rows, a "provisional sum" row with no quantity) - this is
handled the way a real parser should, not by assuming a fixed layout:

  1. The header row is found by matching each cell's text against likely
     column-name VARIANTS (HEADER_PATTERNS below) - never assumed to sit at
     a fixed row/column. "description" and "quantity" are the minimum two
     columns required to trust a row as a real header (REQUIRED_HEADER_COLUMNS);
     unit/rate/amount are read when present, left null otherwise.
  2. Every row below the header becomes an item ONLY when it has a non-empty
     description, isn't a total/subtotal/carried-forward/page-break row
     (_SKIP_ROW_RE - a BOQ workbook's own running subtotals are real rows in
     the sheet but are not line items), AND has at least one real number in
     quantity/rate/amount - a row with text in the description column but no
     number anywhere is far more likely a narrative note, instruction or
     footer/signature line that happened to land in the same column as the
     real descriptions, never a genuine priced line item.
  3. Before an item set is trusted, most of its rows must actually have a
     parseable numeric quantity (MIN_NUMERIC_QUANTITY_RATIO) - a header match
     that is really a coincidence (some other table's "Description"/"Qty"
     columns) shows up here as a quantity column full of blanks or text, and
     is rejected rather than returned as a real BOQ.
  4. A sheet whose header can't be confidently identified, or whose item set
     fails the numeric-quantity check, is skipped in favour of the next sheet
     in the workbook (the priced schedule is rarely the first sheet - a BOQ
     workbook usually opens on a cover/instructions/pricing-summary sheet
     first). If NO sheet in the workbook qualifies, items stays [] with an
     honest note explaining why - never a fabricated line item from a sheet
     this genuinely can't read.

Item shape (tender_scope_records.boq_summary.items - a plain jsonb array with
no fixed schema of its own; this is the shape this module writes, documented
here since there is no new migration to carry it, per this task's own brief):

    {"description": str, "unit": str | None, "quantity": number | None,
     "rate_zar": number | None, "amount_zar": number | None}

Numeric cells are parsed with award_outcomes.parse_rand() - the same SA
comma/period decimal-vs-thousands heuristic already proven on real tender
text (see that module's own docstring) - rather than a second hand-rolled
parser; it already handles a plain number, "1 234,50", "R 45 000.00", etc.,
and passes a cell that is already a Python int/float straight through.

Usage (dry run on one local file, prints what would be stored):
    python3 engine/discovery/boq_extraction.py <path-to-boq.xlsx>
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
sys.path.insert(0, HERE)
import sanral_fill  # noqa: E402
import award_outcomes  # noqa: E402  (parse_rand)


# ---------------------------------------------------------------------------
# Header column detection
# ---------------------------------------------------------------------------

# Checked case-insensitively against a cleaned (whitespace-collapsed, trimmed)
# cell value. Real headers seen across different buyers' own BOQ/pricing-
# schedule templates while building this - extend this list from a real
# template that doesn't match, never from a guess.
HEADER_PATTERNS = {
    "description": [
        "description", "item description", "particulars", "particulars / description",
        "particulars/description", "activity description", "item", "activity",
        "description of works", "description of item", "brief description",
    ],
    "unit": ["unit", "uom", "unit of measure", "units", "unit of measurement"],
    "quantity": ["qty", "quantity", "qty.", "est qty", "est. qty", "estimated quantity", "quantities", "no. off"],
    "rate": ["rate", "unit rate", "rate (r)", "rate(r)", "unit rate (excl vat)", "unit rate (r)", "rate excl vat"],
    "amount": ["amount", "total", "amount (r)", "amount(r)", "total price", "total amount",
               "extended price", "total (r)", "total excl vat"],
}

REQUIRED_HEADER_COLUMNS = ("description", "quantity")  # minimum to trust a row as a real header
MAX_HEADER_SEARCH_ROWS = 60  # a real BOQ's header sits well within this; a cover page is short
MIN_CONFIDENT_ITEMS = 1  # at least one real row below the header - an empty table isn't a BOQ
MIN_NUMERIC_QUANTITY_RATIO = 0.5  # majority of matched rows should have a parseable quantity


def _clean_header(v):
    return re.sub(r"\s+", " ", str(v or "")).strip().lower()


def _clean_description(v):
    return re.sub(r"\s+", " ", str(v or "")).strip()


def match_header_cell(value):
    """The column key(s) this header cell's text matches - usually 0 or 1. A
    cell matching more than one key is ambiguous and the caller skips it
    rather than guessing which one it meant."""
    cleaned = _clean_header(value)
    if not cleaned:
        return []
    return [col for col, variants in HEADER_PATTERNS.items() if cleaned in variants]


def detect_header_row(grid):
    """The first row in `grid` ([(row_number, {col_letter: value}), ...], as
    Workbook.sheet_grid() returns) that looks like a real BOQ header: matches
    at least REQUIRED_HEADER_COLUMNS, each to a DIFFERENT column letter (two
    header labels landing on the same column is a sign this isn't really a
    header row - never resolved by picking one). Returns
    (row_number, {column_key: col_letter}) or (None, None) when nothing
    within MAX_HEADER_SEARCH_ROWS qualifies."""
    for row_number, cells in grid:
        if row_number > MAX_HEADER_SEARCH_ROWS:
            break
        found = {}
        ambiguous = False
        for col_letter, value in cells.items():
            for key in match_header_cell(value):
                if key in found and found[key] != col_letter:
                    ambiguous = True
                found[key] = col_letter
        if ambiguous:
            continue
        if all(k in found for k in REQUIRED_HEADER_COLUMNS):
            return row_number, found
    return None, None


# ---------------------------------------------------------------------------
# Row -> item parsing
# ---------------------------------------------------------------------------

_SKIP_ROW_RE = re.compile(
    r"^(sub[\s-]?)?total\b|^grand\s+total\b|^vat\b|^page\s+\d+\b|"
    r"^carried\s+(forward|down)\b|^brought\s+(forward|down)\b|^c/f\b|^b/f\b|^notes?:?\s*$",
    re.I,
)


def extract_items_from_grid(grid, header_row, columns):
    """[{"description", "unit", "quantity", "rate_zar", "amount_zar"}, ...]
    for every row after `header_row` with a non-empty description that isn't
    a total/subtotal/carry-forward row. A column this sheet's header didn't
    match stays None for every item - never inferred or fabricated."""
    items = []
    desc_col = columns.get("description")
    unit_col = columns.get("unit")
    for row_number, cells in grid:
        if row_number <= header_row:
            continue
        description = _clean_description(cells.get(desc_col) if desc_col else None)
        if not description or _SKIP_ROW_RE.match(description):
            continue
        item = {"description": description, "unit": None, "quantity": None, "rate_zar": None, "amount_zar": None}
        if unit_col and cells.get(unit_col) not in (None, ""):
            item["unit"] = _clean_description(cells[unit_col])
        for key, field in (("quantity", "quantity"), ("rate", "rate_zar"), ("amount", "amount_zar")):
            col = columns.get(key)
            if col and cells.get(col) not in (None, ""):
                item[field] = award_outcomes.parse_rand(cells[col])
        # A row with real text in the description column but NO numeric value
        # anywhere (quantity/rate/amount all None) is far more likely a
        # narrative note, an instruction or a footer/signature line that
        # happened to land in the same column as the real descriptions, not
        # an actual priced line item - every genuine BOQ row has at least one
        # number attached to it. Skip it rather than counting it as an item
        # with nothing real in it (same "never fabricate, never guess"
        # discipline as the rest of this module).
        if item["quantity"] is None and item["rate_zar"] is None and item["amount_zar"] is None:
            continue
        items.append(item)
    return items


# ---------------------------------------------------------------------------
# Whole workbook
# ---------------------------------------------------------------------------

def parse_boq_workbook(path_or_file):
    """{"items": [...], "note": str, "sheet": str|None, "header_row": int|None}.

    Tries every sheet in turn (the priced schedule is rarely the first sheet)
    and keeps the first one with a confident header AND an item set that
    passes the numeric-quantity sanity check. `path_or_file` is anything
    zipfile.ZipFile accepts - a filesystem path or a file-like object
    (io.BytesIO), so a document already downloaded into memory doesn't need
    to touch disk first.

    items is always [] with an honest `note` when nothing in the workbook can
    be confidently read as a priced schedule - never a fabricated line item
    from a sheet this can't actually parse (same "we stop, we never guess"
    principle as engine/fill_financial.py)."""
    try:
        wb = sanral_fill.Workbook(path_or_file)
    except Exception as e:
        return {"items": [], "sheet": None, "header_row": None,
                "note": f"Could not be opened as a readable spreadsheet ({type(e).__name__}: {e}) - only "
                        ".xlsx/.xlsm workbooks can be parsed for BOQ line items."}

    attempts = []
    for sheet in wb.sheet_names():
        try:
            grid = wb.sheet_grid(sheet)
        except Exception as e:
            attempts.append(f"'{sheet}': could not be read ({type(e).__name__}: {e})")
            continue
        header_row, columns = detect_header_row(grid)
        if header_row is None:
            attempts.append(f"'{sheet}': no row in the first {MAX_HEADER_SEARCH_ROWS} rows matched a confident "
                            "description+quantity header")
            continue
        items = extract_items_from_grid(grid, header_row, columns)
        if len(items) < MIN_CONFIDENT_ITEMS:
            attempts.append(f"'{sheet}': header matched at row {header_row} but no item rows followed it")
            continue
        numeric_qty = sum(1 for it in items if it["quantity"] is not None)
        # A genuine Preliminaries & General bill (and some smaller tenders'
        # ENTIRE priced schedule) is routinely all lump-sum: "Allow a lump sum
        # for site establishment" with a real rand Amount and no Quantity/Rate
        # at all - quantity is implicitly 1, left blank in the buyer's own
        # template. Rejecting every row of a sheet like that as a "coincidental
        # header match" (confirmed live: a real P&G-shaped sheet came back
        # with 0 items) throws away a genuine priced schedule. A real line
        # item still needs a real, non-zero rand value somewhere - this is
        # deliberately NOT relaxed to "any numeric field", since the sibling
        # false-positive case this module already guards against (a
        # returnables checklist whose "Quantity" column is Yes/No/Unclear)
        # has a literal 0 placed in its own Amount column for every row, and
        # a uniform zero is itself the tell that it isn't real pricing.
        numeric_priced = sum(1 for it in items if it["rate_zar"] not in (None, 0) or it["amount_zar"] not in (None, 0))
        if numeric_qty / len(items) < MIN_NUMERIC_QUANTITY_RATIO and numeric_priced / len(items) < MIN_NUMERIC_QUANTITY_RATIO:
            attempts.append(f"'{sheet}': header matched at row {header_row} but only {numeric_qty}/{len(items)} rows "
                            f"had a numeric quantity and only {numeric_priced}/{len(items)} had a real, non-zero "
                            "rate or amount - likely a coincidental header match, not a real priced schedule")
            continue
        return {"items": items, "sheet": sheet, "header_row": header_row,
                "note": f"Parsed {len(items)} line item(s) from sheet '{sheet}' (header row {header_row})."}

    note = "No sheet in this workbook could be confidently parsed as a priced BOQ schedule."
    if attempts:
        note += " Checked: " + "; ".join(attempts)
    return {"items": [], "sheet": None, "header_row": None, "note": note}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    args = ap.parse_args()
    result = parse_boq_workbook(args.path)
    print(json.dumps(result, indent=2, default=str))
    return 0 if result["items"] else 1


if __name__ == "__main__":
    sys.exit(main())
