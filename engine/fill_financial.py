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

Only PL (row 12) and DS1 (row 13) are confirmed for this contract (it only has
those two SETUP positions). A contract with more key positions would need more
rows mapped here - not assumed, add them once confirmed against that contract's
own file, the same way these two were.

Usage: python3 fill_financial.py <template.xlsm> <pack.yaml> <output.xlsm>
"""
import sys
import yaml
from sanral_fill import Workbook

SHEET = "TENDERER INPUT DATA"

# block_row (as used in the Technical workbook / pack's key_persons list) -> the
# row on THIS sheet holding that position's name field. Confirmed for this
# contract only - see module docstring.
ROW_FOR_BLOCK = {37: 12, 137: 13}


def main(tpl, pack_path, out):
    pack = yaml.safe_load(open(pack_path))
    wb = Workbook(tpl)

    wb.set_value(SHEET, "D1", pack["company"]["name"])

    for kp in pack["key_persons"]:
        row = ROW_FOR_BLOCK.get(kp.get("block_row"))
        if row is None:
            raise ValueError(
                f"No confirmed TENDERER INPUT DATA row for block_row {kp.get('block_row')} - "
                "add it to ROW_FOR_BLOCK only after confirming against this contract's own file"
            )
        person = pack["people"][kp["person"]]
        wb.set_value(SHEET, f"C{row}", person["name"])

    wb.save(out)
    print(f"Wrote {out}: {len(wb.log)} cell writes (mechanical fields only - "
          f"hours/pricing sheets untouched)")


if __name__ == "__main__":
    main(*sys.argv[1:4])
