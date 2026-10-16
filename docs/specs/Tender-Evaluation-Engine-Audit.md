# Tender Evaluation Engine: Audit, Score Estimate and Compliance Check

Oct 16, 2026 · evidence-first pass, same discipline as `General-Tender-Engine-Findings.md` and `CV-Engine-Findings.md`

## What Sarel asked

> "a thorough assessment of each opportunity so that we can map it for a client or company to give them an idea how well suited the tender is in terms of the service and also in terms of how they will score on the tender."

Then, separately, once a company decides to pursue a tender:

> "an engine that does a thorough assessment to check the compliance level with the tender, to clearly highlight what documents the company has and don't have, and also in terms of CVs and experience."

That is three answers: **suitability** (is this our kind of work), **predicted score** (how would we do on the tender's own evaluation), and **compliance** (what do we have and what's missing for this specific tender). Before this pass the product answered only the first.

## Part A: audit of `engine/discovery/assess_tender.py`

### What it does today (Observed, from reading the code)

`assess_fit()` returns one categorical verdict plus plain-language reasons, from three inputs:

1. **Discipline match**: keyword buckets over the OCDS title/description (`DISCIPLINE_KEYWORDS`) against `company.disciplines` from the profile.
2. **CIDB**: if a document mentions a CIDB grading and the profile has no CIDB grading at all → `not_a_fit`. It does not compare grade levels, and it can't check grade against tender value: the value isn't available (see below).
3. **Document depth**: anything short of the full tender document downgrades the verdict to `needs_review`.

### What it does NOT do

- **It does not estimate a score of any kind.** No functionality points, no price/preference split, no specific-goals points. The verdict is suitability only.
- **`bee_level` is loaded from the profile and never used.** `load_company_profile()` reads it; `assess_fit()` ignores it.
- **The `possible` verdict can't actually happen.** The verdict starts as `possible`. A discipline match that survives the CIDB and depth checks is promoted to `strong_fit`. Every other path sets `not_a_fit` or `needs_review`. The Discovery page's filter treats `possible` as a real bucket, but no assessment produces it. In the 25-release live run below, none did.
- **`bbee_points_mentioned` returns noise.** On SANRAL's Book 1 it captured `"1"` from "B-BBEE Level 1", not a points value. Nothing reads it, so it now carries a comment and is left in place for output-shape compatibility.

Verdict: the engine answers "how well suited... in terms of the service" reasonably, within the limits of keyword matching. It does not answer "how they will score on the tender" at all.

## What real tenders actually score (Observed)

Read from real documents already in this repo or fetched from live eTenders releases on 2026-10-16. They were not inferred from titles.

### SANRAL Conventional Consultant (R.396-010-2025/1F Book 1, `templates/incoming/`)

Four-stage evaluation (Tender Data C.3.11, p. T-11 to T-14):

| Stage | What | Can it be estimated from our data? |
| --- | --- | --- |
| 1 | Responsiveness | Partly: this is the compliance check (Part B) |
| 2 | Mandatory admin: signed Form of Offer, CSD, valid COID letter, compulsory briefing attended, key persons meet C3.1.11 minimums | Yes, mostly. This is the compliance check (Part B) |
| 3 | **Functionality, 100 points, minimum 70**: Technical B1 (30), Management B2 (15), Workplan C2.4 (30), Quality system B4 (10), Past performance B6 (15) | **Partly. See below** |
| 4 | **Price 80 or 90 + specific goals 20 or 10**. Price: `Ps = 80(1-(Pt-Pm)/Pm)` against the lowest acceptable tender. Specific goals: a B-BBEE level table (Level 1 = 10/10 or 20/20 … Level 8 = 1/2) | Specific goals yes; **price never** |

Annexure A (p. T-17 to T-29) publishes the functionality method in enough detail to compute it:

- **Technical (per key person, out of 45):** for each of up to 3 projects, project-type relevance (a matrix of the person's project type against the tender's project type, 0-5), period relevance (5 within 10 years of closing, 2.5 at 10-15 years, 0 older, pro-rata under 6 months) and position held (a matrix of position held against position tendered, 0-5). The scores for all key persons are added, then scaled down to 30.
- **Management (out of 15 or 30 per position):** client points (National Roads Authority, Concessionaire or Provincial 5, Relevant SOE or Metro 4.5, Municipality 4, Private or Other 3.75). Managerial positions also score a managerial position-held matrix. Scaled to 15.
- **Quality system:** ISO 10, submitted for ISO 7, in-house 5, none 0.
- **Past performance:** 3 completed projects in 10 years, each with a CIDB PSP report or rated reference letter (poor 1, adequate 3, good 4, excellent 5). If there are fewer, a sworn affidavit applies "Adequate or 2 (two) points" to each missing project. The book's own table gives Adequate as 3, so **the book contradicts itself here**.
- **Workplan (30):** the company's normalised hours compared with the **80th percentile of all bidders' hours**. This can't be known before closing.

Per-tender inputs the method needs, read from the real template SETUP sheets: every one of the six SANRAL tenders (`templates/samples/*_ran.xlsm`) has PL = "PL, CE, RE - CONVENTIONAL - **DI**" and DS1 = "DS - Pavement and Materials - **DI/DN**", both marked **Non-Man**. Book 1 itself calls PL "managerial" in its narrative (T-25), and the workbook's `WORKINGS MATRIX` sheet labels PL "MANAGERIAL POSITION". The SETUP flag and the book disagree. The estimator uses whatever the tender's own SETUP says when it's stored, and scores both readings when it isn't.

Key-person minimum requirements (Book 2/3, C3.1.11(d), p. C3-14): PL, DS and CE need Pr Eng or Pr Tech Eng (ECSA) and 10 years' relevant experience. RE needs the same registration and 5 years. Assistants need the same registration with under 10 years. ARE needs registered-candidate status and 2 years.

### PPPFA preference points across other buyers (SBD 6.1 samples + live releases)

| Buyer (source) | Preference system stated | Specific-goal basis |
| --- | --- | --- |
| SANRAL (Book 1) | Decided by lowest acceptable tender | B-BBEE level table |
| National Treasury (SBD 6.1 .docx) | 90/10 | HDI equity-ownership formula |
| SALB (SBD 6.1 pdf) | 80/20 | Women ownership and others |
| QCTO (SBD 6.1 pdf) | All three template options left in | Women and youth |
| Dawid Kruiper LM (TN051) | 80/20 | **Locality only** |
| DPWI (SCMU5-26/27-0007SB, live) | 80/20 ("Maximum points on Price - 80") | Mixed: 100% black ownership 4, black women 6, youth 4, disability 2, Eastern Cape locality 4 |
| A Western Cape buyer (Q 2026/034, live) | 80/20 | Mixed: B-BBEE status 10, provincial locality 5, district locality 5 |
| Transnet (TPT/2026/06/0650/7337/RFP, live) | 80/20 | Ownership (EME/QSE 51% black-owned, jobs…) |

So specific goals are **buyer-defined, not a standard B-BBEE-level lookup**. Only SANRAL's table can be computed outright from the profile. Elsewhere at most a partial floor can be computed: DPWI's "100% black ownership → 4" row is claimable from Klipcorp's 100% black ownership, while women, youth, disability ownership and locality are not recorded.

### Facts that cap what any discovery-time estimate can do

- **OCDS gives no tender value.** `tender.value.amount` was `0` on **100 of 100** raw releases fetched 2026-10-16. The 80/20 vs 90/10 split, which depends on value, and a CIDB grade-vs-value check therefore can't come from the feed. They come from document text or not at all.
- **The SBD 6.1 template prints every preference option.** QCTO left all three in. Finding "80/20" and "90/10" both in the text proves nothing, so the outlook reports `ambiguous` unless exactly one explicit statement is found.
- **Functionality is common but buyer-specific.** In the live sample: DRT herbicide panel, minimum 70; Transnet, minimum 80; DPWI architectural PSP, "Scoring quality / functionality: N/A". Outside SANRAL, scoring is a committee judgment against the buyer's own criteria table.
- **Price is never estimable before closing.** The formula is relative to the lowest acceptable bid.

## What was built

### 1. `engine/discovery/score_outlook.py` (discovery-time "how it's scored")

`estimate_score_outlook(text, depth, profile, cidb_required)` reads the tender's own document text and returns, with a reason for every field:

- `preference_system`: `80/20`, `90/10`, `ambiguous` or `not_found`.
- `specific_goals`: the bases found (`bbbee_level`, `bbbee_status`, `ownership`, `locality`). It gives a **points estimate only** for (a) a fully readable SANRAL-style B-BBEE level table, or (b) a floor ("at least N") from a "100% black ownership" row when the profile records 100% black ownership.
- `functionality`: present, not applicable, or not mentioned; the threshold if stated; whether it's SANRAL's published method.
- `price`: always `null`, with the reason.
- `summary`: short lines the Discovery page renders as-is.

It's wired into `assess_release()` as a new `score_outlook` key, kept separate from `verdict`/`reasons`. The fit verdict is unchanged. The outlook flows through `watch_new_tenders.py` and `daily_digest.py` unchanged, because they pass the whole result dict. `seed_supabase_opportunities.py` writes it to the new `discovered_opportunities.score_outlook` column (migration `0013_discovery_score_outlook.sql`). The Discovery page shows it as a "How it's scored" box under each card's fit reasons.

**Deliberately not built:** a single "predicted score" number per discovered tender. Outside SANRAL the inputs don't exist (tender value, the buyer's functionality table, specific-goal ownership facts, competitors' prices), and any number would be fake precision.

### 2. `app/lib/sanralScoring.ts` (per-tender SANRAL functionality estimate)

This implements Annexure A as transcribed above. The matrices are copied from Book 1, pages T-18, T-19, T-24 and T-26. The estimate lives in the Tender Workspace, where the actually assigned people are known: it reads `tender_pack_assignments` to get the confirmed person, then that person's `projects` rows. Every unknown is a **range, never a point value**:

- Workplan: always 0-30.
- Quality system: 0-10 unless supplied (not in the schema).
- Past performance: computed from the Experience Library when it can be read (`pastPerformanceFromExperience()`). Only reference letters and CIDB reports count: rated ones score at SANRAL's 1/3/4/5, unrated ones 1-5, and up to 3 are used. Each missing slot is filled by the affidavit at 2-3, the book's own contradiction kept as a range. Without the library the range is 6-15.
- Project-type relevance: a range across the matrix row, because the tender's own project type (SETUP row 9) isn't stored in the schema.
- Management: both managerial readings, when `tender_requirements` has no row for the position.

Interpretations flagged in code: "converted back down to 30/15" is read as a straight proportion of the maximum available. Form B1 lists "the most recent 5" projects, and each criterion caps at 15. The 5 most recent projects are taken and capped.

### 3. Compliance check on the Tender Workspace (`app/app/tenders/[id]/compliance-report.tsx`, `app/lib/tenderCompliance.ts`)

One mounted component on the existing page, not a new page. It has four sections:

- **Required documents**: SANRAL's Part T2.1 returnable list plus the Stage 2 mandatory criteria, each grouped as **Don't have** / **Confirm by hand** / **On file**. Mandatory items are tagged, and a red banner appears if any mandatory item fails. Sources: the `companies` vault row (CSD number; COID number and expiry checked against the closing date; B-BBEE level; bank; director), plus `field_provenance` for the pack's filled forms (a form with blank fields shows as amber), `financial_captures` for C2.4 hours, and a `tender_tasks` row of kind `briefing` for briefing attendance.
- **Key people & CVs**: per position, the confirmed person (or "suggested, not confirmed") and the C3.1.11 minimum check (ECSA registration level, and years since first degree as an explicitly labelled proxy for relevant experience). It also shows: CV on file from `cv_uploads` (as-is vs AI-extract), tender-specific CV status from `generated_cvs`, the number of projects available for Forms B1/B2, and the existing specialism warning.
- **Company experience**: reads the Experience Library (`findMatchingExperience()`, which calls the `experience_matches()` function from migration `0012`, landed by the concurrent agent in `f5a7023`). It lists tagged roads & civil projects completed within 10 years of closing, showing which ones B6 actually scores (rated or unrated reference letters and CIDB reports) and which only prove the project. If the library can't be read, it falls back to a flagged amber notice. See below.
- **Functionality score estimate**: the `sanralScoring.ts` result with range bars, the threshold marker, an outlook sentence, per-position notes, and a closing note on price and specific goals.

"Confirm by hand" is reserved for documents the schema has **no field for**: SARS TCS PIN, insurance, ISO certificate, bank-letter date, B-BBEE proof expiry. The absence of a field is not evidence the company lacks the document, so those are never shown as "Don't have".

Only the SANRAL Conventional Consultant family is mapped. Any other `tenders.family` gets an explicit "not mapped yet" message rather than a generic checklist. Each buyer's returnable list differs (`General-Tender-Engine-Findings.md`, Finding 3).

## Verification (Observed)

- **`score_outlook.py` against 11 real texts** (SANRAL Book 1, Dawid Kruiper TN051, 4 SBD 6.1 samples, 5 live documents) and the **25-release live run**. SANRAL Book 1 gave functionality minimum 70, SANRAL methodology detected, specific goals "10 of 10 (90/10) or 20 of 20 (80/20)", preference ambiguous (correct: SANRAL decides by the lowest acceptable tender). DPWI gave 80/20, no functionality, specific goals "at least 4 (100% black ownership row only)". Transnet gave a minimum of 80 and 80/20. Final live run, 25 open releases from a 7-day OCDS window with documents fetched:
  - Verdicts: `needs_review` 15, `not_a_fit` 8, `strong_fit` 2, and `possible` 0, as predicted above.
  - Outlook: `partial` 12, `none` 13 (8 had no readable document).
  - Preference system: stated 80/20 on 11, ambiguous on 5, not found on 9.
  - Functionality thresholds: found on 2 (70 and 80).
  - Specific-goal estimate: given on 1 (DPWI). Every other buyer's specific goals were named but deliberately left unestimated.

  Two false positives were caught and fixed during the pass:
  - the bare word "functionality" in Treasury's SBD 6.1 definitions clause;
  - "B-BBEE Status Level" in proof-of-status boilerplate being read as a level-points table. That is now accepted only if Level 1 reads exactly 10/20.
- **SANRAL estimate against real data** (Henning's 3 real projects from `config/klipcorp_profile.json`, R.396-010's real SETUP facts DI/DI-DN/Non-Man, both positions assigned to Henning as in the sample pack). Results: PL technical 39/45, DS1 technical 34.5/45, technical **24.5/30**, management **13.5/15**, total **44-93**. Outlook: "Key persons give about 38 of 45. Clearing 70 then needs at least 32 of the remaining 55." Hand-checked against the matrices. For example, DS1 project type on a DI/DN tender scores 4 per project × 3 = 12, and a CE position held against a DS position scores 2.5 × 3 = 7.5. As the web page sees it today (no SETUP project type or managerial flag stored), the result widens to technical 23.5-27.5, management 13.5-14 and total 38.5-96.8.
- **Compliance lib against real data**: the Klipcorp vault values as `seed_supabase_company.py` would write them, plus the real `out/R.396-010-2025.1F/field_provenance.json`.
  - CSD: on file.
  - COID: valid to 2027-04-30, covers the closing date (amber only because the filled A20 still has a blank field).
  - C2.4 hours: don't have.
  - Briefing: confirm by hand (no task).
  - B-BBEE: amber (SANRAL asks for a verification certificate; Klipcorp holds a QSE affidavit).
  - Henning meets the PL/DS minimum (Professional Engineer, 16 years).
  - Edge cases also checked: a Pr Techni (Professional Engineering Technician) correctly fails Pr Eng/Pr Tech Eng; a 2020 graduate fails the 10-year minimum; an expired COID shows red.
- **Migration `0013`** replayed after `0001`-`0012` (including the concurrently landed `0011` and `0012`) on a scratch Postgres 16 (same stubs as earlier passes). It applied cleanly, and the column was confirmed `jsonb`, nullable. A real outlook JSON was inserted and read back. `0008` still fails on its pre-existing `created_at` index bug; that is not from this pass and is already recorded in System-Status.
- `npm run typecheck` and `npm run lint` pass clean.

## Limits, stated plainly

- **No live Supabase project** exists in this environment, so the Tender Workspace sections were type-checked and their logic run against real data offline, but never rendered against a real database.
- **`tender_requirements` is not seeded by anything** (no script writes it). Positions therefore come from `tender_pack_assignments`, and the description and managerial flag are usually unknown, which widens the SANRAL estimate. Capturing SETUP rows 8 and 9 (Man/Non-Man, applicable matrix and project type) would narrow it to the exact figures above. That needs a small migration and a seed step, and is not done here (see questions).
- Project-type matrices are transcribed only for PL/CE/RE-conventional and DS Pavement & Materials, the two in Book 1 that this repo's six tenders use. The other matrices (structures, geometrics, toll and so on) live in SANRAL's spreadsheet and aren't transcribed, so those positions get 0-5 per project. RRM-family tenders are not covered.
- Years since first degree is a proxy for "relevant experience". SANRAL counts relevant years, so the UI says so wherever it uses it.
- Discovery outlook parsing is regex over `pdftotext` output. Real specific-goal tables vary in layout. When unsure it names the basis and returns no number, but a garbled table can still be missed (`not_found`). Thin, scanned or failed documents always yield "unknown until the full RFP is read".

## Experience dimension: wired to the Experience Library

The concurrent Experience Library work **landed on `main` during this pass** (`f5a7023`: migration `0012_experience_items.sql`, `app/lib/experience.ts`). It was checked in `git log` before pushing, and its landed migration was diffed against the version read earlier, with no differences. It is used as built, with no shape guessed:

- The compliance report's B6 row and "Company experience" section call `findMatchingExperience(supabase, companyId, { disciplines: ["roads_civil"], completedWithinYears: 10, asOf: closing date })`. That function returns tagged rows only. "Similar scope" is read as the roads & civil tag, because every tender in this family is SANRAL roads consulting, and the UI says so.
- B6 status: **On file** if there are 3 or more rated reference letters or CIDB reports in the window; **Confirm by hand** if there are 3 or more but some ratings aren't tagged; **Don't have** if there are fewer than 3, with the affidavit fallback named.
- The score estimate's past-performance component comes from those rows via `pastPerformanceFromExperience()`, replacing the blanket 6-15 range. Verified on four synthetic cases (the logic, not real Klipcorp rows):

  | Experience on file | B6 points | B6 status |
  | --- | --- | --- |
  | Nothing | 6-9 (three affidavit slots) | Don't have |
  | One "good" letter | 8-10 | Don't have |
  | One unrated letter plus an award letter | 5-11 | Don't have; the award letter is shown as not scoring |
  | Four rated CIDB reports | 12 (best three: 5 + 4 + 3) | On file |

- **Real limitation:** no live Supabase project exists here, so it has not been run against real tagged Klipcorp experience. The experience agent's own findings note that Klipcorp's real NRA 2026/0084 submission used the B6 affidavit (0 projects), so the expected live result today is the "nothing" case until evidence is captured.

## Open questions for Sarel

1. **Store the SETUP facts?** SETUP rows 8-9 (Man/Non-Man and the applicable project-type matrix, e.g. "DI") narrow the SANRAL estimate from 38.5-96.8 to 44-93 on R.396. Worth a `tender_requirements` seeding step and a project-type column?
2. **PL managerial or not?** These six tenders' SETUP sheets say PL is Non-Man, but Book 1's narrative and the workbook's own WORKINGS MATRIX call it managerial. Which has SANRAL actually scored you on in past results?
3. **B6 "Adequate" = 2 or 3 points?** The book says both. Do you have a past SANRAL evaluation result that shows which one they apply?
4. **Quality system:** does Klipcorp have ISO 9001, one submitted for certification, or an in-house QMS? That alone is worth 5-10 functionality points and is currently a 0-10 range.
5. **B-BBEE proof:** SANRAL's specific-goals note asks for a "valid B-BBEE verification certificate". Klipcorp holds a QSE sworn affidavit. Has SANRAL accepted the affidavit on past submissions?
6. **Vault fields:** the compliance check can't see the SARS TCS PIN, insurance, ISO certificate, bank-letter date or B-BBEE proof expiry, because the schema has no fields for them (several are already in the profile JSON). Add them? This overlaps `Document-Expiry-Tracked-Fields-Open-Item.md`.
7. **Ownership facts for specific goals:** buyers outside SANRAL score women, youth and disability ownership and locality. Should the company profile capture those (percentage owned by black women, youth, people with disability, and office municipalities) so the outlook can estimate them?

## Answers received (2026-10-16) and what changed

Sarel's answers, verbatim. His numbering follows the combined question list, not the 1-7 above.

- **"4. Might be enough, but would rather increase it to a bit."** This is the upload cap (Experience Library question 4). `bodySizeLimit` went from `4mb` to `4.5mb`, which is Vercel's hard request-body cap. A higher value can't work through a Server Action on Vercel. See `next.config.ts` and System-Status.
- **"8. They have iso 9001."** This answers question 4 above. `companies.iso_9001_certified` / `_certificate_number` / `_expiry` / `_document_path` were added. When the certificate is valid at closing, the score estimate's quality system is fixed at 10 instead of the 0-10 range. Note: Klipcorp's real NRA 2026/0084 submission put an **in-house QMS** write-up in Form B4, not an ISO certificate. That scores 5, not 10, so the certificate should go into future packs.
- **"9. Yes it is a standard acceptable template."** This answers question 5 above. `companies.bee_proof_type` (`certificate` / `qse_affidavit` / `eme_affidavit`) and `bee_proof_expiry` were added. Any proof type valid on the closing date gives "On file". An affidavit is described as equivalent evidence, never as a missing certificate.
- **"10. Yes."** This answers question 6 above. Migration `0014` added the SARS TCS PIN, PI insurance, ISO 9001, bank-letter date and B-BBEE proof fields, with uploads to a private `company-documents` bucket. The compliance check's A9 / A12 / A17 / A18 / B4 rows are now real On file / Don't have checks, with a "Renew soon" chip. "Confirm by hand" now only means a detail is missing (for example, an expiry date).

## Round 2: answers 3, 5, 6 and 11 (2026-10-16)

Sarel, verbatim:

- **"3. experience evidence is specific to each tender, need to assess each tender what counts as evidence they normally specify in the functional requirements."**
- **"5. Yes, have a look at tenders what the categories are that they normally ask for. Also the roles and disciplines."**
- **"6. Not sure, companies need to specify which sanral roles a persons cv fits."**
- **"11. Yes office location sometimes counts for scoring."**

### Corpus read (Observed)

- **SANRAL:** Book 1 of all six Conventional tenders (`pdftotext -layout`; the B6 and Annexure A text is identical in all six). Also SANRAL's own Consultant Technical Submission workbook from two RRM tenders: Klipcorp's completed NRA 2026/0084 (`templates/incoming/completed_sample/`) and MP RRM Batch 3 (NRA 2026/0019). The `SETUP`, `WORKINGS MATRIX` and `Proj Relevance Codes` sheets were read.
- **Non-SANRAL, 14 real documents:** the 5 from the first pass (Gauteng DRT 09/09/2026, DPWI EC SCMU5-26/27-0007SB, Transnet TPT/2026/06/0650/7337/RFP, Cape Winelands Q 2026/034) plus Dawid Kruiper TN051/2026. Eight more were fetched from the same live OCDS window for this pass: uMlalazi LM KZN ULM 15/26/27 (road repairs, CIDB 2CE), TNPA asbestos removal, TNPA North Groyne ablution block, Overberg DM lifeguards, Sentech structural-engineer RFQ, LEDA valuation panel, BCMDA security and DLRRD N14 precinct plan. Three more (SASSA, Dept of Employment & Labour, EC Roads generators) were scanned images with no text layer and can't be read.

### (a) Experience evidence is worded differently by every buyer (Observed)

| Buyer | Verbatim (abridged) | What counts | Count / window | Consequence |
| --- | --- | --- | --- | --- |
| SANRAL (all 6) | "Past Performance reports must be submitted ... for any 3 (three) completed projects of similar scope in the last 10 (ten) years" | CIDB Annex 1 PSP report or client reference letter, rated; affidavit fallback | 3 / 10 yrs | Points (15) |
| Gauteng DRT, Schedule A | "Bidders must submit Completion Certificates ... Practical completion certificate will not be accepted ... issued since the year 2000" | Completion certificates only | 1-5 scored per project / since 2000 | 0 points without |
| Gauteng DRT, Schedule B (same tender) | "reference letter(s) with an aligned appointment letter(s), signed by all relevant parties and supported by corresponding award letter(s)" | Reference letter AND appointment letter | 1-5 scored per project | 0 points without |
| Transnet TPT | "Five (5) traceable Purchase Orders or Award Letters or Appointment letters with Completion Letters or Completion Certificates ... within the last ten (10) years ... Proof of completion submitted without proof of appointment will not be evaluated" | Appointment AND completion proof | 5 (40 pts), 4 (20), 3 (10) / 10 yrs | Points; untraceable proof disqualifies |
| DPWI EC | "a minimum of three (3) written contactable references ... as a Professional Architect ... or similar nature"; schedule "COMPLETED PROJECTS THREE OF WHICH IN THE LAST FIVE (05) YEARS" | Contactable written references | 3 / 5 yrs | Responsiveness |
| uMlalazi LM | "previously completed similar projects in the past 6 years ... Attach appointment letters and completion certificates" | Appointment AND completion | 4+ (30 pts) ... 1 (5) / 6 yrs | Points |
| TNPA asbestos | "A Minimum of three (3) reference letters/completion certificates not older than 10 years" | Reference letter or completion certificate | 3 / 10 yrs | Points |
| TNPA ablution | "traceable references ... in the last 10 years (Project must have been completed in December 2015 onwards) ... shall supply completion certificates" | Completion certificates | 1-5 scored / 10 yrs | Points |
| LEDA | "Fully signed reference letters AND appointment letters / purchase order ... (not older than 10 years)" | Reference letter AND appointment | 4+ (40) ... 1 (10) / 10 yrs | Points |
| Overberg DM | "1-2 Positive References = 5, 3-4 = 15, 5+ = 20"; eligibility "At least three (3) reference letters" | Reference letters | 5+ / none | Points |
| Dawid Kruiper | "3 Contactable references (Signed reference letters with clients' letterhead will only be accepted as proof of experience) ... non-responsive" | Signed letters on letterhead | 3 / none | Disqualifies |
| Sentech | "Signed reference letters on a client's letterhead, a completion certificate, or an affidavit (... supporting documents such as appointment letter, purchase order)" | Any of these | 5 listed | Responsiveness |

Every axis varies: the evidence type, whether appointment and completion must be **paired**, the count, the window (5, 6 or 10 years, "since 2000", "Dec 2015 onwards"), and whether a shortfall costs points or disqualifies. SANRAL's B6 is one row of twelve, not the norm.

### (b) Roles and disciplines (Observed)

- **SANRAL Book 1 defines 23 key-person codes (T-18)**: PL, APL, DS, DA, CE, ACE, RE, ARE, RM, ARM, SMT, CM, SA, MT, ETS, PL(T), DS(T), CE(T), CM(T), ETS(T), ES, MS, PE(E).
- **Book 1 publishes 9 project-type matrices, not 2.** They are on T-18 to T-23: PL/CE/RE Conventional, plus DS Pavement & Materials, Structures, Electrical, Geometrics, Traffic & Transportation, Geotechnical, Electronic Systems and Engineering Geologist. *Correction to the first pass, which said "the other matrices ... live in SANRAL's spreadsheet and aren't transcribed".* Only the RRM matrix ("CE, RM/ARM - RRM", listed in the workbook's `Proj Relevance Codes`) is absent from Book 1.
- **A Design Specialist is tendered per specialism.** The workbook says "DS2 Design Specialist 2 - Structures" and "DS3 ... Geometrics"; the six SETUP sheets say "DS1 ... Pavement and Materials". A person who fits one DS specialism doesn't fit another, so "DS" is not one role.
- **"Managerial" is set per tender, not per role.** SANRAL's master position list (`WORKINGS MATRIX`) marks PL1, CE1, RE1, RM1, PL(T), CE(T) and CM(T) as "MANAGERIAL POSITION" and the rest "NON-MANAGERIAL". But all six Conventional SETUP sheets mark PL "Non-Man", and both RRM SETUP sheets (NRA 2026/0084, NRA 2026/0019) mark CE1 "Man". This settles the first pass's question 2: the tender's own SETUP decides.
- **Roles other buyers name:**
  - Construction contractor key personnel: Contract Manager, Site Agent and Foreman (uMlalazi, each scored on diploma plus years); Supervisor and Project Manager/Site (TNPA).
  - Safety Officer, registered with SACPCMP. DRT: "Candidate registration is not acceptable". Also uMlalazi C3.1.18 and the TNPA organogram.
  - Registered professionals: Pr Eng (Sentech, ECSA), Professional Architect and Architectural Technologist (DPWI, SACAP), Town and Regional Planner as Project Leader (DLRRD, SACPLAN, scored on post-registration years), Property Valuer (LEDA, SACPVP), Quantity Surveyor (DPWI, named but not scored).
  - Trades: trade-tested Mechanic and Auto Electrician/Millwright (Transnet, SAQA), trade-tested Carpenter (TNPA).
  - Services: Certified and Assistant Pest Control Operator (DRT), PSIRA-registered Security Officers (Dawid Kruiper, BCMDA).
- **Disciplines** beyond the existing 7 `DISCIPLINE_KEYWORDS` buckets: architecture fits `buildings`; pest control, valuation and town planning don't fit any existing bucket. No new discipline key was added. These tenders came from a feed Klipcorp doesn't bid in, and adding a key also means changing migration 0012's check constraint (see open questions).

### (c) Locality wording (Observed)

| Buyer | Verbatim | Level | Points |
| --- | --- | --- | --- |
| DPWI EC | "Locality: (a) Within Eastern Cape 4 (b) Outside Eastern Cape 0" | Province | 4 of 20 |
| Cape Winelands DM | "enterprise head office or primary place of business or regional or satellite office is located within the boundaries of the Cape Winelands District Municipal Area" 5 (80/20) / 2.5 (90/10); "... Western Cape Province" 5 / 2.5 | District, province; any office | 5 |
| Overberg DM | "Within the boundaries of Overberg District 6 / Within the boundaries of the Western Cape 4", verified from the "CIPC/CIPRO ... Address of registered office" | District, province; registered office only | 6 |
| uMlalazi LM | "Enterprise Located within uMlalazi Municipality 4 / within District Municipality 2 / within the Province 1"; **also** a functionality criterion: "Bidder operating within uMlalazi Municipality (Points = 10) ... King Cetshwayo District (5) ... Kwazulu Natal province (2)" | Local, district, province | 4 SG + 10 functionality |
| LEDA | "Enterprises located within Limpopo 3" | Province | 3 |
| Dawid Kruiper | "Within the boundaries of Dawid Kruper 20.00" (sic) **and** "must have a local office in the Dawid Kruiper Municipal Jurisdiction ... non-responsive" | Local | 20, and mandatory |

The proof buyers name: municipal account not older than 90 days or 3 months, a lease, a bank letter confirming the business address, utilities, an affidavit, or the CIPC registered office. SANRAL's specific goals are the B-BBEE level table only, with no locality row on any of the six tenders.

### What was built

1. **`score_outlook.py`: `extract_experience_evidence()` and `extract_locality()`/`match_locality()`.**
   - Each evidence rule records the count, whether it is scored per project, the window (years or "since" year), the accepted evidence, whether appointment and completion are paired, the practical-completion exclusion, scope, consequence, and a verbatim quote.
   - Locality rows are recorded with area, level, points, preference system and kind (specific goals vs functionality), plus any mandatory local office. Rows are matched against the company's offices.
   - These are wired into `estimate_score_outlook()` as `experience_evidence` and `locality` keys, and as `/discovery` summary lines.
   - `assess_tender.load_company_profile()` now carries `offices`: `company.offices[]` when present, otherwise one office **derived from the registered address's province and flagged `derived`**. The summary says so.
2. **Migration `0015_company_offices.sql`:** a tenant-scoped `company_offices` table with province (check-constrained to the 9), district/metro, local municipality, town, office kind (registered/head/branch/site) and proof type and date.
3. **Migration `0016_tender_roles.sql`:**
   - `tender_roles`: a shared catalog of **47 roles**. There are 30 SANRAL entries: the 23 codes, with DS split into the 8 Book 1 specialisms. There are 17 roles from other buyers. Every row has a `source` citation. `default_managerial` holds the master-list value, **for information only**.
   - `person_role_eligibility`: the company's manual tag. RLS also checks that the person belongs to the same company.
   - `tenders.evaluation_rules jsonb`.
4. **`app/lib/sanralMatrices.ts`:** all 9 Book 1 project-type matrices, the position-held and managerial matrices and client points, as structured data. Also `matrixForPosition()` and `sanralRoleCodeForPosition()` (DS resolved by specialism from the description). `sanralScoring.ts` now reads from it, and its output is unchanged on the R.396 regression.
5. **People page:** "Tender roles this CV qualifies for", a checkbox list grouped by family. Hovering a role shows its source tender. Saved by `saveRoleEligibility`.
6. **Company page:** an "Office locations" section (`OfficeLocations.tsx`, `officeActions.ts`) to add, edit and remove offices.
7. **Compliance report:**
   - **Role fit comes from the tag.** The C3.1.11 heuristic is shown beneath it as a "cross-check from records on file". When the heuristic contradicts a tag, the row turns amber, because SANRAL Stage 2 still disqualifies a key person below minimum. An unfilled position names the people tagged for that role.
   - **B6 and Company experience use `tenders.evaluation_rules`** (count, window, accepted document types, paired-proof rule). Each tagged item is marked "Counts" or "Not accepted by this tender". When no rule is stored, the SANRAL B6 pattern is used under an amber **"Assumed rule"** banner.
   - **A Locality section** appears when the tender's rules contain locality rows, and is hidden when they were read and contain none (SANRAL).
8. **`engine/seed_tender_evaluation_rules.py`:** reads a tender document (PDF or text), prints what it found (dry run) and, with `--write`, stores it on `tenders.evaluation_rules` with the service role.

### Verification (Observed)

- **Extraction on real text.** All 12 rules in table (a) were extracted correctly, with a verbatim quote each. All six SANRAL Book 1s gave the identical rule: 3 projects, 10 years, performance report / reference letter (affidavit fallback), points. Every locality table in (c) was read with the right level and points: CW 5/2.5 per system, DPWI 4, Overberg 6/4, uMlalazi 4/2/1 (SG) and 10/5/2 (functionality), LEDA 3, Dawid Kruiper 20 plus the mandatory office.
  - Fixed along the way:
    - key-personnel "contactable references" (DRT Forms B1, uMlalazi CVs) wrongly read as company evidence;
    - the "30 (4) Project value" table cell read as a count;
    - interleaved table columns hiding "last ten ... (10) years" (Transnet);
    - the Cape Winelands row index read as points;
    - "South Africa or abroad" read as an area.
- **No regression.** The old and new `estimate_score_outlook()` were compared on 38 real texts. Preference system, functionality and specific goals are identical on 37. On LEDA, `locality` is now correctly added as a basis ("Enterprises located within Limpopo").
- **Real profile.** Klipcorp's registered address is Gauteng (derived office). It gets "no office in the preferred area" on DPWI, Cape Winelands, Dawid Kruiper (plus "non-responsive without a local office") and LEDA. A test Stellenbosch office matches Cape Winelands for 5 points under 80/20. A test Upington / Dawid Kruiper office matches the misspelled "Dawid Kruper" row for 20.
- **SANRAL estimate is unchanged after the refactor.** Old and new `sanralScoring.ts` were run side by side on Henning's real projects: 24.5 / 13.5 / 44-93 with SETUP facts, and 23.5-27.5 / 13.5-14 / 43-96.5 as the page sees it today. (The first pass's write-up quotes 38.5-96.8 for the second case. The HEAD code before this pass already gives 43-96.5, so that figure was a write-up slip, not a regression.) A new DS2 Structures case was hand-checked: 7 + 12.5 + 12.5 = 32.
- **Role fit:** tagged PL plus Pr Eng gives On file. Tagged PL plus Pr Techni gives amber, with the contradiction spelled out. Untagged DS1 gives amber and names who is tagged. DS1 with no description gives amber ("tendered per specialism"). Unfilled gives Don't have, listing tagged people.
- **Evidence evaluation:** the R.396 own rule and the assumed fallback were each run against an empty library and a 4-item library. The Transnet paired rule doesn't count award letters on their own. DRT Schedule A counts only completion certificates since 2000 and reports the second rule.
- **Migrations `0015` and `0016`** were replayed after `0001`-`0014` (including the concurrent `0014`) on scratch Postgres 16, and all applied cleanly. RLS tests as `authenticated`:
  - a user's own tags and offices are accepted;
  - a tag on another company's person (under one's own company id) is rejected by the with-check;
  - inserting into another company is rejected;
  - an unknown role is rejected by the FK, and a duplicate tag by the unique key;
  - "Natal" as a province is rejected;
  - the other tenant sees 0 rows;
  - deleting a person cascades their tags.

  The real R.396 rules JSON was stored on `tenders.evaluation_rules` and read back.
- `npm run typecheck` and `npm run lint` are clean.

### Still approximate or assumption-based (flagged in the UI and code)

- **No tender row has `evaluation_rules` until `seed_tender_evaluation_rules.py --write` is run.** No live Supabase project exists. Until then, every tender shows the amber "Assumed rule" (SANRAL B6) banner, which is the intended fallback, labelled as such.
- **When a tender states several rules** (DRT, one per schedule), the compliance row uses the first and says how many more there are. It doesn't know which schedule the company is bidding.
- **Experience items are single documents.** For "appointment AND completion" rules, the check counts completion documents and asks the user to confirm each project also has its appointment letter. Pairing isn't modelled.
- **Matching still uses `roads_civil` for SANRAL.** The rule's `scope` (e.g. "similar scope", "Port Freight Haulers") is shown verbatim for a human to judge, not matched.
- **DS positions need a description to map to a role.** `tender_requirements` is still unseeded (question 1 of the first round), so on today's data every DS1 is "Confirm by hand".
- **Rotated matrix headers.** Column order for the 7 new matrices was taken from header positions in `-layout` output and the workbook's code-list order, then checked for the diagonal. The DS Geotechnical columns (DNG/DIG/DSG/MSG) have no diagonal to check against.
- **Locality extraction is regex over `-layout` text.** Unnamed rows ("within District Municipality") borrow a district named elsewhere in the same document when there is exactly one, flagged `area_inferred`. "Within the Province" takes the document's most-mentioned province.
- **Discovery reads offices from the profile JSON**, not `company_offices`. Klipcorp's profile has no `offices`, so its one office is derived from the registered address's province and labelled as derived. District and municipality are never guessed from a street address.
- **Proof age isn't checked yet.** `company_offices.proof_date` is captured, but buyers' "not older than 90 days / 3 months" limit isn't enforced in the check.

### New open questions

1. **Which offices does Klipcorp actually have?** Add them on the Company page with district and local municipality. The registered address (Modderfontein/Edenvale) suggests City of Ekurhuleni, Gauteng, but that hasn't been confirmed, and none of the locality tenders seen so far is in Gauteng.
2. **Tag Henning's roles.** His record shows CE on all three ACSA projects, and the CLI pack put him in both PL and DS1, with the specialism warning "no evidence of Pavement and Materials experience". Should he be tagged PL only, or PL plus DS Pavement & Materials?
3. **Seed `tender_requirements`** (first-round question 1)? It now matters twice: it gives DS positions their specialism (so role tags can match), and it gives the managerial flag and tender project type (which narrows the estimate).
4. **New discipline buckets?** Architecture, pest control, valuation and town planning showed up in the feed. Add discipline keys only if Klipcorp will bid outside roads/civil; each one also changes `DISCIPLINE_KEYWORDS` and 0012's check constraint.
5. **Multi-schedule tenders:** should a compliance check be per schedule (DRT A vs B) rather than per tender?
