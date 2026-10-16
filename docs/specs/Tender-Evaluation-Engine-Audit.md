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
