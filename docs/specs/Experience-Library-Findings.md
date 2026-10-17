# Company Experience Library — Findings

Oct 16, 2026 · research pass before building the experience library

## Question this answers

Sarel asked (2026-10-16): "We must have all experience also be able to capture. That can be letter of awards, reference letters, closeout reports, completion certificates... allow for manually updating the attributes to specify what type of experience it shows, which industry, which type of project, which type of service, how we can map that to tenders. So have a look at what tenders normally ask for in terms of experience, and let's use those categories."

Before building, this doc looks at what real tenders in this repo actually ask for. Same evidence discipline as `General-Tender-Engine-Findings.md` and `CV-Engine-Findings.md`: **Observed** (with the source file) vs **Assumed**.

## Confirmed: nothing existed for this before

Grepped the repo for experience/reference/past-performance handling before building. The only related things are:

- `projects` (`0001_init_schema.sql`), which is **one person's** key-person CV history (feeds SANRAL Forms B1/B2 through `suggest_pack.py` and `generate_cv.py`). It is not company experience, and it has no document storage.
- The SANRAL spec's open-issues list already says "the B6 past-performance sheets ... are not generated".
- `klipcorp_profile.json` `gaps[]`: "'Previous Experience' subfolder inside 'Klipcorp Submission' folder is empty".

Nothing captured company experience evidence (reference letters, completion certificates and so on) anywhere in `app/` or `engine/`.

## What real tenders ask for (Observed)

### 1. SANRAL consultant tenders: Form B6, "Past performance experience on reference projects" (15 of 100 points)

Source: `templates/incoming/R.396-010-2025.1F/.../R396-010-2025-1F -Conventional Consulting Engineers - Book 1.pdf` (pdftotext), pages T-12, T-27 and T-70 to T-72. The same sheets appear in the real RRM workbook `templates/incoming/completed_sample/Completed tender/Technical submission/RRM_Consultant_Tender_-_WCP_V2_Batch_2B_Technical_Submission_FINAL_FILLED.xlsm`: sheet names `B6 - Scoring - Past Performance`, `Annex 1 PSP Perf. Report`, `Reference Letter for PP`, `Affidavit for Past Performance`.

- Functionality table: "Past performance experience on reference projects (Form B6)", maximum **15** points out of 100, with an overall 70-point minimum to stay in the tender.
- Exact requirement: "Past Performance reports must be submitted by the tenderer for any **3 (three) completed projects of similar scope in the last 10 (ten) years** by the tenderer (any member of the Joint venture)."
- Accepted evidence, verbatim: "**CIDB Annexure 1: PSP Performance Report**" or "**Reference letters from Client or Client's representative**", "signed by all relevant parties".
- Scoring is **by rating on the document**: Poor/Adequate/Good/Excellent scores 1/3/4/5 per project. A CIDB report is scored by its numeric rating band.
- Fallback: with fewer than 3 projects, the tenderer submits a sworn affidavit and gets "Adequate" (2 points) for each missing project.
- B6's own note gives an example of what "similar scope" means: "Crack sealing, pothole repair, edge repair, shoulder repair and blading". This is **scope words**, not a code.
- The SANRAL reference-letter template asks the client to confirm: the tenderer's name, the **project value** ("to the value of R…"), the **completion date**, a **rating**, whether specs were complied with, whether they'd recommend the tenderer, and a **contact name, number and email**.
- CIDB Annex 1 (in the real workbook) records Employer name, contract number and title, **"the project stage for which assessment is made"** (Project initiation / Inception / Concept and viability / Design development / Documentation & procurement / Construction / Close out), the completion date, and the reporting officer's contact details.

**Klipcorp's own completed submission** (`templates/incoming/completed_sample/Completed tender/Returnables/Form B6.pdf`, rendered and read as an image because it has no text layer): a sworn **"Affidavit for Past Performance"** signed 09/09/2026 by Krisun Naidoo, ticking "**0 (zero) projects**" for Klipcorp (Pty) Ltd. Whatever the real history is, no reference letters or performance reports were to hand for that tender. Up to 15 points were scored on the affidavit default instead of on evidence. This feature exists to close exactly that gap.

### 2. SANRAL Forms B1/B2: the coded vocabulary (key-person level, reused here)

Same Book 1, pages T-16 to T-25.

- **Project type, coded**: MO/MA, MP/MS, DS, DI, DN, CD, RRM, MSC, MSB, DIB, DNB, MSS, DIS, DNS, Street Lighting, Traffic Lights, … (the complete list is the workbook's `Proj Relevance Codes` sheet, 46 codes, identical in all 7 workbooks on hand; `app/lib/experience.ts` `SANRAL_PROJECT_TYPES` holds all of them since 2026-10-17 - it held 27 before, see `Hardcoded-Assumptions-Audit.md`). Scored through a project-type relevance matrix.
- **Client, coded and scored**: National Roads Authority 5, Concessionaire 5, Provincial Authority 5, Relevant SOE 4.5, Metro Council 4.5, Municipality 4, Private 3.75, Other 3.75.
- **Period relevance**: within 10 years scores 5, 10 to 15 years scores 2.5, over 15 years scores 0.
- **Value** is in "millions of Rand".

These are person-level forms, but they are the codes SANRAL uses for **any** experience. `projects.client_type`/`project_type` already store these exact values (Klipcorp's real projects are `Relevant SOE` / `DS`).

### 3. Municipal tender: contactable reference letters, pass/fail

Source: Dawid Kruiper Local Municipality TN051/2026 (security services), the real PDF already downloaded for `General-Tender-Engine-Findings.md` (pdftotext, lines 1097 and 2271):

> "Proof of previous services rendered must be submitted, which must include 3 Contactable references (Signed reference letters with clients' letterhead will only be accepted as proof of experience). If no proof is submitted, the tender will be deemed as non-responsive"

There is no scoring here, only presence: 3 signed letters on letterhead, from a **contactable** client, in the right line of work (security). This is a disqualifier, not a points item.

### 4. What was NOT found (not built)

- **CIDB grade history** as an experience criterion. CIDB appears as a grading requirement (`assess_tender.py`'s `CIDB_RE`), not as past-experience evidence. It is already tracked as a company gap ("No CIDB grading document found anywhere"), so it is out of scope here.
- **"Years of experience in a discipline" at company level.** In every sample this is per person (B1/B2, computed from qualification date), never per company. Not added.
- **Award letters as scoreable evidence.** No sample scores an award/appointment letter. SANRAL counts only *completed* projects. Award letters are captured (Sarel asked for them, and they prove a client relationship and a value) but are labelled as not proving completion.
- ESKOM, Treasury, SALB, RAF and QCTO samples: their downloaded files are SBD forms / NEC3 contract drafts only, and none contains an experience schedule. The evidence base for non-SANRAL buyers is therefore **one** municipal sample. See open questions.

## The taxonomy, and why each piece is there

Every tag maps to a specific requirement above, and each one reuses an existing vocabulary in this repo where one exists.

| Tag | Values | Grounded in | Reuses |
|---|---|---|---|
| Document type | reference_letter, performance_report, completion_certificate, closeout_report, award_letter, project_record (no document yet), other | B6 accepted evidence (reference letter, CIDB Annex 1) plus Sarel's list (award letter, close-out report, completion certificate) | — |
| Discipline (multi) | roads_civil, water, buildings, electrical_mechanical, it_telecoms, professional_services, security_facilities | "similar scope" (B6), "same line of work" (municipal) | **Exactly** `assess_tender.py` `DISCIPLINE_KEYWORDS` keys and `klipcorp_profile.json` `company.disciplines` |
| Client type | National Roads Authority, Concessionaire, Provincial Authority, Relevant SOE, Metro Council, Municipality, Private, Other | B1/B2 client codes (scored) | Same values as `projects.client_type` |
| Project type | SANRAL code suggestions, free text otherwise | B1/B2 project-type relevance | Same values as `projects.project_type` |
| Scope in a line | free text | B6: "similar scope e.g. crack sealing, pothole repair…" | — |
| Services delivered (multi) | CIDB Annex 1 project stages | Annex 1 "project stage for which assessment is made" | — |
| Value | R millions | Reference-letter "to the value of R…", B1 "(in millions of Rand)" | Same unit as `projects.value_rm` |
| Start / completion date | dates | B6 "completed … in the last 10 years"; period relevance 10/15 years | — |
| Rating | poor / adequate / good / excellent | B6 scoring 1/3/4/5 | — |
| Contactable reference | name, phone, email | Reference-letter template; municipal "contactable references" | — |

"Industry/sector" in Sarel's wording is covered by **client type** (who the client was: SOE, municipality and so on, which is what tenders score) together with **discipline** (what kind of work it was, which is what tenders filter on). I deliberately did not add a third, separate "industry" list. It would not map to anything any sample asks for or to anything the discovery engine produces.

Why discipline is multi-valued: on the real R.396-010 title ("CONSULTING ENGINEERING SERVICES FOR THE ROUTINE AD-HOC MAINTENANCE OF R396 …"), `assess_tender.categorize()` returns only `['professional_services']`, because the title contains no road keyword. A Klipcorp roads job tagged with only `roads_civil` would miss it. Tagging it `roads_civil` + `professional_services` (as Klipcorp's own profile does) matches. Matching uses array overlap.

## What was built

- **Migration `0012_experience_items.sql`**: an `experience_items` table, tenant-scoped through `is_company_member(company_id)`, with an `updated_at` trigger. A new private bucket `experience-documents` has the same path-prefix storage RLS as `cv-documents` in `0008`. Capture and tagging are separate steps: `tagged_at` stays null until a human saves tags, and untagged rows never count in matching.
- **`experience_matches(p_company_id, p_disciplines, p_project_types, p_client_types, p_min_value_rm, p_completed_within_years, p_as_of)`**: the queryable mapping to tenders. Every filter is optional, only tagged rows are returned, and it is SECURITY INVOKER, so RLS applies to signed-in users. A SANRAL B6 check is `p_disciplines => <categorize() output>, p_completed_within_years => 10, p_as_of => <closing date>`, and the count of rows is the answer. A TypeScript wrapper `findMatchingExperience()` and the taxonomy constants are in `app/lib/experience.ts`.
- **`/experience`** (new nav tab "Experience", between People and Admin): a capture form (project name, document type, file; the upload pattern is copied from `people/actions.ts uploadCv`), a "past-performance evidence: N of 3" line against the B6 rule, a discipline filter that runs `experience_matches()` itself, and a list with "Needs tagging" / "No document" / rating chips.
- **`/experience/[id]`**: the tag editor. It can be edited any time, attach or replace a document later, or delete the item. Saving requires at least one discipline.

## Not built, on purpose

- **AI extraction of tags from the uploaded letter.** As with CVs, reading a reference letter and proposing client, value, date and rating is a natural next step. It is not built here, and tagging is manual, which matches Sarel's "allow for manually updating the attributes".
- **Generating SANRAL B6 / Annex 1 / the reference-letter request.** This is a separate piece of work for the SANRAL filler.
- **A tender-side compliance UI.** That belongs to the readiness report on `tenders/[id]`; this pass only provides the query.

## Open questions for Sarel

1. **Company vs personal experience.** Henning's three ACSA OR Tambo projects (R150m, R78m, R50m, 2018 to 2026) are on file as *his* key-person history. Were they Klipcorp's contracts, which would make them company experience for B6? If so, do reference letters or completion certificates exist for them? The completed NRA 2026/0084 submission declared 0 company projects.
2. **Joint ventures.** B6 accepts evidence "in one of the companies or JV partner names". Should an item record that it was earned as a JV partner, or under another entity's name?
3. **Non-SANRAL buyers.** Only one non-SANRAL sample (a municipality) had an experience requirement. If ACSA or SASSA tenders ask for experience differently (for example a minimum project value, or a minimum number of years in a sector), a real sample of each should be checked before adding a tag for it.
4. **4 MB upload limit.** Server Actions were raised from Next's 1 MB default to 4 MB (Vercel caps requests at 4.5 MB). This also applies to CV uploads. Multi-page scanned close-out reports may be larger. If they are, the fix is a direct browser-to-Storage upload, which is not built.
