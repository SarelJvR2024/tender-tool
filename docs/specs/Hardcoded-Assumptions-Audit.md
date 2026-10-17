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
  - **RRM CE1 block** keeps RRM, DI and DS, and drops MO/MA. It offers `MO/MA (Excl. RRM)` instead; see open question Q1. *(Answered 2026-10-17: MO/MA is now kept and written as `MO/MA (Excl. RRM)`; see §8.1.)*
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
| `tender_packs.price_sector` (0034, added after this audit) | the same 7 bucket keys | **Fixed (0040)** | Same list as `experience_items.disciplines`. Now an FK to `discipline_categories(slug)`, so any listed category (and any added later) is a valid sector. See §10.1. |
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

~~**Stated limit:** discovered tenders are only ever categorised into the 7 keyword buckets, so a custom tag doesn't make Discovery match new tenders. It is matched wherever a caller asks for it, e.g. the Experience page filter or a future tender-specific discipline. See Q3.~~ **Closed (§10.1):** discovered tenders are now sorted into Tender Tool's own maintained list (`discipline_categories`, 0040: 19 groups / 93 disciplines), and the 7 buckets are 7 of its groups.

---

## 5. Config / seed data vs. schema

**No path reads "what can exist" from Klipcorp's profile.**

- `DISCIPLINES`, client codes, project types, position codes and role catalogs are all defined independently of `config/klipcorp_profile.json`.
- Production paths build the profile from the company's own rows:
  - `process_general_jobs.profile_from_company` takes disciplines from that company's tagged experience and CIDB from `companies.cidb_grading`.
  - `process_pack_jobs.adapt_company/adapt_person` read that company's people and projects.
- `config/test_companies/*.json` are labelled synthetic fixtures. `complete_co` now also records `employment_status` so both the recorded and the not-recorded paths are exercised.

Remaining Klipcorp defaults were **CLI-local defaults only**. They were flagged, not changed, in this audit; the first two and the authority letter were then removed on Sarel's answers (§8):

- ~~`assess_tender.DEFAULT_PROFILE_PATH` is `klipcorp_profile.json`, used by `watch_new_tenders.py` and the Discovery cron.~~ **Removed (§8.2):** no default profile; every caller names its company.
- ~~`seed_supabase_opportunities.DEFAULT_LEGAL_NAME` is `"Klipcorp (Pty) Ltd"`.~~ **Removed (§8.2):** one row per company from each company's own score.
- `seed_supabase_company.py` reads Klipcorp's profile. (Still true: it is the one-off seed of Klipcorp's own real data, named as such.)
- `process_cv_jobs.py --self-test` uses a Klipcorp company row. (Still true: a label in a self-test, not a scoring input.)

~~The first two mean the national Discovery feed is scored against one company's profile; see Q4. `fill_authority_letter.py` reproduces Klipcorp's real historical letter format; see Q7.~~ Both closed in §8.

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

- **Q1 - `MO/MA` vs RRM's `MO/MA (Excl. RRM)`. ANSWERED 2026-10-17 (same code, renamed) and built - §8.1.** The Conventional PL/CE/RE matrix offers `MO/MA` ("Maintenance Operations and Adhoc Maintenance"). The RRM CE block offers `MO/MA (Excl. RRM)` ("… (Excl. RRM Projects)") next to a separate `RRM` code. On an RRM tender, should a project the company coded `MO/MA` be treated as `MO/MA (Excl. RRM)`? That is only true if it wasn't an RRM project. Today it is left off the RRM form with a note asking for the right code. Not mapped automatically, because only the company knows whether it was RRM work.
- **Q2 - Engineering Geologist DS has no workbook codes.** Book 1 T-23 prints a DS Engineering Geologist matrix, but the workbook's `Proj Relevance Codes` sheet (identical in all 7 workbooks) has no Engineering Geologist section; its last section is "DS - GENERIC TEMPLATE", with no codes. We have no SANRAL tender that actually tenders a DS Engineering Geologist, so how its Form B1 dropdown is populated is unknown. If you have one, it would settle it.
- **Q3 - discipline taxonomy. ANSWERED 2026-10-17 (build our own, maintained list - not CIDB) and built - §10.1.** Companies can now add their own discipline tags, but Discovery still sorts tenders into the 7 keyword buckets. Should Tender Tool adopt a published classification instead? CIDB's classes of construction works (CE, GB, EB, EP, ME, the SA–SW specialist classes) is the obvious official one for works. Services (security, IT, cleaning, consulting) have no single official list we've found.
- **Q4 - Discovery is scored against one profile. ANSWERED 2026-10-17 (score every company) and built - §8.2.** The national feed (`watch_new_tenders.py` → `seed_supabase_opportunities.py`) defaults to `config/klipcorp_profile.json` and attaches results to "Klipcorp (Pty) Ltd". The manual and intake path already scores each company from its own rows. Should Discovery fan out per company, scoring each from its own Experience Library and vault? It's a design change, not a list fix, so it wasn't done here.
- **Q5 - other C3.1.11 tables. SACNASP/SAGC half ANSWERED 2026-10-17 (in the structure, asked for only when a tender requires it) and built - §10.2; per-tender C3.1.11 extraction still open.** Only R.396's Book 2/3 is on hand. The minimums are now labelled as R.396's, but checking every tender properly means reading each tender's own C3.1.11. Should that be extracted per tender, like the evidence rules (`tenders.evaluation_rules`)? Also: should SACNASP (Pr Sci.Nat) and SAGC registrations get People-page fields, which R.396 asks for (Engineering Geologist, Surveyor)?
- **Q6 - other SANRAL document sets.** All six Conventional tenders ship the same 5 fillable documents (Technical/Financial `.xlsm`, C.1.1.1, C.1.2.3, A-Forms). The docx fillers find their fields by the labels in those editions. R.396 also ships `Appendix D3-OHS Audit Questionnaire - Conventional projects.xlsm`, which is listed by the intake but not filled. SANRAL **contractor** (construction) tenders, and any newer consultant template family, would differ. Today they route to the general engine with a reason. Do you have a SANRAL contractor tender, or a newer consultant set, to check against?
- **Q7 - Authority letter format. ANSWERED 2026-10-17 (every company uploads its own or gives a guideline, for all letters) and built for the authority letter - §8.3.** `fill_authority_letter.py` reproduces Klipcorp's own historical "Letter of Authority to Sign". Another company would normally use its own board-resolution wording. Keep the generated draft as a starting point for everyone, or offer it only when the company has no letter of its own?
- **Q8 - specific-goal kinds.** Beyond B-BBEE, ownership (women/youth/disability/HDI/black) and locality, the samples show no other kinds. Other buyers' tables may score e.g. military veterans or rural/township enterprises. These are now named as "check the table", not estimated. Add them when a real tender shows the wording?

---

## 8. Sarel's answers to Q1, Q4 and Q7 (2026-10-17) - built and verified

### 8.1 Q1: `MO/MA` and RRM's `MO/MA (Excl. RRM)` are the same code

Sarel: treat them as the same real experience - RRM's form doesn't offer plain `MO/MA` at all; it renames that option, and lists RRM work under its own separate `RRM` code.

- `engine/sanral_fill.py`: new `PROJECT_TYPE_EQUIVALENTS = (("MO/MA", "MO/MA (Excl. RRM)"),)` and `equivalent_codes()`. `resolve_option()` (used by `set_dropdown`, `fits_dropdown` and so `projects_for_block()`) now tries, in order: the exact label, the toll spelling, **an equivalent spelling**, then one part of a combined option. Exact still wins, so a block that ever offered both would get the exact one. Both directions: an `MO/MA (Excl. RRM)` project fits the Conventional PL block's `MO/MA`. `RRM` stays a distinct code.
- `app/lib/sanralMatrices.ts`: the same table (`PROJECT_TYPE_EQUIVALENTS`, `equivalentTypes()`), used by `matrixRowKey()`; `sanralScoring.projectTypePoints()` also maps a tender project type through it. (RRM's own matrix numbers still aren't in Book 1, so RRM positions still score as a range - unchanged.)
- **Verified on the two real RRM workbooks** (Sarel's `MP_RRM_Batch3_X.002-188-2023-1F_FILLED.xlsm` and the completed `RRM_Consultant_Tender_-_WCP_V2_Batch_2B_..._FILLED.xlsm`), a person with projects MO/MA, MO/MA (Excl. RRM), RRM, DI, DS:
  - before: every CE1 slot kept `MO/MA (Excl. RRM), RRM, DI, DS` and left the `MO/MA` project off with a note;
  - after: every CE1 slot keeps all five; no note.
  - Real write + read-back: `set_dropdown("TEND 1X", "F47", "MO/MA")` on the RRM workbook selected index 3 = `MO/MA (Excl. RRM)`, saved and re-opened.
  - Conventional R.334 PL block: now keeps `MO/MA (Excl. RRM)` as `MO/MA`; still drops `RRM`. DS1 block unchanged (offers neither).
- TS, run with `node --experimental-strip-types` on copies of the two files: `matrixRowKey("PL_CE_RE_CONVENTIONAL", "MO/MA (Excl. RRM)")` = `MO/MA`; `RRM` = null; a PL estimate with one `MO/MA (Excl. RRM)` + one `RRM` project counts 1 project (15 technical points) and notes only the RRM one as left off. Klipcorp's real projects are all `DS`, so its estimate is unchanged.

### 8.2 Q4: Discovery scores every company, from each company's own rows

Sarel: *"It should score for all companies in the app. Nothing must be klipcorp specific, they are just a company, not a benchmark, treat all processing for all companies and not specific to anything we upload as a sample."*

- `engine/discovery/assess_tender.py`: `assess_release()` is split into `read_release()` (company-independent: categories, document depth, signals - the documents are downloaded **once per tender**) and `score_release(release, reading, profile)` (one company's verdict, reasons and score outlook). `assess_release()` = both, unchanged result. **`DEFAULT_PROFILE_PATH` is now `None`**: `load_company_profile(None)` refuses; `assess_tender.py`, `classify_tender.py` CLIs take a required `--profile`, `daily_digest.py --mode local` stops without one.
- New `engine/discovery/company_profiles.py`: `profile_from_company_rows()` (moved from `process_general_jobs.profile_from_company`, which now calls it - one implementation for intake and Discovery): disciplines from the company's tagged Experience Library items, CIDB from `companies.cidb_grading`, B-BBEE, offices from `company_offices` else the registered address. `all_company_profiles(client)` = every company (synthetic `is_test_company` ones were left out unless `--include-test-companies`; *since §9 (a) they are included by default, `--exclude-test-companies` leaves them out*). `profiles_from_files()` for a local run.
- `watch_new_tenders.py`: `fan_out()` scores each release for every company not yet scored on it. Output entries carry release facts plus `company_results` (company_id, legal_name, verdict, reasons, score_outlook) for each company whose **own** verdict is report-worthy. The seen store records `companies: {company: verdict}` per release, so a company added later is scored on releases still in the window; an entry written before the fan-out is re-scored per company. With no Supabase env and no `--profile`, it stops - no sample default.
- `seed_supabase_opportunities.py`: one `discovered_opportunities` row per company x tender with that company's own verdict (upsert on `(company_id, ocid)`, which 0024 already made unique). `DEFAULT_LEGAL_NAME` is gone.
- No migration was needed: `discovered_opportunities` was already per company.
- **Verified** (`engine/discovery/test_discovery_fanout.py`, now in CI; Part 2 on a scratch Postgres with `0001`-`0037` replayed): the same two real tenders (`dawid_kruiper_tn051` security services, `ecdpwi_scmu5_0007` architectural PSP, their own PDFs read through `fetch_pdf_text`) scored for the 4 test companies + 2 deliberately different synthetic ones:
  - TN051: Synthetic Guarding Services **strong_fit**, Synthetic Architects **not_a_fit**, the 4 test companies (no disciplines on file) **needs_review** - 3 different verdicts for one reading; SCMU5: the reverse for guarding/architects.
  - Score outlooks differ per company (locality: Northern Cape vs Eastern Cape office).
  - 2 document reads for 2 tenders x 6 companies; a second run reads nothing and reports nothing.
  - Supabase mode, real rows: 3 companies built from their own experience tags + offices; the `is_test_company` one left out; rows written: TN051 -> Fanout Guarding only; SCMU5 -> Fanout Architects and Fanout Roads; the others' own `not_a_fit` recorded in the seen store, no row. A company added afterwards is scored (only it) on the next run and gets its own row. Under RLS a Fanout Guarding member sees only its own row.

### 8.3 Q7: every company's own letters - upload your own, or your own guideline

Sarel: *"each company must have the option to upload their own docs or templates, or provide a guideline of how AI engine must generate their docs - not just this letter but all docs and letters that might be needed."*

- **Migration `0037_company_document_templates.sql`**: one row per company x document type; `mode` `uploaded` (own file in `company-documents/<company>/templates/<type>/...`, used as-is) or `ai_guideline` (own wording with `{{field}}` marks); both kept when the mode switches; CHECKs for slug format, the content each mode needs, 10 000-char guideline; tenant RLS. No row = not set up. `document_type` is an open slug (like 0036), the wired types live in code.
- **`engine/company_documents.py`** (the reusable mechanism): `DOCUMENT_TYPES` registry (fields per type), `produce()` -> `uploaded` (byte-identical copy, sha256-checked) / `generated` (the guideline verbatim, fields filled; `[NOT ON FILE: ...]` and `[UNKNOWN FIELD: ...]` printed visibly and logged `missing`) / `not_set_up` (nothing produced, logged `missing`). Optional AI placement for a guideline with **no** fields, only with `ANTHROPIC_API_KEY`: the output is checked by `guard_only_company_wording()` - any word not in the guideline or a supplied fact rejects it and the guideline is used verbatim, with the invented words in the log. Without a key a field-less guideline is used verbatim and logged `assumed_default`.
- **`fill_authority_letter.py`**: the Klipcorp wording ("It is hereby certified that Mr ... duly authorised, on behalf of the Board of Directors ... Your's Sincerely") is **deleted**; it is a thin wrapper over `company_documents`. `assemble_pack.py` uses it; the letter no longer depends on the cover facts; its provenance joins `field_provenance.json` and `ACTIONS_TO_SIGN.md` is regenerated; "not set up" is a pack warning and a "Not included" row; the manifest records how each company document was produced. `process_pack_jobs.load_document_templates()` reads the company's rows and fetches its upload.
- **App**: Company page "Letters & documents" (`#letters`), one card per type with the CV upload's radio pattern - "Upload your own" / "Generate from your guideline", status chip (Not set up / Your own upload - used as-is / Generated from your guideline), field list, unknown-field warning. `saveDocumentTemplate` server action; `app/lib/companyDocuments.ts`.
- **Verified**:
  - `engine/test_company_documents.py` (in CI; part 7 on the replayed DB): uploaded -> byte-identical file, same text; guideline -> read back equals the guideline with only its fields filled, guard finds 0 words outside guideline+facts, no Klipcorp phrase; missing/unknown fields visible + logged; new company -> `not_set_up`, nothing written; AI stub that adds "We are committed to excellence ..." -> rejected, document = guideline verbatim; DB: RLS lets a member set only its own row and upload only under its own prefix, `load_document_templates()` -> the three companies produce their own upload / own sentence / not set up.
  - Full SANRAL pack (`harness_pack.run_pack_one`, R.396, private HOME/run dirs) vs a baseline worktree of unmodified `main`: **before**, `complete_co` and `expired_certs_co` both got Klipcorp's "It is hereby certified that Mr ... Your's Sincerely" letter. **After**, `complete_co` (fixture now carries its own synthetic guideline) page 4 reads its own "RESOLUTION OF THE BOARD - SIGNING AUTHORITY ... Pat Test-Specialist (Senior Engineer) signs for Test Complete Engineering (Pty) Ltd on tender SANRAL NRA 2026/0071 / Contract R.396-010-2025/1F ..." (69 pages, unchanged otherwise); `expired_certs_co` has no letter, its contents page row 3 reads "A2 - Letter of authority to sign - NOT INCLUDED: ... not set up for Test Lapsed Compliance (Pty) Ltd yet ...", and ACTIONS_TO_SIGN.md has the `[MISSING] authority_to_sign.setup` line (67 pages, was 68).
- **Klipcorp itself** now gets "not set up" too until its real letter is uploaded on its Company page (the Drive original, "Letter of Authority to Sign_Klipcorp .docx", is exactly an "Upload your own").

**Other document types still to move onto this mechanism** (listed, not migrated in this pass): see System-Status.md "Company letters & documents backlog".

---

## 9. Follow-ups (a), (d), (e) from the §8 pass (Sarel, 2026-10-17) - built and verified

The §8 pass left new open questions in System-Status.md (Open items, "Hardcoded-assumptions audit"). Sarel answered three of them; (b) and (c) stay open.

### 9.1 (a) Test companies show up in Discovery results - CLOSED

Sarel: *"Yes, let it for now, let it come up in the discovery results."*

- `company_profiles.all_company_profiles(client, include_test_companies=True)` - the default flipped. `watch_new_tenders.py`'s `--include-test-companies` is replaced by `--exclude-test-companies` (the old behaviour, opt-in). `daily_digest.py --mode live` takes the same flag.
- Nothing else filters them: `seed_supabase_opportunities.seed()` writes a `discovered_opportunities` row for every company in `company_results`, so a test company's report-worthy verdict becomes its own row like any other company's (RLS keeps it to that company's members).
- **Verified**: with the old assertions, the fan-out test's Part 2 failed on exactly this ("is_test_company left out ... by default" FAIL, `Fanout Test Harness Co` listed among the scored companies). Updated test: the test company is scored by default and gets its own `TN051/2026 strong_fit` row (security tags); `include_test_companies=False` leaves it out (3 companies). Live CLI run (below, 9.2) listed `Fanout Test Harness Co` among the 5 companies scored and in the results.

### 9.2 (d) The Discovery seen store is in the database - CLOSED

Per company x release, not per release: scoring is per company, a company added later must still be scored on releases the others have seen, and each company's own verdict is what was (or wasn't) reported to it.

- **Migration `0038_discovery_seen_releases.sql`**: primary key `(company_id, release_key)` (`release_key` = ocid, else contract number - the watch's own key), `ocid`, `contract_number`, `title`, `verdict` (CHECK: the five verdicts + `ERROR`), `profile_fingerprint` (sha256 of the profile scored against, CHECKed as 64 hex), `first_seen`, `scored_at`; `on delete cascade` from companies; index on `release_key`. RLS: members select their own company's rows; no client write policy (service role only, like `discovered_opportunities`).
- **`watch_new_tenders.py`**: `run()` picks the store. Supabase mode (every company from the database, `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`): `load_seen_db()` reads only the rows for the releases in this run's window (`release_key=in.(...)`, chunks of 100), builds the same dict `fan_out()` already used, and `save_seen_db()` upserts only the pairs scored this run (`on_conflict=company_id,release_key`). The JSON file is not read or written. `--profile` files (no Supabase companies - they have no `company_id` to key on): the local JSON file (`--seen-store`), unchanged. A database read/write error fails the run loudly - it never falls back to the file and re-reports (or forgets) everything.
- `company_profiles.RestClient.select()` now accepts a list filter -> PostgREST `in.("a","b")` (each value double-quoted, so a contract number like `SCMU5-26/27-0007SB` is one value). `company_profiles.profile_fingerprint()`.
- The existing `state/seen_tenders.json` (111 entries) is not imported: every entry is pre-fan-out (one shared verdict against the old sample profile, no `companies` key), which `fan_out()` already re-scores per company. Nothing in it maps to a company's own verdict.
- **Verified**:
  - Migration replay `0001`->`0038` + `seed_tenders.sql` on a fresh scratch Postgres 16 (same auth/storage stub as earlier passes): all apply.
  - `test_discovery_fanout.py` Part 2 on that DB (0 failures): the two sample tenders x 4 companies -> 8 `discovery_seen_releases` rows, each with its company's own verdict (e.g. the architects' `not_a_fit` on TN051) and the fingerprint of the profile it was scored against; second run reads the table back -> nothing new **and no document re-read**; a company added later is scored (only it) and gets its 2 seen rows; the JSON path passed in is never created; under RLS a member reads only its own 2 seen rows and an insert is refused. Part 1 (profile files) keeps the JSON store: written, second run reports nothing.
  - **Real CLI round trip over HTTP**: `watch_new_tenders.py` run twice against the live national OCDS feed (`--days 3 --buyer "Mossel Bay"`, 7 releases), `NEXT_PUBLIC_SUPABASE_URL` pointed at a service-role PostgREST stand-in over the replayed DB (scratch only, not committed; rejects any other bearer key). Run 1: 5 companies scored, `0 company x release row(s) for this window`, 35 rows written (`POST ...discovery_seen_releases?on_conflict=company_id,release_key`, merge-duplicates); one tender `strong_fit` for the architects and `not_a_fit` for the other four. Run 2: `35 ... row(s) for this window`, 0 written, 0 reported. `state/seen_tenders.json` md5 identical before and after both runs.
- **Not verified**: against a real Supabase/PostgREST (gap 9). The stand-in parses what the script sends; real PostgREST's `in.()` quoting and bulk upsert are documented behaviour, not observed here.

### 9.3 (e) The daily digest's live mode scores per company - CLOSED

Before: `--mode live` printed "live mode's national-feed fetch needs a company profile per company ..." and left `new_tenders`/`submission_due` empty. Also found (not in the question, fixed with it): live mode put **every company's** document expiries, tasks and readiness changes into **every person's** digest - the items carried `company_id`, but nothing filtered on it. Shown on the old code with the new test's rows: the guarding member's digest listed `co-guard` and `co-arch` expiries and tasks.

- `daily_digest.py`: `score_per_company()` = `watch_new_tenders.fan_out()` (each tender's documents read once, scored per company with `score_release`) over the companies from `company_profiles.all_company_profiles()` - the same profiles the Discovery feed uses. A fresh seen dict, so the digest doesn't touch the Discovery seen store. `company_signals()` gives each person their own company's verdicts and narrows every company-tagged section to their `company_id`. Local mode runs the same path with the one `--profile` company. The warning is gone.
- **Verified**:
  - New `engine/notify/test_digest_live.py` (in CI, 0 failures): `daily_digest.main()` with `--mode live` and the env vars set, over in-memory rows (fakes: `watch_deadlines.supabase_request`, `company_profiles.RestClient`, `fetch_releases` -> the two real sample tenders, their own PDFs). `all_company_profiles()` is called once and `profile_from_company_rows()` for all 3 companies (test company included; 2 with `--exclude-test-companies`). Guarding digest: `TN051/2026 strong_fit` only; architects: `SCMU5-26/27-0007SB strong_fit` only; different score outlooks; the architects' viewer gets `count: 1`; each digest has only its own COID, task and readiness change. The same test on the old `daily_digest.py`: the first 4 checks FAIL (no profiles built, both `new_tenders` empty).
  - **CLI over HTTP**: `daily_digest.py --mode live --days 1 --no-fetch-documents` against the live national feed, env pointed at the same service-role PostgREST stand-in over the replayed DB (5 companies, 4 members in 3 companies): "Scoring the national feed (1 days) for 5 companies, each from its own profile", 4 digests. The verdicts are each company's own: e.g. `174000` (TN051, security) is in the guarding company's `submission_due` as needs_review and absent for the architects (their `not_a_fit`); `174028`/`174193` the reverse. The one due COID (set on the architects' row) is only in the architects' digest. Metadata-only scoring (documents not downloaded - a full document run of ~150 releases did not finish inside 15 minutes here), so no strong_fit/possible came up and `new_tenders` was empty for all four; the document path is the one the in-memory test covers.
- **Not verified**: against a real Supabase project (gap 9); no e-mail is sent (by design, unchanged).

### 9.4 New open questions from this pass

- **Re-surfacing on a profile change.** *(Answered 2026-10-17: yes - built, §11.1.)* A company is still never re-notified about a release it was scored on, even if its profile changed since (e.g. it tagged new Experience Library items). `discovery_seen_releases.profile_fingerprint` records the profile behind each verdict, so a rule like "re-score when the fingerprint changed, report only if the verdict became report-worthy" is a code change, not a migration. Wanted?
- **The other local seen stores.** *(Answered 2026-10-17: yes, and every other local state - built, §11.2.)* `watch_deadlines.py` (`state/seen_deadlines.json`) and the digest's readiness store (`state/seen_digest_readiness.json`) are still per-host JSON files, with the same multi-host problem (d) solved for Discovery. Move them too?
- **Seen before seeded.** The watch records a release as seen when it scores it; `seed_supabase_opportunities.py` writes the `discovered_opportunities` rows afterwards from the `--out` file. If seeding fails, those opportunities are never re-offered (true of the JSON store too). One script doing both, or seeding inside the watch's run, would close that.
- **`ERROR` verdicts are remembered.** *(Answered 2026-10-17: retry them and flag every failure to Sarel - built, §11.1 and §11.3.)* As before, a release whose scoring raised is recorded and not retried. With the store now shared across runs and hosts, should `ERROR` rows be retried on the next run instead?

---

## 10. Sarel's answers to Q3 and Q5 (2026-10-17) - built and verified

Full evidence, research and verification: `Discipline-Taxonomy-Findings.md`.

### 10.1 Q3: Tender Tool's own discipline list, maintained and growing

Sarel: *"There is no standard list ... CIDB is only a small portion of the tenders ... Let's rather build our own list ... it's a list that we're gonna have to maintain and build."*

**Research.**

- **eTenders.gov.za:** the public site's Category filter has 91 entries (15 legacy "Services:/Supplies:" entries plus 76 SIC-style industry divisions). Across all 2 211 tenders advertised on 2026-10-17, 29% are filed under one of three generic buckets ("Services: Professional", "Services: General", "Supplies: General"), each spanning a dozen unrelated trades. That is too coarse to be the taxonomy, but it is kept as a cross-reference.
- **OCDS API:** carries only goods / services / works / consultingServices (22% empty).
- **L2B:** trades as L2B (`l2b.co.za`). Its wiki publishes 17 tender categories plus 15 "industry" sectors; it is construction/facilities-centred, but its splits and keywords were used.
- **CIDB:** construction works only, about 18% of live tenders. Kept as a cross-reference on works categories, not as the list.

**Built.**

- **Migration `0040`:** a `discipline_categories` lookup table. Two levels (group → discipline, enforced by a trigger), with keywords and excludes, cross-references (eTenders / L2B / CIDB), `active` and provenance.
  - It is read by signed-in users and written by the service role.
  - Adding a category is an INSERT (`taxonomy.py add`), never a migration.
  - It is seeded with 19 groups / 93 disciplines grown against the real feed.
  - The original 7 buckets are 7 of the group slugs, so all stored values stay valid.
  - `tender_packs.price_sector` CHECK → FK.
- **`engine/discovery/taxonomy.py`:**
  - the matcher (whole words, `*` endings, `a & b`, excludes, `!` vetoes);
  - group/discipline overlap;
  - loads the live table whenever the service-role env is present, with a fallback to `config/discipline_taxonomy.json` (also in the worker image);
  - maintenance commands `check` / `coverage` (the review loop) / `sync` / `add` / `sql`.
- **`assess_tender.categorize()`** now sorts into this list, and `assess_fit()` matches through it (exact / group / broad "check scope"). Verdict rules are otherwise unchanged.
- **App (`app/lib/disciplineTaxonomy.ts`):**
  - Experience Library grouped checkboxes and group filters (a group covers its disciplines);
  - SANRAL compliance experience count (`expandDisciplines`);
  - Discovery labels;
  - the pricing sector select and the group-by-sector roll-up.

**Effect on live tenders.** Uncategorised fell from **66.1% → 2.9%** of the 2 211 live tenders, and from 70.8% → 2.8% of 400 OCDS releases. The old matcher's substring false positives are gone: "Road Accident Fund" plumbing → `roads_civil`, and "district" → `it_telecoms` via "ict".

### 10.2 Q5: SACNASP and SAGC - in the structure, asked for only when a tender requires it

Sarel: *"We can accommodate that into the structure, but don't specifically ask for it unless the tender requires it."*

- **`0040` adds 6 optional columns to `people`:** `sacnasp_category/number/expiry` and `sagc_category/number/expiry`. Same shape as ECSA/SACPCMP; nullable with no default.
- **Reminders:** `watch_deadlines.TRACKED_PERSON_EXPIRY_FIELDS` includes both expiries, through the same `find_due_person_credentials()` path.
- **People page:**
  - A body's fields are shown only when the person holds it, or when an **open tender's own requirements** ask for it:
    - a SANRAL SETUP position description naming an Engineering Geologist / Surveyor;
    - or a general tender's `document_requirements.person_registrations` from the new `requirements.py find_person_registrations()`.
  - The tender is named. Otherwise the fields sit in a closed "add another registration" disclosure.
- **Compliance:** checked only for a Geologist position (Pr Sci.Nat, number, valid at closing) or a Surveyor position (SAGC). The general workspace lists who holds a required body.
- **Verified on real PostgREST + RLS with `next dev`:**
  - hidden for a person and company with no asking tender;
  - shown with "Asked for by ..." once one exists;
  - a geologist whose registration lapses before closing fails the minimum;
  - the expiry reminder fires for a SACNASP registration due in 15 days and a lapsed SAGC one, on real replayed rows.

**Still open from Q5:** per-tender C3.1.11 extraction. New questions O1-O5 are in `Discipline-Taxonomy-Findings.md` §7.

## 11. Sarel's answers to the §9.4 questions (2026-10-17) - built and verified

Sarel: re-score a company when its profile changed; *"why would anything be saved in local instead of database"*; *"A fail must be emailed to me and flagged for me to review so that we can fix it. Any issues and breaks must be sent and flagged to me to keep reviewing and improving the app."* The seen-before-seeded question stays open.

### 11.1 Re-score on a profile change; ERROR verdicts retried - CLOSED

- `watch_new_tenders.fan_out()`: per release, `_pending()` picks the companies to (re-)score - never scored, last verdict `ERROR` (`retry_after_error`), or stored `profile_fingerprint` != `company_profiles.profile_fingerprint(profile now)` (`profile_changed`). A seen entry with no stored fingerprint gets the current one (only a later change counts). Only those companies are scored; the tender's documents are read once for them. Each `company_results` entry carries `rescored` and `previous_verdict`; the CLI prints "(re-scored: its profile changed since; was not_a_fit)". A report-worthy re-score is reported as new and seeded like any other result.
- Database mode: `load_seen_db()` returns the stored (verdict, fingerprint) per pair; `save_seen_db()` upserts every pair that is new or whose verdict/fingerprint changed, with `scored_at` = now and the original `first_seen`. `0041` corrects 0038's column comments ("not acted on today").
- Every read error (once per release) and scoring error (per company) is recorded in `system_alerts` (source `discovery`).
- `RestClient.select()` reads every page (`limit`/`offset`, 1000 per request - Supabase's cap); before, a seen-store read over >1000 rows would have silently stopped and re-reported the rest.
- **Verified** (`test_discovery_fanout.py`, fresh `0001`→`0042` replay): Part 1 - the architects' profile gains security work: only they are re-scored, TN051 `not_a_fit` -> `strong_fit` reported with `previous_verdict`, fingerprint updated, the next run silent; a forced scorer failure -> `ERROR` + 2 alerts with one fingerprint, the next run retries and reports `strong_fit` (`retry_after_error`). Part 2 (real rows) - the roads company tags security work and opens a Northern Cape office: only it is re-scored, TN051 `not_a_fit` -> `strong_fit`, its `discovery_seen_releases` row updated in place (new fingerprint, `first_seen` kept, `scored_at` later), its own Discovery row written, the next run silent; RLS unchanged.
- **Open:** a re-score that DOWNGRADES a verdict leaves the old `discovered_opportunities` row in place (the seeder writes report-worthy results only).

### 11.2 No local state - CLOSED

- Migration `0041_reminder_seen_stores.sql`: `deadline_reminders_seen` (PK company x consumer x seen key; `consumer` in `watch_deadlines`/`daily_digest`, kept apart exactly as their two files were; the scripts' own keys unchanged) and `digest_readiness_seen` (company x `field_provenance` row -> last status). Same shape and RLS as 0038: members read their own company's rows; service role writes.
- `watch_deadlines.py`: `load_seen_db()`/`save_seen_db()` through `company_profiles.RestClient`; every seen entry now carries its `company_id`; `--seen-store` removed; a database error records a critical alert and exits 1. `daily_digest.py --mode live`: both stores from the database; local mode never needed a store. Neither writes anything under `state/` any more.
- Whole-codebase sweep: the remaining local files and why each stays (profile-file Discovery runs, the SANRAL portal scraper's download snapshot, per-environment QA baselines, caches, committed reference data, local-mode inputs) are listed in System-Status, 19:00 pass, "Local files that stay local". `app/` keeps no local state.
- The existing `state/seen_digest_readiness.json` is not imported (it was a local test run's file); a first database run reports each currently-due item once, as a fresh deployment would.
- **Verified:** `test_reminder_seen_db.py` (CI part + DB part on the replay): CLI run 1 reports 4 items and writes 4 rows (each under its own company), run 2 nothing, a renewed document once; no file under `state/`; the digest consumer is independent; readiness stored under the pack's company, not re-reported; RLS read-own/no-write. Over HTTP (PostgREST stand-in on the replay): `watch_deadlines.py` 4 -> 0 -> 1 (renewed COID); `daily_digest.py --mode live` 5 rows written, then nothing reported. `test_digest_live.py` extended (seen rows in the database, second run silent, a readiness change reported once).

### 11.3 System alerts - CLOSED (with a named backlog)

- Migration `0042_system_alerts.sql`: `system_alerts` (source, severity, message, detail, context, fingerprint, occurrences, first/last seen, reported_at/reported_occurrences, resolved_at/by/note), unique open fingerprint, `record_system_alert()` (service role only - revoked from public/anon/authenticated). Owner-only RLS and resolution-columns-only update, the `admin_harness_runs` pattern.
- `engine/alerts/system_alerts.py` (`record()`, never raises; prints a `[system-alert]` line), `engine/alerts/check_system_alerts.py` (new + still-happening since the last check, `--out` JSON, `--min-severity`, `--dry-run`; the seen store is the table's `reported_*` columns; sends no e-mail - the scheduled check-in with Gmail access does, exactly like `watch_new_tenders.py`).
- Wired: pack, general, CV, CV-extraction bridges (job failures, stale jobs, SETUP/scoring failures, CV PDF conversion), OCR breakage, Discovery errors, every bridge's `--loop` poll failure, `run_bridges.py` (non-zero pass, timeout, crash), and run-level failures of `watch_deadlines.py`, `watch_new_tenders.py`, `daily_digest.py`, `watch_tender_updates.py` (plus its OCDS-day and SANRAL-page read failures). Backlog: System-Status, 19:00 pass, "System alerts backlog" (the web app itself first).
- /admin "System alerts": open alerts first (severity, source, message, open-new / open-e-mailed / resolved, occurrences), expandable traceback and context, "Mark resolved" with a note, "Reopen", recently resolved behind a disclosure.
- **Verified:** `test_system_alerts.py` (CI part: real CV and general bridges fed malformed jobs, run_bridges over a failing bridge, the checker CLI through new / nothing new / still occurring / resolved / recurrence; DB part: the real function and RLS). Over HTTP on the replay with real bridges and the real RPC. /admin rendered and the resolve action POSTed under real RLS. Details in System-Status's Built-table row.

