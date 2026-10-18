# Form-by-form, field-by-field audit (2026-10-18)

Sarel: *"review each form and field and question again to make sure nothing is assumed or completed by default or completed based on Klipcorp's answers."*

`Hardcoded-Assumptions-Audit.md` (2026-10-17) hunted fixed **lists** built from the samples. This pass is the other half: it walks every generated document and every capture form **one field at a time**. For each field it traces where the value comes from, and asks three questions:

- **(a) Default.** Is there a default value set from what is true for Klipcorp, rather than a neutral, empty or unknown one?
- **(b) Wording.** Does the question's wording, its options or its assumed answer only make sense for Klipcorp?
- **(c) Pre-fill.** Is the field pre-filled where the real form needs this company's own answer for this tender?

The test is the project's own ProvenanceLog rule. A field that isn't a real confirmed value must be tagged `assumed_default` or `missing`, and it must show up for the user (`ACTIONS_TO_SIGN.md`, the pack's contents page, the readiness report). It must never be written silently as if it were confirmed. A default that really is universal and is flagged is fine. The bug is an **unflagged** default, or one that happens to be true for Klipcorp but would be wrong for most other companies.

**Verdicts used below:**

- **FIXED:** changed in this pass, with before and after shown.
- **FLAGGED:** a genuine product decision for Sarel (§12).
- **OK:** checked; the value comes from the company's own record or the tender's own documents, or a universal default that is flagged.

**Test company.** The new regression test `engine/test_form_field_audit.py` uses a synthetic company deliberately **unlike Klipcorp**:

- It is "Ubuntu Geo-Surveys CC": a close corporation, not "(Pty) Ltd".
- It has **three people**: a signatory who is on no position, a separate PL (full-time) and a DS who is **not** a full-time employee.
- No B-BBEE level is recorded at first. Later runs give it an EME affidavit, then a valid certificate, then an expired one.
- Its Form B3 counts were never entered (the database-default pattern). It has no head office, no JV share and no director.
- It has no CSD report note and no registration number.

The test runs on the real R.396 templates. **On the code before this pass, 11 checks fail and 7 test groups stop on functions that didn't exist yet (18 failures in all); after, 0** (§11).

---

## 0. Scope and totals

| Group | Files reviewed | Fields / questions checked |
|---|---|---|
| SANRAL Technical workbook (TEND 1X front page, Form B1/B2 blocks, B3, B7, C2.4) | `sanral_fill.py`, `fill_conventional.py`, `fill_tender.py`, `confirm_pack.py`, `process_pack_jobs.py` (adapters + gather), `assemble_pack.py`, `print_reports.py` | 51 |
| SANRAL A-Forms bundle (A2-A23) | `fill_a_forms.py` | 35 |
| C.1.1.1 Form of Offer, C.1.2.3 Contract Data | `fill_docx_forms.py` | 20 |
| Authority letter, covers, financial workbook, checklist | `fill_authority_letter.py` + `company_documents.authority_facts`, `make_envelope_covers.py`, `fill_financial.py`, `fill_financial_hours.py`, `print_financial.py`, `run_forms_pipeline.py`, `generate_action_checklist.py` | 27 |
| General SBD 1/4/6.1/8/9 (.docx) | `fill_sbd_docx.py` (document filler + round-1 CLI) | 41 |
| Flat-PDF overlay: SBD 1/4/9, Compulsory Enterprise Questionnaire, Form of Offer | `fill_flat_pdf.py` | 44 |
| Tender questions, completion guide, general bridge | `requirements.py` (QUESTIONS, COMPANY_FIELDS), `build_general_pack.py`, `process_general_jobs.py` | 18 questions + 35 guide rows + 6 bridge facts |
| CVs | `generate_cv.py`, `process_cv_jobs.py` | 38 |
| UI capture forms | Company (+ actions), People, Experience (capture + tagging), Load a tender manually (+ action), Onboarding, General workspace, Submission pack, Key positions select, Position actions, Reuse a past submission (+ `pastSubmissionReuse.ts`), the CV request form | 118 |
| Compliance report and scoring | `tenderCompliance.ts`, `sanralScoring.ts`, `compliance-data.ts`, `compliance-report.tsx`, `generalTender.ts`, `score_outlook.py` | 26 |
| **Total** | **44 files** | **≈459** |

**Result:**

- **26 fixes** (§1-§10; 2 of them are wording only).
- **14 items flagged** for Sarel (§12); one (Q7) was built upstream during this pass, so **13 are open**.
- Everything else is OK, field by field, in the tables below.

---

## 1. SANRAL Technical Submission workbook: TEND 1X front page and Form B3

`fill_conventional.py` / `fill_tender.py` write these from the confirmed `pack.yaml` (built by `confirm_pack.py` from `process_pack_jobs.adapt_company`).

**Before.** Every cell was written as-is, and the workbook filler kept **no provenance at all**.

**After.** A shared function `sanral_fill.fill_company_front()` (one copy for both template families) writes each cell from a value on file only. It logs every cell (`tend1x.*` / `form_b3.*`), and `assemble_pack` merges those entries into `field_provenance.json` and `ACTIONS_TO_SIGN.md`. Anything assumed or not on file is also a note on the pack's contents page.

The cell labels below were read from R.396's own workbook: rows 30-34 and 3336-3346, the C33 dropdown (`WORKINGS MATRIX!L103:L104`), and the G33 formula `IF(C33=2,0,K33)`.

| Cell | Form label | Before | After | Verdict |
|---|---|---|---|---|
| D1 | Company name | `legal_name` | same, logged confirmed | OK |
| **C33** | "Verification Certificate Attached?" (Verification Certificate / No Valid Certificate) | **Never written.** SANRAL ships index 1 = "Verification Certificate", so **every** company's form claimed a verification certificate was attached: one with an affidavit, an expired certificate, or none at all | A certificate valid at closing gives "Verification Certificate" (confirmed). No proof, no expiry, or a lapse before closing gives "No Valid Certificate" (assumed_default, with the reason; G33 then scores 0). An affidavit keeps SANRAL's answer as assumed_default, with A12's "EME under R1.8m" caveat (Q-R1) | **FIXED** (c) |
| K33 | BEE level (whole 1-9; SANRAL ships 9 = non-compliant) | Written as an empty cell when no level was on file. That wiped SANRAL's 9, unlogged | A level on file is written. Otherwise SANRAL's 9 is kept, logged missing, with a pack note | **FIXED** (a) |
| L33 | Economic interest of black people (%) | Empty cell when not on file | Written when on file, else logged missing | **FIXED** (logged) |
| H34 | Tenderer's company specified status (also feeds Form B7's main-tenderer size, I3902 `=H34`) | Emptied when not on file (SANRAL ships "GENERIC") | Status on file, else SANRAL's "GENERIC" kept and logged missing, with a note | **FIXED** (a) |
| F3339 | HEAD OFFICE (city/town) | `head_office`. A CLI profile without the key got the literal text **"CHECK PROFILE - head_office not set"** typed into Form B3. **No Company-page field** existed | On file → written. Otherwise blank + missing + note. New Company-page field | **FIXED** (a/c) |
| F3340 | OTHER OFFICES (number) | `other_offices`. **Column DEFAULT 0 (0001), no UI**, so every company created in the app said "0" | See the counts rule below the table. Migration `0057` drops the default; new Company-page field | **FIXED** (a) |
| F3341 | REGISTERED PROFESSIONALS: ECSA | `ecsa_registered_staff_count`, DEFAULT 0, no UI | Same counts rule as F3340 | **FIXED** (a) |
| F3342 | REGISTERED PROFESSIONALS: SACPCMP | `sacpcmp_registered_staff_count`, DEFAULT 0, no UI | Same counts rule as F3340 | **FIXED** (a) |
| F3343 | (third professional count) | not written | not written: its label row is blank in all six editions | OK |
| F3344 | TOTAL EMPLOYEES | `total_employees` (no default), no UI | On file → written, else blank + missing; new field | **FIXED** (no UI) |
| F3345 | % SHARE OF JV AGREEMENT | `typical_jv_share_pct`, a **company-wide** "typical" figure written as this tender's JV share, no UI | On file → written as assumed_default ("decided per tender; confirm"), with a note when it isn't 100. Not on file → blank + missing ("bidding alone normally enters 100"). New field | **FIXED** (b/c); per-tender JV is FLAGGED (Q2) |

**Counts rule (F3340-F3342, after).** These counts are now written only when on file. An "untouched default" record is treated as **not recorded**: all three counts are 0 and `total_employees` (which never had a default) is NULL. A 0 for ECSA or SACPCMP on a filled-in record is assumed_default ("confirm it is the real number").

**Evidence.** The same company (the Ubuntu fixture), the same R.396 sample workbook, `fill_conventional.main` read back:

```
cell   label                              BEFORE (origin/main 4a3a638)              AFTER
K33    BEE level                          None (SANRAL's 9 wiped)                   9
H34    status                             None (SANRAL's GENERIC wiped)              'GENERIC'
C33    certificate attached               1 = "Verification Certificate"            2 = "No Valid Certificate"
F3339  head office                        'CHECK PROFILE - head_office not set'      None
F3340  other offices                      0                                         None
F3341  ECSA count                         0                                         None
F3342  SACPCMP count                      0                                         None
notes on the pack                         0                                         9
```

**Migration 0057, replayed** (0001→0057 on a scratch Postgres 16):

- **Before:** `information_schema.columns` gives `other_offices | 0`, `ecsa_registered_staff_count | 0`, `sacpcmp_registered_staff_count | 0`.
- **After:** all three have no default. A company created through `create_company_and_join('Ubuntu Geo-Surveys CC')` reads `NULL | NULL | NULL | NULL` for the three counts and total employees.

**Harness pack runs.** The pack harness (R.396, the 4 fixtures) now prints, for example, *"TEND 1X C33 set to 'No Valid Certificate' because no B-BBEE proof is recorded …"*, and for `expired_certs_co`, *"Form B3: REGISTERED PROFESSIONALS: SACPCMP = 0 is on file - check it …"*. Pages and sections are unchanged (§11).

### Form B1/B2 key-person blocks (per position slot)

| Field | Source | Verdict |
|---|---|---|
| Name (B4), ID number (E4, as text) | `people.name`, `people.id_number` | OK |
| Description (I4) | `people.description` (blank if none) | OK |
| Project rows ×3: client and number, client type, project type, start/end (Y/M/D triplets), value, position held, position code, contact, contact number | `projects.*` per person, most recent first; `projects_for_block` fits each block's own dropdown (Hardcoded-Assumptions §1) | OK |
| Employment (H35) | `people.employment_status` → Form B1 label. Not recorded → "full time employee" **plus a pack note** (2026-10-17) | OK (flagged assumption, see Q13) |
| ECSA level / number / date | `people.ecsa_*`; a level not recorded refuses the pack | OK |
| SACPCMP number (F40) / date (P41) | `people.sacpcmp_*` | **FIXED** in `fill_tender.py` (RRM). It wrote the SACPCMP **date** but never the **number**. F40 is the "SACPCMP" column beside ECSA (row 75 header) in the RRM X.002-188-2023/1F workbook too. `fill_conventional.py` already wrote it |
| Highest / initial qualification level, description, institution, graduation date | `people.*` | OK |
| Years of experience (H41) | computed from `initial_graduated` at the closing date; refuses a missing, malformed or future date | OK |

### Form C2.4 TECH, Form B7, SETUP / TENDER rows

| Field | Source | Verdict |
|---|---|---|
| C2.4 hours tendered / normalised (E10/E11), value and category (B13/E13, RRM) | only from `td["c2_4"]`, never guessed; nothing produces it (the Financial workbook holds the real C2.4) | OK |
| Form B7 targeted enterprise (C3906 … M3908) | the company's per-tender subcontracting plan (`sanral_b7.py`, 0056 - landed upstream during this pass), else a CLI pack's `targeted_enterprise` | OK (no default written; Q7) |
| SETUP (contract, closing date, positions), TENDER n YES/NO rows | read-only; a pack that tries to override them is refused | OK |

---

## 2. A-Forms bundle (`fill_a_forms.py`)

| Field | Before | After | Verdict |
|---|---|---|---|
| Footer Name / Position / Tenderer (every form) | the signatory (`key_people[0]`), capacity, legal name | same; *who* the signatory is was fixed in §6 | OK |
| "I, the undersigned, …" declarations (A4, A6, A9, A11, A14, A15, A21-A23) | signatory | same | OK |
| A2 board resolution | missing (needs the company's own letter) | same | OK |
| **A3 Joint Venture** | "NOT APPLICABLE - … tendering independently" logged **confirmed**, commented *"whether Klipcorp is a JV is a known fact about the company"*. Nothing in any record says so for any company, and a JV is per tender. (The 2026-10-17 audit §5 said this was already assumed_default; it was not) | same line, **assumed_default**: "decided per tender … if it is a JV, replace this line with the signed JV agreement" | **FIXED** (b/c); per-tender JV FLAGGED Q2 |
| A5 DPIP/FPPO table | missing (by hand) | same | OK |
| **A7 commodity** | A company with any `csd_report_note` got **Klipcorp's own commodity family "Professional engineering services"** logged confirmed. Every other company was told *"only a 2021 CSD report was found"* (Klipcorp's situation) | missing: "copy it from the company's current CSD registration report" | **FIXED** (a/b) |
| A7 service provider / CSD number / delivery location | legal name / `csd_supplier_number` / missing | same | OK |
| A8 litigation table | "None", assumed_default | same | OK (universal, flagged) |
| A9 TCS PIN | confirmed with "(issued **None**, …)": `sars_tcs_pin_issued` isn't a column | "issued …" only when on file | **FIXED** (cosmetic) |
| A10 deviations | "No deviations …", assumed_default | same | OK |
| A11 employed by the state; 4.1-4.4 (restricted supplier, tender defaulter, fraud, termination) | "No", assumed_default with reasons | same | OK as flagged; the policy is FLAGGED Q1 |
| **A12 B-BBEE** | **Confirmed** only when a free-text note contained "sworn 2026-09-09", and the confirmed **value was Klipcorp's own affidavit typed out**: "100% black owned, Level 1, sworn 2026-09-09, valid ~12 months". The bridge never carries that note, so every company in the app got "missing", **even with a valid certificate on file** | From the company's own `bee_level` / `bee_proof_type` / `bee_proof_expiry` / `black_ownership_pct` / `status`. Valid → confirmed, e.g. "B-BBEE verification certificate on file: Level 1 (EME), 51% black owned, valid to 2099-01-31", plus an "attach it" line (with the A12 affidavit caveat when it's an affidavit). Otherwise missing, saying which part is absent or "expired 2020-01-01" | **FIXED** (a) |
| **A16 schedule of addenda** | Looked for "We confirm that the following communications" among the body **paragraphs**. In all six SANRAL editions it is the first row of a **table**, so it never matched: A16 was blank and **nothing was logged**. Had it matched, it would have written "No addenda had been issued" whatever the tender published | Finds the table. The SANRAL bridge passes the addenda / clarifications / revised documents the tender-updates watch recorded (`tender_watched_documents`, non-baseline). If there are any, it writes date + title into the rows (assumed_default: check the portal). If none were recorded, "None issued as at …" (assumed_default). If there is no record (CLI), it logs missing: list by hand | **FIXED** (c) |
| A17 tenderer / PI value / public and third-party liability | legal name / from the vault / missing | same | OK |
| A18 holder / bank / branch / account / branch discrepancy | legal name / vault / vault / missing (never stored) / note | same | OK |
| A19 current commitments | missing | same | OK |
| A20 COID letter | number + expiry from the vault; current → confirmed + attach | same | OK |

**Evidence, A16** (bridge on the replayed schema, §11, with one `tender_watched_documents` addendum row): the filled A-Forms table row reads `['', '2026-10-05', 'Addendum No. 1 - revised Form C2.4']`. `ACTIONS_TO_SIGN.md` has `[VERIFY] a_forms.A16.addenda_received: Listed from the documents Tender Tool's update watch saw published …`. With no addendum rows, the line is `… recorded no addenda for this tender - re-check the buyer's portal …`.

The module docstring no longer says *"Nothing in Klipcorp's profile …"*, *"telling Henning"* or *"which Klipcorp is not"*. The variable `henning` is now `signatory` (here, in `fill_docx_forms.py` and in `fill_sbd_docx.py`).

---

## 3. C.1.1.1 Form of Offer and C.1.2.3 Contract Data (`fill_docx_forms.py`)

| Field | Before | After | Verdict |
|---|---|---|---|
| C.1.1.1 B-BBEE contributor status level claimed | `f" {comp['bee_level']} "`, so a company with no level got **" None "** typed into its claim, logged confirmed | no level → dots left, logged missing ("fill it by hand, or leave it if you claim none") | **FIXED** (c) |
| C.1.1.1 name and address of organisation | "Name, " + address: a dangling comma with no address | only the parts on file; address missing logged | **FIXED** |
| C.1.1.1 signatory name / capacity | signatory | same | OK |
| C.1.1.1 witness / price / signature | missing / never / never | same | OK |
| C.1.2.3 service provider, address, postal address, company telephone, representative name, telephone and e-mail | company and signatory records (2026-10-17 fix) | same | OK |
| C.1.2.3 key-person rows | the confirmed pack, by row label; employment from `people.employment_status`, else Permanent + assumed_default | same | OK |
| **C.1.2.3 directors table** ("Name of Partners, Members or Directors / Appointment date / Designation / Professional registration no.", 4 rows) | Row 1 = `director_name` and "Director", logged **confirmed even when the name was blank**. Nothing said the other rows, the dates or the registration numbers were empty. Only complete for a one-director company like Klipcorp | **From the company's own directors register** (`company_principals`, 0050, which landed upstream during this pass). The SANRAL bridge's `directors_on_record()` passes role director/both. Each row gets name, appointment date, position (else Member for a CC / Director), and the linked person's ECSA / SACPCMP number. Logged `c123.directors_table` confirmed; missing for undated rows and for more principals than the 4 rows. **Register empty** → falls back to `director_name`, with "Member"/"Director" computed and `c123.directors_table_complete` missing ("only one director is on file and the register is empty …"). No name → missing | **FIXED** (a/c) |

**Evidence (Ubuntu CC fixture):**

- **Before:** the Form of Offer read "…status level  None  as per…", logged `c111.bee_level: confirmed None`; the director row was written blank and logged confirmed.
- **After:** `c111.bee_level` is missing, there is no "None" in the document, and the directors row reads "Thandi Signatory-Member | | Member |".

**Admin harness (forms), all 24 runs flagged, exactly these changes and nothing else:**

- `a_forms.A3.joint_venture`: confirmed → assumed_default.
- New missing entries: `a_forms.A16.addenda_received`, `c123.directors_table_complete`.
- For `new_co` (no level): `c111.bee_level` confirmed → missing.

---

## 4. Authority letter, envelope covers, Financial workbook

| Field | Source | Verdict |
|---|---|---|
| Authority letter: every `{{field}}` (company, signatory, capacity, director, tender reference, description, contract, NRA, closing date, date) | `company_documents.authority_facts`, from records; an empty value prints `[NOT ON FILE: …]` and is logged missing; the wording is the company's own (0037) | OK |
| **Covers: addressee block** | Fixed **"The Chief Executive Officer / The South African National Roads Agency SOC Limited / PO Box 415 / PRETORIA / 0001"** on every cover, copied from one reference example. R.396's own Tender Notice (Book 1 T-6) says the tender box is at **"The Reception Area / 20 Shoreward Drive / Bay West / Gqeberha / 6025"**, and C.2.13.5 says the delivery address is "as indicated in the Tender Notice" | "The South African National Roads Agency SOC Limited" + **the tender's own delivery address**. It is read at intake by a new `classify_tender.find_delivery_address()` and stored in `tenders.intake.delivery_address` (or the company's private reading). Not found → no address printed, plus a pack warning "write the tender-box address from this tender's Tender Notice" | **FIXED** (a/c) |
| Covers: contract, NRA, description, closing date | tender record; covers are left out (with the reason) when one is missing | OK |
| Covers: closing time | tender record ("the time stated in the Tender Data" if none); see §7 for where the time comes from | OK after §7 |
| Covers: tenderer name / address / CIPC no. | company. An empty address or `CIPC Registration No: ` line was printed for a company without them | only lines on file | **FIXED** (cosmetic) |
| Financial: TENDERER INPUT DATA D1 (company) | legal name | OK |
| **Financial: key person name rows** | Fixed `{"PL": 12, "DS1": 13}`, true of all six samples (all PL + DS1). Any other position (DS2, CE, RE …) **refused the whole Financial workbook** | `row_for_position()` reads the sheet's own column-B position codes (rows 12-31, SANRAL fills them from SETUP); the fixed rows stay as the fallback. Verified on all 6 samples: PL 12, DS1 13 | **FIXED** (sample-shaped) |
| Hours sheets (7 disciplines × 4 categories × PL/DS1) | only from a complete human capture; refuses a null value; unknown positions refused | OK. PL/DS1-only offsets FLAGGED Q8 |
| Pricing, SUMMARY TENDERED FEE | never touched | OK |
| `print_reports.py`, `print_financial.py` | render the filled workbooks; write no value | OK |
| `generate_action_checklist.py` | every assumed_default / missing becomes a VERIFY / MISSING line | OK |

**Evidence, covers.**

- `find_delivery_address()` on the real R.396 Book 1 PDF (via `requirements.read_document`, 174 617 characters) returns `['The Reception Area', '20 Shoreward Drive', 'Bay West', 'Gqeberha', '6025']`.
- On the bridge run with that intake, the outer cover reads `The South African National Roads Agency SOC Limited / The Reception Area / 20 Shoreward Drive / Bay West / Gqeberha / 6025 / CONTRACT SANRAL R.396-010-2025/1F …`.
- Before, it read `The Chief Executive Officer / … / PO Box 415 / PRETORIA / 0001`.

---

## 5. General (non-SANRAL) forms

### 5.1 Questions asked per tender (`requirements.py`)

| Question | Default / pre-fill | Verdict |
|---|---|---|
| Who signs this bid? | none (must choose) | OK |
| Total bid price | none, optional | OK |
| SBD 1: accredited representative? | none | OK |
| SBD 1: foreign-based supplier? | Pre-selected "No" **only** for a company with a CIPC registration number (`derived_default`). Unanswered, it is written as assumed_default. Saving the form while it shows "No" stores it as the answer | OK. Universal for a CIPC company and visible on screen; see Q10 |
| SBD 4 ×3 (employed by state; relationship with a buyer employee; interest in any related enterprise, "whether or not bidding", fixed 2026-10-17) | none. Unanswered → "No" on a .docx edition, assumed_default | OK (flagged) |
| SBD 6.1 points claimed | none; the table is always done by hand | OK |
| SBD 8 ×4 | none; **never** assumed (unanswered stays blank and missing) | OK. Inconsistent with SANRAL A11 → Q1 |
| JV? / compulsory briefing attended? | asked only when the tender mentions them | OK |
| Company telephone / cellphone / e-mail / CIDB grading | the company's own value; saved to the company | OK |

### 5.2 `.docx` SBD forms (`fill_sbd_docx.fill_sbd_document`)

| Form | Fields | Verdict |
|---|---|---|
| SBD 1 | Name, postal and street address, telephone (code/number split), cellphone, e-mail, VAT, CSD, TCS PIN | OK: company record, logged per field |
| SBD 1 | Fax | OK: always missing ("leave blank or write N/A") |
| SBD 1 | **B-BBEE certificate / affidavit tick** | **FIXED.** It was ticked from the proof *type* alone, **even when the proof lapsed before closing** (a false claim, logged confirmed). Now `bee_proof_lapse()` checks the expiry against the tender's closing date. Lapsed → not ticked, missing "renew it, then tick by hand" |
| SBD 1 | Accredited representative / foreign-based | OK: answers, or foreign = assumed_default No |
| SBD 1 | Capacity, representative name | OK: signatory |
| SBD 1 | Total price | OK: answer only |
| SBD 1 | Signature | OK: always missing |
| SBD 4 | 3 declarations | OK: answers, else assumed_default No |
| SBD 4 | Declarant name, representative full name, name of bidder, designation | OK |
| SBD 4 | Signature | OK: missing |
| SBD 6.1 | Name, registration number, VAT | OK |
| SBD 6.1 | Company type | OK: ticked only for "(Pty)", else missing (fixed upstream 7ae7fb3) |
| SBD 6.1 | Points, signatory name, address, signature | OK |
| SBD 8 | 4 answers | OK: answers only |
| SBD 9 | Bid number and description, institution, bidder, signature | OK |
| Round-1 CLI (`fill_sbd1/4/6_1`) | — | **FIXED (wording).** Its messages said "See company.bee_source_note" (a Klipcorp profile field) and "confirm with Sarel whether to leave [fax] blank". The capacity default "Signatory" is gone; not on file → missing |

### 5.3 Flat-PDF overlay (`fill_flat_pdf.py`): SBD 1/4/9, Compulsory Enterprise Questionnaire, Form of Offer

Each field is typed only when its value is on file. Every field is reported as placed, not placed, prefilled or missing, and `_log_overlay` logs it.

| Field | Before | After | Verdict |
|---|---|---|---|
| **SBD 1 "Contact person"**, **CEQ "Contact Person"** | the bid's signatory, logged **confirmed**. True of a one-person company; a firm with a tender administrator or bid manager would name the wrong person | still the signatory, but **assumed_default**: "nothing on file names a separate contact person for this bid; change it by hand …" | **FIXED** (b/c); a question is FLAGGED Q3 |
| SBD 1 B-BBEE certificate / affidavit Yes/No | from the proof type, even when lapsed | not ticked when the proof lapses before closing (same `bee_proof_lapse`) | **FIXED** |
| SBD 1 foreign-based | assumed_default No (CIPC) | same | OK |
| SBD 4 employed by state | answer only (never assumed on a flat PDF) | same | OK |
| SBD 4 rep ID / position / registration / tax / VAT / CSD; SBD 9 captions; CEQ name, e-mail, telephone, cellphone, addresses, VAT, CSD, registration, tax, bank name and branch | company / signatory records | same | OK |
| CEQ CIDB registration number | no column: always "not on file" | same | OK |
| Form of Offer signatory, capacity, tenderer, address, telephone | records | same | OK |

**Evidence (general harness, 11 samples × 4 companies):**

- 40 runs match their baselines.
- The only 4 flagged are `overberg_q12` (the one sample with a CEQ), all exactly `ceq.contact_person`: confirmed → assumed_default.

### 5.4 Completion guide (`build_general_pack.guide_rows`) and the general bridge

| Field | Before | After | Verdict |
|---|---|---|---|
| SBD 4 guide row "Interest in a related enterprise **bidding**?" (regulatory review G4b) | wrong question on the printed guide | "Interest in any other related enterprise, bidding or not?", with "if Yes, list every CSD-registered company linked to the directors" when unanswered | **FIXED** (b) |
| SBD 6.1 "Type of company/firm" | "(Pty) Limited" only when the legal name says "(Pty)", else blank | same | OK |
| All other guide rows (≈33) | the same facts the fillers write | same | OK |
| CLI `--profile` signatory capacity fallback "Director" | | removed | **FIXED** (CLI only) |
| **Signatory capacity** (`process_general_jobs.gather_pack_inputs`) | `signatory_capacity` **or the person's job title** (`role`). So "Senior Engineer" went onto SBD 1 "capacity under which this bid is signed", logged confirmed | signatory capacity only; not on file → blank and missing (the workspace already warns "no signatory capacity on file") | **FIXED** (c) |

---

## 6. Who signs a SANRAL bid (`process_pack_jobs.gather`)

**Before:**

- The signatory for every SANRAL form (C.1.1.1, C.1.2.3 representative, every A-Form footer and declaration, the authority letter) was **the first person, by creation date, with a signatory capacity**, silently.
- There was no choice and no note. That is right for a company with one signatory (Klipcorp's Henning) and a guess for any other.

**After:**

- The tender's own answer `tender_answers.signatory_person_id` is used when set (the same key as the general flow's "Who signs this bid?").
- The **Submission pack card** now shows a "Who signs this bid" select whenever the company has more than one signatory. `requestSubmissionPack` accepts only this company's person with a signatory capacity.
- If nobody is chosen, the first signatory is still used, but the pack says so: *"Signatory: Pat Test-Specialist (Senior Engineer) signs every form in this pack because they were the first person given a signatory capacity - Second Signatory-Director (Director) can also sign …"* (verified on the bridge run, §11).

---

## 7. Closing time (manual tender load, SANRAL intake)

| Where | Before | After | Verdict |
|---|---|---|---|
| "Load a tender manually", Closing time field | **pre-filled "12:00"**, and the server action also fell back to 12:00. 12:00 is R.396's time; many tenders close at 11:00. The time is printed on the envelope covers ("TENDER CLOSES … AT 12:00") and decides when a tender counts as closed | no pre-fill; a closing date without a time is refused, in the browser before uploading and in the action: "Enter the closing time from the tender notice" | **FIXED** (a) |
| SANRAL intake: closing date taken from SETUP | always `T12:00`, with a note "SANRAL's usual closing time" | the time from the notice's own sentence ("The closing time and date for receipt of tenders is 12:00 on …"; `find_closing_time`, also "11h00"). Only when none is found is 12:00 used, and the note says "placeholder … correct it" | **FIXED** |

**Evidence:** `test_manual_intake.py` on the 0001→0057 replay (0 failures). The forms-only SANRAL tender's intake note now reads *"…no closing time found in the documents read - 12:00 was used as a placeholder, check the Tender Notice and correct it."* `find_closing_time` on R.396 Book 1 returns `12:00`.

---

## 8. Compliance report and scoring

| Item | Before | After | Verdict |
|---|---|---|---|
| **SANRAL functionality threshold** (regulatory G7) | `estimateSanralConventional` always used 70 (R.396's). Book 1 Annexure A sets 70, 80 or 85 per tender | intake stores the tender's own minimum (`score_outlook._functionality`, e.g. R.396 → 70) in `tenders.evaluation_rules.functionality`; `compliance-data.ts` passes it in. Without one, 70 is used as **"assumed - not read from this tender"** (on the score card and as an estimate note) | **FIXED** (a) |
| **A2 authority for signatory row** | "have" whenever `director_name` was on file ("Director on file to sign the resolution"). That is Klipcorp's shape: its director is its signatory. There was no UI for the field, and it said nothing about the letter the pack actually binds in | decided by the company's **own letter** (`company_document_templates.authority_to_sign`, 0037): set up → have; not set up → missing, "upload your own or give your guideline … the pack leaves A2 out until then"; the director's name is detail only | **FIXED** (a/b) |
| B-BBEE A12 row status | unchanged (Sarel's answer 9 + Q-R1 caveat, 2026-10-17) | | OK as flagged (Q5) |
| Briefing row, always "mandatory" | | | FLAGGED Q6 |
| CSD, COID, TCS, PI, bank letter (3 months), ISO, B6 rows | vault fields + expiry at closing | | OK |
| `RENEW_SOON_DAYS` 60, bank-letter 30-day window, QS points 10/7/5/0, period relevance 5/2.5/0, management denominators | Book 1 and the app's own UI thresholds, not company figures | | OK |
| `score_outlook.py` (B-BBEE table, specific goals, locality, CIDB, functionality) | reads the tender's text and the company's own profile; "not found" rather than a fallback | | OK |
| `generalTender.ts` question states | `defaultValue` only for foreign-based (see §5.1) | | OK |

---

## 9. CVs (`generate_cv.py`)

| Field | Verdict |
|---|---|
| B1.1 name, ID, position (from the tender's position description) | OK |
| B1.1 project table (client, value, position held, start, end, referee, phone) and contact confidence (assumed_default unless confirmed) | OK |
| B2.1 ECSA level / number / date, SACPCMP, qualifications | OK |
| B2.1 years of experience | OK: computed at the closing date |
| **Other professional bodies** | **FIXED.** The adapter carried only ECSA and SACPCMP: an engineering firm's view. A geologist's or surveyor's CV showed "ECSA: MISSING" and none of their real registration. `process_cv_jobs.adapt_person_row` now carries `sacnasp_*` / `sagc_*` (0040). B2.1 adds a "SACNASP registration" / "SAGC registration" row, and the World Bank CV adds them under professional associations, **only when held** (Sarel's Q5 rule) |
| World Bank: date of birth, nationality, residence, other training, countries, languages | OK: "not on file" + missing (no columns) |
| World Bank: education, employment record | OK |
| Literal "MISSING" text and "(computed as of … never a stored static number)" printed inside the buyer-facing CV | FLAGGED Q9 |

---

## 10. UI capture forms

| Form | Fields checked | Defaults found | Verdict |
|---|---|---|---|
| **Company page** (edit, 36 fields) | identity, compliance documents, B-BBEE, bank, how we work, letters | `iso_9001_certified` "Not stated"; `bee_proof_type` "Not recorded"; the rest blank | OK |
| **Company page**: Form B3 / C.1.2.3 inputs | head office, other offices, ECSA count, SACPCMP count, total employees, JV share, director | the pack wrote these, but **there was no field**, so a seed (Klipcorp) or the DB default 0 decided them | **FIXED**: new "Size & offices (SANRAL Form B3)" section and "Director / member" field. Blank stays NULL, never 0. Whole-number check on counts. `actions.ts` whitelists them |
| **Company page**: vault note | | "A QSE or EME sworn affidavit counts as valid B-BBEE proof, the same as a verification certificate", the claim the regulatory review found wrong for SANRAL's A12 (that pass fixed the compliance report, not this note) | **FIXED** (wording): "recorded as B-BBEE proof, but check each tender's own rule: SANRAL's Form A12 asks for a SANAS certificate and accepts an affidavit only from an EME under R1.8m" |
| **People page** (30 fields + project form) | | employment "Not recorded"; contact confidence "Unconfirmed"; CV mode "AI extract" (a process choice); role tags pre-ticked only for the person's own tags; project client type / project type / position code are suggestion lists with no value | OK |
| **Experience capture**: document type | | **pre-selected "Reference letter"**. Form B6 *scores* reference letters, so a completion certificate uploaded without changing the select was counted as scoreable evidence | **FIXED**: no pre-selection ("Choose…", required); the action already refused an empty type |
| Experience tagging | | the item's own tags pre-ticked | OK |
| **Load a tender manually** | title, buyer, reference, OCDS id, closing date, closing time, files | closing time "12:00" | **FIXED** (§7) |
| Onboarding | legal name only | | OK. The rest of the company row takes column defaults, which is why 0057 matters |
| General workspace | questions + company facts | foreign-based "No" (§5.1); everything else blank until answered | OK |
| **Submission pack card** | acknowledge gaps; who signs | | **FIXED**: "Who signs this bid" select (§6) |
| Key positions select (`position-person-select.tsx`, `confirmPositionPerson`) | | suggestions are shown, never confirmed until clicked | OK |
| Reuse a past submission | | copies only `company_fact` / `same_buyer` answers after a visible preview and a click; JV, price, points, briefing and related-enterprise are always re-asked | OK |
| CV request (`tenders/[id]/page.tsx`) | | format "SANRAL key-person" (this card exists only on SANRAL tenders), detail "Summary" | OK |

---

## 11. Verification

Every check ran against a baseline from unmodified `origin/main` in its own worktree, with private run directories and LibreOffice profiles (other agents were running the harnesses at the same time). The harnesses ran twice: first against `4a3a638`; then, after rebasing onto `defe346` (the directors register `0050`, Form B7 `0056`, per-tender C3.1.11), again against a fresh `defe346` baseline. Both comparisons show only this pass's intended differences.

| Check | Result |
|---|---|
| `engine/test_form_field_audit.py` (new, in CI; the Ubuntu fixture on the real R.396 templates; 43 checks, incl. the directors register) | **after: 0 failures**. **Before**, on `4a3a638` with the same test copied in, there were 18 failures: 11 failed checks (A3 confirmed; A12 with no level / with a valid certificate; A16 never logged; Klipcorp wording in A-Forms provenance; " None " B-BBEE claim; dangling comma; blank director confirmed; "Director" for a CC; PO Box 415 cover; empty CIPC line), and 7 test groups stopped on fixes that didn't exist yet |
| `admin_harness.py` forms (6 tenders × 4 companies) vs the base | all 24 flagged, with **only** the intended keys (§3) |
| `admin_harness.py --pack` (R.396 × 4) vs `defe346` | sections unchanged; warnings +2 / +3 / +2, all new notes from this pass (C33, Form B3 SACPCMP 0, covers address). `complete_co` 68 → 69 pages only because its contents page now needs 2 pages for the extra notes. `new_co` is still refused on its ECSA level |
| `general_harness.py` (11 samples × 4, with packs) vs the base | 40 clean; 4 flagged, all `overberg_q12` `ceq.contact_person` confirmed → assumed_default |
| Migration replay 0001→0057 (49 files) + `seed_tenders.sql` (scratch Postgres 16, UTF-8, Supabase stub) | all apply; defaults dropped; a new company's counts are NULL (before: `0 / 0 / 0`) |
| `test_manual_intake.py` on the replay | the intake parts pass and show the closing-time / delivery-address notes. One failure, `pack job ready`, is refused by the new Form B7 gate ("Form B7 … hasn't been answered"). That failure is **identical on unmodified `defe346`**: upstream's B7 pass didn't update this test. Not caused by this pass; left for that work |
| `bridge_selftest.py` on the replay (upstream's B7-aware version) | the first job is refused by the B7 gate as designed, the next is **ready**, read-back clean. Before the rebase (on `4a3a638`): ready, 63 pages; `ACTIONS_TO_SIGN.md` has `tend1x.verification_certificate`, `form_b3.jv_share_pct`, `a_forms.A3.joint_venture` and `a_forms.A16.addenda_received` |
| Second bridge job (replay + a 2nd signatory, an addendum row, an intake delivery address) | ready. The signatory note is printed; the A16 table row reads `2026-10-05 / Addendum No. 1 …`; the outer cover printed the Gqeberha address. **Also found here:** `suggest_pack.candidate_person_text` raised `TypeError` for a person with only a name (a None description), which stopped candidate scoring for the whole tender. **FIXED** (`" ".join(p for p in parts if p)`) |
| DB parts of `test_tenant_isolation.py`, `test_system_alerts.py`, `test_reminder_seen_db.py`, `test_discovery_fanout.py` on the replay | all pass |
| `test_general_bridge.py`, `test_extract_cv_fields.py`, `process_cv_jobs.py --self-test`, `test_poll_loop.py`, `test_watch_deadlines_urgency.py`, `test_watch_person_credentials.py`, `test_watch_conditional_registrations.py`, `test_tender_updates.py`, `test_taxonomy.py`, `test_award_outcomes.py`, `test_digest_live.py`, `test_company_documents.py` | all pass |
| `tsc --noEmit`, `eslint` (touched files) | clean |

**Local baselines to reset once:** `admin_harness.py --reset`, `admin_harness.py --pack --reset`, `general_harness.py --reset`. The changes above are intended.

---

## 12. Flagged for Sarel (product decisions, not guessed)

1. **Q1: one rule for "past SCM practices".**
   - SANRAL's A11 table 4.1-4.4 (restricted supplier, tender defaulter, fraud conviction, contract termination) is written "No" as assumed_default.
   - The general flow's identical SBD 8 questions are **never** assumed (left blank until answered).
   - Which rule should both use? Recommendation: SANRAL asks them on the workspace like SBD 8, because a wrong "No" is a disqualification.
2. **Q2: a per-tender "bidding as a JV?" on SANRAL.**
   - It now drives four things that are assumed per company: A3 (now assumed_default), Form B3 % JV share (now assumed_default from the company's usual share), the consolidated JV B-BBEE certificate, and the Targeted Enterprise partner (regulatory G9).
   - Add the question to the SANRAL workspace?
3. **Q3: contact person for the bid.**
   - SBD 1 and the CEQ name the signatory as contact person (now assumed_default).
   - Add an optional per-tender "contact person for enquiries" question?
4. **Q4: the directors / members register for the declaration tables** (Master-Data A3/A7, regulatory G2). The register (`company_principals`, 0050) landed upstream during this pass, and C.1.2.3's table now reads it (§3). SBD 4's two directors tables, MBD 4 3.9-3.14 and SANRAL A5 DPIP still don't. Wire them the same way? They need per-director answers (state employment, other companies + MAAA) the register doesn't hold yet.
5. **Q5: C33 for affidavit holders.**
   - An affidavit keeps SANRAL's "Verification Certificate" (assumed_default with the A12 caveat), in line with your answer 9.
   - If Q-R1 goes the other way, C33 should become "No Valid Certificate" for a QSE affidavit.
6. **Q6: the SANRAL briefing row** is always "mandatory".
   - The intake can already tell a compulsory briefing from a non-compulsory one (`requirements.BRIEFING_RE`).
   - Use it for SANRAL too?
7. ~~**Q7: Form B7 targeted enterprise** (regulatory G3).~~ Built upstream during this pass (`defe346`, migration `0056`: the company answers it per tender). Not re-audited here.
8. **Q8: Financial hours sheets** support PL and DS1 rows only (the six samples).
   - A capture for another position is refused, honestly.
   - Generalise the same way as the input-data rows when a tender with other positions arrives?
9. **Q9: CV text.** The generated CVs print the literal word "MISSING" for empty fields, and "(computed as of … never a stored static number)" beside years of experience, inside a buyer-facing document. Blank + checklist instead, as the forms do?
10. **Q10: pre-selected "No" for foreign-based** (CIPC companies).
    - Visible, and almost always right.
    - But saving the questions form stores it as the company's answer (then logged confirmed).
    - Keep, or show it unselected with "most SA companies answer No"?
11. **Q11: existing companies' Form B3 zeros.** 0057 doesn't change stored rows. The filler treats "all three 0 + total employees blank" as not recorded, and flags a 0 ECSA/SACPCMP count on any other record. Ask existing tenants to fill the new Company-page section?
12. **Q12: delivery address extraction** is tuned on R.396's Tender Notice ("tender box at:"). Other SANRAL regions' wording is unknown until more Book 1s are on hand. Not found = no address + a warning, never a guess.
13. **Q13: Form B1 employment when not recorded.** It still declares "full time employee" with a pack note (2026-10-17). The only other options are "NOT a full time employee" and "No Key Person offered". Refuse instead until it's recorded?
14. **Q14: test fixtures.**
    - `complete_co` has no `bee_proof_type`, so its harness pack now (correctly) says "No Valid Certificate".
    - Give the fixtures realistic proof types (one certificate, one affidavit) so both paths run in the harness? It would change baselines once.

**Confidence.** Every field on every form the product fills now either reads this company's (or this tender's) own record, or is tagged `assumed_default` / `missing` with a reason that reaches `ACTIONS_TO_SIGN.md` or the pack's contents page. The same holds for every capture form: its defaults are neutral, or universal and visible.

Two things remain:

- **Design choices.** The flagged items above are deliberate assumptions, now visible, that Sarel may want to change.
- **Unseen editions.** Other SANRAL editions not on hand (N.011's A4/A5/A18 set, regulatory G8; any contractor template) could carry fields this pass couldn't see. The label-matched fillers report a field they can't find as missing rather than guess, so an unseen field would show up as a gap rather than a wrong answer.
