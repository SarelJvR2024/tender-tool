# System Status

Maintained by the standing solution-architect review pass. This file reflects **current real
state**, verified by reading code and running checks — not a history (see `git log` for that)
and not a restatement of the phased feature list in
`Tender-Tool-Competitor-Feature-Deep-Dive.md` (read that for *what should exist and why*; read
this for *what actually exists right now, and what's inconsistent between agents' work*).

Last full pass: 2026-10-19, ~00:30 UTC — demo-prep sprint verified: landing page (`4fc2e19`),
SANRAL B6 estimator + real logo (`ffbba14`), auth-pages redesign (`d64e652`), 3 new discovery
sources (`cace3f7`), a real bug caught by live Playwright E2E testing against production
(`9061deb`), demo-blocking copy fixes (`95bce9f`) - all now authored directly by Sarel with
Claude as co-author, ahead of "tomorrow's customer demo." All clean - below. ~23:00 UTC —
verified email/password auth (Sarel's own second
human-authored commit `d721965`: /signup, /forgot-password, /reset-password alongside the
existing OAuth), the onboarding-scan silent-field-loss fix, and a mobile CSS fix - all clean,
full production build still 32/32 pages - below. ~21:00 UTC — **milestone: a live Supabase project and a green Vercel
deployment now exist** (Sarel's own commit `a232e77` — the first human-authored commit all
session), three build-breaking prerender bugs fixed and independently re-verified (`npm run build`
now completes cleanly, the long-standing `/login` prerender caveat is gone); plus a confirmed,
fixed currency-parsing bug (100x-wrong tender values) and a new bulk onboarding-document-scan
feature (migration `0063`), both verified clean - below. ~19:00 UTC — **real bug found and
fixed**: the new B-BBEE
preference-points calculator's Level 3 points table had a wrong value (90/10 = 7, should be 6),
caught by cross-checking it against SANRAL's own policy table already verified elsewhere in this
repo - below. Also verified the 2 other new free tools, migration `0061` (signatory scopes) and
`0062` (market trend), all built off the gap check from the previous pass. ~17:00 UTC — verified
Pack Review (migration `0059`) and tender scope/tags/value-band (migration `0060`), plus answered
a cross-session relay's TenderFlow feature-parity gap check (no code changed - report sent back,
below). ~16:20 UTC —
independently reproduced and confirmed the tenth QA run's fix (`tender_changes.py`
one-bad-listing-crashes-everyone bug, Finding 11) - below. ~14:15
UTC — quiet check-in, 2 small low-risk commits verified (a Discovery mobile-layout fix - stranded
right-rail column, no System-Status entry of its own until now; and a one-line `is not None`
fix for an undercounted R0,00 award in a diagnostic
summary - below). ~12:15 UTC — no new commits since the last check-in; `npm run
typecheck`/`lint` re-confirmed clean. ~10:20 UTC — quiet check-in, 2 small low-risk commits
verified (a Login/Onboarding mobile-overflow fix, and a QA log entry with no code change -
below). ~08:30 UTC — independently verified the last 4 commits (below):
**`watch_tender_updates.run()` now isolates each pursued tender** (one bad tender no longer stops
the watch for every other one); the standing QA review's seventh run, a **repo-wide sweep for the
malformed-date-in-a-batch bug class** (4 more dangerous instances fixed); a **daily compliance
reminder run that a single malformed expiry date used to abort for every company**, now skips
just the bad record; and a **regression Discovery had introduced**, scoring valuation panels,
ethics assessments and stevedoring as `strong_fit` for roads/engineering firms (migration `0058`).
All four re-run against a fresh `0001`→`0058` scratch-Postgres replay with 0 failures.

Everything before this is in **Detailed pass history** below, each dated entry self-contained
with its own evidence — this line only needs to carry the last few passes, not the whole project
history (trimmed this pass; nothing deleted, just no longer restated at the top every time).

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
(`app/supabase/migrations/`, now `0001`–`0026` plus `0030`–`0045`, `0048`, `0050`, `0051`, `0053`, `0054`, `0055`, `0056` (`0046`, `0047`, `0049` claimed by in-flight worktrees at the time of writing); `0027`–`0029` are claimed by other agents' in-flight, not-yet-committed work) and at `config/klipcorp_profile.json`
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
| National tender discovery (`engine/discovery/etenders_national.py`, `assess_tender.py`, `watch_new_tenders.py`, `company_profiles.py`, `seed_supabase_opportunities.py`) | Pulls OCDS feed; reads each tender's documents once and scores it **separately for every company** (each from its own Experience Library tags, CIDB, B-BBEE, offices - no default/sample profile since 2026-10-17, audit Q4), one `discovered_opportunities` row per company x report-worthy tender with that company's own verdict. Test companies (`is_test_company`) included by default since 2026-10-17 (`--exclude-test-companies`). Seen store: `discovery_seen_releases` (0038, per company x release) in Supabase mode; the local `state/seen_tenders.json` only for a `--profile` run. Since 2026-10-17 (Audit §11): a company whose own profile changed since it was scored (stored `profile_fingerprint` differs) is re-scored and a report-worthy result reported again (`rescored: profile_changed`, `previous_verdict`), its seen row updated in place; an `ERROR` verdict is retried every run and recorded in `system_alerts`. Since 2026-10-18 (`0055`, Audit §11.4): a re-score that makes a verdict **worse** (strong_fit > possible > needs_review > not_a_fit; `discovery_downgrades.py`) is flagged on the company's existing row - "Re-assessed: was Strong fit, now Not a fit as of ...", the reasons it matched before, red when the company is working on the tender, amber otherwise - on /discovery (banner + "Re-assessed" filter), the Workspace's "How this tender was read" card and the Pipeline chip, until a member presses "Mark as seen" (`acknowledge_discovery_downgrade()`); then a small "was Strong fit" marker stays. Carried once in the digest (`reassessed_tenders`: pursued tenders first, to every role; plain-feed ones only where new tenders go). A tender never shown as a match gets no row | `engine/discovery/test_discovery_fanout.py` + `test_discovery_downgrades.py` (CI; Part 2 on a replayed DB): same real tender -> strong_fit / not_a_fit / needs_review for different companies, rows per company, seen rows per company read back, RLS. CLI run twice against the live feed with the DB seen store over a local PostgREST stand-in (Audit §9.2). | `app/app/discovery/page.tsx` reads `discovered_opportunities` and renders the same verdict buckets `assess_tender.py` produces — genuinely wired, not a disconnected feed |
| Government tender sources + listing-change tracking (`engine/discovery/gov_sources.py`, `etenders_portal.py`, `eskom_bulletin.py`, `transnet_etenders.py`, `capetown_procurement.py`, `source_http.py`, `tender_changes.py`; migration `0051`; Discovery page source chips / briefing / "Changed" filter, `app/lib/listingChanges.ts`; digest `listing_changes`) | The watch and the digest now read **every automatable government source** by default (`--sources ocds` = old behaviour): the eTenders portal in full (2,211 open, 408 buyers; replaces the OCDS API, which returned ~300 of ~1,400 releases in a 14-day window - Strategy §10.3), SANRAL's own site (matched to the portal on contract number AND NRA bid number), Eskom's Tender Bulletin (tenders + bidders-list/award/cancellation/validity notices), Transnet eTenders (with addenda links), City of Cape Town RFQs (none on eTenders). Merged to one release per tender (`listing_sources`); a buyer-site tender the portal has moved to Closed is folded in and flagged. `tender_changes.py` records listing-level changes for every tender (not just pursued ones - those are `watch_tender_updates.py`, 0039): cancelled (portal Cancelled tab with reason - OCDS can't show it), buyer site vs eTenders date disagreement, re-listing with a new date, addendum-named documents uploaded after publication, snapshot diffs of closing/briefing/title/documents, Eskom notices. `etenders_national.normalize()` now stores the bid number as `contract_number` (was the portal id); `pursue_discovered_opportunity()` (0051) uses it and only sets `tenders.ocid` for a real OCDS ocid. `award_outcomes.py --source capetown/eskom` | Live 2026-10-17: merged 2,590 tenders (2,540 open) from 415 buyers; SANRAL 72 own open tenders, 69 on the portal's advertised tab + 3 only in its Closed tab with an older date; Eskom 159/180 on portal; Transnet 68/104 matched; Cape Town 0/246. Real changes detected: 55 cancellations in 14 days with reasons, 9 extensions eTenders doesn't show (SANRAL NRA 2026/0754 (A) portal 15 Oct vs SANRAL 6 Nov, 0021 (B), 0062...; 3 Eskom), EC Transport SCMU10 bids re-listed 26 Oct -> 6 Nov, 597 addendum-named late documents on 301 tenders (e.g. WTE1062CE). Cross-run date diff: no edits occurred in the 1-hour re-read window; covered by tests on real rows. `test_gov_sources.py` (CI, offline). `0001`->`0051` replayed: new source values / change types checked, changes readable not writable by `authenticated`, snapshots invisible, pursue on an Eskom-only listing. `tsc`/`eslint` clean; page not rendered against a live project (Gap #9). Gaps: municipalities off eTenders, Gauteng provincial portal, NTCSA bulletin (403) - see the findings doc |
| Award outcomes + competitor bids, report-only (items 17, 28: `engine/discovery/award_outcomes.py`, `test_award_outcomes.py` in CI; `list_tenders.fetch_tenders(list_slug=...)`) | Reads the two public sources that actually carry award data (OCDS `awards`/`contracts` re-confirmed empty on 800 releases, 5 windows): the eTenders portal's Awarded tab (35,316 awards, all buyers: winner, amount, date, enterprise type, some full bidder lists; joins to OCDS as `ocds-9t57fa-<portal id>`) and SANRAL's awarded/closed pages (winner, points, approved amount, award date, and the tender opening register - every bidder and price, per contract on batch tenders). Drops contact people, phone numbers and officials' names at parse time; SANRAL records carry SANRAL's attribution. Writes a JSON report; storing it is `store_award_outcomes.py`'s job (next row) | Live 2026-10-17: portal all buyers 200 read (196 winner, 187 amount, 32 bidder lists, 15 server-broken records skipped individually), SANRAL dept 100/100 winner+amount; SANRAL awarded 69 pages (64 winner+amount, 67 registers), closed newest 60 (48 registers, 4 attachment-only, not fetched). NRA 2026/0084(B) register read correctly incl. Klipcorp's own three prices. Offline test on trimmed real fixtures. Evidence: `Award-Outcomes-Findings.md` |
| Award and price analysis - market feedback on submitted prices (Sarel 2026-10-17; migration `0053` `public_tender_outcomes` + `award_match_keys()` + `tender_market_outcomes()`; `engine/discovery/store_award_outcomes.py`; `app/lib/marketPricing.ts`; Tender Workspace "Market" card `market-context.tsx`; `/pipeline/pricing` "How your prices compared" `market-comparison.tsx`) | One row per real tender from SANRAL's closed/awarded pages + the eTenders Awarded tab (sources merged by SANRAL reference / OCDS id, each source's record kept in `parts`), winner placed in the register (name / awarded amount / first word, basis recorded), scale-free field numbers only where the register supports them, plain-language data notes otherwise (batch, gated, multi-package, typo 5x off the median, non-competitive). Workspace: this tender's register as a strip plot + where the company's price placed (confirmed only on name AND price; name-only, price-only, similar-name shown as "probably you - check"; batch registers read in the recorded price's column), then benchmarks for this buyer + discipline and all buyers + discipline (bidders per tender, lowest won, winner vs median, contract size, winner concentration - counts only, no names; each with its own n, hidden under 5, "thin" under 15). Pricing page: every priced tender with a published result + "firms you have bid against most" (own registers only). **Coverage is thin by nature:** of 1 761 real tenders read, 301 have 2+ priced bids; SANRAL consulting 33 registers / 14 with winner placed; other buyers' eTenders awards 18% priced. Design + caveats: `Award-Price-Analysis-Findings.md` | `test_award_prices.py` (CI; Part 2 on a `0001`→`0053` replay - 0 failures): 9 real records -> 8 tenders, merge, VNA amount match, Klipcorp's real NRA 2026/0084(B) batch prices, 24 real reference formats SQL = Python, matching by OCDS id / reference spacing / `nra_reference`, another company's private tender never matched, read-only for users. TS matching on the same real rows (jiti). Rendered with `next dev` on PostgREST 12.2.3 + RLS holding all 1 761 real outcomes: Klipcorp's real bid 6th of 41 (+4.3% vs lowest, -5.5% vs median). **Not scheduled, no backfill run, not against a live project (Gap 9)** |
| Tender search tags + scope/pricing/BOQ record + value band (Sarel 2026-10-18; migration `0060`; `engine/discovery/tender_enrichment.py`) | Shared `tenders` table (0001) gains `industry_tags`/`discipline_tags` (GIN-indexed `text[]`, for cross-tenant search/filter) computed by a new keyword/rule classifier that reuses `discipline_categories` (0040) as its vocabulary rather than a new taxonomy - group-level slugs (roads_civil, it_telecoms, professional_services, security_facilities, water, buildings, electrical_mechanical and 12 more) become `industry_tags`, child slugs become `discipline_tags`. New `tender_scope_records` table (one row per tender): `scope_summary` (the tender's own description text, NOT an AI/document summary - no summarisation pipeline exists in this repo; narrowed to a document's own "SCOPE OF WORK" heading when document text is supplied), `pricing_model` (keyword match: lump_sum / schedule_of_rates / boq_based / cost_reimbursable / remeasurement / time_based, null when unstated), `boq_summary` (presence-only - `items` is always `[]`: **no BOQ/.xlsm line-item parser exists anywhere in this repo** - checked `engine/discovery/`, `engine/pack_generator/`; `fill_financial.py` explicitly treats the priced BOQ as the tenderer's own business decision, never read from a buyer document; real BOQ extraction needs new document-reading infra, out of scope here), `value_band` (R0-5m/R5-20m/R20-50m/R50m+, set only when the text states a value next to an anchor phrase - "estimated value"/"contract value"/"engineer's estimate"/"budget" - never from a BOQ total (none extracted) or guessed from sector/buyer; null + `value_band_basis='unknown'` otherwise, the honest default for most tenders, which state no value at all). Every field carries its own `confidence` ('heuristic' always in this pass - no document-reading was added) and `source_note`/`value_band_basis` provenance, same confirmed/heuristic discipline as `assess_tender.py`'s CIDB/BBEE signals. Deliberately does NOT touch pricing-engine logic, `marketPricing.ts` or the `0053` outcomes pipeline - that is the next agent's work, on top of this; `tenders.id` is the join key `public_tender_outcomes`/`tender_market_outcomes()` already use, so that work can join straight onto these new columns/table. Batch CLI (`tender_enrichment.py run`), same `RestClient`/env-var pattern as `taxonomy.py sync` - not yet wired into a cron/bridge | `test_tender_enrichment.py` (pure functions, no network/DB): classifier tested against 5 clearly unrelated industries (security guarding, IT/ERP, environmental/EIA, professional-services feasibility study, and roads/civil - civil is deliberately only one of five, not the template) plus a nonsense-text case (tags empty, not wrong); pricing-model keyword cases incl. "no signal -> null"; BOQ detection never populates `items`, from text and from a document filename; value-band null-when-unknown (explicitly checked, incl. an unanchored document-fee Rand amount that must NOT be read as the project value) and correct banding on 4 stated-value cases; scope-summary from description vs. a document's own SCOPE OF WORK heading vs. fully absent. `test_taxonomy.py` re-run clean (classifier reuse didn't regress fit-scoring). Full `0001`->`0060` migration replay on a scratch Postgres (stubbed `auth`/`storage` schemas) - clean create, real insert/constraint/GIN-search check |
| Discovery-time score outlook (`engine/discovery/score_outlook.py`, migration `0013`) | Reads a tender's own document for preference system (80/20 vs 90/10), specific-goals basis, functionality threshold; points only where the profile genuinely answers, price never estimated | Run on 11 real texts + a 25-release live OCDS run; 2 false positives found and fixed. `/discovery` shows the result under each card. Cleanly layered with `sanralScoring.ts` below (its own docstring explicitly defers the detailed functionality estimate there) — checked, not duplicated |
| General (non-SANRAL) SBD form fill (`engine/general/fill_sbd_docx.py`) | Fills SBD1/4/6.1 **`.docx` edition only**, label-matched, refuses PDF/`.doc` | Verified against real downloaded Treasury/RAF samples (see `General-Tender-Engine-Findings.md`); drop-in with `generate_action_checklist.py` |
| CV generation (`engine/cv/generate_cv.py`) + web wiring (`cv_uploads`/`generated_cvs`, migration `0008`) | Builds a real Word+PDF CV in `sanral_keyperson`/`world_bank` formats, summary/detailed, standard/tender-customized (reuses `suggest_pack.py`'s `score_candidate()`, no new matcher). Two real integration points: upload-mode choice (as-is vs. AI-extract) on the People page, "Generate tender-specific CV" action on the Tender Workspace | Generator itself verified against real data (3 real combinations, python-docx + pdfplumber read-back, correctly raised a specialism warning). Web wiring confirmed by grep: both `cv_uploads`/`generated_cvs` inserts are real, not stubs. Fulfilment is deliberately asynchronous — `engine/cv/process_cv_jobs.py` is the bridge, because Vercel can't run Python/LibreOffice. It now runs without a person through the bridge worker (row below), but only once that is deployed. AI extraction: see the next row |
| CV AI-extraction, review-then-confirm (`engine/cv/extract_cv_fields.py`, bridge `cv_extract` in `run_bridges.py`; migration `0023` `cv_extraction_results` + `cv_uploads.extraction_*`; People page review card `app/app/people/[id]/cv-review.tsx`, `applyCvExtraction`/`discardCvExtraction`) | An `ai_extract` upload's text is read (pdftotext / python-docx / LibreOffice for `.doc`, reusing `engine/general/requirements.py`). Scans, images, garbled text and whole tender packs are refused with a reason, with no API call. SA ID numbers are matched and removed locally before the text leaves the machine. One Claude structured-output call (`claude-opus-5-5`, `fallbacks: "default"`) proposes `people`/`projects` fields, each with a verbatim CV quote. Quotes, digits, SANRAL dropdown labels and date precision are re-checked, and anything that fails is left unticked. The People page shows on-file vs from-the-CV per field; only ticked fields are written. Re-upload replaces nothing unticked, likely-duplicate projects are unticked, and standard CV formats are queued at confirm (no longer at upload). `as_is` is untouched | `test_extract_cv_fields.py` (in CI, no secrets): real-format text step on synthetic .docx/.pdf/.doc, every refusal path, ID redaction, validation on hand-written test-double answers (validated against the exact output schema), request shape vs a stub client, queue state machine. Real files: Henning's SANRAL Form B1-B2 PDF read and its ID redacted; 3 real scans refused. `0001`→`0023` replayed with RLS tests. **Never run against the real Anthropic API (no key here) — extraction quality on real CVs is unmeasured** — and never against a live Supabase (Gap #9). Evidence, setup (API key) and cost (~$0.05-0.15/CV): `CV-Extraction-Findings.md` |
| Experience library (`/experience`, `/experience/[id]`, migration `0012`) | Capture + manually tag company past-performance evidence (letters of award, reference letters, completion certificates); `experience_matches()` SQL function for tender-side matching. Discipline tags (since `0040`): Tender Tool's own maintained list, `discipline_categories` (19 groups / 93 disciplines, grouped checkboxes; a group tag or filter covers every discipline in it) plus the company's own tags (`0036`) - see the Discipline taxonomy row | Taxonomy checked by script against real data (`DISCIPLINE_KEYWORDS`, real client/project types all present). Functional SQL tests on a scratch DB confirm filter correctness and tenant isolation (own-company-only rows, rejected cross-company insert, rejected out-of-prefix storage write) |
| Discipline taxonomy - Tender Tool's own, maintained list (audit Q3; migration `0040` `discipline_categories`; `engine/discovery/taxonomy.py`; seed `config/discipline_taxonomy.json`; `app/lib/disciplineTaxonomy.ts`) | What Discovery sorts tenders into and what companies tag experience / price sectors with. Two levels (19 groups incl. the original 7 bucket slugs, 93 disciplines) with keywords/excludes and eTenders / L2B / CIDB cross-references. **Grows without a migration:** a category is a row (`taxonomy.py add`, or SQL as service role); the engine reads the live table whenever the service-role env is present (seed file fallback, also in the worker image), the app reads it per request. `assess_tender.categorize()`/`assess_fit()` match through it (exact / group / broad "check scope"). Since 2026-10-18 (`0058`, regression fix - pass entry below): a whole-group tag covers only the disciplines with `matched_by_group_tag` on (17 off: what the legacy groups gained in 0040 beyond their old bucket, e.g. valuation/management consulting/labs under `professional_services`, rail/ports under `roads_civil`), and a match is `strong_fit` only when the tender doesn't also read as other trades (partly -> `possible`, mostly -> `needs_review`). Review loop: `taxonomy.py coverage <releases>` lists what stayed uncategorised | Built from 2 211 live eTenders tenders + 400 OCDS releases + the 17 samples: uncategorised 66.1% → 2.9% (OCDS 70.8% → 2.8%); 50-tender hand check in `Discipline-Taxonomy-Findings.md`. `test_taxonomy.py` (in CI; DB part on a `0001`→`0040` replay): real descriptions, overlap, verdicts, a table-only row used at once, INSERT/two-level/RLS/price_sector FK. Rendered on real PostgREST + RLS with `next dev` (experience grouped checkboxes + group filter, pricing optgroups). Not against a live project (Gap #9) |
| SACNASP / SAGC person registrations (audit Q5; `0040` `people.sacnasp_*`, `sagc_*`; `app/lib/personCredentials.ts`; `requirements.py find_person_registrations`) | Category / number / renewal date, same shape as ECSA/SACPCMP, all optional. **Shown on the People page only when the person holds it or an open tender's own requirements ask for it** (SANRAL SETUP position naming an Engineering Geologist / Surveyor, or a general tender's `document_requirements.person_registrations`), naming the tender; otherwise behind a closed "add another registration" disclosure. Compliance reads them only for a Geologist (Pr Sci.Nat, valid at closing) or Surveyor (SAGC) position; general workspace lists who holds a required body. Expiry reminders via the same `find_due_person_credentials()` (`TRACKED_PERSON_EXPIRY_FIELDS`) | `test_watch_conditional_registrations.py` (in CI; Part 2 on real replayed rows): SACNASP due in 15 days → renew soon, SAGC lapsed → expired, ECSA-only person → nothing. UI on real PostgREST 12.2.3 + RLS + `next dev`: hidden with no asking tender, shown with "Asked for by R.396-010-2025/1F (DS2)" / a general SAGC tender; R.396 compliance: valid Pr.Sci.Nat → met, lapsing before closing → not met. Real R.396 Book 2/3 text: both bodies detected. No SANRAL form writes these numbers yet (open O3) |
| Tender evaluation compliance report (`app/lib/tenderCompliance.ts`, `app/lib/sanralScoring.ts`, `compliance-report.tsx`, mounted on the Tender Workspace) | Required-documents checklist (Don't have / Confirm by hand / On file), key-people/CV minimums, company-experience match (via the Experience Library), SANRAL functionality score estimate with range bars. The Tender Workspace page now carries a sticky jump-nav (id anchors + a link row under the facts card) since this section stack can run to 10 full-width cards (SANRAL pack and general-pack sections included); the pack link — the page's actual deliverable — is a distinct amber "primary" pill pinned first in the row, not just one more identically-styled link at the end | Run against real Klipcorp vault values and a real `field_provenance.json`, plus edge cases (expired COID shows red, under-10-years fails). Reuses `app/lib/dates.ts`'s `daysUntil` for expiry math rather than reimplementing it — checked, no duplication. Only the SANRAL "Conventional Consultant Tender" family is mapped; others get an explicit "not mapped yet" message. Jump-nav changes are additive/styling-only (id attributes, nav markup, a `variant` prop) — no report/scoring logic touched by either jump-nav pass |
| Tender role catalog + manual role tagging (migration `0016`, People page, `app/lib/tenderRoles.ts`, `app/lib/sanralMatrices.ts`) | 47 roles real tenders ask for: SANRAL's 23 Book 1 codes, with DS split into its 8 specialisms, plus 17 roles from other buyers (contractor key personnel, SACPCMP safety officer, SACAP/SACPLAN/SACPVP/ECSA professionals, trades, PSIRA, pest control). Each role carries its source citation. The company ticks which roles each person's CV fits (`person_role_eligibility`). The compliance report uses that tag for role fit; the C3.1.11 years/ECSA heuristic is now only a cross-check that turns the row amber on a contradiction. All 9 Book 1 project-type matrices are structured data (was 2 hardcoded) | Role-fit cases run on Henning's real record (tagged plus Pr Eng: on file; tagged plus Pr Techni: amber; untagged: amber, naming who is tagged). `0016` replayed with RLS tests: a cross-company tag is rejected by the with-check, an unknown role by the FK. `sanralScoring.ts` output identical to the pre-refactor code on R.396 (24.5 / 13.5 / 44-93). A new DS Structures case was hand-checked |
| Tender-specific experience-evidence rules (`score_outlook.py` `extract_experience_evidence()`, `tenders.evaluation_rules`, `engine/seed_tender_evaluation_rules.py`, `app/lib/experienceEvidence.ts`) | Reads what THIS tender accepts as proof of experience (count, window or "since" year, document types, paired appointment+completion, practical-completion exclusion, consequence, verbatim quote). Shown on `/discovery` and used for the compliance report's B6 / Company experience rows. With no stored rule, it falls back to SANRAL's B6 pattern under an amber "Assumed rule" banner | 12 differently worded real rules extracted correctly (SANRAL x6, DRT x2, Transnet, DPWI, uMlalazi, TNPA x2, LEDA, Overberg, Dawid Kruiper, Sentech). No regression in the existing outlook fields across 38 real texts. **No tender row has `evaluation_rules` stored yet** (no live Supabase); the seed script has only been dry-run on R.396 Book 1, and its JSON stored and read back on the scratch DB |
| Office locations + locality scoring (migration `0015` `company_offices`, Company page, `score_outlook.py` `extract_locality()`/`match_locality()`, `app/lib/locality.ts`) | Structured offices (province, district/metro, local municipality, office kind, proof type/date). Tender locality rows are read as province, district or municipality, as specific goals or functionality, plus mandatory-local-office clauses, and matched against the offices. Shown on `/discovery`, and on the compliance report when the tender's rules have locality rows | Every locality table in 6 real tenders read correctly (DPWI, Cape Winelands, Overberg, uMlalazi, LEDA, Dawid Kruiper). Klipcorp (Gauteng, derived from its registered address) correctly matches none. A test Stellenbosch office gets Cape Winelands' 5. `0015` RLS and the province check were tested on the scratch DB |
| Tender notes + activity log (item 15's comments and "version history"; migration `0033_tender_comments.sql`, `app/lib/tenderActivity.ts`, `activity-log.tsx`, `comment-actions.ts` on the Tender Workspace, jump-nav "Notes & activity") | **Notes:** `tender_comments` (company, tender, author, body, time; plain text, 4000 chars). Any member of the company can add a note on any tender they can see. Only the author can delete one, and nobody can edit one. There are no reactions, @mentions, rich text or threads, per the spec's "Scope discipline". **Activity log:** one newest-first feed that combines the notes with the rows the app already records. Those are task creation and latest update (`tender_tasks`), pack start, latest pipeline move and submitted date (`tender_packs`), key positions confirmed, template uploads (`tender_documents`, `0025`), pack and requirement-reading requests and their results (`pack_generation_jobs`), tender CV requests and results (`generated_cvs`), saved answers and attachments (`tender_answers`), and a manual load. It is a read of existing columns, not a versioning system: no history table, no triggers. `company_member_labels()` (SECURITY DEFINER) returns the e-mail of each member of the caller's own companies, so entries can name who did something; before this, no user display name existed anywhere. Times are shown in SAST. Entries after the first 25 are behind "Show all" | `0001`→`0033` (main + this) replayed on scratch Postgres 16. RLS: another company sees 0 notes, and inserting into another company's tender, writing as another member, or posting on another company's private (`0024`) tender are each refused. An empty body is refused. `author_id` defaults to `auth.uid()`. A member can't delete a colleague's note (0 rows), there is no update (0 rows), and the author can delete their own (1). The labels function returns only the caller's own company's members (none for a non-member). Feed: real staggered actions under RLS (pack start, closing auto-seed, two notes by two users, task add then status+assignee change, stage move, template upload through `record_tender_document()`, pack job and CV request completed by a simulated bridge, 3 answers + 1 attachment, submitted→won, positions confirmed) were dumped with the component's own selects and run through `buildTenderActivity()`. Every action came out in order with the right actor across 7 tables. On the same shared tender, the other company's feed shows only "Another company on this tender uploaded the Technical Submission workbook". `tsc`/`eslint` clean. Not rendered in a browser, never run against a live project (Gap #9) |
| Tender task/deadline timeline + assignee (`tender_tasks`, migrations `0009`/`0011`, `0048`) | Auto-seeded closing milestone (and, since `0048`, a "Briefing session" milestone from `tenders.briefing_date` - see Tender updates; `0048` also fixed the auto-seed itself: the partial unique index couldn't serve PostgREST's `on_conflict`, so the upsert had silently created nothing), free-text manual tasks (no fixed type dropdown, per spec), inline status control, assignee picker (FK to `people`, not `company_members` — that table has no display name and no UI surface at all) | Full round-trip tested on a scratch Postgres replay: insert → assign → join returns real name → delete the person → task survives with `assigned_to` reset to null (not cascade-deleted) |
| Tender pipeline board (item 10: `/pipeline`, `app/app/pipeline/`, `app/lib/pipeline.ts`, migration `0021` `tender_packs.pipeline_stage`) | Kanban of every tender this company tracks, one column per spec stage (found → bidding → submitted → won/lost, no others). Cards show contract no., title, buyer, closing date/days left (or submitted/won/lost date), Discovery verdict chip when the tender came from the scored feed; click → Tender Workspace. Per-card "Start bidding" / "Mark submitted" / "Won" / "Lost" buttons plus "← Back" one step for mis-clicks (no drag-and-drop: nothing in the app uses it). Found = this company's packs at `found` + open SANRAL feed tenders it hasn't touched (first move upserts the `tender_packs` row). History = the submitted/won/lost columns (newest first) + "Submitted to date / Won / Lost" counts; `submitted_at` is kept when a tender moves on to won/lost. One auto-transition: requesting a SANRAL or general pack moves `found` → `bidding` (never backwards, never further). "Pipeline" nav tab next to Tenders; `proxy.ts` guards `/pipeline` | `0001`→`0021` replayed on scratch Postgres 16; on it: first move inserts the pack row (status stays `suggested`), trigger stamps `stage_changed_at`/`submitted_at`, `submitted_at` survives submitted→won, a bad stage is rejected by the check, the auto-advance update leaves a `won` row alone, cross-company insert rejected by RLS, other company sees 0 rows. Page rendered via `next dev` against a fake Supabase HTTP stub with 9 tenders across all stages: right columns, closed-no-pack SANRAL row and another company's general tender correctly hidden, verdict chips joined by ocid/contract no.; the move server action POSTed for real (upsert sent with `on_conflict=company_id,tender_id`, card moved to Bidding; bogus stage → `?error=`). Not run against a live project (Gap #9) |
| Reuse of a past submission (item 9: `app/lib/pastSubmissionReuse.ts`, `reuse-past-submission.tsx` + `reuse-actions.ts` on the Tender Workspace; no migration) | "Start from a previous submission" card, shown while a tender is still being prepared and the company has a submitted/won/lost tender of the same flow (general vs SANRAL), same buyer first. Pick one → server-rendered preview of exactly what carries over and what doesn't (with the reason) → "Use these". **Carries over only what is re-typed per tender today:** general flow `tender_answers` on an explicit allowlist (signatory, SBD 1 foreign-based / accredited representative, SBD 4 employed-by-state, SBD 8 x4; SBD 4 relationship-with-a-buyer-employee only from the same buyer), only where the new tender's own manifest asks the question and never over an existing answer; SANRAL confirmed key-position people, only where the new tender lists the same code **and the same description** (DS1 Pavement vs DS1 Structures is not copied), the person still exists and the position isn't confirmed yet - applied through the existing `confirmPositionPerson()`, so the pack's confirmed status is recomputed by the code that owns the gate, with the clicker as `confirmed_by`. **Never copied:** price, briefing, JV, SBD 4 related-enterprise, SBD 6.1 points, per-tender uploads (path is tender-scoped), any key not on the allowlist (so new engine questions default to not copied), filled forms/pack. Vault, experience, CVs and the SBD 1 company facts (phone/e-mail/CIDB grading, saved to `companies`) were already company-wide - checked in `compliance-data.ts`, `process_general_jobs.py` and `saveGeneralAnswers()`, nothing to copy | `0001`→`0026` replayed on scratch Postgres 16 with **real PostgREST 12.2.3 + RLS** behind a small auth stub, `next dev` rendering the real page and the action POSTed as a no-JS form. Two Cape Town general tenders (real Overberg Q12 manifest from `requirements.py`): 6 answers copied, price/briefing/JV/points/related-enterprise/upload not, a pre-typed answer kept, a question the new manifest doesn't ask skipped, buyer matched across case/whitespace; Transnet target: relationship-with-employee skipped (different buyer); a second preview shows all "already answered". SANRAL won → bidding: PL copied, DS1 (different specialism) and an already-confirmed CE skipped, pack stays `suggested`; won → RRM tender with PL+CE: both copied, pack `confirmed` with `confirmed_by` set. Sources exclude bidding tenders, the target itself and other companies' (user B sees only B's own; a forged source id via URL or POST is refused). Unread manifest / no SETUP positions → explained, nothing copied. `tsc`/`eslint` clean. Not against a live project (Gap #9) |
| Tender deal economics: submitted price, credit, commission + pricing history (items 26, 27: migration `0034` on `tender_packs`; `app/lib/dealEconomics.ts`; "Price & credit" on Pipeline cards, `app/app/pipeline/economics-form.tsx` + `saveTenderEconomics`; `/pipeline/pricing`) | On `tender_packs` (one row per company per tender, same row as 0021's stage, existing tenant RLS): `submitted_price_zar` (nullable, incl/excl VAT flag), `submitted_by_person_id` (FK `people`, not `company_members` - 0011's reasoning; `on delete set null`; a trigger refuses a person from another company), commission as a percentage OR a flat rand amount (check: not both) plus a free-text note, `price_sector` (was the 7 bucket keys; since `0040` any `discipline_categories` slug, FK - grouped select, history rolls a discipline up to its group), `price_note`, `price_recorded_at`. Pipeline cards from Bidding on carry a collapsed "Price & credit" form (summary line shows price + credited person; submitted/won/lost cards with no price show an amber "Record the submitted price"), always editable. Sector is prefilled from Discovery's `categories` for that tender, else roads & civil for a SANRAL family tender. `/pipeline/pricing` (linked from the Pipeline header): own priced tenders, filters tender type (`tenders.family`), client (`buyer`, or SANRAL), sector, outcome; group by any of the three with count / lowest / median / highest / won-of-decided / won value; a banner lists submitted tenders still missing a price; mixed incl/excl VAT rows are flagged. Internal only - nothing reads these columns into a pack | `0001`→`0034` replayed on scratch Postgres 16. SQL as an authenticated member: own update OK; other-company person refused by the trigger; both commission kinds, negative price, >100%, unknown sector each refused by their checks; other company's row updates 0 and stays invisible; deleting the credited person keeps the price and nulls the credit; submitted→won keeps price and `submitted_at`. Rendered with `next dev` against a PostgREST stand-in that runs every query as `authenticated` on that replayed DB (real RLS/trigger), driven in headless Chromium: 7 test tenders (SANRAL Conventional x4, RRM, 3 general across 2 municipalities, one still bidding) priced through the real form/server action, 26/26 checks: Discovery-derived sector prefill (water) and SANRAL default, bad price / bad % → error banner, edit-later overwrites, grouping by type (Conventional 3: R1.25m / R3.85m / R4.2m, won 1/2), client (SANRAL 4, Tshwane 2, Overberg 1) and sector, each filter and a combined one, percent commission worked out, edit from the pricing page returns there, another company's price never shown, no horizontal page scroll at 390px. `tsc` errors only in `private-documents.tsx` (pre-existing on main from `28d8f5d`), `eslint` clean. Not against a live project (Gap #9) |
| Tender updates after discovery: addenda, changed dates, new documents (Sarel 2026-10-17; `engine/discovery/watch_tender_updates.py`, `tender_updates.py`, migration `0039`, `detail.py` "Attached Files", Tender Workspace `tender-updates.tsx` + activity-log entries, digest section `tender_updates`) | Re-checks every tender at least one company is **actively pursuing** (`tender_packs` at found/bidding/submitted - a row only exists once the company acted on it: Discovery "Prepare", a Pipeline move, a manual load; won/lost and feed-only companies are never alerted) against its source: the tender's own OCDS release (stable document ids + datePublished/dateModified; one-day window of the remembered release date, since the API's single-release endpoint answers 500) or SANRAL's page ("Attached Files" names + closing date; files behind reCAPTCHA, so name-only). Known documents in `tender_watched_documents` (first look = baseline, except eTenders documents not in `tenders.document_urls` - added after discovery - which are reported). A new document is downloaded and read with `requirements.read_document` (text, .docx, .doc, zips, OCR for scans) and classified: addendum / clarification / cancellation / revised document / supporting document, with an explicit closing-date change (direction later = "more time to prepare a bid", earlier = critical), a briefing change and other amendment lines, each with its verbatim line. A new closing date is written to `tenders.closing_date`, every company's "Tender closes" task and the Discovery rows **only when the listing agrees**; otherwise recorded and shown side by side (document / listing / on file, flagged) on the card, where a member of a company working on the tender can **accept the document's date** (`accept_tender_update_date()`, `0048`: the same writes, plus who/which company/when recorded on the update and shown on the card and in the activity log). A moved **briefing** date is written to `tenders.briefing_date`/`briefing_time` (`0048`) and every pursuer's own "Briefing session" milestone (`tender_tasks` kind `briefing`, created for each active pursuer; a later joiner gets it on the next run or its first Workspace view) - unless the addendum's "original" briefing date contradicts the one on file, which is then flagged and acceptable by hand like a closing date. Alert report and digest name each company member by e-mail (`company_member_labels()`, answering the service role since `0048`), never by user id. Notified once per company per document (`tender_update_notifications`, DB seen store); `--out` is the per-company alert report (critical first); the daily digest carries the same updates once (`digested_at`). Workspace: "This tender has been updated since it was found" card under the facts card + activity-log entries | **Live, real tenders (2026-10-17):** watch run against the live OCDS API + SANRAL's site on a `0001`→`0040` replay: WTE1062CE / WTE1063CE / WTE1059CE (real addenda added 17 Oct to releases dated 16 Oct, scanned, read by OCR) -> "briefing moved 22 -> 27 Oct" / "21 -> 23 Oct" / "22 -> 27 Oct"; EC Transport SCMU10 real addendum -> closing moved later to Fri 06 Nov 11:00, listing agrees, applied to tender + task + Discovery row (its pre-extension state, 26 Oct, is a reconstruction from the addendum's own text); SANRAL NRA 2026/0756 (C) "Addendum 1 - NW Batch 3 RRM Contractors Signed.pdf" reported by name; second run: nothing. `test_tender_updates.py` (CI): classifier on 7 real texts (contacts removed) + two-fetch synthetic watch run (pursuers only, re-run silent, digest once) + Part 3 on the replayed DB with RLS. Card rendered (jiti + react-dom/server on the live rows, headless Chromium at 390/820 px, no horizontal scroll); `tsc`/`eslint` clean. Not against a live Supabase (gap 9); **not scheduled anywhere yet** |
| Role-based daily digest (`engine/notify/daily_digest.py`, migration `0010`'s `tender_role`) | One filtered digest per person per a 5-role matrix (full_cycle/validator/cv_admin/finance/viewer), reusing `assess_tender.py`, `watch_new_tenders.py`'s constants, and `watch_deadlines.py`'s functions directly rather than reimplementing any of them | Run in `--mode local` against the real OCDS feed + real company profile: 5 correct per-role digests with correct section visibility confirmed by reading the output JSON back. Seen stores in the database since 2026-10-17 (`0041`: `deadline_reminders_seen` consumer `daily_digest`, `digest_readiness_seen`; was `state/seen_digest_readiness.json`). `--mode live` (since 2026-10-17, Audit §9.3): new-tender fit scored per company via `watch_new_tenders.fan_out()` + `company_profiles.py`, every section narrowed to the person's own company - `engine/notify/test_digest_live.py` (CI) plus a CLI run over a local PostgREST stand-in; not against a live Supabase project (gap 9) |
| Document-expiry + tender-task reminders (`engine/compliance/watch_deadlines.py`) | Finds documents/tasks entering their reminder lead-time window, against a seen-store so a given (item, date) only reports once. The seen store is the `deadline_reminders_seen` table since 2026-10-17 (`0041`, per company, consumer `watch_deadlines`; was `state/seen_deadlines.json`) - `test_reminder_seen_db.py` (CI + a DB part). Tracks the six vault expiry columns above (no longer COID-only); the bank letter uses a 30-day lead | Same family/boundary as `watch_new_tenders.py` (report-only, no send); lead times matched to `app/lib/dates.ts`'s existing 60-day threshold rather than inventing a second number for the same concept. **2026-10-17:** now escalates (a document is reported again when it actually lapses, a task when it goes overdue - before, the lapse was silent) and reports documents that lapse before a pursued tender's closing date even outside the 60-day window (`find_documents_lapsing_before_closing`); `test_watch_deadlines_urgency.py` in CI. **Per-person registrations (2026-10-17, item 21, migration `0035`):** `people.ecsa_expiry`/`sacpcmp_expiry` (before, people only had the date each registration was *granted*), scanned across every person in every company by `find_due_person_credentials()` through the same `_expiry_window()` rule and seen-store as the vault documents (no second reminder system); People list/detail show Document-Vault-coloured expiry badges plus a summary chip row; the daily digest routes them to full_cycle and cv_admin (finance excluded, viewer counted). Verified on every committed migration (`0001`–`0026`, `0030`–`0033`, `0035`) replayed: real run 4x reports each item once per window and again on lapse (evidence in the pass entry below); `test_watch_person_credentials.py` in CI |
| Bridge worker: automatic fulfilment of queued CV/pack requests (`engine/worker/`: `poll_loop.py`, `run_bridges.py`, `Dockerfile`; `process_cv_jobs.py --loop`; CI `.github/workflows/bridge-worker-ci.yml`) | One always-on process runs every bridge (`process_cv_jobs.py` now; `engine/pack/process_pack_jobs.py` picked up automatically when it lands at that path with `--once`) every 30 s. A failed poll doesn't kill it, and SIGTERM stops it cleanly. Jobs are claimed atomically (`requested`→`generating` only if still `requested`), so overlapping workers don't double-build. One-shot stays the default. **Built and tested, NOT deployed**: the recommended host is Railway Hobby ($5/mo), and it needs Sarel's own account and the Supabase keys. Steps in `docs/specs/Automated-Fulfillment-Deployment.md` | `engine/worker/test_poll_loop.py` against an in-memory fake Supabase: a job inserted during the sleep is picked up on the next cycle, a failed poll is survived, a pre-claimed row is skipped, SIGTERM mid-sleep exits in under 1 s. The container was built and run locally: real `.docx`+`.pdf` produced inside it, 9 MiB idle. `--once`, `--self-test` and no-credentials output are identical to the pre-change code on the same 3-job queue. Never run against a live Supabase (Gap #9) |
| System alerts: every failure flagged to Sarel (Sarel, 2026-10-17: "A fail must be emailed to me and flagged for me to review"; migration `0042` `system_alerts` + `record_system_alert()`; `engine/alerts/system_alerts.py`, `engine/alerts/check_system_alerts.py`; /admin "System alerts", `SystemAlertRow.tsx`, `markSystemAlertResolved`/`reopenSystemAlert`) | One row per open problem (source, severity critical/error/warning, message, traceback, context such as job/company/tender ids, occurrences, first/last seen, reported, resolved). Not tenant-scoped, owner-only - the `admin_harness_runs` convention (owners read; owners may write only the 3 resolution columns, `resolved_by` pinned to themselves; only the service role inserts / calls the function). A repeat of the same failure (same source + message with ids/numbers blanked) counts occurrences on the open row; after it is resolved, a repeat is a new row. **Wired:** every bridge's job failures (pack, general, cv, cv_extract: crash = error with traceback, a deliberate refusal - confirm gate, unreadable tender - = warning, a job stuck in `generating` = error), the pack bridge's SETUP-read and candidate-scoring failures, a CV whose PDF conversion failed (warning), OCR that broke (Tesseract missing/erroring, page not renderable - not a scan failing the quality gate), Discovery read/scoring errors (and those are now retried next run), any failed poll of a bridge's own `--loop` (`poll_forever(alert_source=...)`), `run_bridges.py` (a pass exiting non-zero or timing out, the runner crashing = critical), `watch_deadlines.py`, `watch_new_tenders.py`, `daily_digest.py` and `watch_tender_updates.py` runs that fail outright (critical), and the tender-update watch's OCDS-day / SANRAL-page read failures. **Reporting:** `check_system_alerts.py` prints and (`--out`) writes what is new since the last check plus already-reported alerts that happened again; its seen store is `reported_at`/`reported_occurrences` on the table. It sends no e-mail - same boundary as the other watch scripts: the scheduled Claude check-in with Gmail access runs it and e-mails the JSON. **Backlog** (not wired): "System alerts backlog" in the 19:00 pass entry below | `engine/alerts/test_system_alerts.py` (CI): real `process_cv_jobs.py --once` and `process_general_jobs.py --once` subprocesses fed malformed jobs -> job failed + alert (source, severity, job id, traceback), the same failure twice = one row with 2 occurrences, `run_bridges.py` over a bridge exiting 1 -> critical worker alert, the checker CLI: run 1 reports 3 new, run 2 nothing, a recurrence once as still_occurring, a resolved alert never again, its recurrence a new row. Part 2 on a fresh `0001`→`0042` replay (with Supabase's default grants in the stub, so the revokes are real): dedupe + severity escalation in the SQL function, owner/non-owner RLS, column privileges, no client insert, `record_system_alert()` not executable by a signed-in user. Over HTTP (PostgREST stand-in on the replayed DB): `run_bridges.py --once` with a CV job whose upload failed and a general job whose documents were unreachable -> both in `system_alerts` through the real RPC; checker run 1 reported both, run 2 nothing. /admin rendered with `next dev` against the replayed DB under RLS as an owner (Chromium, 1280 and 390 px, no horizontal scroll); "Mark resolved" POSTed for real and stored `resolved_at`/`resolved_by`/note. Never against a live Supabase (Gap #9) |
| SANRAL submission pack: one ordered PDF per envelope, plus the inputs it needs (2026-10-17: Key positions confirm control, Blank tender templates upload card, migration `0025_tender_template_uploads`, `engine/print_financial.py`, separate Envelope 2 PDF - see the pass entry below) (`engine/pack/`: `assemble_pack.py`, `pdf_merge.py`, `process_pack_jobs.py`; migration `0017` `pack_generation_jobs`; "Generate submission pack" card on the Tender Workspace, `submission-pack.tsx`) | Runs the real engines in order — `fingerprint.py` check, `fill_conventional.py`/`fill_tender.py`, `print_reports.py` (Forms B1-B2 per slot, B3, B4, B5, B7), `fill_financial.py` (+ hours only from a complete capture), `run_forms_pipeline.py` (C.1.1.1, C.1.2.3, A-Forms, `ACTIONS_TO_SIGN.md`), `fill_authority_letter.py`, `make_envelope_covers.py` — then merges them with the vault documents (0014) and each position's newest ready tender CV, else as-is CV upload, into one PDF. The PDF has an outer cover, a contents page that is also the pack's **checklist** (every document, its pages and its status: Included / INCLUDED - WARNING / NOT INCLUDED + why - see the "Pack checklist" row), "Page X of N" on every page, and bookmarks per envelope and section. The filled `.xlsm` workbooks, `ACTIONS_TO_SIGN.md` and the manifest are uploaded alongside it. The card gates on the compliance report's own gaps (shared loader `compliance-data.ts`). It hard-stops on an unconfirmed position, missing blank templates or a pack already queued, and needs an explicit "generate a draft anyway" tick for any other gap; the gaps shown are stored on the row | Real chain on **real Klipcorp data + the real downloaded R.396-010-2025/1F templates** (local run, not committed: PII): 78 pages, 1-page contents, every contents entry matches its real start page, stamps read back on pages 1/2/41/43/56/58/78, 23 bookmarks resolve to the right pages, Henning's ID on his B1 page. Bridge `process_job()` driven end-to-end against all 17 migrations replayed on scratch Postgres (`engine/pack/bridge_selftest.py`): job `requested`→`ready`, 65-page PDF, `verify_pack()` clean, unconfirmed-position job → `failed` with confirm gate's reason, stale `generating` → `failed`. `0017` RLS: cross-company insert rejected, bad status rejected, other company's storage prefix rejected. Built in the bridge-worker Docker image: a 69-page pack builds inside it. **Never run against a live Supabase (Gap #9)** |
| General (non-SANRAL) tender preparation (`engine/general/requirements.py`, `fill_sbd_docx.fill_sbd_document()`, `build_general_pack.py`, `process_general_jobs.py`, migration `0018`, `general-workspace.tsx`, Discovery "Prepare this tender") | Reads THIS tender's own documents (pdf/docx/doc/zip) into a requirement manifest: which SBD or municipal MBD forms (filled vs by hand), the buyer's own forms, supporting documents with verbatim quotes, roles, CIDB/briefing, scoring, evidence and locality rules, and only the questions its forms need. Workspace shows a checklist vs the vault, inline per-tender uploads, one answers form (company SBD 1 facts saved to the company), and requests a pack: completion guide + filled forms + by-hand editions + buyer forms + vault docs + uploads + accepted experience + tagged people's CVs, merged with `engine/pack/pdf_merge.py` | 25 real non-SANRAL tenders read, 9 committed as `templates/general_samples/`. Fill read-back on 9 real editions (incl. bundles and a converted `.doc`); `test_general_bridge.py` (22 checks, fake Supabase, real documents); `general_harness.py` 9 samples x 3 test companies, expectations + read-back + baselines; `0001`→`0018` replayed with RLS tests. **Flat PDFs (2026-10-17):** `fill_flat_pdf.py` types MBD/SBD 1, 4, 9 and the CIDB Compulsory Enterprise Questionnaire / Form of Offer signatory block onto the buyer's own printed PDF, each value anchored to its label (fixed x/y was investigated and rejected: every municipality lays the form out differently); new manifest status `overlay`, typed copy goes into the pack, every field in `field_provenance`. Verified on 15 real flat PDFs from 14 buyers, every value read back from its own box, pages checked by eye; harness now 11 samples (Overberg, EC Roads PSP added) with `typed_keys`. Never run against a live project (Gap #9). Evidence: `General-Tender-Preparation-Findings.md` (Round 4) |
| Manual tender load + intake for every tender (`/tenders/new`, migration `0024`, `engine/intake/classify_tender.py`, intake step in `process_general_jobs.run_extraction`, "How this tender was read" card `intake-card.tsx`) | A tender found outside Discovery (SANRAL portal, forwarded RFQ, buyer not on eTenders) is loaded with its own documents: browser → Storage (`tender-documents/manual/<company>/<tender>/`, no 4.5 MB cap) → `load_manual_tender()` → **private** tender (`owner_company_id`; tenders/tender_documents/tender_requirements/storage select policies narrowed) + tender_pack + intake job. **Private by default, confirmed (Sarel's decision 3, 2026-10-17)** - and three leaks closed in `0032`, see the "Private documents on a shared tender" row. The intake runs for discovered and manual tenders alike: routes SANRAL vs general by `fingerprint.detect_family()` on an uploaded workbook (SBD presence is deliberately not the signal), registers the 5 SANRAL templates in `tender_documents`, writes SETUP positions (incl. Man/Non-Man) to `tender_requirements`, reports the fingerprint check (never stores it), reads the NRA reference, flags typed-vs-SETUP discrepancies, and writes fit + score outlook (`assess_tender`/`score_outlook` on the documents' text) to `discovered_opportunities` (`source=manual`, `tender_id`). "Add documents and re-analyse" re-runs it | `engine/intake/test_manual_intake.py`: 44 checks on `0001`→`0026` replayed - SANRAL route → 62-page SANRAL pack built by `process_pack_jobs.py` from the manually registered templates, general route, forms-only SANRAL hint, unreadable → job failed with per-file reasons, RLS (other tenant sees nothing, can't write another prefix or the shared bucket area) and RPC guards, add-documents re-route. Real R.396 portal set (15 files) routed and registered correctly; 5 live OCDS releases through the same intake. Not rendered in a browser, never against a live project (Gap #9). Evidence: `Engine-Scenario-Test-Results.md` |
| Pack checklist + expired-document warnings (Sarel's decision 1, 2026-10-17: "Dont include. Add as a warning. With each tender pack you need to create a check of whats included and the status."; `engine/pack/pdf_merge.py` `expiry_warning()`/`checklist`, `assemble_pack.py`, `build_general_pack.py`, `app/app/tenders/[id]/pack-checklist.tsx`, `tenderCompliance.ts` `expiredCopy`) | Every generated pack - SANRAL technical pack, SANRAL Envelope 2, general pack - carries a checklist on its contents page ("SUBMISSION PACK - CONTENTS AND CHECKLIST"): one numbered row per document the pack is meant to hold, in submission order (outer cover included), with pages and a status: **Included**, **INCLUDED - WARNING** (red: in the PDF but must be fixed first - today, a vault copy that is expired or lapses before closing; it IS included, because it is the copy on file and dropping it only hides the problem) or **NOT INCLUDED** (amber, with the reason), plus a one-line summary. The same rows are `manifest.checklist`/`checklist_summary`, rendered on the Tender Workspace under each pack download (both the SANRAL card and the general card; old packs fall back to sections + omitted). One expiry rule for both builders (`expiry_warning`, valid ON the closing day counts, same as `validityAtClosing()`); expired-copy notes moved out of the free-text warnings into their row. `verify_pack()` now also checks the printed warning/not-included rows against the manifest. The compliance report shows "Expired copy in pack - replace" on such rows and the pack card's gap list says so | **Real Klipcorp data, real R.396 templates, real vault PDFs** (local, PII, not committed; R.396's closing moved to 2026-12-15 on the scratch row so Klipcorp's REAL bank letter - dated 2026-09-09, usable to 2026-12-09 - lapses before closing): bridge `ready`, 70 + 29 pages, `verify_pack` clean on both; checklist 22 rows = 17 included, 1 warning ("A18 - Bank confirmation letter: EXPIRES 2026-12-09, before the closing date (2026-12-15) - replace it..."), 4 not included (TCS PIN and ISO: no copy; two CVs); contents page rendered and checked by eye, pages 51-52 read back as the FNB letter and its bookmark points there. `bridge_selftest.py` (synthetic, expired B-BBEE affidavit): `ready`, A12 `included_warning`. `test_general_bridge.py` case 6: a general pack for a company with a lapsed TCS PIN letter - the letter's text IS in the PDF and the contents page reads "INCLUDED - WARNING: EXPIRED 2026-01-31". `general_harness.py` 11 samples x 3 companies with packs: 33 built and read back clean (one transient `soffice` failure re-run clean - host LibreOffice contention, Gap #13). `admin_harness.py --pack`: `complete_co` builds 69 pages, 0 not included; the 3 flags are the pre-existing stale baselines (Envelope 2 split; reworded refusals) |
| Key-position suggestions (Sarel's decision 2, 2026-10-17; migration `0031` `tender_pack_assignments.candidate_scores`/`scored_at`; `process_pack_jobs.py` `sync_position_suggestions()`/`rank_candidates()`; `app/lib/positionSuggestions.ts`; `position-person-select.tsx`; `confirmPositionPerson()`) | No new scorer: every bridge poll runs the existing `suggest_pack.score_candidate()` for every person in the company against every SANRAL position on file (`tender_requirements`, non-ALT) and stores the ranking (score, years, ECSA level, matched/missing specialism words, rationale), writing only when it changed. The Key positions card narrows that ranking to the people tagged for the position's role (`person_role_eligibility` via the same `roleCodeForPosition()` the compliance report uses), shows the best as **SUGGESTED** with a one-line reason ("ECSA Pr Eng, 19 years, matches materials, pavement") and a "Confirm <name>" button, up to 2 alternatives with "Use", and the full dropdown (suggested → other tagged → everyone else; nobody hidden). If nobody is tagged, or a DS has no readable specialism, it ranks across everyone and says so; equal scores are flagged ("put first on years' experience - check which fits better"). On confirm, the server recomputes what was being suggested and stores it in `suggested_person_id/score/rationale`, so `pack_selections.yaml` records "suggested X, confirmed Y" | Real R.396 SETUP (PL, DS1 Pavement and Materials) with Henning (real) + the 3 synthetic test-company people in one company, Nomi untagged: bridge ranking identical to `suggest_pack.suggest()` run directly on the same people (DS1: Pat 7, everyone else 0); the TS `suggestForPosition()` (run with jiti on the stored rows) picks Pat for DS1 ("matches materials, pavement") with Henning and Jordan as alternatives flagged "no evidence of materials, pavement"; second poll writes 0 rows. 8 unit checks (best TAGGED person beats a higher-scoring untagged one, removed people never suggested, everyone-basis, unscored, tie). New `multi_specialist_co` fixture: PL -> Pat Test-ProjectLeader, DS Structures -> Riley Test-Structures. `test_manual_intake.py` updated (the bridge now creates assignment rows before a person confirms - confirms upsert, as the app does) - 44/44 |
| Private documents on a shared tender + manual-tender privacy (Sarel's decisions 3 and 4, 2026-10-17; migration `0032`; `tender_private_documents`; `tender_packs.document_requirements`/`intake`; `process_general_jobs.private_documents_for()`; `private-documents.tsx`, `AddPrivateDocumentsForm`, `addPrivateTenderDocuments()`, `removePrivateTenderDocument()`) | **Decision 4:** on a tender Discovery found (shared, `owner_company_id` null) a company adds its own documents - e.g. the bid document a buyer e-mailed it - under "Your private documents": browser → `tender-documents/private/<company>/<tender>/` → a `tender_private_documents` row (RLS: own company, a shared tender it has a pack for, path under its own prefix - also a CHECK constraint) → a fresh read. The bridge reads the published + private documents into a per-company folder (never the shared download cache) and writes the manifest + intake to **that company's `tender_packs` row**, never to `tenders`, `tender_documents` or `tender_requirements`; the workspace, answers form, intake card and pack builder prefer the company's own reading. Removing the last private document returns the company to the shared reading. Why not `company_id` on `tender_documents`: that table is the per-tender registry of the 5 SANRAL blank templates (shared boilerplate, one row per type); the shared equivalent of a buyer's documents is `tenders.document_urls`, so the private one is a per-company list beside it. **Decision 3 (manual tenders private):** confirmed already private (`0024`), but `0032` closes three real holes found while checking: (a) the `tender-documents` select policy left every non-`manual/` path readable by every user - including a private tender's templates uploaded through the templates card (`<tender_id>/<doc_type>/...`); (b) `tender_packs` insert only checked membership of `company_id`, so a company could open a pack on another company's private tender and then, via `record_tender_document()`, replace its templates and clear its positions; (c) `tenders.ocid` was unique across all tenders, so a private copy holding an OCDS id blocked every other company from pursuing that tender from Discovery (and told them it existed). Now: private tender folders readable only by the owner (`tender_folder_readable()`), restrictive pack policy + visibility check in `record_tender_document()`, OCDS id unique among shared tenders only, and `load_manual_tender()` points a duplicate of a shared tender to "Your private documents" | `0001`→`0026`+`0030`→`0032` replayed on latest main. SQL RLS test with two real companies on the SAME shared tender (both pursued from Discovery → one tenders row): A uploads + records a private document and gets a private manifest; B sees 0 private rows, 0 private storage objects, 0 private manifests while still seeing the shared tender; B can't upload into A's prefix, record a row as A, or point its own row at A's file (CHECK); B's delete removes nothing of A's; B's own private doc is invisible to A. All three holes reproduced on `0001`→`0026` first (B listed A's private template object; B created a pack on A's private tender; B's Discovery pursue failed on `tenders_ocid_key`), then shown closed. `test_general_bridge.py` case 7 (real DSTI SBD bundle as co1's private bid document on an advert-only shared tender): co1's reading finds SBD 1/4/6.1 and its pack fills SBD 1; the shared row's reading (co2's job) has no forms and no private file name or rule; co2's pack has no private reading; nothing in `tender_documents`; a row pointing at another company's folder is refused before download. UI typechecked and linted, not rendered (Gap #9) |
| Admin test-company harness (`engine/admin_harness.py`, item 30) | Runs test companies through the real SANRAL pipeline, flags shape changes vs. stored baseline | Self-verifying by design (3 real bugs caught per its own commit `d86c84e`) — but **SANRAL-only**, see Gaps. `--pack` (opt-in, needs LibreOffice, ~1 min per run) also runs the whole submission-pack chain per test company, including `generate_cv.py`. It reads the PDF back and baselines its shape (`state/admin_harness_pack_baselines/`). Today: `complete_co` builds (71 pages on this host, 69 in the worker image: different LibreOffice/fonts, so baselines are per-environment). `expired_certs_co` and `new_co` are refused by the real filler (`'MO/MA'` is not a Conventional project-type option; ECSA level null), which is recorded as their baseline outcome |
| Admin review console (`app/app/admin/page.tsx`, `HarnessRunRow.tsx`, `actions.ts`, migration `0022`, item 31) | One row per test company × tender × check (`kind`: `forms` = the form-fill check, `pack` = `--pack`). Each opens to the documents that run actually generated, rendered inline (browser PDF viewer in an `<iframe>` on a 1-hour signed URL, plus "Open in new tab"): the filled A-Forms / C.1.1.1 / C.1.2.3 as PDFs, or the merged submission-pack PDF. Also shows the provenance counts and a reviewed / not-reviewed chip with "Mark reviewed" (optional note) and "Undo review". A review survives re-runs with the same result and is cleared by a DB trigger when the result changes. `engine/write_admin_harness_results.py` (now `--pack`) uploads the documents to the private `admin-harness-artifacts` bucket, but only files written by that invocation | Real harness run (`admin_harness.main(pack=True)`) driven through the writer's own `build_rows()` into a scratch Postgres with every committed migration (`0001`→`0022`) replayed (psql upsert on the real `on_conflict` target, run twice: 21 rows, no duplicates). All 57 form PDFs + the 71-page `complete_co` pack resolve to stored objects that are real PDFs (page counts read back, pack byte-identical to the harness output, test company name present in C.1.1.1). `0022` RLS: an owner can set only the 3 review columns (status/artifacts → permission denied, `reviewed_by` = someone else → RLS), a member sees 0 rows/objects and updates 0. The trigger keeps the review on a same-result rerun and clears it on a status or flagged-details change. **Never rendered against a live Supabase** (Gap #9): the iframe embedding of a Supabase signed URL is unverified |
| Company letters & documents: upload your own, or your own guideline (`engine/company_documents.py`, migration `0037` `company_document_templates`, Company page "Letters & documents", `app/lib/companyDocuments.ts`, `saveDocumentTemplate`) | Per company and per document type: **uploaded** (own file, bound in as-is) or **ai_guideline** (own wording with `{{fields}}`, filled verbatim - nothing added; an optional AI placement step is word-checked against the guideline and rejected if it adds anything) or **not set up** (left out, flagged - never another company's wording). Wired for the **letter of authority to sign** (SANRAL A2) in the SANRAL pack; Klipcorp's hardcoded letter wording deleted (audit Q7). Other document types: backlog in the 17:00 pass entry below | `engine/test_company_documents.py` (CI; part 7 on a replayed DB), full R.396 pack before/after on two test companies - see `Hardcoded-Assumptions-Audit.md` §8.3 |
| Directors & shareholders register, registrations catalog, bank accounts, landlord buildings (Sarel's Q-MD1-4; migration `0050`; `/company/principals`, `/company/registrations`, `/company/bank-accounts`, `/company/properties`; `app/lib/principals.ts`, `registrations.ts`, `properties.ts`; `engine/compliance/registration_reminders.py`) | **Register** (`company_principals`): directors / shareholders with ID (Luhn-checked, masked in lists, never sent back to the browser after entry), role, % held, B-BBEE race / gender / disability / military veteran, certified ID copy + certification date, POPIA consent date; 100 % cap and same-company links enforced by trigger; ownership by group (black, black women, women, youth 18-35, disabled, HDI, unclassified) **derived** by the `company_ownership_breakdown` view, with a warning when it disagrees with `companies.black_ownership_pct`. **Catalog** (`registration_types`, 46 seeded, scope company / person / both, companies can add private types) + `held_registrations` (company, person or director; several per holder; certificate upload); expiry reminders through the same `_expiry_window()` / DB seen store (company-held = `document`, person-held = `person_credential` in the digest). ECSA / SACPCMP / SACNASP / SAGC stay on `people` (`stored_in`, reasoning in `Company-Master-Data-List.md` §9.2). **Bank accounts**: owners/admins only (RLS), members see last 4 digits via `bank_account_summaries()`; packs still print WITHHELD. **Buildings** (`company_properties` + `property_documents`): only the fields 4 live lease tenders ask for (§9.3). No engine or pack reads any of it yet | `test_principals_registrations.py` (Part 2 on a `0001`→`0050` replay): 4 synthetic directors/shareholders + a trust → breakdown black 60 / women 60 / youth 40 / disabled 20 / HDI 60 / unclassified 15; 101 % refused; scope refusals (HPCSA on the company, NCCA on a person, SACNASP stored_in, another company's person / private type / folder); 2 SETA accreditations on one company; RLS between two companies on every table; member reads 0 bank rows but the masked summary; reminders on the real rows (4 due, second run silent, seen rows store in 0041). Rendered with `next dev` on real PostgREST 12.2.3 + RLS, Chromium at 390 / 1100 px for owner and member: no horizontal scroll, no 13-digit ID anywhere in any page's HTML, account number only on the owner's bank page; forms driven for real (bad ID refused, 101 % refused, add/edit keeps ID, HPCSA-on-company refused, PSIRA / SACPLAN saved, bank edit with empty number keeps it). Not against a live project (Gap #9); `POPIA-Security-Audit.md` had not landed - re-check against it |
| Company vault (`app/app/company/page.tsx`, migrations `0014`, `0030`) | Company profile plus six tracked compliance documents: COID, SARS TCS PIN, PI insurance, ISO 9001, bank confirmation letter (generated 3-month validity), and B-BBEE proof (certificate or QSE/EME affidavit). Each has an expiry badge and an upload/replace to the private `company-documents` bucket. A chip row at the top now summarizes all six at a glance ("N expired" / "N renewing soon" / "N not on file" / a single "documents current") | Read-only + edit form both real; expiry coloring shared via `app/lib/dates.ts`. `0014` was replayed with functional SQL checks (generated column, check constraint, tenant-scoped update and storage prefix). The upload has never been run against a live project. The summary chip is computed from the same `expiryStatus()` calls the six document rows use — checked, can't drift out of sync. **"How we work" (2026-10-17, `0030` `companies.how_we_work`):** the company describes itself and its approach in its own words, up to 10 000 characters, stored verbatim. This replaces the cut AI-narrative item 16. `0001`→`0026`+`0030` replayed on scratch Postgres 16: multi-line text round-trips exactly, 10 001 characters is rejected by the check, another tenant's update changes 0 rows. Typecheck and lint are clean. Not rendered in a browser. **No engine reads it yet, because no engine produces company prose. See `Company-Voice-Audit.md`** |
| Onboarding (`app/app/onboarding/`) | One field (legal name) → company + owner row, atomically via `create_company_and_join` | Matches spec's "minimum to get started" principle exactly |
| Route guard (`app/proxy.ts`) | Redirects signed-out users to `/login`, no-company users to `/onboarding` | Covers every real app route, including `/experience` (added this round) |
| RLS policy set (`0001`–`0026`, `0030`–`0045`, `0048`, `0050`, `0051`, `0053`, `0055`) + cross-tenant isolation (`0043`–`0045`, `engine/security/test_tenant_isolation.py`, `docs/specs/POPIA-Security-Audit.md`) | Tenant isolation via `is_company_member()`, shared/public tables explicitly marked as such. Since `0043`: same-company triggers on every person/pack reference, storage paths confined to the row's own company folder, `platform_admins` for the admin console, pinned `search_path`. Since `0045`: a company's uploaded blank SANRAL template is its own copy (`tender_documents.company_id`, `tender_requirements.company_id`), only the buyer-published copy registered by the intake is shared; service-role bridges read only the job company's rows, files and templates | `test_tenant_isolation.py` (Part 1 in CI; Part 2 on a fresh `0001`→`0045` replay): 215 pass / 0 fail - RLS on 21 tables, storage per bucket, private tenders, 17 cross-reference probes, the 7 bridge exfiltration paths, shared-template cases 16-17 (before `0045`: 18 fail, incl. B's pack keeping A's projects/referee/SACPCMP number from A's filled workbook and B downloading it from Storage), deletion. `bridge_selftest.py` (full pack from shared templates) and `test_manual_intake.py` (44 pass) on the same replay. Earlier: Internally consistent — every deviation carries its own comment explaining why. No RLS inconsistency found across any pass to date; re-replayed all 25 migrations (`0020` was never a real file — see QA section) against a fresh scratch Postgres this pass, all still apply cleanly. `0026` (unified job queue) replaces `0017`'s "for all" policy on `pack_generation_jobs` with select + strict insert for every engine, keeping update/delete for SANRAL rows only — independently re-tested, not just read: called `pursue_discovered_opportunity()` for real against the replayed schema, confirmed its insert through the `tender_engine_jobs` compatibility view lands in `pack_generation_jobs` with `engine='general'` set by the view's default, and that calling it a second time correctly no-ops via `ON CONFLICT` rather than erroring or duplicating | |
| Free standalone tools: working-day deadline, CIDB grade, B-BBEE preference points (`/tools`, `app/lib/publicHolidays.ts`, `cidbGrading.ts`, `preferencePoints.ts`) | Three lead-magnet calculators needing no sign-in and no company/tender context, per the Solution Architect's TenderFlow gap check. Deadline calculator: add/count working days excluding weekends and SA public holidays (Public Holidays Act 36 of 1994, incl. Easter-derived Good Friday/Family Day, computed per year, not hardcoded). CIDB grade calculator: the published cidb grading-designation value bands (Grade 1-9). B-BBEE preference points: the actual PPPFA/PPR 2022 regs 4-5 80/20 and 90/10 price-points formula plus the SBD 6.1 B-BBEE-level specific-goals table - the first place in the codebase that computes the formula itself (`tenderCompliance.ts` only tracked level/risk conceptually; confirmed by grep before building) | `publicHolidays.test.ts` / `cidbGrading.test.ts` / `preferencePoints.test.ts` (Node's built-in test runner, 26 cases total): holiday table incl. the s2A Sunday→Monday rule, business-day math starting from a non-business day and spanning a year boundary, CIDB boundary values, the regs 4/5 worked example and rounding, the full B-BBEE level table both systems, the R50m system switch and an explicit-system override. `npm run typecheck` and `npm run lint` clean |
| Onboarding document scan: the six previously-orphaned fields now have real homes + a CIDB name-mismatch warning (migration `0069`; `app/lib/onboardingScan.ts`, `app/app/company/document-scan/review.tsx`/`page.tsx`) | Closes the QA thirteenth-run finding (`2d4c124`): `cidb_registration.registration_number`/`contractor_name`, `bbbee_certificate.entity_name`, `bank_confirmation_letter.bank_name`/`account_holder` and `iso_9001_certificate.certified_entity_name` now persist to real `companies` columns (`cidb_registration_number`, `cidb_contractor_name`, `bee_entity_name`, `bank_confirmation_bank_name`, `bank_confirmation_account_holder`, `iso_9001_certified_entity_name`), following the exact Document Vault (`0014`) column-per-document pattern - no new table. Bank fields deliberately stayed on `companies`, not `bank_accounts` (`0050`): that table's `account_number` is `NOT NULL` and the scan never extracts an account number at all, so a row can't be created from `bank_name`/`account_holder` alone. New: `cidbNameMismatchWarning()` compares a CIDB certificate's `contractor_name` against the company's own `legal_name` (legal-suffix-aware normalization, word-overlap threshold) and the review screen shows a red "Name mismatch" banner when they look substantially different - a warning, never a blocker, since a trading name or a genuine rename are both valid reasons. All six fields go through the same ticked/quote-verification gate (`confirmVaultDocument`'s existing generic field loop) as every other onboarding-scan field - no new write path | `node --experimental-strip-types --test app/lib/onboardingScan.test.ts` - 18/18 pass (12 pre-existing + 6 new: the six fields flip from not-persisted to persisted, the real column names, and `cidbNameMismatchWarning` on exact match / formatting-only difference (`"(Pty) Ltd"` added, removed, re-cased) / a real mismatch / missing input / a below-threshold trading-name case). `npx eslint` clean on the changed files; `npm run typecheck` shows only pre-existing, unrelated `general-pack-review-data.ts` errors (confirmed present before this change too). Not run against a live Supabase project (standing Gap #9) |

## In progress / partially built

- **OCR for scanned documents (experimental, 2026-10-17)** — `engine/ocr/scan_ocr.py` (Tesseract 5, local, R0/page, about 3-6 s/page) plugged into `requirements.read_document` (pages with <200 chars of text layer that hold an image) and `extract_cv_fields.read_cv_text` (scanned PDF pages, image uploads). Per-page quality gate; failing pages are refused as before, with the reason. Flagged everywhere: manifest `documents[].ocr` + `from_ocr`, a gap line, the Workspace's blue OCR notice, CV values unticked + OCR banner. Worker image adds `tesseract-ocr(-eng,-osd)`; `OCR_DISABLED=1` switches it off. Measured on the real scans (Tourism NB143, ESKOM annexures + SOW, the B2.1CE certificates) and on text tenders turned into scans (SALB, Dawid Kruiper, Overberg: same manifest apart from overlay → by hand). Known misreads: individual numbers at high confidence ("10HOO", a contract number, a phone number), so it is for finding requirements, not copying values. Not measured: the Claude step on a real OCR'd CV (no API key). Recommendation and removal steps: `docs/specs/OCR-Evaluation.md`.

- **CV AI-extraction** — built end to end (Built table), but it waits on two things Sarel has to provide: an `ANTHROPIC_API_KEY` on the bridge worker (until then AI-extract uploads stay queued and the `cv_extract` pass logs why), and a first measured run on 3-5 real team CVs. Only the text step has met real CVs so far. Scanned CVs are now OCR'd (experimental, see below): every value read from a scan starts unticked; a scan OCR can't read clearly is still refused.
- **Automatic CV/pack fulfilment** — the worker is built and tested (Built table), but nothing runs it until Sarel deploys it (Railway steps in `Automated-Fulfillment-Deployment.md`). Until then, queued requests wait in `requested`, or someone runs `python3 engine/worker/run_bridges.py --loop` by hand. The pack bridge (`engine/pack/process_pack_jobs.py`) has landed at the path `run_bridges.py` expects, with the same `--once`/`--loop` contract. `run_bridges.py --once --bridge pack` drives it, and the worker Dockerfile now installs Calc + `python3-uno` for it.
- **Role-based digest's `--mode live`** — written, reads the real schema shape, but never run against a live Supabase project (none exists in this environment).

## Known gaps (named, not just "incomplete")

1. **General (non-SANRAL) path: closed as a path, narrowed as automation (2026-10-17).** Flat-PDF MBD/SBD 1, 4, 9 are now typed onto the buyer's printed PDF, as are the CIDB Compulsory Enterprise Questionnaire and the Form of Offer signatory block; tenders not on eTenders go in via the manual load (`/tenders/new`, 0024); the two job tables are one queue (`0026`). Still manual, named in `General-Tender-Preparation-Findings.md` "Gaps": flat MBD/SBD 6.1 and 8; any field the overlay couldn't place safely (listed per form in the pack); the human check of every typed page before signing; the remaining buyer forms (certificate of authority, Record of Addenda, ESKOM Form A / declarations / NEC3, consent forms - prioritised backlog, Round 4 Finding 11); MBD 4 3.9-3.14 and its directors table; the SBD 6.1 points table; scanned tenders are OCR'd only experimentally (see `OCR-Evaluation.md` - tables, white-on-black text and handwriting read badly; flat-PDF typing never offered on OCR'd pages); no CIDB registration-number column.
2. **`admin_harness.py` still only exercises the SANRAL path.** Narrowed: `--pack` now covers the SANRAL submission pack end to end, and the tender-customised CV generation inside it. The general engine now has its own parallel harness (`engine/general/general_harness.py`, 9 real samples x 3 test companies, also in CI as `--no-pack` + `test_general_bridge.py`); the CV generator itself still has none, and two of the three SANRAL fixtures stop at the filler (see Built table). A buyer wording variance or a `people`/`projects` schema change could silently break either and nothing would catch it the way SANRAL template changes are caught.
3. **CV AI-extraction: built, unmeasured.** No API key exists in this environment, so Claude's accuracy on real CVs (including the SANRAL Form B1/B2 grid that is the only real team "CV" in evidence) has never been measured, and the live API has never accepted the exact structured-output schema. Scanned CVs are refused rather than read. Other professional bodies (SAICE, SACAP...) are read but have no column to be saved in. Details: `CV-Extraction-Findings.md` §6/§8.
4. **Test-company coverage is 3 profiles, not 4.** The spec's own item-30 description names a 4th scenario — "no confirmed specialist for a position" — with no matching fixture. Low priority, spec itself calls this an open question.
5. **`is_test_company` exists in the schema; nothing reads or sets it yet.** `engine/admin_harness.py` still reads `config/test_companies/*.json`, not a real company row from Supabase — that's a genuine rewrite needing a live Supabase project to build and verify against, not a column add. No UI sets the flag either. Both are named follow-ups, not silently dropped — full history and sourcing caveats in the pass-history section below.
6. **No `people` storage-path column yet for the original uploaded CV file.** `cv_uploads.storage_path` actually covers this now (see Built table) — this gap from an earlier pass is **resolved**, recorded here only so the history entry below isn't mistaken for still-open.
7. **`tender_requirements`' SETUP facts (managerial flag, tender project type, DS specialism description) are unseeded**, except for tenders whose templates went through the intake (manual load, 2026-10-17), which now get SETUP positions, descriptions and the Man/Non-Man flag written to `tender_requirements` from the uploaded workbook; so the SANRAL score estimate is wider than it needs to be, and every DS1 shows role fit as "Confirm by hand" (a DS role can't be matched to a tag without its specialism). `tenders.evaluation_rules` is also unseeded until `engine/seed_tender_evaluation_rules.py --write` runs against a live project. The vault-field half of this gap (TCS PIN, insurance, ISO, bank-letter date, B-BBEE proof) is **closed** by `0014`. Two related items remain: Klipcorp's ISO 9001 certificate number and expiry are still unknown, and CSD registration validity has no column.
8. **Uploads are capped at ~4.4 MB** (Server Action body `4.5mb`, which is Vercel's hard 413 limit) for CVs, experience and the vault. **Narrowed this pass**: the pattern to fix it now exists and is proven — `app/app/tenders/new/manual-tender-form.tsx` uploads straight from the browser to the `tender-documents` bucket via the Supabase client (`supabase.storage.from(...).upload(...)`, RLS-gated by `manualPrefix()`), never touching a Server Action body at all. That's a real answer to "is it worth building" (the open item below) for one path; the other three (CVs, experience, vault) still go through a capped Server Action and haven't been migrated to this pattern yet.
9. **Narrowed 2026-10-18 (`a232e77`, Sarel's own commit — the first human-authored commit in this whole project): a live Supabase project and a Vercel deployment now exist.** Sarel applied every migration through `0062` to the real project and got a green Vercel build, after fixing three build-breaking issues the sandbox's own `next build` had never caught (no Supabase env vars here means those prerender failures never surfaced locally): `/login` instantiating the Supabase client at component-body top level (fails prerender when env vars aren't visible at build time), `/tools/deadline-calculator` reading `new Date()` during render (Next 16 rejects non-deterministic prerender output), and no `engines.node` pin in `package.json`. All three independently re-verified this pass: `npm run build` now completes cleanly end to end in this sandbox too (29/29 static pages, `/login` and all 3 `/tools/*` routes now genuinely static) — the "`/login`'s pre-existing prerender gap" caveat that every single pass's own build verification has carried all session is gone. **What this changes:** nothing built so far has been tested against real Supabase rows, and this pass still has no live credentials to do that itself — scratch-Postgres replay (now through `0063`) stays the verification method here. What it means going forward: the next person with real project access can actually click through the app, and any gap or bug that was "unverified against live rows" throughout this file can start being closed for real rather than only in a replayed schema. Decide, when there's time: should every pass's own verification note explicitly say "schema-replay only, not live" vs. "confirmed on the live project" now that the distinction is real and not purely theoretical.

    **Narrowed further 2026-10-19 (twentieth run): 5 migrations are committed but not yet applied live, and this just caused a real user-facing error.** `0063`–`0066`/`0068` (5 files - `0063` onboarding document scan, `0064` super admin console, `0065` submission/opening reminders + won-project sync, `0066` this session's own trigger-bug fix, `0068` CV/document stats; `0067` was never created, a benign gap) were added after Sarel's `0062` cutoff above and have not been confirmed applied to the live project. Direct evidence, not inference: commit `8146259`'s own message says tonight's live E2E walkthrough hit a raw Postgres error on the Tender Workspace, `column tender_packs.project_completed_at does not exist` - that column only exists from `0065` onward, so the live database is still on `0062` or close to it. The commit fixed the symptom (no longer leaks the raw SQL error to the user - now a generic message + server-side log) but **not the cause**: the won-project CV-sync feature, the super-admin customer/CV-stats console, and the opening-reminder task kind are all still live-broken (or entirely inert) until these migrations are actually run against the real Supabase project. This needs Sarel's own Supabase SQL editor / migration access - no session in this sandbox has live credentials to do it. Nothing here is new schema risk (`0066` already fixes the one bug that would have shipped broken; everything else replays clean on `0001`→`0068` in this pass's own scratch-Postgres verification) - purely an apply-it-live step.
10. **Naming collision risk, not a functional bug: `company_members.tender_role` vs. the `tender_roles` table are two unrelated concepts with near-identical names.** The first (migration `0010`) is a 5-value workflow-visibility role (full_cycle/validator/cv_admin/finance/viewer) — "what sections of the daily digest can this user see." The second (migration `0016`) is a 47-row reference catalog of real tender position codes (PL, CE, DS1 Pavement and Materials, SACPCMP safety officer, etc.) plus `person_role_eligibility` — "which tender positions does this person's CV qualify them for." They're on different tables with no code-level collision (checked by grep: `daily_digest.py` only ever touches `company_members.tender_role`; the role-catalog code only ever touches `tender_roles`/`person_role_eligibility`), built independently by different agents on the same day without either referencing the other. Flagging because a future reader skimming the schema or a future agent extending either feature could easily conflate the two from the name alone. Not renaming either unilaterally — both are already referenced across multiple files (`engine/notify/daily_digest.py` for the first; `app/lib/tenderRoles.ts`, `0016`, `score_outlook.py`, the People page and compliance report for the second), so a rename is a real multi-file change, not a one-line fix — flagging for whoever next touches either feature to pick a clearer name (e.g. `digest_role` vs. `tender_position_roles`) rather than silently leaving two "tender role" concepts in one schema.

11. ~~A hard-killed worker leaves a CV job stuck in `generating`~~ — **fixed this pass.** Migration `0019_generated_cvs_claimed_at.sql` adds `generated_cvs.claimed_at` (set the moment a worker claims a row), and `process_cv_jobs.py` gained `fail_stale_jobs()`, same shape and 60-minute threshold as `process_pack_jobs.py`'s own, called at the top of every `poll_once()`. Verified: migration replays cleanly as part of the full `0001`→`0019` chain; `python3 engine/cv/process_cv_jobs.py --self-test` still passes unchanged; a direct functional test (monkeypatched `supabase_request`, no live Supabase needed) confirmed `fail_stale_jobs()` fails only a job claimed >60 minutes ago and leaves a 5-minute-old job and an unclaimed job alone.

12. **Submission pack — what still stands between it and "no manual input except the tender's own questions":** the three UI/engine gaps named here before (no position-confirmation UI, no template upload, Financial workbook not printed) are **closed** (2026-10-17 pass below). Still open:
    - **The signatory comes from `people.signatory_capacity`** (first person with one set). `fill_docx_forms.py` still writes that one person into both C.1.2.3 key-person rows (pre-existing).
    - **Human-only items stay human**, and the contents pages and `ACTIONS_TO_SIGN.md` list them: signatures, witness, pricing/hours, and the B4/B5 narratives. Because pricing is typed into the `.xlsm` after the pack is built, the printed Financial workbook (and the Form C2.4 FIN copy in Envelope 1) are "as generated" and must be re-printed from Excel once pricing is in - both section titles say so.
    - **Key positions only appear once the bridge has run** (it reads SETUP from the uploaded Technical workbook into `tender_requirements`). Until the worker is deployed, someone runs `process_pack_jobs.py --once`.
    - **`seed_supabase_company.py` doesn't seed `initial_graduated` or any `projects`** for Henning, so a pack built from seeded data alone would stop at `confirm_pack.py`'s gate - real data goes in through the People page.
    - **No automated "pricing guard" scan** (Handover §5) - Envelope 1 is kept price-free by construction (no pricing document is placed in it), not by scanning the output.
    - **`print_reports.Office.__exit__` runs `pkill -9 -x soffice.bin`**, which kills every LibreOffice on the host, including another job's. Seen this pass: one run lost its Financial print to a concurrent process (caught, reported in the pack as "Not included", rest of the pack built). Harmless with one worker; worth scoping to its own PID before running bridges in parallel.

13. **Scenario-pass leftovers (2026-10-17, `Engine-Scenario-Test-Results.md`).** Fixed in the pass: MBD 7.2 misread as MBD 9; advert-only and unreadable tenders declared "uses no standard forms"; corrupt PDFs called "scanned"; a document valid on the closing day shown as "Don't have"; "0 days left" after closing; reminders that never escalated; filler refusals naming a cell instead of the person/field; `print_reports.py` `pkill`-ing every LibreOffice on the host; the worker image missing `fingerprints/` (template check silently skipped in production); `seed_supabase_opportunities.py`'s upsert targeting a partial index PostgREST can't use. Still open: LibreOffice default-profile contention in `generate_cv._convert_to_pdf` / the contents page (loud, transient); discovered tenders keep Discovery's first-document fit verdict; `test_manual_intake.py` needs Postgres so isn't in CI; ~~documents can't be attached to a shared discovered tender~~ (**closed** by `0032`: "Your private documents"); the two `--pack` harness baselines for `expired_certs_co`/`new_co` hold the old refusal wording and need `--pack --reset` once (expired_certs_co now builds - see the hardcoded-assumptions pass).

14. **Company master data: what onboarding should eventually collect.** The spec is `Company-Master-Data-List.md` (2026-10-17). It was built by hand-reading 104 open tenders from 88 buyers (123 sampled; 14 advert-only, 5 unreachable).
    - **85 company-level items:** 13 have a home, 22 are partial, 49 are gaps. Each is cited to the tenders that ask for it and checked against `0001`-`0040`.
    - **The biggest gap:** the schema holds **one director and one ownership %**. Real tenders want a full directors/shareholders register, certified IDs, and ownership by black / women / youth / disabled.
    - **Next gaps in rank order:** CIPC documents and entity type; municipal accounts per company **and per director**; the CSD report file; B-BBEE proof variants (CIPC/dtic certificates, certificate number); the authority resolution in the general pack; CIDB CRS number and multi-class grading; buyer supplier-database registrations; a generic company/person registrations store; public liability insurance; a plant/vehicle register; AFS and turnover.
    - **Ranked list:** §4 of that doc. Nothing is built yet.

15. **Tender regulatory compliance (2026-10-17, `Tender-Regulatory-Compliance-Review.md`).** The Public Procurement Act 28 of 2024 never commenced and was declared invalid by the Constitutional Court on 17 Sept 2026; PPPFA + PPR 2022 remain the law and the product matches them. Open, in priority order: **P0** Klipcorp's QSE sworn affidavit vs SANRAL Form A12 / the amended Construction Sector Code (A12 takes an affidavit only from an EME under R1.8m) - confirm with a B-BBEE verification agency; **P1** SBD 4 directors' tables and default-No declarations (G2), ~~SANRAL Form B7 (G3)~~ **closed 2026-10-18** (migration `0056`, see the pass entry), CIDB grade/class/PE/JV comparison (G5), SANRAL functionality threshold hardcoded to 70 (Book 1: 70/80/85 per tender, G7). Full list: §9 there.

## This pass (2026-10-19, standing QA/robustness review - twenty-second run): `bridge-worker-ci.yml` has been red on GitHub since nearly the start of this project, unnoticed

Orientation: two new commits since the last pass (`6aa0e00`, finishing the cool-white palette
rollout on `/admin`'s CV/document stats cards - independently swept the whole `app/app` tree for
every old hex value afterward, confirmed clean; `2351570`, the `run_bridges.py --script` fix
above). Read both in full, re-ran the relevant test files myself. No issues in either on their own.

**Finding 21 (severe, structural - the single biggest finding of this standing-review rotation
so far): checked `bridge-worker-ci.yml`'s actual run history on GitHub for the first time, rather
than trusting each commit's own "CI clean" claim.** Of the last 15 runs (`mcp__github__actions_list`),
**all 15 showed `conclusion: failure`.** Paged back through the workflow's full history (53 runs):
**52 of 53 failed** - every run from run #2 onward, with the sole exception of run #1 (the very
first commit that created this CI job) and one cancelled run. Every single "CI clean" or "all
tests pass" claim in every commit message and every prior pass entry in this file, for the entire
life of this project's Python engine, was describing a session's own **local** run - the actual
GitHub Actions badge has been red almost the entire time, and nobody - no session, including me
across twenty-one prior passes - had ever actually looked.

Pulled job logs (`mcp__github__get_job_logs`) for failures spread across the whole history and
found **two distinct, unrelated root causes**, both genuine, neither previously diagnosed:

1. **`test_poll_loop.py::test_runner_drives_bridges_and_stops_on_sigterm` - a real race condition,
   fixed and verified.** This test starts two `run_bridges.py` subprocesses against the same fake
   Supabase stub: `p` (a long-interval loop meant only to prove a bridge that exits non-zero is
   logged and survives, started with no `--bridge`) and `p_cv` (a short, tight-window loop with
   `--bridge cv` meant to prove the CV bridge fulfils job `r1`). Before the sibling pass's own
   `resolve_bridge_names` fix (twenty-first run, above) a bare `--script` with no `--bridge`
   resolved to `names=[]` - so `p` ran ONLY the broken script. That fix correctly makes `--script`
   additive, matching this file's own documented contract - but as a direct, unavoidable
   consequence, `p` now ALSO runs every registered bridge on its own first cycle, including the
   real "cv" bridge, racing `p_cv`'s own dedicated cycle for the SAME job `r1` against the SAME
   fake instance. Whichever process's cv-bridge subprocess wins the atomic claim builds it; the
   loser finds nothing and never logs `"cv: [ready] r1"` - the exact assertion this test makes -
   even though `status_of(fake, "r1") == "ready"` (an earlier assertion) still passes, since `r1`
   really was built, just not by the process this test is checking. **Reproduced directly: ~40-57%
   failure rate across 12 local runs before the fix** (confirmed NOT a timing/slowness issue first -
   widening the interval from 2s/2-cycles to 5s/3-cycles made no difference at all, still failing
   with "0 bridge pass(es) with activity" every time, which is what actually pointed at a structural
   race rather than a slow LibreOffice startup). **Fixed** by scoping `p` to `--bridge onboarding`
   (a registered bridge unrelated to CV job state) instead of no `--bridge` at all, so `p`'s own
   cycle never touches `generated_cvs`. **Verified: 20/20 clean runs, 0 failures**, across two
   separate batches, after the fix - versus the measured 40-57% failure rate before it.
2. **`test_extract_cv_fields.py`'s `naledi_cv.pdf via pdftotext -layout` check - diagnosed, NOT
   fixed, flagged honestly.** Separately responsible for several of the 52 failures (seen directly
   in job logs from both the most recent run and one from 2026-10-18, identical failure both
   times). The check asserts specific substrings ("20169999", "University of Cape Town",
   "TMRA/2019/04") survive a DOCX -> LibreOffice -> PDF -> `pdftotext -layout` round trip - **passes
   reliably every time I ran it in this sandbox** (same LibreOffice 24.2.7.2 / poppler 24.02.0),
   so this looks like a difference specific to GitHub's own `ubuntu-24.04` runner image (font
   substitution, a different LibreOffice point release from whatever its own apt mirror resolves
   to that day, or similar) that this sandbox cannot reproduce or iterate against. Not fixed this
   pass - flagged for whoever next has reason to dig into the actual GitHub Actions runner
   environment directly (e.g. by adding a debug step that prints `soffice --version`/`pdftotext -v`
   to a CI run and comparing against this sandbox's versions above).

**Finding 22 (fixed, equally structural): one failing step was hiding ~20 other test files from
ever running at all, not just failing - a second, compounding reason the red streak went
unnoticed.** Pushed the Finding-21 fix and checked the real run on GitHub rather than assuming it
went green (`mcp__github__actions_list`/`get_job_logs`, run id `39237891716`): still
`conclusion: failure` - but this time because `test_extract_cv_fields.py` (cause 2 above, already
known and unfixed) failed, confirming cause 1's own fix is sound. The real discovery was in the
job's step list: `bridge-worker-ci.yml`'s 23 test steps run sequentially in ONE job with no
`continue-on-error`/`if` guards - GitHub Actions' own default is to stop a job dead at its first
failing step and mark every step after it `skipped`. Since the CV-extraction step (step 6 of 23)
has been failing nearly every run since it was added, steps 7 through 26 - the polling-loop test,
taxonomy, award outcomes/prices, both discovery-fanout tests, the daily digest, tender updates,
gov sources, cross-tenant isolation, system alerts, the form-field audit, and more - **have never
actually executed in CI, not failed, never even run**, this entire project's history. Confirmed
directly in this run's own step list: step 7 ("Polling-loop smoke test", the step containing my
own Finding-21 fix) reads `"status":"completed","conclusion":"skipped"` - meaning even this pass's
own verified fix has still never been confirmed by a real GitHub Actions run, only by 20 local
runs in this sandbox.

**Fixed:** added `if: ${{ !cancelled() }}` to every test step in the job (not the checkout/
setup-python/base-install steps, which genuinely must block everything if they themselves fail) -
the standard GitHub Actions idiom for "run this step regardless of an earlier step's failure,
but still let the job's overall conclusion reflect every step's own result." Nothing about any
test itself changed; this only stops one failure from masking twenty others. Documented directly
in the workflow file's own header comment for whoever next reads it. YAML validated
(`python3 -c "import yaml; yaml.safe_load(...)"`) before committing.

**Confirmed on the actual next run (`mcp__github__actions_list`/`list_workflow_jobs`, run id
`39238384524`), not assumed:** for the first time in this project's history, every one of the 23
test steps' own individual result is now visible. Exactly as predicted - step 6
(`test_extract_cv_fields.py`, cause 2) is the only one still red - and, critically, **steps 7
through 26 (the 20 previously-hidden test files, including step 7's own `test_poll_loop.py` - this
pass's own Finding-21 fix) all read `conclusion: success`.** This is the first real confirmation,
ever, that taxonomy, award outcomes/prices, the general engine (both its own test files),
discovery fan-out, discovery downgrades, the daily digest, tender updates, gov sources, company
letters, SANRAL Form B7, cross-tenant isolation, reminder seen-stores, system alerts and the
form-field audit all actually pass on real GitHub Actions infrastructure - not just in whichever
session's own local sandbox last ran them. `container-build` (the separate job) was already
green and still is.

**What this means going forward:** CI for the Python engine side of this project was not a
reliable pass/fail signal for most of its life, for two compounding reasons that are now both
addressed: a real race condition (cause 1, fixed and now GitHub-confirmed) and a CI job structure
that hid every other test's result behind one known failure's "skipped" status (also fixed). One
genuine gap remains open: `test_extract_cv_fields.py`'s LibreOffice-rendering difference (cause 2)
- still unreproducible in this sandbox, still needs someone with direct GitHub Actions runner
access to root-cause. From here on, `bridge-worker-ci.yml`'s step list is a real signal again:
treat a red step 6 as the known, already-written-up issue, and treat a red ANY OTHER step as a
genuine new regression worth investigating immediately, since that is no longer physically
impossible for GitHub Actions to have shown you.

## This pass (2026-10-19, standing QA/robustness review - twenty-first run): `run_bridges.py`'s
own documented usage example silently stopped every real bridge from running

Picked up the sibling pass's "twentieth run" (migration `0068` verification and, importantly,
Finding 20 - migrations `0063`-`0068` aren't yet applied to the live Supabase project, already
confirmed by a real production error; needs Sarel directly, not re-flagging here). Picked
`engine/worker/run_bridges.py` for this run - "worker/job-queue" had only been verified once
before (eighth run, confirming a non-bug), never a dedicated adversarial pass, and it's the one
script every bridge's production job fulfillment depends on (the container's `CMD` is just
`run_bridges.py --loop`).

**Finding 21 (fixed, severe):** `main()`'s bridge-name resolution read `args.bridge or ([] if
args.script else sorted(BRIDGES))`. Giving `--script` without `--bridge` - exactly this file's
own Usage example, `--loop --script engine/some/other_bridge.py` - resolved to `names = []`:
**none** of the 5 registered bridges (`cv`, `cv_extract`, `pack`, `general`, `onboarding`) ran,
directly contradicting the module's own docstring ("and any other one can be added with
`--script PATH`" - added, not "replace everything"). Not live-broken today (production's `CMD`
never passes `--script`), but anyone following this file's own documented example to add a
one-off custom bridge alongside the real ones would have silently stopped all CV generation,
pack generation, onboarding scanning and non-SANRAL extraction, with no error and no alert - just
an absence of log lines. Fixed by extracting the resolution into
`resolve_bridge_names(bridge_arg)` (`bridge_arg or sorted(BRIDGES)`, `--script` no longer
participates in the decision at all) and calling it from `main()`.

**Verification:** reproduced the bug directly against the real `BRIDGES` dict before fixing.
New unit test `test_script_flag_is_additive()` in `test_poll_loop.py`; full suite (5 checks,
including the pre-existing real-subprocess `run_bridges.py` test, which also exercises `--script`
without `--bridge`) passes before and after, same timing. Ran the fixed CLI directly end-to-end
too, not just the unit tests. `test_system_alerts.py` unaffected. Full detail:
`QA-Edge-Case-Findings.md`, "twenty-first run."

## This pass (2026-10-19, standing QA/robustness review - twentieth run): migration 0068 verified, a stale migration-number reference fixed, and a confirmed live/committed schema gap

Orientation: 4 new commits since the last pass (`fd7b9c4` the `--no-fetch-documents` fix,
`edaa9cd` CV/document stats migration `0068` + admin UI, `0f47c70` the full cream→white palette
rewrite across 64 files, `8146259` sign-out + raw-SQL-error-leak fix + 2 leftover cream
`ScrollFade` colors). Independently re-verified `fd7b9c4` rather than trusted: confirmed
`gov_sources.releases_for_watch()` already had a `with_documents` kwarg the digest just never
passed, ran `engine/notify/test_digest_live.py` directly - `0 failure(s)`.

**`0068` (CV/document stats) - set up scratch Postgres, replayed all 68 migrations clean, then
tested the function directly rather than trusting "confirmed no logical overlap" from the commit
message:** a non-admin authenticated user gets no row (correctly gated by `is_platform_admin()`,
same pattern as `0064`); a user added to `platform_admins` gets a row with hand-verified correct
counts (1 CV upload, 2 generated CVs both ready, 2 open tenders with a tender-specific CV, 1 with
`tender_documents` on file, 1 without). No security or correctness issue found in the SQL itself.

**Finding 19 (fixed, minor): stale migration-number reference in `app/app/admin/page.tsx`.**
`edaa9cd`'s own message explains the function was renamed from the originally-authored `0066` to
`0068` mid-PR (another migration had already claimed `0066` on `main` by the time it landed) - but
the renumber only touched the SQL file. The admin page's own code comment and, more importantly,
its **user-facing text on `/admin` itself** ("See migration 0068 for exactly what each number
counts") still said `0066` - which is actually this session's own, unrelated trigger-bug fix.
Anyone who followed that pointer, Sarel included, would land on the wrong file. Fixed both
occurrences; swept the rest of the batch for the same mistake (`grep` for `0066` across
`app/app`), found none.

**Finding 20 (not a code bug - a real operational gap, needs Sarel): migrations `0063`-`0068` are
committed but evidence says not yet applied to the live Supabase project.** `8146259`'s own commit
message reports tonight's live E2E walkthrough hit a raw Postgres error on the Tender Workspace -
`column tender_packs.project_completed_at does not exist`. That column only exists from `0065`
onward; its absence on the live database is direct, first-hand evidence the live project is still
at or near `0062` (the cutoff Sarel confirmed applying, per Known-gaps item 9 above), five
migrations behind what's on `main`. The commit fixed the symptom (no more raw SQL leaked to the
user - generic message + server-side log) but not the cause: the won-project CV-sync feature, the
super-admin customer/CV-stats console, and the opening-reminder task kind are still live-broken or
inert until these are actually run against the real project. Written up in Known-gaps item 9
(narrowed) rather than as a new numbered gap, since it's the same "committed vs. actually live"
distinction that gap already tracks - this is the first concrete, dated confirmation of it since
`0062`. Nothing here is new schema risk on this end (`0066` already fixes the one bug that would
have shipped broken; `0001`→`0068` replays clean) - purely Sarel's own apply-it-live step, which
no session in this sandbox can do without his live credentials.

Full detail of `fd7b9c4`'s own fix: `QA-Edge-Case-Findings.md`, "nineteenth run," entry below.

## This pass (2026-10-19, standing QA/robustness review - nineteenth run): `--no-fetch-documents`
promised "much faster" and quietly wasn't

Picked up the sibling QA pass's own CI work (`app-ci.yml`, built directly off my sixteenth-run
finding about `node --test`'s bracketed-path quirk - now every `*.test.ts` file actually runs in
CI) and picked `engine/notify/daily_digest.py` for this run - "notify" has only had its date-crash
fixes touched before (sixth run), never a dedicated pass, and this script is unusually
heavily pre-tested already (`test_digest_live.py` covers cross-tenant isolation, seen-store
transitions, role filtering), so the odds favoured a real subtle gap over a repeat.

**Finding 19 (fixed, moderate):** `--no-fetch-documents`'s own help text promises "much faster,
useful for a quick local run," but it only ever reached `score_per_company()`'s PDF-text download
used for scoring - `fetch_releases()` called `gov_sources.releases_for_watch(names)` with no
`with_documents` argument at all, so every source's own slow per-release document/detail-page
read (SANRAL's ~85 detail-page fetches at 1s apart, Eskom/Transnet's per-tender document lists)
ran in full regardless of the flag. Not a data-correctness bug - a documented behaviour that
silently never did what it said. Fixed by threading `with_documents` through `fetch_releases()`
into `gov_sources.releases_for_watch()`; updated `test_digest_live.py`'s own stub of
`fetch_releases` (which would otherwise raise `TypeError` on the new keyword argument) and added a
new check proving the flag actually reaches `gov_sources` now, with a spy rather than a read-the-
code assumption. Also traced the role-visibility matrix and every cross-tenant isolation path in
this file closely and found them sound - including confirming the viewer's "most urgent tender
update" summary relies on `pending_digest_updates()`'s own pre-sort by urgency rather than an
unsorted `items[0]`, which would have been a real bug had it not already been pre-sorted.

**Verification:** `test_digest_live.py` - all existing checks plus 2 new ones, 0 failures.
`test_gov_sources.py` unaffected, still clean. Full detail: `QA-Edge-Case-Findings.md`,
"nineteenth run."

## This pass (2026-10-19, standing QA/robustness review - eighteenth run): my own new CI job was red on GitHub from the start - a real root cause, not a flake

Orientation: one new commit since the last pass (`2f3d295`, a jump-nav scroll-affordance fix -
reused `ScrollFade` correctly, added a `hint` prop, scoped its new `position: relative` wrapper to
only the inner scrolling row so the sticky bar's own containing block is untouched). Independently
verified rather than trusted: read the full diff, confirmed the shared-classname media-query logic
in `ScrollFade.tsx` still works correctly with `hint={false}` (both the fade div and the optional
hint div share one class, so the `display: none` rule still hides whichever of them render), ran
`npm run typecheck`/`lint`/`build` and all 82 TS test cases myself - all clean. No issues, no
action needed on that commit itself.

**Finding 18 (fixed, severe - my own CI job from the prior pass has been red since the moment it
existed).** I don't just report on other sessions' work - I check my own. `app-ci.yml` (added last
pass, seventeenth run) had already run twice on GitHub by this pass (triggered by `64a486e` and
`2f3d295`) and **both runs failed**, not the green I assumed. Pulled the actual job logs
(`mcp__github__get_job_logs`) rather than guessing: both failed identically at the `Typecheck`
step with `app/layout.tsx(20,50): error TS2304: Cannot find name 'LayoutProps'.` - the exact error
commit `0a4921b` had called "a pre-existing unrelated LayoutProps error... aside" and every session
since has waved off as noise, never root-caused.

**Root cause, reproduced locally:** Next.js 16's typed-routes feature code-generates the ambient
`LayoutProps`/`PageProps` helper types into `.next/types` only during `next build` or `next dev` -
`tsc --noEmit` depends on that file existing but does nothing to create it. My local "clean
typecheck" claims earlier this session (and, it turns out, everyone else's "pre-existing, aside"
dismissals before this) were against a `.next` directory already populated by an earlier `npm run
build` in that same long-lived sandbox - never a genuinely fresh checkout. Confirmed by `rm -rf
.next && npm run typecheck` locally: reproduced the identical `TS2304` error. A fresh GitHub
Actions checkout has no such leftover `.next`, so my new CI job was red from its very first run,
on both commits it ever saw - exactly the kind of thing this standing review exists to catch,
including in its own output.

**Fix:** `app/package.json`'s `typecheck` script is now `next typegen && tsc --noEmit` - Next.js
ships a dedicated `next typegen` command (`next typegen [directory] [options]`: "Generate
TypeScript definitions for routes, pages, and layouts without running a full build") built for
exactly this, lighter than a full build. This fixes the root cause everywhere `npm run typecheck`
is invoked - local dev, `app-ci.yml`, and `npm run verify` - not just a patch to the CI workflow's
own step order. **The "pre-existing unrelated LayoutProps error" was never actually unrelated or
safe to wave off - it was this fix, undiscovered, the whole time.**

**Verification:** `rm -rf .next && npm run typecheck` - clean, no error (confirmed the fix from the
exact fresh state that reproduced the bug, not from a warm sandbox). Then the full sequence from
the same clean `.next` state: typecheck, lint, `npm run build` (all 3 exit 0), and every one of the
8 `*.test.ts` files run directly (82/82 pass). Pushed (`fcb1b85`) and confirmed on GitHub's own
infrastructure, not just locally: `app-ci.yml` run #3 (`mcp__github__actions_get`,
run id `39209252689`) - `"status":"completed","conclusion":"success"`. The first real green run
this job has ever had, after two straight failures (`64a486e`, `2f3d295`) that I had wrongly
assumed were passing until I actually checked.

## This pass (2026-10-19, standing QA/robustness review - seventeenth run): the app/ half of the codebase had no CI at all

Orientation: one new commit since the last pass (`455d057`, the sixteenth run's own
`staleSyncedProjectRows()` fix). Independently re-verified it before moving on: read
`won-project-sync-logic.ts` and its wiring into `syncWonProjectToTeam()` in full, ran
`won-project-sync-logic.test.ts` directly myself (6/6 pass, not just trusted from the commit
message), confirmed the delete is correctly scoped (the `existingSynced` query it deletes from is
already filtered to this `company_id` + `source_tender_pack_id`, and RLS would block a cross-tenant
delete even if it weren't), and confirmed both the reassigned-away and newly-confirmed person's
`/people/[id]` pages get revalidated. `npm run typecheck`/`lint` clean. No duplication, no overlap,
no gap with my own fifteenth-run work - the sibling pass picked a genuinely different area
(TypeScript action code) and its own write-up correctly cites and confirms the fifteenth run's
`0066` fix rather than re-doing it.

**Finding 17 (fixed): the entire `app/` half of this codebase has never had a CI job.** Checked
directly - `.github/workflows/` holds exactly one workflow, `bridge-worker-ci.yml`, scoped to
`engine/**` only (its own `paths:` filter). Nothing anywhere runs `npm run typecheck`, `npm run
lint`, `npm run build`, or any of the 8 `*.test.ts` files (82 cases total, confirmed by running
every one directly: `pack-review-logic.test.ts` 19, `signatory-logic.test.ts` 10, `won-project-
sync-logic.test.ts` 6, `cidbGrading.test.ts` 5, `preferencePoints.test.ts` 10, `marketTrendLogic.
test.ts` 9, `publicHolidays.test.ts` 11, `onboardingScan.test.ts` 12) anywhere automated - every
"clean" claim in this file for the `app/` side has only ever been a session's own local run.
Compounding this: the sixteenth run's own finding (this environment's Node silently finds 0 tests
for a glob under a `[id]` bracketed directory via `node --test`) means that if anyone ever wired
this up the documented way, 3 of these 8 files - including today's two most recent regression
tests - would silently never run while the job still reported green.

Fixed with a new workflow, `.github/workflows/app-ci.yml`, triggered on push to `main` touching
`app/**`: `npm ci`, typecheck, lint, `npm run build` (confirmed needs no Supabase env vars - same
as every session's own local verification all along), then every `*.test.ts` file found via
`find` (literal paths, not `node --test`'s glob) and run directly with `node
--experimental-strip-types`, failing the job if any one of them fails. No secrets required.
**Verified the job logic itself actually catches a real failure**, not just that it's green by
default: temporarily appended a deliberately-failing test to `cidbGrading.test.ts`, ran the exact
loop the workflow uses, confirmed it printed `FAILED: ./lib/cidbGrading.test.ts` and exited 1, then
restored the file (confirmed via `git status`/`git diff --stat` - no residue). YAML validated with
`python3 -c "import yaml; yaml.safe_load(...)"`.

**Not done (flagged for Sarel):** this only runs on push to `main`, matching the project's
current no-PR-review workflow - it catches a regression after it's already on `main`, not before.
Worth revisiting if/when PR review comes back into the workflow.

## This pass (2026-10-19, standing QA/robustness review - sixteenth run): a reassigned key person
kept a stale "won project" on their CV record forever

Picked up migration `0065` (submission/opening reminders + won-project CV sync) and the sibling
QA pass's own same-day `0066` fix (re-read and confirmed sound - a real, severe RECORD-field bug
in the shared `tt_check_same_company()` trigger, reproduced and fixed with solid Postgres-backed
verification; nothing more needed there). Picked `syncWonProjectToTeam()`
(`app/app/tenders/[id]/actions.ts`) for this run instead - new, writes real CV-feeding history,
and TypeScript/Supabase action code gets far less adversarial coverage than the Python engine
side in this standing review, precisely because there's no live Supabase to run it against.

**Finding 16 (fixed, severe):** the key-person picker (`position-person-select.tsx`) has no
`pipeline_stage` gate - a position can be reassigned to a different person, or un-confirmed
entirely, even after a tender is Won and its project has already been synced to the team's CV
history once. Because the sync's upsert conflict key includes `person_id`, reassigning a position
never updates the old person's row - it only ever adds the new person's row, leaving the old
person's `projects` entry claiming they worked a project they were reassigned off, forever, with
no later re-sync ever correcting it. Fixed by extracting `staleSyncedProjectRows()` into a new
pure-logic file (`won-project-sync-logic.ts`, same testable-sibling pattern as `pack-review-
logic.ts`/`signatory-logic.ts`) and deleting the stale rows before every re-sync.

**Verification:** `won-project-sync-logic.test.ts` - 6/6 new tests pass (first sync, unchanged
re-sync, the real reassignment bug, un-confirming a position, multi-position isolation, a
defensive multi-row case). Also surfaced and documented a tooling quirk: this environment's Node
(v22.22.0) silently returns "0 tests found" for `node --test "path/with/[id]/brackets/..."` - not
a regression, confirmed by re-running the two pre-existing bracketed test files
(`pack-review-logic.test.ts`, `signatory-logic.test.ts`) the same way and getting the same silent
0-tests result; running the file directly without `--test` works on this Node version and all
three suites (19 + 10 + 6) pass. Full detail: `QA-Edge-Case-Findings.md`, "sixteenth run."

## This pass (2026-10-19, standing QA/robustness review - fifteenth run): super admin portal, won-project sync, 12-commit demo-prep batch

Picked up the 12-commit batch landed since the fourteenth run (`f2f8925..7da446f`): super admin
customer/settings console (`0064`), submission/opening reminders + won-project CV sync (`0065`),
auth-page hero copy rewrite, five rounds of UI-trust/polish fixes from whole-app review passes, a
privacy notice, and a "Start free" path on every free tool. 44 files, 2444 insertions / 771
deletions. `npm run build`/`typecheck`/`lint` all clean before and after my own fix below.

**Finding 15 (fixed, severe - a bad migration would have broken nearly every tenant write in the
app):** `0065`'s edit to the shared `tt_check_same_company()` trigger function (originally `0043`)
added `if tg_table_name = 'projects' and new.source_tender_pack_id is not null then` - a combined
condition reading a `projects`-only column off `NEW`. This trigger function is attached, via
separate `CREATE TRIGGER` statements, to a dozen *other* tables with no `source_tender_pack_id`
column at all (`cv_uploads`, `tender_tasks`, `tender_answers`, `financial_captures`,
`generated_documents`, `pack_generation_jobs`, `tender_comments`, `tender_private_documents`,
`generated_cvs`, `cv_extraction_results`, `person_role_eligibility`, `tender_pack_assignments`).
`NEW` is a dynamically-typed `RECORD` there, and Postgres resolves `new.source_tender_pack_id`
against the row's real composite type while validating the combined expression - it does **not**
short-circuit on the false left-hand clause. Reproduced directly: replaying `0001`→`0065` on a
scratch Postgres and running `engine/security/test_tenant_isolation.py` Part 2 crashed on the very
first INSERT into a non-`projects` table sharing the trigger, with `ERROR: record "new" has no
field "source_tender_pack_id"`. This would have broken almost every tenant write path in
production the moment `0065` was applied to the live Supabase project - not a cosmetic bug.

Fixed with a new migration, `0066_fix_tt_check_same_company_record_bug.sql` - a `CREATE OR REPLACE
FUNCTION` restoring the exact same logic as a **nested IF** (`if tg_table_name = 'projects' then
if new.source_tender_pack_id is not null then ... end if; end if;`), the same safe pattern this
very function already uses for every other table-specific field check a few lines below it. A new
migration rather than editing `0065` in place, per this project's own rule against editing an
already-possibly-deployed migration file - `0065`'s DDL itself applied cleanly; only this
function's runtime behaviour was broken.

**Verification:** applied `0066` to the same scratch Postgres, re-ran `test_tenant_isolation.py`
Part 2 end to end - `ALL PASSED`, no crash. Then manually drove the actual security property
(not just "doesn't crash") directly in SQL: a `projects` insert with another company's
`source_tender_pack_id` is still correctly rejected (`23514`, same error message as before); the
same insert with the caller's own company's pack succeeds; an insert into a non-`projects` table
sharing the trigger (`tender_tasks`) no longer throws the RECORD error. `test_gov_sources.py`
re-run clean for safety (unrelated to this fix, confirms the scratch DB wasn't otherwise disturbed).

**Finding 16 (fixed, marketing-policy violation, survived 3 dedicated review passes):** commit
`2572ce6` rewrote the `AuthShell` hero headline (shown on `/login`, `/signup`,
`/forgot-password`, `/reset-password`) to "Find government tenders, build **winning**
submissions, never miss a deadline." `Marketing-Pricing-Strategy.md` §6.3 states explicitly:
"**Don't promise 'win more tenders'**. Promise fewer avoidable losses." Commit `0a4921b` ("Final
polish pass... marketing review findings") touched the very same `AuthShell.tsx` file for a
different line (the proof points) and still left this headline in place, as did the two UI-review
passes before it (`126b2ae`, `f697c08`) - three separate review passes on this exact file, none
of which caught it. Fixed by changing "winning" to "complete" (`build complete submissions`),
matching the house voice the landing page's own hero already uses ("nothing missing, nothing
expired, nothing silently left blank") and the §6.3-suggested framing. Swept the rest of the
batch's public-facing pages (`page.tsx`, `AuthShell.tsx`, all 4 `tools/*`, `privacy/page.tsx`) for
the same and other banned phrases ("win more tenders", "AI writes your bid/methodology") -
nothing else found. `npm run typecheck`/`lint` re-run clean after the one-word fix.

**Everything else in the batch, read in full, no issues found:** `0064`'s admin-portal functions
(every one gated by `is_platform_admin()` or restricted to the one deliberately-ungated
`signups_enabled()` read) - manually verified myself against a replayed scratch DB: non-admin
gets 0 rows / explicit refusal, same user after being added to `platform_admins` gets real data,
removed again reverts to 0 rows. The UI-trust fixes (`126b2ae`: stop leaking raw Supabase errors
and internal pipeline names to customers, add confirm-before-delete on every destructive button;
`f697c08`/`0a4921b`: scroll-fade affordances, de-duplicated polling component now shared as
`AutoRefresh.tsx`) are straightforward, low-risk UI polish - read the diffs, nothing incorrect.
`ff66abc`'s SEO split (`page.tsx` + `*Client.tsx` per free tool) keeps the same client logic
unchanged, confirmed by diff. `c8d6dd5`'s privacy notice states only what `POPIA-Security-Audit.md`
already verified, and is explicit about what's still open (Information Officer, retention period,
hosting region) rather than overclaiming - this narrows Known-gaps item (d) below, not closes it.
`1785f33`'s "Start free" cross-links are inert UI additions, no logic.

Tore down the scratch Postgres database and temp files afterward.

## This pass (2026-10-19, standing QA/robustness review - fourteenth run): 3 new discovery sources
could silently merge an unrelated buyer's tender into theirs

Picked up a large batch landed since the thirteenth run (3 new discovery sources, a super-admin
portal, a landing page, auth-page redesigns) and focused on the 3 new discovery sources
(`sars_procurement.py`, `cidb_tenders.py`, `dbsa_procurement.py`, commit `cace3f7`) - new,
untested by this review, and in `gov_sources.py`'s merge/matching logic, which has already had
real bugs found in it before.

**Finding 14 (fixed, severe):** `gov_sources.py`'s own docstring states the rule: a direct-site
tender only folds into a portal row of the **same buyer**, because reference numbers aren't
unique across buyers. The mechanism (`BUYER_FAMILY`, checked in `_find()`) was correct, but all 3
new sources were missing from it - so for them the buyer check silently skipped entirely (`not
family` is `True` when a source has no entry). Reproduced directly: a SARS tender and an unrelated
department's portal tender sharing a coincidental reference ("RFP14/2026") merged into ONE
release - the SARS tender vanished from the output, and the surviving (wrong) release picked up
the SARS tender's document as if it were its own, with no error and no `source_disagreements`
entry to flag it. Fixed by adding the 3 missing `BUYER_FAMILY` entries. Confirmed the fix doesn't
break the legitimate case (a SARS tender listed on the portal under SARS's own name still folds).

**Verification:** added `test_new_sources_are_in_buyer_family()` to `test_gov_sources.py` -
reproduces both the cross-buyer-must-not-fold bug and the same-buyer-must-still-fold case as
durable regression coverage, plus pins that each new source's `BUYER_FAMILY` pattern actually
matches its own `BUYER` string. Full suite (`test_gov_sources.py`, `test_tender_enrichment.py`,
`test_award_outcomes.py`) clean. Full detail: `QA-Edge-Case-Findings.md`, "fourteenth run."

## This pass (2026-10-18, standing QA/robustness review - thirteenth run): the new bulk onboarding
document scan was silently dropping six AI-read fields on confirm

Picked up migrations `0059`-`0063` (landed by other sessions since the twelfth run) and focused on
the newest, highest-stakes one: the bulk onboarding document scan (`engine/onboarding/
classify_documents.py` + `app/app/company/document-scan/`, migration `0063`) - upload many
compliance documents at once, AI classifies and extracts fields, a human confirms, it's filed
onto an existing table/column. The Python classification side checked out clean (quote
verification, OCR handling, SA-ID redaction all reused correctly from `extract_cv_fields.py`, no
new bugs found).

**Finding 13 (fixed, severe):** `classify_documents.py`'s `KIND_FIELDS` asks the AI for more
fields per document kind than `onboardingScan.ts`'s `VAULT_FIELD_COLUMNS` has a `companies` column
for - `cidb_registration`'s `registration_number`/`contractor_name`, `bbbee_certificate`'s
`entity_name`, `bank_confirmation_letter`'s `bank_name`/`account_holder`, `iso_9001_certificate`'s
`certified_entity_name`. `actions.ts` was already correct (it only ever writes a column that
exists), but `review.tsx` rendered every one of these the same way as a field that really gets
saved: pre-filled, ticked by default, under the single "Confirm and file" button. A reviewer who
confirmed a CIDB certificate's registration number had no way to know it vanished on submit - no
error, no warning, not even a trace in the stored `applied` audit JSON. Fixed by adding
`isFieldPersisted()` to `onboardingScan.ts` (single source of truth, used by both the UI and a new
test) and splitting `review.tsx`'s field list into tick-able "will be saved" fields and a new
read-only "also read from this document - not saved anywhere" block for the rest. No schema
change; flagged as future work that these six fields have no column at all yet (and that a
mismatch between a CIDB certificate's `contractor_name` and the company's own registered name
would be a real compliance signal worth surfacing, not just metadata).

**Verification:** `node --experimental-strip-types --test app/lib/onboardingScan.test.ts` - 12/12
pass (8 pre-existing + 4 new, pinning `isFieldPersisted()` for every real field including the
`bee_level` special case and all six dropped fields). Full detail, including the asked-for-vs-
persisted table: `QA-Edge-Case-Findings.md`, "thirteenth run."

## Quiet check-in (2026-10-18, ~10:20 UTC)

Two new commits, both low-risk, both self-verified already:

- `7cd2c35` - Login's card had a fixed `width: 360` with no `maxWidth`/`boxSizing` fallback and
  no outer padding (Onboarding already had the right pattern); fixed, plus bumped Login/
  Onboarding's inputs and buttons to the 44px `minHeight` used everywhere else. Read the diff in
  full - purely additive style properties, nothing else touched. Re-ran `npm run typecheck`/
  `lint` myself: both clean.
- `fc7f603` - doc-only (`QA-Edge-Case-Findings.md`), no code change. Closes out "Finding 2," a
  gap this standing review had explicitly deferred several passes ago (`sanralScoring.ts`'s
  `estimatePosition()` only ever exercised against one of SANRAL's 8 Design Specialist
  disciplines) - now run against all 8, clean, with two of the agent's own test-construction
  mistakes caught and corrected before being mistaken for engine bugs (worth noting as a
  methodology point, not a product issue). Also confirmed `run_bridges.py`'s `TimeoutExpired`
  handling is correct as written (a `subprocess` quirk that looks like a `str`/`bytes` bug at a
  glance but isn't) - read that reasoning directly, agree with it.

Nothing further needed this pass.

## This pass (2026-10-18, ~08:30 UTC): independent verification of the last 4 commits (the Discovery scoring regression, 2 date-crash fixes, tender-update isolation)

Trimmed this file's own header line (above) down to the last pass's summary - it had grown back
into an append-only log after I flagged it last pass without acting; acted on it this time.

Replayed `0001`→`0058` fresh (49 migrations - `0059`-and-up don't exist yet) and ran every
suite these 4 commits touch:

- **`test_tenant_isolation.py`:** ALL PASSED - reproduces the "216 pass" claim with `0058` in
  the schema too.
- **`test_taxonomy.py` Part 1 (including the new "Part 1b" regression pins) and Part 2 (DB):**
  0 failures both. Worth noting what Part 1b actually re-runs: the exact real-world
  misclassifications named in the commit message - herbicides, due-diligence training, shunting
  torches, a precinct plan, governance training, stevedoring, an ethics assessment, a fire-
  resistance lab test, a valuation panel, strategic advisory - every one now comes back
  `needs_review` instead of the `strong_fit` a roads/engineering company used to get, while the
  genuine fits (architectural PSP, structural engineer, RRM consulting, SANRAL geotech, bridge,
  road rehab) still correctly score `strong_fit`. This is the same kind of silent-wrong-result
  bug as the discipline-fit fix from earlier in this session, just at the opposite end (too
  permissive instead of too strict) - worth remembering both directions exist.
- **The 5 compliance test files + `test_digest_live.py`** (`watch_deadlines_urgency`,
  `reminder_seen_db`, `principals_registrations`, `watch_conditional_registrations`,
  `watch_person_credentials`): 0 failures across all six, confirming the malformed-expiry-date
  fix didn't change any correct behavior, only added the missing guard.
- **`test_tender_updates.py` Part 1 (including the new "Part 2b" isolation test) and Part 3
  (DB):** ALL PASSED. Part 2b's own numbers match the commit exactly - 2 of 4 pursued tenders
  deliberately broken (a malformed document, a simulated DB-write timeout), both isolated with
  one system alert each naming the tender and reason, the other 2 tenders still checked and
  reported, and the skipped one catches up cleanly on the next run.
- **Read the repo-wide date-sweep diff in full** (`604bf6e`): all 4 Python sites
  (`source_http.parse_sast`, `watch_tender_updates._sanral_closing`,
  `process_general_jobs._within`/`_years_before`, `watch_deadlines.find_documents_lapsing_before_closing`)
  follow the same pattern - catch the specific exception, record a named `system_alerts` warning,
  degrade to "skip this one record" rather than crash the batch. The TS side
  (`app/lib/dates.ts daysUntil()`) now returns `null` instead of `NaN` for an unparseable date -
  checked this matters: `NaN < 0` and `NaN <= 60` are both `false` in JS, so `expiryStatus()` used
  to fall through to its last branch and show a malformed expiry as green "Current", the most
  dangerous possible wrong answer for a compliance badge. `python3 -m py_compile` clean on every
  changed engine file; `npm run typecheck`/`lint` clean; `test_general_bridge.py` still ALL
  PASSED.

Nothing found needing a fix. No new gaps opened. Good example this pass of the standing review
working as intended: a real, severe bug (one bad date aborting the whole multi-tenant compliance
run) was caught and fixed by another agent before I ever saw it live, and I confirmed the fix
holds rather than just trusting the commit message.

## This pass (2026-10-18, follow-up to the QA seventh run): per-tender error isolation in the tender-update watch

The seventh run's one named open item is now closed. `watch_tender_updates.run()` looped over every
pursued tender with no error handling, so any exception in one tender stopped the watch for all of
them: a malformed document entry in its OCDS release, a failed database write, or anything else
`check_tender()`/`notify()` didn't expect. Each tender's work now runs in its own `_watch_one()`
inside a try/except in `run()`. A failure records one `error` system alert naming the tender
(contract no., tender id, ocid/slug, source, pursuing companies, with the traceback), writes a log
line, and the loop moves on. The run log ends with "N of M pursued tender(s) failed". Nothing is
lost by skipping: a document that was never saved is new again next run, and `notify()` reports
every saved update not yet reported. Severity is `error`, not `warning`: an unexpected exception
is a real failure under `system_alerts.py`'s own rules, the same as the file's existing OCDS and
SANRAL fetch handlers. `test_tender_updates.py` Part 2b covers it: 4 pursued tenders, with the
malformed-document tender first in the loop and a DB-write timeout on another. Before the fix the
run raised `AttributeError` with 0 of 4 tenders checked. After the fix the run completes, the other
2 are checked and reported to both pursuers, there are exactly 2 alerts, and the next run (DB back)
reports the skipped tender's addendum once. Regression: every discovery/compliance/notify/alerts
test file has 0 failures, and `tsc` is clean. Evidence: `QA-Edge-Case-Findings.md` (follow-up to
the seventh run, Finding 9e).

## This pass (2026-10-18, standing QA/robustness review - seventh run): repo-wide sweep for the malformed-date-in-a-batch bug class

Findings 5, 6 and 8 were the same mistake three times, so this run swept the whole tree instead
of rotating to one engine: every date-string parse in `engine/` and `app/lib/*.ts`
(`fromisoformat`, `strptime`, dates built by hand from regex groups, `.replace(year=...)`
arithmetic, TS `new Date`). Result: 36 Python sites. 27 were already safe: 18 guarded, 6 parse
values the code wrote itself, 3 stale-job sweepers on DB `timestamptz`. **4 were dangerous
(unguarded inside a multi-record batch), all fixed:**
- `source_http.parse_sast()`, US-date branch: one Transnet/Cape Town listing dated `13/45/2026`
  raised out of every feed merge/change loop.
- `watch_tender_updates._sanral_closing()`: one SANRAL page with an impossible closing date
  stopped the tender-update watch for every pursued tender (reproduced end to end on
  `test_tender_updates.py`'s in-memory client: crashed before the fix, all 4 tenders checked
  after).
- `process_general_jobs._within()`: **a tender closing on 29 Feb crashed the general pack job
  with perfectly valid data** (`date.replace(year=...)`). It now matches Postgres' own
  `- make_interval(years)` (28 Feb). A malformed `completion_date` row is now left out with an
  alert.
- `watch_deadlines.find_documents_lapsing_before_closing()`: its own unguarded copy of the
  Finding 8 parse. It now goes through `days_until()`, and a bad tender closing date skips only
  that pack.

Quick class (c) fixes: `generate_cv` crashed (two `TypeError`s) when a tender had no closing date
on file; `sanral_fill.set_date` / `confirm_pack` now refuse with the cell or file named. TS:
**`daysUntil()` showed a malformed expiry as green "Current"** (because comparisons with `NaN`
are false), and `tenderCompliance.yearsCheck()` passed silently on an unreadable graduation date.
Both are now unknown. A secondary scan of `int()`/`float()` on record fields found nothing
dangerous. Regression: every compliance/discovery/general/CV test file, `test_digest_live.py`,
`general_harness.py --no-pack` (44/0/0) and the CV self-test are clean; `typecheck`/`eslint`
are clean. `admin_harness.py` shows 18 FLAGGED both before and after (stale, gitignored local
baselines, not this change). **Still open:** `watch_tender_updates.run()` has no error handling
per tender, so a non-date exception in one tender still stops the watch for all of them. That is
the same bug class in a general form, and it is flagged rather than fixed in a date sweep. Full
evidence: `docs/specs/QA-Edge-Case-Findings.md` (seventh run, Findings 9a-9d).

## Regression found and fixed (2026-10-18, ~07:30 UTC): Discovery called valuation panels, ethics assessments and stevedoring a "strong fit" for a roads/engineering firm (migration `0058`)

**What happened.** The real daily watch (`watch_new_tenders.py --days 5 --sources ocds --profile
config/klipcorp_profile.json`) returned 13 report-worthy releases for Klipcorp, **all 13 scored
`strong_fit`**, and 11 of them were plainly wrong for a roads / civil / engineering-PSP firm:
herbicides & pest control, a due-diligence training course, railway shunting torches & latex
gloves, municipal-governance training, stevedoring, ethics risk assessments, a fire-resistance lab
test, a valuation panel, a "bankable business case" advisory partner, and two precinct plans. Only
the architectural PSP (SCMU5-26/27-0007SB) and the Sentech structural engineer (RFX 60000003737) were
real fits. Sarel was about to get that e-mail. This is the failure the `REPORT_WORTHY_VERDICTS`
safeguard in `watch_new_tenders.py` exists to prevent ("trains the reader to stop opening it"), and
it got through because the verdicts became *more* permissive, not because the safeguard moved: these
weren't `needs_review` noise leaking into the e-mail, they were genuine `strong_fit` verdicts.

**Root cause (traced per release, reproduced on the live feed).** Commit `a9a5364` (0040, the
discipline taxonomy) kept the 7 old bucket keys as **group** slugs so old tags still resolve, and
`Taxonomy.overlap()` treated "company tagged with a group" as an exact match for **every**
discipline in it. Two groups grew far past what their old bucket meant:
- `professional_services`: the old bucket was 4 engineering-PSP keywords (`professional service
  provider`, `consulting engineer`, `design specialist`, `psp`); the group now holds 13 disciplines,
  including property valuation, management consulting (which matches "ethics", "governance", "risk
  assessment"), laboratories (fire-resistance tests), feasibility/research/advisory ("due diligence",
  "bankable", "business case") and town planning ("precinct plan").
- `roads_civil`: gained `rail_infrastructure` ("railway" -> shunting torches) and
  `ports_marine_works` ("stevedor*").

Klipcorp's profile (and any Experience Library item tagged before 0040) carries exactly those two
group tags, so every tag silently widened. Measured on the 2 211 tenders live on eTenders today
(metadata level): **456 strong_fit for Klipcorp** (21%); the pre-taxonomy code gave 223 strong_fit
and the new code gives 126. The remaining bad match (herbicides **on roads**) is a second, older
weakness the widening made visible: any one overlapping category gave `strong_fit`, even when the
tender also read as three other trades (pest control, gardening, transport) - the pre-taxonomy
matcher called this one `strong_fit` too.

Checked and ruled out, with evidence:
- (b) the eTenders-category cross-read (`8c12431`) does **not** reach the verdict: `assess_fit()`
  takes categories / signals / depth / profile only, and re-scoring all 100 live releases with the
  real site category, none, "Civil engineering" and "Services: Professional" changed 0 verdicts. (The
  portal reader does pass the site category as `procurement_category`, which only labels an
  *uncategorised* tender `uncategorized_<x>` - verdict `needs_review` either way.)
- (d) the portal-read coverage work (`924813b`) doesn't touch title/description used for matching
  (the 13 came from the OCDS-only path anyway).
- (c) generic keywords did contribute (consulting_engineering's bare "multidisciplinary" matched
  artists and health & wellness; "civil engineer*" matched contractors' "civil engineering works";
  buyer names like "Roads Agency Limpopo" / "Department of Roads and Transport" read as road works;
  "George drainage area" read as stormwater) - fixed below, but these were not the main cause.
- Per-company fan-out (`f85d889`, `4a24b31`): same `assess_fit()`, so the same regression - any
  company whose Experience Library items are tagged with a whole group got the same widening (and
  the Experience Library page told users "ticking a whole group matches every discipline in it").

**Fix.**
1. `discipline_categories.matched_by_group_tag` (migration `0058`; seed field `group_tag_match`):
   off for the 17 disciplines each legacy group gained in 0040 that its old bucket never covered
   (rail, ports; town planning, environmental, surveying/GIS, valuation, feasibility/advisory,
   management consulting, laboratory, project/programme management; water meters; plumbing,
   demolition, fencing; fire protection, pest control, gardening). A company tagged only with the
   group now sees those as `needs_review` ("tick the discipline itself if you do this work"), never
   `strong_fit`/`possible`; a company that ticked the discipline itself is matched as before. The
   12 groups added in 0040 keep every discipline on (no older tags to widen). It is data: an admin
   can flip it on `/admin/taxonomy` (new checkbox), the engine reads it on the next run.
2. `assess_fit()` (`taxonomy.fit_overlap()`): a match is only `strong_fit` when nothing else the
   tender reads as is outside the company's disciplines. Partly the company's work -> `possible`;
   mostly another trade -> `needs_review` ("herbicides on roads, pest control and fumigation" is pest
   control). Two exceptions keep genuine fits strong: another discipline of the same group is the
   same field (routine road maintenance also reads as road construction), and when the company's
   match is a built-environment professional service, the construction-works categories (those with
   CIDB classes) are the project it is for (architectural PSP *for* a renovation). A tender known
   only at group level that also reads as another trade -> `needs_review`.
3. Keyword precision on the categories above (same edits in the seed and in `0058`, written as array
   edits so admin changes survive).
4. UI wording: Experience Library says which disciplines a whole-group tick does not cover ("tick on
   its own"); the "All of ..." box is now "Whole group: ...".

**Proof on the real data.** Replay of the same live window (100 OCDS releases + their documents,
snapshotted) through the unchanged and the fixed code via `watch_new_tenders.fan_out()`:

| Release | Before (HEAD `c852990`) | After |
|---|---|---|
| 174041 herbicides on roads / pest control / fumigation | strong_fit | needs_review (mostly other trades) |
| 174423 two-day due-diligence training | strong_fit | needs_review (feasibility - not covered by the group tag) |
| 174432 railway shunting torches & latex gloves | strong_fit | needs_review (rail - not covered) |
| 174443 / 174446 precinct plans (N14, R380) | strong_fit | needs_review (town planning - not covered) |
| 174454 (and the re-advert 174403) municipal-governance training | strong_fit | needs_review |
| 174458 stevedoring container services | strong_fit | needs_review (ports - not covered) |
| 174483 ethics risk assessments | strong_fit | needs_review |
| 174491 fire-resistance test | strong_fit | needs_review (laboratory - not covered) |
| 174517 valuation panel | strong_fit | needs_review (valuation - not covered) |
| 174519 strategic advisory / bankable business case | strong_fit | needs_review |
| **174193 architectural PSP, Somerset East** | strong_fit | **strong_fit** |
| **174473 structural engineer, Bloemfontein OC roof** | strong_fit | **strong_fit** |

Report-worthy: **14 -> 2** (the 13 of the original run plus 174403, a second municipal-governance
release that was posted after it). Across the 2 211 live tenders, Klipcorp's report-worthy count went
456 -> 186, and the 186 are road / bridge / stormwater / earthworks works and consulting-engineering /
architectural PSP tenders (read through by hand; the residual noise is listed under limits below); for other tag shapes: a `road_maintenance`-only company
keeps 43 strong fits (its 10 lost ones are lab-equipment "ad hoc maintenance", plant hire, a
consulting-engineering tender for a contractor), `consulting_engineering` 27 strong. The exact live
command, re-run after the fix against the live feed (fresh `--seen-store`, see limits; the OCDS API again
stopped at 100 releases with an HTTP 500 on page 2, same window as the original run): **2 report-worthy - the
architectural PSP and the structural engineer, both `strong_fit`**; the other 11 of the original 13 all
`needs_review`; window totals 80 not_a_fit / 18 needs_review / 2 strong_fit. Its `--out
/tmp/new_tenders_today.json` now holds those 2.

**Regression suite** (fresh replay `0001`->`0058`, 50 migrations, Supabase auth/storage stub):
`test_taxonomy.py` 121 PASS incl. the new Part 1b (every release above verbatim, the genuine
roads/geotech/bridge/RRM-consulting fits, the keyword fixes, and the same through
`profile_from_company_rows()` -> `fan_out()` - the path the real app uses) and Part 2 checks that the
replayed table matches the seed exactly and an admin flip takes effect; `test_discovery_fanout.py`
50, `test_discovery_downgrades.py` 39, `test_tenant_isolation.py` 216 - all pass; every CI Python
suite passes; `npm run typecheck` / `lint` clean. `test_manual_intake.py` has 2 failures that are
**pre-existing and unrelated** (identical on the unchanged code: its SANRAL pack fixture predates the
Form B7 requirement from `defe346`, and its "shared SANRAL tenders" check needs `seed_tenders.sql`).

**Honest limits / follow-ups.**
- `state/seen_tenders.json` already holds these 14 releases (with the old verdicts) from the
  morning's run, so the daily command with the default seen store reports nothing new for them -
  neither the 12 wrong ones nor the 2 genuine ones. The re-run above used a fresh seen store. A
  scoring-logic fix does not change a profile fingerprint, so it never triggers a re-score by itself;
  in Supabase mode (not live yet, Gap #9) a fix like this would leave existing wrong rows in place -
  worth a scoring-version in the fingerprint before go-live (then `0055`'s downgrade flag would mark
  them).
- A tender known only as "professional services" in general (no specific discipline recognised)
  still comes out `possible` for a company tagged with that group (6 of the 2 211 today, half of them
  genuinely PSP panels) - left as is, flagged.
- Goods supply for road works (asphalt, road-marking paint) reads as `possible` for a roads-tagged
  company: the profile has no "we are a consultant, not a supplier/contractor" field.
- Why the QA passes missed it: `test_taxonomy.py` asserted "a company tagged with a group matches
  every discipline in it" as intended behaviour, and no check ever scored a whole live window for a
  real profile and read the result. Part 1b now pins the real cases.

## Quiet check-in (2026-10-18, ~06:20 UTC)

One new commit: `2d4c40f`, sticky jump-nav added to the Person detail page (same proven pattern
as the Tender Workspace page's own jump-nav). Read the diff in full - the only non-additive part
is the "which sections are shown" filter being hoisted out of its section's own IIFE into one
shared `catalogBodiesShown` computation the nav and the section both read, so the two can't drift
out of sync; everything else is new JSX (anchor pills, `id` attributes on existing headings).
Re-ran `npm run typecheck`/`lint` myself: both clean. No data or logic path touched.

**Noted, not acted on:** this file's own header line (just above) has grown into exactly the
append-only narrative this file's "Convention" section warns against repeating - each pass
keeps prepending another clause rather than folding the old ones away. Flagging it rather than
unilaterally rewriting a long-lived shared header mid-pass; worth a dedicated trim (collapse
everything older than the last 2-3 passes into "see Detailed pass history below") next time
nothing else is competing for attention.

## Quiet check-in (2026-10-18, ~04:15 UTC)

One new commit since the last pass: `353c725`, already thoroughly self-documented (its own
"standing QA/robustness review - fifth run" entry below, `QA-Edge-Case-Findings.md` Finding 7) -
a `.docx` tender document renamed to `.pdf` got a correct, specific unreadable-document reason
from `requirements.py` but a different, misleading hardcoded "likely a scanned image" message
right next to it in the same intake result's fit section. Fix threads the real per-document
reason through instead; the verdict itself was never wrong, only the explanation. Read the diff
in full (small: an optional `documents=None` parameter, backward-compatible at both call sites
and the CLI) and re-ran independently: `test_general_bridge.py` still ALL PASSED,
`python3 -m py_compile` clean on all three changed files, `npm run typecheck`/`lint` clean.
Nothing to add - well-scoped, well-verified, no new migration, no new gaps.

## This pass (2026-10-18, ~02:30 UTC): independent verification of 11 commits (cross-tenant isolation through `0057`, principals/registrations/bank accounts, taxonomy admin) + one test-script fix

11 commits since the last check-in, 18.5k lines. Replayed `0001`→`0057` fresh (49 migrations;
`0046`/`0047`/`0049`/`0052` were never used - confirmed via `git log --all`, the same benign
numbering-race pattern as `0020`/`0027`-`0029` before) and ran every new/extended test suite
against it:

- **`engine/security/test_tenant_isolation.py` (now 331 lines larger - cases 16-17 added for the
  shared-blank-template fix, `5523221`'s follow-up `8254fb5`):** ran clean on the first try this
  time - **ALL PASSED**, reproducing the commit's own "215 pass / 0 fail on 0001->0045" claim and
  extending it through `0057`. Getting this clean on the first attempt (vs. needing two rounds of
  stub fixes last pass) confirms the scratch-DB recipe `POPIA-Security-Audit.md` now documents
  (minimal auth/storage stand-in, Supabase's default privilege grants applied *before* replaying
  migrations, service_role/anon/authenticated roles) is the right one - worth keeping as the
  standard recipe for every future pass rather than rediscovering it.
- **New suites, all run against fresh, dedicated scratch databases** (one per test, per the
  lesson from the last pass): `test_sanral_b7.py`, `test_form_field_audit.py`,
  `test_discovery_downgrades.py` (Parts 1+2), `test_award_prices.py` (Parts 1+2),
  `test_gov_sources.py`, `test_key_person_minimums.py`, `test_principals_registrations.py`
  (Parts 1+2 - including the bank-account masking RLS: a plain member reads 0 unmasked account
  numbers, sees only a last-4-digits summary, and can't write one) - **all 0 failures.**
- **Found and fixed a real gap in my own scratch-DB stub**, not a product bug: `authenticated`/
  `anon` never had `USAGE` on schema `auth` (Supabase grants this by default so `auth.uid()` can
  be called from `SECURITY INVOKER` functions, not just from policies owned by a `SECURITY
  DEFINER` wrapper). Surfaced as "permission denied for schema auth" in `test_taxonomy.py`'s new
  admin-approval function (`0054`, correctly `security invoker` since it must run as the calling
  admin, not bypass their own checks). Added the grant to the stub recipe; now passes.
- **Found and fixed one real gap, in a test script this time** (not the product): same test
  file's `price_sector: a legacy group value` case assumed a `tenders` row already existed from
  seed data that a plain migration replay never creates. Fixed with a 4-line guard (insert one
  minimal tender if none exists) mirroring the same file's own pattern for `companies` two lines
  above - `engine/discovery/test_taxonomy.py`. Verified: 0 failures after the fix.
- **Duplication/overlap check:** the new governed discipline-taxonomy catalog (`0040`/`0054`)
  explicitly reconciles with `0036`'s earlier free-form company tags rather than replacing them
  (`Discipline-Taxonomy-Findings.md` says so directly) - already handled by the building agent,
  nothing to fix.
- Regression: `test_general_bridge.py` still ALL PASSED. `npm run typecheck` / `npm run lint`:
  clean.

Nothing else found needing a fix. No new product bugs - both issues this pass were in
verification tooling (mine and the test file's), caught and corrected before reporting anything
clean.

## This pass (2026-10-18): SANRAL Form B7 - Targeted-Enterprise subcontracting, answered by the company (migration `0056`)

Closes `Tender-Regulatory-Compliance-Review.md` G3 (P1). Sarel: *"B7 must be answered by the company."*

**When B7 applies - evaluable today, no contract value needed.** The product captures no contract value anywhere (no column, OCDS value deliberately unused) - and doesn't need one: every SANRAL Technical workbook carries its own **category** (`SETUP!L1` "App. D Category of Tender": 1 < R6m, 2 R6-25m, 3 > R25m) **and SANRAL's policy matrix itself** (`SETUP!J27:L35`, category x EME/QSE/Generic -> YES/NO, applied by the template's own `K38` formula to `TEND 1X!H34`). Verified on all 6 committed samples (R.334 = 2, the rest = 3, identical matrix = Policy Annexure 3), on the live **N.011-010-2027/1F** (category 3; its Book 1 B7 page: *"Minimum sub-contracting requirement for all Entities is 30%"*) and on Klipcorp's own real RRM submission (category 1, QSE -> B7 completed: 1 TE "to be identified after award", EME, 30%, 100%, L1). A tender's own Book 1 can still waive it (R.396: *"No sub-contracting requirement ... form B7 is not required"*, though its workbook says category 3) - Book 1 isn't uploaded, so the company records that waiver itself, quoting the text. Category not read yet, or company size (`companies.status`) not EME/QSE/Generic -> **"unknown", treated as required (ask, never skip)**.

**Built:**
- `engine/sanral_b7.py`: `read_setup()` (category + matrix from the template), `applicability()` (waived / not_required / required / unknown), `check_plan()` (errors block; warnings: < 30% total, TE not 51%/L1-2 per Books 2&3 Clause 1, unnamed TE, local share < 1/3), `fill_b7()` (all 4 TE blocks, rows 3906-3936 + count form control `D3904` + comments `B3940`; percentages as fractions, as Klipcorp's real workbook holds them). `fill_conventional.py` / `fill_tender.py` use it when the pack carries `tender.subcontracting_plan` (legacy single `targeted_enterprise` still honoured).
- Migration `0056`: `tenders.sanral_b7_setup` (service-role written) + `tender_subcontracting_plans` (one row per company x tender: `mode` subcontract | waived_by_tender, `waiver_quote`, `targeted_enterprises` jsonb <= 4, `comments`; RLS tenant isolation + own trigger refusing another company's private tender; checks: waiver needs a quote, subcontract needs >= 1 TE).
- Bridge (`process_pack_jobs.py`): `sync_b7_setup()` each poll (re-reads when the workbook is replaced); `gather()` **hard-stops** when B7 applies/unknown and there's no answer, or the answer is invalid - same as an unconfirmed position. `assemble_pack.py`: Form B7 included from the plan (row warning when the plan has warnings; "sign with each TE" note), else **NOT INCLUDED with the reason** (`not required - Category 2 ... QSE`, or the quoted Book 1 waiver, or `REQUIRED but not answered`); `manifest.form_b7` records it.
- Tender Workspace: "Form B7" card (`subcontracting-plan.tsx`, client form `subcontracting-plan-form.tsx`, `b7-actions.ts`, shared loader `b7-data.ts`, rules `app/lib/sanralB7.ts` = Python mirror) - applicability + reason, the capture (1-4 TEs with every field Form B7 asks, or the waiver quote), errors/warnings. Submission-pack card and `requestSubmissionPack()` block on the same `blocker`; plan warnings count as gaps needing the "draft anyway" tick.
- `harness_pack.py` gives R.396 its real Book 1 waiver; other samples now list B7 as "REQUIRED but not answered" (their stored pack baselines will show that change - expected).

**Verified:** `engine/test_sanral_b7.py` (new, in CI): category/matrix from all 6 samples, 15 applicability cases, fill read-back incl. form-control selection, 5 invalid plans refused. Python/TS rules compared on 23 shared cases: 0 differences (incl. warning text). Live N.011 template: category 3 -> required for every size; plan filled and printed via `print_reports.py` (rendered page checked). `bridge_selftest.py` (extended) on all migrations replayed: no answer -> job **failed** with the B7 reason; `sanral_b7_setup` read from the uploaded workbook; R.396 waiver -> ready, B7 "not included" with the quote; 2-TE plan -> ready, 63-page pack, B7 on p63 (rendered), 18 filled cells read back exactly. `test_tenant_isolation.py` ALL PASSED (+ B's pack reads B's own B7 answer, not A's). `test_system_alerts.py` 0 failures. RLS/constraints on `0056` (10 cases). UI on real PostgREST + RLS + `next dev` + Playwright: unknown -> blocker; real `sync_b7_setup` -> "Required"; invalid save refused with reasons; 20% plan saved with below-minimum warning, blocker gone; 2nd unnamed TE -> 30%; waiver saved; 390px no horizontal scroll. `tsc` + `eslint` clean.

**Open:** (1) the pack also needs each TE's B-BBEE proof / proof of address and a duplicate B7 signed by both parties - listed as a pack warning, not collected; (2) "TE may hold max 6 concurrent SANRAL projects" and "no shared equity with the tenderer" (Policy 4.6.24) are not checked - they need the TE's own records; (3) `companies.status` is free text - a company with no EME/QSE/Generic recorded is always asked for B7 (Master-Data / Q-R2 sector-code fields would sharpen this).

## This pass (2026-10-18): Sarel's answers to taxonomy O1, O2, O4, O5 (migration `0054`)

Evidence: `Discipline-Taxonomy-Findings.md` §8; summary in `Hardcoded-Assumptions-Audit.md` §12.

- **O1 - buyer's eTenders category:** Discovery carries the buyer's own eTenders category per tender (from the portal rows `etenders_portal.py` already reads; `etenders_national.fetch_site_categories` joins it onto OCDS-only runs by the ocid's site id) and stores it with a cross-check against Tender Tool's categories (`discovered_opportunities.etenders_category`, `etenders_category_check`: agrees / differs / generic / unmapped). Shown on Discovery; never used by the verdict. Live: 295/300 releases matched; over 2 211 tenders 54.8% agree, 25.2% catch-all, 20.0% differ.
- **O2 - `/admin/taxonomy`:** platform admins (0043) add / edit / retire shared categories (RLS insert/update policies, no delete, no third level); companies suggest their own experience tags ("Suggest this as a shared category" on an Experience item -> `discipline_category_suggestions`, pending); the admin approves (category created under the same slug via `approve_discipline_suggestion()`) or rejects with a note.
- **O4 - the other councils:** SACAP / SACPLAN / SACQSP / SACPVP / PSIRA asked for only when a tender asks - detected by `find_person_registrations()` (definitions/statute tables skipped), shown as a People-page card, checked by the compliance report, all on the **0050 registrations catalog** (`held_registrations`) - no new `people` columns; reminders are the catalog's.
- **O5 - per-tender C3.1.11:** `engine/discovery/key_person_minimums.py` reads the tender's own minimum-requirements table into `tenders.evaluation_rules.key_person_minimums` (`seed_tender_evaluation_rules.py --document <Book 1> --document <Book 2/3>`, or the manual-load intake); the compliance report uses it and falls back to R.396's table only with an "Assumed rule" banner. Also fixed: `seed_tender_evaluation_rules.py` imported a function `seed_supabase_opportunities.py` no longer has, so `--write` crashed.
- **Verified:** `test_key_person_minimums.py` 36/36 (both real SANRAL tables cell by cell); `test_taxonomy.py` 87/87 incl. Part 3 on a fresh `0001`->`0054` replay; browser end-to-end (Playwright + `next dev` + PostgREST 12.2.3 + RLS) 23/23; compliance logic 11/11; corpus registration detection (123 tenders) hand-checked; regression: `test_principals_registrations.py`, `test_watch_conditional_registrations.py`, `test_discovery_fanout.py`, `test_manual_intake.py`, `test_tender_updates.py`, `test_general_bridge.py`, `general_harness.py --no-pack` (see the commit); `tsc --noEmit` and `eslint` clean.
- **Needs once:** Sarel's account in `platform_admins` (SQL editor) - same as `/admin` since 0043.
- **Open:** O3 (SACNASP/SAGC on the SANRAL forms); N1-N5 in the findings doc §8.6.

## This pass (2026-10-18, ~01:15 UTC): a downgrade after a re-score is flagged (migration `0055`)

Sarel's answer to the 19:00 pass's open question ("stale Discovery rows after a downgrade - remove or mark?"): *"When evaluation downgrades opportunity it must be flagged."* Not removed, not left stale. Full write-up: `Hardcoded-Assumptions-Audit.md` §11.4. Files: `0055_discovery_downgrade_flag.sql`, `engine/discovery/discovery_downgrades.py` (new), `watch_new_tenders.py`, `seed_supabase_opportunities.py`, `daily_digest.py`, `test_discovery_downgrades.py` (new, CI), `app/lib/discoveryReassessment.ts`, `app/app/discovery/downgrade-flag.tsx` (new), `discovery/page.tsx`, `discovery/actions.ts` (`acknowledgeDowngrade`), `tenders/[id]/intake-card.tsx`, `pipeline/page.tsx`.

- **What was wrong:** `fan_out()` only returned report-worthy results, so a re-score to `not_a_fit` never reached the seeder and the company's row kept saying "Strong fit"; a re-score to `possible` overwrote the verdict with no trace.
- **"Downgrade"** = a strictly worse fit verdict, strong_fit > possible > needs_review > not_a_fit (the order `assess_fit()` decides them in). `closed` and `ERROR` are never downgrades. Compared against **the row the company was shown**, not the seen store, so strong_fit -> ERROR -> not_a_fit is still caught.
- **Engine:** `fan_out()` adds `company_reassessed` (re-scored, no longer report-worthy) per release; the CLI prints a "re-assessment(s) now WORSE" list and marks a report-worthy downgrade. The seeder reads the existing row first: on a downgrade it writes `downgraded_from` / `downgraded_at` / `downgrade_cause` / `reasons_before` (new reasons in `reasons`); an open flag keeps its original "was" through a further drop; a recovery to at least "was" clears it; a not-report-worthy result only ever updates an existing row (never invents a `not_a_fit` row).
- **App:** card banner (danger `#FEE2E2`/`#B91C1C` when the company's pack is at found/bidding/submitted - "You are working on this tender (bidding) - check whether it is still worth pursuing"; warning `#FEF3C7`/`#B45309` otherwise), "was Strong fit" struck-through chip, "Why it matched before", **Mark as seen**; page-top notice + "Re-assessed" filter; unseen downgrades sorted first. After "Mark as seen": "Re-assessed 18 Oct 2026, 03:08: was Strong fit, now Not a fit · marked as seen by you on ...". The same banner on the Workspace's "How this tender was read" card; the Pipeline card chip "⚠ Re-assessed · was Strong fit".
- **Seen/acknowledged:** reused the 0048 accept pattern (a SECURITY DEFINER function checks membership and records who/when; `discovered_opportunities` stays service-role written) and the 0039 `digested_at` idea for the digest. No new mechanism.
- **Digest:** `reassessed_tenders` section, each downgrade once (`downgrade_digested_at`), not at all once marked seen in the app. Pursued ones first, urgency high, to every role (like a tender update); plain-feed ones to full_cycle (and viewer as a count) only.
- **Verified:**
  - `test_discovery_downgrades.py`: 0 failures. Part 1 (CI): the order and flag rules, and `fan_out()` on the real TN051 PDF (guarding company loses its security tag -> `company_reassessed` strong_fit -> not_a_fit). Part 2 on a fresh `0001`→`0055` replay: two security companies get TN051 as strong_fit, one pursues it (`pursue_discovered_opportunity()` + Bidding, under RLS); both profiles change; only they are re-scored; **both rows flagged** with was/when/cause/reasons-before; the never-matched company still has no row; strong_fit -> possible (upsert path) flagged, a further drop keeps "was strong_fit"; digest items pursued-first (high, bidding), the validator of the pursuing company gets it, the feed-only company's validator doesn't, viewer gets the count, carried once; acknowledge: own member yes (who/when kept on a second press), other company "not found", never-downgraded row refused, direct UPDATE 0 rows, anon has no execute; acknowledged ones not digested; recovery clears the flag.
  - Real PostgREST 12.2.3 + RLS + `next dev`, signed-in cookies, headless Chromium at 390 and 1280 px (no horizontal scroll): the pursuer's /discovery shows the red banner on TN051 ("You are working on this tender (bidding)"), the page notice "including 1 you are working on", next to a never-a-fit row ("NEVER-1 Not a fit", no marker) and a plain "Possible"; the feed-only company sees the amber version. "Mark as seen" clicked for real -> the row then reads "Re-assessed ...: was Strong fit, now Not a fit · marked as seen by you on 18 Oct 2026, 03:11", DB `downgrade_acknowledged_by` = pursuer_owner@. Workspace "How this tender was read" shows the banner + "was Strong fit"; Pipeline chip "⚠ Re-assessed · was Strong fit".
  - Over HTTP: `seed_supabase_opportunities.py` through PostgREST flagged both paths (PATCH for `company_reassessed`, upsert for strong_fit -> possible); `daily_digest.py --mode live` built `reassessed_tenders` for pursuer_owner + pursuer_validator (high, bidding), feed_owner (info), none for feed_validator; the second run carried 0.
  - Regression on the same replay: `test_discovery_fanout.py` Part 1+2, `test_tender_updates.py` Part 1-3, `test_digest_live.py`, `test_tenant_isolation.py` Part 2 - all pass. `tsc --noEmit`, `eslint .` clean.
- **Open (new):** see §11.4 of the audit - (1) should a downgrade on a pursued tender also go out in the watch's own immediate alert (today: printed + in `--out` for Sarel, and the next digest for the company); (2) a flag never expires on its own - it stays until someone marks it seen; (3) "Mark as seen" is company-wide (one member's press clears the banner for everyone in that company), like the 0048 accept.

## This pass (2026-10-18): POPIA / cross-tenant audit follow-up - shared blank templates

**Gap closed (the one the 2026-10-17 audit left open, high priority):** a tender had ONE set of blank SANRAL templates (`tender_documents`, one row per type) that every company pursuing it downloaded and built its pack from, supplied by whichever company uploaded first (0025). Nothing checks a file is really blank. Reproduced: company A's workbook filled by the real `fill_conventional.py` and registered as A's upload; B's pack job downloaded it, and B's real fill on top of it kept A's projects 2-3, A's referee + phone and A's SACPCMP number (B overwrote only name/ID); B could also download A's file straight from the `<tender>/<type>/` Storage folder, and the old code mixed copies the other way too (A's pack used B's upload).

**Fix (`0045_company_template_copies.sql`), and why:** per-company copies, not a "looks blank" check. A blank check only sees the cells the fillers write, is evadable, can't detect an altered blank, and would need the Python fillers in the Vercel upload path; and the "first uploader saves everyone a download" convenience *is* the cross-tenant channel, while every bidder has to download the documents from SANRAL anyway (and be on its addenda list). Now `tender_documents.company_id` / `tender_requirements.company_id` (null = the buyer-published copy registered by the intake - still shared; set = that company's own, only it sees/uses it; a company with its own positions stops seeing the shared ones, in RLS via `tt_has_own_requirements()`). `record_tender_document()` takes only `private/<company>/<tender>/templates/<type>/...` and touches only the caller's copy/positions; the 0025 insert policy on the shared tender folder is dropped; pre-0045 and replaced uploads still sitting there are hidden by `tt_template_object_readable()`; `tender_document_uploads()` returns `own`/`buyer` and no longer reveals another company's upload. Existing company-uploaded rows (and positions read from them) become that company's copy. Bridges: `process_pack_jobs.template_paths()` (own, else shared, never another's), per-copy `sync_tender_requirements()`, per-company positions in `sync_position_suggestions()` and `process_cv_jobs`; intake writes shared rows explicitly. App: upload to the private folder, card text "Only your company sees and uses what you upload here", "Upload your own" over a buyer copy, activity log without the "another company" actor.

**Verified:** `test_tenant_isolation.py` new cases 16/16b/16c (bridge) and 17 (DB + Storage), cases 13/13b rewritten for the new rule: 18 fail on a `0001`→`0044` replay with the old bridge code, 215 pass / 0 fail on `0001`→`0045` with the new code (cases 1-15 unchanged). Backfill checked on a seeded `0044` DB then `0045` applied (A keeps its copy + positions, B sees only the buyer's file and positions, A's replaced old object hidden). `bridge_selftest.py` builds a full pack from shared templates; `test_manual_intake.py` 44 pass through the new upsert key; all 14 CI Python commands pass; `tsc` / `eslint` clean. UI not rendered against a live project (Gap #9).

**Behaviour change:** a company that relied on another company's pre-0045 upload sees those templates as Needed and uploads its own. **Audit write-up:** `docs/specs/POPIA-Security-Audit.md` now exists (it was lost in the first pass): the 7 bridge leaks with before/after, 0043/0044 fixes, this fix, a POPIA s 8-72 assessment and Sarel's action list (platform admin row, NOT VALID warnings, Information Officer / privacy notice / operator terms / s 72 hosting regions / breach runbook, retention periods). Its sections 1-4 were rebuilt from commit `5523221`, its migrations and its tests, because the first pass's own report text was not available to this pass.

## This pass (2026-10-18): award and price analysis - market feedback on submitted prices (migration `0053`)

Full write-up: `Award-Price-Analysis-Findings.md`. The Built-table row above has what was built. The decision: **built direction 1 in full** (where a company's price placed on the tender's own published register - exact data, same scope); **built direction 2 with scale-free numbers only** (rand amounts across tenders are different scopes); **built direction 3 narrowly** (names only on the company's own registers; segment-level counts only, no per-firm view - open question for Sarel). Live reads 2026-10-17 (1 761 tenders) show why the UI is honest about thin data: priced registers come almost entirely from SANRAL's own site (the eTenders tab's 212 SANRAL bidders lists carry no prices), and only 18% of other buyers' awards carry a priced list. Side findings: SANRAL contract numbers are typed in many variants on eTenders ("N001-013-2026/1", "X.005-069-2025-1", "N.008-080-2020.2") - `award_match_keys()` normalises them; a SANRAL closed-list read stalled for 20+ minutes on a dropped connection (wrap any scheduled run in a timeout). Numbering: drafted as `0044`; main had `0044`/`0048` and worktrees held `0045`, `0049`, `0050` uncommitted, then `0051`; by the final rebase main had `0050` and worktrees held `0051`/`0052`, so it landed as `0053` (checked across every worktree just before push). **Verified:** see the Built row; `test_award_outcomes.py`, `test_taxonomy.py` (DB part, on a replay with one tender row - its pre-existing precondition) unchanged; `tsc --noEmit`, `eslint` clean.

## This pass (2026-10-18): Sarel's Q-MD1-4 - directors register, registrations catalog, bank accounts, landlord buildings (migration `0050`)

- **Built:** see the Built-table row and `Company-Master-Data-List.md` §8 (decisions closed) / §9 (what and why, with the live lease-tender evidence).
- **Migration number:** `0050` - `0044`-`0051` are on `main` or claimed by in-flight worktrees (`0045` company_template_copies, `0051` government_listing_changes, award/taxonomy passes renumbering their `0044`).
- **The call on SACNASP/SAGC:** not migrated; catalogued with `stored_in` so there is exactly one home per fact. They move with ECSA/SACPCMP and the SANRAL fillers in one later pass.
- **Conflict to resolve (resolved 2026-10-18):** the taxonomy pass dropped its per-body `people` columns before merging; SACAP / SACPLAN / SACQSP / SACPVP / PSIRA live only in this catalog and the taxonomy pass's tender-conditional display reads it (migration `0054`, section above).
- **Also:** the People page's delete now removes a person's registration certificate files. Legacy `companies.director_id_number` (the one valid ID it held) moved into the register and was cleared.

## This pass (2026-10-18, ~02:00 UTC): form-by-form, field-by-field audit (Sarel: "nothing assumed, completed by default or completed based on Klipcorp's answers")

Full write-up, every field checked (about 459 fields and questions in 44 files: generated documents, UI capture forms, scoring): `Form-Field-Audit.md`. Migration `0057`.

- **Fixed (26).** Highest impact first:
  - SANRAL TEND 1X C33 "Verification Certificate Attached?" was never set, so every company's form claimed a certificate. It is now answered from the vault.
  - K33/H34 were wiped when not on file.
  - Form B3 counts were the DB default 0, with no UI. There was also a "CHECK PROFILE" placeholder and a company-wide JV share. Fixed with Company-page fields and `0057`, which drops the DEFAULT 0.
  - A-Forms:
    - A3 "not a JV" was logged confirmed.
    - A7 carried Klipcorp's commodity and CSD-report wording.
    - A12 confirmed only Klipcorp's literal affidavit.
    - A16 never matched its table. It is now filled from the tender-updates watch.
  - Form of Offer: " None " was typed into the B-BBEE claim.
  - Directors table: a blank director was confirmed.
  - Envelope covers carried SANRAL head office's PO Box 415 Pretoria. R.396's tender box is in Gqeberha; the address is now read from the Tender Notice at intake.
  - The SANRAL signatory was the oldest signatory, silently. There is now a "Who signs this bid" select and a pack note.
  - Closing time: 12:00 was pre-filled in the manual load and forced at SANRAL intake. It is now required, or read from the notice.
  - Functionality threshold: always 70 (regulatory G7). It is now the tender's own, else labelled assumed.
  - The A2 compliance row keyed on the director's name. It now keys on the company's own letter.
  - Experience document type defaulted to "Reference letter", which is scoreable.
  - SBD 1 / CEQ contact person = signatory was logged confirmed.
  - The SBD 1 B-BBEE box was ticked for lapsed proof.
  - The general signatory capacity fell back to the job title.
  - Financial input rows were fixed at PL/DS1.
  - The RRM filler dropped the SACPCMP number.
  - CVs left out SACNASP/SAGC registrations.
  - The SBD 4 guide label was wrong (G4b).
  - The Company-page affidavit note was wrong.
  - `suggest_pack` crashed on a person with only a name.
- **Verified.**
  - New `engine/test_form_field_audit.py` (in CI) uses an un-Klipcorp-like close corporation on the real R.396 templates: 43 checks, 0 failures. On `origin/main` 4a3a638 it has 18 failures.
  - `admin_harness` forms changed only the intended keys. `--pack` gave the same pages and sections, plus the new notes.
  - `general_harness`: 40 runs clean; 4 flagged, all `ceq.contact_person` → assumed_default.
  - Replay 0001→0057; DB tests pass; `bridge_selftest` ready.
  - `test_manual_intake`'s `pack job ready` fails identically on unmodified `defe346`: the B7 gate (`0056`) refuses it, and that pass didn't update the test.
  - A second bridge job showed the signatory note, the A16 addendum row and the Gqeberha cover.
  - All other suites pass; `tsc` and `eslint` are clean.
  - Baselines to reset once: `admin_harness.py --reset`, `--pack --reset`, `general_harness.py --reset`.
- **For Sarel:** `Form-Field-Audit.md` §12, Q1-Q14. The main ones:
  - one rule for A11 vs SBD 8 assumed answers;
  - a per-tender JV question on SANRAL;
  - a bid contact-person question;
  - the directors register;
  - C33 for affidavits (tied to Q-R1);
  - CVs printing "MISSING".

## This pass (2026-10-18, ~00:30 UTC): cross-tenant isolation fixes, written up + independently verified; 8 other commits checked

**Filling a real documentation gap first:** `5523221` ("Cross-tenant isolation fixes: scope
service-role bridges to the job company, enforce same-company references and own-folder storage
paths") is the single most consequential commit in this batch and **touched no documentation at
all** - not `System-Status.md`, not a findings doc. Its own commit message is thorough (before:
133 pass / 53 fail on `engine/security/test_tenant_isolation.py`; after: 187 pass / 0 fail), but
nothing pointed a future reader of this file at it. Written up here because it needs to be
findable without reading `git log`:

- **What it fixed:** RLS was already correct table-by-table, but the service-role bridges
  (pack/CV/CV-extraction/general - these run with RLS bypassed, by design, to do their job) were
  trusting a job's own stored references without checking they still point at the job's own
  company. A company could get another company's confirmed-person CV, vault documents or
  storage-path bytes pulled into its own job folder by pointing a reference at them (migration
  `0043`, 414 lines: triggers refuse cross-company person/pack/task references and rows on
  another company's private tender; CHECKs keep every storage path in the row's own company
  folder; a shared SANRAL template can only be replaced by the company that uploaded it, and its
  uploader identity is hidden from other companies via column-level `REVOKE`+a safe view, not
  just RLS; the admin console is limited to a new `platform_admins` list instead of "any company
  owner sees every customer's harness runs"). `0044` (109 lines) separately fixes person/user
  deletion being blocked by `NO ACTION` FKs, removes a deleted person's traces from rankings and
  signatory answers, and has `deletePerson` clear their CV files from Storage.
- **Independently verified, not just read:** replayed `0001`→`0048` fresh (34 migrations; `0045`-
  `0047` were never used, confirmed benign via `git log --all`, same as the `0020`/`0027`-`0029`
  gaps before). Ran `engine/security/test_tenant_isolation.py` Part 2 (686 lines, needs a real
  replayed Postgres - never run against one before this pass) against it: **first run showed 1
  failure** (direct `SELECT` of `tender_documents.uploaded_by_company`/`original_filename` wasn't
  refused) - traced it to my own scratch-DB setup applying a blanket `GRANT ALL ON ALL TABLES`
  *after* replaying migrations, which clobbers `0043`'s deliberate column-level `REVOKE`+narrower
  `GRANT`. Fixed by applying Supabase's baseline default-privilege grants *before* replaying
  migrations instead (matching real deploy order, where the platform's default grant happens at
  table-creation time and a migration's own narrower grant is what's left standing after). Reran
  clean: **all 15 numbered checks pass, 0 failures** - independent, reproducible confirmation of
  the commit's own "187/0" claim, covering storage-path refusal, cross-company reference
  triggers, the anonymised shared-template uploader, the `platform_admins` gate, and the person/
  user deletion fixes together in one pass.
- **A second, separate test-isolation lesson from the same session:** running
  `test_tender_updates.py` and `test_system_alerts.py` back-to-back against **one shared** scratch
  database (to save setup time) produced 2 failures - `test_tender_updates.py`'s own setup script
  issues a blanket `GRANT ALL ON ALL TABLES TO authenticated` to simulate baseline privileges
  before its *own* migration's restrictions, and that grant leaked into the next test's database
  session, undoing `0042`'s column/function privilege restrictions (`system_alerts`, 
  `record_system_alert()`). Re-ran each standalone against its own fresh, correctly-migrated
  database: **0 failures in both.** Lesson for future passes: these DB-backed test scripts assume
  a dedicated database each, not a shared one - don't batch them in one session.
- Also ran, standalone, against a correctly-migrated scratch Postgres: `test_taxonomy.py` Part 2,
  `test_reminder_seen_db.py` Part 2, `test_watch_conditional_registrations.py` Part 2 - all 0
  failures. Re-ran `test_discovery_fanout.py` and `test_general_bridge.py` for regression - both
  clean.
- **Other 7 commits in this batch** (`4a24b31` re-score-on-profile-change + DB seen stores +
  system alerts; `0f6b985` regulatory compliance review; `c8bf291` company master data list -
  research only, no code; `8d0a953` tender-update watch; `a9a5364` audit Q3/Q5; `7ae7fb3` SBD6.1
  legacy-CLI fix; `d5a6727` tender-update decisions) - read, each already has its own dated
  write-up below with its own evidence; `system_alerts` confirmed to be a distinct concept from
  `daily_digest`/`watch_deadlines` (engine/worker failures for the platform operator, not company
  business reminders), not a duplicate notification system.
- `npm run typecheck` / `npm run lint`: clean.

Nothing found needing a fix this pass beyond the documentation gap above (now closed). No new
product bugs.

## This pass (2026-10-17, ~21:15 UTC): Sarel's three tender-update decisions (migration `0048`)

Answers to the watch's own open questions (b), (c), (e) and its "named by user id" gap. Files: `0048_tender_update_resolution.sql`, `watch_tender_updates.py`, `tender_updates.py`, `company_profiles.py` (`member_labels`/`member_entry`, `RestClient.rpc`), `process_general_jobs.Supabase.rpc`, `daily_digest.py` (`load_roster_live`), Workspace `tender-updates.tsx` + new `update-actions.ts`, `page.tsx`, `actions.ts` (`ensureBriefingMilestone`), `lib/tenderUpdates.ts`, `lib/tenderActivity.ts`, `activity-log.tsx`.

- **1. Accept a document's date.** When an addendum's closing date isn't what the buyer's listing shows, the card shows a flagged panel (amber `#FEF3C7`/`#B45309`) with three boxes side by side - "This document says" / "The buyer's eTenders listing shows" (or SANRAL's page) / "On file here" - and, for a member of a company at found/bidding/submitted on that tender, an "Accept <date> as the closing date" button. It calls `accept_tender_update_date(doc, 'closing_date')` (SECURITY DEFINER, one transaction): `tenders.closing_date`, every company's "Tender closes" task, every Discovery row with that OCDS id - the exact writes `apply_closing_date()` makes - using the document's own time (else the time of day on file, flagged `time_assumed`). It records `applied_by: person`, `accepted_by`, `accepted_by_company`, `accepted_at` and `on_file_before_accept` on the update's `changes`. The card then says "Applied by hand ... Accepted by estimator@... on 17 Oct 2026, 20:58 - the listing showed Mon, 26 Oct", and the activity log gets "estimator@... accepted Fri, 06 Nov 2026 11:00 as the closing date, from “ADDENDUM NO. 1.docx” - was Mon, 26 Oct on file" (another company's acceptance reads "Another company on this tender accepted ..."). The automatic path is unchanged: never applied without the listing agreeing. The SQL and Python copies of the writes are kept in step and checked against each other (Part 3 "parity").
- **2. Briefing date.** New `tenders.briefing_date` / `briefing_time` / `briefing_source_document_id`. `tender_updates.classify_document()` now compares the addendum's "original" briefing date with the one on file (`on_file_agrees`, plus an OCR caveat). If it agrees, or nothing is on file, the watch writes the new date to the tender, moves every company's `kind = 'briefing'` milestone, and creates "Briefing session [at HH:MM]" for each active pursuer (`apply_briefing_date` / `ensure_briefing_tasks`). The Workspace also seeds it on view (`ensureBriefingMilestone`), and the facts card shows "Briefing Tue, 27 Oct 2026 - from the buyer's addendum". A contradiction is flagged and can be accepted by hand (`'briefing'` in the same function). Before this, `kind = 'briefing'` existed only as an enum value and nothing ever set it: the watch had nothing structured to update.
- **Found and fixed on the way:** `ensureClosingMilestone()` never worked. `tender_tasks_standard_kind_idx` was a partial unique index, and Postgres refuses `ON CONFLICT (company_id, tender_id, kind)` against it ("there is no unique or exclusion constraint matching the ON CONFLICT specification"). The upsert's error wasn't checked, so the "Tender closes" milestone was never auto-created through PostgREST; earlier tests had inserted it directly. `0048` makes the index a full one, which is the same constraint (NULL kinds stay distinct). On the PostgREST run, company B's first view now creates its "Tender closes" milestone.
- **3. People named by e-mail.** `company_member_labels()` (0033) now also answers the service role (JWT role claim), so the engine reuses the same lookup the activity log uses. Signed-in users still see only their own companies' members. The alert report's `members` now has `{user_id, email, label, tender_role}`, and the CLI prints "to owner@..., estimator@...". The digest's `person.name`/`email` are the e-mail. A member with no e-mail is "a team member (no e-mail found)", never a raw id. If the lookup fails, it warns and the report still goes out.
- **Late joiner (c):** unchanged, as Sarel confirmed: one alert for the earlier addendum. They also get their own briefing milestone.
- **Verified:**
  - `test_tender_updates.py`: 137 checks, 0 failures, on a fresh `0001`→`0048` replay (Postgres 16, rebased onto `0041`-`0044`). New checks include:
    - classifier on-file agree/disagree on the real DWS scans;
    - briefing written to the tender and to each pursuer's milestone;
    - a closing date the listing doesn't show stays not applied;
    - the late joiner (one alert plus its own briefing milestone, no duplicates);
    - members named by e-mail, including the no-e-mail case;
    - Part 3 accept, refused for the feed-only company, the lost company and a second accept;
    - accepted by the second member, then tender + both closing tasks + both Discovery rows moved and logged;
    - parity between the automatic and accepted paths;
    - briefing accept moves all 3 milestones;
    - label scoping: own company only for members, everyone for the service role, an `authenticated` claim doesn't widen it;
    - the fixed `on conflict`.
  - `test_digest_live.py`: 20 PASS (incl. the `0041` seen-store checks that landed meanwhile). A 2-member company plus a member with no e-mail; no user id in any `person` block.
  - **Real PostgREST 12.2.3 + RLS + `next dev`, signed-in cookies:**
    - the real watch ran twice over PostgREST with a service-role JWT, and its report named "owner@pursuer-bidding.example, estimator@pursuer-bidding.example" via the RPC;
    - the Workspace showed the flagged three-date panel. The second member pressed Accept (no-JS form post, real server action → 303), and the DB then held 6 Nov on the tender, both tasks and both Discovery rows, with the acceptor and company recorded. The first member's page then read "Accepted by estimator@..." on the card and in the activity log;
    - the briefing tender showed the facts line, the "applied" note and a "Briefing session" task;
    - `daily_digest.py --mode live` named all 5 people by e-mail (or the no-e-mail label), and its `tender_tasks` section now carries the "Briefing session" milestone.
  - Screenshots at 390 and 820 px: no horizontal scroll.
  - `tsc --noEmit` and `eslint .` are clean. `test_discovery_fanout.py`, `test_watch_deadlines_urgency.py`, `test_reminder_seen_db.py`, `test_watch_conditional_registrations.py`, `test_watch_person_credentials.py` and `test_system_alerts.py` are unchanged (0 failures).
- **Open questions (new):**
  - (1) An acceptance moves the date for **every** company on a shared tender, as the automatic path does. Should it instead move it only for the accepting company, or should other pursuers be told "another company accepted a new closing date"? Today they see it on the card and in their activity log, but get no alert.
  - (2) A briefing date read by OCR is applied when it agrees with what's on file, with an OCR caveat shown. There is no listing to corroborate it, so a misread "27" for "22" would move the milestone. Is that acceptable, or should OCR briefing dates always need a person's accept?
  - (3) There is no "keep the listing date / dismiss" action; the flag stays until someone accepts. Is that wanted?
  - (4) The original tender's own briefing date (before any addendum) is still not extracted, so `briefing_date` is only ever set from an addendum.

## This pass (2026-10-17, ~21:00 UTC): tender regulatory compliance review

Full write-up with citations: `Tender-Regulatory-Compliance-Review.md`. Research pass with two wording fixes; no schema change, no migration.

- **Public Procurement Act 2024:** never proclaimed; ConCourt declared it invalid in its entirety on 17 Sept 2026 (public participation; not suspended). Draft General Public Procurement Regulations, 2026 have no enabling Act. Nothing in the product was built against it.
- **PPR 2022** (GG 47452) re-read from the gazette: 80/20 <= R50m, 90/10 above, Pmin formula, buyer-defined specific goals, deadlock on specific goals - `score_outlook.py` / `sanralScoring.ts` match. No amendment since found.
- **SBD forms:** current Treasury set downloaded (REVISED SBD1, SBD 4 Bidder's Disclosure under PFMA SCM Instruction 03 of 2021/22 - absorbs old SBD 8/9 content -, SBD 6.1 PPR 2022, MBD suite). The product fills the buyer's own edition, so no stored form is outdated. **Fixed:** the SBD 4 related-enterprise question said "bidding for this contract"; the form says "whether or not they are bidding" (`requirements.py`, `fill_sbd_docx.py`, `pastSubmissionReuse.ts`).
- **B-BBEE:** **Fixed (wording only):** the SANRAL A12 row no longer tells every company a QSE/EME affidavit is "equivalent evidence"; it quotes A12's actual condition (`tenderCompliance.ts`, `compliance-report.tsx`). Status logic unchanged pending Sarel (Q-R1).
- **Verified:** `test_general_bridge.py` ALL PASSED; `py_compile`; `tsc --noEmit` and `eslint` clean.

## This pass (2026-10-17, ~20:00 UTC): company master data list (research only)

Full write-up: `Company-Master-Data-List.md`. No code, schema or UI was changed.

- **Sample.** 123 open OCDS releases from 102 buyers (all buyer types). 287 documents were downloaded. 104 tenders were read: 93 from their text layer, 11 by OCR.
- **Hand read vs `requirements.py`.** The returnables were cross-checked on 18 tenders. The automated read finds the vault's standard items but misses most sector- and buyer-specific ones (PSIRA, UIF/bargaining council, SARACCA, ICASA, vendor forms, shareholding breakdowns).
- **Categories.** Every tender was categorised by hand with the new taxonomy's slugs. `taxonomy.py` agrees on 104/123; the 19 differences are listed there §6.1 as input for the taxonomy review loop.
- **SANRAL via eTenders.** N.011-010-2027/1F's **full** pack (Book 1, Books 2&3, Technical/Financial `.xlsm`, `.docx` Returnable Schedules with a different A-form set incl. A5 DPIP and A18 FSP letter) is downloadable from eTenders with no CAPTCHA. That is a 7th SANRAL Conventional sample, not yet fingerprinted or harnessed.
- **City of Tshwane.** Its documents are only on SAP Ariba, which Discovery can't reach.
- **Open decisions for Sarel (Q-MD1-4 there):** bank account numbers, directors' personal data (POPIA), landlord/property tenders, and a shared registrations catalog. **All four answered and built 2026-10-18 (migration `0050`, pass entry above).**

## This pass (2026-10-17, ~19:30 UTC): tender updates after discovery - addenda, changed dates, new documents

Sarel: "monitor any new documents that gets added to eTenders to see what they contain, if it's potentially addendums ... notify the clients that's interested in the tender ... changes of closing dates ... might also allow someone to tender for something if they have more time." Built table row above has the what; here the evidence and the decisions.

- **Real addenda exist on the live feed and look like this** (pulled 2026-10-17): DWS WTE1062CE/1063CE/1059CE each got "...-Addendum.pdf" on 17 Oct under a release dated 16 Oct (the release date doesn't move when a document is added - every document carries its own `datePublished`); all three are scans ("Original Site Briefing Date: [22 October 2026] / Revised Site Briefing Date: [27 October 2026]"), read by the existing OCR. EC Transport SCMU10-26/27-0017 "ADDENDUM No.1": "CLOSING DATE IS EXTENDED TO FRIDAY 06 NOVEMBER 2026 AT 11:00 AM" plus a query/response/amendment table. MICT SETA "AMENDED RFQ" (a whole re-issue, amended only by its name), JTC0014 "(Addendum)". Late plain documents (a functionality-criteria sheet, an annexure, 39 drawings on one DPWI tender) are the negative case. Texts committed as `engine/discovery/fixtures/tender_updates/` with contact names, e-mails and phone numbers removed.
- **Not duplicating the listing-level work:** the watch never reports a change of the OCDS `tenderPeriod.endDate` on its own (that is the listing-level change tracking another agent owns); it reads the listing date only to corroborate a date found in a document before applying it.
- **Why its own run, not only the digest:** the digest is daily; WTE1063CE's addendum (published 17 Oct) moved a compulsory briefing to 23 Oct. The watch only touches pursued tenders (one remembered one-day OCDS window and/or one SANRAL page each), so it can run every couple of hours. The digest still carries each update once for anyone who missed the alert.
- **Seen store:** in the database from the start (`tender_update_notifications`, plus `tender_watched_documents` as the known-documents record) - same direction as `0038`.
- **Verified:** see the Built row; `test_tender_updates.py` Parts 1-3 (0 failures), `test_digest_live.py` and `test_discovery_fanout.py` unchanged (0 failures).
- **Not built:** no scheduler entry (open item below); ~~a moved **briefing** date is reported but not written anywhere~~ (built in the ~21:00 UTC pass, `0048`); SANRAL files can't be read (reCAPTCHA) so a SANRAL addendum is name-only; a manual tender without an OCDS id has no public source to re-check; ~~the alert report names company members by user id only~~ (fixed in the ~21:00 UTC pass, both there and in the digest's live roster).

## This pass (2026-10-17, ~18:40 UTC): Sarel's answers to audit Q3 and Q5

Full write-up with research and evidence: `Discipline-Taxonomy-Findings.md`; summary in `Hardcoded-Assumptions-Audit.md` §10.

- **Q3 - own discipline list, not CIDB.** Research: eTenders' own Category filter (91 entries, 15 legacy "Services:/Supplies:" + 76 SIC-style divisions; 29% of the 2 211 live tenders sit in three generic buckets, so the buyer's category is a cross-reference, not the taxonomy); the OCDS API only has goods/services/works/consultingServices; L2B (now `l2b.co.za`) publishes 17 construction/facilities-centred categories; CIDB covers works only (~18% of live tenders). Built: `discipline_categories` (0040) seeded with 19 groups / 93 disciplines grown against the real feed, the 7 old buckets kept as group slugs; `taxonomy.py` (matcher, live-table loading with seed fallback, `check`/`coverage`/`sync`/`add`/`sql`); `categorize()`/`assess_fit()` on it; app Experience Library, compliance experience count, Discovery labels and pricing sector on it; `price_sector` CHECK → FK. Uncategorised 66.1% → 2.9% of live tenders.
- **Q5 - SACNASP/SAGC.** `people.sacnasp_*` / `sagc_*` (0040, optional); shown on the People page only when held or asked for by an open tender (named); compliance for Geologist / Surveyor positions only; general workspace row; reminders through `TRACKED_PERSON_EXPIRY_FIELDS`; `requirements.py find_person_registrations()` (real R.396 Book 2/3: both found; the 11 general samples: none ask).

**Verified:** `test_taxonomy.py` and `test_watch_conditional_registrations.py` (new, in CI, DB parts on a fresh `0001`→`0040` replay - 0 failures); `test_discovery_fanout.py` (Part 1 + 2), `test_manual_intake.py`, `general_harness.py --no-pack` (44 clean), `test_general_bridge.py`, `test_award_outcomes.py`, `test_watch_*` - unchanged results; UI on real PostgREST 12.2.3 + RLS with `next dev` (People conditional display, People list chips, R.396 compliance, Experience, Pricing, Pipeline, Discovery all 200); `tsc --noEmit`, `eslint` clean. Migration numbered `0040`: main has `0038` (`discovery_seen_releases`, committed during this pass) and another worktree holds an uncommitted `0039_tender_document_watch.sql`, checked across every worktree just before push.

**Open (new):** O1 also read eTenders' own buyer category (site JSON, joins the OCDS id) as a second signal?; O2 in-app admin for adding categories / promoting a company's own tag?; O3 where a geologist/surveyor's SACNASP/SAGC number goes on SANRAL forms; O4 the same conditional pattern for SACAP/SACPLAN/SACQSP/SACPVP/PSIRA?; O5 per-tender C3.1.11 extraction (Q5's other half).

## This pass (2026-10-17, ~19:00 UTC): Sarel's three decisions - re-score on a profile change, no local state, system alerts

Full write-up with evidence: `Hardcoded-Assumptions-Audit.md` §11.

1. **Re-score a company on a tender when its profile changed** (`watch_new_tenders.fan_out()`): the stored `profile_fingerprint` (0038) is compared with the company's current one; a difference re-scores that company only, updates its seen row in place (verdict, fingerprint, `scored_at`; `first_seen` kept) and reports a report-worthy result again as new (`rescored: "profile_changed"`, `previous_verdict`). An `ERROR` verdict is retried every run (`rescored: "retry_after_error"`) and every read/scoring error goes to `system_alerts`. `company_profiles.RestClient.select()` now reads every page (Supabase returns at most 1000 rows per request - a 0038 seen-store read of >10 companies x 100 releases would silently have stopped at row 1000 and re-reported the rest).
2. **No local state:** migration `0041` - `deadline_reminders_seen` (per company x consumer x item key; `watch_deadlines` and `daily_digest` keep separate rows, exactly as their two files did) and `digest_readiness_seen` (last `field_provenance` status per row, per company). `watch_deadlines.py` and `daily_digest.py --mode live` read and write only these; `--seen-store` is gone from both; a database error fails the run loudly. Local mode of the digest needed no store at all. Sweep of `engine/` and `app/` for every other file-based state - see "Local files that stay local" below.
3. **System alerts:** migration `0042`, `engine/alerts/`, /admin "System alerts" - see the Built-table row.

**Verified:** fresh replay `0001`→`0044` (40 files incl. the concurrently landed `0039`, `0043`, `0044` - re-run after rebasing onto them, + `seed_tenders.sql`) on Postgres 16, now with Supabase's default grants in the stub so revokes are tested for real. `test_discovery_fanout.py` Part 1 + Part 2 (0 failures: profile change -> only that company re-scored, `not_a_fit` -> `strong_fit` reported again with `previous_verdict`, seen row updated in place, Discovery row written by the seeder, next run silent; ERROR recorded + alerted, retried next run). `test_reminder_seen_db.py` Part 1 + 2 (0 failures: CLI twice -> 4 items, then 0; renewed document again; rows per company; digest consumer independent; readiness stored under the pack's company and not re-reported; RLS). `test_system_alerts.py` Part 1 + 2 (0 failures, see Built row). CLI over HTTP against a PostgREST stand-in on the replayed DB: `watch_deadlines.py` run 1 reported 2 COIDs + 1 ECSA + 1 task, run 2 nothing, a renewed COID once; `daily_digest.py --mode live` run 1 wrote 5 seen rows, run 2 reported nothing; `run_bridges.py` + `check_system_alerts.py` as in the Built row. Regression: `test_digest_live.py` (extended: seen rows in the database, second run silent, a readiness change reported once), `test_watch_deadlines_urgency.py`, `test_watch_person_credentials.py`, `test_watch_conditional_registrations.py`, `test_poll_loop.py`, `test_general_bridge.py`, `test_extract_cv_fields.py`, `process_cv_jobs.py --self-test`, `bridge_selftest.py` and `test_manual_intake.py` on fresh replays (their deliberate refusals now show up as `[system-alert] ... warning` lines) - all pass. `tsc --noEmit`, `eslint` clean. Not against a live Supabase (Gap #9).

### System alerts backlog (failure points not wired yet)

1. **The web app itself.** Nothing in `app/` writes to `system_alerts`: a Server Action or page that hits a Supabase error shows it to the user (`?error=`) and nobody else. Needs a server-side insert path (service role from the Next.js server, or an RPC an authenticated user may call for their own errors) - a design decision, not done here.
2. **The general bridge has no stale-job detection.** A worker killed mid-job leaves a general `pack_generation_jobs` row in `generating` forever, with no alert (the SANRAL and CV bridges have `fail_stale_jobs()`; this one never got it).
3. **`seed_supabase_opportunities.py`** (the seen-before-seeded gap): a failed seed is printed only.
4. **Pack sections dropped inside the builders** (a LibreOffice print lost to a concurrent process, a vault file missing from Storage): they appear as "Not included" on the pack checklist, not as alerts.
5. **Per-document download failures** in the general engine (noted in the manifest's gaps) and per-page OCR quality-gate failures - deliberately not alerted (a bad scan or a dead buyer link is not an app failure).
6. **`run_discovery.py`** (SANRAL portal scrape), `award_outcomes.py`, `admin_harness.py`/`write_admin_harness_results.py`, `general_harness.py` - operator/QA tools run by hand, not wired.
7. **`check_system_alerts.py` itself:** if the database is unreachable it can't record that; it exits 1, which the scheduled check-in must treat as an alert.

### Local files that stay local (sweep of `engine/` and `app/`, 2026-10-17)

Moved to the database: `state/seen_deadlines.json` and `state/seen_digest_readiness.json` (above); `state/seen_tenders.json` already for Supabase mode (0038). `app/` keeps no local state (no file writes, no `localStorage`/`sessionStorage` - grep). What remains, and why it is not product state:
- **`state/seen_tenders.json`** - only for a `watch_new_tenders.py --profile` run: profile *files* have no `company_id` to key a database row on. A local/dev run; never used when companies come from Supabase.
- **`state/discovery_state.json`** (`run_discovery.py`, the SANRAL portal scraper) - it records what *this machine* has downloaded into `templates/incoming/` with Sarel's own identity (`config/contact.json`). Moving the snapshot alone would make a new host believe it already has packs it doesn't. It moves when the downloads go to Storage (open question below).
- **`state/admin_harness_baselines/`, `state/admin_harness_pack_baselines/`, `state/general_harness_baselines/`** - QA baselines over the fake test companies, per environment on purpose (LibreOffice/fonts differ: 71 vs 69 pages); the results that matter are in the database (`admin_harness_runs`, /admin).
- **`out/pack_jobs`, `out/general_jobs` (incl. the shared tender-document download cache), `out/generated_cvs`, temp dirs** - scratch and cache: losing them costs a re-download or re-build, nothing else.
- **`fingerprints/*.json`, `config/discipline_taxonomy.json`, `config/test_companies/*.json`** - committed reference data/fixtures, versioned with the code.
- **`config/klipcorp_profile.json`, `config/team_roster.json`, `config/contact.json`** - local inputs for local-mode runs only (the real data is in the database in Supabase mode); `contact.json` is the SANRAL download identity, never product data.

### Open questions from the 19:00 pass

- ~~**Downgrades after a profile change.** A re-score that turns a report-worthy verdict into `not_a_fit` updates the seen row but leaves the company's old `discovered_opportunities` row (still saying strong_fit) on /discovery - the seeder only writes report-worthy results. Remove/mark such rows?~~ **Closed 2026-10-18** (Sarel: "When evaluation downgrades opportunity it must be flagged"): flagged, `0055` - see the ~01:15 UTC pass above.
- **The e-mail itself.** The scheduled check-in that e-mails Sarel must add `check_system_alerts.py --out` to its run (and treat its exit 1 as an alert). Who updates that session's prompt?
- **Warnings in the e-mail.** Refusals (confirm gate, unreadable tender, CV that can't be read) are recorded as `warning` and e-mailed by default; `--min-severity error` drops them. Keep them in the e-mail, or only on /admin?
- **Admin = any company owner** (0005's proxy, unchanged): once real customers sign up, every customer's owner could read system alerts, including tracebacks and other companies' ids in `context`. A real admin flag would close this for both the harness and the alerts.
- **SANRAL portal downloads (`run_discovery.py`)** into Storage, so its snapshot can move to the database too?
- **Personal data in alerts.** A traceback or message can carry a person's or company's name (e.g. a CV-extraction refusal quoting the file). `0044`'s data-subject deletion does not touch `system_alerts` (no `company_id` column - deliberately not tenant-scoped). Scrub/expire resolved alerts after N days?

## This pass (2026-10-17, ~18:25 UTC): independent verification of the per-company Discovery fanout and company-owned letters

The two biggest-blast-radius changes in this batch — the Discovery feed's rearchitecture from
one shared Klipcorp profile to per-company scoring (`8382a29`, `f85d889`, Q4) and the new
company-owned-letters system replacing hardcoded Klipcorp wording (`8382a29`, Q7) — both touch
every company's data, not just Klipcorp's, so they got a from-scratch run rather than a read of
the diff:

- **Full migration replay, `0001`→`0038`**, fresh scratch Postgres 16: clean, including the two
  new ones (`0037_company_document_templates`, `0038_discovery_seen_releases`).
- **`test_discovery_fanout.py`, both parts** (Part 2 needs `FANOUT_PSQL` — a live-replayed
  schema — and had never been run against one before, same situation as `test_manual_intake.py`
  last pass): 0 failures. Confirms, under real RLS rather than a mock: 4 distinct companies each
  scored independently from their own Experience Library/offices rows on the same release (3
  different verdicts on one tender), the database seen-store (`discovery_seen_releases`) writes
  one row per company × release with its own fingerprint, a member reads only their own company's
  seen rows and verdict rows, and a member cannot write the seen store at all (service-role
  only). `is_test_company` companies are included by default, per Sarel's "let it come up in the
  discovery results."
- **`test_company_documents.py`, including the DB part** (`COMPANY_DOCS_PSQL`, same situation):
  0 failures. Confirms a company can only set its own letter template, can't write another
  company's, sees only its own row, and the three states (uploaded verbatim / AI-filled
  guideline / not set up — no fallback wording) all come back correctly from the real table.
- **No regression in the discipline-fit fix** (`b41d0c8`, verified last pass): `assess_tender.py`
  split `assess_fit()` into `read_release()`/`score_release()` for the fan-out, but
  `assess_fit()` itself — where the `known_disciplines` fix lives — is untouched; confirmed by
  reading it directly, not assumed from the split.
- **`fill_authority_letter.py` now correctly delegates to `company_documents.produce()`** rather
  than carrying a second, parallel implementation — read in full to confirm it's a thin wrapper,
  not a duplicate.
- **`seed_supabase_opportunities.py`'s near-total rewrite (190 lines) kept its upsert key**
  (`company_id, ocid` on `discovered_opportunities`, from `0024`) — a different table from the
  `tenders.ocid` uniqueness `0032` scoped to shared tenders only, so no interaction between the
  two fixes to check for.
- `general/test_general_bridge.py` re-run for regression: ALL PASSED (private-documents/`0032`
  checks still hold under the discipline-fit and discovery changes).
- `npm run typecheck` / `npm run lint`: clean.

Not independently re-run: the Q1 MO/MA-equivalence fix (`sanral_fill.py`/`sanralMatrices.ts`) —
read the diff, logic is a straightforward lookup-table addition with both real RRM workbooks'
read-back already in the commit's own evidence; no regression risk to the rest of the fill
pipeline. The "freeze pricing table's Tender column" UI commit (`275ab8d`) — pure CSS
(`position: sticky` + `WebkitOverflowScrolling`), no logic touched, confirmed by the diff alone.

Nothing found needing a fix this pass. No new gaps opened.

## This pass (2026-10-17, ~18:00 UTC): audit follow-ups (a), (d), (e)

Full write-up with evidence: `Hardcoded-Assumptions-Audit.md` §9.

- **(a) Test companies come up in Discovery.** `all_company_profiles()` includes `is_test_company` companies by default; `watch_new_tenders.py`/`daily_digest.py` take `--exclude-test-companies` (replaces `--include-test-companies`).
- **(d) Discovery seen store in the database.** Migration `0038_discovery_seen_releases.sql` (per company x release: verdict, profile fingerprint, first seen; members read own rows, service role writes). `watch_new_tenders.run()` uses it whenever companies come from Supabase - only the current window's rows are read, only new pairs written; the local JSON file only for a `--profile` run. `RestClient.select()` gained `in.(...)` list filters.
- **(e) Digest live mode scores per company.** `daily_digest.py --mode live` scores the feed for every company through `watch_new_tenders.fan_out()` with `company_profiles.py`'s profiles; each person gets their own company's verdicts. Also fixed: live mode's document-expiry, task and readiness sections are narrowed to the person's own company (they were every company's items in every digest).

**Verified:** replay `0001`->`0038` + seed on fresh Postgres 16; `test_discovery_fanout.py` Part 1 + Part 2 on it (0 failures; 8 seen rows for 2 tenders x 4 companies, second run reads nothing, late company scored, RLS); `watch_new_tenders.py` CLI twice against the live OCDS feed with the DB seen store over HTTP (35 rows written, then 0 new; `state/seen_tenders.json` unchanged); new `test_digest_live.py` (CI, 0 failures; fails on the old digest); `daily_digest.py --mode live` CLI over the same stand-in (5 companies scored, verdicts and the one due COID per company); `test_watch_person_credentials.py`, `test_watch_deadlines_urgency.py` unchanged-pass. No TS touched. Not against a live Supabase project (gap 9).

## This pass (2026-10-17, ~17:00 UTC): Sarel's answers to audit Q1, Q4, Q7

Full write-up with evidence: `Hardcoded-Assumptions-Audit.md` §8.

- **Q1 - `MO/MA` = RRM's `MO/MA (Excl. RRM)`.** `sanral_fill.PROJECT_TYPE_EQUIVALENTS` (+ `resolve_option`) and `sanralMatrices.PROJECT_TYPE_EQUIVALENTS` (+ `matrixRowKey`, tender-type column lookup). On both real RRM workbooks a plain `MO/MA` project now fills the CE1 blocks (written as `MO/MA (Excl. RRM)`, index 3, read back) instead of being left off; `RRM` stays distinct.
- **Q4 - Discovery scores every company.** `assess_tender.read_release()` (once per tender) + `score_release()` (per company); `company_profiles.py` builds each company's profile from its own rows (shared with the intake bridge); `watch_new_tenders.fan_out()` and a per-company seen store; `seed_supabase_opportunities.seed()` writes one row per company x tender. No Klipcorp default anywhere in the feed (`DEFAULT_PROFILE_PATH = None`, `DEFAULT_LEGAL_NAME` gone; CLIs need `--profile`). Onboarding's "e.g. Klipcorp (Pty) Ltd" placeholder replaced too.
- **Q7 - company-owned letters.** Migration `0037`, `engine/company_documents.py`, Company page "Letters & documents"; authority letter wired through it in the SANRAL pack (uploaded as-is / own guideline / not set up). Klipcorp's wording deleted from `fill_authority_letter.py`.

**Verified:** `test_discovery_fanout.py` and `test_company_documents.py` (both new, both in CI, both with a DB part run on a fresh `0001`→`0037` replay - 0 failures); `0037` constraints and RLS by hand on the replay; full R.396 pack for `complete_co` / `expired_certs_co` vs a baseline worktree of unmodified `main` (only the A2 letter changed: own guideline vs "not set up", where both used to be Klipcorp's letter); `bridge_selftest.py` (job ready, 63 pp; the seeded company has no letter row, so A2 is "Not included: ... not set up" on the contents page - through the real `company_document_templates` read), `test_manual_intake.py` (0 failures), `test_general_bridge.py`, `test_award_outcomes.py`, `test_watch_*`, `test_poll_loop.py`, `process_cv_jobs.py --self-test`; `tsc --noEmit` and `eslint` clean. The Company page card was type- and lint-checked but not rendered (no live Supabase, Gap 9).

**Local harness baselines** (`state/`): `admin_harness.py --pack --reset` once - every test company's A2 section changed on purpose (`complete_co` now has its own synthetic guideline in its fixture; the others show "not set up").

### Company letters & documents backlog (not yet on the upload-or-guideline mechanism)

The mechanism is generic (`DOCUMENT_TYPES` in `engine/company_documents.py` + `COMPANY_DOCUMENT_TYPES` in `app/lib/companyDocuments.ts`; `document_type` is an open slug, no migration per type). Wired today: `authority_to_sign` in the SANRAL pack only. Still to move onto it, roughly in order of how often a tender needs it:

1. **Authority letter in the general (non-SANRAL) pack.** `requirements.py` already detects a buyer's "Certificate / resolution of authority for signatory" (`certificate_of_authority`), but `build_general_pack.py` lists it "complete by hand". Bind the company's `authority_to_sign` document there too - same type, no new set-up for the company.
2. **Covering / submission letter** (`cover_letter`). Nothing generates one today (Company-Voice-Audit: no transmittal anywhere); many buyers' returnables ask for one. New type; guideline fields: buyer, tender reference/description, closing date, signatory.
3. **Company profile / capability statement** (`company_profile`). Asked for by many general buyers; natural "upload your own" (the company's real brochure/profile PDF).
4. **JV / sub-consultant letter of intent, consortium agreement, JV signatory power of attorney** (`jv_letter_of_intent`, `jv_power_of_attorney`). Not generated; `fill_a_forms.py` defaults JV = No.
5. **SANRAL envelope covers** (`make_envelope_covers.py`). Facts-only layout from SANRAL's reference example, so not company wording, but a company with its own house cover format should be able to set a guideline/upload. Lower priority.
6. **Form B4 quality plan / B5 methodology** (SANRAL). Written by hand by standing rule (no AI narrative); an "upload your own" standard quality-plan document bound in after Form B4 would save re-attaching it. Needs Sarel's OK, since it touches the narrative rule.
7. **CV cover-page sentence** (`generate_cv.add_cover_page`): the one fixed sentence left on the tender CV cover; tied to the open "is the cover page for the buyer?" question (Open items, Company voice).

## This pass (2026-10-17, ~16:20 UTC): independent verification of 10 commits (discipline-fit fix, award outcomes, OCR, deal economics, registration expiry, past-submission reuse, Sarel's decisions 1-4, activity log, hardcoded-assumptions audit)

Ten commits landed since the 14:11 UTC check-in. Rather than trust each one's own "ALL PASSED"
claim, replayed and ran what could actually be re-run independently:

- **Full migration replay, `0001`→`0036` (fresh scratch Postgres 16, same `auth`/`storage` stubs
  as every prior pass), clean.** `0027`-`0029` were never used — checked `git log --all` for
  those filenames (no hits) to rule out a renumbered collision like the real one caught earlier
  (`0023`); this is the same benign kind of gap as `0020`, not a bug.
- **`test_manual_intake.py` run end-to-end against that replayed schema with real Postgres RLS**
  (`Known gaps` item 13 names this test as not in CI because it needs Postgres — nobody had
  re-run it since migration `0032` landed). First run surfaced 4 failures; traced every one to
  **my own scratch-DB stub being incomplete**, not a product bug: `storage.objects`/`buckets`
  never had RLS enabled (my stub skipped it; real Supabase enables it platform-side, no migration
  does), no shared SANRAL tender was seeded, and the harness's own `auth.uid()` convention
  (`set_config('test.uid', ...)`) didn't match my generic JWT-claim stub. Fixed the stub
  (enabled RLS on both storage tables, redefined `auth.uid()` to read `test.uid`, seeded one
  `source='sanral'` tender), reran: **0 failures.** This is real, independent confirmation —
  under actual enforced RLS, not a mock — that migration `0032`'s three security fixes hold:
  member B's INSERT into company A's storage prefix is refused, member B can't read company A's
  uploaded tender documents or write the shared (non-manual) part of the bucket, and
  `load_manual_tender()` correctly refuses a path outside the tender's own prefix, a duplicate
  OCID, and loading into another company. The full SANRAL pipeline (intake → fit scoring with
  the discipline-fit fix below → pack build → 60-page pack) also ran clean end to end in the
  same pass.
- **Test suites**: `test_award_outcomes.py`, `test_general_bridge.py` (includes the private-vs-
  shared document isolation checks for `0032`), `test_watch_person_credentials.py` — all ALL
  PASSED / 0 failures, run directly, output read. `test_extract_cv_fields.py`'s LLM-call test
  fails for a pre-existing environment reason (`anthropic` package not installed here — Known
  gap 3, not new).
- **Discipline-fit fix (`b41d0c8`) read directly**: `assess_fit()` now treats an empty
  `disciplines` list as "unknown, needs review" rather than "checked and out of scope" — the
  actual bug (every real company today has no `disciplines` row written anywhere) and the fix
  are both as described; `classify_tender.py`'s now-redundant band-aid was correctly simplified
  rather than left stacked.
- **Duplication/overlap check**: the new `personCredentials.ts` imports and calls the shared
  `expiryStatus()` from `app/lib/dates.ts` rather than reimplementing it (grep-verified) — the
  pattern holds. The two commits `28d8f5d`/`7ca6937` ("Sarel's decisions 1-4") aren't duplicated
  work — `7ca6937`'s own message explains a shared-working-directory stash/pop mid-commit split
  the files across two pushes; already self-documented, nothing to reconcile.
- `npm run typecheck` / `npm run lint`: clean.

**Not re-verified this pass** (already correctly flagged by the agents who built them, left as
their own open items rather than re-derived here): `QA-Edge-Case-Findings.md` Finding 2 —
`sanralScoring.ts`'s `estimatePosition()` has only ever been exercised against Pavement and
Materials; the other 7 SANRAL DS specialisms' matrix lookups are untested (a pure function, no
Supabase needed — named as a future pass by that agent, not mine to claim credit for deferring
again). `Hardcoded-Assumptions-Audit.md`'s 8 open questions (Q1-Q8) are judgment calls for
Sarel, already consistent with the existing "Open items" section below — not duplicating them
here.

Nothing found needing a fix this pass. No new gaps opened.

## This pass (2026-10-17, ~16:00 UTC): hardcoded-assumptions audit (Sarel: "don't base limitations only on Klipcorp's submissions / these 6 tenders")

Full write-up, with before/after and source-document evidence for every item: `Hardcoded-Assumptions-Audit.md`.

**Fixed:**
- The `MO/MA` refusal. Root cause: project-type options are **per position**, each position's own Book 1 matrix (WB dropdowns: the PL block offers MO/MA, the DS-Pavement block doesn't). It is not per family. `sanral_fill.projects_for_block()` now leaves a project off only the block that doesn't offer its type, picks the next fitting one, and puts a note on the contents page. `confirm_pack` passes all projects, not the first 3. "DI"/"DN" fit the DS-Pavement "DI/DN" option. `sanralScoring` mirrors this. `expired_certs_co` (MO/MA) and `multi_specialist_co` (DIB on the DS-Pavement block, the same bug) now build.
- C.1.2.3's key-person table was always the signatory in rows 1 and 3 (Klipcorp's Henning = PL + DS1). It is now filled from the confirmed pack, with rows found by label.
- Form B1 declared every key person a full-time employee. New `people.employment_status` (0036) plus a People-page select; when it's not recorded, the old answer is kept and noted as an assumption.
- Company/representative phone and e-mail are now filled from 0018/people columns. The "Klipcorp's"/"Henning's" messages are gone.
- Toll codes: `PL(T)` (Book 1) and `PL(Toll)` (workbook) are accepted both ways.
- Experience disciplines are no longer locked to the 7 Discovery buckets (0036 drops that CHECK, keeps a slug format check). Companies can add their own tags.
- "Similar scope" is derived from this tender's own positions, no longer fixed at roads_civil.
- C3.1.11 minimums are labelled as R.396's table. A DS Engineering Geologist is checked against Pr Sci.Nat.
- `SANRAL_PROJECT_TYPES` now holds the complete workbook list (27 → 46 + 6 Book-1-only). It is also offered on the People page project form, with client codes and position codes.
- CIDB is read from `cidb_grading`, not Klipcorp's gaps wording.
- The specific-goals reason no longer implies its list is complete.
- The general manifest flags key-personnel roles outside the 17-role catalogue.

**Fine as is (evidence in the doc):** the client codes, CIDB Annex 1 stages, provinces, ratings and Book 1 matrices are the standards' own complete sets. `tender_documents.doc_type` is the pack builder's input slots, not "all SANRAL documents".

**Verified:**
- Baselines were made from unmodified `origin/main`. Then:
  - `general_harness` (with packs): 44/44 clean.
  - `admin_harness` forms: only the intended `c123.key_person_row_1/3` changes.
  - `--pack`: complete_co and new_co unchanged; expired_certs_co and multi_specialist_co refused → built.
- The bridge/unit suites pass.
- `test_manual_intake.py` and `bridge_selftest.py` pass on a `0001`→`0036` replay (incl. upstream 0030-0035), where the 0036 constraints were tested by hand.
- `sanralScoring` on Klipcorp's real projects is identical to unmodified code.
- `tsc` and `eslint` are clean.

**Local harness baselines (ignored `state/`) need `admin_harness.py --reset` and `--pack --reset` once.**

**Open for Sarel:** see `Hardcoded-Assumptions-Audit.md` §7 (Q1-Q8):
- MO/MA vs RRM's "MO/MA (Excl. RRM)";
- the Engineering Geologist DS has no workbook codes;
- a published discipline taxonomy (CIDB classes?);
- Discovery scored against one profile;
- per-tender C3.1.11 extraction and SACNASP/SAGC fields;
- SANRAL contractor and other document sets;
- the authority-letter format;
- other specific-goal kinds.

## This pass (2026-10-17): public award outcomes (items 17, 28)

Re-checked the documented "OCDS awards are empty" gap rather than rebuilding on it: still empty (800 releases, 5 windows, Nov 2025 - Oct 2026). But the award data exists elsewhere and is public: the eTenders portal's Awarded tab and SANRAL's awarded/closed pages (incl. opening registers with every bidder's price). Built `engine/discovery/award_outcomes.py` (report-only, reuses `list_tenders.py`'s SANRAL list reader via a new `list_slug` default-preserving parameter) + offline test in CI. SANRAL's terms page (open item since 15 October) read: reproduction allowed with acknowledgement, no charge to recipients. Side finding, flagged not fixed: `etenders_national.normalize()` labels OCDS `tender.id` (the portal's internal number) as `contract_number` and the bid number (`tender.title`) as `title` - Discovery shows e.g. `174382` where `RFX6000003683` is the contract number. Full evidence: `Award-Outcomes-Findings.md`.

## This pass (2026-10-17, ~15:00 UTC): Sarel's four decisions (pack checklist, position suggestions, private tenders/documents)

Built - details and evidence in the three new Built-table rows ("Pack checklist + expired-document warnings", "Key-position suggestions", "Private documents on a shared tender + manual-tender privacy"):
1. **Expired documents are included with a warning, and every pack ships a checklist** of what is in it and each item's status - on its contents page and on the Tender Workspace.
2. **Key positions suggest the best eligible person + up to 2 alternatives** from the existing `score_candidate()` ranking (computed by the bridge, `0031`), confirm-or-change, full list kept.
3. **Manual tenders are private** - confirmed, and three leaks around them closed (`0032`).
4. **Private documents on a shared tender** (`0032`), isolated between companies and tested both ways.

Migrations renumbered at push to `0031`/`0032`: main had `0030` and `0027`-`0029` are reserved by in-flight work (see Repo shape). Process note: this working directory is shared by several concurrently running agents; one of them stashed/popped mid-commit and unstaged this pass's changes once, so the final commit was rebuilt and verified from a separate worktree with only this pass's files (another agent's in-progress OCR changes to `engine/general/requirements.py`, `general-workspace.tsx`, `generalTender.ts` and `process_general_jobs.py` were deliberately left out).

## This pass (2026-10-17): per-person registration expiry reminders (Deep-Dive item 21)

**Checked first:** `people` (0001, no later migration touches its registration columns) has `ecsa_level/number/date` and `sacpcmp_number/date`. Both `*_date` columns are the date the person was *registered* (People page label, the CV extractor's prompt "date registered", the SANRAL fillers' registration-date cells) - nothing recorded when a registration lapses. No other professional body has any column on `people` (Gap #3).

**Built:** migration `0035_person_registration_expiry.sql` (`people.ecsa_expiry`, `people.sacpcmp_expiry`, plain nullable dates entered from the certificate/renewal notice, never computed - the renewal cycle differs per body; no new policy, 0001's tenant isolation covers them). `watch_deadlines.py`: the window/seen-store/escalation rule is now one helper, `_expiry_window()`, used by both `find_due_documents()` (unchanged behaviour, urgency test still 8/8) and the new `find_due_person_credentials()` (`TRACKED_PERSON_EXPIRY_FIELDS`, keys `person::<id>::<col>::<expiry>::<status>` in the same seen-store); CLI prints and `--out` writes a `person_credentials` list. `daily_digest.py`: person items ride in `document_expiry` as `type: person_credential` - full_cycle all, cv_admin only these (the spec matrix's "only if it blocks a specific person's registration" cell, which had been hard-wired empty; `document_expiry` added to cv_admin's visible sections), finance never, viewer in the count; local mode reads the same columns from the profile JSON. People list: expiry chips ("ECSA renew by 06 Nov 2026", red/amber/green/grey via `expiryStatus()`, 60-day threshold, same as the vault) and a summary chip row; person page: "valid until / renewal due" date inputs with a badge (`app/lib/personCredentials.ts`).

**Verified:**
- Every committed migration (`0001`–`0026`, `0030`–`0033`, `0035`; 30 files) replayed on a fresh scratch Postgres 16 (same stub method), after rebasing onto `0030`–`0033`: clean. Numbered `0035` because `0027`–`0034` are all claimed by committed or in-flight worktrees (checked across every worktree just before push). RLS: a member of another company sees only their own person's expiry and updates 0 rows of the first company's.
- `watch_deadlines.main()` run for real against that database (`supabase_request` served by psql), fixture: ECSA lapsing in 20 days, ECSA 200 days out, a registered person with no expiry, another company's SACPCMP lapsed 3 days ago. Run 1 (2026-10-17): 2 reported (the 20-day ECSA as renew soon, the lapsed SACPCMP as expired). Run 2 same day and run 3 next day: 0. Run 4 at 2026-11-07: 1 - the same ECSA again, now expired. After renewing to 2031: 0. Seen-store holds exactly 3 `person::` keys.
- `test_watch_person_credentials.py` (new, CI, in-memory rows through the urgency test's own fake): 17/17, including digest routing per role. `test_watch_deadlines_urgency.py` 8/8 unchanged.
- People pages rendered with `next dev` against a fake Supabase stub: list chips/colours and summary row correct at 390px; person page badge "Renew soon"; submitting the form PATCHes `ecsa_expiry`/`sacpcmp_expiry`. `npm run typecheck`/`lint` clean. Not run against a live project (Gap #9).

**Open:** other professional bodies (SACAP, SACPLAN, SACPVP, SACQSP, PSIRA...) still have no registration columns, so no expiry either (Sarel's existing "columns for other professional bodies" item); the CV extractor doesn't propose the expiry (CVs rarely state it); a person's registration lapsing before a pursued tender's closing date is not yet checked the way vault documents are (`find_documents_lapsing_before_closing`), nor shown on the compliance report's key-people rows.

## This pass (2026-10-17, ~15:15 UTC): reuse of past submissions (item 9)

Built the Tender Workspace "Start from a previous submission" card (Built table row). Kept narrow on purpose (Deep-Dive "Scope discipline"): the reusable surface turned out to be one allowlist of `tender_answers` keys plus SANRAL key-position people - no new table, no migration, no generic "clone a tender". Open questions are under Open items.

## This pass (2026-10-17, CV cover-page internal-text fix)

**Found and fixed a real buyer-facing bug** in `engine/cv/generate_cv.py`: the tender-specific
CV cover page (and the SANRAL/World Bank format intro paragraphs, printed regardless of
tender-specific or standard mode) put tool-internal text straight into the document that gets
merged into the real submitted pack - script names (`suggest_pack.py`, `generate_cv.py`),
`docs/specs/CV-Engine-Findings.md` file-path references, "Match score: N (suggest_pack.py's own
scoring scale, not a percentage)", and "people/projects schema" wording in the World Bank
format's missing-field notes. Confirmed by generating a real CV (`complete_co` fixture, both
formats, `--tender`/`--position` set) and reading the `.docx` and converted `.pdf` back with
python-docx/pdfplumber - all of the above appeared verbatim in the output a buyer would receive.

Fixed by rewriting every such string to plain, buyer-appropriate text (e.g. "This CV highlights
[Name]'s qualifications and project experience relevant to the [code] - [description] position.")
or dropping it where there was nothing genuinely buyer-appropriate to say (the raw match
score/rationale, the "re-run suggest_pack.py" instruction for an unscored candidate, the
"people/projects schema" missing-field explanations). The underlying match score and rationale
are not deleted from the system - they stay in the written `.provenance.json` and remain visible
to internal reviewers via the Tender Workspace/`pack_suggestions.json` - just no longer printed
onto the document that is actually submitted. Checked: there is no internal-review-copy vs.
submitted-copy distinction anywhere in the code or data model today (one file is generated, one
file is merged into the pack), so per the safe default this strips the internal detail from the
CV generator's output entirely rather than gating it behind a distinction that doesn't exist.

Verified: regenerated real CVs for all three cover-page paths (matched candidate, matched
candidate with `specialism_warning`, and a position with no scored candidate for this person) in
both formats, read every `.docx` and `.pdf` back and grepped for `suggest_pack`, `generate_cv`,
`.py`, `docs/specs`, `schema`, `script`, `Match score` - none found in any output. Standard
(non-tender) CV generation in both formats re-run and still produces clean output. No test suite
exists specifically for `generate_cv.py` (it's verified by the manual real-generation +
read-back pattern documented in `CV-Engine-Findings.md`); `engine/cv/test_extract_cv_fields.py`
was run for the wider CV engine and shows the same 4 pre-existing `fixture not found` errors with
and without this change (unrelated - no local `conftest.py` defines `tmp`/`docx_path`, not
touched here).

This closes out item (a) of the "Company voice" open item below. **Correction to that item's own
reference:** `docs/specs/Company-Voice-Audit.md` does not exist anywhere in this repo (checked by
full-repo search) and nothing else references it - the open item below appears to be the only
place that name was ever written down, and the "decision" it was meant to record was never made.
Item (b) (`how_we_work` on the Tender Workspace) is untouched by this pass, per instruction, and
stays open below.

## Quiet check-in (2026-10-18, ~14:15 UTC)

Two commits, both small and already well-verified; one had no System-Status entry of its own:

- `57e66ba` - Discovery's opportunity cards split into a flexible main column and a fixed
  `180px` right rail (closing date, "Prepare this tender", document links). On a phone the rail
  always wraps to its own line but kept its fixed width there too, stranding the page's primary
  action in a cramped sliver with empty space beside it. Fixed with the same `<style>` + media-
  query override pattern already used on the Person and Experience pages (desktop untouched).
  Read the diff in full - purely additive, no logic touched. Re-ran `npm run typecheck`/`lint`:
  both clean.
- `41d875a` - already has its own entry just below (ninth QA run). Re-ran `test_award_outcomes.py`
  and `test_award_prices.py` myself: 0 failures both, confirming the fix.

Nothing further needed this pass.

## This pass (2026-10-19, ~00:30 UTC): demo-prep sprint verified - landing page, SANRAL B6 estimator, auth redesign, 3 new discovery sources, a live-E2E-caught bug

8 commits, all authored directly by Sarel with Claude as co-author (a workflow shift from every
earlier commit this session, which the agent authored directly) - explicitly driving toward
"tomorrow's customer demo." None touched `System-Status.md`; filling that in now.

- **Landing page** (`4fc2e19`, `app/app/page.tsx`, the single biggest content gap this whole
  session's own UX research had named - `/` was a bare redirect with zero marketing content).
  Checked it against `Marketing-Pricing-Strategy.md` §6.3's constraints line by line, not just
  read the commit's own description: no "AI-powered"/"win more tenders"/time-saving claims, no
  scope overreach beyond SANRAL + standard SBD/MBD forms - zero hits on any of the prohibited
  phrasings. Its "proof points" section is handled with real integrity: explicitly "No customers
  yet. Here's what to check instead of a testimonial" rather than any fabricated social proof.
- **SANRAL B6 estimator** (`ffbba14`, `/tools/b6-estimator`, a new free public lead-magnet
  tool) + a real logo replacing the navy-square placeholder. Confirmed by reading the imports
  directly: it calls the real `estimateSanralConventional()`/`sanralMatrices.ts` the live app
  itself uses, not a second, divergent implementation - "same numbers the live app produces" is
  accurate, not just claimed.
- **Auth pages redesign** (`d64e652`, `AuthShell.tsx` - a shared split-screen shell with a dark
  left panel across all 4 auth pages) - pure UI, no logic touched.
- **3 new discovery sources** (`cace3f7`: SARS, cidb's own procurement feed, DBSA) - ran
  `test_gov_sources.py` myself: ALL PASSED, including the specific new-source cases (cidb's
  misleading `status` field correctly ignored in favour of `realstatus`; DBSA's own typo'd
  month in a closing date correctly left unset rather than crashing).
- **A real bug caught by live Playwright E2E testing against the production deployment**
  (`9061deb`) - worth naming as a methodology point: `signUp()` returns a session immediately
  when the live project's email-confirmation setting is off, but the UI told the user to check
  their inbox regardless, since nothing checked whether a session actually came back. **This is
  a project-level Supabase Auth setting, not part of the schema** - no amount of scratch-Postgres
  replay in any pass this session, including my own review of this same auth flow last pass,
  could ever have caught it. Only real E2E testing against the live deployment surfaced it. Worth
  remembering as a limit of this file's own usual verification method, not a gap in how carefully
  it was applied.
- **Demo-blocking copy fixes** (`95bce9f`) - raw internal filenames (`run supabase/seed_tenders.sql`)
  were showing up in the Dashboard/Discovery empty states a brand-new signup actually sees first;
  replaced with real customer-facing copy. Also fixed the "T" logo missing on 2 of 4 auth pages.
- Two `.gitignore` additions (`570576d`, `9ec8536`) for local tooling directories
  (`.claude/worktrees/`, `supabase/.temp/`) - no project content affected.

Re-ran everything myself rather than trusting "verified clean build/lint/typecheck" in each
commit message: `npm run build` (33/33 pages, both new tool routes prerender clean), `npm run
typecheck`/`lint`, `test_gov_sources.py` - all clean.

## This pass (2026-10-18, ~23:00 UTC): email/password auth verified (Sarel's own commit); onboarding-scan field-loss fix and a mobile CSS fix confirmed clean

**Email/password auth** (`d721965`, `/signup` + `/login`'s new password form + `/forgot-password`
→ `/reset-password`, Sarel's own second human-authored commit this session): read every new page
in full rather than trusting "verified clean build/lint/typecheck/tests locally and a green
Vercel preview" at face value. All four use Supabase's own native primitives directly
(`signUp`/`signInWithPassword`/`updateUser` with `emailRedirectTo`) - no custom password
handling, no new token/callback logic (reuses the existing `/auth/callback` PKCE exchange
route). Signup requires email confirmation before the account is usable (standard Supabase
gate) and enforces an 8-character minimum + confirm-password match client-side.
`reset-password` correctly assumes a session already established by the callback route and
fails cleanly (an "expired or invalid link" message, not a crash) if someone navigates there
directly without one. Checked the one thing that would matter most if it were wrong: `proxy.ts`'s
onboarding/company-membership redirect gate reads only the session + `company_members`
membership, with no special-casing by auth method - a password-signed-in user goes through
exactly the same `/onboarding` gate and RLS as an OAuth one. The Microsoft OAuth button is
correctly hidden behind a `MICROSOFT_AUTH_READY = false` flag with a clear comment (Google
credentials were pasted into the Azure provider slot by mistake - this stops a real visitor
from hitting that until it's fixed). `npm run build`: 32/32 pages, `/signup`/`/forgot-password`/
`/reset-password`/`/login` all genuinely static.

**Onboarding-scan silent field loss** (`2d4c124`, thirteenth QA run): confirmed the underlying
write path (`actions.ts`'s `confirmVaultDocument`) was already safe - it only ever wrote a real
`companies` column, so no data was ever actually mis-saved. The bug was purely that the review
screen showed every AI-read field with the same tick-box regardless of whether a column existed
to save it to, so confirming a field with nowhere to go looked identical to confirming one that
worked. `isFieldPersisted()` is now the one shared source of truth for which fields are
tickable vs. shown read-only with a "not saved anywhere" note - re-ran `onboardingScan.test.ts`:
12/12 pass.

**Mobile CSS fix** (`4f9311d`): the document-scan review card's field grid gets the same
`@media (max-width: 600px)` collapse already proven on the Person page's CV review rows -
consistent reuse, not a new pattern. This commit's own build check independently confirmed the
same milestone verified last pass (the `/login` prerender gap is gone, "all 27 routes, zero
errors, for the first time this arc").

Regression: `npm run typecheck`/`lint` clean; full `npm run build` still 32/32 pages with no
errors.

## This pass (2026-10-18, ~21:00 UTC): live Supabase + Vercel milestone verified; currency-parsing bug and onboarding document scan confirmed clean

**The milestone**, independently re-verified rather than taken on trust: ran `npm run build`
(not just `typecheck`) myself in this sandbox - clean, 29/29 static pages, `/login` and all 3
`/tools/*` routes now genuinely static (`○`). Every prior pass's own build verification this
session carried the caveat "fails at the pre-existing /login prerender gap - no Supabase env vars
in this container - unrelated"; that caveat is gone, confirming Sarel's three fixes
(`createClient()` moved out of `/login`'s component-body top level into the click handler;
`/tools/deadline-calculator` reworked onto `useSyncExternalStore` instead of a bare `new
Date()` during render; `engines.node` pinned in `package.json`) actually hold. Updated
Known-gaps item 9 directly (see above) rather than only noting it here, since this changes
current *state*, not just this pass's activity - this is still the single update most likely to
be read in a hurry and skimmed past, so it's worth saying plainly: **real credentials still
don't reach this sandbox**; "the project now has a live Supabase + Vercel deployment" is Sarel's
own primary-source commit, not something I can independently confirm beyond the build/migration
evidence above - scratch-Postgres replay stays this file's own verification method until that
changes.

**Currency-parsing fix** (`35d55b8`, a confirmed 100x-wrong tender-value bug - comma-as-decimal
vs. comma-as-thousands-separator, the classic SA Rand ambiguity): re-ran
`test_tender_enrichment.py`, `test_award_outcomes.py`, `test_taxonomy.py`, `test_market_trend.py`
myself - all clean. Good fix shape: reused `award_outcomes.parse_rand()` (already correct,
already tested) instead of leaving a second, wrong parser in place.

**Bulk onboarding document scan** (`eb5a846`, migration `0063`): replayed `0001`→`0063` fresh (55
migrations). Read the migration in full - same proposal/confirm shape as the CV AI-extraction
precedent (0023), routes each confirmed document to an *existing* table/column rather than
inventing a new generic storage model, and correctly caught its own research gap mid-build
(CIDB routes to new `companies.cidb_expiry`/`cidb_document_path` columns, not
`held_registrations` - `0050`'s own check constraint would have refused that insert). Manually
verified tenant isolation on `onboarding_uploads` myself (company B: 0 rows read, insert
refused) since no test file covers the RLS directly. Ran `test_classify_documents.py` (32
checks pass; the one that needs a live LLM call fails for the same pre-existing reason as CV
extraction's own equivalent test - `anthropic` not installed in this sandbox, Known gap 3, not
new) and `onboardingScan.test.ts` (8/8).

Regression: `test_tenant_isolation.py` ALL PASSED, `test_general_bridge.py` ALL PASSED, `npm run
typecheck`/`lint` clean.

## This pass (2026-10-18, ~19:00 UTC): real bug found and fixed in the new B-BBEE calculator; verified the rest of the gap-check build

A build agent picked up the previous pass's TenderFlow gap-check recommendation directly
(`ebdd794`, citing "Per the Solution Architect's TenderFlow gap check") and shipped all 3
recommended free tools in one commit, plus `20e245f` (signatory scopes, migration `0061`) and
`41e9645` (market trend, migration `0062`). Reviewed all of it carefully rather than trusting it
more because I'd suggested the idea:

- **Found a real bug**: `app/lib/preferencePoints.ts`'s hardcoded B-BBEE status-level points
  table had Level 3 at `points9010: 7`. Cross-checked against
  `Tender-Regulatory-Compliance-Review.md` §8.2 (which cites SANRAL's own Interim Preferential
  Procurement Policy §6.4.1 Table 1, already independently verified against R.396 Book 1 in an
  earlier pass) - every other level matched that source exactly, Level 3 was the one value that
  didn't: the correct value is 6, not 7. The test suite's own assertion had encoded the same
  wrong number (`beeGoalsPoints("90/10", 3), 7`), so 10/10 tests passed while asserting a wrong
  regulatory figure - a case where "tests pass" didn't mean "the number is right." **Fixed both**
  the table and the test; re-ran, 10/10 still pass with the corrected value. This is a public,
  no-login compliance calculator - a wrong preference-points number here would have been a real,
  visible mistake to a company relying on it to self-check its SANRAL/government bid score.
- Spot-checked the other two new calculators against domain knowledge: `publicHolidays.ts`'s SA
  holiday table (Public Holidays Act 36 of 1994, 10 fixed dates + Easter-derived Good Friday/
  Family Day + the s2A Sunday-to-Monday rule) and Easter-date algorithm (Meeus/Jones/Butcher) -
  ran it directly for 2026, got Good Friday 3 Apr / Family Day 6 Apr, which is correct. CIDB
  grading value bands (R200k/R650k/R2m/R4m/R6.5m/R13m/R40m/R130m across grades 1-9) match known
  public figures. Neither raised anything to fix.
- Replayed `0001`→`0062` fresh (54 migrations). Read `0061`'s RLS (standard
  `is_company_member` tenant-isolation pattern, same as every other per-company table) and
  `0062`'s `market_trend_for_tags()` live SQL function (correctly gates on
  `value_band_basis = 'stated_in_text'` before computing a price-vs-estimate ratio, never
  touches `fill_financial.py`'s pricing-fill logic). Ran `test_market_trend.py` (its one `git
  diff` sanity check failed only because I ran it as a different OS user in a root-owned repo -
  a local environment artifact, confirmed by reproducing the same git error directly outside the
  test; every substantive SQL-based check passed). Ran all 5 new Node test-runner suites
  directly (`publicHolidays`, `cidbGrading`, `preferencePoints`, `marketTrendLogic`,
  `signatory-logic`): 45 cases, all pass after the one fix above.
- Regression: `test_tenant_isolation.py` ALL PASSED, `test_general_bridge.py` ALL PASSED,
  `npm run typecheck`/`lint` clean.

One real fix this pass; everything else in the batch verified clean.

Also landed this window, doc-only, no code to verify: `1c32e88` (eleventh QA run - three
synthetic non-engineering company fixtures run through the general pipeline, clean, two gaps
flagged not bugs: no pest-control/IT sample tender on file yet, no Pack Review equivalent for
general tenders) and `a4ddf8f` (marketing strategy: TenderFlow channel audit, Hormozi cadence
findings).

## This pass (2026-10-18, ~17:00 UTC): verified Pack Review + tender scope/tags/value-band; answered a TenderFlow gap check

**TenderFlow feature-parity gap check** (relayed from another session, Sarel's ask): compared
the Deep-Dive's TenderFlow row in the feature-comparison table against the actual codebase (grep,
not the aging doc's own claims) and against Marketing-Pricing-Strategy §6.3's positioning
constraints. No code changed, per the instruction - findings sent back to the originating
session. Summary: Go/No-Go screening is already built and arguably stronger than TenderFlow's
(per-company profile scoring, not a shared default); Collaboration is partial (comments + an
activity feed exist, a formal approvals/sign-off step doesn't). Three genuine, verified-by-grep
gaps recommended as quick, positioning-safe wins: a working-day deadline calculator excluding SA
public holidays, a CIDB-grade-vs-tender-value calculator, and a B-BBEE preference-point
calculator (all three: standalone free-tool shape, no AI/bid-writing claim, reinforce the
existing "correct" positioning pillar). Recommended against saved-filter keyword alerts (real
work, and a step backward from the smarter per-company fit scoring already built) and deferred
the approvals/sign-off gap to Sarel's own scoping call (real design work, closer to the "generic
bid management" space the product deliberately doesn't compete on).

**Pack Review + tender scope/tags/value-band** (migrations `0059`, `0060`, 3 commits - one of
them itself a TenderFlow-benchmarking pass by another session, on the new Pack Review screen's
layout, not the feature set): replayed `0001`→`0060` fresh (52 migrations, sequential, no gaps)
and verified directly:

- Read both migrations in full. `0059` (`pack_review_confirmations`) uses the same
  `is_company_member` tenant-isolation pattern as the rest of the schema; manually verified it
  myself against the replayed DB (company B sees 0 of company A's review rows, and B's insert
  claiming company A is refused by RLS) since no test file yet covers this specific new table.
  `0060` (`tender_scope_records` + `tenders.industry_tags`/`discipline_tags`) is careful about
  what's real extraction vs. heuristic (an honest `null`/`'unknown'` rather than a guessed value
  band or BOQ line items that no parser in this repo actually produces) - read in full, agree
  with the reasoning; correctly reuses `discipline_categories` (0040) as its vocabulary instead
  of inventing a second taxonomy.
- `discovery/test_tender_enrichment.py`: 0 failures (this file prints only on FAIL, by design -
  confirmed by reading it, not a missing-output surprise).
- `pack-review-logic.test.ts` (Node's built-in test runner): the file's own documented run
  command (`node --experimental-strip-types --test <path>`) found 0 tests in this sandbox -
  running it without `--test` (`node --experimental-strip-types <path>`) correctly executed all
  19 cases, 19 pass / 0 fail. Likely a Node-version/glob quirk with the `[id]` bracket in the
  path interacting with `--test`'s own file-discovery, not a real problem with the test or the
  code - noting it here so the next person reaching for the documented command isn't surprised
  by 0 tests and assumes something is broken.
- Regression: `test_tenant_isolation.py` ALL PASSED, `test_general_bridge.py` ALL PASSED,
  `npm run typecheck`/`lint` clean.

Nothing found needing a fix. No new gaps opened.

## This pass (2026-10-18, ~16:20 UTC): independent reproduction of the tenth QA run's fix (Finding 11)

`tender_changes.py` has no dedicated test file (flagged, correctly, by the tenth run's own
entry below) - its fix was verified there with one-off repro scripts, not a permanent regression
test. Independently wrote and ran both repro scenarios myself against the fixed code, calling
`tender_changes.detect()` directly:

- **Scenario 1** (3 releases, one with an unparseable `closing_date` string): 3 honest events
  came back, no crash - the malformed one correctly reports "Closing date changed: ... -> no
  date" rather than guessing a direction; all 3 snapshots kept.
- **Scenario 2** (2 releases, one with `documents` as a plain string instead of a list): the
  malformed release is isolated with a named `system_alerts` warning naming the real
  `AttributeError`, the other release is processed and its snapshot kept normally, 0 events
  (correct - no prior snapshot to diff against on a first run), no crash.

Both match the write-up's claims exactly. This is the fourth time this session the same
"one bad record crashes a whole multi-tenant batch" bug class has been found and fixed (compliance
reminders, tender-update watch, the repo-wide date sweep, now listing-change detection) - worth
naming as a pattern for whoever next writes a new per-release/per-record loop over Discovery or
compliance data: wrap it in isolation from the start, don't wait for a live crash to add it.
`python3 -m py_compile` clean; all 9 discovery test suites still pass.

## This pass (2026-10-18, standing QA/robustness review - twelfth run)

Picked the brand-new tender-enrichment module (`engine/discovery/tender_enrichment.py`: tags,
scope, pricing model, estimated value band - migrations `0060`/`0062`), after a sibling QA pass
(logged as the "eleventh run" in `QA-Edge-Case-Findings.md`) had just finished a different,
non-engineering-industries pass over the general pack pipeline.

**Found and fixed a severe, real bug**: `_parse_amount()` stripped every comma as a thousands
separator before parsing a stated contract value, which is wrong whenever the comma is actually
the *decimal* separator - a real, common South African format
(`award_outcomes.py`'s own docstring: "R551 189,00" is R551,189.00). A real R1.5 million tender
("R1 500 000,00") came back estimated at R150 million and banded "R50m+" instead of "R0-5m" - a
confident, silent, two-orders-of-magnitude-wrong answer, in a field whose whole purpose is a
quick size judgement. `award_outcomes.py`, in the same directory, already solved this exact
ambiguity correctly and has test coverage proving it; `tender_enrichment.py` reimplemented the
same problem from scratch and got it wrong instead of reusing the already-correct function.
Fixed by calling `award_outcomes.parse_rand()` instead of the broken local parser. Added a
regression case to the existing test (none of the 4 pre-existing cases used comma-as-decimal,
which is why this shipped untested). Verified directly against the real bug plus 3 regression
cases; `test_tender_enrichment.py`, `test_market_trend.py`, `test_award_outcomes.py`,
`test_taxonomy.py` all clean. Full evidence in `docs/specs/QA-Edge-Case-Findings.md`
(Finding 12).

## This pass (2026-10-18, standing QA/robustness review - tenth run)

Found the malformed-date-in-a-batch bug a fourth time: `engine/discovery/tender_changes.py`
(listing-change tracking across every tender in every Discovery source, migration `0051`) landed
in the government-coverage expansion, in the same window as the seventh run's repo-wide date
sweep, but after the sweep's own inventory - so it was never checked. A listing where only one
side of a closing-date comparison parsed (`source_http.parse_sast()` returns `None` on a bad
date) hit `None > a_real_datetime` and crashed; `detect()`'s per-release loop had no error
isolation, so one bad listing aborted change detection for every other tender in the run -
pursued or not, any company's. A second crash (a differently-malformed release's `documents`
field) surfaced while testing the fix, in the snapshot-saving line the first attempt at
isolation didn't cover. Both fixed: the date-direction check now degrades to an honest
"changed" when either side can't be read; the per-release loop is now wrapped in a try/except
covering diff, disagreement and snapshot together, isolating one listing's failure the same way
Finding 9e already isolated `watch_tender_updates.run()`. Verified directly against both repro
scenarios; all 9 discovery test files still 0 failures / ALL PASSED. Flagged, not fixed:
`tender_changes.py` has no dedicated test file at all. Full evidence in `docs/specs/QA-Edge-
Case-Findings.md` (Finding 11).

## This pass (2026-10-18, standing QA/robustness review - ninth run)

Picked the award/price-intelligence feature (`engine/discovery/award_outcomes.py`,
`store_award_outcomes.py`) - new ground for this review, and it deals with real money. Ran the
real CLI against the live eTenders portal rather than only reading code. Found and fixed one
minor bug: a genuine R0,00 award (a real live record - a disciplinary-matter appointment) was
miscounted as "no amount on file" in the run's summary stats, because `with_award_amount`/
`with_contract_amount` used a bare truthiness check instead of `is not None` - the classic
"zero is falsy" mistake. The actual stored record and the per-award print line were both already
correct; only the summary counter was wrong, so nothing downstream was ever silently wrong -
fixed anyway since it's a one-line, zero-risk correction. Also checked the duplicate-award
detection and the price-plausibility gate for the same "could this misfire" question - both
sound, by design, not bugs. Full evidence in `docs/specs/QA-Edge-Case-Findings.md` (Finding 10).

## This pass (2026-10-18, standing QA/robustness review - sixth run)

Rotated to the compliance/reminders engine. Pulled latest `main` first (small this time - a
Person page UI pass only) - confirmed all six of this review's prior fixes are still present and
untouched before starting.

**Found and fixed the same malformed-date bug a third time, in the worst place yet**:
`engine/compliance/watch_deadlines.py`'s `days_until()` had no guard against a malformed date
string, same as the two fixes in the fourth run's pass-entry above - but this function is the
one shared date helper behind EVERY "what's due" check in the daily compliance reminder run
(company documents, person registrations, and the newly-landed shared registrations catalog),
and `main()`'s own `try/except` wraps all of them together across EVERY company in one go. One
malformed date anywhere in the whole system - any single company, any single person - would
abort the entire run, meaning **no company gets its compliance reminders that day**, and every
later run keeps failing the same way until the bad date is found and fixed by hand. For a
safety-critical reminder system (a missed COID renewal reminder can mean a company becomes
ineligible to bid), this was the most severe instance of this bug class found so far. Also found
and fixed the same unguarded pattern (one direct call, one inline reimplementation) in
`engine/notify/daily_digest.py`'s local-mode functions while fixing the root cause.

Fixed by having `days_until()` return `None` (not raise) on a malformed date - the same sentinel
every caller already uses for "no date at all" - and recording a warning-level system alert so
the bad record stays visible without blocking everyone else. Verified directly: the exact
multi-company scenario that used to crash now processes every company regardless of the bad one
in between. Full regression: all five compliance test files plus `test_digest_live.py` - 0
failures across all six. Full evidence in `docs/specs/QA-Edge-Case-Findings.md` (Finding 8).

## This pass (2026-10-18, standing QA/robustness review - fifth run)

Rotated to the intake engine. Pulled latest `main` first (more concurrent work had landed: a
multi-source discovery expansion, `engine/sanral_b7.py`, cross-tenant isolation tests) -
confirmed this review's five prior fixes are all still present and untouched before starting.
Used `classify_tender.py`'s own local CLI mode to run real adversarial document shapes without
needing a scratch Postgres for this rotation.

Found and fixed one real, moderate-severity bug: a `.docx` tender document renamed to `.pdf` (a
mundane, real-world upload shape) got a correct, specific per-document reason from
`requirements.py` ("not a readable PDF - corrupt, truncated or not really a PDF... re-download
it" - pdftotext itself detected it wasn't really a PDF), but the SAME intake result's fit/score-
outlook section showed a different, misleading "likely a scanned image" message right next to
it, because `classify_tender.assess_fit_from_text()` built that message from scratch with no
visibility into the real, already-known reason. The verdict itself stayed safely cautious either
way, so this was a wrong-explanation bug, not a wrong-decision one - but one that could send
someone chasing the wrong fix (re-scanning a file that was never scanned). Fixed by threading the
real per-document reasons through; the discovery-feed path (no such per-document context)
correctly keeps its existing generic message. Full evidence in `docs/specs/QA-Edge-Case-
Findings.md` (Finding 7).

## This pass (2026-10-18, standing QA/robustness review - fourth run)

Rotated to the CV engine. Pulled latest `main` first (more concurrent work had landed: system
alerts, cross-tenant integrity tests, data-subject deletion, tenant isolation tests) - confirmed
this review's three prior fixes are all still present and untouched before starting.

**Found and fixed two real, severe bugs**, both in how `initial_graduated` (a key person's
graduation date) feeds "years of experience" calculations:

1. `engine/pack_generator/suggest_pack.py`'s `years_experience_at()` crashed on a malformed date
   (e.g. a typo'd month) with an uncaught `ValueError` - and because `suggest()` scores every key
   person against every required position inside one `sorted(...)` call with no per-candidate
   isolation, **one person's date typo crashed suggestion-building for the whole company**,
   blocking every other person's suggestions too. A future-dated/transposed-year grad date didn't
   crash but silently produced a negative "years of experience". Fixed: malformed or negative
   results now log a warning and return `None`, which both existing callers (CV generation,
   candidate scoring) already handle gracefully.
2. `engine/pack_generator/confirm_pack.py` - a second, independent reimplementation of the same
   computation - had the same two problems, but worse: this function's `pack.yaml` output feeds
   directly into `fill_conventional.py`/`fill_tender.py`, which types years-of-experience onto the
   real Form B2.1 in the actual submission pack. **A future-dated grad date would have put a
   negative number on a real government tender submission with nothing flagging it** - the exact
   "silently wrong, worse than a clear error" case the standing mandate names. This function's own
   docstring says it exists to "refuse to run - loudly, not silently"; fixed it to actually do
   that for both the malformed-date and negative-years cases, with clear, person-named errors
   matching every other check already in the same function.

Verified directly (not theorised): both fixes run end-to-end against real constructed fixtures,
including the exact two-candidate scoring scenario that used to crash. `admin_harness.py` (24
clean) and `general_harness.py --no-pack` + `test_general_bridge.py` (44/0/0) unaffected. Full
evidence in `docs/specs/QA-Edge-Case-Findings.md` (Findings 5-6).

## This pass (2026-10-17, standing QA/robustness review - third run)

Rotated to the non-SANRAL pack engine (`engine/general/`). Pulled latest `main` first - a large
concurrent pass had landed, including `docs/specs/Hardcoded-Assumptions-Audit.md`, a dedicated
sweep run directly off a Sarel quote nearly identical to this review's own mandate. Checked first
whether that audit had touched this review's two prior fixes: it independently re-found and more
generally fixed the first run's `fill_docx_forms.py` signatory bug (§3.1 - `key_persons_by_row()`
now matches any position by label, not just PL/DS1), keeping this review's own narrower
`role_people` mapping as a graceful fallback rather than conflicting with it; the second run's
`assess_tender.py` empty-disciplines fix is untouched and still in place under the new discipline
taxonomy. No regression either way - confirmed by re-running `admin_harness.py`.

Found and fixed one small, low-severity real bug: `engine/general/fill_sbd_docx.py`'s legacy,
production-unreachable CLI function `fill_sbd6_1()` hardcoded every company's legal form as
"(Pty) Limited" with no check against the actual company - the already-fixed production path
(`fill_sbd_document()`, same file) does this correctly. Fixed to match. Full evidence in
`docs/specs/QA-Edge-Case-Findings.md` (Finding 4).

## This pass (2026-10-17, standing QA/robustness review - second run)

Rotated to the discovery engine (`engine/discovery/`) per the standing mandate. Pulled latest
`main` first (fast-forward merge - several concurrent passes had landed: OCR for scanned
documents, deal economics, position suggestions, person registration expiry, pricing; none
touched discovery, confirmed by grep before starting).

**Found and fixed a real, production-reaching bug**: `assess_tender.assess_fit()` treated an
empty/unset `disciplines` list on a company's profile the same as "checked, out of scope" -
`not_a_fit` - instead of "no data to judge yet". Checked where `disciplines` is actually
supposed to come from: it's **never written anywhere** in the flat-file path the live national
OCDS discovery feed uses (`load_company_profile()` - no committed test-company fixture has the
field, no Company-page UI field or migration column exists for it), so in production this was
always `[]` for every real company, including Klipcorp. Confirmed directly: `assess_fit()` on a
profile shaped like every committed fixture, against a textbook SANRAL roads tender title
(exactly Klipcorp's own real discipline), came back `not_a_fit` - the verdict
`app/app/discovery/page.tsx` renders directly. A prior pass had already hit this and patched
around it, but only at one call site (`classify_tender.assess_fit_from_text()`, the manual-
intake/general-engine path) - the discovery feed's own direct call was left with the original
bug, a partial fix that looked complete because only one path had been tested.

Fixed at the root in `assess_fit()` (empty disciplines -> `needs_review`, a genuine mismatch on
a populated list still -> `not_a_fit`), so every caller gets it; simplified the now-redundant
band-aid in `classify_tender.py` to avoid stacking two near-duplicate reasons. Verified directly:
all 4 cases (empty+match, populated+mismatch, populated+match, uncategorized+empty) behave
correctly; `engine/general/test_general_bridge.py` ALL PASSED; `general_harness.py --no-pack`
44/0/0. Full evidence in `docs/specs/QA-Edge-Case-Findings.md` (Finding 3).

Flagged, not fixed: no standalone test file exists for `assess_tender.py`/`score_outlook.py` at
all - every check on this module to date, across every pass, has been informal script-at-the-
prompt verification. Also flagged: the discovery feed and the general engine derive
"disciplines" two different ways (flat-file vs. `experience_items`-backed) that happen to only
agree today because both are empty - worth unifying once a live Supabase project exists to
verify against (Gap #9).

## This pass (2026-10-17, standing QA/robustness review - first run)

New standing review, separate from the solution-architect pass above: adversarial testing of the
engines against company/tender shapes different from Klipcorp's own, per Sarel's mandate.
Evidence-first findings log now lives at `docs/specs/QA-Edge-Case-Findings.md` (new, append-only,
read that for full detail - this is the pointer).

**Found and fixed a real bug** in `engine/fill_docx_forms.py`: the C.1.2.3 Contract Data form's
"Project Leader" and "Design Specialist" key-person rows were always filled with the company's
*signatory* (`key_people[0]`), not the actually-confirmed PL/DS1 people - silently wrong (no
error, no provenance flag) for any company where the signing director isn't also the sole
technical specialist. Invisible on all 3 existing test-company fixtures and on Klipcorp's real
data only because each has exactly one key person covering every role. Confirmed by running the
real script against a synthetic 3-person profile shaped exactly as `process_pack_jobs.py`
assembles one; fixed by having `process_pack_jobs.py` pass a `role_people` PL/DS mapping through
the profile, with `fill_docx_forms.py` using it and falling back to the old behaviour when absent
(verified byte-for-byte unchanged on the 3 existing fixtures). Added a 4th committed fixture,
`config/test_companies/multi_specialist_co.json` (3 distinct people, DS **Structures** specialist
rather than every other fixture's Pavement and Materials), so the harness keeps covering this
shape. `admin_harness.py`: 24 clean / 0 flagged / 0 failures across all 4 fixtures × 6 templates.

Also read `app/lib/sanralMatrices.ts`'s 8 Design-Specialist matrices in full: the no-match
fallback (`matrixForPosition` -> `null` -> honest `[0,5]` range) is sound, not a silent-wrong-
result gate. Flagged, not yet run: `sanralScoring.ts`'s `estimatePosition()` has never been
exercised end-to-end on the other 7 DS specialisms (only Pavement and Materials, via Klipcorp's
real data) - no live Supabase to drive it through, and no standalone harness for the TS scoring
engine the way the Python fill scripts have. Next pass: either the general engine's equivalent
signatory/role-conflation risk, or scripting a direct call into `estimatePosition()` for the
other 7 specialisms.

## This pass (2026-10-17, 14:11 UTC)

One new commit: the Dashboard's tender list (`/dashboard`, the first screen after login) made
mobile-responsive — replaced a 4-column CSS grid with no breakpoint with the same flex-wrap card
pattern already used on `/discovery`, matching every other list-style screen in the app. Checked
by grep that it's layout-only: `daysUntil`/`statusFor` (the shared closing-date/status logic) are
imported and called exactly as before, untouched. `npm run typecheck`/`lint` clean. Nothing to
fix, nothing new to flag.

## Quiet pass (2026-10-17, 12:11 UTC)

No new commits since the last check-in — `origin/main` unchanged. Re-ran `npm run typecheck`/
`lint`, both clean. Nothing to fix, nothing new to flag.

## This pass (2026-10-17, 10:11 UTC): independent spot-check of the scenario pass + UI review

This is the standing regression-risk review `Engine-Scenario-Test-Results.md` (below) itself
flagged as worth checking closely. Spot-checked rather than re-running the whole thing, since the
findings doc's own evidence was already unusually thorough:

- **`app/lib/dates.ts`'s `closingDayOf()` fix** (the off-by-one-at-closing bug) — read the whole
  file: additive only, `daysUntil`/`expiryStatus` untouched, correctly wired into
  `tenderCompliance.ts` at both call sites that needed it.
- **`discovered_opportunities`'s partial-index → plain-constraint fix** — read the actual SQL in
  `0024` (not just the prose claim) and independently replayed all 25 migrations (`0001`→`0026`)
  against a fresh scratch Postgres: still clean, and the two new unique constraints
  (`company_id, ocid` / `company_id, tender_id`) exist exactly as documented, confirmed via
  `pg_constraint`.
- **`test_watch_deadlines_urgency.py`** — ran it directly rather than trusting "8/8 pass": genuine
  pass, including the two escalation cases (a document reported again once it actually expires, a
  task reported again once overdue) and the "lapses before a pursued tender's closing date, even
  outside the normal window" case.
- **CI wiring** — confirmed by grep that only `test_watch_deadlines_urgency.py` is actually wired
  into `bridge-worker-ci.yml`; `test_manual_intake.py` needs Postgres so isn't (matches the
  findings doc's own "Still open" list — not a gap I'm finding, a gap they already named).
- **`npm run typecheck`/`lint`** clean across the whole batch.

Also reviewed `0a021c6` (a design-review pass across the three newest UI features — CV
extraction review, pipeline board, admin console): found one real inconsistency (the pipeline
board's primary advance-stage button was 32px, half the 44px minimum every other primary action
in the app uses) and fixed it, correctly leaving the lighter "← Back" link alone. Good, proactive
design-consistency catch, not something I needed to do myself.

No new duplication, no regression, nothing left for me to fix this pass beyond this note.

## This pass (2026-10-17, ~09:30 UTC): manual tender load + multi-scenario engine test

Part A (manual tender load, `0024`, intake for every tender) is in the Built table. Part B ran 8 scenarios through the real engines - SANRAL complete / missing-documents, ESKOM and municipal SBD/MBD (live OCDS), no-standard-forms (live), manual load of the real R.396 portal set, malformed documents, closing-soon with expiring documents, and the two fixtures that fail at the filler. Four scenarios found silent-wrong results; all were fixed and re-run (Gap #13 lists them and what is still open). Regression after the fixes: `general_harness.py --no-pack` 27/27 match baselines, `test_general_bridge.py` 22/22, `admin_harness.py` forms 18/18 clean, `test_manual_intake.py` 44/44 on `0001`→`0026`, `test_watch_deadlines_urgency.py` 8/8, `tsc`/`eslint` clean. Full evidence: `docs/specs/Engine-Scenario-Test-Results.md`.

## This pass (2026-10-17, 08:11 UTC): independent review of the 6-agent landing

A cross-session heads-up named 6 agents working concurrently (SANRAL pack-gap closure, general
engine gap closure, an adversarial multi-scenario test pass, CV AI-extraction, a tender pipeline
board, admin review console). Scheduled myself an early check-in via `send_later` rather than
waiting the full 2-hour cycle, given the heads-up flagged shared-infra risk (job-queue
consolidation touching the bridge worker's claiming logic — code I'd just added
`fail_stale_jobs()` to). By the time the early check-in fired, 6 commits had landed
(`b45f4e4`→`584ea26`); **while writing this entry, a 7th landed mid-pass** (`464b6c3`, the
job-queue consolidation itself) — caught by re-checking `git log` before committing, not missed.

**Independently re-verified, not taken on the authors' word:**
- Replayed all 25 migrations (`0001`→`0026`, `0020` unused) against a fresh scratch Postgres —
  clean. Confirmed by searching full git history that `0020` was never a real file, just a
  same-window numbering race that settled before anything landed (see QA section).
- Read `process_pack_jobs.py`'s diff from `584ea26` line by line: the atomic claim-and-skip
  update (`status=requested` → `generating`) is untouched; the new work (Envelope 2 verification,
  `sync_tender_requirements`) is purely additive. The shared-infra risk the heads-up named did not
  materialize in that commit.
- Read `engine/cv/extract_cv_fields.py` in full: South African ID numbers are matched by checksum
  and redacted locally **before** any text reaches the Anthropic API; the model never sees or
  returns an ID number. Every proposed field carries a verbatim CV quote that's re-checked against
  the source text, and a value whose quote doesn't actually appear is left unticked rather than
  trusted. `test_extract_cv_fields.py` is wired into CI with a stub client — no `ANTHROPIC_API_KEY`
  needed to test the plumbing, confirmed by grep.
- **The job-queue consolidation did land (`464b6c3`, migration `0026_unified_job_queue.sql`) —
  and this pass tested its trickiest claim for real, not just read it.** `pack_generation_jobs`
  gains `engine`/`kind` columns; `tender_engine_jobs` is dropped and recreated as an updatable
  `security_invoker` view filtered to `engine = 'general'`, so code written against the old table
  (`pursue_discovered_opportunity()`, `load_manual_tender()`, `add_manual_tender_documents()`) was
  deliberately left untouched — the migration's own comment says inserts through the view "keep
  working," including their `ON CONFLICT` clauses. That is exactly the kind of claim to verify,
  not trust: built fixture data on the replayed schema (a real company, a real
  `discovered_opportunities` row, a real `auth.uid()`-backed membership), called
  `pursue_discovered_opportunity()` twice. First call: a real row landed in `pack_generation_jobs`
  with `engine` correctly defaulted to `'general'` by the view. Second call: correctly no-opped via
  `ON CONFLICT` (still exactly one row) rather than erroring or duplicating. Also confirmed both
  bridges poll and claim only their own engine's rows (`process_pack_jobs.py`: `engine='sanral'`;
  `process_general_jobs.py`: `engine='general'`, both in the select and the claim), and that the
  new unique index (`company_id, tender_id, engine, kind` where open) and poll index exist as
  documented. No regression found.
- **Positive finding, worth stating plainly**: the tender pipeline board's own migration
  (`0021_tender_pipeline_stage.sql`) opens with a paragraph checking `tenders.status`,
  `tender_packs.status` and `tender_tasks.kind` in turn and explaining why none of them can hold
  found/bidding/submitted/won/lost, before adding a new, clearly-named column on the existing
  `tender_packs` row rather than a new table. This is exactly the duplication-check this review
  exists to insist on, done unprompted (or in response to the proactive flag sent to the
  originating session before this landed — either way, the right outcome).
- `npm run typecheck`/`lint` clean across the whole batch.

Replying to the originating session with these findings (follow-up to the "nothing landed yet"
reply sent when the heads-up first arrived). Updated Gap #8 (the manual-tender-load upload now
proves the direct-to-Storage pattern works, for one of four capped paths) and the
migration-numbering note; everything else in the current-state tables above was already accurate.

## This pass (2026-10-17, ~08:00 UTC): SANRAL pack end-to-end inputs (Gap #12)

**Built:**
- **Key positions card = where a person confirms who fills each position.** Positions = `tender_requirements` (non-ALT) ∪ existing assignments. Each row has an inline select (`position-person-select.tsx`, same pattern as `task-assignee-select.tsx`) writing `tender_pack_assignments.confirmed_person_id` via `confirmPositionPerson()` (`pack-inputs-actions.ts`). People tagged for the position's role (`person_role_eligibility`, `roleCodeForPosition()`) are listed first. The action keeps `tender_packs.status` at `confirmed` (with `confirmed_by`/`confirmed_at`, which the bridge writes into `pack_selections.yaml`) only while every position is confirmed. A SANRAL tender with no pack gets a "Start a pack for this tender" button (`startTenderPack()`).
- **Positions come from the tender's own SETUP sheet:** `process_pack_jobs.py` `sync_tender_requirements()` runs on every poll and fills `tender_requirements` (code, description, Man/Non-Man, ALT) from any uploaded Technical workbook whose tender has none, using `suggest_pack.read_required_positions` (the same reader the confirm gate uses).
- **Blank tender templates card** (`tender-templates.tsx`): one row per `tender_documents.doc_type` (the 5 the bridge reads - `requirements.py`'s SBD/MBD categories don't apply to SANRAL), On file / Needed / Optional, upload or replace; `.xlsm`/`.docx` enforced. Migration `0025` (renumbered at push; main had reached `0024`): an insert-only storage policy on `tender-documents` for members of a company with a `tender_packs` row for that tender (`<tender_id>/<doc_type>/...`), and `record_tender_document()` (SECURITY DEFINER, same pattern as `pursue_discovered_opportunity`) that re-checks all of that, checks the object exists, upserts the row with `uploaded_by`/`uploaded_by_company`/`original_filename`, and clears `tender_requirements` when the Technical workbook is replaced.
- **Envelope 2 is its own PDF.** Convention found, not guessed: Handover §5 (pricing guard - nothing priced in Envelope 1) and §7 ("one PDF per envelope"), Deep-Dive "Two-envelope submissions" ("build the technical and pricing packs separately, each as its own PDF"), and Klipcorp's real completed submission keeps a separate "Pricing Schedule" set. `assemble_pack.py` now writes the technical pack (outer cover + Envelope 1) and `<slug>_Envelope2_Financial_Submission.pdf` (cover, Form of Offer, printed Financial workbook), each with its own contents page, stamps and bookmarks; `manifest["financial"]`, `output_files.financial_pdf`; the bridge and harness verify both. The card shows the second download.
- **`engine/print_financial.py`** prints the filled workbook's visible sheets (the set Klipcorp's real RRM print contains: exactly its 4 visible sheets, 14 pages). Plain `soffice --convert-to pdf` was tested first and rejected: 73 pages, because LibreOffice prints hidden sheets that have a print range (SANRAL's F1/payment/C3.x/ADJ calculation sheets). Reuses `print_reports.Office()`. Also exports **Form C2.4 FIN alone into Envelope 1**, because SANRAL's own note on that sheet requires a PDF copy "in the tenderer's technical proposal" (zero workplan points otherwise) - hours only, no amounts.

**Verified:**
- `0001`→`0025` (all of main plus this) replayed on a fresh scratch Postgres 16. RLS/function tests: member with a pack uploads + records (row carries uploader/company); upload under a tender without a pack, a malformed path, and a direct `tender_documents` insert are refused; wrong folder, missing object, unknown type each raise; another company can read the shared row but can't upload/record, can't see the pack, can't write or update its assignments; the confirm upsert sets and clears; replacing the Technical workbook repoints the row and clears `tender_requirements`.
- **Real Klipcorp + real R.396-010-2025/1F downloads, UI-shaped:** as the signed-in member under RLS - start pack, 5 uploads + RPC, bridge reads SETUP → PL "Project Leader" and DS1 "Design Specialist 1 - Pavement and Materials" (Non-Man, plus ALT rows), confirm Henning on both, pack status `confirmed`, insert the job → bridge `ready`: technical pack 74 pages incl. C2.4 FIN on p73, Envelope 2 29 pages (workbook pp5-29), `verify_pack` clean on both. Read back: "Klipcorp (Pty) Ltd" on every workbook page (SANRAL's "PLEASE INSERT TENDERER NAME" gone - proof the filled copy was printed), Henning on PL/DS1 rows; pages rendered and checked visually (input data, C2.4 FIN, contents); Envelope 1 text has no pricing content (only SANRAL's own note text mentions the pricing schedule).
- `bridge_selftest.py` (extended to check Envelope 2 and the SETUP sync): `ready`, 63 + 29 pages, both clean, `tender_requirements` DS1/PL + ALT.
- `npm run typecheck` / `npm run lint` clean. UI not rendered against a live project (Gap #9).


## Earlier pass (2026-10-17, admin review console)

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

## Earlier pass (2026-10-17, 06:10 UTC)

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
- **Migration numbering**: `0001`–`0026`, with `0020` never used — five-plus agents raced for migration numbers in the same window (`0023` was independently claimed by both the CV-extraction and manual-tender-load work; the admin-review-console commit's own message shows it briefly believed `0020` was CV-extraction's and `0021` was the pipeline board's; `0026_unified_job_queue` was itself drafted as `0022` and renumbered twice before landing, as other agents' `0022`–`0025` landed first). One real collision (`0023`) was caught and resolved by renumbering (`487b964`, manual tender load → `0024`) before anything landed; the `0020` gap is a harmless side effect of the same scramble, not a missing or hidden migration — confirmed by searching the full git history for any file that ever used it (none). No live collisions in the final state, verified by a full `0001`→`0026` replay.
- **RLS review**: every policy either follows the tenant-isolation default (`is_company_member(company_id)`) or carries an explicit comment explaining why it doesn't. No mismatched pattern found across any pass to date.
- **Cross-pass reuse discipline is holding up well**, worth stating plainly rather than only hunting for problems: `score_outlook.py` explicitly defers to `sanralScoring.ts` instead of reimplementing it; `daily_digest.py` imports `assess_tender`/`watch_new_tenders`/`watch_deadlines` directly rather than re-deriving their logic; `tenderCompliance.ts` reuses `app/lib/dates.ts`'s `daysUntil` rather than a third expiry implementation. Each of these was checked this pass, not assumed.
- **`admin_harness.py` currency**: real and still running the SANRAL path correctly. `--pack` adds the submission pack (and CV generation inside it), see Gap #2. Separately: on this host, the **local** form-fill baselines (`state/`, gitignored) flag 15 of 18 runs. All 15 are `a_forms.A10.deviations_or_qualifications` → assumed_default, plus a date-driven COID flip for `complete_co`. These come from earlier `fill_a_forms.py` changes, not this pass. The baselines were left as-is for the owner to accept with `--reset`.

## Open items for Sarel's own call (not decided here)

- **POPIA / security (2026-10-17/18, `POPIA-Security-Audit.md` §7):** (a) add your own user to `platform_admins` once (SQL editor) - `/admin` shows nothing until then; (b) after deploying `0043`, check for a "stays NOT VALID" warning and fix the rows it names; (c) after `0045`, companies that used another company's uploaded templates must upload their own; (d) Information Officer registration, PAIA/POPIA manual + privacy notice, operator clause in customer terms, data-processing terms and hosting regions for Supabase / Vercel / Anthropic (s 72), a breach runbook (s 22); (e) retention periods for generated packs/CVs and for a departed company's data (s 14).

- **Tender updates (2026-10-17, `watch_tender_updates.py`):** (a) how often should it run? Recommended every 2 hours, 07:00-19:00 SAST weekdays (buyers publish addenda in office hours; a briefing can be moved with 3-4 days' notice), on the bridge worker or the scheduled check-in - nothing schedules it yet. (b) A closing date read from a document is applied only when the buyer's listing shows the same date; when they disagree it is shown, not applied - OK, or should a person be able to accept it from the Workspace? (c) Should a company that starts pursuing a tender AFTER an addendum was published also get an alert for it (today: yes, once, and the Workspace card shows it either way)? (d) Should "submitted" tenders keep being watched until closing (today: yes)? (e) A moved compulsory-briefing date has nowhere to be stored (no briefing column/milestone) - add one?

- **Decisions 1-4 follow-ups (2026-10-17):** (a) `score_candidate()` is a keyword matcher on the position's SETUP description, so "Project Leader" is weak: "project"/"leader" are treated as generic words, and on R.396 every candidate scores 0 or 1 for PL - the suggestion then rests on the tie-break (years since first degree) and the card says so. Should PL suggestions use something stronger (e.g. past Position Held = PL on SANRAL projects, from the B1 matrix data already in `sanralMatrices.ts`)? That would be a scorer change, deliberately not made here. (b) Henning's real projects carry no "pavement"/"materials" wording, so for a DS1 Pavement and Materials position he is flagged "no evidence of materials, pavement" - correct per the data on file, but worth checking his project descriptions. (c) Should the general (non-SANRAL) workspace's supporting-documents list also show "Expired copy in pack" like the SANRAL compliance report does? The general pack itself already carries the warning on its checklist. (d) A private document added while a read of the tender is already running is picked up only by the next read (the queue allows one open read per company and tender) - acceptable, or re-queue automatically? (e) Private documents can't be attached to a manually loaded tender through the new card - by design, since that tender is already private and has "Add documents and re-analyse".

- **Company voice:** (a) **Fixed this pass** (see "CV cover-page internal-text fix" above): the tender-specific CV cover page no longer prints tool-internal text (script names, a docs/ file path, the raw match score/rationale, "people/projects schema" wording) - every CV generated now reads as a plain, buyer-appropriate document, verified by regenerating and reading back real output. Still open for Sarel: whether the match score/rationale concept is worth keeping as a genuinely *internal* reviewer aid (e.g. a separate internal-review copy or a Tender-Workspace-only view) now that it's been stripped from the document that actually gets submitted - no internal-copy-vs-submitted-copy distinction exists in the code or data model today, so for now it only survives in `generated_cvs`' `.provenance.json` and the existing `pack_suggestions.json`/Tender Workspace surfaces, not on the CV itself. (b) OK to show `how_we_work` verbatim, read-only, beside the B4/B5 "complete by hand" item on the Tender Workspace as reference for whoever writes it? Not generated. **Standing discipline:** any new buyer-facing output must check whether it needs the company's own words. If it does, use them verbatim, never an LLM paraphrase. If they are blank, leave the spot visibly blank. Full rules in the deep-dive spec's "No AI-drafted narrative sections" section.

- **CV AI-extraction** (`CV-Extraction-Findings.md` §7-8): create an Anthropic API key and set `ANTHROPIC_API_KEY` on the worker; share 3-5 real team CVs to measure against; scanned CVs are now OCR'd locally (experimental) - decide whether to keep that (`OCR-Evaluation.md`) or send scans to Claude as images (unredacted ID numbers would leave the machine); Opus 5.5 (default) vs Haiku 5.5; columns for other professional bodies.

- General engine (Gap #1): (a) overlay - **built** (label-anchored, not fixed x/y; Round 4). Open: is a "check, then sign" review of each typed page acceptable to Sarel, or should typed pages need an explicit "reviewed" tick before the pack is marked ready? (b) buyer forms - **built** for the CEQ and Form of Offer (the evidence put the CIDB forms ahead of ESKOM's for Klipcorp's disciplines); next from the backlog: certificate of authority? (c) should the company telephone / e-mail / CIDB grading (0018) also be editable on the Company page (today: captured on the Tender Workspace), and should a CIDB registration (CRS) number column be added for the CEQ? (d) **built** by the manual-tender-load work (0024).
- Gap #5 follow-up: rewriting `admin_harness.py` to read a real company's data from Supabase instead of local JSON fixtures, and deciding where an `is_test_company` toggle should live in the admin UI. Both need a live Supabase project to build and verify against properly.
- Gap #7 vault fields: **answered and built** (Sarel's 8/9/10, migration `0014`). Still open: Klipcorp's ISO certificate number and expiry, and whether the EME affidavit is accepted the same way as the QSE one (assumed, not confirmed).
- Gap #8: the manual-tender-load path proves direct-to-Storage upload works past ~4.4 MB — worth porting the same pattern to CV uploads, experience evidence and the vault, or is per-path effort not justified yet?
- Questions 3/5/6/11 (evidence rules, roles, role tagging, office locations): **answered and built** (`0015`, `0016`). New questions are at the end of `Tender-Evaluation-Engine-Audit.md` "Round 2":
  - Klipcorp's real offices;
  - which roles to tag Henning for;
  - seeding `tender_requirements`;
  - new discipline buckets;
  - per-schedule compliance.
- **Submission pack (Gap #12):** position confirmation now lives on the Key positions card, template upload on the Tender Workspace, and Envelope 2 is a separate PDF (documented convention). Still for Sarel: (a) is the Conventional Financial print right as "every visible sheet" (25 pages: input data, all 8 hours sheets incl. "not used" disciplines, All Hours, C2.4 FIN, Pricing Schedule, Summary Tendered Fee)? It follows Klipcorp's real RRM print, but no real completed *Conventional* financial print exists in the repo to compare; (b) should the Form of Offer also be in Envelope 1? (placed in Envelope 2 as in the real sample); (c) the signatory question above; (d) should one company's template upload be replaceable by another company working on the same tender (today: yes, recorded per row)?
- **Deploying the bridge worker** (Railway Hobby, $5/mo, recommended; steps in `Automated-Fulfillment-Deployment.md`). It needs a Railway account plus the Supabase URL and service-role key, so it can only happen once a live Supabase project exists. A scheduled GitHub Action was considered and rejected, with evidence, in that doc (GitHub's Actions terms, 5-min floor, auto-disable after 60 idle days).
- **Pipeline board (item 10):** (a) should a tender auto-advance to "submitted" when its pack is ready? Not done: "pack ready" means a PDF exists, not that it was handed in (submission happens on the buyer's portal or by hand), so the only automatic move is found → bidding on a pack request. (b) Should "Prepare this tender" on Discovery count as bidding? Today it lands at found, since it's also used just to read a tender's requirements. (c) The Tenders tab (dashboard) still lists every shared tender with pack status; fold it into the board, or keep both?
- **Scenario pass (`Engine-Scenario-Test-Results.md` "Open decisions"):** (1) ~~expired vault documents in a SANRAL pack~~ - **answered** (included, with a warning, plus a per-pack checklist - built); (2) ~~a project whose type exists only in the other SANRAL family~~ - **answered and built**: a project whose type a position's form doesn't offer is left off that position's Form B1 with a note (it was per position, not per family; `Hardcoded-Assumptions-Audit.md` §1); (3) ALT positions on SETUP get the same person as the primary slot - correct? (4) ~~manual tenders private~~ - **answered** (yes; confirmed and three leaks closed, `0032`); (5) ~~private documents on a shared tender~~ - **answered and built** (`0032`); (6) ~~OCR for scanned tenders~~ - **built as an experiment** (`OCR-Evaluation.md`, recommendation: keep with caveats) - keep or drop is Sarel's call.
- **Tender notes + activity log (item 15):** (a) the activity log shows only the **latest** task status/assignee change and the **latest** pipeline move (`tender_tasks`/`tender_packs` overwrite in place, so a tender moved bidding → submitted → won shows "Submitted" and "Won", but not "Bidding"), and neither records **who** made that change. A full trail would need a small trigger-written events table on those two tables. That is the one place a "history" table would add real information. Worth it, or is latest-only enough? (b) People are named by their sign-in e-mail, because no display name exists for a user. Add a `company_members.display_name`? (c) Should notes be visible to the whole company (today), or only to people with a `tender_role` that can see that tender's work? (d) Pre-existing, found while testing: the `requested_by`/`created_by`/`uploaded_by` FKs to `auth.users` have no `on delete` action, so removing a user who ever requested anything fails at the database. The new `tender_comments.author_id` uses `set null`.
- **Reuse of past submissions (item 9):** (a) per-tender uploads the vault has no field for (CIPC documents, director IDs, municipal account, public liability...) are re-uploaded on every general tender - add vault fields for the stable ones, or copy the file on reuse? (b) copied declarations aren't marked as copied once applied (only the preview and banner say so) - worth a "carried over from X" note per answer (needs a column)? (c) should "Mark submitted" on the Pipeline board offer the reuse card for the next tender, or is the Workspace enough?
- **Deal economics (items 26, 27, `0034`):** (a) one credited person per tender - the spec also says "who worked on" it; is a single "credit" enough, or should several people (with a split) be recorded? (b) commission is a record only (percent or flat amount + note) - is any calculation/payout tracking wanted later? (c) the submitted price is typed by hand; should it be read back from the filled Financial workbook (Envelope 2) once pricing is in? (d) ~~sector uses the 7 Discovery discipline buckets - fine-grained enough?~~ sector is now any of the 93 disciplines of the maintained list (0040; e.g. road maintenance vs road construction vs consulting engineering), rolled up to its group in the history (e) item 27's sibling "public award data": capture now built report-only (`award_outcomes.py`, see Built table) - storing it and showing it next to `/pipeline/pricing` waits on the item below.
- **Public award data / market feedback (items 17, 28; `Award-Price-Analysis-Findings.md` §6):** storage and UI now built (`0053`). Still yours: (a) SANRAL's terms say "no charge ... upon any recipient" - OK inside a paid product, or ask SANRAL? (`sources` lets a deployment drop SANRAL rows); (b) competitor framing - today other firms are named only on registers of tenders the company itself bid on + a "firms you have bid against" table; segment level is counts only. Named segment leaderboards: yes / opt-in / no?; (c) the drafted POPIA lawful-basis paragraph (migration header) into the POPIA section?; (d) company aliases (JV / trading names) for matching?; (e) backfill depth + refresh cadence. CIDB's contractor register still not built (contractors only).
- **Form-field audit (2026-10-18, `Form-Field-Audit.md` §12):** Q1 one rule for SANRAL A11 4.1-4.4 (assumed No) vs general SBD 8 (never assumed); Q2 a per-tender "bidding as a JV?" on SANRAL (A3, Form B3 JV share, consolidated JV certificate); Q3 a per-bid contact-person question (SBD 1 / CEQ now assumed = signatory); Q4 directors/members register (one director + "list the rest by hand" today); Q5 C33 for affidavit holders (kept "Verification Certificate", assumed - follows Q-R1); Q6 SANRAL briefing row always mandatory; ~~Q7 Form B7 capture~~ (built upstream, `0056`); Q8 hours sheets PL/DS1 only; Q9 CVs print "MISSING" / internal wording; Q10 pre-selected "No" for foreign-based; Q11 existing companies' Form B3 zeros; Q12 delivery-address extraction tuned on R.396's notice; Q13 Form B1 "full time" when not recorded; Q14 fixtures without B-BBEE proof types.
- **Hardcoded-assumptions audit (`Hardcoded-Assumptions-Audit.md` §7):** ~~Q1~~, ~~Q4~~, ~~Q7~~ answered and built (§8). New, from that pass: ~~(a) should synthetic `is_test_company` companies get Discovery rows~~ - **answered and built** (yes, included by default; §9.1); (b) should an AI step ever compose a letter from a *descriptive* guideline ("formal tone, mention our board resolution"), or only ever place facts into the company's own wording, as built? (c) Klipcorp's own authority letter now shows "not set up" until its real letter (Drive: "Letter of Authority to Sign_Klipcorp .docx") is uploaded on its Company page - upload it, or write its guideline? ~~(d) the Discovery seen store is still a local JSON file per deployment~~ - **answered and built** (`0038`, per company x release; §9.2); ~~(e) wire the digest's live mode to per-company scoring~~ - **built** (§9.3). New, from the (a)/(d)/(e) pass (§9.4): ~~re-surface a release when a company's profile changed~~ - **answered and built** (re-scored + reported again, §11.1); ~~move `watch_deadlines.py`'s and the digest's readiness seen stores into the database~~ - **answered and built** (`0041`, plus a whole-codebase sweep, §11.2); seen-before-seeded gap (a failed seed loses those opportunities) - still open; ~~retry `ERROR` verdicts~~ - **answered and built** (retried every run and recorded in `system_alerts`, §11.1/§11.3). New, from the §11 pass: see "Open questions from the 19:00 pass" in that pass entry. Still open: Q2 the DS Engineering Geologist has a Book 1 matrix but no workbook codes; ~~Q3~~ (answered and built: own maintained list, §10.1); Q5 per-tender C3.1.11 extraction (~~SACNASP/SAGC fields~~ built, §10.2); Q6 SANRAL contractor tenders / other document sets; Q8 further specific-goal kinds.
- Whether/how to wire real notification sending (email) for the daily digest and the document-expiry/task reminders — both currently report-only by design, pending a decision on the send mechanism. **Decided for system alerts (2026-10-17):** the same report-only boundary, with the e-mail sent by the external scheduled Claude check-in that has Gmail access - it needs `python3 engine/alerts/check_system_alerts.py --out ...` added to its run (not done from here: it is that session's prompt, not code in this repo).

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

### Flat-PDF overlay, CIDB buyer forms, one job queue (2026-10-17)

Closes the four items the non-SANRAL automation agent left open. Full evidence: `General-Tender-Preparation-Findings.md`, "Round 4".

**Built:** `engine/general/fill_flat_pdf.py` (label-anchored overlay: table cells, dotted leaders same/next line, drawn underlines, captions, Yes/No tick/circle; read-back of every value; clash and pre-print guards), wired through `requirements.py` (status `overlay`, buyer-form `overlay`) and `build_general_pack.py` (typed copy in the pack, provenance per field, guide notes); field maps for MBD/SBD 1, 4, 9, the Compulsory Enterprise Questionnaire and the Form of Offer offer block; `pdfplumber` added to the worker requirements; 2 new harness samples (`overberg_q12`, `ecdpwi_scmu5_0007`). Migration `0026_unified_job_queue.sql` (`engine`/`kind` on `pack_generation_jobs`, rows moved, `tender_engine_jobs` kept as a view); `process_pack_jobs.py` filters `engine = 'sanral'` (poll + stale sweep, nothing else touched), `process_general_jobs.py` uses the shared table with `engine = 'general'`; general workspace/actions read and write `pack_generation_jobs`. Item 3 (manual load) had landed concurrently (`8945b0b`) in the same pipeline - not duplicated.

**Verified:** 15 real flat PDFs / 14 buyers, read-back + by-eye render checks (7 placement bugs found and fixed that way); Overberg full pack 69 pages `verify_pack` clean; `general_harness.py` 11 samples x 3 companies, all expectations met (a first full run had two failures - RAF's `.doc` conversion and one contents-page render - caused by `soffice` failing under concurrent LibreOffice use from other agents on this host; both samples pass when re-run alone); `test_general_bridge.py` all passed; `test_poll_loop.py` passed; `0001`→`0026` replay + RLS/constraint/view tests + 0024's functions through the view; `bridge_selftest.py` (SANRAL, real SQL) `requested`→`ready` on the unified table. `npm run typecheck` / `lint` clean.

**Not verified / open:** no live Supabase (Gap #9); the workspace UI changes are typechecked, not rendered; overlay layouts beyond the 14 buyers seen are covered by the read-back and "check, then sign", not by eye.

### Tender notes + activity log, item 15 (2026-10-17)

**What "version history" means here, checked before building.** I read every table that changes over a tender's life. Each one already keeps its own timestamp, and usually who did it: `tender_tasks`, `tender_packs` (`0021`), `tender_documents` (`0025`), `pack_generation_jobs`, `generated_cvs` and `tender_answers`. Nothing a company edits on a tender is a document with drafts, which is what a versioning system would protect. The generated packs and CVs are rebuilt from the data and kept per request. So "version history" was built as one activity feed over those rows, plus the new notes: no history table, no triggers, no "version every field". I grepped first for an existing activity, audit or history pattern in `app/` and the migrations and found none, so this is the first one. **Limit, stated in the UI too:** status and stage changes overwrite in place, so only the latest is visible, without an actor (open item above).

**Built / verified:** see the Built table row. Migration numbered `0033`: main had `0001`–`0026` + `0030`. Other worktrees held uncommitted `0029` (×2), `0030`, `0031` and `0032`, so this skips past them.

### Tender deal economics, items 26 + 27 (2026-10-17)

**Built:** migration `0034_tender_submission_economics.sql` (price, VAT flag, credited person, commission % or amount + note, sector, note, timestamp on `tender_packs`; same-company trigger), `app/lib/dealEconomics.ts`, `economics-form.tsx` + `saveTenderEconomics` on the Pipeline board, `/pipeline/pricing`. **Why `tender_packs`:** both facts are per company per tender (exactly that table, with RLS); checked first that nothing held a price (`tenders` is shared buyer data, `pack_generation_jobs` only records whether the Financial workbook was printed, `score_outlook` never estimates price). **Why the Pipeline board:** the submitted/won/lost transition is where the figure is known; the pricing history is a sub-page of the board, not a Dashboard addition. **Numbering:** drafted as `0029`; main had moved to `0033` by the rebase, so landed as `0034`. **Verified:** see the Built table row. **Open:** see "Open items for Sarel" (Deal economics).

### Pack Review: a pre-compile confirm-or-change screen (2026-10-18)

Sarel: "For each tender before compiling it, share the full list of info, answers, signatures, documents, CVs, alternative options etc to show what is identified to be used to compile the pack so the company have an easy way to confirm or change it." Before this, the only pre-compile view was the Submission pack card's gap list plus one "acknowledge gaps anyway" checkbox - no preview of the actual content.

**Built:** `pack-review-data.ts` (`loadPackReviewSnapshot`, React `cache()`) assembles one live snapshot per tender: company master data (`companies` table), key positions/people/CVs (`tender_pack_assignments`, `generated_cvs`, `cv_uploads`), form answers with provenance (`field_provenance`), the chosen signatory (`tender_answers` + `people.signatory_capacity`), supporting/vault documents (reusing `compliance-data.ts`'s own `docItems` have/check/missing list rather than re-deriving it), Form B7 (`b7-data.ts`), and the `typical_jv_share_pct` field shown as-is (no JV math - out of scope per Sarel's earlier instruction). It also builds a pre-generation preview checklist in the exact `ChecklistRow` shape `pack-checklist.tsx` already renders post-generation, so the same component (`PackChecklist`) renders both. The pure classification rules (what counts as confirmed/missing/warning for a position, a document, a signature, Form B7) live in `pack-review-logic.ts` with no Supabase/React/Next imports, so they're unit-testable without a database; `pack-review-data.ts` is a thin Supabase-reading shell around them. Each of the 7 sections is wrapped in its own try/catch - one bad record shows "couldn't load this section" instead of crashing the whole card (same per-item isolation discipline as this session's batch date-parsing fixes). `pack-review.tsx` renders it as its own card (`#pack-review`), one `<details>` sub-section per category with a status pill per item and a "Change" link/anchor to the existing editable card (`#key-positions`, `#readiness-report`, `#submission-pack`, `#tender-templates`, `#form-b7`, or `/company` for company-level fields), plus one "I've reviewed this" confirm action.

**Migration `0059_pack_review_confirmations.sql`:** a new `pack_review_confirmations` table (one row per company x tender, `reviewed_at`/`reviewed_by`), not a column on `pack_generation_jobs` - the review has to exist *before* the first pack request, and a tender can be requested many times across its life, so it's keyed per tender, not per request. `pack_generation_jobs` also gains `reviewed_at`/`reviewed_by` as an audit copy of which review a given request relied on (same naming convention as `admin_harness_runs`, `0022`). Deliberately no staleness-clearing trigger (unlike `0022`'s): a later edit is still caught by `requestSubmissionPack()`'s own live hard blockers regardless of this table, so a review only ever has to answer "did a human look at the list at some point", which is what the button gates on.

**Wiring:** `requestSubmissionPack()` (`actions.ts`) now requires a `pack_review_confirmations` row to exist (regardless of whether there are gaps) instead of the old `acknowledge_gaps` checkbox; the checkbox and its UI are removed from `submission-pack.tsx`, replaced with a banner pointing at the Pack Review card and a disabled "Generate submission pack" button until reviewed. The hard blockers (unconfirmed key position, missing template, Form B7 blocker, a pack already queued) are untouched - this is additive, not a replacement of real validation.

**Verified:** `pack-review-logic.test.ts` (Node's built-in test runner, `node --experimental-strip-types --test`, since the repo has no jest/vitest yet) - 19 cases including the two required scenarios (everything confirmed = all green; missing CV / missing signatory / a Form B7 warning = the right mixed statuses), all passing. `npm run typecheck` and `npm run lint` clean across the whole `app/` tree. `next build` compiles and type-checks cleanly, then fails at the same pre-existing `/login` prerender (no Supabase credentials in this sandbox) - unrelated to this change. `*.test.ts` added to `tsconfig.json`'s `exclude` (Node's type-stripping needs an explicit `.ts` import extension that `tsc`'s own bundler resolution rejects without `allowImportingTsExtensions`).

**Not done / open for Sarel:** JV share and B-BBEE/SANAS verification are explicitly out of scope here (JV math and the B-BBEE investigation are Sarel's own, per earlier direction) - the review screen only displays `typical_jv_share_pct` as-is. Nothing verified against a live Supabase project (same standing gap as every other pass this session).

### Multiple signatories per company, optionally scoped (2026-10-18)

Sarel, verbatim: "Add option to record multiple signatories to use for a company and then they select which one to use. A company might get people to tender based on area or type of project."

**Research first.** `people.signatory_capacity` (`0001`) was already a free-text field, not a single yes/no - so every person with it set was already a signatory, and `submission-pack.tsx` / the new Pack Review screen (`a03f518`) already read ALL of them and offered a `<select>` once there was more than one. "Multiple signatories" therefore already worked, by accident of there never having been a single-signatory column to begin with. What was actually missing, matching Sarel's own example ("area or type of project"), was a place to record which region/industry/discipline each signatory is normally used for, so the per-tender picker suggests the right one instead of just the oldest person on file - and a selector that shows up (and explains itself) at 0, 1 and 2+ signatories, not only at 2+.

**Built:**
- Migration `0061_signatory_scopes.sql`: `signatory_scopes` (`company_id`, `person_id`, `region` free text, `industry_tag`/`discipline_tag` referencing `discipline_categories`, `0040`) - zero or more rows per person, each one OR'd across people, AND'd within its own non-null columns. No rows = unscoped, still a full selectable signatory. Reuses the same industry/discipline tag vocabulary `tenders.industry_tags`/`discipline_tags` (`0060`, landed the same day) are matched against, rather than inventing a second taxonomy. Tenant-isolated the same way as `people` (`is_company_member`); cascades on person delete.
- `app/app/tenders/[id]/signatory-logic.ts`: pure `pickDefaultSignatory()` - scores each recorded signatory against one tender's region/industry/discipline tags (discipline match > industry match = region match) and returns the best one, ties broken by list order (the old "first on file" behaviour), `null` only when there are zero signatories. No Supabase/React import, same testable-without-a-database split as `pack-review-logic.ts`.
- `app/app/people/[id]/page.tsx` + `app/app/people/actions.ts` (`addSignatoryScope`, `deleteSignatoryScope`): a "Signatory scope (optional)" card on the person page, shown once `signatory_capacity` is set, to add/remove region and/or industry/discipline tags (industry list + discipline list reuse `app/lib/disciplineTaxonomy.ts`, the same taxonomy the Experience Library and pricing form already read). Explicitly worded as advisory-only: it never blocks picking anyone else.
- `submission-pack.tsx`: the per-tender selector now reads `signatory_scopes` + the tender's own `region`/`industry_tags`/`discipline_tags` and pre-selects `pickDefaultSignatory()`'s pick (marked "(suggested)" in the list) instead of always the oldest signatory; three states instead of one - 0 signatories shows a prompt to add one on the People page, 1 shows that person's name plainly, 2+ shows the `<select>`. Still writes to the same `tender_answers` row (`field_key = 'signatory_person_id'`) `requestSubmissionPack()` already validates and the pack bridge already reads - additive on the person side only, no change to how the per-tender choice is stored or to that server action's own validation.
- `pack-review-data.ts`'s Signature section: same scoped `pickDefaultSignatory()` call feeds `signatureStatus()`'s `fallback` input, so the "chosen signatory" status pill still reads correctly when nobody has explicitly picked yet - it now shows the scoped suggestion instead of always the first signatory on file. `pack-review-logic.ts`'s `signatureStatus()` itself is unchanged in behaviour (its `fallback` input always meant "whichever signatory would be used by default"; it just means something smarter now).

**Deferred, on purpose:** linking a signatory's scope directly to the structured region/industry data from today's `0060` tagging work was available (it landed first), so this was NOT deferred - `signatory_scopes.industry_tag`/`discipline_tag` reference `discipline_categories` directly, same as `tenders.industry_tags`/`discipline_tags`. The only thing left free-text is `region`, because no SA region/province catalog exists anywhere in this schema yet (`tenders.region`, `0001`, is itself free text from the source listing) - matched case-insensitively, trimmed. Electronic signature capture/upload is explicitly out of scope per this task's own instructions (a separate legal-research task is still checking ECTA/B-BBEE/SANRAL rules) - this only ever selects whose name and capacity are recorded, never a signature image or mark.

**Verified:** `signatory-logic.test.ts` (Node's built-in test runner, same `node --experimental-strip-types --test` pattern as `pack-review-logic.test.ts`) - 10 cases: 0 signatories (null, no crash), 1 signatory (always picked, scoped or not, even when its only scope doesn't match), several signatories with no scoping at all (falls back to list order), a single region match, case/whitespace-insensitive region matching, a discipline match outranking a broader industry match, two signatories whose scopes both partially match (higher score wins), no scope matching this tender at all (falls back cleanly), and that the pick is always a member of the passed-in `signers` list (never injects or filters anyone out - the free-override guarantee). `npm run typecheck` and `npm run lint` clean across the whole `app/` tree. `next build` compiles and type-checks cleanly, then fails at the same pre-existing `/login` prerender (no Supabase credentials in this sandbox) - unrelated to this change, same standing gap noted in the Pack Review entry above.

**Not done / open:** nothing verified against a live Supabase project (same standing gap as every other pass this session).

### Market-tendering trend from past winning prices (2026-10-18)

Sarel (paraphrased, final piece of a longer ask): "once we get winning prices we can use to adjust our pricing engine to improve estimates and start building market tendering trends for similar future projects and improve our estimated project value." This builds ON `public_tender_outcomes` (`0053`, winning prices/B-BBEE/bidders per real tender) and `tenders.industry_tags`/`discipline_tags` + `tender_scope_records.value_band` (`0060`, both landed earlier the same day) rather than duplicating either - no new identifier scheme was needed: `tenders.id` already joins all three.

**Built:**
- Migration `0062_market_trend_by_tags.sql`: `market_trend_for_tags(p_tags, p_value_band, p_window_months default 24)`, a live SQL function (not a materialized view or cached table - justified in the migration's own header: the outcomes dataset is small and still growing pre-launch, there is no live Supabase project running this yet to refresh a cache against, and a stale cached aggregate would be dishonest with no real performance win at today's row counts; revisit as a materialized view once real volume justifies it). It joins `public_tender_outcomes` to `tenders` by the same ocid/SANRAL-reference match `tender_market_outcomes()` (`0053`) already uses, then `tenders` to `tender_scope_records` (`0060`) by `tenders.id`, filtered to `status = 'awarded'` and `competitive = true` only (no price competition to benchmark from a sole-source/emergency award). It returns, per tag group: the comparable award count and date range; winning price as a % of the buyer's own stated estimate - computed ONLY where `tender_scope_records.value_band_basis = 'stated_in_text'` and the amount is positive, never against a null/unknown estimate or a BOQ total (none is extracted, per `0060`); bidder-count median; and the winning B-BBEE level distribution. Every aggregate carries its own sample size.
- `app/lib/marketTrendLogic.ts`: the honesty gate as a pure function (`gateMarketTrend()`, no Supabase/React/Next imports, same split as `pack-review-logic.ts`) - below `MARKET_TREND_MIN_SAMPLE` (5, the same reasoning as `marketPricing.ts`'s existing `MIN_SAMPLE`/`THIN_SAMPLE` convention - reused, not reinvented) comparable awards, nothing is shown at all; the price-vs-estimate figure is gated a second time on its OWN sample, since most comparable awards have no stated estimate even once the headline count clears the first gate.
- `app/lib/marketPricing.ts` `loadMarketTrend()`: a thin Supabase-reading shell around the pure gate - calls the RPC, hands the row to `gateMarketTrend()`.
- `app/app/tenders/[id]/market-context.tsx`: a new "Market tendering trend" block on the existing Tender Workspace Market card, alongside (not replacing) the per-tender published-outcome display and the existing "Similar published tenders" benchmark table. Reads the tender's own `industry_tags`/`discipline_tags` and `tender_scope_records.value_band` (narrows the comparison when the tender itself states one; most won't, which is fine - the trend is scale-free and still useful without it), loads the trend, and - only when there is one - shows "Based on N comparable past awards (date range). Where the buyer stated an estimate (M of those), winners typically priced at X% of it", bidder-count median, and the B-BBEE level distribution, each explicitly labelled "Historical reference only ... not a prediction or a recommended price." `market-comparison.tsx` (`/pipeline/pricing`, the company's own priced tenders only) was deliberately left untouched - it has no natural discipline/value-band grouping of the company's own tenders without extra joins that weren't asked for, and the Tender Workspace is where a value band for a new tender is actually seen.
- `engine/discovery/test_market_trend.py`: offline checks that the migration's SQL text encodes every honesty rule above (awarded+competitive only, the join key, never dividing by a null/zero estimate, the live-function-over-materialized-view choice) and that `engine/fill_financial.py` has zero uncommitted changes this session (`git diff --quiet HEAD`) - the actual pricing/BOQ-fill engine was never touched. A live-Postgres part (`MARKET_TREND_PSQL`, same env-var-gated shape as `test_award_prices.py`'s Part 2) is included but skipped here (no scratch Postgres in this sandbox).
- `app/lib/marketTrendLogic.test.ts` (Node's built-in test runner): 9 cases covering the minimum-sample-size gate (nothing below it, something at exactly it), the pct-of-estimate figure firing only on its own sufficient sample even when the overall count is large, zero-stated-estimate never fabricating a ratio, Postgres numeric-as-string coercion, B-BBEE pass-through, and a custom minimum sample.

**Honest about today's data:** with no live Supabase project yet and `public_tender_outcomes` still a small, growing dataset, this feature's real trend output is thin-to-empty right now by construction, not by a bug - `MARKET_TREND_MIN_SAMPLE` means most tag/value-band combinations will show nothing at all until enough real awards accumulate. That is the intended behaviour, not a gap to close.

**Not touched, on purpose:** `engine/fill_financial.py` and the rest of the SANRAL pricing/BOQ-fill engine (confirmed via `test_market_trend.py`'s git-diff check) - the priced BOQ stays the tenderer's own business decision; this feature only ever reads published outcomes for display, never sets or suggests a bid price.

**Verified:** `npm run typecheck` and `npm run lint` clean across the whole `app/` tree (checked the touched files directly; the full-tree run was skipped only because of concurrent uncommitted work from other sessions in this shared sandbox at the time - the touched files themselves are clean). `node --experimental-strip-types --test app/lib/marketTrendLogic.test.ts` - 9/9 pass. `python3 engine/discovery/test_market_trend.py` - all offline checks pass, including the `fill_financial.py`-untouched check. Nothing verified against a live Supabase project or a live scratch Postgres (same standing gap as every other pass this session).

### Three standalone free tools: deadline, CIDB grade, B-BBEE preference points (2026-10-18)

The standing Solution Architect review's TenderFlow feature-parity gap check (verified by grep against the actual codebase, not assumption) recommended exactly these 3 standalone free lead-magnet tools, in priority order, because they reinforce "correct, not AI-guessed" without touching AI-drafting or generic bid-management (both out of scope per `docs/strategy/Marketing-Pricing-Strategy.md` §6.3). Saved-filter keyword alerts and a pack approval/sign-off workflow were explicitly named out of scope for this pass (the former would dilute the existing per-company fit-scoring; the latter needs Sarel's own scoping call) and neither was built.

**Built**, all three genuinely standalone - no sign-in, no company record, no tender record required to use any of them:
- `app/lib/publicHolidays.ts` + `/tools/deadline-calculator`: the SA public holiday table (Public Holidays Act 36 of 1994 Schedule 1 - 10 fixed-date holidays computed per year rather than hardcoded, Good Friday/Family Day derived from Easter Sunday via the Meeus/Jones/Butcher algorithm, plus the s2A "fixed holiday on a Sunday moves the following Monday" rule), `addBusinessDays()` (add/subtract N working days) and `businessDaysBetween()` (count working days between two dates). Covers 2025-2027 by construction (the table is computed, not a static list, so any future year works without code changes).
- `app/lib/cidbGrading.ts` + `/tools/cidb-grade`: the published cidb Standard for Contractor Grading Designation value bands, Grade 1 (up to R200 000) through Grade 9 (uncapped, above R130 000 001) - the same bands for every class of construction work (GB, CE, EB, EP, ME, SB, SC); `requiredGradeForValue()` and `gradeSufficientForValue()`. No standalone CIDB-vs-value calculator existed before this - CIDB only appeared inline as a stored field (`companies.cidb_grading`, `generalTender.ts`, `disciplineTaxonomy.ts`'s `cidb_classes`), confirmed by grep before building.
- `app/lib/preferencePoints.ts` + `/tools/bee-preference-points`: the actual PPPFA Preferential Procurement Regulations, 2022 reg 4/reg 5 price-points formula (`Ps = 80 x (1 - (Pt-Pmin)/Pmin)` at or below the R50m threshold, `Ps = 90 x (...)` above it - `docs/specs/Tender-Regulatory-Compliance-Review.md` §2.1, read first rather than re-deriving it) plus the Treasury SBD 6.1 B-BBEE status-level specific-goals table (Level 1 = 20/10 points down to Level 8 = 2/1, non-compliant = 0) that SANRAL and most organs of state publish unchanged (same table `engine/discovery/score_outlook.py`'s `_bbbee_points_by_level()` already parses from a buyer's own document). Confirmed by grep (`Pmin`, `Ps =`) before building that `tenderCompliance.ts` tracks B-BBEE level and flags preference-point risk conceptually but never computed the formula anywhere - this is the first place it's actually calculated. The UI is explicit that the PPR 2022 itself sets no fixed B-BBEE table (reg 3(1): each buyer defines its own specific goals) - the level table used is the common case, not a guarantee, and always subordinate to the tender's own stated system/goals.
- `/tools`: a simple index page linking the three, styled with the existing navy/`#16233B` + amber/`#D97706` card convention (`SiteNav.tsx`, `/login`) but with its own public header (no `SiteNav`, which requires a Supabase session) since these pages take no session and no per-request data - plain client components, not `instant = false` routes.
- `docs/specs/System-Status.md`: new Built-table row (above) for all three.

**Verified:** `publicHolidays.test.ts` (11 cases: full 2026 table, Easter-derived dates for 2025/2026/2027 against known reference dates, the s2A Sunday-holiday rule, `isBusinessDay` on weekends/holidays/an ordinary day, `addBusinessDays` from an ordinary day, skipping a holiday mid-window, starting FROM a non-business day itself - both a weekend and a holiday, spanning the Dec/Jan year boundary across Christmas, going backwards, and `businessDaysBetween` forward/same-day/backward-is-negative), `cidbGrading.test.ts` (6 cases: table contiguity with no gaps/overlaps, every published boundary value, invalid input, grade/band round-trip, sufficiency check), `preferencePoints.test.ts` (9 cases: the R50m threshold boundary itself, both systems' max points, the reg 4 worked example by hand - 10% above Pmin on an 80/20 contract scores exactly 72 of 80 - and the same ratio on 90/10, rounding, a non-positive Pmin throws, every level in the SBD 6.1 table on both systems, the full `calculatePreferencePoints()` breakdown on both systems and with an explicit system override) - all 26 cases pass via `node --experimental-strip-types --test`. `npm run typecheck` and `npm run lint` clean across the whole `app/` tree (no errors introduced; two pre-existing unrelated lint issues fixed as part of getting a clean run: an unused import and several unescaped quote/apostrophe characters in the new pages themselves).

**Not done / open:** CIDB's "potential grading" mechanism (a contractor's track record earning it a higher grade) is out of scope by design - this tool only answers "what grade does this value require", not "what grade would my history earn me". No gazetted one-off public holiday (Public Holidays Act s2(2)) is in the table, since none is predictable in advance - `EXTRA_HOLIDAYS` in `publicHolidays.ts` is the place to add one once gazetted. Nothing rendered in a browser against a live Supabase project (same standing gap as every other pass this session) - these pages need no Supabase at all, but were only typechecked/linted/unit-tested, not opened in a real browser.

### Bulk onboarding document scan (2026-10-18)

Sarel: instead of a company manually uploading and tagging each compliance document one at a
time, bulk-upload a folder/zip of everything it already has, let the system identify what each
document is and extract its key fields, then show a review screen to confirm or correct each one
before anything is saved to a real table. Modelled directly on the CV AI-extraction precedent
(`engine/cv/extract_cv_fields.py` + `CV-Extraction-Findings.md`) - read side by side with the new
code, not re-derived: text extraction with OCR fallback, one structured-output LLM call per
document, quote-verification against the source text, a proposal row nobody but an explicit
human confirm writes anywhere real.

**Correction found while building this** (the task's own v1 mapping assumed it, incorrectly): a
CIDB certificate does NOT route to `held_registrations`. Migration `0050`'s own seed row for the
`cidb` registration type sets `stored_in = 'companies.cidb_grading'`, and
`tt_held_registrations_check()` refuses any `held_registrations` insert whose type has `stored_in`
set - a CIDB row would fail outright. `companies.cidb_grading` (`0018`) is a plain text column
with no document or expiry slot at all - the one real gap in the Document Vault (`0014` covers
COID/SARS/PI insurance/ISO/bank/B-BBEE, never CIDB). Migration `0063` adds `cidb_expiry` +
`cidb_document_path` to `companies`, completing the vault the same way `0014` did for every other
document, rather than forcing CIDB through the wrong table or inventing a new one.

**Built:**
- Migration `0063_onboarding_document_scan.sql`: a new private `onboarding-documents` Storage
  bucket (path-prefix tenant isolation, same pattern as every other bucket here - unclassified,
  unconfirmed files deliberately don't share a bucket with real compliance documents);
  `onboarding_uploads` (one row per uploaded file, same request/status shape as `cv_uploads`,
  `0008`) and `onboarding_document_results` (the AI proposal, same shape as
  `cv_extraction_results`, `0023` - `review_status` starts `pending_review`, never auto-applied);
  plus the CIDB vault columns above. `batch_id` is a plain client-generated uuid column, not its
  own table (same "no separate batches table" choice `manualTender.ts`'s `tenderId` already made)
  - nothing about a batch is ever queried except "every upload with this batch_id".
- `engine/onboarding/classify_documents.py`: the classification/extraction logic (text
  extraction + OCR fallback reusing `scan_ocr.py`/`requirements.py` outright; a filename/keyword
  pre-filter, `keyword_hint()`, passed into the prompt as an explicit HINT ONLY - never the
  classifier, never skips the LLM call or the quote-verification step, proven by a test that
  greps `validate_proposal`'s own source for the absence of a `keyword_hint` call); one
  structured-output Messages API call per document with a `document_kind` enum (the v1 type list
  + `unknown`) and one flat `fields` object covering every kind (mirrors how
  `extract_cv_fields.py` already handles two kinds with one shared field set); quote-verification
  and date/digit checks reused directly from `extract_cv_fields.py` (`evidence_in_text`,
  `normalise_date`, `find_and_redact_sa_ids`, `_norm`/`_digits`), not re-implemented. SA ID
  numbers are matched locally and never sent to the model, same as the CV pipeline. For a
  `document_kind` of `cv`, no field extraction happens at all here - see handoff below.
- `engine/onboarding/process_onboarding_jobs.py`: the queue runner (claim/release/fail/stale-
  reclaim), same shape and the same `supabase_request`/`storage_download` helpers imported
  outright from `engine/cv/process_cv_jobs.py` / `extract_cv_fields.py`. Registered in
  `engine/worker/run_bridges.py` as the `onboarding` bridge.
- `app/app/company/document-scan/`: a new Company sub-page (linked from `/company`'s
  "Directors, registrations & property" section, same card convention as Principals/
  Registrations). `upload-form.tsx` uploads straight from the browser to the
  `onboarding-documents` bucket (same reason and the same pattern as the manual tender load's
  `manual-tender-form.tsx` - a Server Action's body is capped at 4.5 MB on Vercel, and a batch of
  certificates together would blow past that), then registers the batch
  (`registerOnboardingBatch`). `review.tsx` is the confirm-or-correct screen: a status pill per
  document (same convention as the Pack Review screen), per-field tick + editable value + source
  quote + warning (same layout as `cv-review.tsx`), and for `id_document`/`cv` a required picker
  (which director/shareholder, which person) since there is no way to know who a bare ID or CV
  belongs to from the document alone.
- `app/app/company/document-scan/actions.ts` - the only code that writes an AI-proposed
  onboarding document anywhere real, and only on explicit confirm, routing each v1 kind to its
  already-existing table/column:
  - `cidb_registration`, `bbbee_certificate`, `sars_tax_clearance`, `bank_confirmation_letter`,
    `pi_insurance_certificate`, `iso_9001_certificate` → `confirmVaultDocument`, ticked fields
    onto the matching `companies.*` columns (`app/lib/onboardingScan.ts`'s
    `VAULT_FIELD_COLUMNS`/`VAULT_DOCUMENT_COLUMN`) + the file copied into the `company-documents`
    vault bucket.
  - `experience_reference_letter` → `confirmExperienceReferenceLetter`, inserts an
    `experience_items` row (`0012`), file copied into `experience-documents`. Left untagged
    (`tagged_at` null) on purpose - tagging is its own deliberate manual step per `0012`'s own
    design, not something a reference letter alone can honestly auto-classify.
  - `id_document` → `confirmIdDocument`: **found a real slot the task's own research didn't
    name** - `company_principals.certified_id_path`/`certified_id_filename`/`certified_id_on`
    (`0050`) already exists for exactly this. The reviewer must pick which principal before
    filing (never guessed); if nobody is on the register yet, the screen says so and links to
    `/company/principals` instead of inventing anywhere else to put it.
  - `cv` → `confirmCvHandoff`: a HANDOFF, not a second extraction - copies the file into
    `cv-documents` and inserts the exact `cv_uploads` row (`mode: 'ai_extract'`,
    `status: 'extraction_requested'`) the People page's own upload form inserts, after the
    reviewer picks which person. `engine/cv/extract_cv_fields.py` then takes over completely
    unchanged - this module's own LLM call extracts nothing for a CV, only recognises one.
  - `professional_registration_other` (ECSA/SACPCMP/SACNASP/SAGC/PSIRA etc.) and `unknown` are
    never auto-routed - shown as "needs manual review" with a link (Registrations page / general
    Company profile), explicitly acknowledged (`skipOnboardingDocument`) rather than silently
    dropped. Out of v1 scope per the task's own instruction: these have dedicated, higher-stakes
    per-person UI and this tool shouldn't guess which body or person they belong to.
- `app/lib/onboardingScan.ts`: the shared constants/types, including the routing map as pure
  data/functions (`VAULT_FIELD_COLUMNS`, `VAULT_DOCUMENT_COLUMN`, `VAULT_SUBFOLDER`,
  `parseBeeLevel()` - `companies.bee_level` is an int, the model returns text like "Level 2") so
  the mapping itself is unit-testable separately from the Supabase/redirect plumbing around it.

**What got a real existing table/column (v1 "routable" set):** CIDB (→ `companies.cidb_*`, a
correction - not `held_registrations`), B-BBEE, SARS TCS, bank confirmation letter, PI insurance,
ISO 9001 (all → `companies.*` vault columns), experience/reference letters (→ `experience_items`),
ID documents (→ `company_principals.certified_id_path`, found during this build, not assumed
missing), and CVs (→ handoff into the existing `cv_uploads` pipeline, never re-extracted). Nothing
in this pass needed a brand-new generic document-type table - every v1 kind had, or (CIDB) nearly
had, a real home already.

**Deliberately not routed:** `professional_registration_other` (ECSA/SACPCMP/SACNASP/SAGC/SACAP/
PSIRA/...) and `unknown` - flagged for manual review, per the task's own scope decision.

**Not done / open for Sarel:** cloud-storage connectors (Google Drive/SharePoint) are explicitly
out of scope for this pass - the staging/job-queue shape (`onboarding_uploads` rows feeding the
same classification pipeline) would let one feed in later without a schema change, but no OAuth/
connector integration was built. The keyword/filename pre-filter is currently prompt-only (never
skips the LLM call) - if real volume later justifies actually short-circuiting obvious filename
matches to save cost, that would need its own confidence-threshold design, not assumed safe by
default. Nothing verified against a live Supabase project or against a real Anthropic API call
(same standing gap as every other AI-extraction pass this session - `extract_cv_fields.py`'s own
Claude call has never run live either).

**Verified:** `python3 engine/onboarding/test_classify_documents.py` - 1 of 1 passed internally
(39 checks: text extraction + generic failure wording, the keyword-hint-is-advisory-only guarantee
including a source-grep proof, `validate_proposal()` for one representative document per routed
kind - CIDB/B-BBEE/SARS/ID/bank/PI insurance/ISO/reference letter - plus
`professional_registration_other`/`unknown` never auto-routed, the quote-verification gate on
invented string/date values, `call_llm()`'s request shape and stop-reason handling against a stub
client, and queue plumbing: claim, missing-key put-back, success, a no-text-layer scan failing
with no API call made, and stale-claim reclaim). `node --experimental-strip-types --test
app/lib/onboardingScan.test.ts` - 8/8 pass (every document kind is exactly routable-or-unrouted
never both/neither, the CIDB correction encoded as a test, every vault kind's written columns are
a subset of the fields the model was actually asked for, `parseBeeLevel()` on real and edge-case
input). `npm run typecheck` and `npm run lint` clean across the whole `app/` tree. `next build`
compiles and type-checks cleanly, then fails at the same pre-existing `/login` prerender (no
Supabase credentials in this sandbox) - unrelated to this change, same standing gap as every other
entry in this file. Nothing verified against a live Supabase project or a live Anthropic API call.

### Pack Review for general (non-SANRAL) tenders (2026-10-19)

A standing QA finding noted that SANRAL's Pack Review (`0059`, 2026-10-18 above) had no
equivalent for general tenders - those route through `engine/general/`,
`general-workspace.tsx` and `requestGeneralPack()`/`generate_pack`, with no confirm-before-compile
step before that button's job gets queued. This task built that equivalent, reusing the SANRAL
pattern rather than duplicating it.

**What's actually different about a general tender (confirmed by reading the real code, not
assumed):** no Form B7, no two-envelope structure. People are matched to roles via
`person_role_eligibility` tags (`0016`/`0031` - any number of people per role) rather than
SANRAL's one-person-per-position `tender_pack_assignments`; CVs for a tagged role come from the
same `generated_cvs`(`status='ready'`)/`cv_uploads` lookup `engine/general/process_general_jobs.py`'s
own `gather_pack_inputs()` does when it actually builds the pack, kept in sync so the review
screen never promises a CV the pack itself can't find. What this tender's forms/documents/
questions actually are is read per-tender from `tenders.document_requirements`
(`engine/general/requirements.py`'s manifest), not from a fixed SANRAL-style list - so "form
answers" here means the manifest's own `questions`/`company_fields`, and the signatory is just
another `type: "person"` question (same `signatory_person_id` field-key convention as SANRAL,
no region/industry/discipline default-signer suggestion - that's SANRAL's `signatory_scopes`,
`0061` - so there is no fallback to pre-select, only chosen-or-not).

**Built:** `general-pack-review-logic.ts` - pure classifiers for what's different
(`answerStatus`, `roleStatus`, `signatureAnswerStatus`, `localityStatus`), importing only the
`ReviewStatus`/`ChecklistStatus` *types* from `pack-review-logic.ts` (fully erased, no runtime
coupling) rather than re-exporting its runtime helpers - `docItemStatus`/`fieldStatus` are
imported directly from `pack-review-logic.ts` by callers instead, since a runtime
`export ... from` here breaks Node's own module resolution when the test file is run directly
(`node --experimental-strip-types`, no bundler) even though it works fine under Next's bundler -
found by actually running the new test, not assumed. `general-pack-review-data.ts`
(`loadGeneralPackReviewSnapshot`, React `cache()`) assembles the live snapshot: company
details/tender questions/signature, supporting documents (reusing `checkReturnable()` from
`lib/generalTender.ts` - the exact function `general-workspace.tsx` itself uses, not re-derived),
roles & CVs (`person_role_eligibility`), company experience evidence (`findMatchingExperience()` +
`evaluateEvidence()`, same as `general-workspace.tsx`), and office location (`matchLocality()`).
Same per-item try/catch error isolation as `pack-review-data.ts` - one bad section renders
"couldn't load this section" instead of crashing the card. `general-pack-review.tsx` renders it
as its own card (`#general-pack-review`), mounted inside `GeneralTenderWorkspace`
(`general-workspace.tsx`) directly above its "Generate the pack" section - same
`<details>`-per-section, status-pill, "Change"-link-to-anchor, "I've reviewed this" shape as
SANRAL's `pack-review.tsx`, reusing `PackChecklist`/`ChecklistRow` (`pack-checklist.tsx`, already
generic, not SANRAL-specific) unmodified.

**Data model: no new table.** `pack_review_confirmations` (`0059`) is schema-generic - just
`(company_id, tender_id, reviewed_at, reviewed_by)` - so it's reused as-is for general tenders;
no migration added by this task. `general-pack-review-actions.ts`'s `confirmGeneralPackReview()`
upserts the same row `pack-review-actions.ts`'s `confirmPackReview()` does for SANRAL (kept as a
separate action only because the redirect anchor differs, `#general-pack-review` vs
`#pack-review`, and that file is SANRAL-only by repo convention).

**Wiring:** `requestGeneralPack()` (`general-actions.ts`, via the shared `requestJob()` it and
`requestRequirementsExtraction()` both call) now requires a `pack_review_confirmations` row to
exist before it will insert a `generate_pack` job - additive to every existing check in that
function (a tender with unanswered questions or missing documents still generates a draft with
blanks, by design; this only blocks an *unreviewed* compile, the same scope SANRAL's own gate
has).

**Verified:** `general-pack-review-logic.test.ts` (same `node --experimental-strip-types --test`
pattern, run from a bracket-free temp copy since Node's own `--test` glob matcher cannot handle
the literal `[id]` path segment - confirmed by reproducing the same 0-tests-collected result on
the untouched SANRAL `pack-review-logic.test.ts` run the same way, so it's a Node/shell quirk, not
a regression) - 16 cases including the two required scenarios (everything confirmed = all green;
missing signatory / nobody tagged for a role / no local office = the right mixed statuses), all
passing; the existing `pack-review-logic.test.ts` still passes unchanged (35/35 across both files
together). `npm run typecheck` (`tsc --noEmit`) and `npx eslint` clean on every new/changed file
and the whole `app/` tree. Nothing verified against a live Supabase project.

**Not done / open for Sarel:** per-person professional registrations (SACNASP/SAGC/catalog bodies)
that `general-workspace.tsx` shows are not repeated as separate review items here (same rationale
SANRAL's own review uses for ECSA/SACPCMP counts: those are company-aggregate facts, already
implicitly covered, not a separate confirm-or-change decision). The SANRAL Pack Review screen and
its logic/data/actions/test files (`pack-review*.ts(x)`) were not touched at all by this task.
