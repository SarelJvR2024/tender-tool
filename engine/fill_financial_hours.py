"""
Captures and fills the ONE part of the Financial Submission workbook that is
genuinely just "how many hours will this person work" rather than a pricing
decision: the 7 "Hours <Discipline>" sheets (Roadworks, Structures,
Electrical, Building, Mechanical, Electronic, Other) that feed FORM C2.4 FIN
and the Workplan Appropriateness score (30 of 100 evaluation points per the
tender data - see docs/specs).

Confirmed by direct inspection of a real file (R.334-030-2025.1F Financial
Submission, 2026-10-16), not assumed: all 7 sheets share an identical layout -
4 categories (A-D) at rows 7/29/51/73, each with up to 20 key-person rows
(base+1..base+20, row_for_position() below) before a fixed base+21 "OTHER:
Various non-key personnel" catch-all row. Column E on each key-person row is
a plain value (no <f> tag), confirmed as the real unlocked input cell;
columns B/C/F/G on the same rows all carry formulas (position label - read
dynamically from the tender's own key-person list, never assumed to be
PL/DS1 only; rate lookup; computed amount) and must never be written to.

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
import math
import sys
import yaml
from sanral_fill import Workbook
from provenance import ProvenanceLog

DISCIPLINE_SHEETS = [
    "Hours Roadworks", "Hours Structures", "Hours Electrical",
    "Hours Building", "Hours Mechanical", "Hours Electronic", "Hours Other",
]
CATEGORY_BASE_ROWS = {"A": 7, "B": 29, "C": 51, "D": 73}
# Fallback only (see row_for_position() below) - the real shipped file's own
# PL/DS1 rows, for the rare case the cached formula values aren't there to
# read (e.g. a hand-built test fixture).
KEY_PERSON_OFFSET = {"PL": 1, "DS1": 2}
# Rows base+1..base+20 are each a live key-person slot (confirmed directly
# against the real file's XML - row 8's own B8 is `=IF(DATA!A1051="","",
# DATA!A1051)`, row 9 reads A1052, incrementing one row at a time); row
# base+21 is the fixed "OTHER: Various non-key personnel" catch-all and is
# never a named position's own row.
MAX_PERSON_OFFSET = 20


def row_for_position(wb, sheet, base, code):
    """The Hours-sheet row, within this category's own key-person block
    (base+1..base+MAX_PERSON_OFFSET - base+(MAX_PERSON_OFFSET+1) is the fixed
    "OTHER" catch-all, never a named position), whose own cached column-B
    position code equals `code` - read dynamically from the real shipped
    file, same approach and same reasoning as fill_financial.py's own
    row_for_position() (Form-Field-Audit, 2026-10-18): that sibling function
    used to hardcode PL->row 12/DS1->row 13 because all 6 real samples it was
    built from tender exactly those two positions, and a tender with any
    other position (DS2, CE, RE...) lost its whole Financial workbook. The
    identical hardcoded-offset shape (KEY_PERSON_OFFSET = {"PL": 1, "DS1": 2})
    was never swept into THIS sibling file, confirmed live against the real
    "Hours Roadworks" sheet's own XML: B8/B9 are each a live formula reading
    the tender's own key-person list off the DATA sheet, not a fixed
    PL/DS1-only pair - rows 10-27 are the SAME kind of cell, just empty on
    every one of the 6 real samples on file (all of which tender only PL +
    DS1), so a tender that confirms a THIRD or further key person (a second
    Design Specialist, a Contracts Engineer, a Resident Engineer - all real
    SANRAL key-position codes per engine/discovery/key_person_minimums.py's
    own POSITION_CODES) had that person's hours silently excluded from the
    capture skeleton suggest() built (never even offered to the human to
    fill in) and, if added to the capture file by hand anyway, outright
    refused by fill() ("Unknown position") - losing the WHOLE Hours capture
    for every discipline/category, not just that one position's row, since
    fill() raises before wb.save() runs. QA pass, 2026-11-11 (Finding 417)."""
    want = str(code or "").strip().upper()
    if want:
        for offset in range(1, MAX_PERSON_OFFSET + 1):
            r = base + offset
            if str(wb.cached(sheet, f"B{r}") or "").strip().upper() == want:
                return r
    return base + KEY_PERSON_OFFSET[code] if code in KEY_PERSON_OFFSET else None


def suggest(pack_path, out_path):
    """Writes a blank capture skeleton for a human to fill in - every hours
    value starts as null, never 0 or a guess. Lists every key person actually
    confirmed in the pack (not just PL/DS1 - the real Hours sheets have a row
    for any confirmed key position, see row_for_position() above) and every
    discipline; anything else (additional non-key staff, other disciplines)
    isn't in scope until it's in the pack."""
    pack = yaml.safe_load(open(pack_path))
    positions = [kp["position"] for kp in pack["key_persons"]]

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
                row = row_for_position(wb, sheet, base, pos)
                if row is None:
                    raise ValueError(
                        f"Position '{pos}' has no row on this Financial workbook's '{sheet}' sheet for category "
                        f"{cat} - fill it in by hand"
                    )
                field_key = f"financial_hours.{sheet_key}.{cat}.{pos}"
                if hours is None:
                    missing.append(f"{sheet_key}/{cat}/{pos}")
                    continue
                # math.isfinite() rules out NaN/+-inf too - `hours < 0` alone
                # does not: NaN compares False to everything, and inf/nan are
                # both `isinstance(..., float)`, so a capture.yaml value of
                # `.nan`/`.inf` (valid YAML 1.1 float literals PyYAML's own
                # safe_load parses without complaint) used to sail straight
                # through this guard and get written as a literal <v>nan</v>/
                # <v>inf</v> numeric-cell value - not valid per the numeric
                # cell's own XML Schema type, and a real corruption risk on
                # the actual SANRAL Financial Submission workbook. QA pass,
                # 2026-10-28.
                if (not isinstance(hours, (int, float)) or isinstance(hours, bool)
                        or not math.isfinite(hours) or hours < 0):
                    raise ValueError(
                        f"{sheet_key}/{cat}/{pos}: hours must be a real, finite, non-negative number, got "
                        f"{hours!r} ({type(hours).__name__}) - fix the capture file, don't guess"
                    )
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
