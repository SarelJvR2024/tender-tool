# SANRAL Tender Preparation Automation — Specification

**Status labels used throughout this document**
- **Observed** — seen directly in a file, a script, a command output or a user message during the work this document is based on.
- **Assumed** — believed to be true but not proven. Each is something to confirm before relying on it.

Nothing in this document was invented. Where a fact is unknown it is written as **Unknown**. Real personal data (names, ID numbers, registration numbers, phone numbers) is replaced by placeholders such as `<PERSON_FULL_NAME>`.

**Purpose.** The work in this document completes SANRAL tender-submission Excel workbooks (`.xlsm`) with company and key-person (CV) data, and produces the print-report PDFs that SANRAL's own buttons would print. **Observed:** the tenderer's stated standard is that the files must be 100% accurate and "not tampered with", because they are submitted as part of real tenders and evaluated.

**Full source code:** the complete scripts (`sanral_fill.py`, `fill_conventional.py`, `fill_tender.py`, `print_reports.py`) are reproduced verbatim in Appendix A of the full file `SANRAL_Tender_Automation_Specification.md` delivered in the chat session and stored at `/mnt/user-data/outputs/SANRAL_Tender_Automation_Specification.md`. This Drive copy carries sections 1–9 in full; see section 9 for locations.

---

## 1. Files

### 1.1 Input files (per tender)

| # | File kind | Observed facts |
|---|---|---|
| 1.1.1 | SANRAL technical-submission workbook `.xlsm` (one per tender or per bundle of contracts) | Observed: two **template families** exist (see 2.1). File names carry the contract number, e.g. `R.<NNN>-<NNN>-2025_1F_<suffix>.xlsm`. SANRAL pre-fills the SETUP sheet (contract number, closing date, required positions). |
| 1.1.2 | Data pack `*.yaml` (company, people, projects, key-person assignments, targeted-enterprise block, optional C2.4 figures) | Observed: written by us, one pack per template family. Placeholder version in 4.4. |
| 1.1.3 | User-supplied source documents | Observed: one empty "WCP 2A" template `.xlsx` and one manually completed form (NRA 0238) used as a reference for what "correct" looks like. Contents are not reproduced here. |

### 1.2 Tool files (the engine)

| # | File | Role |
|---|---|---|
| 1.2.1 | `sanral_fill.py` | Raw-XML editor for `.xlsm`: set values, set form-control dropdowns **by label**, set dates (three dropdowns), save. |
| 1.2.2 | `fill_conventional.py` | Orchestrator for the **Conventional Consultant Tender** family. |
| 1.2.3 | `fill_tender.py` | Orchestrator for the **RRM Consultant Tender** family. |
| 1.2.4 | `print_reports.py` | Generates the print-report PDFs headless with LibreOffice, replicating SANRAL's macro page set-up. |
| 1.2.5 | `packs/conventional.yaml`, `packs/_common.yaml` | The data packs (real data; **not** reproduced — see 4.4 for the placeholder form). |

### 1.3 Output files (per tender)

| # | Output | Observed facts |
|---|---|---|
| 1.3.1 | `<tender>_FILLED.xlsm` | The completed workbook. Observed: same number of ZIP parts as the template (Conventional: 1031; RRM: 1450); 82 parts differ from the template in the Conventional runs; `xl/vbaProject.bin` is byte-identical to the template. |
| 1.3.2 | `pdfs/<tender>/*.pdf` | Conventional tenders: 6 PDFs each: `01 Forms B1-B2 Position 1.pdf`, `02 Forms B1-B2 Position 2.pdf`, `Form B3.pdf`, `Form B4.pdf`, `Form B5.pdf`, `Form B7.pdf`. RRM tenders (single key-person slot filled): 5 PDFs (`01 Forms B1-B2 Position 1.pdf`, B3, B4, B5, B7). |
| 1.3.3 | Per-tender ZIP: folder `<tender>/` containing the `.xlsm` and its PDFs | Observed: 7 files + 1 folder entry. |
| 1.3.4 | `SANRAL_Conventional_Tenders_ALL.zip` | One ZIP with a sub-folder per Conventional tender (used for WhatsApp/other sharing). |

### 1.4 The seven Conventional tender files processed (Observed)

`R.334-030-2025.1F_ran`, `R.334-030-2025.1F_ran1`, `R.343-020-2025_1F_final`, `R.352-030-2025-1F_run`, `R352-020-2025_1F_Run`, `R.394-010-2025_1F_run`, `R.396-010-2025_1F_run`.
Observed: the user confirmed to "run both" `ran` and `ran1` (treated as two separate submissions). **Assumed:** they really are separate submissions (not yet confirmed — see 8.2).
Also processed earlier (RRM family): five RRM tenders plus two `X.002-…` batch files (the `X.002-188-2023-1F` file and a combined `X.002-247-2026-1F` + `X.002-191-2023-1F` file).

---

## 2. Workbook structure

### 2.1 Two template families (Observed)

| Property | RRM Consultant Tender | Conventional Consultant Tender |
|---|---|---|
| Sheets | 15 | 9: `TEND 1X`, `B6 - Scoring - Past Performance`, `WORKINGS MATRIX`, `Annex 1 PSP Perf. Report`, `Reference Letter for PP`, `Affidavit for Past Performance`, `FORM C2.4 TECH`, `Proj Relevance Codes`, `SETUP` |
| ZIP parts | 1450 | 1031 |
| Form-control dropdowns / checkboxes / buttons | 873 / 471 / 8 | 867 / 89 / 16 |
| C2.4 sheets | six, one per bundled contract (`FORM C2.4 TECH  -TENDER n`) | one (`FORM C2.4 TECH`) |
| Typical SETUP positions | `CE1` ×3 (combined tender) | `PL`, `DS1`, plus alternates (`ALT`) in slots 11 and 12 |
| `TEND 1X` layout of Forms B1–B7 | identical offsets | identical offsets |

### 2.2 `TEND 1X` map (Observed; identical in both families unless noted)

| Area | Cells | Meaning |
|---|---|---|
| Tenderer name | `D1` | Input (text) |
| Company status & BEE | `H34` (status, e.g. QSE), `K33` (B-BBEE level, whole number 1–9; SANRAL ships 9), `L33` (black ownership %) | **Unlocked inputs but not yellow** (see 5.3) |
| Contract bundle list (RRM) | rows 17, 19, 21 … (`D` = contract, `F` = YES/NO) | Shipped pre-filled by SANRAL. Observed values in RRM outputs: all `YES`. Conventional files have no such rows. |
| Key-person blocks, Forms B1/B2 | block *n* starts at row `37 + 100·(n−1)`; primary positions 1–10 = rows 37…937; **alternate positions 11–20 = rows 1037…1937** (column H of the block header reads "ALTERNATE KEY POSITION") | One block per position |
| Form B3 (project structure) | rows 3337–3425; inputs `F3339` head office, `F3340` other offices, `F3341` ECSA count, `F3342` SACPCMP count, `F3344` total employees, `F3345` JV share %; `E3337` Partner-1 name and `F3346` partners/directors list **left blank** | |
| Form B4 (quality systems) | rows 3438–3561 | No inputs written |
| Form B5 (management proposal) | rows 3638–3761 | No inputs written |
| Form B6 (past-performance scoring) | rows 3838–3857 | Observed: no cached values in this range in a filled Conventional file |
| Form B7 (targeted enterprise) | rows 3901–3951; inputs `C3906` name, `J3906` EME/QSE, `M3906` % of contract, `D3908` % black ownership, `H3908` B-BBEE level, `M3908` % excluding provisional sums | Unlocked, not yellow |
| BEE score areas | `BB4000:BW4316`, `CB4000:CW4316` | Observed: no cached values in a filled Conventional file |
| Notes to Tenderer | `CS1:DH60` | Static text |

### 2.3 Key-person block internals (offsets relative to block start row *b*; Observed)

| Item | Cell | Type |
|---|---|---|
| Name | `B(b+4)` | text |
| ID number | `E(b+4)` | number |
| Description / role | `I(b+4)` | text |
| Project *i* (i = 0,1,2) | row `b+10+i`: `B` client & number (text, may contain a line break); `C` client type (dropdown); `F` project type (dropdown); `I` value in Rm (number); `J` position held (text); `K` position code (dropdown); `L` contact (text); `M` contact number (text); start date = Year/Month/Day dropdowns at `P`,`Q`,`R` on the same row; end date = same triplet on row `b+15+i` | max 3 projects |
| Employment status | `H(b+35)` (dropdown) | |
| ECSA level (dropdown) / number / date | `D(b+39)` / `D(b+40)` / triplet at `P(b+40)` | |
| SACPCMP number / date | `F(b+40)` (Conventional only) / triplet at `P(b+41)` | |
| Highest qualification | level `H(b+39)` dropdown; description `J(b+39)`; institution `L(b+39)`; graduated triplet at `P(b+38)` | |
| Years of experience | `H(b+41)` dropdown | |
| Initial qualification | description `J(b+41)`; institution `L(b+41)`; graduated triplet at `P(b+39)` | |

(The exact arithmetic is in the `B` dictionary of `fill_conventional.py` — authoritative where this table is ambiguous. In that dictionary `Xnn` means column `X`, row offset `nn` from the block's first row.)

**Observed:** the visible "experience started/ended" (`G`/`H`) and qualification-date cells (`D`/`F`/`M`) are **formulas** chained through helper columns back to the Year/Month/Day dropdown triplets in `P/Q/R`. They are not inputs and must not be written.

### 2.4 Form controls (Observed)

- Dropdowns are legacy **form controls** (`xl/ctrlProps/ctrlPropN.xml`, `objectType="Drop"`), not data validation.
- A dropdown stores a **1-based index** in its linked cell (`fmlaLink`). The option list comes from `fmlaRange`. The attribute `sel` in the ctrlProp mirrors the index.
- A **date** is three dropdowns: Year (`P`), Month (`Q`), Day (`R`); list headers are the strings `Year`, `Month`, `Day` at index 1.

| Dropdown | List range (Observed) | Options (Observed, sample) |
|---|---|---|
| Client type | `'WORKINGS MATRIX'!$F$5:$F$12` | `National Roads Authority ` (trailing space), Concessionaire, Provincial Authority, Relevant SOE, Metro Council, Municipality, Private, Other |
| Project type | `SETUP!$B$10:$B$22` | NONE, MO/MA, MP/MS, DS, DI, DN, CD |
| Position code | `'WORKINGS MATRIX'!$C$80:$C$102` | PL, APL, DS, DA, CE, ACE, RE, ARE, RM, ARM, SMT, CM, SA, PL(Toll), ETS, DS(Toll), CE(Toll), CM(Toll), ETS(Toll), ES, MS, PE(E), Undefined |
| Employment | `'WORKINGS MATRIX'!$L$87:$L$89` | No Key Person offered / Key Person is NOT a full time employee of the tenderer / Key Person is a full time employee of the tenderer |
| ECSA level | `'WORKINGS MATRIX'!$O$41:$O$50` | Professional Engineer, Professional Engineering Technologist, Professional Certificated Engineer, Professional Engineering Technician, Candidate (×4), Unregistered, Unknown |
| Highest qualification | `'WORKINGS MATRIX'!$Q$66:$Q$86` | None … Bachelors Degree and Advanced Diplomas, Honours/Post Grad…, Masters Degree, Doctoral Degree, NQF 1–10 |
| Years of experience | `'WORKINGS MATRIX'!$B$199:$B$259` | 1 … (60 entries) |
| Year / Month / Day | `'WORKINGS MATRIX'!$C$200:$C$301`, `$D$200:$D$212`, `$E$200:$E$231` | Year 1950…; Jan…Dec; 1…31 |

### 2.5 SETUP sheet (Observed)

Row 2: `C2` contract number, `L2` "Subcontracting Compulsory" YES/NO. Row 3: `C3` closing date (Excel serial). Row 4: slot numbers 1–20 in columns `B…U`. Row 5: `ALT` marker above alternate slots. **Row 6: position codes per slot** (e.g. `B6=PL`, `C6=DS1`, `L6=PL` with `ALT`, `M6=DS1` with `ALT`). Row 7: descriptions; row 8: Managerial/Non-managerial. In the tender the position code of slot *p* (1-based, column `n2col(1+p)`) corresponds to block row `37 + 100·(p−1)`.
**Rule (Observed):** the pack must never override SETUP values — SANRAL pre-fills them.

### 2.6 Macros (Observed; read with `olevba`)

The macros only set **print area and page set-up**; none calls `PrintOut` or `ExportAsFixedFormat`. They are what the on-sheet buttons run before the user prints manually.

| Macro | Print area | Paper | Fit pages (wide × tall) | Top margin (in) |
|---|---|---|---|---|
| `PRINTB3` | `$A$3337:$N$3425` | A4 landscape | 1 × 1 | 0.5 |
| `PRINTB4` | `$A$3438:$N$3561` | A4 landscape | 1 × 2 | 0 |
| `PRINTB5` | `$A$3638:$N$3761` | A4 landscape | 1 × 2 | 0 |
| `PRINTB6` | `$A$3838:$N$3857` | A4 landscape | 1 × 1 | 0.5 |
| `printb7` | `$A$3901:$N$3951` | A4 landscape | 1 × 1 | 0.5 |
| `printposition1…20` | `A{37+100(p−1)}:N{+64}` (e.g. pos 1 `A37:N101`, pos 11 `A1037:N1101`) | A4 landscape | 1 × auto | 0.5 |
| `printtenderernotes` | `$CS$1:$DH$60` | A4 landscape | 1 × 2 | 0.5 |
| `PRINTBEE`, `PRINTBEE2`, `PRINTBEE3` | `BB4000:BW4098 / 4198 / 4316` | **A3** landscape | 1×1 / 1×2 / 1×3 | 0 / 0.5 / 0.5 |
| `PrintQSEBEE`, `PRINTQSEBEE2`, `PRINTQSEBEE3` | `CB4000:CW4098 / 4198 / 4316` | A3 landscape | 1×1 / 1×2 / 1×3 | 0 / 0.5 / 0.5 |
| `printre3`, `printare1-3`, `printmt1-3`, `printcm1-3`, `printsa1-3` | rows 2037…3301 (blocks of 100) | A4 landscape | 1 × auto | 0.5 |
| `gotonotes`, `notestocompiler`, `deletemacro`, `addlinebreak`, `adateadd`, `dscopy`, `newentrant`, `aaa`, `DropDown4488_Change` | — | — | — | not print macros (Observed names only; their bodies were not analysed in this work) |

**Observed gap:** the current `print_reports.py` generates positions 1–20, B3, B4, B5, B7 and Notes. It does **not** generate B6, the BEE/QSE-BEE A3 reports, or the position blocks at rows 2037–3301 (named positions `re/are/mt/cm/sa`). **Assumed:** these are not needed for the technical submission in the tenders handled (the B6 and BEE print ranges had no cached values in a filled Conventional file). Confirm with SANRAL's tender document.

### 2.7 Conditional formatting & protection (Observed / Unknown)

- Observed: Conventional `TEND 1X` has 184 expression-type conditional-format rules, mostly keyed to `$BF$4016`. **Unknown:** their detailed effect (not analysed).
- Observed: input cells are the **unlocked, non-formula** cells; protected cells are not editable by the user in Excel.
- Observed: the Conventional `TEND 1X` used range extends to row 6889 versus about 4413 for RRM. **Unknown:** what lies beyond row ~4400.

---

## 3. Process — step by step

### 3.1 Prerequisites (Observed)

| Item | Detail |
|---|---|
| Python 3 with `lxml` and `PyYAML` | used by `sanral_fill.py` and the orchestrators |
| LibreOffice (headless) with Python-UNO (`import uno`) | used by `print_reports.py`; the tool starts and stops its own `soffice` on a socket port `2100 + (pid % 1000)` with a temporary profile |
| Poppler tools (`pdftotext`, `pdftoppm`, `pdfinfo`) | verification only |
| Working directory | the folder holding `sanral_fill.py`, `fill_*.py`, `print_reports.py`, `packs/` |
| Run **without** `python -I` | Observed error: isolated mode drops the script directory from the import path → `ModuleNotFoundError: sanral_fill` |

### 3.2 Procedure for one tender

| Step | Action | Command / detail | Expected result |
|---|---|---|---|
| 1 | Keep the SANRAL file as received | Never edit it; work from a copy | Original untouched |
| 2 | Identify the family | Conventional: sheets include `B6 - Scoring - Past Performance` and a single `FORM C2.4 TECH`. RRM: six `FORM C2.4 TECH  -TENDER n` sheets | Choose `fill_conventional.py` or `fill_tender.py` |
| 3 | Read SETUP | `C2` contract number, `C3` closing date, row 6 position codes (slots 1–20; `ALT` in row 5) | Know which positions must be filled |
| 4 | Prepare the pack | Placeholder form in 4.4. Use `block_row` to pin a position to an exact block, or `position: <code>` to fill every SETUP slot with that code | Pack validates as YAML |
| 5 | Fill | `python3 fill_conventional.py <template.xlsm> packs/conventional.yaml <out_FILLED.xlsm>` (RRM: `fill_tender.py` and its pack) | Prints `Tender (from SANRAL template): contract <no> \| closes <date>`; ends `Wrote <out>: 142 cell writes` (Observed count for the Conventional pack with 2 key-person blocks). Prints `NOTE: no C2.4 figures in this pack yet …` when C2.4 is absent |
| 6 | Generate PDFs | `python3 print_reports.py <out_FILLED.xlsm> <pdf_dir> [report names…]` (no names = all defaults) | Prints `867 controls aligned to Excel positions, 866 dropdowns showing a selection` (Conventional; RRM = 873) and one `PDF …` line per file. Reports whose candidate name cell is empty are printed as `skipped (no candidate): …` |
| 7 | Verify | Checklist 6.4 | All checks pass |
| 8 | Package | `<tender>/` folder with the `.xlsm` and its PDFs → `<tender>.zip`; plus combined ZIP | Zip test passes; SHA-256 of ZIP members equals the verified output |
| 9 | Deliver | Send ZIPs; place in the filing locations in section 9 | |
| 10 | Later: C2.4 figures arrive | Add the `c2_4` block to the pack (4.3), re-run steps 5–8 | `E10`/`E11` filled (Conventional) |

### 3.3 Default PDF set

`print_reports.py` default = every "Position p" report whose key-person name cell (`B{37+100(p−1)+4}`) is non-empty, then `Form B3`, `Form B4`, `Form B5`, `Form B7`. File names: `NN Forms B1-B2 Position N.pdf` (two-digit prefix) and `Form B3.pdf` etc. `Notes to Tenderer` is available by name but is not in the default set.

### 3.4 What the PDF engine does (Observed)

1. Opens the workbook read-only in LibreOffice with date acceptance patterns `Y/M/D;M/D/Y;M/D`, system locale en-US and `StringConversion = 3` (so SANRAL's `yyyy/m/d` text-to-date formulas evaluate as in Excel).
2. Recalculates everything (`calculateAll`).
3. Aborts if the set of LibreOffice controls differs from the set of controls in the file; otherwise moves each dropdown to the cell anchor Excel stores (EMU → 1/100 mm), un-binds it from its cell so it only displays, and selects the item whose 1-based index is in the linked cell; sets button controls to not print.
4. For each report applies the page set-up copied from the macros (A4 landscape, 1 page wide, margins 0/0.5 in top, no header/footer, centred horizontally) and exports only the print area to PDF.
5. Never saves the workbook.

**Observed limitation:** these PDFs are **LibreOffice** output, not Excel output, and were never compared to a real Excel print.

### 3.5 Procedure when only C2.4 changes

Observed instruction from the user: C2.4 hours and budgets come later; "complete everything else so long and create all the pdfs so long we can later update and replace C2.4". Procedure: add the figures to the pack and regenerate the workbook (the whole pipeline is deterministic and idempotent from the original template). **Unknown:** whether a C2.4 PDF is required — the current tool does not generate one.

---

## 4. Data required

All values below are **placeholders**.

### 4.1 Company (per tenderer; same for every tender unless noted)

| Key | Cell | Type / allowed | Placeholder |
|---|---|---|---|
| `name` | `TEND 1X!D1` | text | `<TENDERER_LEGAL_NAME>` |
| `bee_level` | `K33` | whole number 1–9 | `<1-9>` |
| `black_ownership_pct` | `L33` | number (percent as typed, e.g. 100) | `<0-100>` |
| `status` | `H34` | text, e.g. `QSE` / `EME` | `<QSE\|EME\|…>` |
| `head_office` | `F3339` | text (city/town) | `<CITY>` |
| `other_offices` | `F3340` | number | `<N>` |
| `ecsa_registered` | `F3341` | number | `<N>` |
| `sacpcmp_registered` | `F3342` | number | `<N>` |
| `total_employees` | `F3344` | number | `<N>` |
| `jv_share_pct` | `F3345` | number | `<0-100>` |

### 4.2 Person (key person) and projects

| Key | Writes to (block start *b*) | Type | Placeholder / rule |
|---|---|---|---|
| `name` | `B(b+4)` | text | `<PERSON_FULL_NAME>` |
| `id_number` | `E(b+4)` | number (written via `int()`) | `<ID_NUMBER>` (string of digits in the pack) |
| `description` | `I(b+4)` | text | `<ROLE_DESCRIPTION>` |
| `employment` | `H(b+35)` dropdown | exact label from list 2.4 | `Key Person is a full time employee of the tenderer` |
| `qualifications.ecsa_level` | `D(b+39)` dropdown | label | `Professional Engineer` |
| `ecsa_number` | `D(b+40)` | text/number, optional | `<ECSA_NUMBER>` |
| `ecsa_date` | triplet at `P(b+40)` | ISO date, optional | `<YYYY-MM-DD>` |
| `sacpcmp_number` | `F(b+40)` (Conventional only) | optional | `<SACPCMP_NUMBER>` |
| `sacpcmp_date` | triplet at `P(b+41)` | ISO date, optional | |
| `highest_level` | `H(b+39)` dropdown | label | `Masters Degree` |
| `highest_description` | `J(b+39)` | text | `<DEGREE (DISCIPLINE)>` |
| `highest_institution` | `L(b+39)` | text, **short** (column L clips long text) | `<INSTITUTION>` |
| `highest_graduated` | triplet `P(b+38)` | ISO date | |
| `years_experience` | `H(b+41)` dropdown | integer, passed as string | `<N>` |
| `initial_description` / `initial_institution` / `initial_graduated` | `J(b+41)` / `L(b+41)` / triplet `P(b+39)` | text / text / ISO date | |
| `projects` | 1–3 entries; **more than 3 raises an error** | see below | |

Project (up to 3 per person; rows `b+10+i`, end dates rows `b+15+i`):

| Key | Cell | Type | Placeholder |
|---|---|---|---|
| `client_and_number` | `B` | text; `\n` allowed | `<CLIENT>\n<CONTRACT_NO>` |
| `client_type` | `C` dropdown | label (list 2.4) | `Relevant SOE` |
| `project_type` | `F` dropdown | label | `DS` |
| `value_rm` | `I` | number (Rm) | `<N>` |
| `position_held` | `J` | text | `<TITLE>` |
| `position_code` | `K` dropdown | label | `CE` |
| `contact` | `L` | text; `\n` allowed | `<CONTACT_NAME>\n<CONTACT_TITLE>` |
| `contact_number` | `M` | text | `<PHONE>` |
| `start`, `end` | triplets `P` | ISO dates | `<YYYY-MM-DD>` |

### 4.3 Tender-specific

| Key | Cells | Notes |
|---|---|---|
| `key_persons[]` = `{block_row: <int>, person: <key>}` or `{position: <code>, person: <key>}` | block start row(s) | `block_row` writes only that block. `position` fills **every** SETUP slot carrying that code, including `ALT` slots. Observed Conventional runs use `block_row: 37` (PL) and `block_row: 137` (DS1) |
| `targeted_enterprise` | `C3906` name, `J3906` status, `M3906` % of contract, `D3908` black ownership, `H3908` B-BBEE level, `M3908` % excl. provisional | Observed values written as typed by the user: status `EME`, 0.3, 1, 1, 0.3 (displayed as 30% / 30.00%) |
| `c2_4` (Conventional) | `FORM C2.4 TECH!E10` hours tendered, `E11` normalised hours | **Pending from user for all tenders**; the template carries only these two totals |
| `c2_4` (RRM) | per tender *n*: sheet `FORM C2.4 TECH  -TENDER n`: `E10`, `E11`, `B13` tender value incl. VAT, `E13` category | Pending |
| `overrides` | — | **Must not be present**; the script raises an error |

### 4.4 Placeholder pack (Conventional)

```yaml
company:
  name: <TENDERER_LEGAL_NAME>
  bee_level: <1-9>
  black_ownership_pct: <0-100>
  status: <QSE|EME|...>
  head_office: <CITY>
  other_offices: <N>
  ecsa_registered: <N>
  sacpcmp_registered: <N>
  total_employees: <N>
  jv_share_pct: <0-100>

people:
  person_a:
    name: <PERSON_FULL_NAME>
    id_number: "<ID_NUMBER>"
    description: <ROLE_DESCRIPTION>
    employment: Key Person is a full time employee of the tenderer
    projects: [project_1, project_2, project_3]
    qualifications:
      ecsa_level: Professional Engineer
      ecsa_number: <ECSA_NUMBER>
      ecsa_date: <YYYY-MM-DD>
      sacpcmp_number: <optional>
      sacpcmp_date: <optional YYYY-MM-DD>
      highest_level: Masters Degree
      highest_description: <DEGREE (DISCIPLINE)>
      highest_institution: <SHORT INSTITUTION NAME>
      highest_graduated: <YYYY-MM-DD>
      years_experience: <N>
      initial_description: <DEGREE (DISCIPLINE)>
      initial_institution: <INSTITUTION>
      initial_graduated: <YYYY-MM-DD>

projects:
  project_1:
    client_and_number: "<CLIENT>\n<CONTRACT_NO>"
    client_type: Relevant SOE
    project_type: DS
    value_rm: <N>
    position_held: <TITLE>
    position_code: CE
    contact: "<CONTACT_NAME>\n<CONTACT_TITLE>"
    contact_number: "<PHONE>"
    start: <YYYY-MM-DD>
    end: <YYYY-MM-DD>
  # project_2, project_3 ...

key_persons:
  - block_row: 37      # position 1 (SETUP B6)
    person: person_a
  - block_row: 137     # position 2 (SETUP C6)
    person: person_a   # Observed: the user instructed that one person fills both roles on these tenders

tender:
  targeted_enterprise:
    name: <NAME OR WORDING>
    status: EME
    pct_of_contract: <0-1>
    black_ownership: <value as typed>
    bee_level: <1-9>
    pct_excl_provisional: <0-1>
  # c2_4:                # add when figures arrive
  #   hours_tendered: <N>
  #   normalised_hours: <N>
```

---

## 5. Rules and validations

### 5.1 Hard rules built into the code (Observed in source)

| # | Rule | Where |
|---|---|---|
| R1 | **Never overwrite a cell that holds a formula** (`ValueError`) | `set_value` |
| R2 | A dropdown is set **by label**, matched case-insensitively and whitespace-trimmed against the options read from the template itself; an unknown label raises an error that lists the valid options | `set_dropdown` |
| R3 | Setting a dropdown writes the index to the linked cell and updates the `sel` attribute of **every** control linked to that cell | `set_dropdown` |
| R4 | Dates are only set through the Year/Month/Day triplet | `set_date` |
| R5 | A person may have at most 3 projects | `fill_person` |
| R6 | A `position` code must exist on SETUP row 6, and the corresponding Form B1 block must exist | `blocks_for` |
| R7 | The pack must not contain `tender.overrides` | orchestrators |
| R8 | `fullCalcOnLoad="1"` is set so Excel recalculates when the file opens | `save` |
| R9 | Only worksheet parts that were written to (plus `workbook.xml`) are re-serialised; all other parts, including `vbaProject.bin`, drawings and control files, are copied byte-for-byte (control `sel` edits are the exception — those ctrlProp files are rewritten) | `save` |
| R10 | PDF export aborts if LibreOffice's control set ≠ the file's control set, or a dropdown's linked cell differs from the bound cell | `fix_controls` |
| R11 | The PDF step never saves the workbook | `export` |
| R12 | RRM only: the script prints a WARNING if the Form B7 closing date (`F125`) differs from SETUP closing date, and if a bundled contract row is not YES or its C2.4 sheet has no value filled | `fill_tender.py` |

### 5.2 Content rules (Observed user instructions)

| # | Instruction |
|---|---|
| U1 | "100000% sure" — the files will be submitted; they must be correct and not tampered with. |
| U2 | For every tender, all contracts in the "TENDER n" YES/NO block must be **YES**, whether there are one, two or three. (Observed: in the RRM outputs all rows read YES; the scripts only report these rows and do not write them. **Unknown:** whether any row was changed by hand earlier.) |
| U3 | C2.4 hours/budgets come later; complete everything else now and generate all PDFs. |
| U4 | Past performance: "use what we had from the initial form". |
| U5 | One person (the pack's person) fills **both** key positions (PL and DS1) on the Conventional tenders. |
| U6 | Run both `ran` and `ran1` files. |
| U7 | NRA 0238 (reference form) "was correctly completed". |
| U8 | Progress reports to the user must be colour-coded tables (legend 🟢🔵🟡🔴⚪, four tables: recently done; waiting on me; what you do next; milestones with evidence). |

### 5.3 Rules learned from errors (Observed)

| # | Rule |
|---|---|
| L1 | **Inputs = unlocked, non-formula cells — not just yellow cells.** A yellow-only scan missed `K33`, `L33` and the Form B7 targeted-enterprise cells. Some yellow is an indexed-palette colour, not RGB, so colour tests alone are unreliable. |
| L2 | Check the lock/formula status of any cell the template asks the tenderer to complete before declaring the file complete. |
| L3 | Judge dropdown-overlaid cells from a **rendered image**, never from `pdftotext`: text extracted from the PDF includes ghost values of the cell hidden under the opaque control (a "17.00" scare was a false alarm for this reason). |
| L4 | Text in narrow columns (e.g. column L institution) can clip. Verify visually and shorten the wording. |
| L5 | Copy dropdown labels from the template's own list; do not retype. |

### 5.4 Never-do list

- Never use openpyxl (or any library that rewrites the package) on these files: it drops data validations, x14 extensions and the form controls. (Observed in an earlier attempt.)
- Never write to formula cells; never bypass the guard.
- Never modify `vbaProject.bin`, macros, sheet protection, sheet names, or other templates' structure.
- Never override SETUP values from a pack.
- Never fill alternate (ALT) blocks by `position` code unless intended — the code also matches the ALT slot.
- Never submit unverified: the user is relying on these files for real tenders.
- Never claim a PDF is "Excel-exact".

---

## 6. How the files are populated

### 6.1 Method (Observed)

1. The `.xlsm` is a ZIP of OOXML parts. `sanral_fill.py` loads every part into memory, edits worksheet XML with `lxml`, and writes a new ZIP in the original part order.
2. **Values:** the target `<c>` element is located (created in the correct row/column order if absent), children removed, then either `<v>` (number/bool) or `t="inlineStr"` with `<is><t xml:space="preserve">` (text) is written. Dates passed as `datetime.date` become Excel serial numbers.
3. **Dropdowns:** `controls[sheet][linked_cell]` → list of (ctrlProp part, list range). The label is resolved to a 1-based index against the live list, the index is written to the linked cell, and `sel="N"` is set in every ctrlProp linked to that cell.
4. **Dates:** Year, Month (three-letter English: `Jan`…`Dec`), Day dropdowns in adjacent columns starting at the Year cell.
5. **Save:** `calcPr fullCalcOnLoad="1"`; dirty sheets re-serialised; everything else copied.
6. Orchestrators (`fill_conventional.py`, `fill_tender.py`) map the pack onto cells using the offsets in 2.3 and 2.2.
7. PDFs: section 3.4.

### 6.2 What went wrong during the work, and the fix (Observed)

| # | Problem | Cost / impact | Fix |
|---|---|---|---|
| E1 | openpyxl dropped data validations, x14 extensions and form controls (earlier session) | Would have corrupted the template | Switched to raw-XML editing |
| E2 | Wrong assumption about which cells were date inputs; caught by the formula-overwrite guard | None (guard worked) | Traced the formula chains back to the Year/Month/Day triplets |
| E3 | RGB-only yellow detection missed indexed-palette yellow (earlier session) | Some inputs missed | Detect inputs by unlocked + non-formula |
| E4 | **Defect shipped:** the first delivery of the 7 Conventional files left `K33` at SANRAL's default **9**, `L33` blank, and the Form B7 targeted-enterprise cells blank | The first-delivered Conventional ZIPs (including the WhatsApp combined ZIP) carried wrong BEE data and an empty B7. **Unknown** whether the user had already used them | `fill_conventional.py` now writes `K33`, `L33` and the six B7 cells; all 7 files and PDFs regenerated, re-verified (7.2) and re-packaged |
| E5 | "17.00" years-experience in a PDF looked wrong | None — false alarm; hidden cell text under an opaque dropdown | Rule L3 |
| E6 | `python3 -I fill_conventional.py` → `ModuleNotFoundError` | None | Run without `-I` |
| E7 | Ad-hoc spot-check scripts used wrong offsets (name is at `b+4`, not `b`) | None | Rewrote using the `B` dictionary |
| E8 | Institution text clipped in narrow column L in PDFs | Would have shown cut-off text on a submission form | Changed pack text to a shorter form and regenerated; confirmed visually on 3 tenders |
| E9 | Reported "8 files per zip" | Wrong count (it is 7 files + 1 folder entry) | Corrected |
| E10 | Pack comment said the alternate slots were blocks "237/337" | Comment only (code uses explicit `block_row`) — wrong. The alternates are blocks **1037/1137** (positions 11/12) | Comment corrected |
| E11 | Email delivery failed: the mail tool needs inline base64 attachments, not feasible for the file sizes | Files not emailed | User told to download from the chat |
| E12 | Upload of outputs to Google Drive failed in an earlier session (cause not recorded) | Files not in Drive | **Unknown**; retry |

### 6.3 Known values the user typed that look odd (Observed; left exactly as given)

- Targeted-enterprise name wording contains the typo "afteer" (from the user's own source). It was kept verbatim and prints on Form B7.
- On the printed Form B7, the black-ownership value `1` displays as `100%` and the B-BBEE level displays as `1` (Observed in the rendered page).

### 6.4 Verification checklist (apply to every tender; Observed methods)

| # | Check | Method | Pass criterion |
|---|---|---|---|
| V1 | Package integrity | `zipfile.testzip()` | `None` |
| V2 | XML well-formed | parse every `.xml/.rels/.vml` part | 0 errors |
| V3 | Macro untouched | compare `xl/vbaProject.bin` bytes to the template | identical |
| V4 | Structure unchanged | same part count as the template; count parts that differ | Conventional: 1031 parts, 82 differ (Observed). **Assumed:** the 82 are `workbook.xml`, the `TEND 1X` sheet part and ctrlProp parts — the exact list was not recorded; re-derive it with a part-by-part byte comparison |
| V5 | Values | read back cells: `D1`, `K33`, `L33`, `H34`, `F3339…F3345`, `C3906…M3908`, every key-person field | equal to the pack |
| V6 | Dropdown labels | index → label via the list range | label equals the pack text |
| V7 | PDF page counts | `pdfinfo` | Position PDFs 2, B3 1, B4 2, B5 2, B7 1 (Observed for all 7 Conventional tenders) |
| V8 | No formula errors | `pdftotext` and grep `#REF! #VALUE! #NAME? #N/A #DIV/0!` | 0 matches |
| V9 | Text present | `pdftotext -layout` contains person, qualification, project and contact strings; role text `Project Leader` (pos 1) / `Design Specialist 1` (pos 2) | all present |
| V10 | Visual | render pages (`pdftoppm`) and look at them, especially dropdown-overlaid cells and narrow columns | no clipping, no overlap |
| V11 | Package equals verified output | SHA-256 of every ZIP member = SHA-256 of the verified file | identical |
| V12 | Excel opens it | open in real Excel with macros enabled, let it recalculate | **not yet done** — see 8.1 |

---

## 7. Tests and scenarios

### 7.1 Scenario catalogue

"Tested" means actually run in this work. "Not tested" means the code path exists or is expected but was not exercised.

| ID | Scenario | Input / condition | Expected behaviour | Status |
|---|---|---|---|---|
| S1 | New Conventional tender, one person fills PL and DS1 | `block_row` 37 and 137, one person | Two position PDFs + B3, B4, B5, B7 (6 PDFs); `Wrote … 142 cell writes` | Tested on 7 files |
| S2 | Two files for the same contract (`ran`, `ran1`) | same pack, two templates | Two independent outputs | Tested |
| S3 | RRM / combined tender with several contracts | one key-person slot filled (block 37); C2.4 sheets per contract; TENDER n rows YES | 5 PDFs; WARNING lines if a row is not YES or a C2.4 sheet is empty | Tested on earlier RRM files; **not re-verified in this session** |
| S4 | Fill by position code (`position: <code>`) | code on SETUP row 6 | Every slot with that code gets filled, including ALT slots | Code path exists; **not tested** |
| S5 | Position code not on SETUP | `position: XX` | `ValueError: Position 'XX' is not listed on this tender's SETUP sheet` | Not tested |
| S6 | Slot has no Form B1 block | | `ValueError … has no Form B1 block in this template` | Not tested |
| S7 | Dropdown label not in the list | e.g. `Master's Degree` | `ValueError: '…' is not an option for TEND 1X!<cell>. Options: [...]` | Not tested after the first runs; the lookup is case/space-insensitive |
| S8 | Pack tries to write a formula cell | | `ValueError: … holds a formula - refusing to overwrite` | Observed once (E2) — the guard worked |
| S9 | More than 3 projects for a person | | `ValueError: … form accepts 3 projects` | Not tested |
| S10 | Pack contains `tender.overrides` | | `ValueError` — SETUP is SANRAL's | Not tested |
| S11 | C2.4 figures absent | no `c2_4` key | Prints `NOTE: no C2.4 figures…`; C2.4 sheet(s) untouched | Tested (all 7 files) |
| S12 | C2.4 figures arrive later | `c2_4` added | `E10`, `E11` written (Conventional); RRM: `E10, E11, B13, E13` per sheet | Code path exists; **not tested** |
| S13 | Position with no candidate name | block name cell empty | PDF skipped, `skipped (no candidate): …` printed | Not tested (Position 2 PDF exists for Conventional because both blocks were filled) |
| S14 | New SANRAL template version | list changes or controls change | Lists are read from the template (auto-follow); if LibreOffice's control set ≠ file's, PDF export aborts | Not tested |
| S15 | Closing date mismatch between SETUP and Form B7 (RRM) | | WARNING printed | Observed in a user form: "closing date mismatch 14 vs 15 Sep" in the NRA 0238 reference form |
| S16 | Alternate (ALT) key positions (blocks 1037, 1137) | | Left blank in all outputs | **Not filled; no test** |
| S17 | Targeted enterprise not yet known | name = wording as typed by user, EME, 30% | B7 prints the wording, `EME`, `30%`, `100%`, `1`, `30.00%` | Tested (text + visual on one tender) |
| S18 | Reports not generated by the tool | B6, BEE A3 reports, `re/are/mt/cm/sa` blocks, C2.4 | No PDF | Gap — see 2.6 |
| S19 | Re-running the pipeline | same template + same pack | Same cell writes and same part set (deterministic) | Observed (7 files regenerated; counts identical) |
| S20 | Opening in Excel | | File opens; macros enabled; dropdowns show the same values; `fullCalcOnLoad` recalculates | **Not tested** |

### 7.2 Results observed for the 7 Conventional tenders after the BEE/B7 fix

| Check | Result (Observed) |
|---|---|
| ZIP integrity | all `testzip()` = `None` |
| XML well-formedness | 0 bad parts in each of the 7 files |
| `vbaProject.bin` | byte-identical to the template in all 7 |
| Parts | 1031 in template and output; 82 differ in each |
| `K33`, `L33`, `H34`, `D1` | `1`, `100`, `QSE`, tenderer name — all 7 |
| `C3906`, `J3906`, `M3906`, `D3908`, `H3908`, `M3908` | name wording, `EME`, `0.3`, `1`, `1`, `0.3` — all 7 |
| PDFs per tender | 6; pages 2, 2, 1, 2, 2, 1 for Position 1, Position 2, B3, B4, B5, B7 |
| Formula-error scan | 0 hits in every PDF |
| Text-presence check | all expected person/qualification/project/contact strings present in both position PDFs of all 7 tenders; role text correct |
| Package vs output | ZIP members' SHA-256 equal verified files in all 7 |
| Visual | Form B7 page rendered for one tender and checked (values and layout correct, see 8.1 I6 for blanks); position pages checked visually for 3 tenders before the B7 fix |
| LibreOffice message | `867 controls aligned to Excel positions, 866 dropdowns showing a selection` for every file — the "866 of 867" difference is **unexplained** (**Assumed:** one unused dropdown whose linked cell is blank/0) |

---

## 8. Open issues and questions

### 8.1 Open issues

| # | Issue | Status |
|---|---|---|
| I1 | **No file has been opened in real Excel.** PDFs are LibreOffice output. | Open — do V12; compare one PDF to an Excel print |
| I2 | **C2.4** hours/budgets pending from the user for every tender (Conventional: `E10`, `E11`; RRM: `E10`, `E11`, `B13`, `E13` per tender). | Waiting on user |
| I3 | `E3337` (Partner 1 name) and `F3346` (partners/directors and registration numbers) on Form B3 are blank in every output; also blank in the user's own completed NRA 0238 reference form. | Question Q2 |
| I4 | `E6` (quality-management-system type) left at SANRAL's default index 3 "System is an in-house production"; `G6` left at default 1. | Question Q3 |
| I5 | Form B4 asks to **attach** an ISO/QMS certificate or summary (≤ 2 A4 pages); Form B5 asks to **attach a preliminary programme** and summary (≤ 2 A4 pages). Neither attachment was provided or generated. | Question Q4 |
| I6 | Form B7 yellow cells still blank: location of Head Office, "based in Province of the project?", "Consulting Engineering Firm?", SARS tax reference, comments. (Targeted enterprise "will be identified after tender award".) | Question Q5 |
| I7 | **Past performance** (`B6 - Scoring - Past Performance`, `Annex 1 PSP Perf. Report`, `Reference Letter for PP`, `Affidavit for Past Performance`): the user said "use what we had from the initial form". The current scripts write nothing to these sheets; how this was handled earlier is **Unknown**. | Question Q6 |
| I8 | Alternate key positions (slots 11/12, blocks 1037/1137) are blank. | Question Q7 |
| I9 | In the RRM files only slot 1 is filled although SETUP lists `CE1` ×3. | Question Q8 |
| I10 | The RRM pack still has the longer institution wording; column-width clipping was fixed only for Conventional. **Unknown** whether RRM PDFs clip. | Re-check |
| I11 | The RRM outputs were not re-verified in this session (BEE `K33/L33` are written by `fill_tender.py`, but the delivered RRM files were not re-read). | Re-check |
| I12 | Sheet visibility differs between SANRAL's templates and the user's completed copy (some C2.4 tabs and SETUP hidden in the user's copy). | Unknown relevance |
| I13 | Closing date mismatch 14 vs 15 September noted in the NRA 0238 reference form. | Unknown which is right |
| I14 | Conventional `TEND 1X` used range runs to row 6889; rows ~4400–6889 not explored; conditional formatting (184 rules) not analysed. | Unexplored |
| I15 | The verification scripts (XML check, structure audit, content/PDF checks) lived in a temporary scratch folder and are **not part of the persisted tool**. | Re-create from 6.4 |
| I16 | Google Drive upload of the outputs failed earlier (cause not recorded). | Retry |

### 8.2 Questions for the user

| # | Question |
|---|---|
| Q1 | Are `ran` and `ran1` for `R.334-030-2025` two separate submissions (or one superseding the other)? |
| Q2 | Provide Partner-1 name (`E3337`) and the partner/director list with registration numbers (`F3346`) — or confirm they stay blank. |
| Q3 | Confirm the quality-management type (`E6`) and `G6` value, or confirm the SANRAL defaults are correct. |
| Q4 | Will B4 (QMS summary/certificate) and B5 (programme + management summary) be attached separately, or should content be generated? |
| Q5 | Should the blank yellow Form B7 cells stay blank until award? |
| Q6 | Which past-performance data goes into B6/Annex 1/Reference Letter/Affidavit, and from which source? |
| Q7 | Should alternate key positions (PL-ALT, DS1-ALT) be filled, and with whom? |
| Q8 | For RRM files listing `CE1` ×3, should all three be filled? |
| Q9 | Provide the C2.4 figures per tender when known. |
| Q10 | Which closing date is correct where 14 vs 15 Sep conflicts? |

---

## 9. File locations

| What | Location | Notes |
|---|---|---|
| Original SANRAL templates (Conventional ×7, RRM ×2 `X.002`) | session upload folder `/home/claude/work/uploads/`; 5 earlier RRM templates in `/mnt/user-data/uploads/` | session storage; may not persist |
| Engine and packs (working copy) | `/home/claude/work/sanral/` (`sanral_fill.py`, `print_reports.py`, `fill_tender.py`, `fill_conventional.py`, `packs/`) | |
| Persisted engine copies | `/mnt/user-data/outputs/` (`sanral_fill.py`, `print_reports.py`, `fill_tender.py`, `packs/_common.yaml`) and `/mnt/user-data/outputs/sanral/` (`fill_conventional.py`, `conventional.yaml`) | |
| Full specification with source code (Appendix A) | `/mnt/user-data/outputs/SANRAL_Tender_Automation_Specification.md` | also delivered in the chat |
| Filled workbooks | `/home/claude/work/out/<tender>_FILLED.xlsm` | |
| PDFs | `/home/claude/work/out/pdfs/<tender>/` | |
| ZIPs | `/home/claude/work/out/zips/` and `/mnt/user-data/outputs/zips/` (includes `SANRAL_Conventional_Tenders_ALL.zip`) | |
| Earlier RRM deliverables | `/mnt/user-data/outputs/SANRAL_5_tenders/`, `/mnt/user-data/outputs/SANRAL_MP_RRM_Batch3/` | |
| Macro dump | session scratch: `…/scratchpad/vba/` (`*.vba.txt` from `olevba`) | temporary |
| Google Drive — templates | `TMS/Sanral Templates` | named by the user in an earlier session |
| Google Drive — filing system | `01 TMS / 03 Systems / 000 Klipcorp Filing System` | named in an earlier session |
| Google Drive — this specification | folder `Tender Tool` (id `1aJCVUjjDof8ZVI7T3t2lKXz3_tsvtA5r`) | requested by the user |
