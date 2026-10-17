# System Status

Maintained by the standing solution-architect review pass. This file reflects **current real
state**, verified by reading code and running checks — not a history (see `git log` for that)
and not a restatement of the phased feature list in
`Tender-Tool-Competitor-Feature-Deep-Dive.md` (read that for *what should exist and why*; read
this for *what actually exists right now, and what's inconsistent between agents' work*).

Last full pass: 2026-10-17, 06:10 UTC check-in.

**Convention (added this pass, after the file drifted from its own purpose):** the tables and
lists directly below ("Repo shape" through "Open items") are the **current state** — read only
these to understand reality right now. Everything under "Detailed pass history" further down is
a dated, append-only evidence log (what was built, how it was verified, commit-by-commit) kept
for audit trail, not for re-deriving current state — don't read the whole history to answer "is
X built", check the tables first. Several concurrent agents had been appending their own
narrative "Check-in: ..." sections directly after the header, which is exactly the
append-only-log drift this file's own original purpose warns against — restructured this pass
to separate the two, nothing deleted, all moved into the history section below.

## Repo shape, in one paragraph

Two independent codebases share this repo: `engine/` (Python, no shared runtime with the web
app — invoked by hand, cron, or the always-on bridge worker (`engine/worker/`), writes to Supabase via the
service-role key, never imported by Next.js) and `app/` (Next.js 16 web app, reads/writes
Supabase directly under RLS). They meet only at the Supabase schema
(`app/supabase/migrations/`, now `0001`–`0018`) and at `config/klipcorp_profile.json`
(gitignored real data; `config/test_companies/*.json` are the committed synthetic stand-ins).
Three buyer-filling/generation engines exist side by side under `engine/`: SANRAL (mature,
root-level scripts), `engine/general/` (non-SANRAL: requirement extraction, SBD/MBD form fill, pack build), and `engine/cv/`
(CV document generator). The CV engine now has two real integration points in `app/`
(upload-mode choice, tender-specific generation request) bridged asynchronously by
`engine/cv/process_cv_jobs.py`. The SANRAL engines now also have one: the whole submission pack
(`engine/pack/`, migration `0017`), bridged by `engine/pack/process_pack_jobs.py` the same way. The general engine now has one too (migration
`0018`): Discovery's "Prepare this tender" → a general Tender Workspace → `tender_engine_jobs`,
bridged by `engine/general/process_general_jobs.py`.

## Built and verified — working today

| Area | What it does | How verified |
| --- | --- | --- |
| SANRAL workbook fill (`engine/fill_tender.py`, `fill_conventional.py`, `fill_a_forms.py`, `fill_financial*.py`) | Fills both template families (Conventional 9-sheet, RRM 15-sheet), A-Forms bundle, financial/hours sheets | `engine/admin_harness.py` regression-tests this against 3 test companies on every run; real tender runs recorded in git history (e.g. `afad9d2`, `6658b73`) |
| Template fingerprinting (`engine/fingerprint.py`) | Detects a changed SANRAL template before filling | Documented false-positive case already found and understood (README's own "open question") |
| Field-level provenance (`engine/provenance.py`, migration `0002`) | Every written field tagged confirmed/computed/assumed_default/missing | `app/app/tenders/[id]/page.tsx` reads `field_provenance` directly and renders the 3-bucket readiness report (item 32) — genuinely wired end-to-end, not just a CLI/DB concept |
| National tender discovery (`engine/discovery/etenders_national.py`, `assess_tender.py`) | Pulls OCDS feed, scores fit against company profile | `app/app/discovery/page.tsx` reads `discovered_opportunities` and renders the same verdict buckets `assess_tender.py` produces — genuinely wired, not a disconnected feed |
| Discovery-time score outlook (`engine/discovery/score_outlook.py`, migration `0013`) | Reads a tender's own document for preference system (80/20 vs 90/10), specific-goals basis, functionality threshold; points only where the profile genuinely answers, price never estimated | Run on 11 real texts + a 25-release live OCDS run; 2 false positives found and fixed. `/discovery` shows the result under each card. Cleanly layered with `sanralScoring.ts` below (its own docstring explicitly defers the detailed functionality estimate there) — checked, not duplicated |
| General (non-SANRAL) SBD form fill (`engine/general/fill_sbd_docx.py`) | Fills SBD1/4/6.1 **`.docx` edition only**, label-matched, refuses PDF/`.doc` | Verified against real downloaded Treasury/RAF samples (see `General-Tender-Engine-Findings.md`); drop-in with `generate_action_checklist.py` |
| CV generation (`engine/cv/generate_cv.py`) + web wiring (`cv_uploads`/`generated_cvs`, migration `0008`) | Builds a real Word+PDF CV in `sanral_keyperson`/`world_bank` formats, summary/detailed, standard/tender-customized (reuses `suggest_pack.py`'s `score_candidate()`, no new matcher). Two real integration points: upload-mode choice (as-is vs. AI-extract) on the People page, "Generate tender-specific CV" action on the Tender Workspace | Generator itself verified against real data (3 real combinations, python-docx + pdfplumber read-back, correctly raised a specialism warning). Web wiring confirmed by grep: both `cv_uploads`/`generated_cvs` inserts are real, not stubs. Fulfilment is deliberately asynchronous — `engine/cv/process_cv_jobs.py` is the bridge, because Vercel can't run Python/LibreOffice. It now runs without a person through the bridge worker (row below), but only once that is deployed. AI extraction: see the next row |
| CV AI-extraction, review-then-confirm (`engine/cv/extract_cv_fields.py`, bridge `cv_extract` in `run_bridges.py`; migration `0023` `cv_extraction_results` + `cv_uploads.extraction_*`; People page review card `app/app/people/[id]/cv-review.tsx`, `applyCvExtraction`/`discardCvExtraction`) | An `ai_extract` upload's text is read (pdftotext / python-docx / LibreOffice for `.doc`, reusing `engine/general/requirements.py`). Scans, images, garbled text and whole tender packs are refused with a reason, with no API call. SA ID numbers are matched and removed locally before the text leaves the machine. One Claude structured-output call (`claude-opus-5-5`, `fallbacks: "default"`) proposes `people`/`projects` fields, each with a verbatim CV quote. Quotes, digits, SANRAL dropdown labels and date precision are re-checked, and anything that fails is left unticked. The People page shows on-file vs from-the-CV per field; only ticked fields are written. Re-upload replaces nothing unticked, likely-duplicate projects are unticked, and standard CV formats are queued at confirm (no longer at upload). `as_is` is untouched | `test_extract_cv_fields.py` (in CI, no secrets): real-format text step on synthetic .docx/.pdf/.doc, every refusal path, ID redaction, validation on hand-written test-double answers (validated against the exact output schema), request shape vs a stub client, queue state machine. Real files: Henning's SANRAL Form B1-B2 PDF read and its ID redacted; 3 real scans refused. `0001`→`0023` replayed with RLS tests. **Never run against the real Anthropic API (no key here) — extraction quality on real CVs is unmeasured** — and never against a live Supabase (Gap #9). Evidence, setup (API key) and cost (~$0.05-0.15/CV): `CV-Extraction-Findings.md` |
| Experience library (`/experience`, `/experience/[id]`, migration `0012`) | Capture + manually tag company past-performance evidence (letters of award, reference letters, completion certificates); `experience_matches()` SQL function for tender-side matching | Taxonomy checked by script against real data (`DISCIPLINE_KEYWORDS`, real client/project types all present). Functional SQL tests on a scratch DB confirm filter correctness and tenant isolation (own-company-only rows, rejected cross-company insert, rejected out-of-prefix storage write) |
| Tender evaluation compliance report (`app/lib/tenderCompliance.ts`, `app/lib/sanralScoring.ts`, `compliance-report.tsx`, mounted on the Tender Workspace) | Required-documents checklist (Don't have / Confirm by hand / On file), key-people/CV minimums, company-experience match (via the Experience Library), SANRAL functionality score estimate with range bars. The Tender Workspace page now carries a sticky jump-nav (id anchors + a link row under the facts card) since this section stack can run to 10 full-width cards (SANRAL pack and general-pack sections included); the pack link — the page's actual deliverable — is a distinct amber "primary" pill pinned first in the row, not just one more identically-styled link at the end | Run against real Klipcorp vault values and a real `field_provenance.json`, plus edge cases (expired COID shows red, under-10-years fails). Reuses `app/lib/dates.ts`'s `daysUntil` for expiry math rather than reimplementing it — checked, no duplication. Only the SANRAL "Conventional Consultant Tender" family is mapped; others get an explicit "not mapped yet" message. Jump-nav changes are additive/styling-only (id attributes, nav markup, a `variant` prop) — no report/scoring logic touched by either jump-nav pass |
| Tender role catalog + manual role tagging (migration `0016`, People page, `app/lib/tenderRoles.ts`, `app/lib/sanralMatrices.ts`) | 47 roles real tenders ask for: SANRAL's 23 Book 1 codes, with DS split into its 8 specialisms, plus 17 roles from other buyers (contractor key personnel, SACPCMP safety officer, SACAP/SACPLAN/SACPVP/ECSA professionals, trades, PSIRA, pest control). Each role carries its source citation. The company ticks which roles each person's CV fits (`person_role_eligibility`). The compliance report uses that tag for role fit; the C3.1.11 years/ECSA heuristic is now only a cross-check that turns the row amber on a contradiction. All 9 Book 1 project-type matrices are structured data (was 2 hardcoded) | Role-fit cases run on Henning's real record (tagged plus Pr Eng: on file; tagged plus Pr Techni: amber; untagged: amber, naming who is tagged). `0016` replayed with RLS tests: a cross-company tag is rejected by the with-check, an unknown role by the FK. `sanralScoring.ts` output identical to the pre-refactor code on R.396 (24.5 / 13.5 / 44-93). A new DS Structures case was hand-checked |
| Tender-specific experience-evidence rules (`score_outlook.py` `extract_experience_evidence()`, `tenders.evaluation_rules`, `engine/seed_tender_evaluation_rules.py`, `app/lib/experienceEvidence.ts`) | Reads what THIS tender accepts as proof of experience (count, window or "since" year, document types, paired appointment+completion, practical-completion exclusion, consequence, verbatim quote). Shown on `/discovery` and used for the compliance report's B6 / Company experience rows. With no stored rule, it falls back to SANRAL's B6 pattern under an amber "Assumed rule" banner | 12 differently worded real rules extracted correctly (SANRAL x6, DRT x2, Transnet, DPWI, uMlalazi, TNPA x2, LEDA, Overberg, Dawid Kruiper, Sentech). No regression in the existing outlook fields across 38 real texts. **No tender row has `evaluation_rules` stored yet** (no live Supabase); the seed script has only been dry-run on R.396 Book 1, and its JSON stored and read back on the scratch DB |
| Office locations + locality scoring (migration `0015` `company_offices`, Company page, `score_outlook.py` `extract_locality()`/`match_locality()`, `app/lib/locality.ts`) | Structured offices (province, district/metro, local municipality, office kind, proof type/date). Tender locality rows are read as province, district or municipality, as specific goals or functionality, plus mandatory-local-office clauses, and matched against the offices. Shown on `/discovery`, and on the compliance report when the tender's rules have locality rows | Every locality table in 6 real tenders read correctly (DPWI, Cape Winelands, Overberg, uMlalazi, LEDA, Dawid Kruiper). Klipcorp (Gauteng, derived from its registered address) correctly matches none. A test Stellenbosch office gets Cape Winelands' 5. `0015` RLS and the province check were tested on the scratch DB |
| Tender task/deadline timeline + assignee (`tender_tasks`, migrations `0009`/`0011`) | Auto-seeded closing milestone, free-text manual tasks (no fixed type dropdown, per spec), inline status control, assignee picker (FK to `people`, not `company_members` — that table has no display name and no UI surface at all) | Full round-trip tested on a scratch Postgres replay: insert → assign → join returns real name → delete the person → task survives with `assigned_to` reset to null (not cascade-deleted) |
| Tender pipeline board (item 10: `/pipeline`, `app/app/pipeline/`, `app/lib/pipeline.ts`, migration `0021` `tender_packs.pipeline_stage`) | Kanban of every tender this company tracks, one column per spec stage (found → bidding → submitted → won/lost, no others). Cards show contract no., title, buyer, closing date/days left (or submitted/won/lost date), Discovery verdict chip when the tender came from the scored feed; click → Tender Workspace. Per-card "Start bidding" / "Mark submitted" / "Won" / "Lost" buttons plus "← Back" one step for mis-clicks (no drag-and-drop: nothing in the app uses it). Found = this company's packs at `found` + open SANRAL feed tenders it hasn't touched (first move upserts the `tender_packs` row). History = the submitted/won/lost columns (newest first) + "Submitted to date / Won / Lost" counts; `submitted_at` is kept when a tender moves on to won/lost. One auto-transition: requesting a SANRAL or general pack moves `found` → `bidding` (never backwards, never further). "Pipeline" nav tab next to Tenders; `proxy.ts` guards `/pipeline` | `0001`→`0021` replayed on scratch Postgres 16; on it: first move inserts the pack row (status stays `suggested`), trigger stamps `stage_changed_at`/`submitted_at`, `submitted_at` survives submitted→won, a bad stage is rejected by the check, the auto-advance update leaves a `won` row alone, cross-company insert rejected by RLS, other company sees 0 rows. Page rendered via `next dev` against a fake Supabase HTTP stub with 9 tenders across all stages: right columns, closed-no-pack SANRAL row and another company's general tender correctly hidden, verdict chips joined by ocid/contract no.; the move server action POSTed for real (upsert sent with `on_conflict=company_id,tender_id`, card moved to Bidding; bogus stage → `?error=`). Not run against a live project (Gap #9) |
| Role-based daily digest (`engine/notify/daily_digest.py`, migration `0010`'s `tender_role`) | One filtered digest per person per a 5-role matrix (full_cycle/validator/cv_admin/finance/viewer), reusing `assess_tender.py`, `watch_new_tenders.py`'s constants, and `watch_deadlines.py`'s functions directly rather than reimplementing any of them | Run in `--mode local` against the real OCDS feed + real company profile: 5 correct per-role digests with correct section visibility confirmed by reading the output JSON back. `--mode live` is written but unverified — no live Supabase project exists |
| Document-expiry + tender-task reminders (`engine/compliance/watch_deadlines.py`) | Finds documents/tasks entering their reminder lead-time window, against a seen-store so a given (item, date) only reports once. Tracks the six vault expiry columns above (no longer COID-only); the bank letter uses a 30-day lead | Same family/boundary as `watch_new_tenders.py` (report-only, no send); lead times matched to `app/lib/dates.ts`'s existing 60-day threshold rather than inventing a second number for the same concept |
| Bridge worker: automatic fulfilment of queued CV/pack requests (`engine/worker/`: `poll_loop.py`, `run_bridges.py`, `Dockerfile`; `process_cv_jobs.py --loop`; CI `.github/workflows/bridge-worker-ci.yml`) | One always-on process runs every bridge (`process_cv_jobs.py` now; `engine/pack/process_pack_jobs.py` picked up automatically when it lands at that path with `--once`) every 30 s. A failed poll doesn't kill it, and SIGTERM stops it cleanly. Jobs are claimed atomically (`requested`→`generating` only if still `requested`), so overlapping workers don't double-build. One-shot stays the default. **Built and tested, NOT deployed**: the recommended host is Railway Hobby ($5/mo), and it needs Sarel's own account and the Supabase keys. Steps in `docs/specs/Automated-Fulfillment-Deployment.md` | `engine/worker/test_poll_loop.py` against an in-memory fake Supabase: a job inserted during the sleep is picked up on the next cycle, a failed poll is survived, a pre-claimed row is skipped, SIGTERM mid-sleep exits in under 1 s. The container was built and run locally: real `.docx`+`.pdf` produced inside it, 9 MiB idle. `--once`, `--self-test` and no-credentials output are identical to the pre-change code on the same 3-job queue. Never run against a live Supabase (Gap #9) |
| SANRAL submission pack: one ordered PDF (`engine/pack/`: `assemble_pack.py`, `pdf_merge.py`, `process_pack_jobs.py`; migration `0017` `pack_generation_jobs`; "Generate submission pack" card on the Tender Workspace, `submission-pack.tsx`) | Runs the real engines in order — `fingerprint.py` check, `fill_conventional.py`/`fill_tender.py`, `print_reports.py` (Forms B1-B2 per slot, B3, B4, B5, B7), `fill_financial.py` (+ hours only from a complete capture), `run_forms_pipeline.py` (C.1.1.1, C.1.2.3, A-Forms, `ACTIONS_TO_SIGN.md`), `fill_authority_letter.py`, `make_envelope_covers.py` — then merges them with the vault documents (0014) and each position's newest ready tender CV, else as-is CV upload, into one PDF. The PDF has an outer cover, a contents page with page ranges and a "Not included" table with reasons, "Page X of N" on every page, and bookmarks per envelope and section. The filled `.xlsm` workbooks, `ACTIONS_TO_SIGN.md` and the manifest are uploaded alongside it. The card gates on the compliance report's own gaps (shared loader `compliance-data.ts`). It hard-stops on an unconfirmed position, missing blank templates or a pack already queued, and needs an explicit "generate a draft anyway" tick for any other gap; the gaps shown are stored on the row | Real chain on **real Klipcorp data + the real downloaded R.396-010-2025/1F templates** (local run, not committed: PII): 78 pages, 1-page contents, every contents entry matches its real start page, stamps read back on pages 1/2/41/43/56/58/78, 23 bookmarks resolve to the right pages, Henning's ID on his B1 page. Bridge `process_job()` driven end-to-end against all 17 migrations replayed on scratch Postgres (`engine/pack/bridge_selftest.py`): job `requested`→`ready`, 65-page PDF, `verify_pack()` clean, unconfirmed-position job → `failed` with confirm gate's reason, stale `generating` → `failed`. `0017` RLS: cross-company insert rejected, bad status rejected, other company's storage prefix rejected. Built in the bridge-worker Docker image: a 69-page pack builds inside it. **Never run against a live Supabase (Gap #9)** |
| General (non-SANRAL) tender preparation (`engine/general/requirements.py`, `fill_sbd_docx.fill_sbd_document()`, `build_general_pack.py`, `process_general_jobs.py`, migration `0018`, `general-workspace.tsx`, Discovery "Prepare this tender") | Reads THIS tender's own documents (pdf/docx/doc/zip) into a requirement manifest: which SBD or municipal MBD forms (filled vs by hand), the buyer's own forms, supporting documents with verbatim quotes, roles, CIDB/briefing, scoring, evidence and locality rules, and only the questions its forms need. Workspace shows a checklist vs the vault, inline per-tender uploads, one answers form (company SBD 1 facts saved to the company), and requests a pack: completion guide + filled forms + by-hand editions + buyer forms + vault docs + uploads + accepted experience + tagged people's CVs, merged with `engine/pack/pdf_merge.py` | 25 real non-SANRAL tenders read, 9 committed as `templates/general_samples/`. Fill read-back on 9 real editions (incl. bundles and a converted `.doc`); `test_general_bridge.py` (22 checks, fake Supabase, real documents); `general_harness.py` 9 samples x 3 test companies, expectations + read-back + baselines; `0001`→`0018` replayed with RLS tests. Never run against a live project (Gap #9). Evidence: `General-Tender-Preparation-Findings.md` |
| Admin test-company harness (`engine/admin_harness.py`, item 30) | Runs test companies through the real SANRAL pipeline, flags shape changes vs. stored baseline | Self-verifying by design (3 real bugs caught per its own commit `d86c84e`) — but **SANRAL-only**, see Gaps. `--pack` (opt-in, needs LibreOffice, ~1 min per run) also runs the whole submission-pack chain per test company, including `generate_cv.py`. It reads the PDF back and baselines its shape (`state/admin_harness_pack_baselines/`). Today: `complete_co` builds (71 pages on this host, 69 in the worker image: different LibreOffice/fonts, so baselines are per-environment). `expired_certs_co` and `new_co` are refused by the real filler (`'MO/MA'` is not a Conventional project-type option; ECSA level null), which is recorded as their baseline outcome |
| Admin review console (`app/app/admin/page.tsx`, `HarnessRunRow.tsx`, `actions.ts`, migration `0022`, item 31) | One row per test company × tender × check (`kind`: `forms` = the form-fill check, `pack` = `--pack`). Each opens to the documents that run actually generated, rendered inline (browser PDF viewer in an `<iframe>` on a 1-hour signed URL, plus "Open in new tab"): the filled A-Forms / C.1.1.1 / C.1.2.3 as PDFs, or the merged submission-pack PDF. Also shows the provenance counts and a reviewed / not-reviewed chip with "Mark reviewed" (optional note) and "Undo review". A review survives re-runs with the same result and is cleared by a DB trigger when the result changes. `engine/write_admin_harness_results.py` (now `--pack`) uploads the documents to the private `admin-harness-artifacts` bucket, but only files written by that invocation | Real harness run (`admin_harness.main(pack=True)`) driven through the writer's own `build_rows()` into a scratch Postgres with every committed migration (`0001`→`0022`) replayed (psql upsert on the real `on_conflict` target, run twice: 21 rows, no duplicates). All 57 form PDFs + the 71-page `complete_co` pack resolve to stored objects that are real PDFs (page counts read back, pack byte-identical to the harness output, test company name present in C.1.1.1). `0022` RLS: an owner can set only the 3 review columns (status/artifacts → permission denied, `reviewed_by` = someone else → RLS), a member sees 0 rows/objects and updates 0. The trigger keeps the review on a same-result rerun and clears it on a status or flagged-details change. **Never rendered against a live Supabase** (Gap #9): the iframe embedding of a Supabase signed URL is unverified |
| Company vault (`app/app/company/page.tsx`, migration `0014`) | Company profile plus six tracked compliance documents: COID, SARS TCS PIN, PI insurance, ISO 9001, bank confirmation letter (generated 3-month validity), and B-BBEE proof (certificate or QSE/EME affidavit). Each has an expiry badge and an upload/replace to the private `company-documents` bucket. A chip row at the top now summarizes all six at a glance ("N expired" / "N renewing soon" / "N not on file" / a single "documents current") | Read-only + edit form both real; expiry coloring shared via `app/lib/dates.ts`. `0014` was replayed with functional SQL checks (generated column, check constraint, tenant-scoped update and storage prefix). The upload has never been run against a live project. The summary chip is computed from the same `expiryStatus()` calls the six document rows use — checked, can't drift out of sync |
| Onboarding (`app/app/onboarding/`) | One field (legal name) → company + owner row, atomically via `create_company_and_join` | Matches spec's "minimum to get started" principle exactly |
| Route guard (`app/proxy.ts`) | Redirects signed-out users to `/login`, no-company users to `/onboarding` | Covers every real app route, including `/experience` (added this round) |
| RLS policy set (`0001`–`0022`) | Tenant isolation via `is_company_member()`, shared/public tables explicitly marked as such | Internally consistent — every deviation carries its own comment explaining why. No RLS inconsistency found across any pass to date; re-replayed all 19 migrations against a fresh scratch Postgres this pass, all still apply cleanly |

## In progress / partially built

- **CV AI-extraction** — built end to end (Built table), but it waits on two things Sarel has to provide: an `ANTHROPIC_API_KEY` on the bridge worker (until then AI-extract uploads stay queued and the `cv_extract` pass logs why), and a first measured run on 3-5 real team CVs. Only the text step has met real CVs so far. Scanned CVs are refused, not OCR'd (open question in `CV-Extraction-Findings.md` §8).
- **Automatic CV/pack fulfilment** — the worker is built and tested (Built table), but nothing runs it until Sarel deploys it (Railway steps in `Automated-Fulfillment-Deployment.md`). Until then, queued requests wait in `requested`, or someone runs `python3 engine/worker/run_bridges.py --loop` by hand. The pack bridge (`engine/pack/process_pack_jobs.py`) has landed at the path `run_bridges.py` expects, with the same `--once`/`--loop` contract. `run_bridges.py --once --bridge pack` drives it, and the worker Dockerfile now installs Calc + `python3-uno` for it.
- **Role-based digest's `--mode live`** — written, reads the real schema shape, but never run against a live Supabase project (none exists in this environment).

## Known gaps (named, not just "incomplete")

1. **General (non-SANRAL) path: closed as a path, not as full automation.** The general engine now reaches the web app (see Built table). What is still manual, named in `General-Tender-Preparation-Findings.md` "Gaps": flat-PDF SBD/MBD editions (every municipal bundle, SALB, QCTO) are completed by hand from the generated completion guide; buyer-specific forms (ESKOM Form A / declarations / NEC3, municipal Form of Quotation, Sentech consent...) have no templates; MBD 4's extra questions and the SBD 6.1 specific-goals table are by hand; tenders not on eTenders (or with broken links) can't be pursued yet - no "upload the tender documents yourself" path; no OCR of scanned tenders. Convergence item: `tender_engine_jobs` (0018) mirrors `pack_generation_jobs` (0017) columns; folding them needs an `engine` column on 0017 and `process_pack_jobs.py` filtering on it.
2. **`admin_harness.py` still only exercises the SANRAL path.** Narrowed: `--pack` now covers the SANRAL submission pack end to end, and the tender-customised CV generation inside it. The general engine now has its own parallel harness (`engine/general/general_harness.py`, 9 real samples x 3 test companies, also in CI as `--no-pack` + `test_general_bridge.py`); the CV generator itself still has none, and two of the three SANRAL fixtures stop at the filler (see Built table). A buyer wording variance or a `people`/`projects` schema change could silently break either and nothing would catch it the way SANRAL template changes are caught.
3. **CV AI-extraction: built, unmeasured.** No API key exists in this environment, so Claude's accuracy on real CVs (including the SANRAL Form B1/B2 grid that is the only real team "CV" in evidence) has never been measured, and the live API has never accepted the exact structured-output schema. Scanned CVs are refused rather than read. Other professional bodies (SAICE, SACAP...) are read but have no column to be saved in. Details: `CV-Extraction-Findings.md` §6/§8.
4. **Test-company coverage is 3 profiles, not 4.** The spec's own item-30 description names a 4th scenario — "no confirmed specialist for a position" — with no matching fixture. Low priority, spec itself calls this an open question.
5. **`is_test_company` exists in the schema; nothing reads or sets it yet.** `engine/admin_harness.py` still reads `config/test_companies/*.json`, not a real company row from Supabase — that's a genuine rewrite needing a live Supabase project to build and verify against, not a column add. No UI sets the flag either. Both are named follow-ups, not silently dropped — full history and sourcing caveats in the pass-history section below.
6. **No `people` storage-path column yet for the original uploaded CV file.** `cv_uploads.storage_path` actually covers this now (see Built table) — this gap from an earlier pass is **resolved**, recorded here only so the history entry below isn't mistaken for still-open.
7. **`tender_requirements`' SETUP facts (managerial flag, tender project type, DS specialism description) are unseeded**, so the SANRAL score estimate is wider than it needs to be, and every DS1 shows role fit as "Confirm by hand" (a DS role can't be matched to a tag without its specialism). `tenders.evaluation_rules` is also unseeded until `engine/seed_tender_evaluation_rules.py --write` runs against a live project. The vault-field half of this gap (TCS PIN, insurance, ISO, bank-letter date, B-BBEE proof) is **closed** by `0014`. Two related items remain: Klipcorp's ISO 9001 certificate number and expiry are still unknown, and CSD registration validity has no column.
8. **Uploads are capped at ~4.4 MB** (Server Action body `4.5mb`, which is Vercel's hard 413 limit). Sarel asked for more. Larger files need a direct browser-to-Storage upload via signed upload URLs, which isn't built. This affects CVs, experience and the vault alike.
9. **No live Supabase project exists anywhere in this project.** This is the single biggest standing verification gap — every Supabase-reading/writing piece built across every pass (CV uploads, experience library, compliance report, daily digest live mode, admin harness Supabase wiring) is verified only by schema replay and/or local-mode runs, never against real rows. Named once here rather than repeated in every table row.
10. **Naming collision risk, not a functional bug: `company_members.tender_role` vs. the `tender_roles` table are two unrelated concepts with near-identical names.** The first (migration `0010`) is a 5-value workflow-visibility role (full_cycle/validator/cv_admin/finance/viewer) — "what sections of the daily digest can this user see." The second (migration `0016`) is a 47-row reference catalog of real tender position codes (PL, CE, DS1 Pavement and Materials, SACPCMP safety officer, etc.) plus `person_role_eligibility` — "which tender positions does this person's CV qualify them for." They're on different tables with no code-level collision (checked by grep: `daily_digest.py` only ever touches `company_members.tender_role`; the role-catalog code only ever touches `tender_roles`/`person_role_eligibility`), built independently by different agents on the same day without either referencing the other. Flagging because a future reader skimming the schema or a future agent extending either feature could easily conflate the two from the name alone. Not renaming either unilaterally — both are already referenced across multiple files (`engine/notify/daily_digest.py` for the first; `app/lib/tenderRoles.ts`, `0016`, `score_outlook.py`, the People page and compliance report for the second), so a rename is a real multi-file change, not a one-line fix — flagging for whoever next touches either feature to pick a clearer name (e.g. `digest_role` vs. `tender_position_roles`) rather than silently leaving two "tender role" concepts in one schema.

11. ~~A hard-killed worker leaves a CV job stuck in `generating`~~ — **fixed this pass.** Migration `0019_generated_cvs_claimed_at.sql` adds `generated_cvs.claimed_at` (set the moment a worker claims a row), and `process_cv_jobs.py` gained `fail_stale_jobs()`, same shape and 60-minute threshold as `process_pack_jobs.py`'s own, called at the top of every `poll_once()`. Verified: migration replays cleanly as part of the full `0001`→`0019` chain; `python3 engine/cv/process_cv_jobs.py --self-test` still passes unchanged; a direct functional test (monkeypatched `supabase_request`, no live Supabase needed) confirmed `fail_stale_jobs()` fails only a job claimed >60 minutes ago and leaves a 5-minute-old job and an unclaimed job alone.

12. **Submission pack — what still stands between it and "no manual input except the tender's own questions":**
    - **No UI creates a `tender_packs` row or confirms `tender_pack_assignments`.** Only `seed_supabase_company.py` writes them. The pack card says "no confirmed key person" until one exists. Confirming who fills each position is exactly the kind of question the user should answer in the UI, and there's nowhere to answer it yet.
    - **Nothing puts the blank SANRAL templates into `tender_documents` / the `tender-documents` bucket.** The download can't be automated (reCAPTCHA, playbook §1a). The bucket exists now (`0017`), but there is no upload UI or script. Until there is, the card hard-stops on "blank templates not uploaded".
    - **The Financial workbook isn't in the PDF.** No print path exists for it. The filled `.xlsm` ships alongside, and the contents page says so.
    - **The signatory comes from `people.signatory_capacity`** (first person with one set). `fill_docx_forms.py` still writes that one person into both C.1.2.3 key-person rows (pre-existing).
    - **Human-only items stay human**, and the contents page and `ACTIONS_TO_SIGN.md` list them: signatures, witness, pricing, and the B4/B5 narratives.

## This pass (2026-10-17, admin review console)

Built spec item 31's missing half: the documents inline, and "mark reviewed". See the Built table row.

**Findings while building:**
- The harness kept its generated documents only in `/tmp` (`admin_harness.RUN_OUT_DIR` / `PACK_RUN_OUT_DIR`), so nothing could reach the web app. The writer now uploads them.
- The writer's upsert had no `on_conflict`, so PostgREST would have resolved on `id` and a second run would have hit the unique constraint. It now passes `test_company,tender_ref,kind`.
- The form-fill and pack checks share run keys, so `0022` adds `kind` and widens the unique key.
- The first `soffice` call failed when another LibreOffice was running. It now uses a private profile with one retry.

**Open:**
- "Owner of any company" is still the admin proxy (0005's convention, kept on purpose). Once real customers sign up, any customer's owner could read these runs and mark them reviewed. A real admin flag would close that.
- Refused packs (`expired_certs_co`, `new_co`) are `ok` with no document, because a refusal is their baseline.
- 15 of 18 form runs are still flagged locally (QA section). Accepting them is now a per-run "Mark reviewed", or `--reset`.

## This pass (2026-10-17, 06:10 UTC)

Two small commits since the last check-in: a vault-health summary chip row on the Company page
(`400a5ab`) and a routine `state/seen_tenders.json` dedup-store update from the daily discovery
watch (`affa5f0`, data only, no code). Verified the chip isn't a third expiry implementation —
confirmed by grep it's computed from the same `expiryStatus()` calls (`@/lib/dates`) the six
existing document rows already use, so it can't drift out of sync with them. `npm run
typecheck`/`lint` clean. Nothing to fix, nothing new to flag.

## Quiet passes (2026-10-17, 02:11 and 04:11 UTC)

Merged into one entry rather than stacking a new header per quiet check-in (the thing this
file's own convention note warns against). **02:11:** one new commit (`6f926be`, promoting the
submission-pack link to a primary CTA in the jump-nav) — visual-priority/ordering only,
confirmed by reading the diff directly (a `variant` prop on the existing `JumpLink`, reordered
pills, no report/scoring logic touched). **04:11:** zero new commits since 02:11 —
`origin/main` unchanged. Both passes re-ran `npm run typecheck`/`lint` (clean) and re-confirmed
the general SBD engine is still wired (`general-workspace.tsx`/`general-actions.ts` still call
into it). Nothing to fix, nothing new to flag in either.

## This pass (2026-10-17, 00:11 UTC)

Orient: three substantial commits landed since the last check-in (`4ec219e` bridge worker,
`0879f5e` SANRAL submission pack, `d050bdb` general tender preparation) — 7,400+ insertions
across 64 files, closing both of this doc's own headline gaps (general SBD engine now reaches
the web app; `admin_harness.py` now has `--pack` and the general engine has its own parallel
harness). All three were already thoroughly self-documented and self-verified in this file by
their authors, following the tables/appendix convention correctly, including explicitly naming
their own remaining gaps (11, 12) rather than hiding them.

Independently re-verified rather than trusting the claims at face value: replayed all 18
migrations (`0001`→`0018`) against a fresh scratch Postgres, all clean; read the new
`.github/workflows/bridge-worker-ci.yml` directly to confirm it needs no secrets, has
`permissions: contents: read`, a concurrency guard, and path-scoped triggers — no cost or
safety concern; confirmed by querying the replayed schema directly that `generated_cvs` really
does lack a claimed/started timestamp while `pack_generation_jobs` has one, exactly as Gap #11
described.

**Fixed Gap #11** (see the gap entry itself for the full writeup): added migration `0019`
(`generated_cvs.claimed_at`) and a `fail_stale_jobs()` function in `process_cv_jobs.py`,
mirroring `process_pack_jobs.py`'s already-reviewed pattern exactly. Verified with the full
19-migration replay, the existing `--self-test` (still passes unchanged), and a new functional
test (monkeypatched `supabase_request`, no live Supabase needed) proving it fails only a
job claimed >60 minutes ago.

`npm run typecheck`/`lint` clean (no TS touched). No new duplication found in the new work.

Quiet pass: one new commit since the last check-in (`3deea1a`, sticky jump-nav on the Tender
Workspace page) — small, additive-only (id anchors + nav markup, no logic touched), already
well-documented in its own commit message, verified by its own author (`tsc`/`eslint` clean,
`next build` compiles). Re-confirmed the general SBD engine still has no web-app caller
(unchanged) and re-ran `npm run typecheck`/`lint`, both clean. Nothing to fix beyond a one-line
note added to the Built table above; nothing new to flag.

## Fixed this pass (2026-10-16, 20:10 UTC)

- **Known-gaps numbering bug** (items 8/9 had swapped into the wrong order, and two in-doc cross-references — "Gap #9" for the upload cap, "Gap #8" for no-live-Supabase — pointed at the wrong item after the swap): corrected the order and both references.
- **Re-verified all 16 migrations replay cleanly** against a fresh scratch Postgres (full `auth`/`storage` stub) rather than trusting the prior passes' own claims at face value — confirmed, no regression.
- **New finding, flagged not fixed**: `company_members.tender_role` (workflow digest-visibility role) and the new `tender_roles` table (47-row SANRAL/buyer position catalog) are unrelated concepts with near-identical names, built independently by different agents the same day — see Gap #10.

## Fixed in the prior pass (2026-10-16, 18:10 UTC)

- **Migration `0008_cv_uploads.sql` had a real bug, flagged by three separate prior passes as "not mine to fix" and never actually fixed:** `generated_cvs_person_idx` referenced a `created_at` column that doesn't exist on `generated_cvs` (the real column is `requested_at`). Since `0008` has never been applied to any real database (no live Supabase project exists anywhere in this project), it was safe to correct in place rather than write a new patch migration. **Verified for real**: stood up a scratch local Postgres 16, stubbed `auth`/`storage` fully (including `storage.buckets`/`storage.objects`/`storage.foldername()`, which earlier passes' stubs were missing), replayed all 13 migrations (`0001`→`0013`) in order — all now apply cleanly, confirmed the corrected index definition via `pg_indexes`.
- **Two stale doc-comment references** to `0007_cv_uploads.sql` (the file was renumbered to `0008` after a same-day migration-number collision, but two comments elsewhere never got updated): `app/app/people/actions.ts` and `engine/cv/process_cv_jobs.py`, both corrected to say `0008`.
- **This file's own structure** — see the Convention note at the top.

## QA / stability

- **One-command verification**: `npm run typecheck` / `npm run lint` / `npm run verify` in `app/package.json`, so every agent has one thing to run instead of three.
- **Migration numbering**: `0001`–`0019`, sequential, no live collisions — one near-collision (two agents both reaching for `0007`/`0009` the same day) was caught and resolved by renumbering before landing, confirmed by git history.
- **RLS review**: every policy either follows the tenant-isolation default (`is_company_member(company_id)`) or carries an explicit comment explaining why it doesn't. No mismatched pattern found across any pass to date.
- **Cross-pass reuse discipline is holding up well**, worth stating plainly rather than only hunting for problems: `score_outlook.py` explicitly defers to `sanralScoring.ts` instead of reimplementing it; `daily_digest.py` imports `assess_tender`/`watch_new_tenders`/`watch_deadlines` directly rather than re-deriving their logic; `tenderCompliance.ts` reuses `app/lib/dates.ts`'s `daysUntil` rather than a third expiry implementation. Each of these was checked this pass, not assumed.
- **`admin_harness.py` currency**: real and still running the SANRAL path correctly. `--pack` adds the submission pack (and CV generation inside it), see Gap #2. Separately: on this host, the **local** form-fill baselines (`state/`, gitignored) flag 15 of 18 runs. All 15 are `a_forms.A10.deviations_or_qualifications` → assumed_default, plus a date-driven COID flip for `complete_co`. These come from earlier `fill_a_forms.py` changes, not this pass. The baselines were left as-is for the owner to accept with `--reset`.

## Open items for Sarel's own call (not decided here)

- **CV AI-extraction** (`CV-Extraction-Findings.md` §7-8): create an Anthropic API key and set `ANTHROPIC_API_KEY` on the worker; share 3-5 real team CVs to measure against; decide whether scanned CVs should be read by Claude as images/PDFs or stay "use as-is" only; Opus 5.5 (default) vs Haiku 5.5; columns for other professional bodies.

- General engine (Gap #1): (a) worth building coordinate-overlay filling for the commonest flat municipal MBD bundles, or keep the completion guide? (b) which buyer-specific forms first (ESKOM Form A / declarations look commonest)? (c) should the company telephone / e-mail / CIDB grading (0018) also be editable on the Company page (today: captured on the Tender Workspace)? (d) a "start a tender from my own documents" path for buyers not on eTenders?
- Gap #5 follow-up: rewriting `admin_harness.py` to read a real company's data from Supabase instead of local JSON fixtures, and deciding where an `is_test_company` toggle should live in the admin UI. Both need a live Supabase project to build and verify against properly.
- Gap #7 vault fields: **answered and built** (Sarel's 8/9/10, migration `0014`). Still open: Klipcorp's ISO certificate number and expiry, and whether the EME affidavit is accepted the same way as the QSE one (assumed, not confirmed).
- Gap #8: is a direct-to-Storage upload worth building to get past ~4.4 MB?
- Questions 3/5/6/11 (evidence rules, roles, role tagging, office locations): **answered and built** (`0015`, `0016`). New questions are at the end of `Tender-Evaluation-Engine-Audit.md` "Round 2":
  - Klipcorp's real offices;
  - which roles to tag Henning for;
  - seeding `tender_requirements`;
  - new discipline buckets;
  - per-schedule compliance.
- **Submission pack (Gap #12):** where should position confirmation live (the Key positions card on the Tender Workspace is the natural home)? Who uploads the blank SANRAL templates per tender, and from where? Should the Financial envelope be a separate PDF, since it is sealed separately?
- **Deploying the bridge worker** (Railway Hobby, $5/mo, recommended; steps in `Automated-Fulfillment-Deployment.md`). It needs a Railway account plus the Supabase URL and service-role key, so it can only happen once a live Supabase project exists. A scheduled GitHub Action was considered and rejected, with evidence, in that doc (GitHub's Actions terms, 5-min floor, auto-disable after 60 idle days).
- **Pipeline board (item 10):** (a) should a tender auto-advance to "submitted" when its pack is ready? Not done: "pack ready" means a PDF exists, not that it was handed in (submission happens on the buyer's portal or by hand), so the only automatic move is found → bidding on a pack request. (b) Should "Prepare this tender" on Discovery count as bidding? Today it lands at found, since it's also used just to read a tender's requirements. (c) The Tenders tab (dashboard) still lists every shared tender with pack status; fold it into the board, or keep both?
- Whether/how to wire real notification sending (email) for the daily digest and the document-expiry/task reminders — both currently report-only by design, pending a decision on the send mechanism.

---

## Detailed pass history (evidence appendix — see tables above for current state)

In date order. Each entry is a point-in-time record of what a pass built and how it verified it — not maintained after the fact, so a gap this section calls "not yet built" may have since closed; check the tables above first.

### Terminology fix: "dummy company" → "test company" (2026-10-16)

Per Sarel's explicit instruction (received via a cross-session message, verified against the spec commit `2acb495` before acting on it). Code-level rename landed in `f942bed`: `config/dummy_companies/` → `config/test_companies/` (directory + every "Dummy"-prefixed value inside the 3 fixtures), `engine/admin_harness.py`, `engine/write_admin_harness_results.py`, comment-only mentions in `fill_a_forms.py`/`fill_docx_forms.py`, migration `0006_rename_dummy_to_test_company.sql` (`admin_harness_runs.dummy_company` → `test_company`; `0005` itself left untouched as applied history), and `app/app/admin/page.tsx` + `HarnessRunRow.tsx`. Verified for real: ran `python3 engine/admin_harness.py --reset` after the rename — 18 clean runs (3 test companies × 6 tenders), 0 flagged, 0 failures; `npm run typecheck`/`lint` clean; `next build` compiles and type-checks (same pre-existing prerender-only failure as every build in this environment).

### `is_test_company` schema correction (2026-10-16)

Earlier in this same pass-sequence, I'd found the schema didn't match the spec's own description (item 30: "maintain several test companies in the same `companies` table... a simple `is_test_company` flag") and recommended updating the spec to match the simpler JSON-fixture reality instead. That recommendation was **wrong** — a cross-session message relayed a correction from Sarel: the original spec intent is the actual target, a test company should be a real row in `companies`, onboarded through the normal flow (`create_company_and_join`), not a fixture file. Sourcing caveat, stated honestly at the time: the spec text itself (`is_test_company` flag) was independently re-verifiable and grounds the column; the broader quotes attributed to Sarel in the relay weren't checkable against a primary-source commit the way the terminology rename was. Added migration `0007_add_is_test_company.sql` (boolean, default `false`, never customer-facing) — verified by replaying `0001`→`0007` on a scratch Postgres instance with stubbed `auth`. Deliberately not built in that pass: `admin_harness.py` reading a real company row instead of JSON fixtures (needs a live Supabase project), and any UI toggle for the flag. Both remain open — see Gap #5.

### CV "use as-is" spec requirement (2026-10-16)

Landed as a spec update (`2acb495`): a third CV path alongside AI-extract-to-fields and AI-generate — a company can upload a CV and have it attached to a submission exactly as uploaded, no extraction, no reformatting. At the time, `people` had no file-storage column of any kind; flagged that storing the original uploaded file was foundational to all three CV paths (not just this new one — AI-extract also needs the original kept for its confirm/correct screen), and recommended whoever built the upload flow decide column-vs-table shape as part of that work rather than in isolation. **This has since been built**: `cv_uploads` (migration `0008`) is exactly that table, with `mode` distinguishing `as_is` from `ai_extract`. See Built table and Gap #6 (marked resolved).

### Git-history oddity, checked, no fix needed

Two commits, same session, one minute apart, identical commit message "Add Tender Workspace readiness report page": `c872190` and `c38a2e5`. Diffed both directly — `c872190`'s actual diff is the admin harness console; `c38a2e5`'s actual diff is the real readiness-report page. A shared-index git race mislabeled which diff landed under which commit message. No functional inconsistency: both feature sets are present and correct in the working tree, only the historical commit message for `c872190` is wrong. Not rewriting shared `main` history over a cosmetic label.

### Date-expiry coloring duplication, found and fixed

`app/app/dashboard/page.tsx` had its own `daysLeft()` and `app/app/company/page.tsx` had its own `expiryStatus()` — same color palette hand-copied twice, same "days until a date" math written twice, plus a real behavioral inconsistency (dashboard diffed against `Date.now()` rather than midnight-truncated "today", so its count could silently drop by one partway through the day). Fixed: extracted both into `app/lib/dates.ts` (`daysUntil`, `expiryStatus`), standardized on the midnight-truncated version. Later passes' new code (`tenderCompliance.ts`) correctly reuses this rather than adding a third implementation — checked, confirmed.

### Role-based daily digest engine (2026-10-16)

Built in response to Sarel's request: define tender-workflow roles, then a role-based daily digest. Landed concurrently with another agent's `tender_tasks` work; migration renumbered `0009`→`0010` on sight of the collision. Five roles (full_cycle/validator/cv_admin/finance/viewer) tied to real pages/actions, documented in the spec's own new section. `engine/notify/daily_digest.py` reuses `assess_tender.py`, `watch_new_tenders.py`'s `REPORT_WORTHY_VERDICTS`, and `watch_deadlines.py`'s functions directly — new code only for reading `field_provenance`. Two run modes: `--mode local` (verified — ran against the real OCDS feed + real company profile, 5 correct per-role digests confirmed by reading output JSON) and `--mode live` (written, unverified, no live Supabase project). No new UI built — `company_members` has no roster page at all, so a role picker would mean building that page from scratch; flagged for Sarel rather than built unilaterally. `tender_role` is set via the Supabase dashboard/SQL until a roster page exists. Known gap at the time: keyword-based filtering for `cv_admin`/`finance`/`validator` will misclassify some free text — acceptable first pass, named as approximate in both the spec and the code.

### Company experience library (2026-10-16)

Built because Sarel asked for it: capture company experience evidence (letters of award, reference letters, close-out reports, completion certificates), tag it by hand, make it matchable to tenders. Confirmed by grep before building that nothing like it existed — `projects` is one person's key-person CV history, not company experience. Headline evidence finding: the real completed Klipcorp submission contains a sworn affidavit declaring **0 completed projects** for SANRAL Form B6 past performance (15 of 100 functionality points, needs 3 in 10 years) — this library is where that evidence would live. Built: migration `0012_experience_items.sql` (`experience_items` table, `experience-documents` storage bucket, the `experience_matches()` SQL function), taxonomy matched exactly to `assess_tender.py`'s `DISCIPLINE_KEYWORDS` and SANRAL's own client/project-type codes, `/experience` + `/experience/[id]` pages (capture and tagging as separate steps, per Sarel's request), and a bump to Next's server-action body size limit (1MB → 4MB) for scanned letters. Verified: replayed `0001`-`0012` on scratch Postgres (0008's bug was still present at the time, now fixed — see "Fixed this pass"); functional SQL tests confirmed filter correctness and tenant isolation; taxonomy cross-checked by script against real data. Not verified: the pages against a live Supabase project. Deferred: no AI extraction of tags from uploaded letters (manual only), no B6/Annex 1/reference-letter-request generation, no tender-side compliance UI (built by the next pass, see below). Open questions for Sarel in `docs/specs/Experience-Library-Findings.md`: whether Henning's ACSA projects count as Klipcorp company experience, how JV-partner evidence should be recorded, whether ACSA/SASSA ask for experience differently, whether the 4MB upload cap is enough.

### Tender evaluation audit, score estimate, per-tender compliance check (2026-10-16)

Sarel asked for two things: an assessment of how well-suited each discovered opportunity is and how the company would score on it, and — once a tender is being pursued — a compliance check of which documents/CVs/experience the company has and doesn't. Full evidence in `docs/specs/Tender-Evaluation-Engine-Audit.md`. Audit finding: `assess_tender.py` answers suitability only, never estimates points (`bee_level` loaded and never used, the `possible` verdict unreachable, `bbee_points_mentioned` was noise and is now commented as such). Built: `engine/discovery/score_outlook.py` (wired into `assess_release()`, reads preference system/specific-goals basis/functionality threshold from the tender's own document, returns points only where the profile genuinely answers, price never estimated — see Built table), migration `0013` (`discovered_opportunities.score_outlook jsonb`), `app/lib/sanralScoring.ts` (SANRAL's published consultant functionality method, Book 1 Annexure A matrices transcribed from a real tender document), and `app/lib/tenderCompliance.ts` + `compliance-report.tsx` mounted on the Tender Workspace (required documents, key-people/CV minimums, company experience via the Experience Library, functionality score estimate — only the SANRAL Conventional family mapped, others get "not mapped yet"). Verified: `score_outlook` run on 11 real texts plus a 25-release live OCDS run (2 false positives found and fixed); SANRAL estimate hand-checked against the matrices on Henning's real projects; compliance checks run against real Klipcorp vault values and a real `field_provenance.json`, including edge cases. Known gaps at the time, several since narrowed (see Gaps list above): no live Supabase project; `tender_requirements` unseeded so SETUP facts are unknown to the page; several vault fields missing (SARS TCS PIN, insurance, ISO certificate, bank-letter date, B-BBEE proof expiry); non-SANRAL specific goals (women/youth/disability/locality) can't be estimated; years-since-first-degree is a labelled proxy for "relevant experience."

### Tender task/deadline timeline + document-expiry reminder script (2026-10-16)

Item 8 plus the new "Document expiry reminders" spec section. Migration `0009_tender_tasks.sql`: tenant-scoped `tender_tasks` (description, due_date, status, nullable `kind` closed to `closing`/`briefing`/`clarification`/`submission` — only ever set by auto-seed, never the manual form — plus `is_standard`), with a partial unique index so the auto-seeded closing milestone upserts idempotently. Verified by replaying `0001`→`0009` on a scratch Postgres with a fuller stub than the prior pass had used (added `storage.buckets`/`authenticated`/`anon`, which `0001` and `0008` need) — all applied except `0008`, which failed on the `created_at`/`requested_at` bug (flagged, not fixed in that pass — **since fixed**, see "Fixed this pass" above). Tender Workspace gained a "Tasks & milestones" section (closing milestone auto-seeds on page load; manual add-task form is description + due date only, no fixed type dropdown, per spec; inline status control actually persists, unlike `review-button.tsx`'s still-can't-write `field_provenance.reviewed_at`). `engine/compliance/watch_deadlines.py`: same family/boundary as `watch_new_tenders.py` (finds due documents and due tasks against a seen-store, report-only, no send — confirmed by grepping the whole repo for any email-sending code: zero hits). Reminder lead times: 60 days for documents (matched to `app/lib/dates.ts`'s existing 60-day "renew soon" threshold rather than a second number for the same concept), 14 days for tasks. Explicitly not built: real notification sending, briefing/clarification/submission milestone auto-seeding (their dates aren't captured anywhere in the schema), and a "sidewalk" feature (Sarel's own phrase flagged as a possible transcription artifact, not guessed at). Open question for Sarel, written up rather than guessed at: `docs/specs/Document-Expiry-Tracked-Fields-Open-Item.md` — the spec names COID/B-BBEE/insurance/CSD as tracked documents, but the schema has only one real expiry-date column (COID); extending to the others needs Sarel's confirmation and a migration.

### Task/milestone assignee (2026-10-16)

Sarel's request: "assign specific people to each of the steps in the flow, so we know who's responsible." Migration `0011_tender_task_assignee.sql`: `tender_tasks.assigned_to`, nullable uuid FK to `people(id)` (not `company_members` — that table has no display name and, per the prior pass's own finding, zero UI surface), `on delete set null` so removing a person never silently deletes a task referencing them. Tender Workspace: each task/milestone row gained a plain `<select>` of the company's people, same "tap it, it persists via a server action" shape as the existing status control. Verified by replaying the full migration chain and doing a real round-trip (insert a person → assign a task → confirm the join returns the real name → delete the person → confirm the task survives with `assigned_to` reset to null). Merge conflict handling: landed concurrently with another agent's tender-workspace reorder commit (`0f9068f`) touching the same page; resolved by keeping both sides in full (their summary-chip block as written, their new section ordering, just with `people={assignablePeople}` added onto the `<TaskTimeline>` call), rechecked typecheck/lint and re-read the JSX tree afterward to confirm no duplicate render was left behind. Explicitly not built: notification-on-assignment (the separately-built daily digest can pick this up later), a general task-template system.

### Document Vault compliance fields, B-BBEE affidavit, upload cap (2026-10-16)

This pass closes Sarel's answers 4, 8, 9 and 10 from the evaluation audit and experience-library questions. They are quoted in `Tender-Evaluation-Engine-Audit.md`, under "Answers received".

**Built:**

- **Migration `0014_vault_compliance_documents.sql`.** It follows the COID pattern: plain columns on `companies`, covered by the existing `is_company_member(id)` policies, with no new table policy. It adds:
  - `sars_tcs_pin` and its expiry;
  - `pi_insurance_insurer`, policy number, cover in rand, and expiry;
  - `iso_9001_certified` (nullable: null means "not stated", not "no"), certificate number and expiry;
  - `bank_confirmation_letter_date`, plus a **generated** `bank_confirmation_letter_valid_until` (date + 3 months, which is the FNB stamp validity and the common buyer rule);
  - `bee_proof_type` (`certificate` / `qse_affidavit` / `eme_affidavit`) and `bee_proof_expiry`. `bee_level` already existed and is reused.
  - a `*_path` column per document (COID included), plus a private `company-documents` bucket with the same path-prefix storage RLS as `cv-documents` and `experience-documents`.
- **Document Vault (`/company`).** Each of the six documents has a row with its facts, the same expiry `Badge` the COID row had, a signed link to the uploaded copy, and an Upload/Replace form (`uploadVaultDocument`, `app/lib/vaultDocuments.ts`). The edit form captures every new field. The bank letter badge uses a 30-day "renew soon" window instead of 60, because the letter is only valid for 3 months.
- **Compliance check (`tenderCompliance.ts`, `compliance-report.tsx`).** A9, A12, A17, A18 and B4 now get real On file / Don't have status from the vault against the closing date, with a "Renew soon" chip when the document is valid at closing but renewal is due within 60 days (30 for the bank letter). "Confirm by hand" now only means a detail is missing, such as no expiry date or no proof type recorded.
  - **B-BBEE:** a QSE or EME sworn affidavit valid at closing is "On file" and described as equivalent evidence. It is never treated as a missing certificate.
  - **B4:** a valid ISO certificate fixes the score estimate's quality system at 10. The specific-goals note now reads the B-BBEE proof's validity.
- **`watch_deadlines.py`.** `TRACKED_EXPIRY_FIELDS` now holds six columns, no longer only COID, with a per-field lead-time override (the bank letter uses 30 days). CSD validity is still untracked: it has no column.
- **Seeding.** `seed_supabase_company.py` maps the new fields from `config/klipcorp_profile.json`, the same source the COID data comes from. The local, gitignored profile now records ISO certified = true (number and expiry unknown), the bank letter date 2026-09-09, and the QSE affidavit expiring 2027-09-09.
- **Upload cap.** `next.config.ts` goes from `4mb` to **`4.5mb`**. That is Vercel Functions' hard request-body limit (413 `FUNCTION_PAYLOAD_TOO_LARGE`, confirmed on Vercel's limits page today), so the 15-20 MB that was asked for can't work through a Server Action on Vercel. The vault rejects files over 4.4 MB with a clear message, leaving room for multipart overhead.

**Verified:**

- `npm run typecheck` and `npm run lint` are clean. `next build` compiles, then fails at `/login` prerender for the same pre-existing reason as before (no Supabase credentials).
- Replayed `0001` to `0014` on a scratch Postgres 16 with the same `auth`/`storage` stubs, after rebasing onto the concurrent `0008` fix (`666b473`). All 14 apply cleanly. On the replayed database:
  - the generated column gives 2026-09-09 → 2026-12-09 and rejects direct writes;
  - the `bee_proof_type` check constraint rejects junk;
  - under `set role authenticated`, a member updates only their own company and cannot write a storage object under another company's prefix.
- The seed script's new payload, built from the real profile values, inserts cleanly into the migrated `companies` table.
- **Compliance lib on Klipcorp's real values** (R.396 closing 2026-10-22):

  | Row | Result |
  | --- | --- |
  | A9 TCS PIN | On file (to 2027-06-24) |
  | A12 B-BBEE | On file: QSE affidavit, accepted as equivalent |
  | A17 PI insurance | On file (to 2027-03-31) |
  | A18 bank letter | On file (letter usable to 2026-12-09) |
  | B4 ISO 9001 | Confirm by hand: certified, but no expiry on file |

  Edge cases also checked:
  - an affidavit lapsing before closing → Don't have, 0 preference points;
  - proof type unrecorded → Confirm by hand;
  - closing after the bank letter's 3 months → Don't have;
  - insurance expiring soon after closing → On file + Renew soon;
  - ISO = no → Don't have;
  - empty vault → four Don't have rows.
- **`watch_deadlines.py`'s own `find_due_documents()`,** with `supabase_request` served from the replayed database. On today's date, Klipcorp's real dates report nothing, which is correct: the bank letter has 54 days left against its 30-day window. A test company with near and past dates reports the PIN (20 days), insurance (expired 3 days ago), ISO (59 days) and bank letter (22 days), and omits B-BBEE at 61 days. A second run reports 0 new items (seen store). At a simulated 2027-03-01, Klipcorp reports COID at 60 days, PI at 30, and the bank letter expired.

**Open / not done:**

- **Never rendered against a live Supabase project.** This environment doesn't have one, which is true of every app page.
- **Klipcorp's ISO 9001 certificate number and expiry are unknown.** No document in this repo shows them. The real NRA 2026/0084 Form B4 was an **in-house QMS** write-up, which scores 5, not ISO's 10. Sarel should upload the certificate through the vault and make sure it goes into future packs.
- **Uploads above ~4.4 MB need a direct browser-to-Storage upload** (`createSignedUploadUrl`). That covers CVs, experience and vault documents alike, and it isn't built.
- **Real files have not been uploaded.** The PIN letter, AON schedule, bank letter and affidavit exist in `templates/incoming/completed_sample`. They go in through the vault UI once a live project exists.
- **CSD registration validity** still has no column.
- **The EME affidavit is assumed accepted.** Sarel confirmed the QSE affidavit; the EME affidavit is the same DTIC sworn-affidavit regime and is treated the same way, but he didn't explicitly confirm it for SANRAL.

### Tender roles, tender-specific evidence rules, office locations (2026-10-16)

This pass closes Sarel's answers 3, 5, 6 and 11 from the evaluation audit. Quotes, research tables and verification are in `Tender-Evaluation-Engine-Audit.md`, "Round 2".

**Research (Observed):** read 14 non-SANRAL tender documents (8 newly fetched from the live OCDS window), all six SANRAL Book 1s, and the `SETUP` / `WORKINGS MATRIX` / `Proj Relevance Codes` sheets of two real SANRAL RRM workbooks.
- Experience evidence differs on every axis: evidence type, paired appointment+completion, count, window, and points vs disqualification.
- Locality shows up in 6 tenders, at province, district and local-municipality level. Two of them use it beyond specific goals: uMlalazi also scores it as functionality, and Dawid Kruiper makes a local office mandatory.
- Book 1 publishes **9** project-type matrices, not the 2 the first pass transcribed.
- The managerial flag is set per tender: PL is "Non-Man" on all six Conventional tenders, CE1 is "Man" on both RRM tenders, and the master list differs from both.

**Built:**
- `0015_company_offices.sql` and the Company page "Office locations" section.
- `0016_tender_roles.sql`: the 47-role catalog, `person_role_eligibility`, and `tenders.evaluation_rules`. The People page has a "Tender roles this CV qualifies for" tagging control.
- `score_outlook.py` now extracts evidence and locality; `assess_tender` profile `offices` are derived from the registered address and labelled as derived.
- `engine/seed_tender_evaluation_rules.py`.
- `app/lib/sanralMatrices.ts` (9 matrices as data), `tenderRoles.ts`, `locality.ts` and `experienceEvidence.ts`.
- The compliance report's role fit, B6 / Company experience and Locality sections. Changes to the files shared with the concurrent vault agent (`tenderCompliance.ts`, `compliance-report.tsx`, `company/page.tsx`) were kept to one optional `evidence` input plus mount points.

**Verified:**
- `0001`→`0016` replayed on scratch Postgres 16; all clean.
- RLS and constraint tests on `0015`/`0016` behaved as expected.
- Extraction was run on the real texts; the outlook showed no regression across 38 texts.
- `sanralScoring.ts` output is identical before and after the refactor.
- Role-fit, evidence and locality logic were run against the real Klipcorp profile plus test offices.
- `npm run typecheck` / `npm run lint` are clean.

**Not verified:** nothing has run against a live Supabase project (Gap #9). No tender has stored rules yet, so the compliance report shows the labelled "Assumed rule" fallback until the seed script is run with `--write`.

### Bridge worker: automatic fulfilment of queued CV/pack requests (2026-10-16)

The goal was to remove the manual step of someone typing `process_cv_jobs.py` for a queued request to be fulfilled. Full write-up: `docs/specs/Automated-Fulfillment-Deployment.md`.

**Built:**
- `engine/worker/poll_loop.py`: the one shared loop. It survives a failed poll and handles SIGTERM.
- `process_cv_jobs.py`:
  - new `--loop`/`--daemon`, `--interval`, `--max-cycles` flags;
  - an atomic claim;
  - oldest-first ordering;
  - no empty-poll log noise in loop mode.
- `engine/worker/run_bridges.py`: drives `cv` and `pack` (path-registered, `--once` contract, skipped until the file exists), plus any `--script`.
- `engine/worker/Dockerfile`, `requirements.txt` and root `.dockerignore`.
- `.github/workflows/bridge-worker-ci.yml`: CI only, no secrets.
- `engine/worker/test_poll_loop.py` + `fake_supabase.py`.

**Behaviour change, stated plainly:** before this, `process_cv_jobs.py` with no flag looped forever (hard-coded 30 s sleep, no error handling). Only `--once` exited. The no-flag default is now one-shot, as the brief asked, and `--once` is unchanged. Grep found no caller that relied on the old default.

**Verified:** see the Verification section of the deployment doc. In short:
- the loop really loops (unit and real-subprocess runs);
- the container was built and run locally, with real PDFs made inside it;
- one-shot output is identical to the pre-change code;
- `actionlint` is clean.

**Not done:**
- not deployed, because that needs Sarel's Railway account and Supabase keys;
- never run against a live Supabase;
- the stuck-`generating` reclaim (Gap #11) isn't built;
- the pack bridge itself isn't written (the other agent's work).

### SANRAL submission pack: one ordered PDF, generated from the Tender Workspace (2026-10-16)

Sarel's goal: SANRAL tenders go "end-to-end without any manual input in the process besides answering all necessary questions needed for the tender." This pass closes the pack half of that. Before it, the CV engine had a request/fulfil bridge, but the SANRAL document pack itself was produced by running each script by hand and zipping the outputs (e.g. the R.396 zip of loose PDFs).

**Built:**

- **Migration `0017_pack_generation_jobs.sql`.** One row per request. It carries:
  - status, from `requested` through `generating` to `ready` or `failed`;
  - the include flags (default: everything currently ready);
  - the readiness snapshot shown at request time, and whether the gaps were acknowledged;
  - the output PDF path, the other outputs, page count, manifest, error, and timestamps.

  Access is tenant RLS via `is_company_member`. The migration also adds two buckets: `submission-packs` (path-prefix RLS) and `tender-documents`. The second is the bucket `tender_documents.storage_path` never had: read-only for signed-in users, written by the service role.
- **`engine/pack/pdf_merge.py`.** Checked first: nothing in `engine/` merged PDFs, and the real completed submissions were assembled by hand. It merges with pypdf, which was already used here. The contents page goes through python-docx and soffice via `generate_cv._convert_to_pdf`, reused. The "Page X of N" stamp is raw PDF text operators, so no new drawing library was added. `verify_pack()` reads the result back: page count, stamps, every contents entry against its real start page, omitted items listed, and bookmarks.
- **`engine/pack/assemble_pack.py`.** Runs the real engines and nothing reimplemented: fingerprint, fill_conventional/fill_tender, print_reports, fill_financial(+hours), run_forms_pipeline, the authority letter and the covers. Section order follows the real completed submission's two-envelope structure. Vault scans can be PDF, image or Word. A combined tender's repeated slots each get their B1-B2, and the CV appears once.
- **`engine/pack/process_pack_jobs.py`.** Same shape as `process_cv_jobs.py`: one-shot by default, `--once`/`--loop` via `engine/worker/poll_loop.py`, and an atomic claim.
  - pack.yaml is built through `confirm_pack.confirm()`, so its human-confirmation gate applies, fed from `tender_pack_assignments.confirmed_person_id`. Every position on the template's own SETUP sheet must be confirmed.
  - A job is only marked `ready` if `verify_pack()` passes.
  - A job stuck in `generating` for more than 60 minutes is marked failed.
- **Tender Workspace.**
  - `compliance-data.ts` holds the compliance report's reads, moved out of `compliance-report.tsx` unchanged and wrapped in React `cache()`, so the report and the new card share one load and one set of gaps.
  - The "Submission pack" card (`submission-pack.tsx`) has hard stops, a "generate a draft anyway" acknowledgement, and an inline status list with signed download links and the not-included items. While a job is active, it refreshes every 15 s.
  - The `requestSubmissionPack()` server action re-checks every gate server-side.
  - The page now shows `?error=` messages. Before this, every action's refusal on this page, including `requestTenderCv`, was silently dropped.
- **Harness.** `admin_harness.py --pack` plus `engine/pack/harness_pack.py`, described in the Built table.
- **Small changes to existing code.**
  - `make_envelope_covers.py` and `fill_authority_letter.py` now accept no logo, for a company without one uploaded.
  - Three fixture fixes found by the first full-chain run: `complete_co` project position `DS1` → `DS` (not a SANRAL option), and `highest_level` labels changed to SANRAL's exact text.
  - Worker `requirements.txt` gains Pillow; the Dockerfile gains Calc + `python3-uno`.

**Verified (evidence, not "ran without crashing"):**

- **Real Klipcorp profile, real R.396 Technical/Financial downloads, real vault PDFs from the completed sample, Henning's real tender CV: a 78-page PDF.**
  - The contents page is 1 page. Each of its 20 rows matched the real section start pages (`verify_pack` clean), and it was checked visually.
  - The page-number stamp reads back on pages 1, 2, 41, 43 (over AON's own "Page 1 of 8" footer, and legible there), 56, 58 and 78.
  - All 23 bookmarks resolve to the right pages.
  - Henning's real ID number is on the B1 page.
  - Not included, each with a reason: TCS PIN and ISO (no copy on file), and the Financial workbook.
- **Bridge, on a scratch Postgres with 0001–0017 replayed.** `bridge_selftest.py` drives the real `process_pending()`. The job went `requested`→`ready` with a 65-page PDF that passed read-back. The B-BBEE copy lapsing before closing was flagged. The DS1 CV with no file was listed as not included. An unconfirmed DS1 failed with the gate's message, and a 2-hour-old `generating` row was failed. A 5-minute-old one was left alone.
- **RLS on 0017:** own insert OK; cross-company insert, bad status and other-prefix storage write all rejected.
- **Worker image** built with the new Dockerfile (sandbox CA variant): `import uno` works, and a 69-page pack builds and verifies inside it.
- `run_bridges.py --once --bridge pack` drives the new script.
- `npm run typecheck` and `npm run lint` are clean. `next build` compiles and type-checks, then fails at the same pre-existing `/login` prerender (no Supabase credentials).

**Not done / still manual:** see Gap #12.

### General (non-SANRAL) tender preparation, 4 stages (2026-10-16)

Sarel: "keep working on automating the non-SANRAL tender preparation and the UI for capturing info needed for the tender". Full write-up and evidence: `docs/specs/General-Tender-Preparation-Findings.md`.

**Built:** Stage 1 `engine/general/requirements.py` (manifest from the tender's own documents; re-uses `score_outlook` evidence/locality/scoring and `assess_tender` CIDB/briefing unchanged - both confirmed buyer-agnostic). Stage 2 migration `0018` (`tenders.buyer/ocid/source/document_urls/document_requirements`, `discovered_opportunities.description`, `companies.telephone/cellphone/email/cidb_grading`, `tender_answers`, `tender_engine_jobs`, `pursue_discovered_opportunity()`), Discovery "Prepare this tender", `general-workspace.tsx` + `general-actions.ts` mounted for family `General (non-SANRAL)`. Stage 3 `fill_sbd_docx.fill_sbd_document()` (bundles, bidder-block scoping, 4 Yes/No layouts, SBD 8/9, answers instead of assumed No; round-1 CLI untouched and re-run: same 26 entries 11/12/3), `build_general_pack.py` (reuses `engine/pack/pdf_merge.py`), `process_general_jobs.py` registered in `engine/worker/run_bridges.py` as `general`; `poppler-utils` added to the worker image. Stage 4 `general_harness.py`, `test_general_bridge.py`, both in `bridge-worker-ci.yml`.

**Corrections to earlier findings:** municipalities use the MBD suite (Dawid Kruiper TN051 §3.4 names MBD 1/4/6.1/7.1/8/9) - "no SBD forms" was literal only; the round-1 ESKOM sample only opened `Technical.zip` - a current ESKOM release has SBD 1/4/6.1 inside its ITT alongside its own forms.

**Verified:** see the findings doc's Verification section; harness counts for this pass: 27 runs (9 samples x 3 test companies) all expectations met, every pack read back clean; a second full run matched every stored baseline (27 clean, 0 flagged, 0 failed). `npm run typecheck` / `lint` clean.

**Not verified:** nothing against a live Supabase project (Gap #9); the UI was typechecked and its checklist logic run against real manifests, not rendered.

### Tender pipeline board, item 10 (2026-10-17)

**Built:** migration `0021_tender_pipeline_stage.sql` (`tender_packs.pipeline_stage` found/bidding/submitted/won/lost, `stage_changed_at`, `submitted_at`, stamping trigger), `/pipeline` page + `moveTenderStage` action, `app/lib/pipeline.ts` (stages, labels, `advanceFoundToBidding()`), Pipeline nav tab, `/pipeline` in `proxy.ts`. `requestSubmissionPack` (SANRAL) and `requestGeneralPack` call `advanceFoundToBidding()` after queueing.

**Why a new column rather than an existing status (checked first, on the record):** `tenders.status` (open/closed/awarded/cancelled) is the buyer's public status on a table shared by every company, so it can't say "we lost". `tender_packs.status` (suggested/confirmed/filled) is the key-person confirm gate for pack generation; it's independent of the outcome. `tender_tasks.kind` (closing/briefing/clarification/submission) tags dated milestones; only `closing` is ever seeded, and a milestone says when something is due, not what happened. None of these can be turned into found/bidding/submitted/won/lost (won and lost exist nowhere). The new column sits on `tender_packs` because that table already is "one row per company per tender", with tenant RLS; no new table and no new policy.

**Decisions:** buttons, not drag-and-drop (nothing in the app does DnD; one next-step button per card and a one-step back covers it). History is the submitted/won/lost columns plus counts, not a separate view. Auto-advance only found → bidding on a pack request; submitted/won/lost stay manual because "pack ready" isn't "handed in".

**Verified:** see the Built table row. `npm run typecheck` / `npm run lint` clean.

### CV AI-extraction, review-then-confirm (2026-10-17)

This pass closes the AI-extract half of "CVs: upload once, never recapture". Full evidence is in `CV-Extraction-Findings.md`.

**Research.**
- The only real team "CV" in the repo is Henning's SANRAL Form B1.1/B2.1 PDF. It has a text layer, and its grid layout splits the client and the contract number onto separate lines and writes each date three ways.
- 3 of the 6 person-related PDFs in the completed sample are image-only scans.
- No LLM code existed anywhere in the repo.
- The text readers in `engine/general/requirements.py` are reused.

**Built:**
- `engine/cv/extract_cv_fields.py`, with the same request/fulfil, claim and stale-reclaim shape as `process_cv_jobs.py`. It is registered as `cv_extract`.
- Migration `0023`. It is numbered after main's `0022`; the `gaps-pack-e2e` worktree holds an uncommitted `0020` and `manual-tender-load` a `0021`, so whoever lands next renumbers.
- The review card and the apply/discard actions.
- `anthropic==1.15.0` added to the worker requirements, and a CI step.

**Behaviour change, `ai_extract` only:** the standard `generated_cvs` jobs are now queued when the reviewer saves, not at upload. Before, they were built from a still-empty record. `as_is` is unchanged.

**Verified:** see the Built table row and the findings doc §5.

**Not verified:** the Anthropic call itself (no key), and anything against a live Supabase.

