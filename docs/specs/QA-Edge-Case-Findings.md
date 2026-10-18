# QA / Edge-Case Findings

Standing adversarial review (Sarel's mandate, 2026-10-17): run real test cases against the
engines - not just Klipcorp's own data and the handful of real sample tenders seen so far -
and find the places where a different company's or tender's shape would silently produce a
wrong result instead of failing loudly. **Append-only.** Each run gets its own dated section;
don't rewrite earlier entries. `System-Status.md` gets the one-line pointer and any Built-table
update; this file carries the actual evidence.

---

## 2026-10-17 (first run): SANRAL submission pack - company shape diversity

**Why this area first:** Sarel's own framing for this standing review named the SANRAL pack
pipeline's handling of a company/tender shape very different from Klipcorp's as the freshest
concern. All prior scenario-testing (`Engine-Scenario-Test-Results.md`) exercised tender-shape
diversity (different buyers, families, malformed documents) thoroughly, but all three
`config/test_companies/*.json` fixtures - and Klipcorp's real data - share one company shape:
**exactly one key person, who is simultaneously the signatory, the Project Leader, and the
Design Specialist.** That's a reasonable shape for a one-person consultancy; it is not the
general case, and the fixtures' own comments already said so (`complete_co.json`'s
`_single_key_person_note`) without anyone having tested what actually happens otherwise.

### Finding 1 (CONFIRMED, FIXED): C.1.2.3 Contract Data form filled the signatory's name into the
Project Leader and Design Specialist rows, not the actual confirmed position-holders

**Where:** `engine/fill_docx_forms.py`, `fill_contract_data()` / `main()`.

**What was tested:** Built a synthetic profile shaped exactly the way
`engine/pack/process_pack_jobs.py`'s real `gather()` assembles one for a live pack-generation
job - `key_people[0]` = the company's signatory (first person with `signatory_capacity` set),
`key_people[1..]` = the actually-confirmed position-holders, in SETUP-required order (this is
documented in `process_pack_jobs.py`'s own comment at the time: "the signatory first ...
then every confirmed key person"). Gave the signatory role to a managing director who holds
neither the PL nor the DS1 position - an ordinary shape for any company with more than one
qualified technical person, and the shape this review was specifically asked to go looking for.
Ran the real `fill_docx_forms.py` against this profile and the real `R.396-010-2025.1F`
`C.1.2.3_Contract_Data.docx` template (not a mock), then read the generated `.docx` back with
`python-docx`.

**What broke:** The filled document's key-person table showed the signing director's name
against BOTH the "Project Leader" row and the "Design Specialist" row - not the names of the
people actually confirmed for those positions. No error, no missing-field flag, no provenance
warning: the document looked completely filled in, and would have gone into a real SANRAL
submission with the wrong person's name on the two most scrutinised rows of the Contract Data
form.

**Root cause:** `main()` always built `key_persons = {1: henning, 3: henning}` where
`henning = profile["key_people"][0]` - i.e. it hardcoded the signatory into every key-person row,
never looking at `key_people[1:]` at all, even though `process_pack_jobs.py` puts the real PL and
DS1 people there. This was invisible on every existing fixture and on Klipcorp's real data only
because, in all of them, the signatory IS the sole PL/DS1 person - key_people[0] happened to be
the right answer by coincidence, not by the code actually tracking which role is which.
`fill_a_forms.py`'s own identical `key_people[0]` read was checked too and is **not** affected -
every field it uses that person for (declaration blanks, footer, A10, A16) is genuinely a
signatory-only field, confirmed by reading each call site.

**Fix (contained, applied this pass):**
- `engine/pack/process_pack_jobs.py`'s `gather()` now also builds `profile["role_people"]`, a
  `{"PL": <person>, "DS": <person>}` mapping (keyed by SETUP position code with the trailing
  digit stripped - `"DS1" -> "DS"`, same convention `app/lib/sanralMatrices.ts`'s `baseCode()`
  already uses) straight from the same `required`/`by_code`/`key_people` data it already had, so
  it costs nothing to compute.
- `engine/fill_docx_forms.py`'s `main()` now reads `role_people.get("PL", henning)` /
  `role_people.get("DS", henning)` for the two key-person rows, falling back to the signatory only
  when `role_people` is absent (every existing admin-harness fixture, and any company where one
  person really does cover every role) - so behaviour for every company already exercised is
  byte-for-byte unchanged.

**Verification:**
- Re-ran the exact repro profile with `role_people` added: "Project Leader" row now correctly
  shows the confirmed PL's name, "Design Specialist" row the confirmed DS1's name, and the
  Form of Offer's signatory field (a genuinely different field) still correctly shows the
  director's name - all three read back from the actual generated `.docx`, not inferred.
- Regression: ran `engine/admin_harness.py` before and after the fix (git-stashed the diff to get
  a clean "before" run) - the three existing fixtures' provenance counts
  (`confirmed`/`missing`/`assumed_default`) are identical before and after: `complete_co`
  24/15/7, `expired_certs_co` 23/15/7, `new_co` 18/20/7, on all 6 tender templates, for both runs.
  No regression.
- Added a fourth, permanent test-company fixture,
  `config/test_companies/multi_specialist_co.json`, carrying `role_people` directly (the one
  field the three pre-existing fixtures never needed, because none of them has more than one key
  person) so this exact bug class stays covered by the harness going forward, not just by this
  one-off repro script. Also deliberately a different discipline from every existing fixture
  (Design Specialist - **Structures**, not Pavement and Materials - see Finding 2). Harness run
  clean (24/6 - all three old fixtures plus the new one, across all 6 tender templates); read the
  new fixture's own generated `C.1.2.3_Contract_Data_FILLED.docx` back directly to confirm the
  correct names land in the correct rows, not just that the run didn't crash.
- `python3 -m py_compile` clean on both changed files. Not re-run against `bridge_selftest.py`
  (needs a scratch Postgres with all 26 migrations replayed plus LibreOffice - out of scope for
  this pass's time budget; the fix only touches `gather()`'s in-memory dict construction and
  `fill_docx_forms.py`'s already-isolated `main()`, neither of which bridge_selftest exercises
  differently from the direct repro above).

**Scope note, not fixed (pre-existing, unrelated to this bug):** the C.1.2.3 template itself only
has one printed "Design Specialist" row. If a Conventional tender ever requires more than one DS
specialism (e.g. both DS1-Pavement and DS2-Structures), `role_people` would only resolve the
first DS position it iterates (first-match via `setdefault`), same single-DS-slot assumption
`fill_conventional.py`'s own "137 = DS1 = table row 3" comment already encodes. Every real
Conventional Book 1 template seen so far asks for exactly one DS position, so this hasn't been
observed in practice - flagging it so a future tender with two DS slots isn't a surprise.

### Finding 2 (coverage gap, not yet a bug): no test coverage for 7 of SANRAL's 8 Design
Specialist disciplines

`app/lib/sanralMatrices.ts` carries real Book 1 scoring matrices for 8 DS specialisms (Pavement
and Materials, Structures, Electrical, Geometrics, Traffic and Transportation, Geotechnical,
Electronic Systems, Engineering Geologist). Every test-company fixture before this pass used only
Pavement and Materials - Klipcorp's own real discipline. `matrixForPosition()`/`DS_SPECIALISMS`
in `sanralMatrices.ts` were read in full this pass: the regex-matching fallback is sound (a
specialism description that matches none of the 8 `match` regexes correctly returns `null` ->
`estimatePosition()`'s `projectTypePoints()` then returns the honest full `[0,5]` range rather
than a wrong point value - checked, not a silent-wrong-result gate). `multi_specialist_co.json`
(added this pass) now gives the harness's docx-forms-fill path a Structures specialist. The
*scoring* side (`sanralScoring.ts`'s `estimatePosition()` on a DS Structures position) was read
and reasoned about but not run end-to-end this pass - no live Supabase/company record exists to
drive it through the web app (Gap #9), and the TS scoring engine has no standalone harness the
way the Python fill scripts do. **Flagging for a future pass**, not filing as a bug: run
`estimatePosition()` directly (it's a pure function, callable from a small Node/ts-node script
with no Supabase needed) against each of the 8 DS specialisms with varied project histories, to
check the matrix lookups and the "doesn't match any experience row" fallback for each one, not
just Pavement and Materials.

### Not yet tested this pass (deliberately deferred, named so the next pass doesn't re-derive this)

- The general (non-SANRAL) engine's equivalent risk: does `engine/general/`'s pack assembly ever
  conflate the company's signatory with a specific confirmed role the way this bug did? Not
  checked this pass - the SANRAL C.1.2.3 form was chosen because its hardcoded row-index
  convention made the risk concrete and checkable in one script; the general engine's form-fill
  (`fill_sbd_docx.py`, `fill_flat_pdf.py`) is label-anchored rather than role-indexed, which may
  or may not carry the same risk - worth a dedicated look.
- `sanralScoring.ts`'s `estimatePosition()` across the other 7 DS specialisms (Finding 2, above).
- A company whose SETUP sheet requires a position this project's scoring/filling code has never
  seen in any fixture - e.g. `RM`/`ARM` (Resident Manager / Alternate), or `PE(E)` - to see
  whether the gates there are as sound as the PL/DS ones were found to be, or have the same class
  of silent-wrong-result risk under a different variable name.

---

## 2026-10-17 (second run): Discovery - the national OCDS feed's fit scoring

**Why this area:** rotating through the engines per the standing mandate - discovery
(`engine/discovery/`) hadn't had this review's attention yet. Pulled latest `main` first
(`git merge --ff-only`) - several concurrent passes had landed (OCR, deal economics, position
suggestions, person registration expiry, pricing) since the first run; none touched the files
below, confirmed by `grep` before starting.

### Finding 3 (CONFIRMED, FIXED): discipline-fit scoring treats "no disciplines recorded" the
same as "checked, out of scope" - silently marks matching tenders "not_a_fit" for every company

**Where:** `engine/discovery/assess_tender.py`, `assess_fit()`.

**What was tested:** `profile.get("disciplines", [])` is the list `assess_fit()` compares a
tender's keyword-matched category against. Checked where that list is actually supposed to come
from for a real company, not just read the code in isolation:
- Every one of the 4 committed `config/test_companies/*.json` fixtures (the day-one 3 plus
  `multi_specialist_co.json` added in the first run of this review) has **no top-level
  `company.disciplines` field at all.**
- `grep`ed the whole `app/` tree: no Company-page field, no Server Action, and no migration ever
  writes a `disciplines` column on `companies`. The only `disciplines` concept the web app
  actually has is `experience_items.disciplines` (migration `0012`, the Experience Library's
  per-evidence tags) - a different table entirely.
- `engine/discovery/load_company_profile()` (used by `watch_new_tenders.py`/`run_discovery.py`,
  i.e. the live national OCDS feed path) reads `company.disciplines` straight off a flat JSON
  file - it has no code path to Supabase's `experience_items` at all.
- `engine/general/process_general_jobs.py`'s `profile_from_company()` (the general-engine/manual-
  intake production path) **does** correctly derive `disciplines` from tagged `experience_items`
  rows - but that function is never called by the discovery feed path.

So in production, for every real company (including Klipcorp, whose own real profile JSON
follows the identical flat-file shape as the fixtures), `assess_fit()`'s `known_disciplines` is
always `[]` when reached via the discovery feed. Confirmed by running `assess_fit()` directly
(not theorised) with a profile shaped exactly like the committed fixtures against a textbook
SANRAL roads tender title ("Appointment of a consultant for the upgrade of Route R.396 Section
10" / "Rehabilitation of pavement and stormwater") - precisely Klipcorp's own real discipline.

**What broke:** verdict came back `not_a_fit`, with the reason "Discipline (roads_civil) doesn't
match the company's known disciplines" - confidently wrong, not an honest "unknown". This is the
verdict `app/app/discovery/page.tsx` renders directly (System-Status's Built table: "genuinely
wired end-to-end"), so the live Discovery page would show a company's own bread-and-butter work
as a flat rejection, system-wide, for every tenant, with nothing in the UI suggesting the
rejection is actually "we have no data to judge this."

**Doubly confirmed this is a real, already-known-about risk, not a one-off):**
`engine/intake/classify_tender.py`'s `assess_fit_from_text()` (the manual-tender-intake /
general-engine call site) already has a band-aid for exactly this -
`if not profile.get("disciplines"): ... verdict = "needs_review"` - added by an earlier pass that
evidently hit this same wrong-rejection behaviour and patched around it **at its own call site**
instead of in `assess_fit()` itself. That left the discovery feed's own direct call to
`assess_fit()` (via `assess_release()`) with the original, unpatched bug - a partial fix that
looked complete because the one path someone happened to test (intake) was covered.

**Fix (contained, applied this pass):**
- `assess_tender.assess_fit()` now treats an empty/missing `disciplines` list as "no data to
  judge" -> `needs_review` (same honest-uncertainty treatment the `uncategorized` branch already
  gets), separately from a populated list that genuinely doesn't include the matched category,
  which still correctly returns `not_a_fit`. This is the root fix, so every caller gets it -
  not just the one that was patched before.
- `classify_tender.assess_fit_from_text()`'s existing band-aid is now redundant for the case it
  was written for, so simplified it to swap in its more specific, actionable message ("...they
  come from your Experience Library tags...") in place of `assess_fit()`'s generic one, instead
  of stacking both - checked directly that only one reason line results, not two near-duplicates.

**Verification (real execution, not just read-through):**
- Empty disciplines + matching category -> `needs_review` (was `not_a_fit`).
- Populated disciplines that genuinely don't include the category -> still `not_a_fit` (the real
  mismatch case keeps working).
- Populated disciplines that do include the category -> still `strong_fit` (unchanged).
- Uncategorized tender + empty disciplines -> unchanged `needs_review` with its original,
  unrelated reason (categorization failure, not a disciplines problem - confirmed the fix didn't
  touch this branch).
- `classify_tender.assess_fit_from_text()` with empty disciplines -> exactly one reason in the
  list mentioning the Experience Library, not two.
- `engine/general/test_general_bridge.py` (fake-Supabase, no live project needed): **ALL PASSED**
  after the fix - this is the suite that exercises `classify_tender.py` against real documents,
  so it's the one regression check that could have caught a breakage here.
- `engine/general/general_harness.py --no-pack`: 44 clean / 0 flagged / 0 failed across all 4
  test companies.
- `python3 -m py_compile` clean on both changed files.
- No standalone test file exists for `assess_tender.py` itself (`engine/discovery/` has none) -
  flagging that as a real gap (see below), not claiming coverage that doesn't exist.

### Not yet tested this pass (deferred)

- No unit test file for `engine/discovery/assess_tender.py` or `score_outlook.py` exists at all -
  every check on this module across every pass to date (including this one) has been informal
  script-at-the-prompt verification, never a committed, re-runnable test. Worth a dedicated pass:
  a small `test_assess_tender.py` with the four cases verified by hand above, so this exact bug
  class can't silently regress.
- Whether `load_company_profile()` should itself be extended to read `experience_items` the way
  `process_general_jobs.profile_from_company()` does, so the discovery feed and the general
  engine derive "disciplines" the same way instead of two different mechanisms (one Supabase-
  backed, one flat-file) that happen to agree only by also both being empty today. Not done this
  pass - `load_company_profile()` takes a file path, not a `client`/`company_id`, so unifying it
  is a real refactor, not a one-line change, and needs a live Supabase project to verify against
  (Gap #9).
- Malformed/boundary OCDS releases (missing title, non-ASCII buyer names, a closing date with no
  timezone) through `assess_release()` end-to-end - not reached this pass, which focused on the
  fit-scoring gate itself once it was found to be wrong for literally every company.

---

## 2026-10-17 (third run): non-SANRAL pack engine - checked against a concurrent, very thorough
audit; one small real fix landed

**Context:** rotated to `engine/general/` per the standing mandate. Pulled latest `main` first
(fast-forward - a large concurrent pass had landed: discipline taxonomy overhaul, tender-update
watching, company-documents engine, person registration expiry, and a dedicated
`docs/specs/Hardcoded-Assumptions-Audit.md` run directly off a quote from Sarel - "don't base
limitations and specs only on klipcorp's submissions... scan all code to make sure our sample of
tenders and klipcorp info is not assumed... as the only source" - which is essentially this same
standing review's mandate, run as a one-off deep pass). Checked first, before doing any new work,
whether that audit had already covered - or broken - anything this review had touched:

- **Finding 1 (fill_docx_forms.py's C.1.2.3 signatory bug, first run of this review) was
  independently found again by that audit** (its own §3.1, same root cause, same evidence
  shape - a different person confirmed for PL vs DS1) and fixed **more generally** than this
  review's own fix: `key_persons_by_row()` now matches ANY position by its printed Book 1 title,
  not just PL/DS1, reading employment status from a new `people.employment_status` field instead
  of assuming "Permanent" for everyone. This review's narrower `role_people` PL/DS mapping
  (`process_pack_jobs.py`) is kept as a fallback for callers with no full `pack.yaml` (confirmed
  by reading the current code: `key_persons = assignments_from_pack(pack_path); if key_persons is
  None and profile.get("role_people"): ...`) - not a conflict, a graceful layering. Re-ran
  `admin_harness.py` to confirm `multi_specialist_co.json` (added by this review for exactly this
  shape) still runs clean under the new, more general code.
- **Finding 3 (assess_tender.py's empty-disciplines bug, second run)** is untouched by the new
  discipline-taxonomy work (`engine/discovery/taxonomy.py`) - confirmed `known_disciplines` and
  the `elif not known_disciplines:` branch this review added are both still present, just now
  feeding a richer `tax.overlap()` call instead of a plain `in` check. Not a regression.

Both checks are good news, not wasted effort: independent convergence on the same two real bugs
from a different angle is exactly the kind of cross-check this review is for.

### Finding 4 (CONFIRMED, FIXED, low severity): `fill_sbd_docx.fill_sbd6_1()`'s legacy CLI path
hardcoded every company's legal form as "(Pty) Limited"

**Where:** `engine/general/fill_sbd_docx.py`, the standalone `fill_sbd6_1()` function (and its
siblings `fill_sbd1()`/`fill_sbd4()`, called only via this file's own `main()` CLI entry point -
confirmed by `grep`ing the whole repo that `build_general_pack.py`/`process_general_jobs.py`
(the real production pipeline) call `fill_sbd_docx.fill_sbd_file()` -> `fill_sbd_document()`
instead, a separate, newer, more careful implementation in the same file).

**What was found:** `fill_sbd6_1()` always wrote `log.confirmed("sbd6_1.company_type", "(Pty)
Limited")` with no check against the company's actual legal form - true for every fixture in
this repo (all 4 are "(Pty) Ltd"), but a Close Corporation, sole proprietor, trust or public
("Limited") company run through this CLI would get a materially false declaration confirmed on a
real SBD6.1 "Preference Points Claimed" form. The production path (`fill_sbd_document()`, same
file) already does this correctly - `if re.search(r"\(Pty\)", legal or ""): ...` - so this was a
real, live discrepancy between two implementations of the same form, not a theorised one.
`docs/specs/Hardcoded-Assumptions-Audit.md` §3.2 had already flagged this exact legacy CLI
(`fill_sbd1()`'s telephone/email hardcoding) as a "before" artifact while fixing the production
path only - this is the sibling bug in `fill_sbd6_1()` that was left behind in the same pass.

**Severity, honestly stated:** low - this CLI is not reachable from the web app or the job queue,
only from someone running `python3 fill_sbd_docx.py` by hand (as `General-Tender-Engine-
Findings.md`'s own original verification run did, against real Treasury/RAF samples). Fixing
it anyway because it's cheap, it's a real false-declaration risk on a government form if anyone
ever does run it that way again, and leaving a known-wrong answer next to its own
already-fixed sibling in the same file is confusing for whoever reads this code next.

**Fix:** same conditional check as the production path, copied in rather than reimplemented
differently - `if re.search(r"\(Pty\)", comp.get("legal_name") or ""): confirmed ... else:
missing ("Tick the company type by hand...")`.

**Verification:** regex check against a `(Pty) Ltd` name and a `CC` name branches correctly;
`python3 -m py_compile` clean; `test_general_bridge.py` ALL PASSED; `general_harness.py
--no-pack` 44/0/0 (this file's production path, `fill_sbd_document()`, wasn't touched by this
fix at all, so this is confirming no regression rather than testing the fix itself - the fix's
own correctness was verified by direct logic check, since no test exercises the dead CLI path).

### Not pursued this pass

Given how much of this exact territory the concurrent Hardcoded-Assumptions-Audit had just
covered in depth (SANRAL position-matching, telephone/email, toll code spelling, experience
discipline defaults, C3.1.11 "SANRAL-wide" framing, the non-SANRAL role catalog's own honesty
about its limits), this pass stayed short and cross-checking rather than duplicating that work.
Next rotation (per the standing list): CV, intake, compliance/reminders, notify, or
worker/job-queue - none of which that audit touched.

---

## 2026-10-18 (fourth run): CV engine - malformed/boundary dates cascading through the whole
candidate-scoring and pack-confirmation pipeline

**Context:** rotated to the CV engine per the standing mandate. Pulled latest `main` first
(fast-forward - more concurrent work had landed: system alerts, cross-tenant integrity tests,
data-subject deletion, a tenant-isolation test suite, tender-update resolution). Re-confirmed
this review's three prior fixes are all still present and untouched by the new work before
starting.

### Finding 5 (CONFIRMED, FIXED, severe): one key person's malformed graduation date crashed
candidate-scoring for the WHOLE company, not just that person

**Where:** `engine/pack_generator/suggest_pack.py`'s `years_experience_at()`, the shared helper
both `score_candidate()` (used by `suggest()` when ranking every key person against every
required position) and `generate_cv.py` (CV generation) call.

**What was tested:** boundary/malformed input on `qualifications.initial_graduated` - a typo'd
month (`"2008-13-01"`), a non-ISO format a human might type (`"01/2008"`), and a future-dated (or
transposed-year) graduation (`"2028-01-01"` against a 2026 closing date) - exactly the "unusual
dates at edge cases" class the mandate calls out, run against the real function, not theorised.

**What broke:** the first two raised an uncaught `ValueError` straight out of
`datetime.date.fromisoformat()`. Confirmed where this actually lands:
`suggest_pack.suggest()` calls `score_candidate()` inside a single `sorted(...)` over *every* key
person for *every* required position, with no per-candidate error isolation - so one person's
date typo raised all the way up through `sorted()` and crashed suggestion-building for the whole
company, blocking every OTHER person's suggestions too, not just the one with bad data. Ran this
exact scenario for real (two candidates, one with a good date, one with `"2008-13-01"`): before
the fix, the good candidate's score was never even computed. The third case (future-dated grad)
didn't crash, but returned `-1` - a negative "years' experience" that would have printed on a
real CV or a suggestion rationale as its own silently-wrong result.

**Fix:** `years_experience_at()` now catches the parse failure and treats both a malformed date
and a negative result as "unknown" (prints a `WARNING` naming the person and the bad value, then
returns `None`) - the same sentinel both existing callers already handle gracefully by omitting
the years-of-experience claim, not a new code path.

**Verification:** all 5 cases run directly (malformed, non-ISO, future-dated, valid, absent) -
only the first three now log a warning and return `None`; valid/absent are unchanged. Re-ran the
exact two-candidate scoring scenario end-to-end through `score_candidate()`/`sorted()` the way
`suggest()` actually calls it: both candidates now score without a crash, the bad-date one simply
has no years-of-experience line in its rationale. `admin_harness.py` (24 clean) and
`general_harness.py --no-pack` + `test_general_bridge.py` (44/0/0, ALL PASSED) all still clean.

### Finding 6 (CONFIRMED, FIXED, severe): a negative years-of-experience value could have reached
a real submitted SANRAL form

**Where:** `engine/pack_generator/confirm_pack.py`'s `confirm()` - a **second, independent**
reimplementation of the same grad-date-to-years computation (not reusing `years_experience_at()`
- itself worth noting as duplication, not fixed here since the two call sites have genuinely
different correct behaviour, explained below).

**What was found:** this function is the pack's own stated gate ("refuses to run - loudly, not
silently" per its own docstring) - the right design, for a different reason than
`suggest_pack.py`: confirming a pack is a one-person, one-position act, so failing loudly here is
correct, unlike batch-scoring many candidates where one bad apple shouldn't block the rest. But
the code didn't live up to its own stated design in two ways:
1. A malformed (non-empty) date crashed with a raw, unattributed `ValueError: Invalid isoformat
   string: '...'` - not naming the person or field - inconsistent with every OTHER error in this
   same function, which are all deliberately clear ("Position {code}: confirmed_person is not
   set...").
2. **A future-dated or transposed-year grad date computed a negative `years_experience` and let
   it through** - the `if years_experience is None: raise ...` check only catches a missing date,
   not an implausible one. `confirm()`'s output (`pack.yaml`) feeds directly into
   `fill_conventional.py`/`fill_tender.py`, which types this value onto the real Form B2.1 "Years
   of relevant experience" field in the actual submission pack. This is the worse case the
   mandate names explicitly: not a crash, a confidently-wrong number that would have gone out on
   a real government tender submission with nothing flagging it.

**Fix:** parse failure now raises the same clear, person-named `ValueError` style as every other
check in this function; a negative result now raises too, naming the person, the date, the
tender's closing date, and where to fix it - consistent with "refuses to run loudly" rather than
silently computing something false.

**Verification:** built real `pack_suggestions.json` / `pack_selections.yaml` / `profile.json`
fixtures and ran `confirm_pack.confirm()` end-to-end (not a mock) for: a future-dated grad (now
correctly refused, naming the person/date/closing date), a malformed date (now correctly refused
with a clear message instead of a raw traceback), and the underlying valid-date formula in
isolation (unchanged, still produces a normal positive year count - the full end-to-end run for
this case hit unrelated missing fields in the minimal test fixture, not this fix, confirmed by
reading the traceback's own line number, which was past the code this pass touched).

### Not yet tested this pass (deferred)

- `confirm_pack.py` and `suggest_pack.py` compute years-of-experience two different ways with two
  different (both now correct) failure behaviours. Not unified this pass - they're deliberately
  different (batch-tolerant vs. hard-gate), and a shared helper would need a mode flag or a
  second function; a genuine but small refactor, not today's fix.
- The CV engine's own "other professional bodies have no column" gap (SACPLAN/SACAP/SAICE etc.)
  was checked and confirmed to be the same, already-documented, honestly-handled gap named in
  `CV-Extraction-Findings.md` §6 / System-Status Gap #3 - not a new finding, not re-logged here
  as one.
- CV AI-extraction itself (`extract_cv_fields.py`) changed again in the concurrent landing this
  pass pulled in - not reviewed this run, a reasonable candidate for a future CV-engine pass.

---

## 2026-10-18 (fifth run): Intake - a misleading diagnosis when a document isn't really what its
extension claims

**Context:** rotated to the intake engine (`engine/intake/`) per the standing mandate. Pulled
latest `main` first (fast-forward - another large concurrent landing: multi-source discovery
expansion - `gov_sources.py`, `transnet_etenders.py`, `key_person_minimums.py`,
`store_award_outcomes.py` - plus `engine/sanral_b7.py` and cross-tenant isolation work).
Re-confirmed all five of this review's prior fixes are still present and untouched before
starting.

Used `classify_tender.py`'s own local CLI mode (`--profile`, no Supabase needed) to run real
adversarial document shapes through intake directly, rather than standing up a scratch Postgres
for this rotation - the mandate's own "run the actual code" bar is met either way, and it let
this pass cover more ground. First tried two real general-tender samples
(`mthashana_tvet`, `ssa_change_mgmt`) against `new_co.json` (the empty-data fixture) - both ran
cleanly, correctly `needs_review` with the "no disciplines on file" reason from the second run's
fix still firing correctly on brand-new real samples, nothing new to report there.

### Finding 7 (CONFIRMED, FIXED, moderate): a misread document's real reason was known, but the
fit section showed a different, misleading one next to it

**Where:** `engine/intake/classify_tender.py`'s `assess_fit_from_text()`.

**What was tested:** a genuinely mundane, very real document-upload shape Sarel's mandate asks
for - a real `.docx` tender document renamed to `.pdf` (a browser/OS rename, a mislabeled
download, or a buyer who simply named the file wrong - all real-world, not contrived), run
through the actual intake pipeline alongside a zero-byte file.

**What broke:** `requirements.py`'s own per-document read already correctly diagnoses this -
`pdftotext` itself reports "Syntax Warning: May not be a PDF file (continuing anyway)", and
`requirements.py` surfaces that verbatim: `"not a readable PDF - corrupt, truncated or not really
a PDF (...) - re-download it"`. But the SAME intake result's `fit.confidence_note` (the
score-outlook section, built by `classify_tender.assess_fit_from_text()` calling
`assess_tender.document_depth()`/`extract_signals()` on the aggregated text blob, with no
visibility into *why* nothing was extracted) hardcoded **"likely a scanned image" regardless of
the real reason** - a different, misleading diagnosis sitting right next to the correct one in
the same manifest. Confirmed directly: ran the real file through both code paths and printed
both messages side by side. The verdict itself stayed safely cautious either way
(`needs_review`), so this isn't a wrong-decision bug - it's a wrong-explanation bug that could
send someone chasing a scanner/OCR fix for a file that was never scanned at all.

**Fix:** `assess_fit_from_text()` now takes an optional `documents` list (the same per-document
manifest `requirements.py` already produces). When nothing could be extracted, it uses the real,
specific `unreadable` reason(s) already known for those documents instead of a blind guess -
except when a document's own reason already says "scanned image", which stays as-is (that
guess is correct there). Both production call sites
(`process_general_jobs.record_fit()`/`run_extraction()`) and the CLI now pass the manifest's
`documents` through; the discovery-feed path (which never has this richer per-document context,
only a single downloaded PDF) is unaffected and keeps its existing generic message - confirmed
by testing it with `documents=None`.

**Verification:** re-ran the exact renamed-file scenario after the fix - `confidence_note` now
reads the real pdftotext-reported reason for each document, not "likely a scanned image". Two
explicit regression checks: calling with `documents=None` (the discovery-feed shape) and with a
document whose own reason genuinely says "scanned image" both still produce the original,
unchanged generic message. `test_general_bridge.py` ALL PASSED; `general_harness.py --no-pack`
44/0/0. `python3 -m py_compile` clean on all three changed files.

### Not yet tested this pass (deferred)

- The multi-source discovery expansion that landed in this pass's pull (`gov_sources.py`,
  `transnet_etenders.py`, `key_person_minimums.py`) is entirely new ground for this review - a
  strong candidate to revisit discovery again once CV/compliance/notify/worker have each had a
  first pass.
- Other malformed-extension shapes worth trying later: a `.xlsm` SANRAL workbook renamed to
  `.docx` or `.pdf` (would it still be detected as a workbook, or silently misrouted to the
  general flow?), and a genuinely password-protected real PDF (the "not a readable PDF" message
  already names this as one of its causes, but it wasn't tested with an actual password-protected
  file this pass, only a mis-extensioned one).

---

## 2026-10-18 (sixth run): Compliance/reminders - the same malformed-date bug, found a third
time, now in a cross-tenant daily batch job

**Context:** rotated to the compliance engine (`engine/compliance/`) per the standing mandate.
Pulled latest `main` first (small this time - a Person page UI pass only). Re-confirmed all six
of this review's prior fixes are still present and untouched before starting.

### Finding 8 (CONFIRMED, FIXED, severe): one company's or one person's malformed expiry date
could have skipped the daily reminder run for EVERY company

**Where:** `engine/compliance/watch_deadlines.py`'s `days_until()` - the single shared date-math
helper behind `_expiry_window()`, which every one of this engine's "what's due" functions calls:
`find_due_documents()` (every company's 6 tracked vault documents),
`find_due_person_credentials()` (every person's ECSA/SACPCMP/SACNASP/SAGC registrations),
and (newly landed this cycle) `registration_reminders.find_due_registrations()` /
`find_due_property_documents()` (the shared registrations catalog and property documents,
migration 0050).

**What was tested:** the exact same malformed/boundary-date class already found twice this
review (Findings 5-6, in the pack engine) - a typo'd month, a non-ISO string - run against this
engine's own date helper.

**What broke:** `days_until()` had no try/except around `datetime.date.fromisoformat()`, same as
the two earlier findings. The blast radius here is the worst of the three: `main()`'s own
`try/except` wraps ALL FIVE "find due X" calls together, in ONE run, across EVERY company in the
system - so one malformed date, anywhere, for any single company's single document or any single
person's single registration, would abort `main()` entirely. The run is caught at the top level
(not silently lost - it's recorded as a `critical` system alert and exits non-zero) but the
practical effect is that **no company gets its compliance reminders that day**, and every
subsequent run keeps failing the same way until someone finds and manually fixes the one bad
date in the database - a genuinely dangerous failure mode for a safety-critical reminder system
(a missed COID renewal reminder can mean a company becomes ineligible to bid). Confirmed directly
by running the real multi-company loop shape with one bad date sandwiched between two good ones:
before the fix, the loop never reached the second good company.

**A second, related bug found while fixing the first:** `engine/notify/daily_digest.py` calls
`watch_deadlines.days_until()` directly (`local_person_credential_expiry()`) and ALSO
reimplements the exact same `datetime.date.fromisoformat()` call inline, a second time, with no
guard (`local_document_expiry()` - two separate date fields, both unguarded). Both are real
crash risks in the daily digest's own local-mode path, independent of `watch_deadlines.py`'s.

**Fix:** `days_until()` now catches the parse failure and returns `None` (same sentinel as "no
date at all" - every one of its callers already treats `None` as "nothing due, skip"), and
records a `warning`-level `system_alerts.record(...)` so the bad record doesn't vanish
unnoticed - it just stops blocking everyone else's reminders while it's unfixed.
`daily_digest.py`'s own direct caller of `days_until()` needed a small follow-on fix: it compared
`left > lead_days` with no `None` check, which would have traded the original `ValueError` for a
`TypeError` one line later - fixed to check `left is None` first, the same guard its sibling
functions already use for "no date". `local_document_expiry()`'s two inline reimplementations
were replaced with calls to the now-safe `watch_deadlines.days_until()` instead of patching the
duplicate logic separately - removes the duplication its own docstring already said shouldn't
exist ("Local-mode equivalent of... find_due_documents()") rather than just papering over it.

**Verification:** `days_until()` run directly against malformed/non-ISO/valid/absent dates - only
the first two now return `None` with a warning logged, others unchanged. Re-ran the exact
multi-company `_expiry_window()` loop that used to crash: both good companies now get processed
regardless of the bad one between them. `daily_digest.py`'s two edited functions re-run directly
with a mix of good and malformed dates (including the professional-indemnity-insurance field) -
no crash, only the malformed ones skipped, with a warning logged for each. Full regression: all
five compliance test files (`test_watch_deadlines_urgency.py`,
`test_watch_person_credentials.py`, `test_watch_conditional_registrations.py`,
`test_reminder_seen_db.py`, `test_principals_registrations.py`) and `test_digest_live.py` -
**0 failures across all six**. `python3 -m py_compile` clean on both changed files.

### Not yet tested this pass (deferred)

- The brand-new shared registrations catalog (`registration_reminders.py`, migration 0050 -
  property documents, held registrations for any professional body) only landed this cycle and
  wasn't otherwise exercised beyond confirming it goes through the now-fixed `_expiry_window()` -
  worth a dedicated look at its own company-shape diversity (different registration types,
  different holder shapes - person vs. principal vs. company-held) in a future pass.
- `watch_deadlines.py`'s task-deadline and "lapsing before closing" functions
  (`find_due_tasks`/`find_documents_lapsing_before_closing`) weren't specifically re-tested for
  the same malformed-date class this pass, though they likely share the same `days_until()` fix
  automatically if they call it - worth confirming directly next time this engine comes up in
  rotation.

---

## 2026-10-18 (seventh run): repo-wide sweep for the malformed-date-in-a-batch bug class

**Context:** Findings 5, 6 and 8 were the same mistake three times: a date string parsed with no
guard inside a function that walks every company/person/record in one call, so one bad value
stopped the run for everyone. This run is a sweep of the whole `engine/` tree plus `app/lib/*.ts`
for every date-string parse, not a rotation to one engine. I grepped for `fromisoformat`,
`strptime`, `dateutil` (not used anywhere), `datetime.date(int(...))` / `datetime.datetime(int(...))`
built by hand from regex groups, `.replace(year=...)` date arithmetic, and in TypeScript
`new Date(...)` / `Date.parse` / `Number(...)`. Pulled latest `main` first; Findings 5-8 are
still in place.

**A note on what's actually reachable.** In live mode almost every date column is a Postgres
`date` or `timestamptz` (`initial_graduated`, every `*_expiry`, `completion_date`,
`release_date`, `claimed_at`, `started_at`, `tenders.closing_date`), so a malformed value can't
come out of the database. Malformed dates can really arrive from four places: **scraped or feed
data** (SANRAL's page, Transnet/Cape Town listings), **date arithmetic on valid dates** (29
February), **local-mode JSON profiles and pack files**, and **TypeScript**, where an unreadable
date doesn't throw but quietly becomes `NaN`. Findings 5 and 8 were fixed on DB-typed columns
anyway, and the same discipline is applied below. The two genuinely reachable batch crashes
this run found (9a, 9b) are both on scraped data, and 9c is arithmetic on valid dates.

### Inventory: 36 Python parse sites (counted by function; 9a-9d cover 7 raw calls) + 4 TypeScript

| Class | Count | Sites |
|---|---|---|
| (a) already guarded | 18 | `suggest_pack.years_experience_at`, `confirm_pack` grad date (Findings 5/6), `watch_deadlines.days_until` (Finding 8), `daily_digest.submission_due_signals`, `award_outcomes.parse_sanral_date`, `source_http.parse_sast` ISO branch + `parse_utc`, `tender_updates._date_from` (3 hand-built dates) + `to_date` (2), `extract_cv_fields.normalise_date` (2), `pdf_merge.expiry_warning` (2), `assemble_pack._excel_date`, `process_pack_jobs` SANRAL suggestion refresh |
| (a') unguarded, but the input is a value this code wrote itself | 6 | `tender_updates.classify_document` summary lines (5 `fromisoformat` calls on dates that `_date_from()`/`to_date()` produced as `.isoformat()` a few lines earlier), `watch_tender_updates.check_tender` `release_date` (written by itself as `day.isoformat()`, a `date` column) |
| (a'') unguarded batch loop, input is a DB `timestamptz` the worker wrote | 3 | stale-job sweepers: `process_pack_jobs.fail_stale_jobs`, `process_cv_jobs` stale sweep, `extract_cv_fields.fail_stale_uploads`. Left as they are: Python 3.13 `fromisoformat` reads every format Postgres returns, and nothing a user types reaches these columns |
| **(b) unguarded AND in a multi-record batch: dangerous** | **4** | **9a-9d below** |
| (c) unguarded, one record per call | 5 | `generate_cv` closing date, `sanral_fill.Workbook.set_date`, `confirm_pack` closing date, `process_pack_jobs` closing time (a DB `timestamptz`, left), `gov_sources.published_since` cut date (a CLI argument, left) |
| TypeScript (`NaN` silently treated as a real value, never a crash) | 4 | `dates.daysUntil`, `principals.ageOn`, `tenderCompliance.yearsCheck` fixed; `sanralScoring.periodPoints` left (see below) |

### Finding 9a (CONFIRMED, FIXED, severe): one Transnet/Cape Town listing with an impossible date dropped from the whole feed merge

**Where:** `engine/discovery/source_http.parse_sast()`, US-style branch (`11/30/2026 3:00:00 PM`).
The regex only checks how many digits there are, so `13/45/2026` or `11/30/2026 25:00` reached
`datetime.datetime(...)` and raised `ValueError`. The ISO branch right below it was already
guarded; this branch wasn't. `parse_sast()` runs inside every loop over the whole feed:
`gov_sources` merge/`published_since`, and `tender_changes` (closing-date moves, publish dates,
cancellations).
**Before:** `ValueError: month must be in 1..12`. **Fix:** the hand-built date is wrapped, and an
unreadable value returns `None`, the same as an unreadable ISO value. No alert: this is
third-party feed data, the raw value is kept on the listing, and the ISO branch's existing
behaviour is also silent.
**Verified:** five-row feed (valid US date, `13/45/2026`, `11/30/2026 25:00`, ISO, US date
only): the two bad rows give `None`, the other three parse correctly, and
`gov_sources.published_since()` finishes over all five rows.

### Finding 9b (CONFIRMED, FIXED, severe): one SANRAL tender page with an impossible closing date stopped the tender-update watch for every pursued tender

**Where:** `engine/discovery/watch_tender_updates._sanral_closing()`, the same hand-built
`datetime(int(y), int(mo), ...)` pattern on the scraped closing date (`2026/13/19 12:00`). It is
called from `check_tender()`, and `run()` loops over every pursued tender in the system with no
error handling per tender, so the exception stopped the whole watch. No company got addendum
alerts that run, and the next run would fail the same way.
**Fix:** a bad date gives `None` (no listing date to compare against, which `classify_document()`
already handles) plus a `warning` system alert naming the slug, URL and raw value.
**Verified end to end:** reused `test_tender_updates.py`'s `MemClient` + `seed_mem` (4 pursued
tenders: 3 eTenders + 1 SANRAL) with the SANRAL page's closing date set to `2026/13/16 12:00`.
With the old code (changes stashed): `WHOLE RUN CRASHED: ValueError month must be in 1..12`.
With the fix: the run completes and all 4 tenders are checked, the SANRAL one included.

### Finding 9c (CONFIRMED, FIXED, severe, reachable with perfectly valid data): a tender closing on 29 February crashed the general pack job

**Where:** `engine/general/process_general_jobs._within()`, the filter applied to every
Experience Library row while the general pack picks experience evidence.
`ref.replace(year=ref.year - window_years)` raises `ValueError: day is out of range for month`
when the closing date is 29 Feb and the target year isn't a leap year (closing 2028-02-29 with a
5-year window gives 2023-02-29). That is valid data, not a typo, so the whole pack job would fail.
The same filter also called `fromisoformat` / `int(comp[:4])` on each row's `completion_date`
with no guard.
**Fix:** a new `_years_before()` puts 29 Feb on 28 Feb. That matches Postgres'
`date - make_interval(years => n)`, which the app's own `find_matching_experience` RPC (migration
0012) uses, so the engine and the Workspace agree. A row whose completion date can't be read is
treated like a row with no date (left out, which is what it already got) and records a `warning`
alert. An unreadable closing date falls back to today.
**Verified:** with the old code, both the Feb-29 closing and a `2024-13-01` row raised
`ValueError`. With the fix, four rows (good, malformed, too old, exactly on the 2023-02-28
boundary) against a 2028-02-29 closing date keep `[good, boundary]`, with one alert for the
malformed row. A normal closing date gives the same result as before.

### Finding 9d (CONFIRMED, FIXED, moderate): "documents lapsing before closing" had its own unguarded copy of the Finding 8 parse

**Where:** `engine/compliance/watch_deadlines.find_documents_lapsing_before_closing()`, one loop
over every (company, tender) pack in the system. It parsed `tenders.closing_date` and each
company's expiry columns with raw `fromisoformat` and never went through the now-safe
`days_until()`. This is the function the sixth run's "not yet tested (deferred)" note named.
**Fix:** the expiry goes through `days_until()` (`None` plus its existing alert, skip). An
unreadable closing date skips that one pack and records a `warning` alert.
**Verified:** 4 companies × 2 tenders. One company has a bad COID expiry and a good SARS expiry;
one tender has the closing date `20/11/2026`. The good companies are reported, the bad company's
good field is still reported, the bad field and the bad tender's pack are skipped, there are
exactly 2 alerts, and `days_left` for the valid rows is unchanged (14).

### Class (c) and TypeScript fixes (quick, low-risk)

- **`generate_cv.build_sanral_keyperson`:** a tender with **no** closing date on file
  (`build_tender_ctx_from_assignment` passes `None`) raised `TypeError` in `fromisoformat(None)`.
  Fixing that exposed a second crash further down (`'the tender closing date ' + None`, the same
  "TypeError a few lines later" pattern as Finding 8's digest follow-on). Both are fixed: the
  count is now taken to today and labelled that way, and an unreadable date is logged as
  `assumed_default` with the reason. Verified with `config/klipcorp_profile.json` for `None`,
  valid, and `20/11/2026`: all three CVs build.
- **`sanral_fill.Workbook.set_date` / `confirm_pack` closing date:** these handle one pack each,
  and refusing is still the right behaviour (a guessed date on a submitted form is worse). Both
  now refuse with the cell or file and the bad value named, instead of a bare
  `Invalid isoformat string`, the same discipline as Finding 6. Verified, and both messages
  checked.
- **`app/lib/dates.ts daysUntil()`:** an unreadable date gave `NaN`, and every comparison with
  `NaN` is false, so **`expiryStatus()` showed a malformed expiry as "Current" (green)**. That
  is a confidently wrong answer, not a crash. It now returns `null`, which shows "Not on file"
  (grey). Run under `node --experimental-strip-types`: `2026-13-01` and `not a date` now show
  "Not on file", and valid, past and null dates are unchanged.
- **`principals.ageOn()`** returns `null` instead of `NaN`. **`tenderCompliance.yearsCheck()`:**
  an unreadable graduation or closing date made `yrs < years` false, so the years-of-experience
  check **passed silently**. It is now reported as unknown, the same as a missing date.

### Secondary check: unguarded numeric parsing in batch functions

I ran a quick scan of `int()` / `float()` on record fields across `engine/`. Nothing dangerous
turned up. `sanral_b7.fill` casts `bee_level` / percentages only after `check_plan()` has
validated them with a guarded `_num()`. `award_outcomes.parse_rand` is guarded. Every
`score_outlook` / `requirements` / `tender_updates` cast works on a regex group that only matches
digits. The rule's `window_years` / `since_year` / `projects_required` come out of
`score_outlook` as regex-validated ints. `int(comp[:4])` in `_within` was the one exception, and
9c removes it.

### Regression

All 5 compliance test files and all 9 discovery test files, `test_general_bridge.py` and
`test_extract_cv_fields.py`: 0 failures / ALL PASSED. `test_digest_live.py`: 0 failures.
`general_harness.py --no-pack`: 44 clean / 0 / 0. `process_cv_jobs.py --self-test`: OK.
`admin_harness.py`: 18 FLAGGED, **identical with the changes stashed** (18 before, 18 after).
These come from stale, gitignored local baselines under `state/admin_harness_baselines/`, not
from this change. `npm run typecheck` and `eslint` on the 3 changed TS files: clean.
`py_compile` passes on all 7 changed Python files. `ruff --select F` reports 3 unused imports,
all already there before this change and none in changed lines.

### Still open (named, not fixed)

- **`watch_tender_updates.run()` has no error handling per tender.** 9b removes the date crash,
  but any other exception in one tender's `check_tender()` (a bad document, a failed DB write)
  still stops the watch for every pursued tender. Catching and alerting per tender would close
  the general class here. It is a behaviour change to a cross-tenant job, so it is flagged rather
  than slipped into a date sweep.
- **`sanralScoring.periodPoints` (TS):** a `NaN` project date scores 0 period points, which errs
  low rather than high and is display-only. Left as it is.
- The stale-job sweepers (class a'') rely on DB typing. If any of those columns ever becomes
  free text, they would need the same guard.

## 2026-10-18 (follow-up to the seventh run): the open `watch_tender_updates.run()` item, closed

### Finding 9e (CONFIRMED, FIXED, moderate): one pursued tender's failure stopped the update watch for every pursued tender

**Where:** `engine/discovery/watch_tender_updates.run()`, one loop over every tender that any
company is actively pursuing. This is the seventh run's "Still open" item. 9b removed the
date-parse crash, but there was still no error handling per tender: any exception in
`check_tender()`, `ensure_briefing_tasks()` or `notify()` escaped the loop. That covers a
malformed document entry in one release, a failed database write, or any other unexpected
error. No other tender was checked that run, and `__main__` recorded only a generic `critical`
"run failed" alert, with nothing to say which tender caused it.
**Fix:** the per-tender body moved into `_watch_one()`, unchanged. `run()` calls it inside a
try/except. A failure records one system alert (`tender_updates`, severity `error`) naming the
tender and the reason: contract no. or id, exception type and message, traceback, and context
{tender_id, contract_no, ocid, source, slug, pursuing companies}. It also writes a log line, and
the loop continues. The run log ends with "N of M pursued tender(s) failed and were skipped". The
report items for a tender are only added once its work has finished, so a half-processed tender
never adds a partial entry. Retrying is safe: a document that was never saved is new again next
run, and `notify()` reports every saved, unreported update. Only `Exception` is caught, so
`KeyboardInterrupt`/`SystemExit` still stop the run.
**Severity choice:** I used `error`, not the `warning` 9b used. 9b's alert is for bad *data* that
the code now handles on purpose. This catch is for an *unexpected exception*, which
`system_alerts.py` defines as `error`. That matches this file's existing OCDS-day and SANRAL-page
fetch handlers. It is a one-word change if Sarel wants these at `warning`.
**Network hiccups:** these were already isolated before this change. An OCDS day that fails to
fetch, an unreadable SANRAL page, and a document download or read failure each had their own
handler. The new catch covers everything those handlers don't.
**Verified (`test_tender_updates.py` Part 2b, now in the suite):** 4 pursued tenders across 2
companies, in loop order:
1. `BADDOC-01`, whose OCDS release has a document entry that is a bare string instead of an
   object.
2. `WTE1062CE`, a good tender with an addendum added after discovery.
3. `DBFAIL-01`, where the `tender_watched_documents` upsert raises "HTTP 500 ... statement
   timeout".
4. A good SANRAL tender.
- **Before** (the same test, run against the pre-fix `watch_tender_updates.py` from `HEAD`):
  `run()` raised `AttributeError: 'str' object has no attribute 'get'` on the first tender.
  **0 of 4 tenders were checked**, nothing was reported, and there were no per-tender alerts.
- **After:** the run completes. `WTE1062CE` and the SANRAL tender are checked (watch state
  written, SANRAL baseline recorded). The addendum is reported to both pursuers, and nothing comes
  from the 2 failing tenders. There are exactly 2 alerts, each naming its tender and reason
  (`BADDOC-01 ... AttributeError`, `DBFAIL-01 ... statement timeout`), severity `error`, with the
  traceback and tender id. The log says "2 of 4 pursued tender(s) failed". On the next run, with
  the DB write working again, `DBFAIL-01`'s addendum is reported once to its pursuer. The
  still-malformed `BADDOC-01` alerts again (1 alert), and nothing else does.

**Regression:** `test_tender_updates.py` ALL PASSED (Parts 1, 2 and 2b; Part 3 needs `TU_PSQL`).
Every other discovery test file, all 5 compliance test files, `test_digest_live.py` and
`test_system_alerts.py`: 0 failures. `py_compile` is clean and `tsc --noEmit` is clean (no TS
changed). Ruff's only new findings are the two intended broad `except Exception` (BLE001), the
same as every other isolation handler in the file, plus a `noqa: E731` that follows the file's
existing convention. There are no new F-class findings.

### Still open (named, not fixed)

- The `watch_tender_updates` item is **closed**. The other two seventh-run items (TS
  `sanralScoring.periodPoints` NaN, the stale-job sweepers' reliance on DB typing) are unchanged.
- A partial-failure edge, accepted: when `notify()` writes notification rows for one pursuer and
  then fails on a later pursuer of the **same** tender, the first pursuer's rows are marked
  alerted but are left out of this run's alert report. The daily digest still carries them
  (`digested_at` is null), so the update reaches that company a day late rather than never.

---

## 2026-10-18 (eighth run): worker/job-queue spot-check, and closing out Finding 2's deferred item

**Context:** the rotation's remaining untouched area was worker/job-queue, but a sibling run
(seventh run + its follow-up, above) had just landed a thorough repo-wide sweep closing out the
exact bug class this review had been finding one engine at a time - including the worker/alerts
machinery (`system_alerts`, `run_bridges.py`'s per-bridge isolation). Pulled latest `main` first
and confirmed all eight of this review's own prior fixes (five from this session, three from the
sibling sweep's own commits) are still in place. Rather than force a thin pass over code another
session had just finished scrutinising, read `poll_loop.py` and `run_bridges.py` in full and
spot-checked one specific thing worth verifying directly rather than trusting the comment: the
`BridgeRunner`'s `TimeoutExpired` handling does `(e.stdout or b"") + (e.stderr or b"")`, which
looks like a `str`/`bytes` mismatch risk given `subprocess.run(..., text=True)` - checked for
real with a script that times out with partial stdout and no stderr: confirmed `TimeoutExpired`'s
own `.stdout`/`.stderr` stay `bytes` even under `text=True` (a real, if obscure, `subprocess`
quirk - the text decoding only applies to a `CompletedProcess`, which a timeout never produces),
so the existing code is correct as written, not a bug. Worth recording so the next person reading
that line doesn't re-flag it without checking.

Spent the rest of this run closing out a deferred item from the very first run instead of forcing
a shallow pass elsewhere - consistent with "go deeper rather than repeat shallow checks" once a
rotation has been through every area at least once.

### Finding 2, closed: `sanralScoring.ts`'s `estimatePosition()` verified clean across all 8 Book 1
Design Specialist disciplines, not just Pavement and Materials

Ran `estimatePosition()` directly (`npx tsx`, no Supabase or build step needed - a pure function)
for each of the 8 `DS_SPECIALISMS` entries in `sanralMatrices.ts`, each matched to its own real
Book 1 matrix. Two real mistakes in my OWN test construction were caught before being mistaken
for engine bugs, worth recording as a methodology note: using a matrix's first *column* value as
both the experience-type (a *row* key) and the tender's required type initially produced
`{min:0,max:0}` for `DS_GEOTECHNICAL` and `DS_TRAFFIC_TRANSPORTATION` - looked like a bug, but
those two matrices (and only those two, confirmed by printing every matrix's actual rows vs.
columns) genuinely use different vocabularies for rows and columns, matching Book 1's own layout
for them specifically (every other DS matrix happens to use the same labels for both axes). Reran
with a real row key for each: all 8 specialisms correctly score the maximum (15/15 technical) for
a project matching the tender's exact required type, with the same "only 1 project on file"
range-widening note every specialism gets. Also checked `matrixForPosition()`'s regex matching
on ambiguous/edge descriptions directly: a description naming two specialisms ("Structures and
Geotechnical") resolves to the first match in `DS_SPECIALISMS`'s declared order (documented,
intended behaviour); a bare "DS1" with no specialism text, and an empty or `null` description,
all correctly return `matrix: null` (the honest unknown-range fallback) rather than crashing or
guessing. **No bug found** - this closes Finding 2 clean rather than leaving it open.

---

## 2026-10-18 (ninth run): Discovery's award/price intelligence - a genuine R0,00 award
undercounted as "no amount on file"

**Context:** the award-outcomes/price-intelligence feature (`engine/discovery/award_outcomes.py`,
`store_award_outcomes.py`, Deep-Dive items 17/28) is new since this review's last discovery pass
and deals with real money, so it was this run's pick. Pulled latest `main` first (quiet - no new
commits since the eighth run). Ran the real CLI against the live eTenders portal
(`python3 award_outcomes.py --source portal --limit 20`, no mock) rather than only reading code -
the live network was flaky through the proxy on two attempts (`ws_closed_mid_exchange`) but one
run completed and printed real current awards.

### Finding 10 (CONFIRMED, FIXED, minor): a genuine R0,00 award miscounted as missing in the
summary stats (not in the stored record itself)

**Where:** `award_outcomes.py`'s `summarize_portal()`/`summarize_sanral()`.

**What was found:** the live run surfaced a real record - bid number
`NDA03/DEVI03/26(Disciplinary 2)`, winner `MORAR`, amount `R0.00` (a disciplinary-matter
appointment, genuinely a zero-Rand outcome, not a missing value - `parse_rand("R0,00")` already
has a dedicated test case proving it correctly returns `0.0`, not `None`). The per-record print
line and the stored `amount_zar` field both handle this correctly (the print line explicitly
guards with `is not None`). But `with_award_amount`'s summary count used a bare truthiness
check - `any(a["amount_zar"] for a in r["awards"])` - which is `False` for `0.0`, so the one
summary statistic a person would glance at to sanity-check a run undercounts by exactly the
number of genuine zero-Rand awards in the batch. Confirmed directly by reproducing the real
record shape and comparing the buggy count (1) against the correct one (2) for a 2-award,
1-no-award batch. The SANRAL side (`with_contract_amount`) has the identical pattern, fixed the
same way, though a zero-Rand *approved contract* amount is less likely in practice than a
zero-Rand *disciplinary award* - same bug class, fixed for the same reason regardless of how
often it fires.

**Severity, honestly stated:** minor - this is a diagnostic summary count, not the actual stored
or reported data (which was already correct), so nothing downstream was ever silently wrong.
Fixed anyway because it's a one-line, zero-risk correction and the exact "truthy zero" mistake
this project has now caught and fixed in several other places.

**Fix:** both counts now use `is not None` instead of a bare truthiness check, matching the
convention the per-record print line and `store_award_outcomes.py`'s `plausible()` already use
elsewhere in the same feature.

**Verification:** reproduced the real record shape (one genuine R0,00 award, one real priced
award, one with no award at all) and confirmed the count goes from 1 (wrong) to 2 (correct).
`test_award_outcomes.py` and `test_award_prices.py`: all passed, 0 failures. `python3
-m py_compile` clean.

### Also checked, found already sound (no fix needed)

- **Duplicate-award detection** (`clean_name()` + `(name.upper(), amount)` dedup key): only merges
  exact name+amount duplicates, deliberately not fuzzy-matching near-identical names (e.g. with
  or without a "(PTY) LTD" suffix) - a reasonable, narrow scope, since aggressive name
  normalisation would risk merging two genuinely different suppliers that happen to sound
  similar. `store_award_outcomes.py`'s separate matching logic already handles "names compare
  without legal-form noise" for the winner-to-bidder-list matching case, confirmed by its own
  passing test - not a gap, just a different problem than the raw dedup solves.
- **`plausible()`'s `0 < amount <= MAX_PLAUSIBLE_ZAR` gate** (`store_award_outcomes.py`): this
  one deliberately excludes zero/negative amounts from the price-intelligence numbers (not a
  bug - a R0 outcome isn't a useful market-price data point, and the winner/supplier is still
  kept regardless; only the *price* signal is suppressed). Checked this was an intentional design
  choice, not an oversight, before leaving it alone.

---

## 2026-10-18 (tenth run): the malformed-date-in-a-batch bug class, found a fourth time, in the
brand-new listing-change tracker

**Context:** picked `engine/discovery/tender_changes.py` (listing-level change tracking across
every tender in every one of Discovery's sources - migration `0051`) because it's part of the
government-coverage expansion that landed in the last 24 hours, after the seventh run's
repo-wide date sweep. Checked first whether the sweep had covered this specific file: its own
inventory names `tender_updates.py` (a different file - addendum/document reading for *pursued*
tenders, migration `0039`) and `source_http.py`'s parsers, but never `tender_changes.py` itself,
which landed in the same window. That gap is exactly why this run picked it.

### Finding 11 (CONFIRMED, FIXED, severe): one listing's unparseable closing date could cancel
change detection for every tender in the system, pursued or not

**Where:** `engine/discovery/tender_changes.py`'s `diff_listing()` and `detect()`.

**What was found:** `diff_listing()`'s closing-date-changed check already used the sweep-fixed
`source_http.parse_sast()` (which returns `None` on a bad date rather than raising) - but the
code immediately did `sh.parse_sast(now) > sh.parse_sast(prev)` to decide "extended" vs "brought
forward". The guard just above it (`sh.parse_sast(prev) != sh.parse_sast(now)`) is true whenever
*either* side fails to parse (`None != a_real_datetime`), so a listing where only one side of the
comparison is a real date reaches the `>` with one side `None` - `TypeError: '>' not supported
between instances of 'NoneType' and 'datetime.datetime'`. And `detect()`'s per-release loop
(`for r in releases: events += diff_listing(r, prev); ...`) had no per-release error handling at
all, so that one `TypeError` propagated out of `detect()` and aborted change detection for every
other tender in the same run - the identical blast-radius shape as Findings 5, 6 and 8, now in a
newer file the sweep never saw. Confirmed directly: a 3-release batch (one malformed date, two
clean) lost all 3 results to the crash before the fix.

**A second, related crash found while testing the fix:** `detect()`'s loop also calls
`snapshot_of(r)` for the *next* run's baseline, unconditionally, outside any guard. A release
whose shape is malformed in a different way (tested: `documents` not a list at all) crashes
`snapshot_of()` itself with an `AttributeError` - a different exception, same fatal-to-everyone
effect. The first attempt at isolating only the diff/disagreement calls in a `try` left this
line exposed and still crashing; confirmed by testing, then widened the `try` to cover the
snapshot too.

**Fix:**
1. `diff_listing()` now computes the "extended"/"brought forward" direction only when *both*
   dates parse; when one doesn't, it still reports the string-level change ("Closing date
   changed: ... -> no date") rather than guessing a direction or crashing - same "say what you
   don't know" discipline as the rest of the project.
2. `detect()`'s per-release loop is now wrapped in a `try/except` covering the diff,
   disagreement and snapshot calls together, isolating one listing's failure from every other
   tender in the batch (the same pattern Finding 9e already established for
   `watch_tender_updates.run()`), and records a `warning`-level system alert naming the listing
   and the real error. The failed listing's snapshot is deliberately left unset rather than
   faked - next run it is simply treated as newly-seen again, not diffed against bad data.

**Verification:** re-ran both repro scenarios after the fix - the date-comparison crash (3
listings, one malformed) now produces 3 honest events with no crash; the `snapshot_of()` crash
(2 listings, one with a malformed `documents` field) now produces 1 event and 1 saved snapshot
(the broken listing's own alert fires, and it's correctly excluded from the saved snapshots
rather than silently given a fake one). All 9 of the discovery engine's committed test files: 0
failures / ALL PASSED. `python3 -m py_compile` clean.

**Flagged, not fixed:** `tender_changes.py` has no dedicated test file at all (`ls test_*.py`
confirms no `test_tender_changes.py` exists), despite being 459 lines of exactly the kind of
cross-tenant batch logic this bug class keeps turning up in. Worth a committed regression suite
in a future pass, mirroring `test_tender_updates.py`'s own per-scenario shape.

---

## 2026-10-18 (eleventh run): three non-engineering industries, stress-testing the field/form/
document/answer-selection pipeline for Klipcorp bias

**Context:** Sarel (his own words): "we need an agent to keep running a few times through all
tenders to make sure each field and form and document requirement is reviewed correctly and the
answer or submission chosen correctly, not based on klipcorp answers but general." No live
Supabase project exists yet (Sarel is setting one up), so this run used the same method as
`Form-Field-Audit.md`: synthetic company profiles deliberately unlike Klipcorp, run through the
real pipeline against real tender documents. Three passes, three industries, none of them
engineering/roads/civil:

1. **Private security services** (guarding, CCTV monitoring) - new fixture
   `config/test_companies/security_guarding_co.json` ("Test Khanyisa Guarding & Monitoring (Pty)
   Ltd"): no CIDB grading, no ECSA/SACPCMP, PSIRA-registered key person instead. Run against the
   real `dawid_kruiper_tn051` sample - an actual municipal tender for "APPOINTMENT OF EXTERNAL
   SECURITY SERVICES".
2. **Environmental / pest control & vegetation management** - new fixture
   `config/test_companies/pest_control_co.json` ("Test Veldwag Pest & Vegetation Control CC"): no
   B-BBEE level recorded at all, no director recorded, a registered Pest Control Operator instead
   of any statutory engineering/built-environment council.
3. **IT / software services** - new fixture `config/test_companies/it_services_co.json` ("Test
   Nexora Systems (Pty) Ltd"): a BSc Computer Science key person with no professional
   registration of any kind - checking the system doesn't invent one.

First grepped `klipcorp` (case-insensitive) across `engine/` and `app/` for literal references:
every hit is either the literal Klipcorp fixture files (`config/klipcorp_profile.json`,
`assets/klipcorp_logo.png`, the sample completed-tender PDFs) or comments in already-audited code
explaining a *past* bug and its fix (`company_profiles.py`, `taxonomy.py`, etc.) - no live code
path reads Klipcorp's data as a stand-in for "the company" any more; the 2026-10-17
Hardcoded-Assumptions-Audit and 2026-10-18 Form-Field-Audit passes already closed that out for the
SANRAL pipeline.

**Which pipeline actually applies.** `suggest_pack.py` (key-position/CV suggestion),
`compliance-data.ts` (`PACK_REQUIRED_TEMPLATES`, the B3/ECSA/SACPCMP counts, the Pack Review
screen's `pack-review-data.ts`/`pack-review-logic.ts`, migration `0059`) and `submission-pack.tsx`
are all gated on `tenders.family === SANRAL_CONVENTIONAL_FAMILY` (or the RRM family) - confirmed
by reading `compliance-data.ts`'s `loadTenderCompliance` (returns `{mapped: false}` immediately
for any other family) and `page.tsx`'s `showSubmissionPack` / `isGeneralFamily` gates. A
municipal security tender, a parks/vegetation tender or an IT-support tender all come in as
`GENERAL_FAMILY` ("General (non-SANRAL)"), which routes through an entirely different, already
industry-agnostic pipeline: `engine/general/requirements.py` (role & registration pattern list
already includes `services.security_officer`/PSIRA and `services.pest_control_operator` by name,
alongside SACNASP/SAGC/SACAP/SACPLAN/SACQSP/SACPVP), `build_general_pack.py`,
`process_general_jobs.py` (key-position CVs are matched from the company's own
`person_role_eligibility` tags, never a keyword score), and `app/lib/generalTender.ts` /
`general-workspace.tsx` on the UI side. The taxonomy (`config/discipline_taxonomy.json`, 112
categories) already has `security_guarding`, `electronic_security`, `pest_control`,
`gardening_landscaping`, `software_systems` and `it_support_managed_services` as named disciplines
under non-engineering groups.

### Pass 1 - security services company × real security tender: **clean, no fix needed**

Ran `engine/general/general_harness.py` (both `--no-pack`, manifest-only, and the full `--pack`
build with LibreOffice) with the new `security_guarding_co` fixture against `dawid_kruiper_tn051`.
No crash either way. The extracted manifest correctly finds role `services.security_officer` and
returnable `psira` (vault-untracked, so it always reads "upload a copy for this tender" -
honestly, for every company, not a Klipcorp-shaped default). The built pack's field provenance
shows nothing invented: `csd_report`/`municipal_account`/`psira`/`tax_compliance` are all
correctly `omitted` (nothing on file), `sbd1.tcs_pin` and the signature lines are `missing`, and
the only `assumed_default` is the existing, already-flagged `sbd1.foreign_based` (derived from
having a CIPC number, same for every company, SANRAL or not - audit Q10). Compared field-for-field
against `complete_co` (the engineering-shaped fixture) on the same tender: the by-hand-only form
(MBD 6.1) is missing the identical set of fields for both companies - confirming that behaviour is
a property of the *form*, not a Klipcorp-shaped assumption about the *company*.

### Pass 2 - pest control / vegetation company: **clean, no fix needed; one real gap flagged**

No real tender sample in `templates/general_samples/` is actually a parks/vegetation-management
procurement (the closest, `overberg_q12`, is municipal lifeguard services). Ran `pest_control_co`
through the full `general_harness.py` matrix against all 11 real samples anyway (28 combinations
with the other two new fixtures and the existing four, `--pack` mode, LibreOffice) - 0 crashes, 0
flagged baseline changes. With no B-BBEE level and no director on file, the company's rows come
back `missing` (never defaulted) everywhere those facts are read, same as `new_co`'s rows do.
**Flagged (not a bug, a real gap):** there is no real document in the sample set to prove
`services.pest_control_operator` / `pest_control` actually gets matched end-to-end against a true
vegetation-management tender's text the way `services.security_officer` is proved against
`dawid_kruiper_tn051` above - worth adding a real pest-control/vegetation sample to
`templates/general_samples/` (and an `EXPECTED` row in `general_harness.py`) once one is on hand,
the same way `salb_15-10-2026`/`ecdpwi_scmu5_0007` were added for their own cases.

### Pass 3 - IT / software services company: **clean, no fix needed**

Ran `it_services_co` through the same 28-combination matrix. No crash. The closest real sample,
`ssa_change_mgmt` ("RENDER CHANGE MANAGEMENT SERVICES"), isn't a software/systems-support tender
either, so this pass also leans on the same gap noted above for pest control - no real
IT/software-support tender document is in the sample set yet. The key person has no professional
registration recorded at all (deliberately, to check the system doesn't invent one): no
ECSA/SACPCMP/PSIRA/SACNASP/etc. field is written anywhere for this company in any pack, and no
"Pr Eng" or similar engineering wording appears in any output. `grep` for `ECSA|SACPCMP|engineer`
in `engine/general/*.py` (the general-engine source itself, not the SANRAL-only files) returns
only the role-pattern entry for `psp.professional_engineer` - a *pattern to detect that role if a
tender asks for one*, never a default.

### Also checked, found already sound (no fix needed)

- **Discovery's per-company fit scoring** (`engine/discovery/company_profiles.py`,
  `engine/discovery/taxonomy.py`): already rebuilt (2026-10-17, Hardcoded-Assumptions-Audit Q4) to
  read every company's own `experience_items`/`bee_level`/`company_offices` rows - confirmed by
  reading the code, no shared profile file, no Klipcorp fallback.
- **`app/lib/dealEconomics.ts`'s `derivedSector()`** falls back to `"roads_civil"` only when
  `tenders.family` is neither `GENERAL_FAMILY` nor `"UNKNOWN"` - i.e. only for an actual SANRAL
  family, where the comment "SANRAL only issues road work" is simply true. A security, pest-
  control or IT tender is `GENERAL_FAMILY`, so this never fires for them; checked this isn't
  reachable for a non-SANRAL tender before ruling it out as a false alarm.
- **Pack Review (`pack-review-data.ts`, migration `0059`) and the `requestSubmissionPack`
  review-confirmation gate (`actions.ts`)** are both scoped to the SANRAL pack path only;
  `requestGeneralPack` (`general-actions.ts`) has no dependency on `pack_review_confirmations`, so
  a non-SANRAL company is never blocked by (or shown) a SANRAL-shaped review screen. There is
  currently no equivalent "review everything before compiling" screen for general tenders at all -
  a product gap worth Sarel's attention, not a Klipcorp-bias bug.

**Verification:** `engine/general/general_harness.py` (both modes) with the three new fixtures
plus the existing four, across all 11 real samples: 77/77 clean on `--no-pack` manifest checks,
28/28 clean on the full `--pack` LibreOffice build for the samples closest to the three
industries, 0 crashes, 0 flagged baseline changes. `engine/test_form_field_audit.py`: 0 failures.
`engine/general/test_general_bridge.py`: ALL PASSED. `engine/discovery/test_taxonomy.py`,
`test_award_outcomes.py`, `test_company_documents.py`, `discovery/test_discovery_fanout.py`: all
passing (pre-existing, unaffected). `node --experimental-strip-types
"app/app/tenders/[id]/pack-review-logic.test.ts"`: 19/19 passing. `npx tsc --noEmit` (app/): clean.
`python3 discovery/taxonomy.py check`: 112 categories, 0 problems.

**Flagged for Sarel, still needing a real live Supabase project to verify properly:** everything
above was checked at the engine level, against real tender *documents* but a local/offline
company record (JSON fixture), because no live project exists yet. Not yet checked against a real
Supabase-backed company+tender record end-to-end: the Pack Review screen's live Supabase reads
(`pack-review-data.ts`), the general workspace's People-page role-tag UI
(`person_role_eligibility`) for a non-engineering person, and RLS/tenant-isolation behaviour for a
non-SANRAL company's own documents. Also flagged: the sample-document gap above (no real
pest-control/vegetation or IT/software-support tender on file) - worth closing once Sarel can
source one or two real ones.
