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
