"""
Fills the SANRAL Financial Submission workbook - MECHANICAL FIELDS ONLY.

Deliberately does NOT touch: the Hours sheets, C3.x pricing detail, Pricing
Schedule, F1 Forecast sheets, ADJ sheets, or SUMMARY TENDERED FEE. Those are the
actual BOQ / commercial bid figures - only the tenderer can decide what to charge
and how many hours to tender. Never guessed, never auto-generated, same rule the
Technical workbook's C2.4 handling already follows.

Confirmed real input cells (unlocked, non-formula - checked directly against the
live file's XML, not assumed):
  TENDERER INPUT DATA!D1  - company name (C1 holds the label, not the input)
  TENDERER INPUT DATA!C12 - Project Leader's name (B12/D12 are formulas - position
                            code and designation are pulled from elsewhere; never
                            write them)
  TENDERER INPUT DATA!C13 - Design Specialist 1's name (same: B13/D13 are formulas)

PL (row 12) and DS1 (row 13) are confirmed - not assumed - across 5 real downloaded
contracts (R.334-030, R.343-020, R.352-030, R.352-020, R.394-010-2025/1F), 2026-10-15:
each file's own B/D columns (formulas, never written to) were read back and all 5
agree: row 12 = PL / "Project Leader", row 13 = DS1 / "Design Specialist 1 - Pavement
and Materials". Keyed by position CODE, not by the Technical workbook's internal
block_row scheme (37/137 etc.) - the Financial workbook's own TENDERER INPUT DATA
table is literally laid out one row per position code, so this is the natural key, not
an assumption carried over from a different sheet's internal numbering. A contract
whose SETUP sheet lists a position code not in ROW_FOR_POSITION needs that row
confirmed against ITS OWN file before adding it here - never assumed from this list.

Usage: python3 fill_financial.py <template.xlsm> <pack.yaml> <output.xlsm>
"""
import sys
import yaml
from sanral_fill import Workbook

SHEET = "TENDERER INPUT DATA"

# position code (as used in the pack's key_persons list, read from the Technical
# workbook's own SETUP sheet) -> the row on THIS sheet holding that position's name
# field. Confirmed across 5 real contracts - see module docstring.
ROW_FOR_POSITION = {"PL": 12, "DS1": 13}


def row_for_position(wb, code):
    """The TENDERER INPUT DATA row whose own column-B position code (a formula
    SANRAL fills from the tender's SETUP sheet - its cached value is what the
    shipped file shows) equals `code`, searched over the key-person rows
    12-31. Form-Field-Audit 2026-10-18: only PL (12) and DS1 (13) were known,
    because all six samples tender exactly PL + DS1, so a tender with any other
    position (DS2, CE, RE ...) lost its whole Financial workbook. The fixed
    rows remain the fallback when the cached codes aren't there to read."""
    want = str(code or "").strip().upper()
    for r in range(12, 32):
        if str(wb.cached(SHEET, f"B{r}") or "").strip().upper() == want and want:
            return r
    return ROW_FOR_POSITION.get(code)


def main(tpl, pack_path, out):
    pack = yaml.safe_load(open(pack_path))
    wb = Workbook(tpl)

    wb.set_value(SHEET, "D1", pack["company"]["name"])

    for kp in pack["key_persons"]:
        row = row_for_position(wb, kp.get("position"))
        if row is None:
            raise ValueError(
                f"Position '{kp.get('position')}' has no row on this Financial workbook's TENDERER INPUT DATA sheet "
                "(its column B lists the tender's key positions) - fill the name in by hand"
            )
        person = pack["people"][kp["person"]]
        wb.set_value(SHEET, f"C{row}", person["name"])

    wb.save(out)
    print(f"Wrote {out}: {len(wb.log)} cell writes (mechanical fields only - "
          f"hours/pricing sheets untouched)")


if __name__ == "__main__":
    main(*sys.argv[1:4])
