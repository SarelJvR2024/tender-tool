"""
Captures and fills the ONE part of the Financial Submission workbook that is
genuinely just "how many hours will this person work" rather than a pricing
decision: the 7 "Hours <Discipline>" sheets (Roadworks, Structures,
Electrical, Building, Mechanical, Electronic, Other) that feed FORM C2.4 FIN
and the Workplan Appropriateness score (30 of 100 evaluation points per the
tender data - see docs/specs).

Confirmed by direct inspection of a real file (R.334-030-2025.1F Financial
Submission, 2026-10-16), not assumed: all 7 sheets share an identical layout -
4 categories (A-D) at rows 7/29/51/73, each with a PL row (base+1) and a DS1
row (base+2). Column E on each key-person row is a plain value (no <f> tag),
confirmed as the real unlocked input cell; columns B/C/F/G on the same rows
all carry formulas (position label, rate lookup, computed amount) and must
never be written to.

This deliberately stops at the Hours sheets. SUMMARY TENDERED FEE's "Tendered
fee" column, checked the same day, turned out to ALSO be a formula (rolling up
from the Pricing Schedule / C3.x sheets, not a direct input) - confirming
fill_financial.py's existing rule still holds: the actual bid price lives
deeper in sheets this pipeline does not touch, because only the tenderer
decides what to charge. Hours are different: they're real planning data
(how many hours PL/DS1 will actually spend), not a commercial decision, which
is why this module exists and that one doesn't.

Never fills a capture that still has a null hours value - that would silently
turn "nobody has supplied this yet" into what looks like a completed zero.

Usage:
    python3 fill_financial_hours.py suggest <pack.yaml> <out_capture.yaml>
    python3 fill_financial_hours.py fill <financial.xlsm> <capture.yaml> <out.xlsm> [provenance_out.json]
"""
import sys
import yaml
from sanral_fill import Workbook
from provenance import ProvenanceLog

DISCIPLINE_SHEETS = [
    "Hours Roadworks", "Hours Structures", "Hours Electrical",
    "Hours Building", "Hours Mechanical", "Hours Electronic", "Hours Other",
]
CATEGORY_BASE_ROWS = {"A": 7, "B": 29, "C": 51, "D": 73}
KEY_PERSON_OFFSET = {"PL": 1, "DS1": 2}


def suggest(pack_path, out_path):
    """Writes a blank capture skeleton for a human to fill in - every hours
    value starts as null, never 0 or a guess. Only lists the key persons and
    disciplines actually confirmed in the pack; anything else (additional
    non-key staff, other disciplines) isn't in scope until it's in the pack."""
    pack = yaml.safe_load(open(pack_path))
    positions = [kp["position"] for kp in pack["key_persons"] if kp["position"] in KEY_PERSON_OFFSET]

    capture = {
        "_note": (
            "Fill in real hours per discipline/category/position below - null "
            "means 'not supplied yet', not zero. Leave a discipline's whole "
            "block out entirely if no hours are tendered against it at all. "
            "fill_financial_hours.py refuses to run while any value here is "
            "still null."
        ),
        "contract": pack.get("_provenance", {}).get("contract"),
        "hours": {
            sheet.replace("Hours ", ""): {
                cat: {pos: None for pos in positions} for cat in CATEGORY_BASE_ROWS
            }
            for sheet in DISCIPLINE_SHEETS
        },
    }
    yaml.safe_dump(capture, open(out_path, "w"), sort_keys=False, allow_unicode=True)
    print(f"Wrote blank capture skeleton to {out_path} - fill in real hours before running 'fill'")


def fill(tpl, capture_path, out, provenance_out=None):
    capture = yaml.safe_load(open(capture_path))
    wb = Workbook(tpl)
    log = ProvenanceLog(source="fill_financial_hours.py")

    missing = []
    writes = 0
    for sheet_key, categories in capture["hours"].items():
        sheet = f"Hours {sheet_key}"
        if sheet not in DISCIPLINE_SHEETS:
            raise ValueError(f"Unknown discipline sheet '{sheet}' in capture file")
        for cat, positions in categories.items():
            if cat not in CATEGORY_BASE_ROWS:
                raise ValueError(f"Unknown category '{cat}' in capture file")
            base = CATEGORY_BASE_ROWS[cat]
            for pos, hours in positions.items():
                if pos not in KEY_PERSON_OFFSET:
                    raise ValueError(f"Unknown position '{pos}' in capture file")
                field_key = f"financial_hours.{sheet_key}.{cat}.{pos}"
                if hours is None:
                    missing.append(f"{sheet_key}/{cat}/{pos}")
                    continue
                row = base + KEY_PERSON_OFFSET[pos]
                wb.set_value(sheet, f"E{row}", hours)
                # Confirmed, not computed: this number came straight from a human-
                # supplied capture file (see suggest()'s own refusal-while-null rule),
                # never calculated or guessed by this script.
                log.confirmed(field_key, hours)
                writes += 1

    if missing:
        raise ValueError(
            f"Refusing to fill: {len(missing)} hours value(s) are still null "
            f"(not supplied yet): {', '.join(missing[:10])}"
            + (f" ... and {len(missing) - 10} more" if len(missing) > 10 else "")
        )

    wb.save(out)
    if provenance_out:
        log.save(provenance_out)
        print(f"Wrote {provenance_out}: {len(log.entries)} provenance entries")
    print(f"Wrote {out}: {writes} hours entries written across {len(DISCIPLINE_SHEETS)} discipline sheets")
    return log


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "suggest":
        suggest(sys.argv[2], sys.argv[3])
    elif cmd == "fill":
        fill(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else None)
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
