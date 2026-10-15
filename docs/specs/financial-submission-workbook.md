# SANRAL Financial Submission workbook — structure (first pass)

The original specification flagged this workbook as a complete unknown: "The SANRAL Financial
Submission workbook is not specified yet. Wait for Sarel to share an example." On 2026-10-15 a
real example arrived (`R.334-030-2025.1F- Conventional Consultant Tender - Financial Submission
ran.xlsm`, part of the real tender pack for one of the 6 tenders closing 2026-10-22). This is a
first structural pass, not a full cell-map like the Technical Submission workbook has — treat
everything below as **Observed**, nothing **Assumed**, per this project's own labelling
convention.

## Observed basics

- 45 sheets, 220 zip parts, has a `vbaProject.bin` (macros present, not yet analysed).
- Unlike the Technical Submission workbook, this one has **zero form-control dropdowns**
  detected by the engine's existing control-mapping code — it's almost entirely numeric/text
  input and formulas, not multi-choice selections. A different input-detection strategy will be
  needed here (likely: unlocked, non-formula cells, same rule as the Technical workbook, just
  without the dropdown layer).

## Sheet groups (by name, in file order)

| Group | Sheets |
|---|---|
| Entry point | `TENDERER INPUT DATA` |
| Hours by discipline | `Non Fee Hours`, `Hours Roadworks`, `Hours Structures`, `Hours Electrical`, `Hours Building`, `Hours Mechanical`, `Hours Electronic`, `Hours Other`, `All Hours` |
| Key-person financial summary | `FORM C2.4 FIN` (the financial counterpart to the Technical workbook's `FORM C2.4 TECH`) |
| Forecasting | `F1 Forecast Combined`, `F1 Forecast Consultant`, `F1 Forecast Contractor`, `F1 Cover` |
| Payment/pricing detail | `Pg 1 Payment` … `Pg 10 Calc of COW` (10 pages: payment, scheduled sum, travel, P-sums, additional duties, WAF with/without CPI, penalties, CPI, calculation of cost of work) |
| Pricing schedule detail | `C3.2` … `C3.10` |
| Adjustments | `ADJ-Summary`, `ADJ-1` … `ADJ-5` |
| Other | `Travel Log`, `Pricing Schedule`, `SUMMARY TENDERED FEE`, `Notes`, `DATA` |

## Confirmed input cells (Observed)

- `TENDERER INPUT DATA!C1` — company name (labelled "TENDERER COMPANY NAME:"). Note at `B6`:
  "SERVICE PROVIDER TO COMPLETE ALL CELLS HIGHLIGHTED IN YELLOW" — same yellow-cell convention
  as the Technical workbook, with the same caveat already learned there (L1 in the main spec):
  yellow is a hint, not the ground truth — unlocked/non-formula is the real test.
- `TENDERER INPUT DATA!B12:D32` — a key-person summary table, one row per position code (`PL` =
  Project Leader, `DS1` = Design Specialist 1 - Pavement and Materials, etc. — same position
  codes as the Technical workbook's SETUP sheet), with a name column and a designation column.
  Row 32 is `OTHER` / "Various non-key personnel" for hours that don't belong to a named key
  person. A note at `B4` explains alternate key persons inherit the original's hours if they
  have to step in — this answers part of spec open issue I8/Q7 (alternate positions): hours
  don't need a separate entry for alternates.
- `FORM C2.4 FIN!B3` — project/contract number; `B4` — project description (both pre-filled by
  SANRAL, same as the Technical workbook's SETUP sheet — never overwrite).
  `E10`/`E11` — total hours tendered / total normalised hours (same two totals the Technical
  workbook's `FORM C2.4 TECH!E10`/`E11` expects — **this is where the actual C2.4 figures the
  spec lists as "pending from the user for every tender" actually get entered**, confirming spec
  open issue I2's answer lives in the Financial, not the Technical, workbook).
  Below that: a per-key-person breakdown (position, name, hours tendered, % of total hours, % of
  key-persons-hours-only) — currently showing `#DIV/0!` because no hours are filled in yet on
  this blank example.
- `SUMMARY TENDERED FEE!G1` — tenderer name (same "please insert on input data sheet"
  instruction). A phase-proportion table (`Concept Design`, `Preliminary Design`, `Detailed
  Design`, `Administration & Monitoring`, `Close out`) per work-type row (`Road works`, etc.) —
  this is SANRAL's own fee-phasing data, pre-filled, not a tenderer input.

## Not yet done

This is a first pass to unblock understanding, not a finished cell-map. Still needed before the
engine could fill this workbook the way it fills the Technical one: the full input-cell
inventory (unlocked/non-formula scan across all 45 sheets), the C3.x pricing-detail sheets'
structure, and the ADJ-1..5 adjustment sheets' purpose. Flagging as future work rather than
guessing at it now.
