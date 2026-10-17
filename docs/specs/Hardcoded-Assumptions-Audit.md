# Hardcoded-assumptions audit (2026-10-17)

Sarel, 2026-10-17: *"Sanral has many different types of projects that can be applicable. Dont base limitations and specs only on klipcorps submissions. Other companies might have different submission detail. Also there is many different types of sanral projects, dont assume these 6 are the only type of sanral tenders. Scan all code to make sure our sample of tenders and klipcorp info is not assumed in any area as the only source and limits, there are other tenders and companies which might differ."*

The audit looked for one pattern: a fixed list or fixed behaviour that came from **what was observed** in our samples, used as if it were **everything that can exist**. The samples are Klipcorp's profile, the six 2025 SANRAL Conventional tenders (all PL + DS1 Pavement & Materials), one 2023 RRM workbook and the non-SANRAL corpus. Each list was checked against the standard's own source document:

- SANRAL Book 1 (R.396-010-2025/1F) Annexure A.
- R.396's Book 2/3 C3.1.11.
- The `Proj Relevance Codes`, `WORKINGS MATRIX`, `SETUP` and `Annex 1 PSP Perf. Report` sheets of SANRAL's own Technical Submission workbooks.

There are three outcomes:

- **Fixed:** the list was narrower than the standard, or it was Klipcorp's data being used as a rule.
- **Fine as is:** the list is the standard's own complete set. The evidence is given.
- **Open for Sarel:** the real complete set can't be known from the documents we have. Nothing was guessed for these.

Source documents used (all on disk, not from memory):

| Ref | Document |
|---|---|
| B1 | `templates/incoming/R.396-010-2025.1F/.../R396-010-2025-1F -Conventional Consulting Engineers - Book 1.pdf` (pdftotext -layout) |
| B23 | `.../R.396-010-2025.1F -Conventional Consulting Engineers - Book 2  3  - Aug 2025.pdf`, C3.1.11 (C3-14/C3-15) |
| WB6 | the six Conventional Technical Submission workbooks, `templates/samples/R.*_ran.xlsm` |
| WBR | the RRM Technical Submission workbook `MP_RRM_Batch3_X.002-188-2023-1F_FILLED.xlsm` (Sarel's upload) |

---

## 1. The `MO/MA` bug: root cause and fix

### What was assumed

The scenario pass (`Engine-Scenario-Test-Results.md` §8, open decision 2) recorded this as "`MO/MA` is an RRM code; the Conventional form offers `NONE / MP/MS / MSC / DS / DI/DN`". **That diagnosis was wrong, and the real cause is broader.**

### Evidence

The option list that each Form B1/B2 key-person block's project-type dropdown reads was dumped from the workbook's form controls. It is a different `SETUP` column per position slot.

| Workbook | Block | Dropdown source | Options |
|---|---|---|---|
| WB6 (all six identical) | slot 1 = PL | `SETUP!$B$10:$B$22` | NONE, **MO/MA**, MP/MS, DS, DI, DN, CD |
| WB6 (all six identical) | slot 2 = DS1 Pavement | `SETUP!$C$10:$C$22` | NONE, MP/MS, MSC, DS, DI/DN |
| WBR | slot 1-3 = CE1 (RRM) | `SETUP!$B$10:$B$22` … | NONE, RRM, MO/MA (Excl. RRM), MP/MS, DS, DI, DN, CD |

So `MO/MA` **is** a Conventional code: the PL/CE/RE matrix lists it (B1 p. T-18 and the PL block above). It is not offered on the **DS Pavement & Materials** block, because that position's Book 1 matrix (T-19) has no MO/MA row. The test company `expired_certs_co` fields Jordan on both PL and DS1. The filler wrote his MO/MA project into the PL block and then refused the whole pack at the DS1 block (`TEND 1X!F147` = slot 2).

**Root cause:** project-type validity depends on the **position** (each position's own Book 1 matrix), not on the tender family. A real project can carry a code that is right for one position and simply not offered for another. Before this pass, `confirm_pack.py` passed the first 3 projects, and the filler wrote them into every block that person fills. One code not offered on one block refused the whole pack.

### Fix

The per-position rule follows Sarel's earlier answer: *don't refuse the whole pack, leave that one project off the form it doesn't fit, with a clear note.*

- `engine/sanral_fill.py`:
  - **New `projects_for_block()`.** For each Form B1 block it takes the person's projects in order (most recent first). It skips any project whose project type that block's own dropdown doesn't offer, and stops when the 3 rows are full. Each skipped project gets a note. A project with no type recorded is kept, so the existing "not recorded, fill it in" refusal still fires; a missing value is a data gap, not a code that doesn't apply.
  - **New `resolve_option()`**, used by `set_dropdown` and the fit check. It matches the exact label first, then the other spelling of a toll code (§3.3), then one part of a combined option. "DI" or "DN" fits the DS-Pavement block's single "DI/DN" option, which B1 T-19 defines as "Development Improvement / New Facilities". Before, a DS-Pavement person with a DI project was refused the same way.
- `engine/fill_conventional.py`, `engine/fill_tender.py`: `fill_person()` uses `projects_for_block()` and returns its notes. `main()` returns them.
- `engine/pack/assemble_pack.py`: the notes go into the pack's warnings, so they print on the contents page.
- `engine/pack_generator/confirm_pack.py`:
  - **Before:** `for proj in person["projects"][:3]`.
  - **After:** every project is passed, so the filler can choose 3 that fit **each** position. The first 3 must still be complete, as before. A later project with a field missing is left out instead of refusing.
- `app/lib/sanralMatrices.ts` / `sanralScoring.ts`: the estimate now does the same. **New `matrixRowKey()`.** A project whose type isn't a row of the position's matrix is left out of that position's top-5 with a note. Before, it fell silently to the NONE row (0 points) while still taking up one of the 5 slots.

**Verified:**

- `admin_harness.py --pack` (isolated run dirs and LibreOffice profile), compared against baselines made from unmodified `origin/main`:
  - `expired_certs_co` now **builds** a 68-page pack. Before, it was refused.
  - The new upstream fixture `multi_specialist_co` hit the same bug with a DS Structures code: "project type 'DIB' is not one of the options" on the DS1 Pavement block. It now builds too (64 pages), with "Riley Test-Structures (DS1): project … left off this position's Form B1 - its project type 'DIB' is not one this position's SANRAL project-type matrix offers (NONE, MP/MS, MSC, DS, DI/DN)".
  - In the filled workbook, the PL block (rows 47, ALT 1047) holds the MO/MA project. The DS1 block (rows 147, ALT 1147) left it off.
  - The contents page prints: *"Jordan Test-Generalist (DS1): project 'Test Municipality / TEST/2019/010' left off this position's Form B1 - its project type 'MO/MA' is not one this position's SANRAL project-type matrix offers (NONE, MP/MS, MSC, DS, DI/DN)…"*
  - `complete_co` still matches its baseline (69 pages, 23 sections), and `new_co` still refuses on its missing ECSA level. Both are unchanged.
- Cross-family demonstration on the real workbooks, with one person's projects MO/MA, RRM, DI and DS:
  - **RRM CE1 block** keeps RRM, DI and DS, and drops MO/MA. It offers `MO/MA (Excl. RRM)` instead; see open question Q1.
  - **Conventional PL block** keeps MO/MA, DI and DS, and drops RRM.
  - **Conventional DS1 block** keeps DI (fitted to DI/DN) and DS, and drops MO/MA and RRM.
- Scoring on Klipcorp's real projects gives the same result as unmodified code (technical 23.5-27.5, management 13.5, total 43-96).

`Engine-Scenario-Test-Results.md` open decision 2 is answered by this. The "RRM code" wording there was wrong.

---

## 2. Database CHECK constraints (every `CHECK (... IN ...)` in `app/supabase/migrations/`)

| Constraint | List | Verdict | Evidence |
|---|---|---|---|
| `experience_items.disciplines <@ array[7 keys]` (0012) | roads_civil, water, buildings, electrical_mechanical, it_telecoms, professional_services, security_facilities | **Fixed (0036)** | These are Tender Tool's own keyword buckets (`assess_tender.py DISCIPLINE_KEYWORDS`), built from the eTenders sample. No standard publishes them as a complete list of the work companies do. A company in geotechnical investigation, environmental assessment, transport planning or mining could not tag its experience at all. Constraint dropped and replaced by a format check (lower-case slug). See §4. |
| `people.employment_status` (new, 0036) | full_time_employee, not_full_time_employee | **New, complete set** | Form B1 "employment" dropdown, identical in WB6 and WBR: "No Key Person offered" / "Key Person is NOT a full time employee of the tenderer" / "Key Person is a full time employee of the tenderer". "No Key Person offered" is a slot state, not a property of a person. See §3.1. |
| `experience_items.client_type` (0012) | National Roads Authority, Concessionaire, Provincial Authority, Relevant SOE, Metro Council, Municipality, Private, Other | Fine | SANRAL's complete client code list: B1 T-26 "CLIENT CODE / POINT" table, and `WORKINGS MATRIX!F5:F12` in WB6 + WBR (identical). Includes catch-alls (Private, Other). |
| `experience_items.service_stages` (0012) | initiation, inception, concept_viability, design_development, documentation_procurement, construction, close_out | Fine | CIDB Annex 1 "PSP Performance Report": "Please indicate the project stage for which assessment is made" lists exactly these 7 (`Annex 1 PSP Perf. Report` rows 24-36, WB6). Optional column (default `{}`), so a contractor's experience isn't forced into PSP stages. |
| `experience_items.document_type` (0012) | performance_report … award_letter, project_record, **other** | Fine | Has an `other` catch-all. Evidence types are read per tender (`score_outlook.EVIDENCE_TYPES`). |
| `experience_items.performance_rating` | poor/adequate/good/excellent | Fine | SANRAL reference-letter template and B6 scoring (B1 T-27). |
| `company_offices.province` (0015) | the 9 provinces | Fine | South Africa's complete set. |
| `company_offices.office_kind` / `proof_type` (0015) | … / … + **other** | Fine | `proof_type` has `other`. `office_kind` is the app's own classification of an office (registered/head/branch/site). |
| `tender_roles.family` (0016) | sanral_consultant, construction_contractor, professional_services, health_safety, trades, services | Fine (reference data) | A grouping label on a shared, admin-maintained catalog, not a limit on tenders. A new role is a row. `tender_roles.discipline` is unconstrained. |
| `tender_documents.doc_type` (0001, 0025 RPC) | technical_xlsm, financial_xlsm, c111_form_of_offer, c123_contract_data, a_forms | Fine, with a stated limit | These are the **input slots the SANRAL pack builder consumes**, not a claim about every document a SANRAL tender contains. Other documents (e.g. R.396's own `Appendix D3-OHS Audit Questionnaire.xlsm`) are listed by the intake but not filled. See open question Q6. |
| `tenders.family` (comment only), `source`, statuses, job kinds, pipeline stages, `cv` formats, `company_members.role/tender_role`, provenance status | – | Fine | Internal state machines, not real-world taxonomies. |

Migration replay: all 32 files `0001`→`0036` (including upstream's `0030`-`0035`) replayed on a scratch Postgres 16, plus `seed_tenders.sql`. It used the same auth/storage stub as earlier passes, plus `auth.users.email`, which upstream `0033` reads. On that DB:

- A custom tag `geotechnical_investigation` was accepted, and an overlap query found it.
- `'Bad Tag'` was rejected by `experience_items_disciplines_format`.
- `employment_status` accepted `full_time_employee` and null, and rejected `'contractor'`.

`test_manual_intake.py` (0 failures) and `bridge_selftest.py` (job → ready, 63 pages, read-back clean) also ran on the replayed schema.

---

## 3. Code that assumed Klipcorp-shaped data

### 3.1 Every key person declared a full-time employee (Form B1), and the C.1.2.3 key-person table filled with the signatory

- **Before:**
  - `confirm_pack.py` wrote `"employment": "Key Person is a full time employee of the tenderer"` for every person.
  - `fill_docx_forms.py` did `key_persons = {1: henning, 3: henning}`. Table row 1 (Project Leader) and row 3 (Design Specialist) of C.1.2.3 always got **the signatory**, marked "Permanent". The rows were found by fixed index and asserted by label.
  - Both are Klipcorp's real situation: Henning signs and is PL and DS1, and is a full-time employee. Another company with a different person per position would have had the wrong names in its Contract Data. A subconsultant or JV key person would have been sworn to be a full-time employee. A tender whose positions aren't exactly PL + DS1 hit the hard-coded row mapping. C3.1.11(a), B23: *"The key persons required for this project are listed in Form C1.2.2"*, so each tender sets its own positions.
- **After:**
  - `fill_docx_forms.key_persons_by_row()` reads the **confirmed pack** (`pack.yaml` key_persons: position → person). It finds each position's row **by its label**, using Book 1's position titles (B1 T-24 abbreviation list, plus C3.1.11's "Contract Engineer" and "Engineer's Representative"). Several positions sharing a code (DS1, DS2) fill that code's rows in order.
  - An unmatched row is logged `missing` ("fill by hand"). "Alternate to …" rows stay blank as before.
  - "Permanent" / "Not permanent" comes from the new `people.employment_status`. If that isn't recorded, it is written as Permanent but logged `assumed_default`.
  - `confirm_pack` maps `employment_status` to Form B1's own label. If it isn't recorded, the old answer is kept and the filler adds a pack note: "Form B1 declares them a full-time employee … not recorded … confirm before signing".
  - The People page has an "Employment (SANRAL Form B1)" select.
  - `run_forms_pipeline.py` now passes the pack. `admin_harness.py` forms mode builds a minimal confirmed pack: the test company's person on every position on the tender's own SETUP sheet.
- **Verified:**
  - On a two-person pack (PL = Alice, full-time; DS1 = Bob, not full-time), C.1.2.3 reads "Project Leader | Alice PL | Permanent" and "Design Specialist (Pavement…) | Bob DS | Not permanent", both confirmed.
  - `admin_harness.py` forms baselines (from unmodified code):
    - `complete_co`, whose fixture now records `employment_status`, is 6/6 clean.
    - `expired_certs_co`, `multi_specialist_co` and `new_co` are 18 flagged, exactly `c123.key_person_row_1/3` going from confirmed to assumed_default. This is the intended, honest change.

### 3.2 Company/representative telephone and e-mail never filled, with Klipcorp-specific wording

- **Before:**
  - `fill_docx_forms.py` always logged "Klipcorp's company telephone number is not on file" and "Henning's email address is not on file", even for another company, and even when `companies.telephone/email` (0018) and `people.email` are on file.
  - The SANRAL bridge's `adapt_company()`/`adapt_person()` didn't carry those columns.
  - `fill_sbd_docx.fill_sbd1()` (round-1 CLI) always logged telephone/email missing "in config/klipcorp_profile.json".
- **After:**
  - The values are filled when they are on file, and the messages name the company's own person.
  - `process_pack_jobs.adapt_company()` adds `telephone`, `cellphone` and `email`. `adapt_person()` adds `email` and `employment_status`.

### 3.3 Toll position codes spelled two ways

- B1 (T-24/T-26) prints `PL(T)`, `DS(T)`, `CE(T)`, `CM(T)` and `ETS(T)`. The workbook's position-held dropdown (`WORKINGS MATRIX!C80:C102`, WB6 + WBR) says `PL(Toll)`, `DS(Toll)`, etc.
- **Before:** a project stored as `DS(Toll)` (what the form accepts) scored 0 in `sanralScoring.ts` (the "Undefined" row). A project stored as `DS(T)` (Book 1's spelling) was refused by the filler.
- **After:** both accept either spelling (`sanral_fill.code_alias`, `sanralMatrices.normPositionCode`). Client codes are trimmed before lookup; the workbook's own list has `"National Roads Authority "` with a trailing space.

### 3.4 Experience "similar scope" fixed to roads_civil for every SANRAL tender

- **Before:** `compliance-data.ts` counted experience with `disciplines: ["roads_civil"]`, because "every tender in this family is SANRAL roads consulting". True of the 6 samples, which are all PL + DS Pavement. Not true of SANRAL generally: Book 1 publishes DS Electrical, DS Electronic Systems (tolls, FMS, TCC) and DS Structures matrices, and SANRAL tenders consultancy for those.
- **After:** the disciplines are the union of `tender_roles.discipline` over **this tender's own SETUP positions**. DS Electrical and DS Electronic Systems → `electrical_mechanical`; PL/CE/RE and the civil DS specialisms → `roads_civil`. It falls back to roads_civil only if no position resolves. The report now says which disciplines were used. For the 6 samples, the result is the same as before.

### 3.5 C3.1.11 minimum requirements presented as SANRAL-wide

- `tenderCompliance.ts SANRAL_MIN_REQUIREMENTS` is R.396's own table (B23 C3-14/C3-15). C3.1.11 sits in each tender's own Scope of Services ("shall be as indicated in the table below"), so another tender can differ.
- **After:**
  - Every requirement label ends "(R.396-010-2025/1F C3.1.11 table - check this tender's own C3.1.11)".
  - A DS whose description names an Engineering Geologist is checked against R.396's own row: **Pr Sci.Nat (SACNASP), SAIEG, 5 years**. Before, it was checked against Pr Eng, which would mark a correctly registered geologist as failing. SACNASP isn't a schema field, so unless the registration text says Pr.Sci.Nat the result is "confirm by hand".
  - The same table's Surveyor, OHS Specialist, Road Safety Audit Team Leader and Programmer rows already fall through to "check the tender's C3.1.11 table". They are not DS codes.

### 3.6 Smaller items fixed

- `app/lib/experience.ts SANRAL_PROJECT_TYPES`:
  - **Before:** 27 codes, described as "about 40, copied verbatim". The DS Traffic & Transportation, DS Geotechnical and DS Electronic Systems experience codes were missing, along with RRM's `MO/MA (Excl. RRM)` and the DS-Pavement `DI/DN`.
  - **After:** the workbook's complete `Proj Relevance Codes` list. That sheet is **byte-identical across all 7 workbooks** (6 Conventional 2025 + RRM 2023, md5 of the code/description columns compared). Book 1 itself names it as the authority: *"For a comprehensive list of matrixes please refer to the Consultant Technical Submission Spreadsheet. Below are examples"* (B1 p. T-25).
  - The list now has 46 codes, each with the matrices (positions) it applies to, plus 6 that appear only in Book 1's printed matrices (Route Determination, T-20; the 5 Engineering Geologist codes, T-23).
  - These are now also offered as suggestions on the **People page project form**, with client type (8 codes) and position code (B1 T-24's 22 codes + Undefined). Before, the form had bare text inputs.
- `assess_tender.load_company_profile()`: `has_cidb_grading` came from searching the profile's free-text `gaps` for "no cidb grading", which is Klipcorp's own wording. It now reads the structured `company.cidb_grading` first (0018's column) and keeps the text search only as a last resort.
- `score_outlook._specific_goals()`: the reason listed only the specific-goal kinds it recognises (B-BBEE, ownership, locality) as if that were the whole table. PPR 2022 lets each buyer choose its goals, so it now adds: "Only these kinds of row were recognised - check the tender's table for any other goal it scores."
- `requirements.py`: `find_roles()` only knows 17 catalogued non-SANRAL roles (the ones met in the sample). When a tender asks for key personnel, the manifest now carries a gap: "This tender asks for key personnel (…). Tender Tool recognises 17 common roles …; check the tender's own list for any role it doesn't show." The Roles card no longer reads as the whole requirement.

---

## 4. Discipline taxonomy (Experience Library)

- 0036 drops the 7-key constraint. `experience.ts` keeps the 7 as `DISCIPLINES`, now documented as the **suggested** set (what discovered tenders are categorised into).
- New `disciplineSlug()` / `disciplineLabel()` helpers.
- `/experience/[id]` shows the suggested checkboxes plus the item's own tags, and a new "Other disciplines (comma-separated)" field.
- `/experience` lists filter chips for the suggested set plus any custom tags the company uses.
- `saveExperienceTags` accepts any slug.

**Stated limit:** discovered tenders are only ever categorised into the 7 keyword buckets, so a custom tag doesn't make Discovery match new tenders. It is matched wherever a caller asks for it, e.g. the Experience page filter or a future tender-specific discipline. See Q3.

---

## 5. Config / seed data vs. schema

**No path reads "what can exist" from Klipcorp's profile.**

- `DISCIPLINES`, client codes, project types, position codes and role catalogs are all defined independently of `config/klipcorp_profile.json`.
- Production paths build the profile from the company's own rows:
  - `process_general_jobs.profile_from_company` takes disciplines from that company's tagged experience and CIDB from `companies.cidb_grading`.
  - `process_pack_jobs.adapt_company/adapt_person` read that company's people and projects.
- `config/test_companies/*.json` are labelled synthetic fixtures. `complete_co` now also records `employment_status` so both the recorded and the not-recorded paths are exercised.

Remaining Klipcorp defaults are **CLI-local defaults only**. They are flagged, not changed:

- `assess_tender.DEFAULT_PROFILE_PATH` is `klipcorp_profile.json`, used by `watch_new_tenders.py` and the Discovery cron.
- `seed_supabase_opportunities.DEFAULT_LEGAL_NAME` is `"Klipcorp (Pty) Ltd"`.
- `seed_supabase_company.py` reads Klipcorp's profile.
- `process_cv_jobs.py --self-test` uses a Klipcorp company row.

The first two mean the **national Discovery feed is scored against one company's profile**; see Q4. `fill_authority_letter.py` reproduces Klipcorp's real historical letter format; see Q7.

Already honest, no change needed:

- `fill_a_forms.py` logs its defaults (JV = No, not employed by the state, …) as `assumed_default` with reasons, and they appear on `ACTIONS_TO_SIGN.md`.
- `score_outlook` / `requirements.py` read each tender's own text (evidence rules, locality, preference system) and say "not found" rather than fall back.
- Unknown SANRAL workbook families route to the general engine with a reason (`classify_tender.py`).
- An unknown position code gets "check" in role fit and minimum checks.
- `sanralScoring` scores only the Conventional family and labels the rest.

---

## 6. Verification run (this pass)

Baselines were made by running each harness on a clean checkout of `origin/main` (`17a79af`, and again on `59d35a7` after rebasing onto the 0030-0035 work), then the modified tree against the same stores. LibreOffice ran with a private profile (`HOME`) and private run dirs, because other agents were using LibreOffice and `/tmp/admin_harness_pack_runs` at the same time; two earlier attempts lost files to them.

| Check | Result |
|---|---|
| `general_harness.py` (with packs), 11 samples × 4 test companies | 44 clean, 0 flagged, 0 failed (identical to baseline; 33/33 before the rebase onto the 4th company) |
| `admin_harness.py` (forms, 6 tenders × 4 companies) | complete_co 6 clean; 18 flagged = only `c123.key_person_row_1/3` confirmed → assumed_default (intended, §3.1) |
| `admin_harness.py --pack` | complete_co matches baseline (69 pp); new_co matches (refused, ECSA); expired_certs_co refused → **built** 68 pp, multi_specialist_co refused → **built** 64 pp (intended, §1) |
| `test_general_bridge.py` | ALL PASSED |
| `test_extract_cv_fields.py` | ALL PASSED |
| `test_poll_loop.py` | passed |
| `test_watch_deadlines_urgency.py`, `test_watch_person_credentials.py` | 0 failures |
| `process_cv_jobs.py --self-test` | passed |
| `test_manual_intake.py` on `0001`→`0036` replay | 0 failures |
| `bridge_selftest.py` on `0001`→`0036` replay | job ready, 63 pp, read-back clean; employment note on the contents page |
| `sanralScoring` on Klipcorp's real projects | identical to unmodified code |
| `tsc --noEmit`, `eslint` | clean (after `next typegen`; the `LayoutProps` error on a fresh checkout without `.next/types` is the same on unmodified code) |

**Local baselines to reset once** (they live in the ignored `state/` dir): `admin_harness.py --reset` and `admin_harness.py --pack --reset`. The forms baselines' key-person rows and the `expired_certs_co` / `multi_specialist_co` pack outcomes changed on purpose.

---

## 7. Open questions for Sarel (real complete set not knowable from documents on hand)

- **Q1 - `MO/MA` vs RRM's `MO/MA (Excl. RRM)`.** The Conventional PL/CE/RE matrix offers `MO/MA` ("Maintenance Operations and Adhoc Maintenance"). The RRM CE block offers `MO/MA (Excl. RRM)` ("… (Excl. RRM Projects)") next to a separate `RRM` code. On an RRM tender, should a project the company coded `MO/MA` be treated as `MO/MA (Excl. RRM)`? That is only true if it wasn't an RRM project. Today it is left off the RRM form with a note asking for the right code. Not mapped automatically, because only the company knows whether it was RRM work.
- **Q2 - Engineering Geologist DS has no workbook codes.** Book 1 T-23 prints a DS Engineering Geologist matrix, but the workbook's `Proj Relevance Codes` sheet (identical in all 7 workbooks) has no Engineering Geologist section; its last section is "DS - GENERIC TEMPLATE", with no codes. We have no SANRAL tender that actually tenders a DS Engineering Geologist, so how its Form B1 dropdown is populated is unknown. If you have one, it would settle it.
- **Q3 - discipline taxonomy.** Companies can now add their own discipline tags, but Discovery still sorts tenders into the 7 keyword buckets. Should Tender Tool adopt a published classification instead? CIDB's classes of construction works (CE, GB, EB, EP, ME, the SA–SW specialist classes) is the obvious official one for works. Services (security, IT, cleaning, consulting) have no single official list we've found.
- **Q4 - Discovery is scored against one profile.** The national feed (`watch_new_tenders.py` → `seed_supabase_opportunities.py`) defaults to `config/klipcorp_profile.json` and attaches results to "Klipcorp (Pty) Ltd". The manual and intake path already scores each company from its own rows. Should Discovery fan out per company, scoring each from its own Experience Library and vault? It's a design change, not a list fix, so it wasn't done here.
- **Q5 - other C3.1.11 tables.** Only R.396's Book 2/3 is on hand. The minimums are now labelled as R.396's, but checking every tender properly means reading each tender's own C3.1.11. Should that be extracted per tender, like the evidence rules (`tenders.evaluation_rules`)? Also: should SACNASP (Pr Sci.Nat) and SAGC registrations get People-page fields, which R.396 asks for (Engineering Geologist, Surveyor)?
- **Q6 - other SANRAL document sets.** All six Conventional tenders ship the same 5 fillable documents (Technical/Financial `.xlsm`, C.1.1.1, C.1.2.3, A-Forms). The docx fillers find their fields by the labels in those editions. R.396 also ships `Appendix D3-OHS Audit Questionnaire - Conventional projects.xlsm`, which is listed by the intake but not filled. SANRAL **contractor** (construction) tenders, and any newer consultant template family, would differ. Today they route to the general engine with a reason. Do you have a SANRAL contractor tender, or a newer consultant set, to check against?
- **Q7 - Authority letter format.** `fill_authority_letter.py` reproduces Klipcorp's own historical "Letter of Authority to Sign". Another company would normally use its own board-resolution wording. Keep the generated draft as a starting point for everyone, or offer it only when the company has no letter of its own?
- **Q8 - specific-goal kinds.** Beyond B-BBEE, ownership (women/youth/disability/HDI/black) and locality, the samples show no other kinds. Other buyers' tables may score e.g. military veterans or rural/township enterprises. These are now named as "check the table", not estimated. Add them when a real tender shows the wording?
