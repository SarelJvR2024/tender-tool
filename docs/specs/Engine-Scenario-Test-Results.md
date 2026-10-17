# Engine Scenario Test Results

Oct 17, 2026 · manual tender load (Part A) + multi-scenario pass over the discovery, intake and completion engines (Part B)

## How to read this

Each scenario says what was run, what happened, and whether the result was **honest**. A clear refusal counts as a PASS when refusing was the right outcome. A confident-looking result that is wrong counts as a FAIL, even if nothing crashed. Where a scenario failed, the fix is named and the scenario was re-run after the fix. Anything that needs Sarel's decision is under [Open decisions](#open-decisions-for-sarel).

Environment: scratch Postgres 16 with every migration replayed (`0001`→`0024`) and the same `auth`/`storage` stub earlier passes used, plus local Storage. No live Supabase exists (System-Status gap #9). "Live" below means the real eTenders OCDS feed, pulled today (`etenders_national.py --days 7`: 100 open releases).

Reproduce:

- `engine/intake/test_manual_intake.py`: Part A end to end. 44 checks, all pass.
- `engine/intake/scenario_driver.py`: any live OCDS release or local folder through the whole chain.
- `engine/compliance/test_watch_deadlines_urgency.py`: scenario 7's reminder checks. In CI.
- `engine/admin_harness.py --pack`, `engine/general/general_harness.py --no-pack` and `engine/general/test_general_bridge.py`: regression runs.

## Summary

| # | Scenario | Result | Fixed in this pass |
| --- | --- | --- | --- |
| 1 | SANRAL tender, complete company | **PASS.** 71-page pack, read-back clean | LibreOffice run killed by an unrelated `pkill`; raw UNO errors shown to users |
| 2 | SANRAL tender, company missing documents / CVs | **PASS.** Gaps are refused or listed, never hidden | n/a |
| 3 | Non-SANRAL, standard SBD/MBD forms (ESKOM, municipal) | **FAIL → fixed** | Ratlou LM's MBD 7.2 contract form was read as MBD 9 and put in the pack as "MBD 9" |
| 4 | Non-SANRAL, no standard forms | **FAIL → fixed** | An advert-only tender was declared "uses no SBD/MBD forms" and got a 2-page "pack" |
| 5 | Manually loaded tender, no OCDS listing | **PASS** after fixes | NRA reference missing (covers and authority letter dropped); wrong default closing time; fit judged from the title only |
| 6 | Malformed / unreadable documents | **FAIL → fixed** | Corrupt PDFs were called "scanned"; zero readable text still produced a "ready" manifest claiming "no standard forms" |
| 7 | Closing soon + expiring documents | **FAIL → fixed** | Off-by-one at closing; "0 days left" after closing; reminders never escalated and ignored closing dates |
| 8 | Test companies that fail at the form filler | **PASS (loud)**, but the reason wasn't actionable → fixed | Message now names the person, project, field and where to fix it |

Also found and fixed along the way:

- The worker image never contained `fingerprints/`, so the template-changed check was skipped in production.
- `seed_supabase_opportunities.py`'s upsert could never have worked against real PostgREST.

## Part A: manual tender load (status)

**Built.** `/tenders/new` is linked from the Tenders page ("Load a tender manually") and from Discovery ("Found one elsewhere? Load it manually"). It takes:

- title and buyer (required);
- reference, OCDS id and closing date/time (optional);
- the tender's own documents: PDF, Word, `.xlsm`/`.xlsx`, `.zip` or `.txt`, up to 50 MB each.

How it works:

1. **Upload.** Files go from the browser straight into Storage under `tender-documents/manual/<company>/<tender>/`. This avoids Vercel's 4.5 MB server-action limit (a SANRAL set is two ~2 MB workbooks plus Book 1 and Book 2).
2. **Register.** `load_manual_tender()` (migration `0024`) re-checks every path, then creates:
   - a **private** `tenders` row (`owner_company_id`; other tenants can't see it, its templates, its requirements or its files);
   - this company's `tender_pack`;
   - one `extract_requirements` job.
3. **Intake.** The job is the intake step, which now runs for discovered and manual tenders alike, in `process_general_jobs.run_extraction` + `engine/intake/classify_tender.py`:
   - **Routing.** It uses the signal the SANRAL engines already trust: `fingerprint.detect_family()` on an uploaded workbook's sheet set. SBD/MBD form detection is deliberately *not* the signal, because SANRAL's own C.1.1.1 is "Form of Offer (Incorporating SBD7)".
     - SANRAL route: the 5 blank templates → `tender_documents` (what `process_pack_jobs.py` reads); SETUP positions → `tender_requirements` (what the compliance report reads, including SETUP's own Man/Non-Man flag); the fingerprint check is reported, never stored as a baseline; NRA reference, contract number and closing date come from the documents, and any mismatch with what was typed is reported.
     - General route: `requirements.py`'s manifest, unchanged.
   - **Fit and score outlook.** `assess_tender` + `score_outlook` run on the documents' own text and land in `discovered_opportunities` (`source = 'manual'`, `tender_id`), the same row Discovery shows.
4. **Workspace.** A "How this tender was read" card shows:
   - the route and why, the templates found and the fingerprint result;
   - notes and unreadable files, and the fit;
   - an "Add documents and re-analyse" form, which re-runs the intake. Tested: a forms-only SANRAL tender switches to the SANRAL route when the workbook is added.

**What runs where.**

- Synchronous (server action + RPC): registration, path checks, privacy.
- Bridge (Python + LibreOffice): document reading, routing, SETUP, fingerprint, fit.

**Verified.** `test_manual_intake.py`, 44 checks, against the replayed schema and the real bridge code:

- SANRAL route (+ a 62-page SANRAL pack built by `process_pack_jobs.py` from the manually registered templates);
- general route;
- forms-only SANRAL hint;
- unreadable failure;
- RLS: other tenant can't see the tender, its templates, its requirements or its files; can't upload into another prefix; can't write the shared bucket area;
- RPC guards: path outside the prefix, another company, no documents, duplicate OCDS id;
- add-documents re-route.

`tsc` and `eslint` are clean.

**Not verified:**

- Against a live Supabase (gap #9).
- In a browser. The upload form is typechecked, not rendered.
- `next build` couldn't run from the isolated worktree, because Turbopack refuses a symlinked `node_modules`.
- It needs the bridge worker deployed. Until then the card says the tender is "Queued" and that the worker isn't running.

**Limits, stated:**

- A SANRAL tender loaded this way still stops at "No confirmed key person". There is still no UI that confirms `tender_pack_assignments` (System-Status gap #12).
- Documents can't be added to a *discovered* (shared) tender, because they'd be visible to every tenant. Load a private copy instead: leave the OCDS id blank. The duplicate-id refusal now says so. **Superseded 2026-10-17:** migration `0032` adds "Your private documents" on a shared tender (visible only to the company that added them); the duplicate-id refusal now points there. See System-Status.md.

## Scenario details

### 1. SANRAL tender, complete company: PASS

**Ran:** `harness_pack.run_pack_one(complete_co, R.396-010-2025.1F)`, the real chain: fingerprint → `fill_conventional` → `print_reports` → financial → forms → letter → covers → `generate_cv` → merge.

**Result:**

- 71 pages, `verify_pack` problems: `[]`.
- Contents (rendered and looked at): 22 entries in two envelopes, each with its page range. "NOT INCLUDED" holds only the Financial workbook, with its reason.
- Page 48 text read back: Form B1 for PL, "Pat Test-Specialist", ID, project rows.

The same chain through the bridge on a **manually loaded** R.396 (`test_manual_intake.py [sanral_pack]`): 62 pages, read-back clean, envelope covers present because the NRA reference was read from the documents.

**Found:**

- **Flaky failures.** The first two runs failed with `RuntimeException: illegal object given!` / `cannot get value Control`. `print_reports.export()` run alone on the same filled workbook worked twice. Cause: `print_reports.Office.__exit__` ran `pkill -9 -x soffice.bin`, which kills *every* LibreOffice on the host, including another run's mid-conversion. **Fixed:** soffice now starts in its own process group and only that group is killed.
- **Raw UNO errors.** Such a failure used to reach the Tender Workspace as a raw UNO exception. **Fixed:** `assemble_pack` now reports "LibreOffice failed while printing Forms B1-B7 ... a worker problem, not your data; request the pack again". It stays a `RuntimeError`, so the harness still counts it as a run failure, not a data refusal.

### 2. SANRAL tender, company missing documents / CVs: PASS

**Ran:**

1. The bridge on the manually loaded R.396 with only PL confirmed.
2. Then with DS1 confirmed, no B-BBEE proof, no bank letter, no ISO and no CVs.
3. `expired_certs_co` (with its `MO/MA` project type corrected, so it gets past the filler; see scenario 8), whose vault holds four expired documents.

**Result:**

- **Run 1:** job `failed`: "No confirmed key person for position(s) DS1 required on this tender's SETUP sheet". That position came from the *uploaded* SETUP sheet.
- **Run 2:** job `ready`, 62 pages. Six items are listed as not included, each with a reason: B-BBEE, bank letter, CV PL, CV DS1, ISO, and the Financial workbook. They appear both on the contents page and in the card's list. The card also requires a "generate a draft anyway" tick when the compliance check shows gaps.
- **Run 3:** 70 pages. The expired TCS PIN, B-BBEE, bank letter and COID are *included*, each with "the copy on file expires …, before closing … - replace it before submitting". Those warnings are on the contents page (which runs onto page 3) and in the card.

Nothing claims completeness. Whether an expired document should be omitted rather than included-with-warning is an [open decision](#open-decisions-for-sarel).

### 3. Non-SANRAL with standard SBD/MBD forms: FAIL → fixed

**Ran (live OCDS, as discovered tenders):** `pursue_discovered_opportunity()`, then the bridge (intake), then a general pack.

- **ESKOM E3683GXMPHEN** (15 documents):
  - Route general. SBD 1/4/6.1 found inside ESKOM's ITT PDF, so they are marked by hand.
  - ESKOM's own forms listed (Form A, CQP template, Declaration of Shareholding, NEC3, Form of Offer).
  - Two scanned annexures flagged.
  - Two downloads reset by ESKOM's server are listed as gaps.
  - Pack: 78 pages.
- **Ratlou LM NWNW381** (6 separate MBD PDFs): MBD suite, everything by hand (flat PDFs), municipal-rates-account returnable found. Pack: 20 pages.
- **Treasury RT83** (manual load): SBD 1/4/6.1 `auto` (editable `.docx`).

**Found (FAIL):** Ratlou publishes `MBD 7.2.pdf` (the contract form) next to `MBD 9.pdf`.

- The MBD 9 detector needed only the phrase "independent bid determination". MBD 7.2 lists that certificate among its annexures, so `MBD 7.2.pdf` became the *first* MBD 9 edition.
- As a result, the pack's "MBD 9 - blank, complete by hand" section was the contract form, and MBD 7 showed no edition at all.

**Fixed:**

- The SBD/MBD 9 marker now also needs the Competition Act / bid-rigging wording every real SBD/MBD 9 carries.
- A single-form file whose name *and* heading name the same form is an edition of that form.

Re-run: MBD 7.2.pdf → 7, MBD 9.pdf → 9. `general_harness.py` 27/27 still match their baselines and `test_general_bridge.py` 22/22 still pass.

**Noted:** the first general-pack attempt for two of these failed with "could not render the contents page to PDF (soffice failed)". It succeeded on retry. That failure was loud, not silent; see [Still open](#still-open-flagged-not-fixed).

### 4. Non-SANRAL with no standard forms: FAIL → fixed

**Ran (live):**

- **ESKOM E3682GXPOU** (a Request for Information): no forms. The gap says the buyer uses its own forms. The 4-page pack (guide + vault documents + missing items listed) is correct.
- **ESKOM E3695DXGOU:** SBD inside the ITT; its `.xlsx` price schedule is listed as "could not convert (unsupported file type '.xlsx') - print the original". Honest.
- **Stellenbosch BSM 25/27** (construction of the Polkadraai water scheme).

**Found (FAIL):** Stellenbosch published only `Tender BSM 25 27 … Adverts only.pdf` (6,263 characters of text).

- The manifest said "This tender uses no SBD/MBD standard forms", the workspace said "This buyer uses no SBD/MBD standard forms - only its own", and a 2-page pack was marked ready.
- That is a confident claim made from an advert.

**Fixed:** the manifest now records `document_depth` (`assess_tender.document_depth`, the same test Discovery uses). When only an advert or partial document was read, both the gap and the workspace say whether forms are used is **unknown**, and tell the user to get the full bid document and load it. The same caution is shown when some documents couldn't be read.

### 5. Manually loaded tender, no OCDS listing: PASS (after fixes)

**Ran:** the real SANRAL portal download for R.396-010-2025/1F, all 15 files (Book 1/2, appendices including two `.doc`, an OHS `.xlsm`, a structures `.xlsx`, both workbooks, three returnable `.docx`). This is real tender data, run locally only and not committed. Loaded through `load_manual_tender()` with no OCDS id.

**Result:**

- Route: SANRAL Conventional, by the Technical workbook's sheet set. The OHS `.xlsm` and Structures `.xlsx` were correctly not taken as templates.
- All 5 templates registered; SETUP gives PL and DS1 (Non-Man, with alternates); fingerprint OK.
- NRA 2026/0071 read from the documents.
- Fit (after the fix below, with the real Klipcorp profile): `strong_fit`, roads_civil + professional_services.

**Found and fixed:**

- **No NRA reference.** The intake never set `nra_reference`, so the pack left out both envelope covers and the A2 authority letter ("tender record has no NRA reference - never invented"). **Fixed:** it is now read from Book 1 or the A-Forms headers. If it isn't found, the intake says what to upload.
- **Wrong closing time.** The closing time defaulted to 11:00. SANRAL closes at 12:00 (R.396 Book 1: "The closing time and date for receipt of tenders is 12:00"). **Fixed** in the form, the server action and the SETUP fallback.
- **Fit from the title only.** Fit was judged from the typed title alone ("Routine ad-hoc maintenance of R396 Section 1" matches no discipline keyword), giving `needs_review`. **Fixed:** when the title matches nothing, the documents' opening pages are used, and the fit reasons say so.

### 6. Malformed / unreadable documents: FAIL → fixed

**Ran:** a truncated PDF (first 40 KB of TN051), an HTML error page saved as `.pdf`, an image-only PDF, a truncated SANRAL `.xlsm`, a "docx" that isn't one, and mixtures of these with a good file.

**Found (FAIL), before the fix:**

- **Wrong reason.** Every broken PDF was reported "no text layer (scanned image)". The user would ask for OCR when the real fix is to re-download.
- **Wrong result.** With nothing readable at all, the job still went `ready`, with a manifest stating "This tender uses no SBD/MBD standard forms" and no questions. That is a wrong result presented as a real one.

**Fixed:**

- `pdftotext` failures now read "not a readable PDF - corrupt, truncated or not really a PDF (Syntax Error: Couldn't find trailer dictionary) - re-download it".
- With zero readable documents (and no recognised SANRAL workbook), the intake job **fails**, naming each file and its reason. No manifest or family is written (checked).
- With some unreadable documents, the job is ready, but they are listed and the "no forms" claim is qualified.
- A corrupt `.xlsm` is called out by name ("couldn't be opened as a workbook ... re-download it") instead of "no SANRAL workbook was among them".

**Still a gap:** scanned tenders are not OCR'd.

### 7. Closing soon + expiring / expired documents: FAIL → fixed

**Ran:**

- The compliance logic (`tenderCompliance.ts`, `generalTender.ts` via `jiti`) for a tender closing in 3 days at 12:00, with documents expiring the day before closing, on closing day, 20 days after, last week, and next year.
- `watch_deadlines.py` against in-memory rows over two simulated dates.

**Found:**

1. **Off by one at closing.** A document valid until the closing *day* was "Don't have - expires before this tender closes". `daysUntil` doesn't truncate the 12:00 closing timestamp, so closing counted one day later than a date-only expiry on the same day. **Fixed:** `closingDayOf()` compares calendar days in SAST. Re-run: closing-day TCS PIN → On file, renew soon; day-before COID → still Don't have (correct).
2. **Countdown after closing.** The Tender Workspace's countdown rendered "0 days left" on closing day after the tender had closed (`Math.ceil` gives `-0`), and "1 days left" for a tender closing at 12:00 today. **Fixed:** the countdown is time-aware ("closes in 3 hours", "closed").
3. **No escalation, and closing dates ignored.** `watch_deadlines.py` reported a document once at 60 days and **never again when it actually expired**; the same applied to overdue tasks. It also never saw a document that lapses before a pursued tender's closing date but sits outside the 60-day window (e.g. PIN at 90 days, tender closing at 100). **Fixed:**
   - the status is now part of the seen key (renew soon, then expired; due, then overdue);
   - a new `find_documents_lapsing_before_closing()` reports per tender.
   - Test: all 8 checks pass, including "no repeat on a second run the same day".

### 8. Test companies known to fail at the form filler: PASS (loud), reason made actionable

**Ran:** `admin_harness.py --pack`.

**Before:**

- `expired_certs_co`: "'MO/MA' is not an option for TEND 1X!F147. Options: [...]"
- `new_co`: "'None' is not an option for TEND 1X!D76".

Both were loud refusals (pack not built, job `failed` in the bridge), but they named a spreadsheet cell, not the thing to fix.

**After** (`sanral_fill.set_dropdown_for`, used for every dropdown in `fill_person` of both fillers):

- "Jordan Test-Generalist, project 'Test Municipality / TEST/2019/010': project type 'MO/MA' is not one of the options this SANRAL template accepts (['NONE', 'MP/MS', 'MSC', 'DS', 'DI/DN']) - correct it on the People page (template cell TEND 1X!F147)."
- "Nomi Test-Founder: ECSA registration level is not recorded - fill it in on the People page before generating the pack (SANRAL's form needs it; template cell TEND 1X!D76)."

The form-fill harness still has 18/18 clean against baselines (no filled value changed). The two `--pack` baselines record the old wording, so they need `admin_harness.py --pack --reset` once.

## Other defects found and fixed

- **Worker image skipped the fingerprint check.** It had no `fingerprints/`. Confirmed inside the existing `tender-worker:pack` image: `fingerprints` is missing, so `assemble_pack` only warned "No stored fingerprint baseline" and Sarel's "always check the template first" rule was silently off in production. **Fixed:** the Dockerfile now has `COPY fingerprints fingerprints`. Verified in a rebuilt image: the intake reports "Matches the stored 'Conventional Consultant Tender' template".
- **Discovery seeding upsert couldn't work.** `seed_supabase_opportunities.py` upserts on `company_id,ocid`, but `0004` made that a *partial* unique index, which PostgREST `on_conflict` can't target (reproduced: "there is no unique or exclusion constraint matching the ON CONFLICT specification"). **Fixed** in `0024` with a plain unique constraint. Nulls stay distinct, so `0004`'s reason for the partial index didn't hold.

## Still open (flagged, not fixed)

- **LibreOffice default-profile contention.** `generate_cv._convert_to_pdf` and `pdf_merge`'s contents page call `soffice --convert-to` with the default user profile. A concurrent LibreOffice makes them fail ("could not render the contents page to PDF (soffice failed)"; seen twice here, fine on retry). The failure is loud and the worker runs bridges one at a time, but a per-call `-env:UserInstallation` would remove the risk.
- **Discovered tenders keep Discovery's fit verdict.** That verdict was based on the first readable document. The intake does not re-score it from every document; only manual tenders get the full-document fit.
- **No CI coverage for the manual-load test.** `test_manual_intake.py` needs Postgres, so it isn't in CI. The reminder test is.

## Open decisions for Sarel

1. **Expired vault documents in a SANRAL pack:** include them with a warning (today), or move them to "Not included"?
2. **A project whose type exists only in the other SANRAL family** (`MO/MA` is an RRM code; the Conventional form offers `NONE / MP/MS / MSC / DS / DI/DN`): refuse the whole pack (today, now with a clear message), or leave that project off this tender's Form B1 and say so? **Answered and built (2026-10-17, `Hardcoded-Assumptions-Audit.md` §1):** leave it off and say so. The diagnosis above was wrong: `MO/MA` is a Conventional code (the PL block offers it); the DS Pavement block doesn't, because project-type options are per position (each position's Book 1 matrix). `expired_certs_co` now builds, with the project on PL and left off DS1, noted on the contents page.
3. **Alternate (ALT) positions on SETUP:** R.396's complete_co pack fills Positions 11/12 (the ALT slots for PL/DS1) with the same person as 1/2. Is that what SANRAL expects, or must an alternate be a different person?
4. **Manual tenders are private to the company that loads them.** Confirm. The alternative is sharing them like discovered tenders, which would let one tenant's forwarded RFQ appear for others.
5. **Advert-only discovered tenders** (scenario 4): keep "load your own copy" as the way to add the full document, or allow private documents to be attached to a shared discovered tender (needs a per-company document list)?
6. **OCR for scanned tenders:** still not built (two ESKOM annexures and the Tourism NB143 tender are scanned).
