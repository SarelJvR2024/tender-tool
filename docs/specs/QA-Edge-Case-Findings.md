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

---

## 2026-10-18 (twelfth run): brand-new tender-enrichment module - a 100x-wrong estimated project
value from the same currency ambiguity `award_outcomes.py` already solved correctly

**Context:** rotated to `engine/discovery/tender_enrichment.py` (tags, scope, pricing model and
estimated value band, Sarel's own request - migrations `0060`/`0062`), new since this review's
last discovery pass. A sibling QA pass (the "eleventh run" entry directly above, a different
session, same file) had just finished a non-engineering-industries pass over the general pack
pipeline, so this run picked a genuinely different module rather than duplicate that work.

### Finding 12 (CONFIRMED, FIXED, severe): a real R1.5 million tender's estimated value came back
as R150 million - exactly the "silently wrong, worse than a clear error" case this review exists
to catch

**Where:** `tender_enrichment.py`'s `_parse_amount()`, feeding `estimate_value_band()`.

**What was found:** the function stripped every comma as a thousands separator before calling
`float()` - `re.sub(r"[,\s]", "", raw_number)`. That's wrong whenever the comma is actually the
**decimal** separator, a real and common South African convention
(`award_outcomes.py`'s own docstring names the exact format: `"R551 189,00"` is R551,189.00, not
R55,118,900). Confirmed directly: `"The estimated contract value is R1 500 000,00 including
VAT."` - a real R1.5 million tender - parsed to `150000000.0` and banded as `"R50m+"` instead of
`"R0-5m"`. No crash, no error, a confident wrong answer exactly two orders of magnitude off, in
a brand-new field whose whole purpose is to tell someone at a glance roughly how big a tender is
worth pursuing.

**The telling part:** `award_outcomes.py`, in the very same directory, already solved this exact
ambiguity correctly (`parse_rand()`'s own docstring: *"the last ',' or '.' followed by 1-2 digits
at the end is the decimal separator; every other separator is a thousands separator"*) and has
its own test coverage proving it on every format seen on two real sites. `tender_enrichment.py`
reimplemented the same problem from scratch and got it wrong, instead of reusing the
already-correct, already-tested function one import away.

**Fix:** `_parse_amount()` now calls `award_outcomes.parse_rand()` for the numeric part (then
applies the "million"/"k"/"billion" suffix multiplier on top, which `parse_rand()` doesn't know
about and `tender_enrichment.py` still owns). Removes the duplicate, wrong logic rather than
patching it in place.

**Verification:** direct runs of all four cases - the real bug (comma-decimal, now correctly
`R0-5m`), a period-decimal amount (regression, unchanged), a "million" suffix (regression,
unchanged), and no stated value at all (regression, unchanged `basis="unknown"`). Added a fifth
case to the existing `test_value_band_stated_amount_is_banded_correctly()` test (none of the
four pre-existing cases used comma-as-decimal, which is exactly why this shipped untested) so the
fix has durable regression coverage, not just this run's own check. `test_tender_enrichment.py`,
`test_market_trend.py`, `test_award_outcomes.py`, `test_taxonomy.py`: all clean, 0 failures.
`python3 -m py_compile` clean.

## 2026-10-18 (thirteenth run): the new bulk onboarding document scan silently drops six
AI-read fields on "Confirm and file" - no error, no warning, same tick-box as the fields that
really are saved

**Context:** synced with `origin/main` and picked up migrations 0059-0063 landed by other
sessions since the twelfth run, including a brand-new feature: `engine/onboarding/
classify_documents.py` + `app/app/company/document-scan/` (bulk upload -> AI classify -> one
review screen -> confirm -> file into an existing table, migration 0063). This run picked that
area since it is new, untested by this review, and high-stakes (it writes real compliance
records once confirmed). The Python classification/extraction side (`classify_documents.py`,
`validate_proposal()`, quote-verification, OCR handling) is sound and was not touched. The bug is
entirely in the web layer that routes a confirmed proposal onto real tables.

**Finding 13 (CONFIRMED, FIXED, severe - silent data loss presented as success):** `classify_
documents.py`'s `KIND_FIELDS` asks the AI to read more fields per document kind than `app/lib/
onboardingScan.ts`'s `VAULT_FIELD_COLUMNS` has companies columns for:

| document kind | asked for (KIND_FIELDS) | actually has a column (VAULT_FIELD_COLUMNS) | silently dropped |
|---|---|---|---|
| cidb_registration | registration_number, grade_class, expiry_date, contractor_name | grade_class, expiry_date | **registration_number, contractor_name** |
| bbbee_certificate | bee_level, proof_type, expiry_date, entity_name | proof_type, expiry_date (+ bee_level, special-cased in actions.ts) | **entity_name** |
| bank_confirmation_letter | bank_name, account_holder, letter_date | letter_date | **bank_name, account_holder** |
| iso_9001_certificate | certificate_number, expiry_date, certified_entity_name | certificate_number, expiry_date | **certified_entity_name** |

`actions.ts`'s `confirmVaultDocument()` only ever writes `Object.entries(VAULT_FIELD_COLUMNS[kind])`,
so a dropped field is never even looked at - not a write failure, just never attempted. But
`review.tsx`'s `DocumentReviewCard` rendered every `KIND_FIELDS[kind]` entry identically: a
default-ticked (when verified) checkbox, an editable value, the source quote, under the same
single "Confirm and file" button as the fields that really are persisted. A reviewer who reads a
CIDB certificate, sees "Registration number: 1234567" pre-filled with its quote, ticks it (or
leaves the default tick), and clicks "Confirm and file" has no way to know that value is gone the
moment the page redirects - no error, no warning, nothing in `onboarding_document_results.applied`
either (that JSON only records the column names `confirmVaultDocument` actually touched, so even
the audit trail is silent about the drop). This is exactly the "gate" this review exists to catch:
not a crash, a confident, silent, successful-looking loss of a value the user explicitly confirmed.

Checked first whether this was intentional: `onboardingScan.test.ts`'s own test ("every vault
kind's field columns are a subset of its own KIND_FIELDS") already accepts `VAULT_FIELD_COLUMNS
⊊ KIND_FIELDS` as valid, so asking the AI for more than gets persisted is by design (these fields
are genuinely useful for the reviewer to see - e.g. checking a CIDB certificate's contractor_name
against the company's own registered name - even with no column to store them in yet). The gap is
only that the UI never told the reviewer which was which.

**Fix (`app/lib/onboardingScan.ts`, `app/app/company/document-scan/review.tsx`):** added
`isFieldPersisted(kind, field)` as the single source of truth (checks `VAULT_FIELD_COLUMNS[kind]`,
plus the `bee_level` special case already in `actions.ts`) and used it in `review.tsx` to split a
kind's fields into `persistedFields` (unchanged: tick-box, editable, `FieldRow`) and
`notSavedFields` (new `NotSavedFields` component: plain read-only label/value/quote, no tick-box,
no input, under a "not saved anywhere - for your own check only" heading). `actions.ts` needed no
change - it was already correct; only the UI was lying about what "Confirm and file" would do.

**Not done (flagged, future work, bigger than a QA-pass fix):** none of the six dropped fields
have ever had a home. Adding `companies` columns (and, for `cidb_registration`/`bbbee_certificate`,
a cross-check against the company's own registered name - a mismatched contractor_name on a CIDB
certificate is a real compliance signal, not just metadata) would need a new migration and product
sign-off on what a mismatch should do, so it's out of scope here; the contained fix was to stop the
UI misrepresenting what gets saved today.

**Verification:** `node --experimental-strip-types --test app/lib/onboardingScan.test.ts` - 12/12
pass, including four new tests pinning `isFieldPersisted()`'s answer for every real field (every
`VAULT_FIELD_COLUMNS` entry true, `bee_level` true despite not being a literal key, all six
dropped fields explicitly false, and every `KIND_FIELDS` entry for every vault kind resolves to a
real boolean, never throws/undefined). `npx tsc --noEmit` on this environment reports only
pre-existing, unrelated module-resolution noise (`node_modules` is not installed here at all -
no `next`, `react`, or `@types/*` packages exist on disk; same limitation this review has hit on
other `app/` TypeScript files) - confirmed this is not new by checking `ls node_modules/next`
before concluding, not just by reading past the errors.

## 2026-10-19 (fourteenth run): 3 brand-new discovery sources could silently merge an unrelated
buyer's tender into theirs on a coincidental reference-number match

**Context:** synced with `origin/main` and picked up a large batch landed since the thirteenth
run - 3 new discovery sources (`sars_procurement.py`, `cidb_tenders.py`, `dbsa_procurement.py`,
all added in commit `cace3f7`), a super-admin portal, a new landing page, and auth-page redesigns.
Picked the 3 new discovery sources for this run: brand new, untested by this review, and
`gov_sources.py` is exactly the kind of merge/matching logic this review has already found real
bugs in before (Findings 9b/10/11).

**Finding 14 (CONFIRMED, FIXED, severe - a "gate": wrong data presented with total confidence,
no error):** `gov_sources.py`'s own module docstring and a code comment on `BUYER_FAMILY` state
the rule plainly: *"A direct-site tender is only folded into a portal row of the SAME buyer:
reference numbers aren't unique across buyers ('RFQ 01/2026')."* `_find()` enforces this via
`(not family or family.search(m.get("buyer") or ""))` - but `family = BUYER_FAMILY.get(name)`,
and `BUYER_FAMILY` only had entries for the 4 original direct sources (`sanral`, `eskom_bulletin`,
`transnet_etenders`, `capetown_procurement`). All 3 of the newly-added sources were missing, so
for them `family` is `None` and `not family` is `True` - the buyer check is skipped entirely,
exactly the failure the rule exists to prevent.

Reproduced directly: built a portal release for "Department of Something Completely Unrelated"
with reference "RFP14/2026", and a `sars_procurement` release for "South African Revenue Service"
with the same reference but a completely different tender (an ICT infrastructure audit vs. a
catering contract). Before the fix, `gov_sources.merge()` folded them into ONE release: the SARS
tender vanished from the merged output entirely, and the surviving (wrong) release - still
labelled as the unrelated department's catering tender - picked up the SARS tender's document
("SARS advert.pdf") as if it were its own. No error, no warning, no `source_disagreements` entry
(that mechanism only fires on a closing-date mismatch, not a buyer mismatch) - a reviewer or an
automated digest would see a plausible-looking, wrong result with nothing to flag it.

**Fix:** added the 3 missing entries to `BUYER_FAMILY` (`sars_procurement`, `cidb_tenders`,
`dbsa_procurement`), matching the existing style (a regex on the source's own `BUYER` constant -
`\bsars\b|revenue service`, `\bcidb\b|construction industry development board`,
`\bdbsa\b|development bank of southern africa`). No change to `_find()`/`merge()` itself - the
mechanism was always correct, only its source list was incomplete. Left a comment on
`BUYER_FAMILY` itself spelling out the failure mode, since this is exactly the kind of omission a
future "add source #9" pass could repeat silently.

**Verification:** direct adversarial reruns of the exact scenario above - after the fix, the SARS
tender and the unrelated department's tender stay two separate releases (confirmed for
`sars_procurement`, `cidb_tenders`, and `dbsa_procurement` each against an unrelated buyer sharing
a generic ref format). Also confirmed the fix doesn't break the legitimate case: a SARS tender
also listed on the portal under SARS's own name still folds into one release as before. Added
`test_new_sources_are_in_buyer_family()` to `test_gov_sources.py` - pins that all 3 sources are
registered in `BUYER_FAMILY`, that each pattern actually matches its own source's `BUYER` string
(so a typo'd regex would be caught too), and both the cross-buyer-must-not-fold and
same-buyer-must-fold scenarios - called from `main()`. Full suite: `test_gov_sources.py` (now 2
new checks + the regression test, all passing), `test_tender_enrichment.py`,
`test_award_outcomes.py` - all clean. `python3 -m py_compile gov_sources.py test_gov_sources.py`
clean.

**Not yet tested / flagged:** `dbsa_procurement.py`, `cidb_tenders.py`, `sars_procurement.py`'s
own parsing logic (date formats, malformed HTML, the cidb JSON feed's field names) wasn't
adversarially re-tested this run beyond what `test_new_sources()` (added alongside them) already
covers - worth a dedicated pass if this area is picked again. `tender_changes.py` still has no
dedicated test file (flagged since the eleventh/twelfth run, still open).

## 2026-10-19 (sixteenth run): a reassigned key person's "won project" stays on their CV record
forever, with no later sync ever correcting it

**Context:** synced with `origin/main` and picked up migration `0065` (submission/opening
reminders + won-project-to-CV sync, PR #19) plus `0066` (another session's own same-day fix of a
severe RECORD-field bug it introduced in `tt_check_same_company()` - confirmed that fix is sound,
re-read its reasoning and the real Postgres-backed test it cites; nothing more to do there).
Picked `syncWonProjectToTeam()` (`app/app/tenders/[id]/actions.ts`) for this run: brand new,
writes real CV-feeding history (`projects` table) once a tender is won, and the project's own
"no live Supabase" gap means this kind of TypeScript/Supabase logic gets far less adversarial
attention than the Python engine side - exactly the kind of under-covered area this rotation
exists to reach.

**Finding 16 (CONFIRMED, FIXED, severe - stale data with no way to self-correct):**
`syncWonProjectToTeam()`'s own comment calls its upsert (`onConflict: "person_id,source_tender_
pack_id,position_code"`) an "idempotent re-sync" - true only while nobody changes who is
confirmed for a position. `position-person-select.tsx` (the Workspace's key-person picker) has
**no `pipeline_stage` gate at all** - a key person can be reassigned off a position, or a position
un-confirmed entirely, at any time, including after the tender is already Won and already synced
once. Because the upsert's conflict key includes `person_id`, reassigning the position to someone
else doesn't update the old person's row - it inserts a brand-new row for the new person and
leaves the old person's row untouched. Every later re-sync repeats the same thing: the old
person's `projects` row is never touched again, so their People-page CV history permanently
claims they worked a project they were reassigned off, with no action anywhere in the product
that ever corrects it.

**Fix:** extracted the stale-row detection into a pure function, `staleSyncedProjectRows()`
(new file `app/app/tenders/[id]/won-project-sync-logic.ts`, same "pure logic beside actions.ts"
pattern `pack-review-logic.ts`/`signatory-logic.ts` already use, specifically so this is
unit-testable without a live Supabase client). `syncWonProjectToTeam()` now fetches the pack's
existing synced rows (`projects` where `source_tender_pack_id` = this pack), computes which no
longer match the currently-confirmed person for their position (reassigned, or un-confirmed), and
deletes those before the upsert - scoped to rows this same sync action created, never another
pack's or another tenant's history. The reassigned-away person's People page is now also
revalidated, not just the newly-confirmed person's.

**Verification:** `node --experimental-strip-types "app/app/tenders/[id]/won-project-sync-logic.
test.ts"` - 6/6 new tests pass: first-ever sync (nothing stale), unchanged re-sync (nothing
stale), the real bug (reassigned position flags the old person's row), a position un-confirmed
entirely (its old row flags too), multiple positions (only the changed one flags, not the whole
pack), and a defensive case (never assumes at most one existing row per position). Methodology
note: `node --experimental-strip-types --test "app/app/tenders/[id]/<file>.test.ts"` (the
documented invocation two earlier sessions used successfully for `pack-review-logic.test.ts`/
`signatory-logic.test.ts`) resolves to **0 tests found, no error** in this environment's Node
(v22.22.0) - confirmed this is a pre-existing environment/tooling quirk, not a regression I
introduced, by running those same two older test files the identical way and getting the same
silent 0-tests result. The working form in this environment drops `--test` and runs the file
directly (`node --experimental-strip-types "path/with/[id]/file.test.ts"` - `node:test`'s own
`test()` calls execute immediately either way); re-ran `pack-review-logic.test.ts` and
`signatory-logic.test.ts` that way too, 19/19 and 10/10 still pass, so nothing is actually broken
by this - only the glob-based file-discovery path through `--test` can't resolve a `[id]`
bracketed directory on this Node version. Worth a one-line callout for whichever session next
touches test infra in this project, since every future session trying the documented invocation
on this same Node version will hit the identical silent false-negative.

**Not done (flagged):** `position-person-select.tsx` still has no `pipeline_stage` gate -
reassignment after Won stays possible by design (this fix makes re-syncing honest about it
afterwards, it doesn't prevent the reassignment itself, which may be exactly the point - a
genuine staffing correction after completion is a legitimate use case, not a bug). Whether
reassignment should be blocked, warned about, or left open once a tender is Won is a product
call, not something this pass should pick unilaterally.

## 2026-10-19 (nineteenth run): `--no-fetch-documents` promised "much faster" and quietly wasn't

**Context:** synced with `origin/main` and picked up the sibling QA pass's own "seventeenth run"
(a real, useful outcome of my sixteenth-run finding: `app-ci.yml`, real CI for `app/` that runs
every `*.test.ts` file directly rather than through `node --test`'s glob, exactly working around
the bracketed-path quirk I flagged). Picked `engine/notify/daily_digest.py` for this run -
"notify" is a standing rotation area that has only ever had its date-crash fixes touched
(sixth run) rather than a dedicated pass, and this script is unusually heavily pre-tested
(`test_digest_live.py` already covers cross-tenant isolation, seen-store transitions, role
filtering) - good odds that what's left to find is a real-but-subtle gap rather than a repeat.

**Finding 19 (CONFIRMED, FIXED, moderate - a flag silently doesn't do what its own help text
promises):** `main()`'s `--no-fetch-documents` argument is documented as "metadata-only scoring
(no per-release document download) - much faster, useful for a quick local run." It only ever
threaded through to `score_per_company(..., fetch_documents=not args.no_fetch_documents)` -
`fan_out()`'s own PDF-text download used FOR SCORING. `fetch_releases()` (called earlier in
`main()`, to get the releases in the first place) called `gov_sources.releases_for_watch(names)`
with no `with_documents` argument at all, defaulting to `True` regardless of the flag - so every
source's own slow per-release document/detail-page read (SANRAL's ~85 detail-page fetches at 1s
apart, Eskom/Transnet's per-tender document-list reads) ran in full every time, flag or no flag.
A "quick local run" was never actually quick - not a data-correctness bug, but a documented
behaviour that silently never did what it said, confirmed by reading `fetch_releases()`'s own
call to `gov_sources.releases_for_watch` rather than assuming the flag's help text matched reality.

**Fix:** `fetch_releases()` gained a `with_documents` parameter, threaded through to
`gov_sources.releases_for_watch(names, with_documents=with_documents)`; `main()` now calls
`fetch_releases(args.days, args.sources, with_documents=not args.no_fetch_documents)`.
`test_digest_live.py`'s own monkeypatch of `daily_digest.fetch_releases` (a lambda with no
`with_documents` parameter) would have raised `TypeError` on the next `main()` run under the new
keyword-argument call site - updated it to accept and ignore the new parameter, same as every
other caller that doesn't care about it.

**Verification:** added a new check to `test_digest_live.py` that saves the real `fetch_releases`
before the file's own later monkeypatch replaces it, then spies on `gov_sources.releases_for_watch`
directly - proves `with_documents=False` and `with_documents=True` both actually reach it, rather
than trusting the code path looks right. Full suite: `test_digest_live.py` (all existing checks
plus the 2 new ones, 0 failures), `test_gov_sources.py` (unaffected, still clean).
`python3 -m py_compile engine/notify/daily_digest.py engine/notify/test_digest_live.py` clean.

**Not yet tested / flagged:** the rest of `daily_digest.py`'s role-visibility matrix
(`SECTION_VISIBILITY`, the `CV_KEYWORDS`/`FINANCE_KEYWORDS` heuristic classifiers, the
`reassessed_tenders` pursuing/not-pursuing split) was read closely this run and found sound -
every cross-tenant isolation path (`own()`, `listing_change_signals()`'s per-company ocid
matching) traced correctly, and the "most urgent tender update" viewer summary was confirmed to
rely on `pending_digest_updates()`'s own pre-sort by urgency (not an unsorted `items[0]`, which
would have been a real bug) rather than assumed safe. No further issues found in this file this
run; `tender_changes.py` still has no dedicated test file (flagged since the eleventh/twelfth
run, still open).

## 2026-10-19 (twenty-first run): `run_bridges.py --script` without `--bridge` silently stopped
ALL real queue processing, not just the quoted example

**Context:** synced with `origin/main` and picked up the sibling pass's own "twentieth run"
(migration 0068 verification, a stale-reference fix, and - genuinely important - Finding 20:
migrations `0063`-`0068` are committed but **not yet applied to the live Supabase project**,
already confirmed by a real production error per that pass's own evidence; needs Sarel's direct
action, nothing a sandbox session can do without live credentials, already flagged, not
re-flagging here). Picked `engine/worker/run_bridges.py` for this run - "worker/job-queue" is a
standing rotation area that has only ever been verified once before (eighth run: confirmed the
`TimeoutExpired` str/bytes handling was NOT a bug), never given a dedicated adversarial pass, and
this is the one script every bridge's job fulfillment depends on in production (the container's
own `CMD` runs nothing but `run_bridges.py --loop`).

**Finding 21 (CONFIRMED, FIXED, severe - the module's own documented usage example silently
broke production job processing):** `main()` computed which bridges to run as
`args.bridge or ([] if args.script else sorted(BRIDGES))`. Giving `--script` **without**
`--bridge` - exactly this file's own Usage example, `python3 run_bridges.py --loop --script
engine/some/other_bridge.py` - resolved to `names = []`: **none** of the 5 registered bridges
(`cv`, `cv_extract`, `pack`, `general`, `onboarding`) ran, only the one `--script` path. This
directly contradicts the module's own docstring, which states the contract in plain words: "and
any other one can be added with `--script PATH`" - "added," not "replace everything with."
Reproduced directly: `names = args.bridge or (...)` with `bridge=None, script=["x.py"]` resolved
to `[]`, confirmed against the real `BRIDGES` dict. In production this flag combination isn't
used today (the container's `CMD` is plain `--loop`, no `--script`), so nothing is live-broken
right now - but anyone following this file's own documented example to add a one-off custom
bridge alongside the real ones (a very plausible, literally-suggested-by-the-docs operation)
would have silently stopped all CV generation, pack generation, onboarding-document scanning and
non-SANRAL pack extraction for as long as the worker ran that way - with no error, no alert, just
a quiet absence of their log lines.

**Fix:** extracted the resolution into `resolve_bridge_names(bridge_arg)` (`bridge_arg or
sorted(BRIDGES)` - `--script` never participates in this decision at all now, matching the
documented contract exactly), called from `main()` in place of the inline expression. `--bridge`
still narrows to just the named bridge(s) when explicitly given; `--script` only ever adds.

**Verification:** direct reproduction of the bug (`resolve_bridge_names` old vs. new logic against
the real `BRIDGES` dict) before fixing. New unit test `test_script_flag_is_additive()` in
`test_poll_loop.py` - no `--bridge`/no `--script` runs every registered bridge, `--script` alone
(no `--bridge`) still runs every registered bridge plus the addition, `--bridge cv` still narrows
to just `cv`. Full suite: `python3 engine/worker/test_poll_loop.py` - all 5 checks pass, including
the pre-existing real-subprocess `run_bridges.py` test (`--script` given without `--bridge` in
that test too - confirmed the fix doesn't change its outcome, by running it for real both before
and after: the broken-bridge test's own assertions on `out_broken` all still hold, `took < 5`
still holds at the same ~0.0s). Also ran the fixed CLI directly end-to-end
(`python3 engine/worker/run_bridges.py --once --script /tmp/nonexistent_bridge.py`) and confirmed
exit 0 with all 5 registered bridges now actually invoked, not just the missing extra one.
`engine/alerts/test_system_alerts.py` (reads `run_bridges`' alert-recording path) unaffected,
still clean. `python3 -m py_compile run_bridges.py test_poll_loop.py` clean.

**Not yet tested / flagged:** `resolve_scripts()`'s label collision when two different `--script`
paths share the same basename (e.g. `foo/a.py` and `bar/a.py` both labelled `"a.py"`) would
confuse the "missing bridge" logging between cycles - narrow, operator-error-only, not fixed this
run. `tender_changes.py` still has no dedicated test file (flagged since the eleventh/twelfth
run, still open).

## 2026-10-19: closing out the thirteenth run's flagged "bigger than a QA-pass scope" item - the
six orphaned onboarding-scan fields now have real columns, plus the CIDB mismatch signal

The thirteenth run (commit `2d4c124`) fixed the review screen so it stopped claiming the six
fields below would be saved when `confirmVaultDocument` had nowhere to write them, but explicitly
flagged giving them a real home (and building the CIDB `contractor_name` vs. `legal_name`
mismatch check that finding called out as "a real compliance signal, not just metadata") as
out of scope for that pass, needing product sign-off. Migration `0069` adds the six `companies`
columns (`cidb_registration_number`, `cidb_contractor_name`, `bee_entity_name`,
`bank_confirmation_bank_name`, `bank_confirmation_account_holder`,
`iso_9001_certified_entity_name`), `VAULT_FIELD_COLUMNS` in `app/lib/onboardingScan.ts` now routes
all six, and `cidbNameMismatchWarning()` (same file) renders a red, non-blocking warning on
`review.tsx` when a CIDB certificate's `contractor_name` doesn't closely match the company's own
`legal_name` (legal-suffix-aware normalization + word-overlap threshold, so "(Pty) Ltd" formatting
differences never trigger it, only a genuinely different name does). Bank fields stayed on
`companies`, not the more-restricted `bank_accounts` (`0050`) that finding's own write-up
suggested checking: `bank_accounts.account_number` is `NOT NULL` and the scan never extracts an
account number, so a row can't be created there from `bank_name`/`account_holder` alone. All six
fields go through the existing ticked/quote-verification gate unchanged - no new write path, no
change to `confirmVaultDocument`'s generic field-writing loop. Full detail and column names:
`System-Status.md`'s new "Onboarding document scan: the six previously-orphaned fields..." row.
`node --experimental-strip-types --test app/lib/onboardingScan.test.ts` - 18/18 pass.

## 2026-10-19 (twenty-fourth run): the "unreproducible GitHub-runner difference" blocking CI green
was a brittle test assertion all along

**Context:** synced with `origin/main` and picked up the sibling pass's "twenty-second run" -
a genuinely major discovery: `bridge-worker-ci.yml` had been red on **52 of its last 53 runs**,
undetected for the project's entire history because every session (this one included, across 22
prior runs) only ever trusted its own local "all tests pass" result, never the real GitHub Actions
conclusion. That pass found and fixed a real race condition (Finding 21) and a CI config bug
hiding ~20 test files behind "skipped" (Finding 22), but left one failure open: `test_extract_
cv_fields.py`'s `naledi_cv.pdf via pdftotext -layout` check, diagnosed as "passes reliably in this
sandbox... looks like a GitHub Actions runner-specific difference I can't reproduce or iterate on
here." This run picked that up directly, now that CI run history and job logs are a tool away
(`mcp__github__actions_list`/`get_job_logs`) rather than something to only reason about secondhand.

**Finding 23 (CONFIRMED, FIXED, moderate - a false "environment difference," not a real one):**
pulled the actual failing job's log for the latest run (`39238384524`, job `118012945285`) rather
than re-trusting the "can't reproduce" diagnosis. The failing check itself:
`check("20169999" in t and "University of Cape Town" in t and "TMRA/2019/04" in t, ...)` - a bare,
unnormalised substring check. Its own neighbouring comment claims *"LibreOffice's PDF wraps the
narrow table column mid-token ('TMRA/2019/04' / '4')... which is why quotes are also matched with
whitespace removed"* - but the code never actually did that; it was a plain `in` check with no
normalisation at all, exactly as fragile to a different LibreOffice point release wrapping the
same table cell a few pixels differently as the comment claimed it wasn't. `extract_cv_fields.py`
already has the real, production-tested, wrap-tolerant matcher this comment was describing -
`evidence_in_text()` (exact match after `_norm()`, then a squeezed letters+digits fallback
explicitly built for "a quote wrapped mid-token by a narrow table column ('TMRA/2019/04' + '4')")
- every real CV extraction already verifies its quotes against this, just not this one smoke-test
assertion. Confirmed the fix doesn't just paper over real corruption: tested `evidence_in_text()`
directly against three cases - text with the registration number genuinely absent (correctly
rejected), the exact benign mid-token wrap this comment describes (correctly tolerated), and a
different, wrong registration number (correctly NOT matched) - before trusting it as the fix.

**Fix:** `test_text_extraction()` now normalises with `x._norm(t)` and checks all three expected
values through `x.evidence_in_text()` instead of a bare `in` check - reusing the same matcher
production CV extraction already relies on, rather than a second, less tolerant one invented just
for this test.

**Verification:** `python3 engine/cv/test_extract_cv_fields.py` - `ALL PASSED` (installed the
`anthropic` package locally first, confirmed missing and unrelated to this fix - every other
check in this file already ran clean without it; Tesseract-dependent OCR checks skip gracefully,
same as every prior run). `python3 -m py_compile` clean. `engine/worker/test_poll_loop.py` (reads
`run_bridges.py`/`poll_loop.py`, unaffected) still 5/5. Pushed to `main`; the next `bridge-worker-
ci.yml` run on GitHub is the real verification this fix needed and couldn't get locally - check
its conclusion before treating this as closed, not just this write-up's own confidence.

**Not yet verified:** whether this is genuinely the LAST failing step - `bridge-worker-ci.yml`'s
`container-build` job and the `app-ci.yml` workflow were not re-checked this run (both showed
green in the twenty-second/twenty-first-run write-ups); only `smoke-test`'s one known-red step was
in scope here.

**Confirmed (same run):** checked the real run (`mcp__github__actions_get`, run id `39255442921`,
commit `ec7e49b`) rather than stopping at local confidence - `"status":"completed","conclusion":
"success"`. This is `bridge-worker-ci.yml`'s **first fully green run in the project's history**
(run #56; the prior 52 of 53 were all `failure`). Both `smoke-test` and `container-build` jobs
passed. Messaged the parent session - this is exactly the kind of result worth surfacing, not a
quiet close-out.

## 2026-10-19 (twenty-sixth run): a tender's closing date oscillating between two values could
silently stop being reported after the first two changes

**Context:** synced with `origin/main` and picked up the sibling pass's "twenty-fifth run"
(independently re-confirmed the CI-green result and a small navigability fix - no new findings).
Finally picked up the oldest standing open item on this review's own list, flagged repeatedly
since the eleventh run: `tender_changes.py` had no dedicated test file. Read the module in full
before writing one, specifically looking for real bugs to test against rather than just adding
coverage for its own sake.

**Finding 24 (CONFIRMED, FIXED, severe - a silent "gate": real data, dropped with total
confidence, no error):** `_event()`'s fallback `dedupe_key` (used by `closing_date_changed`,
`briefing_changed`, `title_changed`, and the `closing_date`-field branch of `sources_disagree`,
every call site that doesn't pass its own `key_extra`) was built from `json.dumps(new, ...)`
alone - the NEW value only, with no notion of time. The module's own docstring states the intent
plainly: *"Every change has a dedupe_key ... so a re-run never records the same change twice."*
But a listing's closing date (or briefing date, or title) can genuinely **revisit** an earlier
value - extended from A to B, reverted back to A, then genuinely extended to B again, weeks
later - three separate, real events a bid team needs to know about, not one. Because the second
B only differs from the first B by *when* it happened, and the key carried no time information at
all, the third event's dedupe_key was byte-for-byte identical to the first's - `store.save()`
found it already in `known` and silently dropped it. No error, no warning, nothing in the digest:
the daily digest and the tender-updates feed would simply never mention that the tender's date
moved again. Reproduced directly: a synthetic release cycled A (day 1) -> B (day 5, reported) ->
A (day 10, reported) -> B (day 15) - the day-15 event, identical in every way to day 5's except
the date it actually happened, was silently swallowed before the fix.

**Why this matters more than it looks:** this isn't a rare shape. SA public-sector tenders
routinely get extended, sometimes walked back by a day or two on an admin correction, then
extended again to settle on the same final date discussed earlier - exactly the oscillation this
bug ate.

**Fix:** `_event()`'s fallback key now buckets by the day the change was detected
(`datetime.datetime.now(sh.SAST).date().isoformat()`) before the JSON-encoded value. This still
correctly dedupes the one case the mechanism is actually there for - two `detect()`/`save()` calls
racing against the same stale, not-yet-persisted snapshot (necessarily within the same day) -
without collapsing two genuinely separate occurrences of the same value that are days or weeks
apart, which is how real extensions/reversions are spaced in practice. Verified the trade-off is
sound and deliberate: a literal same-day, same-value flip-flop would still dedupe (accepted - rare,
and the alternative of a correctly-timestamped dedupe key that never merges same-day legitimate
retries would need per-event history lookups in both `LocalStore` and `SupabaseStore`, a larger
change for a narrower, lower-probability gap than the one this fixes).

**Verification:** new dedicated test file `engine/discovery/test_tender_changes.py` (closes the
long-standing "no dedicated test file" gap) - 4 tests, 8 checks: the exact oscillation bug across
simulated days 1/5/10/15 (all four states - including the previously-dropped fourth - now
reported); a same-day retry against an already-advanced snapshot correctly reports nothing extra;
two different tenders changing to the identical new value the same day are never merged into one;
the `sources_disagree` branch gets the same fix and re-verified independently. All pass. Full
regression: `test_gov_sources.py` (`tender_changes` section + everything else) - `ALL PASSED`,
unchanged. `engine/notify/test_digest_live.py` (reads `tender_changes.py` via `daily_digest.py`'s
listing-changes section) - `0 failure(s)`. `python3 -m py_compile tender_changes.py
test_tender_changes.py` clean.

## 2026-10-19 (twenty-seventh run): narrowing Finding 24's own accepted trade-off from a day to a minute

Finding 24's own write-up was explicit about a remaining gap: "a literal same-day, same-value
flip-flop would still dedupe (accepted - rare...)." Reproduced it directly before accepting that
framing - a closing date flipping A->B->A->B three genuine times within one calendar day (hours
9/10/11, not days apart) still silently dropped the third occurrence under day-level bucketing,
the same failure mode Finding 24 fixed, just narrower in scope.

Checked whether the day-wide bucket was actually necessary for the protection it exists for:
`watch_new_tenders.py` and `daily_digest.py` each call `tender_changes.run()` exactly once per
scheduled run, with no retry loop at either call site, and this project's own cadence is once
daily - so the only realistic way two calls race the same stale snapshot is a manual or
infra-level retry of the same script, which happens within seconds to a couple of minutes, never
a whole calendar day later. Narrowed the bucket from the day to the minute: the real protection
(two near-simultaneous calls still collapse to one event) is unchanged, the residual collision
risk now needs two genuinely separate occurrences within the same single minute rather than the
same calendar day - closing the practical gap rather than documenting around it.

**Verification:** added `test_same_day_multiple_real_oscillations_all_reported` to
`test_tender_changes.py` (now 5 tests, 10 checks) - reproduces the exact hour-9/10/11 same-day
triple-flip. Confirmed it actually catches the regression: temporarily reverted the one-line
bucket-width change back to day-level and re-ran - the new test's third assertion failed exactly
as expected (`FAIL hour 11: ...`); restored the fix and re-ran clean. All 4 pre-existing tests
still pass unchanged under minute-bucketing. Full regression: `test_gov_sources.py` -
`ALL PASSED`; `engine/notify/test_digest_live.py` - `0 failure(s)`.

## 2026-10-19 (twenty-ninth run): a relative document link crashed the entire new auto-download
pass, taking every other tender's documents down with it

**Context:** synced with `origin/main` and picked up two sibling passes landed since the
twenty-sixth run - "twenty-seventh" (narrowed the oscillation fix to a minute, directly building
on Finding 24) and "twenty-eighth" (a migration-ordering fix, Finding 25) - plus a large batch of
brand-new discovery features: `download_discovered_documents.py` (auto-downloads and permanently
stores every document for every discovered tender, unattended, per Sarel's own direction),
`opportunity_requirements.py`, and the admin discovered-opportunities review UI (migrations
0071/0072). Picked `download_discovered_documents.py`: new, unattended, runs automatically on
every watch cycle with no human review before it fires, and explicitly promises in its own
docstring that "one bad or dead link must not take out the whole run" - exactly the kind of
promise worth adversarially testing rather than trusting.

**Finding 26 (CONFIRMED, FIXED, severe - the exact failure its own docstring promises can't
happen):** `fetch_document()`'s only exception handler caught `(URLError, HTTPError, TimeoutError,
OSError)`. A relative or scheme-less URL makes `urllib.request.Request(url, ...)` itself raise
`ValueError` the moment it's constructed - before `urlopen` is ever called, so none of those
caught types apply. Confirmed this is directly reachable, not theoretical: `sars_procurement.py`'s
own `fetch_documents()` captured a raw regex-matched `href` with **no absolute-URL resolution at
all** (`DOC_LINK = re.compile(r'<a[^>]+href="([^"]+\.(?:pdf|docx?|xlsx?|zip))"'...)` - no scheme
requirement, unlike `dbsa_procurement.py`'s equivalent, which does resolve relative hrefs, or
`transnet_etenders.py`'s, which requires an absolute `https://` prefix in the regex itself). A
same-site relative link (`href="/files/tender/spec.pdf"`, an entirely ordinary thing for a real
site's HTML to contain) reaches `download_discovered_documents.py` as a bare `document.url` with
no scheme. Reproduced directly: `fetch_document("/files/tender/RFP14-2026-spec.pdf")` raised
`ValueError: unknown url type` uncaught, which propagates out of `download_for_releases()`'s
per-document loop entirely - **taking down document downloads for every other release and
document in that run**, exactly the "one bad link must not take out the whole run" failure the
function's own docstring says it prevents.

**Also checked, deliberately NOT fixed:** considered adding an http(s)-only scheme allowlist as
defense-in-depth (SSRF/`file://`-read hardening) before calling `urlopen`, and implemented it
first - but `file://` URLs turned out to be this codebase's own **established, deliberate**
convention for offline test fixtures standing in for a live link, used across
`test_discovery_fanout.py`, `test_discovery_downgrades.py`, `test_taxonomy.py`, and this module's
own test, all feeding the SAME production fetch code path (`assess_tender.fetch_pdf_text` and now
this module). A scheme allowlist would have silently broken that established pattern without
closing any gap actually demonstrated to be reachable from a real external source. Reverted the
allowlist; kept only the minimal, precisely-targeted fix for the bug actually reproduced.

**Fix:** two changes, root cause and containment, same pattern as past findings in this log
(compare Finding 14's `BUYER_FAMILY` entries / Finding 19's threading fix): (1)
`sars_procurement.py`'s `fetch_documents()` now resolves every document href with
`urllib.parse.urljoin(url, href)` against the page it was actually found on, rather than storing
it unresolved; (2) `download_discovered_documents.py`'s `fetch_document()` also now catches
`ValueError`, so even a bad link slipping through from some other source degrades to a normal
`failed` row instead of crashing the run - containment, not just a root-cause patch, since a
badly-formed link could in principle originate from any source reader, not only this one.

**Verification:** direct reproduction of the exact crash before fixing, then confirmed fixed.
New checks: `test_gov_sources.py` gained 2 new assertions (`sars_procurement`'s relative-href
resolution, and that an already-absolute href is left untouched) - both the real `DOC_LINK` regex
and `urljoin()` exercised together, not just the resolution logic in isolation.
`test_download_discovered_documents.py` gained a 6th case (a relative URL alongside a normal one
on the same release: the relative one gets a `failed` row with a reason, the normal one still
downloads, the run never raises) - full suite `All checks passed`. `test_gov_sources.py` full
suite - `ALL PASSED`, including `test_opportunity_requirements.py` (reads the same discovered-
documents shape) - `All checks passed`. `python3 -m py_compile` clean on all four touched/tested
files.

## 2026-10-19 (thirtieth run): a genuinely tricky threading/timeout fix held up under independent
reproduction - but the temp-file cleanup around it has leaked on every failed download all along

**Context:** one new commit since the twenty-ninth run - `de4541b`, "Fix a document fetch that can
hang the entire discovery run forever" (`engine/discovery/assess_tender.py`'s `fetch_pdf_text()`,
used by `read_release()` for every discovered tender's own document). Flagged for scrutiny on sight
rather than read-and-trust: threading-based timeout fixes are a well-known class of change that
reads correct and compiles clean while still being subtly wrong, and this session's own standing
rule is to never accept a commit's "Confirmed live" claim without reproducing it.

**What the commit fixed:** `urlopen(req, timeout=N)` only bounds each individual socket
read/connect, not the download's total wall-clock time - a server that trickles a few bytes in
just under that interval per read, or that accepts the connection and sends headers then goes
silent without ever closing it, can make `r.read()` block forever with no exception ever raised
(the commit's own docstring: a live run sat on one open socket for 90+ minutes with zero progress).
The fix runs the download in a plain `daemon=True` thread and enforces a true wall-clock deadline
(`timeout + 15s` grace) via `queue.Queue.get(timeout=...)` - deliberately not
`ThreadPoolExecutor`/`concurrent.futures.Future`, since a `Future`'s worker thread is not daemonic
and an abandoned one would keep the whole process alive at exit waiting to join it.

**Independent verification (not a read-through):** built 3 disposable local HTTP servers
(`verify_fetch_pdf_text.py`/`2.py`, scratch-only, not committed) to reproduce the actual failure
modes rather than trust the docstring:
1. **The exact bug class described** - a server sending 10 bytes every 0.5s forever, no
   `Content-Length`, under a 1s per-read timeout. No individual `read()` call can ever time out
   here (each one succeeds, just slowly) - only a true wall-clock deadline catches it. Confirmed:
   `fetch_pdf_text` returned `("", "...stalled past 16s...")` at the ~16s deadline, not hung.
2. **A flat hang** (server sends nothing after headers, ever) - confirmed this was already caught
   by the plain per-read socket timeout even before reaching the wall-clock deadline (fires in
   ~1s, not 16s) - the fix doesn't regress or slow down this simpler, more common case.
3. **A normal fast server** - confirmed it returns immediately, never waits out the deadline.
4. **Connection refused** - confirmed a fast, graceful `("", err)` tuple.
Also confirmed the abandoned background thread genuinely does not block process exit: the whole
test process exits cleanly right at the 16s deadline in case 1, never hanging afterward - the "one
leaked socket, reclaimed by the OS at exit" tradeoff the commit's comment claims is real, not just
asserted. Ran the real production path too: `test_discovery_fanout.py` (`fetch_pdf_text` over two
genuine PDFs via `file://`, the same code path a live eTenders document link takes) -
`0 failure(s)`, verdicts unchanged. **Verdict: `de4541b` is correct and properly scoped.**

**Finding 27 (CONFIRMED, FIXED, moderate - pre-existing, not introduced by `de4541b`):** every
failed document download leaks its temp `.pdf` file into `/tmp` permanently.
`tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)` creates the file on disk the instant it
is opened - before `urlopen` is even attempted - and the surrounding `except` clause (in both the
pre-`de4541b` synchronous code and the new threaded version) never calls `os.unlink` on that path;
only the success path's own `finally` block does. Confirmed directly: `glob`'d `/tmp` before and
after a single `fetch_pdf_text()` call against a refused connection - exactly one orphaned
`tmp*.pdf` file was left behind. This is not a rare edge case: `0071`'s own migration header
explicitly treats dead links, 404s and timeouts as routine, expected traffic for this pipeline
("never silently dropped and never retried forever") - meaning every ordinary bad link on a real
buyer's site has been quietly filling `/tmp` with empty/partial files, unbounded, for as long as
this function has existed, not something `de4541b` made worse.

**Fix:** `_download_to_tempfile` now unlinks its own temp file in the `except` branch - covers the
common case (dead link, 404, connection refused, a genuine per-read socket timeout). Added one more
case the threading fix itself makes newly possible: a download abandoned at the wall-clock deadline
that completes (success or failure) afterward, unwatched, in the background thread - a plain
`threading.Event` (`abandoned`), set by `fetch_pdf_text` when it stops waiting, tells that thread to
delete its own temp file once it finishes rather than queue a path nobody will ever read or clean up.

**Verification of the fix:** re-ran the leak check - 0 leaked files after a failed download (was 1
before, identical repro). Re-ran all 4 reproduction cases above - unchanged, all still correct.
Re-ran `test_discovery_fanout.py` end to end - `0 failure(s)`, verdicts unchanged. `python3 -m
py_compile engine/discovery/assess_tender.py` clean.

## 2026-10-19 (thirty-first run): a tender-specific CV's own internal audit trail said a real
person was "not present in None candidates list"

**Context:** synced with `origin/main` and picked up two sibling passes (thirtieth run: a
threading fix in `assess_tender.py`'s document-fetch timeout, plus a pre-existing temp-file leak
found while reading it - both independently reproduced and confirmed correct) and a dark-mode
palette fix. Discovery has absorbed most of this review's recent cycles given how much new code
has landed there; rotated deliberately to `engine/cv/generate_cv.py` instead - "CV" had only been
verified once before (eighth run, confirming a non-bug in SANRAL scoring), never given a focused
adversarial pass of its own, and has **no dedicated test file at all** (the standard,
non-tender-specific CV path is smoke-tested by `process_cv_jobs.py --self-test`, but that self-
test never exercises `--tender`/`--position`, so the cover-page logic had zero coverage).

**Finding 28 (CONFIRMED, FIXED, minor-but-real - a broken internal audit trail, not a buyer-
facing document bug):** `add_cover_page()`'s "candidate not matched" branch
(`if cand is None: ...`) records a `ProvenanceLog.missing()` entry whose `reason` interpolated
`tender_ctx['candidate']!r` - but `cand = tender_ctx["candidate"]`, and this code only runs
*inside the `if cand is None:` branch*, so `tender_ctx['candidate']` is **always, unconditionally,
literally `None`** at that point. Every single occurrence of this reason, for every person never
matched to a position, rendered as the nonsensical "`<name> not present in None candidates list
for position <code> at the time pack_suggestions.json was generated.`" Reproduced directly by
calling `add_cover_page()` with a `cand=None` context and reading the stored provenance entry.
Not a bug a buyer ever sees (this reason lives only in the internal `.provenance.json` file -
the buyer-facing page prints a generic, correct sentence above it regardless) - but a real,
confirmed defect in the one mechanism this entire project relies on for "never guess, say what
you don't know and why," which is exactly the kind of thing an internal reviewer or a future
debugging session would trust and be misled by.

**Fix:** the reason now names the actual `person_id` and position code (`pos['code']`), both
already in scope and accurate, instead of referencing the structurally-always-`None` value.

**Verification:** new dedicated test file `engine/cv/test_generate_cv.py` (closes the "no
dedicated test file" gap for this module) - 3 tests, 8 checks: the exact bug (reason no longer
says "None candidates", now correctly names the person/position), a matched-candidate case
(match score confirmed in provenance, the internal rationale text is confirmed to never appear on
the buyer-facing page, no spurious specialism warning), and a specialism-warning case (the
warning paragraph is genuinely printed, and logged as `assumed_default` with a reason, not
silently applied). All pass. Full regression: `process_cv_jobs.py --self-test` - `Self-test OK`,
unchanged provenance summary (`{'confirmed': 20, 'computed': 4, 'missing': 7}`);
`test_extract_cv_fields.py` - `ALL PASSED`. `python3 -m py_compile generate_cv.py
test_generate_cv.py` clean.

**Not yet tested / flagged:** the rest of `generate_cv.py` (both document builders' full field-by-
field content, `generate_as_is()`, PDF conversion failure handling) still relies on
`process_cv_jobs.py`'s own self-test rather than a dedicated adversarial pass of its own - worth
a deeper look if CV comes up again in rotation. `process_cv_jobs.py` and `extract_cv_fields.py`
were not re-examined this run beyond what already passed.

## 2026-10-19 (thirty-second run): two sibling commits independently re-verified, no new findings

Reviewed both commits landed since the thirty-first run: this run's own `b71dc5d` (Finding 28,
above) and `01a15de` ("Fix dark-mode illegibility on Dashboard, Discovery and 4 admin pages"),
which had no entry here yet (different concurrent sibling session). Deliberately checked both
rather than skip the one that already had a write-up, since an author's own verification claim
and this log's independent one are not the same thing.

`b71dc5d`: re-ran `test_generate_cv.py` myself (not just read it) - `0 failure(s)`, all 8 checks.
Confirmed the root-cause claim directly: `cand` is the literal value the branch is guarded on
being `None`, so the old reason's `{tender_ctx['candidate']!r}` could only ever substitute the
string `'None'` - a plain, unconditional bug, not an edge case.

`01a15de`: the commit's message names 6 fixed pages: checked whether that was actually all of
them. Scanned every `page.tsx` in `app/app` (33 files) for the `minHeight: "100vh"` wrapper and
confirmed every one now also sets `background: "#FFFFFF"` - zero left behind. Also independently
confirmed the stated root cause (`app/app/globals.css`'s `@media (prefers-color-scheme: dark)`
body background, no `color-scheme` override anywhere) rather than taking it on faith.

No new findings. Both commits: `completed`/`success` on real GitHub Actions, confirmed via the
API (`39330520763`, `39320580253`).

## 2026-10-20 (thirty-third run): confirmed-live crash in document download, fixed and independently re-verified - no new findings of my own

One new commit since the thirty-second run: `b82210a`, "Stop a missing documents table from
crashing the whole tender watch run". Not something I found myself this run - the sibling commit's
own message reports direct live evidence: a real `watch_new_tenders.py` run scored and seeded 4,034
real discovered opportunities, then crashed uncaught at the document-download step because
migration `0071`'s `discovered_opportunity_documents` table isn't applied to the live project yet
(`existing_urls()`'s read hit a real `PGRST205` "table not found" response). Reviewed and
independently re-verified rather than taken on trust.

**Verified:** `RestClient._req()` (`engine/discovery/company_profiles.py`) only raises `RuntimeError`,
and only on a genuine `HTTPError` from PostgREST - so the fix's `except RuntimeError` is correctly
scoped (a real unreachable-table/bucket condition), not a broad catch-all that could also hide an
unrelated bug. Ran `test_download_discovered_documents.py` myself - new case 7 reproduces the exact
live failure against a real local HTTP server (not a mock) returning the actual `PGRST205` body and
400 status, and confirms `download_for_releases()` returns `{skipped_not_migrated: True}` with
exactly one summary alert instead of propagating - `All checks passed`. Traced the caller
(`watch_new_tenders.py`): the returned summary is only ever printed, never re-raised, so the
degrade-gracefully behavior holds all the way up to the top-level watch run. `python3 -m py_compile`
clean.

No new findings of my own this run - the fix is correct and complete as committed. Green on real CI
(`39344195863`).

## 2026-10-20 (thirty-fourth run): a single stray cross-reference to the wrong form suite could
relabel an entire municipal tender's pack as National Treasury's

**Context:** synced with `origin/main` and picked up two sibling verification-only passes
(thirty-second/thirty-third runs - a crash fix independently re-confirmed, plus a reminder that
the committed-but-not-live migration gap has now caused two real production crashes; not
re-flagging, already tracked). Rotated to `engine/general/` (the non-SANRAL pack engine) -
untouched since the third run's own minor fix, the longest-neglected rotation area by far. Ran
`general_harness.py` (the real regression suite: 9 real tender samples x 7 test companies) in the
background while reading `requirements.py` by hand for a genuine adversarial case, rather than
just trusting the harness's own 9 fixed samples to surface something new.

**Finding 29 (CONFIRMED, FIXED, severe - a confusing, wrong label on every form in a real
tender's pack):** `extract_requirements()`'s suite-detection (`"MBD" in suites and "SBD" not in
suites"`) required the OTHER suite to be **completely absent** for a tender to be labelled MBD
(municipal) rather than SBD (National Treasury) - a single stray cross-reference to the other
suite anywhere in the document set was enough to flip the whole tender's labelling, however
dominant the real suite was. Constructed a realistic adversarial fixture directly (fast, no
LibreOffice needed - `.txt` documents, a supported format): a genuinely municipal bundle with 10
real MBD mentions across MBD 1/4/6.1/7/8/9, plus ONE boilerplate glossary line ("bidders may also
consult the National Treasury's SBD 4 guideline... for reference purposes") - exactly the kind of
template-reuse boilerplate real municipal buyers' documents carry (confirmed plausible against
this project's own 123-tender corpus finding that municipalities use "the MFMA twin... same
purpose and field set, different numbering prefix"). Ran the real `extract_requirements()` CLI
against it: `form suite: SBD` - every single form in the manifest ("MBD 1", "MBD 4", "MBD 6.1"...)
relabelled "SBD 1", "SBD 4", "SBD 6.1" throughout the pack/workspace, mismatched against what the
municipality's own actual documents say, for a bidder who would reasonably expect to see their
own buyer's terminology. Not a crash - the confident, silently-wrong-label class this review
exists to catch.

**Fix:** suite is now decided by majority of real mentions (`mbd_total > sbd_total` → MBD, else
any SBD mentions → SBD, else `None`) instead of mere presence - the `suites` set and its two-
branch presence check are gone entirely. A genuine tie still defaults to SBD, matching the old
default exactly; MBD-only, SBD-only and neither-suite cases are all unchanged (verified directly,
not assumed).

**Verification:** direct adversarial reproduction of the bug before fixing, then 6 cases run
against the real suite-decision logic after: the exact bug (10 MBD + 1 stray SBD → now
correctly `MBD`), MBD-only, SBD-only, neither, a genuine tie (unchanged default `SBD`), and the
mirror case (10 SBD + 1 stray MBD → still correctly `SBD`, proving this isn't a one-sided fix).
Re-ran the real `extract_requirements()` CLI end to end against the adversarial fixture:
`form suite: MBD`, confirmed fixed through the whole pipeline, not just the isolated function.
Also ran `general_harness.py` (9 real tender samples x 7 test companies, pre-fix) as an
independent regression baseline - every sample's own suite is unambiguously single-suite already
(`overberg_q12: suite=MBD`, `mthashana_tvet: suite=SBD`, etc.), confirming none of the 9 real
samples exercises this exact mixed-suite edge case, so this was a genuinely new finding, not
something the existing harness would ever have caught on its own. `python3 -m py_compile
requirements.py` clean.

**Confirmed (same run):** `general_harness.py`'s full run (9 samples x 7 companies, both the
pre-fix background baseline and a fast `--no-pack` re-run against the fixed code) both finished
`77 clean, 0 flagged, 0 failed` - every sample's own `suite` label is unchanged (each is
unambiguously single-suite, as expected). Zero regression against the real corpus, not just
assumed from the isolated-function verification above.

**Not yet tested / flagged:** `fill_flat_pdf.py`'s PDF-label-placement geometry and
`fill_sbd_docx.py`'s docx-filling logic were read but not adversarially tested this run - both
are large, intricate files that would benefit from a dedicated pass of their own.

## 2026-10-20 (thirty-fifth run): two otherwise-correct sibling fixes, each with a real gap left open - both closed

**Context:** 3 new commits since the thirty-third run - `b66dc44` (raw Postgres-error leak fix, 4
pages), `4a2d20f` (Finding 29 above), `25ad827` (doc-only confirmation of Finding 29's regression
run). Reviewed all three independently rather than treat the ones with their own write-ups as
already settled.

**Finding 30 (CONFIRMED, FIXED, moderate - the fix's own stated scope wasn't actually complete):**
`b66dc44` explicitly reasons that ANY customer-facing Supabase query can hit the exact bug class
that caused the confirmed `tender_packs.project_completed_at` production incident, then fixes only
4 of the pages that pattern applies to. Grepped the whole `app/app` tree for the same
`{error.message}` JSX shape after reading the commit, rather than trust its own file list: found 6
more untouched customer-facing sites - `dashboard/page.tsx` (the first screen after login),
`people/page.tsx`, `discovery/page.tsx`, `company/OfficeLocations.tsx`, and two Tender Workspace
sub-components (`tender-templates.tsx`, `tender-updates.tsx`). `OfficeLocations.tsx` was the worst
of the six: its error banner read `"Couldn't load office locations ({error.message}) - migration
0015 may not be applied yet."` - internal schema-version language shown directly to a paying
customer, not merely a raw driver error.

**Fix:** applied the exact pattern `b66dc44` already established (nothing new invented) - a
server-side `console.error(...)` with enough context to debug from logs, and a generic "try
refreshing... let us know" message in place of the raw error - to all 6 sites. Re-grepped
afterward to confirm completeness: zero customer-facing `{error.message}` leaks remain anywhere
under `app/app`, only the 5 admin-only pages (Sarel's own debugging surface, correctly left as-is)
and the 2 upload-form sites (`manual-tender-form.tsx`, `document-scan/upload-form.tsx` - a
different, more actionable "which file failed" kind of message, also correctly left as-is per
`b66dc44`'s own stated reasoning).

**Verification:** `npm run typecheck` clean, `npm run lint` clean (one straight-apostrophe JSX-
text violation caught by `react/no-unescaped-entities` on the first pass, fixed by wrapping in a
string literal - the exact form the original `b66dc44` fix already used elsewhere, confirming
which convention this codebase's lint actually enforces). Full `npm run build` - exit 0, same
route list as before, no new prerender issues.

**Finding 31 (CONFIRMED, FIXED, process gap - not a code bug):** Finding 29's own fix (`4a2d20f`)
was verified carefully by hand (6 cases against the live CLI, plus a full harness regression) but
shipped with zero persisted test coverage - the commit touches only `requirements.py` plus two
docs files, no test file. The commit itself already states the existing 9-sample
`general_harness.py` corpus doesn't exercise this mixed-suite shape, meaning every one of those 6
verified cases could regress silently and nothing would catch it.

**Fix:** added `engine/general/test_requirements.py` - 6 checks, reusing Finding 29's own
adversarial fixture (10 real MBD mentions + 1 stray boilerplate SBD cross-reference) plus the
other 5 cases (SBD-dominant mirror case, MBD-only, SBD-only, neither, a genuine tie), each run
through the real `extract_requirements()` CLI path via real `.txt` documents (no LibreOffice
needed - confirmed `.txt` is already a supported format elsewhere in this module).

**Verification of the new test, not just that it passes:** temporarily reverted
`engine/general/requirements.py` to its exact pre-`4a2d20f` state (`git show 4a2d20f~1:...`) and
re-ran the new test - the adversarial case failed exactly as predicted (`FAIL ... -> MBD`, the
bug reproduced), while the other 5 cases still passed (confirming they were never about this
specific bug). Restored the fixed version and confirmed all 6 pass again. This is the same
"prove the test actually catches the regression, don't just trust a green run" discipline this
review has applied to its own fixes all session, now applied to a sibling's untested one. Also
re-ran `general_harness.py --no-pack` (9 samples x 7 companies) as a full-corpus regression -
`77 clean, 0 flagged, 0 failed`, matching `25ad827`'s own independent confirmation exactly.
`python3 -m py_compile` clean on the new test file.

## 2026-10-20 (thirty-sixth run): intake - a corrupt SANRAL .docx form was silently dropped with zero trace, then misreported as "not uploaded"

**Why this area:** `engine/intake/` (`classify_tender.py`) hadn't had a dedicated pass since the
first run - the longest-neglected engine area after `engine/general/` was just covered (thirty-
fourth/-fifth runs). `classify_documents()` is the SANRAL-vs-general routing gate: a wrong or
silent result here doesn't just produce a bad field, it sends the whole tender down the wrong
pack-generation pipeline.

### Finding 32 (CONFIRMED, FIXED, severe - a "gate" in exactly the sense this review watches for)

**Where:** `engine/intake/classify_tender.py`, `classify_documents()`.

**What was tested:** the function has two parallel document-reading branches inside the same
loop - one for `.xlsm`/`.xlsx` workbooks, one for `.docx` SANRAL forms (C.1.1.1 Form of Offer,
C.1.2.3 Contract Data, A-Forms). The workbook branch already logs a note when a workbook can't be
opened (`info["kind"] == "unreadable" -> notes.append(...)`). The `.docx` branch's exception
handler did not: `try: head = _docx_head(local) except Exception: continue` - a bare `continue`,
no note, nothing. Built a real adversarial fixture - a file literally named
`C.1.1.1 Form of Offer.docx` containing garbage bytes (not a real Word document, the shape a
corrupted upload, a browser save-as-wrong-type, or a renamed non-docx file would actually take) -
and ran it straight through `classify_documents()`.

**Confirmed the bug:** `notes: []`, `sanral_files: {}`, `route: general`. Not one trace anywhere
in the intake decision that a document named exactly like a required SANRAL form was even
present, let alone that it failed to open. Downstream, the SANRAL-route "missing documents"
message (`missing = [... for t in (...) if t not in files]`) would never even fire here (the
tender routes `general`, not `sanral`, since no Technical workbook was in this fixture) - but in
the more realistic case where a *separate, valid* Technical Submission workbook routes the tender
to `sanral` and *this one* C.1.1.1 form is the corrupt one, the exact same silent-drop produces
the message "Not found among the uploaded documents (the SANRAL pack needs them)... Add them with
'Add documents'" - actively telling the user to re-upload a document they already uploaded, with
no indication the real problem is that it couldn't be read. Exactly the "bad input cascades into
confidently-wrong output instead of failing loudly" pattern this review exists to find - the same
class as Finding 26 (a bad discovery link silently dropped, no trace) and the `.xlsm` branch's own
existing `unreadable` handling, just missing on the `.docx` side of the identical loop.

**Fix:** mirrored the `.xlsm` branch's own established pattern - log a note in the `.docx`
branch's exception handler instead of silently continuing:
```python
elif fmt == "docx" and not d.get("unreadable"):
    try:
        head = _docx_head(local)
    except Exception as e:
        notes.append(f"{d['name']}: could not be opened as a Word document ({e}) - "
                      "re-download it and add it again.")
        continue
```
No other logic changed - `candidates`/routing/`sanral_files` behavior is identical for every
already-working case; only the previously-silent failure path now leaves a trace.

**Verification:** re-ran the exact adversarial reproduction above after the fix - `notes` now
reads `["C.1.1.1 Form of Offer.docx: could not be opened as a Word document (Package not found at
'...') - re-download it and add it again."]`, `sanral_files` still correctly empty. Added
`engine/intake/test_classify_tender.py` (new file - no dedicated test for `classify_tender.py`
existed before this; `test_manual_intake.py` needs Postgres so isn't in CI and only covers the
happy path end to end): 3 cases - the corrupt-`.docx` case above (note is logged, not registered
as found), a real, valid C.1.1.1 Form of Offer built with `python-docx` (classifies correctly,
*no* spurious note - proving the fix doesn't cry wolf on the working path), and a doc_entry with
no `_local` path at all (skipped cleanly, no note). All 3 pass. Ran the existing
`engine/discovery/test_opportunity_requirements.py` suite for regression safety (it calls this
exact same `classify_documents()` through `opportunity_requirements.py`) - all 17 checks still
pass, confirming the added note doesn't disturb any existing routing/missing-document behavior.
`python3 -m py_compile classify_tender.py` clean.

**Also checked, deliberately NOT changed:** the "missing documents" message text itself
(`"Not found among the uploaded documents... Add them with 'Add documents'"`) is left as-is for
the *genuinely* missing case - only the unreadable-but-present case now gets an additional, honest
note alongside it. Rewriting that message to distinguish "never uploaded" from "uploaded but
unreadable" inline would be a reasonable follow-up but is a larger, separate change than this
finding's scope; the note added here already gives the real reason, it just doesn't replace the
generic message.

## 2026-10-20 (thirty-seventh run): Finding 32 independently re-verified, no new findings

One new commit since the thirty-sixth run: `49d1305` (Finding 32, above), from a different
concurrent sibling session. Re-verified rather than trust its own write-up: read
`classify_documents()` directly and confirmed the `.xlsm` branch's unreadable-note pattern the fix
claims to mirror is real and identical in shape (`info["kind"] == "unreadable" ->
notes.append(...)`, same loop). Re-ran `test_classify_tender.py` myself - 3/3 pass. Re-ran
`test_opportunity_requirements.py` (the real regression suite - calls the same
`classify_documents()` through a different caller, `opportunity_requirements.py`) - all 17 checks
still pass. Grepped for any other code that might assume `notes` is always empty and could break
now that a genuinely corrupt document can add one - found none. `python3 -m py_compile` clean.
Green on real CI (`39366639756`). No new findings - the fix is correct and complete as committed.

## 2026-10-20 (thirty-eighth run): the raw-error-leak sweep is genuinely finished; a separate write-without-read gap closed cleanly - no new findings

Two new commits since the thirty-seventh run: `d081793` (closes out the raw-error-leak fix on the
5 remaining admin pages + 2 upload forms) and `fd73a51` (6 onboarding-scan fields, migration
`0069`, were write-only on the Company vault page - now read back and shown).

`d081793`'s own commit message claims a repo-wide grep shows zero remaining `error.message`
leaks - verified this myself rather than take the claim at face value. A fresh grep turns up 5
matches outside `console.error(...)` calls: 2 are `tasksError`/`provenanceError` in
`tenders/[id]/page.tsx`, intermediate `{message}` objects already displayed as generic text where
they're actually rendered (traced both consumers to confirm); 3 are the login/signup/forgot-
password pages' Supabase Auth SDK error messages, a different and legitimate class ("Invalid login
credentials" etc., never a raw Postgres/schema error) that was never in scope for this work.
Confirmed: zero real leaks remain.

`fd73a51`: cross-checked all 6 column names it reads back
(`cidb_registration_number`/`cidb_contractor_name`/`bee_entity_name`/`bank_confirmation_bank_name`/
`bank_confirmation_account_holder`/`iso_9001_certified_entity_name`) against migration `0069`'s
own `add column` statements - exact match. Checked the `[...].filter(Boolean).join(" · ")` display
pattern doesn't leave a stray empty bullet when neither optional field is set - correct, since an
empty join result is still falsy and gets dropped by the outer filter too.

No new findings. `npm run typecheck`/`lint` clean, full `npm run build` - exit 0. Both commits
green on real CI (`39370320075`, `39377554678`).

## 2026-10-20 (thirty-ninth run): Compliance/reminders - a document inside the normal renewal window got a second, misleadingly-framed reminder

**Why this area:** `engine/compliance/` (`watch_deadlines.py`/`registration_reminders.py`) hadn't
had a dedicated pass since the sixth run - over 30 runs ago, the most-neglected engine area left.
This is the reminder engine Sarel actually relies on to know what's about to lapse, so a noisy or
misleading reminder has a real cost even when the underlying data is correct.

### Finding 33 (CONFIRMED, FIXED, moderate - duplicate/misleading reminders, not wrong data)

**Where:** `engine/compliance/watch_deadlines.py`, `find_documents_lapsing_before_closing()`.

**What was tested:** the function's own docstring states its reason for existing: "A document
that is fine today - OUTSIDE the 60-day window - but will have lapsed by the closing date of a
tender" - i.e. it exists to catch the case the normal `find_due_documents()` 60-day window
*can't* see. Read the implementation looking for where that "outside the window" condition is
actually enforced - it wasn't: the loop only excludes a document that is already expired
(`exp_day < today`) or valid through the closing date itself (`exp_day >= closing_day`); nothing
excludes a document that is ALSO already inside the ordinary `--doc-lead-days` window. Built a
real adversarial case: a company with `coid_letter_of_good_standing_expiry` 30 days out (squarely
inside the default 60-day window, so `find_due_documents()` already reports it as "renew soon")
and an open, pursued tender closing in 100 days (so `exp_day < closing_day` too) - ran both
functions against this fixture with no network, no Supabase (same in-memory `supabase_request`
fake as the existing `test_watch_deadlines_urgency.py`).

**Confirmed the bug:** the COID shows up TWICE - once from `find_due_documents()` as
`{"status": "renew_soon"}`, and again from `find_documents_lapsing_before_closing()` as
`{"status": "lapses_before_closing", "tender_label": "RT83-2026"}` - framed as if the tender were
the reason it needs attention, when the tender has nothing to do with it; the document would need
renewing on exactly the same schedule whether or not that tender existed. Two different-looking
reminders for one fact, which risks reading as two separate problems to chase down, or - worse -
training a reader to tune out "lapses before closing" reminders as noise, right when a GENUINE
one (a document only lapsing because of a specific tender's closing date, which `find_due_documents()`
would never catch on its own) needs to stand out.

**Fix:** added the missing guard the docstring already promised - skip a document whose `left`
(days until expiry) is already `<=` its own effective lead time (the per-field override, e.g. the
bank letter's 30 days, or the general `lead_days`/`--doc-lead-days` otherwise) - mirroring exactly
the window `find_due_documents()` itself uses for that same field, so "already reported through
the normal channel" means the same thing in both places. Threaded `lead_days` through as a new
parameter (default `DEFAULT_DOC_LEAD_DAYS` for backward compatibility) and updated `main()` to
pass `args.doc_lead_days` explicitly - the previous call site passed no lead-days argument at all,
so a `--doc-lead-days` override on the CLI was silently ignored by this one function while
correctly honoured everywhere else.

**Verification:** re-ran the adversarial fixture post-fix - COID no longer appears in
`before_closing` at all, while the genuine case (SARS TCS PIN at 90 days - outside the 60-day
window, but inside tender RT83-2026's 100-day closing) still correctly fires, proving the fix
isn't one-sided. Extended `test_watch_deadlines_urgency.py` (the existing scenario-7 test file
already carries a COID-inside-the-window + tender-closing-after-it fixture, perfectly shaped to
exercise this) with a new check #6. **Proved the new check actually catches the regression**, not
just that it passes: temporarily removed the new guard line, re-ran - the new check failed exactly
as predicted (`FAIL COID ... is NOT duplicated...`); restored the fix and confirmed clean again.
Ran the full existing `engine/compliance/test_*.py` suite (5 files, all in-memory, no network) -
every one still passes, including the bank-letter case (30-day override, left=45 days, correctly
still caught as a genuine "lapses before closing" item since 45 > its own 30-day window - confirms
the per-field `lead_override` path, not just the default 60-day one, is exercised and correct).
`python3 -m py_compile` clean on both changed files.

## 2026-10-20 (fortieth run): Finding 33 independently re-verified, no new findings

One new commit since the thirty-ninth run: `3255b00` (Finding 33, above), from a different
concurrent sibling session. Re-verified rather than trust its own write-up, including its own
"proved the regression test catches the bug" claim.

Confirmed `TRACKED_EXPIRY_FIELDS`'s third tuple element is really the per-field lead-time
override and that the new guard's `lead_override if lead_override is not None else lead_days`
expression is identical to the one `find_due_documents()` already uses - not an approximation of
it. Traced `_expiry_window()`'s own boundary (`left > lead_days` -> no hit) to confirm the new
guard's `<=` lines up exactly, no off-by-one. Ran `test_watch_deadlines_urgency.py` - clean. Then
independently reproduced the commit's own regression-proof: removed the new guard line from a
working copy of `watch_deadlines.py`, re-ran the test, watched the exact new check fail, restored
the file (`git diff` confirmed zero remaining changes), re-ran clean. Ran all 5
`engine/compliance/test_*.py` files - all pass. `python3 -m py_compile` clean.

No new findings. Green on real CI (`39382894500`).

## 2026-10-20 (forty-first run): Notify - a broken listing-changes tracker degraded silently instead of raising a system alert

**Why this area:** `engine/notify/` (`daily_digest.py`) hadn't had a dedicated pass since the
nineteenth run - the next-most-neglected area after compliance/reminders was just covered.

### Finding 34 (CONFIRMED, FIXED, minor-but-real - a missing alert, not wrong data)

**Where:** `engine/notify/daily_digest.py`, `main()`'s listing-changes block.

**What was tested:** `main()` has three structurally identical try/except blocks, each guarding
one "track something extra; a failure must not cost anyone the rest of their digest" step:
tender updates (`watch_tender_updates.pending_digest_updates`), re-assessed tenders
(`discovery_downgrades.pending_digest_downgrades`), and listing changes
(`tender_changes.run` + `store.recent_changes`). Read all three side by side rather than trust
they're consistent just because they look alike: the first two call `system_alerts.record(...)`
on failure (matching this script's own established "a database error here fails loudly" rule
stated elsewhere in this same file); the third - listing changes - only printed a `WARNING` to
stdout. A scheduled, unattended run's stdout isn't read by anyone; `system_alerts` is the actual
mechanism Sarel relies on to learn something broke. Confirmed with a real adversarial case: using
the existing `test_digest_live.py` harness (in-memory Supabase fake, two real sample tenders),
forced `tender_changes.run()` to raise, and captured every `system_alerts.record` call made during
the run - zero calls were made for the listing-changes failure, while the exact same simulated
failure on the tender-updates path (checked separately, pre-existing behaviour) does call it.

**Fix:** added the matching `system_alerts.record("digest", ..., "error", exc=e)` call to the
listing-changes except block - the identical pattern already used two blocks above it in the same
function. No other logic touched; the digest still goes out without listing changes on this kind
of failure, exactly as the comment above the block already promises - it's just no longer silent
to Sarel.

**Verification:** extended `engine/notify/test_digest_live.py` with a new check - monkeypatches
`daily_digest.fetch_releases` to return a non-None `gov_res` (so the listing-changes tracker
actually runs) and `tender_changes.run` to raise, then asserts `system_alerts.record` was called
with "digest"/"listing changes" in the message. **Proved the test actually catches the
regression**, not just that it passes: temporarily reverted the fix, re-ran - the new check failed
exactly as predicted (`FAIL ... ([])` - zero alert calls recorded); restored the fix and confirmed
clean again. Ran the full `engine/notify/test_digest_live.py` and all 5
`engine/compliance/test_*.py` files (no network, in-memory fakes throughout) - all pass.
`python3 -m py_compile` clean on both changed files.

## 2026-10-20 (forty-second run): two sibling commits independently re-verified, no new findings

Two new commits since the forty-first run: `b56189b` (Discovery touch-target fix) and `99a8e67`
(Finding 34, above), from two different concurrent sibling sessions.

`b56189b`: checked the commit's claimed "44px primary / 32-40px secondary floor" convention is
real and pre-existing (grepped `SiteNav.tsx` and this log's own history for the same rule) rather
than take it as a plausible-sounding justification. It is - a one-line, correctly-scoped CSS fix.

`99a8e67`: read all three of `main()`'s "optional extra signal" try/except blocks side by side to
confirm the two that already call `system_alerts.record(...)` really do, and the third really
didn't. Ran `test_digest_live.py` myself - clean. Then independently reproduced the commit's own
regression-proof: removed the new alert call from a working copy of `daily_digest.py`, re-ran, the
new check failed with zero alerts recorded exactly as predicted, restored the file (`git diff`
confirmed clean), re-ran green. Ran all 5 `engine/compliance/test_*.py` files too - all pass.

No new findings. `npm run typecheck`/`lint` clean. Both commits green on real CI (`39394434821`,
`39403672742`).

## 2026-10-20 (forty-third run): Worker/job-queue - a legitimate filename with two consecutive dots was rejected as if it were a path-traversal attempt

**Why this area:** `engine/worker/` (`poll_loop.py`, `run_bridges.py`) hadn't had a dedicated pass
since the twenty-first run - the longest-neglected rotation area remaining. Read `poll_loop.py`
and `run_bridges.py` in full first (both already heavily hardened and tested - `test_poll_loop.py`
covers signal handling, atomic claims, the `--script`-is-additive fix, a bridge exiting non-zero,
a bridge timing out). Found nothing new there; widened the pass to the bridge SCRIPTS themselves
(the actual queue-processing logic `run_bridges.py` drives), since "worker/job-queue" naturally
includes whether each bridge correctly implements the claim/process contract - and
`engine/onboarding/process_onboarding_jobs.py` (the newest of the five registered bridges, 0063)
had ZERO dedicated test coverage of its own queue logic.

### Finding 35 (CONFIRMED, FIXED, moderate - a false-positive security gate rejecting good input)

**Where:** `engine/onboarding/process_onboarding_jobs.py`, `process_upload()`.

**What was tested:** `process_upload()` has a defence-in-depth guard checking that a claimed
row's `storage_path` really sits under that upload's own company folder (protects against a
corrupted/forged row pointing at another tenant's files): `if not sp.startswith(f"{company_id}/")
or ".." in sp or "//" in sp: raise ClassificationFailed(...)`. Traced where `storage_path` is
actually built client-side (`app/app/company/document-scan/upload-form.tsx`'s `uploadAll()`:
`${uploadPrefix(companyId)}${uuid8}-${safeFileName(f.name)}`) and read `safeFileName()`
(`app/lib/onboardingScan.ts`): `name.replace(/[^a-zA-Z0-9._ ()-]/g, "_")` - periods are in the
ALLOWED set, passed through unchanged. So any original filename with two consecutive dots
anywhere (a common, entirely ordinary shape - a version marker, an export tool's naming, a simple
typo like "Report..pdf") produces a `storage_path` containing the substring `".."`, which the
backend guard's blind `".." in sp` check treats identically to a real path-traversal attempt.
Reproduced directly: `storage_path = "co-1/a1b2c3d4-Report..final.pdf"` (correctly under the
upload's own company folder) still got rejected with "This upload's file isn't in your company's
own storage folder, so it wasn't read. Upload it again." - a confusing, actively wrong message,
since the file WAS in the right folder; the only real "problem" is two dots in its name. The user
would hit the identical rejection on every re-upload of the same file, with the message pointing
them nowhere near the real cause.

**Fix:** changed the check from a substring match to a path-SEGMENT match - `".." in sp.split("/")`
- so only a genuine `..` segment (the actual traversal shape, e.g. `"co1/../co2/x.pdf"`) is
rejected; `".."` occurring inside a longer filename component no longer matches. The `//` check
and the company-prefix check are untouched (no demonstrated false-positive risk from either -
consistent with this review's own standing rule to fix only what's actually reproduced, not
every theoretical tightening available).

**Verification:** ran the real `process_upload()` end to end (not a standalone reimplementation
of the check) against 4 cases via a new dedicated test file, `engine/onboarding/
test_process_onboarding_jobs.py` (the module had no test file at all before this): a legitimate
double-dot filename (now correctly accepted - reaches past the guard), a genuine `..`-segment
traversal attempt (still rejected), a path under a different company's prefix entirely (still
rejected), and a double slash (still rejected) - 6 checks, all pass. **Proved the new test
actually catches the regression**, not just that it passes: temporarily reverted the fix back to
the bare substring check, re-ran - the double-dot-filename checks failed exactly as predicted
(the real rejection message came back); restored the fix and confirmed clean again. Ran the
existing `engine/onboarding/test_classify_documents.py` and `engine/worker/test_poll_loop.py`
suites for regression safety (neither touches this guard, both still pass unchanged).
`python3 -m py_compile` clean on both changed files.

## 2026-10-20 (forty-fourth run): full enterprise-readiness audit, round 1 (find) and round 2 (fix)

Sarel's own direct request, in full: "make sure it is designed and build to catch all and execute
for all scenarios. Run multiple scenarios, consider all scenarios for each process and each engine
and each field... before I upload and onboard one of my companies." A deliberately larger effort
than a routine pass, run in two rounds.

**Round 1** dispatched 8 parallel adversarial-audit agents, each given one engine or the app layer,
explicitly instructed to construct real malformed/edge-case/concurrent scenarios and run them
against the actual code rather than reason from a read-through, and to distinguish CONFIRMED
(reproduced) from PLAUSIBLE (reasoned only) findings. Result: ~31 distinct findings across
discovery, intake/classification, SANRAL pack engine, general pack engine, CV engine,
compliance/notify, RLS/security, and the app layer - the large majority independently reproduced,
not just asserted. I independently re-verified the most severe claim from each of the 8 before
accepting any of them (direct examples: reproduced the `tender_changes.py` key collision myself;
confirmed the SANRAL `.docx` period-heading regex gap with a direct regex test; confirmed
`process_general_jobs.py` genuinely has zero stale-job-recovery code via grep, contrasted against
the CV queue's real implementation; caught one fork's own false positive - it concluded session-
refresh middleware was missing because it searched for `middleware.ts` by name, not knowing this
project runs Next.js 16, which renamed it to `proxy.ts` - confirmed `app/proxy.ts` is a complete,
correct implementation by reading it directly).

**RLS/security audited separately and came back genuinely clean**: built a real replayed Postgres
via `engine/security/replay_schema.sh`, ran actual adversarial queries as `anon`/`authenticated`
(switching `auth.uid()` between two real seeded users)/`service_role`, tried path-traversal variants
against every storage bucket added since the confirmed-live `0062` migration cutoff, and checked all
37 `SECURITY DEFINER` functions against the live `pg_proc` catalog directly - zero confirmed
cross-tenant leaks. The fork caught its own first-pass false positive along the way (`is_company_member()`
looked unpinned by text search alone, but is correctly patched via a separate `ALTER FUNCTION` in a
later migration - confirmed via the live catalog, not just the original `CREATE FUNCTION` text).

**Round 2** fixed the 9 most severe confirmed findings - 5 via parallel fix-forks (each scoped to
non-overlapping files, instructed to reproduce-fix-reproduce and prove any new test actually catches
the regression), 3 taken on directly given their complexity/stakes:

- **SANRAL pack engine, the highest-stakes fix of the round**: `print_reports.py`/`print_financial.py`
  had zero wall-clock timeout around any UNO call. Confirmed live by killing a real
  `admin_harness.py --pack` run and finding a genuinely orphaned `soffice.bin` at 97% CPU, untouched
  by the parent's termination - the outer 30-minute bridge watchdog can't help here, since
  `Office.__enter__` deliberately decouples soffice into its own process group (to stop one job's
  kill taking out a concurrent job's), which also means an external kill of the parent never reaches
  the orphan. Fixed with the same wall-clock-deadline pattern already proven in
  `assess_tender.fetch_pdf_text` (daemon thread + hard deadline), with a direct force-kill of the
  whole LibreOffice process on timeout (the polite `desk.terminate()` path would also hang on the
  same wedged connection). Verified the timeout mechanics directly with fake blocking/raising/fast
  functions (hung op times out at the real deadline and force-kills exactly once; fast op returns
  immediately with zero force-kills; a genuine non-timeout exception still propagates normally), then
  smoke-tested both real export paths against real sample workbooks (unchanged, correct output, no
  orphan left behind), then ran the FULL real `admin_harness.py --pack` end to end (all 7 test
  companies) - `7 clean, 0 flagged for review, 0 run failures`. Also fixed in the same engine: an
  unrecognized key-position title in C.1.2.3 was silently skipped identically to a genuinely-optional
  "Alternate to ..." row, with zero provenance trace - would hit a brand-new company's first tender
  with no warning at all. Verified with a synthetic 3-case template (recognized-unassigned,
  genuinely-optional, unrecognized) and confirmed the bug reproduces when reverted. New
  `engine/test_fill_docx_forms.py` (first dedicated test for this module).
- **Discovery**: `tender_changes.py`'s dedupe key collapsed to `"<source>:None"` for a release
  missing both ocid and contract_number (confirmed reachable from 3 real source readers) - silent
  overwrite of one release's change-tracking by an unrelated one, and possible fabricated "title
  changed" events. Fixed to skip, matching the sibling modules' own convention. Also fixed:
  government source failures invisible to `system_alerts`; a 429 treated as permanent with zero
  retry; no size cap on document downloads. Bonus: `assess_tender.fetch_pdf_text`'s error
  classification was missing `ValueError` (the identical relative-URL crash already fixed elsewhere,
  never applied here).
- **Intake**: SANRAL `.docx` heading regexes rejected a period after the form letter -
  `"C.1.1.1 FORM OF OFFER"` never recognized, zero trace; the project's own test fixture had this
  exact mismatch baked in unnoticed. Also fixed: duplicate-candidate tie-break now prefers the
  most-recently-modified file over alphabetically-first.
- **General pack engine**: `process_general_jobs.py` had zero stale-job recovery - the third job
  queue on the shared `pack_generation_jobs` table, after the other two already had it. Added
  `fail_stale_jobs()` mirroring the proven pattern exactly, scoped so it never touches a sibling
  queue's rows. Also fixed: a stray cross-suite form-code reference still listed as "required"; one
  control character discarding an entire form's worth of otherwise-good fields.
- **CV engine**: path traversal (CWE-22) via `person['name']` in an output filename - reproduced
  directly, confirmed the resolved path escaped `out_dir`. Also fixed: a raw Python exception shown
  verbatim to the customer on a CV failure (same bug class as the earlier app-side error-leak sweep,
  found here on the engine side); `projects`/`qualifications: null` crashing generation; a stray
  control character (a realistic OCR artifact) permanently failing a CV job.
- **Compliance/Notify**: `watch_deadlines.py`/`daily_digest.py` computed "today" via naive
  `date.today()` (worker container has no `TZ`, defaults UTC) instead of SAST - a guaranteed ~2-hour
  daily window where every due-date/digest decision was one calendar day off; the correct pattern
  already existed elsewhere in this codebase. Also fixed: no per-item isolation in the digest
  build/send loops - one malformed entry crashed the whole batch.

**Deliberately deferred, named explicitly rather than silently dropped:** `confirm_pack.py`'s
project-field-completeness-vs-project-type gap (needs a dedicated follow-up into `sanral_fill.py`);
`suggest_pack.py:77`'s identical `qualifications: null` crash (found by the CV-engine fix fork,
correctly left out of its assigned scope); `watch_new_tenders.py`'s own naive `date.today()`
instance (same bug class as the compliance/notify fix, found by the discovery fix fork, correctly
left out of its assigned 3 findings); dead, confirmed-buggy legacy code in `fill_sbd_docx.py`
(`fill_sbd1`/`fill_sbd4`/`fill_sbd6_1`, zero live callers); and several lower-severity round-1 items
(duplicated filename-sanitization regexes across ~8 app files, no Resend 429 backoff, a general-pack
regression-corpus coverage gap, 2 functions missing `pg_temp` in search_path, a test-infra
role-reuse fragility in `scratch_supabase_stub.sql`, client-side-only upload type validation, no
app-wide rate limiting, no custom `error.tsx`/`not-found.tsx`).

**Commits:** `8aad3bb`, `4141a75`, `80afc14`, `cdff2ae`, `9bc3474`, `d396979`.

---

## 2026-10-20 (round 3 of the enterprise-readiness audit): every item deferred from round 2 closed, plus a real CI regression caught the same pass

**Why this round:** Sarel's own explicit follow-up after round 2 - "continue the next audit round on the deferred items." Round 2 had named 6 items as deliberately deferred plus one open investigation; all are closed below, each independently verified (reproduced before/after, regression-proof reverted-and-confirmed where feasible) rather than trusted on a fork's own report.

**Closed:**
- **`watch_new_tenders.py`'s own naive `date.today()` instance** - the same timezone bug class fixed in `watch_deadlines.py`/`daily_digest.py` in round 2. Reused the existing `source_http.SAST` constant (`import source_http as sh`) rather than a third definition, at both call sites (a fan-out scorer fallback and `main()`'s date-range computation).
- **`suggest_pack.py:77`'s identical `qualifications: null` crash** the CV-engine fix (`8aad3bb`) had already closed in `generate_cv.py` - the shared root cause (`.get("qualifications", {})` only substitutes the default on a *missing* key, not an explicit `None` value). Fixed at all 3 call sites (`years_experience_at`, `candidate_person_text`, `score_candidate`), plus a raw `person['qualifications']['initial_graduated']` subscript replaced with the already-computed safe local.
- **`confirm_pack.py`'s project-type-fit gap - investigated personally rather than rushed into a fix.** Round 1 framed this as "checks field completeness, not project-type fit for the assigned position." Direct investigation found the downstream handling (`sanral_fill.projects_for_block()`) already filters project-type fit correctly and transparently: every excluded project gets an explicit note naming which type the position's own Book 1 matrix doesn't offer, and a project with no type recorded is deliberately *kept*, not dropped (`set_dropdown_for()`'s own "not recorded" path). The real, narrower gap: the confirming human only sees this at final pack-build time, not at confirmation time - a legitimate UX enhancement, not a correctness bug, deferred to its own dedicated pass since fixing it properly needs the Book 1 position-matrix lookup shared between `confirm_pack.py` (JSON-only, no workbook access yet) and `sanral_fill.py` (workbook-dependent) without introducing drift risk between the two. Fixed in passing: `confirm_pack.py`'s own naive `date.today()` (same bug class, lower stakes - only the pack's own provenance "generated on" timestamp).
- **2 of 37 `SECURITY DEFINER` functions missing `pg_temp` in `search_path`** (`discipline_category_suggestions_guard` from `0054`, `acknowledge_discovery_downgrade` from `0055`) - not a live exploit, an inconsistency with the other 35. Both source migrations predate the confirmed-live `0062` cutoff, so fixed via a new migration (`0074`), never an edit to `0054`/`0055` in place. Verified by replaying all 65 migrations on a fresh scratch Postgres, querying `pg_proc.proconfig` directly to confirm both functions now pin `search_path = public, pg_temp`, and re-running `test_tenant_isolation.py` - ALL PASSED.
- **`scratch_supabase_stub.sql`'s role-reuse fragility** - its role creation used `IF NOT EXISTS` guards on cluster-global roles, so re-running it against a second database in the same cluster could silently skip `BYPASSRLS` if the role already existed from a prior run, producing a false-safe test result on local/CI reuse (test-infra only, not exploitable in the real CI job or Supabase project). Fixed to set role properties unconditionally every time. Reproduced the stub bug directly (stale `service_role` state surviving a second stub application) and confirmed the fix restores it correctly.
- **Duplicated filename sanitization** - a canonical `safeFileName()` already existed, duplicated byte-for-byte in `app/lib/onboardingScan.ts` and `app/lib/manualTender.ts`, while 8 other action files hand-rolled a narrower inline version. Not exploitable today (both forms already strip `/`), but one future edit to any inline copy being slightly less careful would reopen path traversal with no shared place to fix it. Consolidated into `app/lib/safeFileName.ts`; the two existing files now re-export it (their own importers needed no changes); all 8 inline regexes replaced with the shared helper.
- **Dead, confirmed-buggy legacy code** - `fill_sbd1`/`fill_sbd4`/`fill_sbd6_1` in `fill_sbd_docx.py` had a known "first-match-only" cross-contamination bug (per their own code comments) and zero external callers anywhere in the repo, confirmed again before deleting. Removed the three functions, their only helpers (`find_label_row`, `fill_table_label`, `fill_dotted_paragraph`, `mark_declaration_no`), the `FORM_FILLERS` registry, `require_docx`, and the dead `__main__` CLI block that only existed to invoke them (284 lines total). The real pipeline (`fill_sbd_document`/`fill_sbd_file`/`fill_dotted_paragraph_count`/`DOTS_RE`) untouched. Verified: zero dangling references anywhere in the repo; `general_harness.py --no-pack` unchanged (`77 clean, 0 flagged, 0 failed`).
- **No Resend 429 backoff** - `send_digest_emails.py`'s Resend send treated a transient rate limit as a permanent failure. Mirrors `source_http.py`'s own established 429-retry pattern exactly: respects `Retry-After` (capped at 30s, falls back to a fixed 2.0s wait if unparseable/absent), one bounded retry per recipient, never an unbounded loop. Verified against real local HTTP servers: a 429-then-success succeeds after exactly one retry respecting `Retry-After`; a genuine permanent error fails immediately with no wasted attempt; two consecutive 429s give up after exactly 2 calls total.
- **No CV-request rate limiting** - `requestTenderCv()` had no protection against repeated submission, letting one user queue unlimited CV-generation jobs on a worker pool shared across every company. Fixed with an app-level check for an already-pending request before insert, redirecting with a clear message if one exists, plus a new migration (`0075`, a partial unique index on `generated_cvs (person_id, tender_pack_id, position_code, format, detail)` scoped to `status in ('requested','generating')`) as the real database-level backstop against the check-then-insert race window; the insert's error handler now specifically catches Postgres `23505` and degrades to the same graceful message. Verified: migration replays cleanly, the index's column list and partial predicate independently queried and confirmed to match the design.
- **No `error.tsx`/`not-found.tsx`** - this app had no root error boundary or 404 page anywhere; an unhandled error or bad URL fell through to Next.js's own generic fallback UI instead of this app's own on-brand handling. Added both, on-brand styled, `error.tsx` using the `retry()` prop (confirmed stable since Next.js 16.3.0 by reading the project's own vendored docs directly, not assumed from training data).

**A real CI regression introduced mid-round, caught and fixed the same pass - not carried forward silently:** the filename-sanitization consolidation commit broke `app-ci` on `main`. Confirmed via the actual GitHub Actions job log (run `39447233530`, not assumed): typecheck, lint, and the production build all passed; only the test step failed, with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../lib/safeFileName' imported from .../lib/onboardingScan.ts`. Root cause: `onboardingScan.test.ts` is run directly as a Node ESM entry point by CI (`node --experimental-strip-types`, not through Next's bundler, which resolves extensionless imports fine) - its own import of `onboardingScan.ts` already uses an explicit `.ts` extension (the established convention for this reason), but `onboardingScan.ts`'s own `export { safeFileName } from "./safeFileName"` had no extension, and Node's native ESM loader does not infer one. `manualTender.ts` has the identical re-export with no test file today, so it wasn't caught there, but would break the same way the moment one exists. Fixed by adding the `.ts` extension to both re-exports, plus `allowImportingTsExtensions` in `tsconfig.json` (compatible with the project's existing `noEmit: true`, which is the documented precondition for that flag). Verified: reverted the extension and reproduced the exact `ERR_MODULE_NOT_FOUND` locally; restored it and confirmed the fix; then ran every `*.test.ts` file the exact way `app-ci.yml` actually does it (not via `node --test`'s own glob, which this repo's CI deliberately avoids - it silently finds 0 tests for any path containing a `[id]` bracketed directory, a known issue documented in the workflow file itself) - all 10 test files, 118 tests, 0 failures. Confirmed the real GitHub Actions run for the fix commit went green.

**Still deliberately deferred, unchanged from round 2:** a general-pack regression-corpus coverage gap (no Transnet/Cape Town samples - needs real document acquisition, not a code fix); client-side-only file upload type validation; no app-wide rate limiting beyond the CV-request fix above.

**Commits:** `a68b342`, `abcd91f`, `25e8a20`, `af1e25b`, `a36ef61`, `095a89a` (the CI hotfix).

## 2026-10-20 (forty-sixth run): the enterprise-readiness audit's round 3 independently re-verified - no issues found

**Context:** picked up this cycle expecting to continue the engine rotation, but a parallel
"enterprise-readiness audit" session had just landed 14 commits (`8aad3bb` through `c3a6185`)
covering every single engine area in one sweep (CV, discovery, intake, compliance, notify,
general pack, SANRAL pack, worker-adjacent dead-code removal, RLS/search_path hardening, a
shared filename-sanitization consolidation, and a real CI regression it introduced and then
caught and fixed within the same round). Rather than duplicate that effort by hunting for new
findings across the same ground, spent this cycle independently re-verifying the two items
closest to this review's own recent work (compliance/notify's timezone fix directly touches
`watch_deadlines.py`'s `main()`, which Finding 33 also touched - needed to confirm no collision)
rather than trusting the commits' own verification claims.

**Checked independently, not just read:**
- **Timezone bug (`cdff2ae`):** the claim is that `watch_deadlines.py`/`daily_digest.py` computed
  "today" via naive `datetime.date.today()` in a UTC-default worker container, one calendar day
  behind real SAST for the 00:00-01:59 SAST window every day. Reproduced the exact mismatch by
  hand (simulated UTC 2026-10-20 23:30 -> naive "today" = Oct 20, real SAST "today" = Oct 21,
  confirmed mismatched) rather than taking the commit's word for it. The new `SAST` constant and
  its three call sites in `watch_deadlines.py`/`daily_digest.py` only touch where "today" comes
  from - confirmed by diff that Finding 33's own `find_documents_lapsing_before_closing()` guard
  (the `lead_days` parameter and its per-field comparison) is untouched and still correct.
- **Per-item batch isolation (`cdff2ae`):** the per-roster-entry `try/except` added around
  `daily_digest.py`'s digest-building loop is the same "one bad item must not abort the batch"
  pattern this review has applied repeatedly all session (Findings 2, 8, 21, 26, 32) - sound,
  consistent, and does not touch or duplicate Finding 34's separate listing-changes alert fix a
  few lines below it in the same function.
- **CI state:** confirmed via the real GitHub Actions API (not assumed) that app-ci's run for
  `a36ef61` (the CV-rate-limiting commit) shows `"conclusion":"failure"` - but traced this to the
  STILL-OPEN `25e8a20` regression at that point in history, fixed two commits later by `095a89a`
  (run 32, `"conclusion":"success"`). Current `main` (`c3a6185`, docs-only) sits on top of the
  fixed commit, so the repo is genuinely green, not just claimed green.
- **No regressions:** ran all 5 `engine/compliance/test_*.py` files, `engine/notify/
  test_digest_live.py`, `test_digest_opt_in.py`, `engine/intake/test_classify_tender.py`,
  `engine/general/test_process_general_jobs.py`, and `engine/test_fill_docx_forms.py` - every
  one passes on the merged state (the one pre-existing, already-documented failure,
  `test_manual_intake.py`, needs Postgres and isn't in CI - unrelated to this round).

No new findings - everything checked held up under independent reproduction, not just trust in
the commits' own stated verification.

## 2026-10-20 (forty-ninth run): Discovery - a multi-lot award's later lots' bidders were silently dropped by the portal reader's own dedupe step

**Why this area:** of the rotation's eight areas, discovery hadn't had a genuinely NEW adversarial
pass from me in this visible window - the enterprise-readiness audit's own discovery findings
(`tender_changes.py` key collision, source-failure alerting, 429 retry, download size cap) were
independently re-verified last cycle, but that's re-checking someone else's work, not a fresh
pass of my own. `engine/discovery/key_person_minimums.py` (a complex layout-table parser) was
read in full first and found to already have solid, real-fixture test coverage (two real tender
families, an `alternatives` multi-qualification case, four `not_found` cases) - no new finding
there. Moved to `etenders_portal.py` (239 lines, zero dedicated test file, not named in the
audit's discovery summary).

### Finding 36 (CONFIRMED, FIXED, moderate - feeds real award/price intelligence with silently incomplete data)

**Where:** `engine/discovery/etenders_portal.py`, `dedupe_rows()`.

**What was tested:** the function's own docstring states exactly which inputs it exists to
handle: "The portal returns one row per joined child record: a tender cancelled twice ... **or
with several awards** comes back as several rows with the same id." The implementation only ever
merged the `cancelled` field across duplicate rows (into `_cancellations`) - `bidders` (a
multi-lot award's per-lot winner name and amount) was left untouched, meaning whichever duplicate
row happened to be the first one `dict()`'d into the output "won," and every other row's bidders
were silently dropped on the floor. Built a synthetic 2-lot fixture reproducing exactly the shape
the docstring itself describes - two rows sharing `id: 999`, one with Lot 1's winning bidder
(R100,000), one with Lot 2's (R250,000) - and ran the real `dedupe_rows()` + `normalize()` on it.

**Confirmed the bug:** only Lot 1's bidder survived into the deduped row and the normalized
release; Lot 2's R250,000 winner vanished with no trace, no alert, nothing. This isn't cosmetic -
`store_award_outcomes.py` consumes this exact `bidders` field as real award/price intelligence
data (`bidders_source: "etenders_bidders"`), and `tender_changes.py`'s `portal_bidders()` emits a
"bidders list published" change event keyed by the bidder *count* (`key_extra=f"bidders:{len(b)}"`)
- a truncated list here means wrong stored award data and a wrong/missing change notification,
not just an incomplete detail.

**Fix:** merged `bidders` across duplicate rows the same way `_cancellations` already is - collect
every row's `bidders` entries into a list during the same pass, deduping identical entries (in
case the same lot's bidder is repeated unchanged across rows), and replace the stale single-row
`bidders` field with the merged list at the end. No other logic touched.

**Verification:** re-ran the 2-lot fixture post-fix - both lots' bidders now survive into the
deduped row AND through `normalize()` into the release. Added `engine/discovery/
test_etenders_portal.py` (first dedicated test file for this module): 4 cases, 7 checks - the
2-lot fix itself, an ordinary single-row tender (unaffected), the module's own worked cancellation
example (still merges correctly, and a cancellation-only row gets an empty, not missing, bidders
list), and the same bidder entry repeated unchanged across duplicate rows (kept once, not
doubled). **Proved the new test actually catches the regression**, not just that it passes:
temporarily reverted `dedupe_rows()` to the pre-fix version, re-ran - the 2-lot checks failed
exactly as predicted (`FAIL ... ([{'biddersName': 'Lot1 Winner CC', ...}])` - Lot 2 missing);
restored the fix and confirmed clean again. Ran `test_gov_sources.py` and `test_tender_changes.py`
(both exercise this module's real callers) for regression safety - both still pass unchanged.
`python3 -m py_compile` clean on both changed files.

## 2026-10-20 (fifty-first run): SANRAL pack / general pack engines - the same naive-UTC "today" bug the enterprise audit fixed elsewhere was still open in two legal-document date checks

**Why this area:** picked SANRAL pack engine (the remaining area I hadn't personally given a
fresh adversarial pass this session - the enterprise audit covered it, but that's someone else's
work, not a new pass of my own). Read `key_person_minimums.py` last cycle (solid, no finding);
this cycle read `engine/fill_a_forms.py` (517 lines, zero dedicated test file) and noticed its
`_today_iso()` used plain `datetime.date.today()` - the EXACT bug class the enterprise audit's
round 1/round 3 found and fixed in `watch_deadlines.py`, `daily_digest.py`, `watch_new_tenders.py`
and `confirm_pack.py` (a bridge worker container has no TZ set, runs in UTC by default, so a naive
`date.today()` is one calendar day behind real SAST for the 00:00-01:59 SAST window every day).
Grepped the WHOLE engine tree for every remaining naive `datetime.date.today()` call to check
whether the audit's sweep had actually reached every instance of its own named bug class, rather
than assume it had: found 12 remaining call sites across `engine/` - `fill_a_forms.py`,
`general/fill_sbd_docx.py`, `cv/generate_cv.py`, `pack_generator/suggest_pack.py`,
`company_documents.py`, `fingerprint.py`, `discovery/etenders_national.py`,
`discovery/gov_sources.py`, `pack/harness_pack.py`, `pack/pdf_merge.py`, `pack/assemble_pack.py`,
`pack/process_pack_jobs.py` - none of them named in the audit's own write-up.

### Finding 37 (CONFIRMED, FIXED, severe - a legal tender declaration's own compliance verdict could silently flip)

**Where:** `engine/fill_a_forms.py` and `engine/general/fill_sbd_docx.py`, both `_today_iso()`.

**What was tested:** `fill_a_forms.py`'s `_today_iso()` feeds exactly two comparisons:
`expiry > _today_iso()` for A12 (the company's B-BBEE proof) and A20 (the COID Letter of Good
Standing) - whether the generated SANRAL A-Forms declaration states the proof is CURRENT (confirmed,
attach it) or EXPIRED (missing, get a new one). Reproduced the exact mismatch by hand first
(simulated UTC 2026-10-20 23:30 = real SAST 2026-10-21 01:30, inside the bad window): naive
`today()` reads `2026-10-20`, real SAST reads `2026-10-21`. For a B-BBEE certificate expiring
exactly on the real SAST today (`2026-10-21`), the naive check `"2026-10-21" > "2026-10-20"` is
True (certificate judged CURRENT); the correct check `"2026-10-21" > "2026-10-21"` is False
(judged EXPIRED). Then ran the REAL `fill_a_forms.main()` end to end against the real A-Forms
template (`engine/test_form_field_audit.py`'s own `a_forms()` helper) with the system clock
monkeypatched to that exact instant: confirmed the generated document's A12 provenance flipped to
`"status": "confirmed", "value": "...valid to 2026-10-21"` pre-fix - a government tender
declaration stating a proof is current when, by the real calendar, it had just expired.
`fill_sbd_docx.py`'s identical `_today_iso()` (used as a fallback document-reference date when a
tender's closing date is missing) carries the same bug at lower stakes.

**Fix:** added a local `SAST` constant (`datetime.timezone(datetime.timedelta(hours=2))` - same
value/pattern `watch_deadlines.py` already uses, defined locally rather than imported across
directories, matching that file's own stated convention) to both files, and changed `_today_iso()`
to `datetime.datetime.now(SAST).date().isoformat()`. No other logic touched.

**Verification:** extended `engine/test_form_field_audit.py` (which already imports and exercises
both modules) with a new test: (1) monkeypatches `datetime.datetime.now` to the exact bad-window
instant and confirms both files' `_today_iso()` now return `2026-10-21`, not `2026-10-20`; (2)
runs the REAL `fill_a_forms.main()` against the real template with a B-BBEE proof expiring on
that exact date and confirms the generated document's A12 provenance now reads
`"status": "missing", "reason": "...expired 2026-10-21..."`, not confirmed-current. **Proved all
3 checks actually catch the regression**, not just that they pass: temporarily reverted both
`_today_iso()` functions, re-ran - all 3 failed exactly as predicted (including the end-to-end
check reproducing the exact wrong provenance entry: `"status": "confirmed", "value": "...valid to
2026-10-21"`); restored the fix and confirmed clean again. Full `engine/test_form_field_audit.py`
suite (which exercises A-Forms, docx forms, the technical workbook, envelope covers, intake
readers, financial rows and the general-pack fillers together) still passes in full. `python3 -m
py_compile` clean on all three changed files.

**Flagged, not fixed this run (scope discipline - same lesson as earlier over-fix/under-fix
lessons this review has learned):** the other 10 naive `date.today()` call sites found by the
repo-wide grep are a real, confirmed-by-code-reading instance of the identical bug class, but
each needs its own look at what it actually affects (several are cosmetic provenance timestamps
or internal bookkeeping, not a compliance verdict on a legal document) before deciding whether
fixing is worth the churn versus noise - exactly the judgment call the enterprise audit itself
made when closing "every item deferred" in named batches rather than blindly touching everything
matching one grep. Logged here by file and line so the next pass (mine or a sibling's) doesn't
have to re-discover them: `cv/generate_cv.py:307`, `pack_generator/suggest_pack.py:179`,
`company_documents.py:298`, `fingerprint.py:181`, `discovery/etenders_national.py:275`,
`discovery/gov_sources.py:205`, `pack/harness_pack.py:93`, `pack/pdf_merge.py:118`,
`pack/assemble_pack.py:506`, `pack/process_pack_jobs.py:862`.

## 2026-10-21 (fifty-third run): CV engine - closing out one of last cycle's own deferred items, with an actual rounding-boundary trigger confirmed, not assumed

**Why this area:** CV engine was the one remaining area without a fresh adversarial pass of my
own this session (the enterprise audit covered `generate_cv.py`/`process_cv_jobs.py` for path
traversal, raw-error leaks, null crashes and a control-character failure already). Rather than
re-tread that ground, closed out `cv/generate_cv.py:307` - one of the 10 naive `date.today()`
instances the fifty-first run's own repo-wide grep found and deliberately deferred, on the
reasoning that each needed its own look before deciding whether fixing it was worth the churn.
Took that look.

### Finding 38 (CONFIRMED, FIXED, moderate - a real, narrow rounding-boundary trigger, not a hypothetical one)

**Where:** `engine/cv/generate_cv.py`, `build_sanral_keyperson()`'s Form B2.1 fallback date.

**What was tested:** when a CV is built outside a specific tender context (the standard,
non-tender CV path), the "years of relevant experience" figure is computed "as of today" using
`datetime.date.today()` - the same naive-UTC bug class as Finding 37, but feeding a rounded
numeric computation (`suggest_pack.years_experience_at()`: `round((closing_date - grad).days /
365.25)`) rather than a simple date-string comparison. A one-day shift from the timezone bug only
changes the OUTPUT when the true value sits within about 1/365.25 of a half-integer rounding
boundary - so, unlike Finding 37 (which fires for ANY document expiring on the real SAST today,
a daily-occurring trigger), this needed checking whether a real trigger date actually exists, not
assuming one does from the bug class alone. Wrote a direct search across 60 years of possible
`initial_graduated` dates comparing the naive-UTC and correct-SAST computations under a simulated
clock inside the bad window (UTC 2026-10-20 23:30 = SAST 2026-10-21 01:30): confirmed 60 real
trigger dates in that 60-year span (one date per year, drifting slightly with leap years - e.g.
`initial_graduated = "2026-04-21"` flips `0` -> `1`). Not a one-in-a-million theoretical edge
case - a real person whose qualification date happens to land on the one calendar day per year
this flips would get the wrong number printed on an actual generated CV, specifically during a CV
build that happens to fall in a 2-hour window once a day.

**Fix:** added the same local `SAST` constant pattern as Finding 37 (and `watch_deadlines.py`
before it) to `generate_cv.py`; the fallback `closing_date` is now
`datetime.datetime.now(SAST).date()`.

**Verification:** re-ran the direct 60-year search against the fixed computation - confirmed the
simulated-clock SAST date now matches the real SAST date exactly. Added a new test to
`engine/cv/test_generate_cv.py`: runs the REAL `build_sanral_keyperson()` with a person whose
`initial_graduated` is the confirmed trigger date (`2026-04-21`) and the system clock
monkeypatched into the bad window, and checks the actual provenance-logged years figure. **Proved
the test actually catches the regression** (first attempt didn't - monkeypatching only
`datetime.datetime.now` missed a reverted-to-`date.today()` code path entirely, a real near-miss
in the test's own design, caught by deliberately reverting the fix and seeing `0 failure(s)`
instead of the expected failure; fixed the test to patch `datetime.date.today` too, re-reverted
the fix, confirmed the corrected test now fails exactly as expected, restored the fix, confirmed
clean). Ran `engine/cv/test_extract_cv_fields.py` and `process_cv_jobs.py --self-test` (the real
end-to-end CV-generation smoke test) for regression safety - both still pass. `python3 -m
py_compile` clean.

**Still deferred, unchanged:** the other 9 naive `date.today()` instances from the fifty-first
run's own list - each would need the same "does a real trigger actually exist" check before
fixing, not assumed from the bug class alone.

## 2026-10-21 (fifty-fourth run): closing out more of the deferred naive-UTC-date list - a real submission pack could silently omit a document's own expiry warning

**Why this area:** continuing the deliberate, one-by-one triage of the 9 remaining naive
`date.today()` instances logged by the fifty-first run's own repo-wide grep. Gave each of the 9
its own real look (per the fifty-third run's own stated discipline) rather than fixing or
dismissing them as a batch.

**Triage results, each checked individually:**
- `pack_generator/suggest_pack.py:179`, `pack/harness_pack.py:93`, `pack/assemble_pack.py:506`,
  `fingerprint.py:181` - all four are cosmetic/internal-only: a "generated on" provenance
  timestamp in a JSON/PDF-cover label never compared against anything, a test-harness-only
  confirmation stamp (`admin_harness.py --pack`, not the production path), and a template-change
  bookkeeping field. A one-day shift during the bad window prints a slightly-off label or
  bookkeeping date, with no comparison logic anywhere reading it back - checked by reading every
  call site, not assumed. Not fixed: no real consequence to close.
- `company_documents.py:298` - a generated document's own printed date label, same "cosmetic
  label" shape as the above (prints a date string, no comparison). Not fixed.
- `discovery/etenders_national.py:275`, `discovery/gov_sources.py:209` - both are a discovery
  feed's own "fetch releases published in the last N days" window upper bound. A one-day shift
  could transiently exclude a release published on the exact real-today from one run's results -
  but these are recurring, overlapping scheduled polls (same family as `watch_new_tenders.py`,
  already fixed in the enterprise audit), so a release missed by one run's narrow window is
  self-healing on the very next run. Lower priority than a one-shot event; logged, not fixed this
  run, to keep this pass's scope to the two confirmed real, non-self-healing findings below.
- `pack/pdf_merge.py:118` and `pack/process_pack_jobs.py:862` - both confirmed real, see Finding
  39 below.

### Finding 39 (CONFIRMED, FIXED, severe - a real submission pack's own compliance warning could go silently missing)

**Where:** `engine/pack/pdf_merge.py`, `expiry_warning()`; `engine/pack/process_pack_jobs.py`,
`sync_position_suggestions()`.

**What was tested:** `expiry_warning()` is the function that decides whether a dated document
(COID, B-BBEE proof, insurance, etc.) gets flagged "EXPIRED" in the assembled SANRAL submission
pack's own warnings section (`app/lib/tenderCompliance.ts`'s `validityAtClosing()` rule, cross-
referenced in this function's own docstring). It used `today = today or datetime.date.today()` -
the naive-UTC bug class from Finding 37/38. Unlike Finding 37's exact-expiry-date trigger, this
one is an inequality (`exp < today`): during the 00:00-01:59 SAST window, `today` still thinks
it's real-yesterday, so a document that ACTUALLY expired real-yesterday (`exp == real_yesterday
== naive_today`) evaluates `exp < naive_today` as False - no warning at all, for a document that
is, by the real calendar, already expired. Reproduced directly: `expiry_warning("2026-10-20",
None)` under the simulated bad-window clock (UTC 2026-10-20 23:30 = SAST 2026-10-21 01:30)
returned `None` (no warning) pre-fix, when the real SAST date is already 2026-10-21 and the
document expired the day before.

`sync_position_suggestions()` (candidate ranking for SANRAL tender packs) had the same bug at
`today = today or datetime.date.today()`, with two effects: (1) a tender that closed real-
yesterday kept getting re-ranked for one extra cycle (`closing_date < today` false-negative,
wasted work, not wrong data); (2) a tender with NO closing date on file at all falls back to the
(possibly wrong) `today` as the date `rank_candidates()` scores experience-at-closing against -
the identical rounding-boundary risk as Finding 38, one layer removed into candidate ranking
order rather than a printed CV figure.

**Fix:** both files now import and reuse `generate_cv.SAST` (via `pdf_merge.py`'s existing
`from generate_cv import _convert_to_pdf` import, extended to also pull `SAST`; `process_pack_jobs.py`
already imports from `pdf_merge`, extended the same way) rather than redefining a fourth local
copy - `today = today or datetime.datetime.now(SAST).date()` in both places.

**Verification:** new `engine/pack/test_pdf_merge.py` (first dedicated test file for either
module): 3 checks - `expiry_warning()` now correctly flags the real-yesterday-expired document
AND still does NOT falsely flag a document expiring exactly today (the deliberate mirror check,
proving the fix isn't one-sided); `sync_position_suggestions()` against a small `FakeClient`
(one tender closed real-yesterday) confirms it's now correctly skipped rather than re-ranked.
**Proved all 3 actually catch the regression**, not just that they pass: the FIRST version of
this test suite had the identical near-miss as Finding 38's own test - patching only
`datetime.datetime.now` missed the reverted `date.today()` code path entirely (`0 failure(s)`
when 2 were expected); caught this by deliberately reverting both fixes and checking the suite
actually went red, fixed the test to patch `datetime.date.today` too, re-reverted, confirmed the
corrected suite now genuinely fails (2 failures, including the exact wrong pre-fix ranking
output), restored both fixes, confirmed clean again. Ran `engine/test_form_field_audit.py` and
`engine/general/test_general_bridge.py` (both exercise adjacent pack-generation code) for
regression safety - both still pass unchanged. `python3 -m py_compile` clean on all three
changed files. Not run this pass: a full `admin_harness.py --pack` end-to-end LibreOffice build
(several minutes per the enterprise audit's own prior timing) - the fix is narrowly scoped to two
pure comparison functions already covered by direct reproduction, and the existing suites that do
exercise the surrounding pack-assembly code show no regression.

**Still deferred:** `etenders_national.py`/`gov_sources.py`'s self-healing discovery-window
instances, logged above rather than fixed this run.

### Finding 40 (CONFIRMED, FIXED, moderate - a real ESKOM form named in the docs never matched)

**Where:** `engine/general/requirements.py`, `IN_TEXT_BUYER_FORMS`.

**Context:** Sarel asked (2026-10-20/21) to go through advertised tenders and make sure the
requirements engine understands each one's requirements, not just the curated samples already in
`templates/general_samples/`. Ran a real, randomly-sampled batch of 12 currently-advertised eTenders
tenders (diverse buyers: national departments, municipalities, SOEs) through the real
`extract_requirements()`, downloading each one's actual published documents first - not an
AI-summarized read, the real files. 11 of 12 ran cleanly (no crash, no silent empty result); most of
the "thin" results turned out to be correct, not bugs (one eTenders listing genuinely has only the
advert, not the full tender; one tender routes submission entirely through SAP Ariba with no
document-based requirements at all; one PDF is a genuine scanned image with no text layer, correctly
flagged unreadable rather than guessed).

**What was tested:** One ESKOM tender (E3703CXMWP, "NMC/RMC Atmos Maintenance and Support", 7 real
documents) came back with almost nothing extracted - no SBD/MBD forms (correct, ESKOM doesn't use
them), but also none of ESKOM's own forms, despite `requirements.py`'s own module docstring
explicitly naming "Form A" as one of them. Searched the real document text directly: "Form A
(Enquiry/Contract/Quality Requirements for Supplier Quality Management)" is named 11 times across
the corpus, including "The existing and/or potential suppliers must complete, sign and return Form
A with the other returnables as listed in the List of Tender Returnable documents" - a real,
explicit, mandatory returnable with no corresponding entry in `IN_TEXT_BUYER_FORMS` at all. A bidder
using this engine today would submit without it and never know it was asked for.

**Fix:** added `eskom_form_a` to `IN_TEXT_BUYER_FORMS`, anchored on the parenthetical that actually
names the form (`FORM\s+A\s*\(\s*(?:ENQUIRY|TENDER)\s*(?:AND|/)?\s*CONTRACT\s*(?:AND|/)?\s*QUALITY\s+
REQUIREMENTS\s+FOR\s+SUPPLIER\s+QUALITY\s+MANAGEMENT`) rather than bare "Form A" - that string alone
is too generic and would false-positive on any other buyer's unrelated "Form A".

**Verification:** the real 7-document corpus is now committed as a new `general_harness.py` sample,
`templates/general_samples/eskom_e3703cxmwp/` (provenance recorded in `sources.json`, same PDDL
licence/convention as every other sample there), with an `EXPECTED` entry pinning
`buyer_forms_any: ["eskom_form_a"]` plus the real returnables found (`bbbee_proof`, `cidb`,
`cipc_documents`, `financial_statements`) and role (`contractor.project_manager`).
**Proved the regression test actually catches the bug**: reverted the fix, ran
`general_harness.py --only eskom_e3703cxmwp` - 1 failed ("none of the buyer forms ['eskom_form_a']
found"), all 7 company baselines flagged `changed ['buyer_forms']`; restored the fix, re-ran - clean
again, baseline established for all 7 test companies. Full `general_harness.py` (all 10 samples x 7
companies, including pack builds) and `test_requirements.py` both still pass with no regression
elsewhere.

**Broader context, not yet acted on:** this was one random sample of 12 current tenders out of
2,200+ on eTenders alone (plus every direct-site reader this session has built). One confirmed gap
found this way in a random dozen suggests more exist; this verification approach (real current
tenders, real documents, run through the real engine, investigate every thin/empty/unexpected
result rather than assume it's correct) is the one to keep using, not a one-off.

## 2026-10-21 (fifty-fifth run): Discovery - two real, unrelated South African municipalities could be scored as the same place, inflating a company's estimated tender score

**Why this area:** a parallel sibling session had started verifying `requirements.py` against
real current tenders (Finding 40), so picked a different corner of discovery to avoid duplicating
that effort: `score_outlook.py` (817 lines, Discovery's own fit-scoring engine) had no dedicated
test file at all - only indirect coverage as a dependency of fan-out/downgrade tests, never a
direct adversarial pass of its own internals. Read the whole file; `extract_locality`/
`match_locality` (office-location preference-point matching against a tender's own text) stood
out as plain-text fuzzy matching across real, varied South African place names - exactly the
"different company shapes" territory this review targets, since a company's own office locations
are as varied as the tenders' own locality wording.

### Finding 41 (CONFIRMED, FIXED, severe - a real score-inflation bug reachable by ordinary geography, not contrived input)

**Where:** `engine/discovery/score_outlook.py`, `_area_matches()`.

**What was tested:** `_area_matches()`'s substring-match leg compares `_norm_area()`'s output -
which strips every space and non-letter character, leaving bare concatenated letters with zero
word-boundary information - using plain Python `in` substring testing (`len(v) >= 6 and (v in a
or a in v)`). Normalized place names in South Africa frequently contain OTHER, completely
unrelated place names as a coincidental run of letters once spaces are gone. Searched a list of
~145 real district/local municipality names across all 9 provinces (built from this repo's own
`docs/specs/Government-Buyer-Catalog-Municipalities*.md` catalog and general knowledge of SA
local government) for every pairwise collision under the real matching rule: found "Nala" (a
Free State local municipality, home to Wesselsbron/Bothaville) sits as a bare letter-run inside
"Kannaland" (an unrelated Western Cape municipality) - `"nala" in "kannaland"` is literally True
after normalization. Confirmed through the REAL `match_locality()` function, not a reimplementation:
a company whose only office is in Kannaland, given a tender's locality row requiring an office in
Nala, was reported `{"status": "matched", "points": 5, "reason": "office in Kannaland matches
'Nala' - 5 point(s)."}` - real preference points awarded for an office nowhere near the required
area, silently inflating that company's estimated score on a real tender.

**Fix:** kept `_norm_area()` (used elsewhere for exact-match dedup keys, untouched) but added
`_norm_area_words()` - the same administrative-word stripping, but keeping spaces between what's
left - and changed the substring leg of `_area_matches()` to require the shorter name appear as a
whole word/phrase (bounded by spaces or the string's edges via `_word_in()`), not an arbitrary run
of letters. This still matches the rule's own real, intended case ("City of Tshwane" in tender
text vs an office's plain "Tshwane" field - "city" isn't stripped, but "tshwane" is still a whole
word inside the longer phrase) while rejecting the coincidental Nala/Kannaland collision. The
exact-match and `SequenceMatcher` ratio checks (neither implicated - `ratio("nala", "kannaland")`
is only 0.615, well under the 0.85 threshold) are untouched.

**Verification:** re-ran the real `match_locality()` for the Kannaland/Nala case post-fix -
correctly returns `"no_match"`. Re-ran the full ~145-name pairwise sweep - zero unexpected
collisions remain (one correct, deliberately-excluded match survives: "Mpofana" vs "Mooi
Mpofana" - the SAME real KwaZulu-Natal municipality under its current and former official name,
confirmed via general knowledge of SA local-government renamings, not a bug). Added
`engine/discovery/test_score_outlook.py` (first dedicated test file for this module): 5 checks -
the Kannaland/Nala false-positive rejected, the "City of Tshwane" legitimate case still matches,
a plain exact-name match still works, the Mpofana/Mooi-Mpofana legitimate near-miss still
matches, and the full ~140-name sweep finds no other unexpected collision. **Proved the new tests
actually catch the regression**, not just that they pass: temporarily reverted `_area_matches()`
to the pre-fix substring check, re-ran - both the direct Kannaland/Nala check and the sweep check
failed exactly as predicted (`FAIL ... [('Nala', 'Kannaland')]`); restored the fix and confirmed
clean again. Ran `test_discovery_fanout.py`, `test_discovery_downgrades.py` and `test_taxonomy.py`
(all depend on `score_outlook.py` indirectly) for regression safety - all still pass. `python3 -m
py_compile` clean on both changed files.

### Finding 42 (CONFIRMED, FIXED - option (a), Sarel's own call)

**Where:** `engine/general/requirements.py`'s document-classification/extraction path (no single
function - this is a shape of document the whole pipeline assumes doesn't exist).

**Context:** continuing phase 2 (verifying the requirements engine against real current tenders,
per Sarel's own instruction) - a second real random batch of 15 more advertised eTenders tenders.
14 of 15 behaved reasonably on inspection; one surfaced a real, more serious issue than Finding 40.

**What was found:** City of Tshwane Metropolitan Municipality's own eTenders listing for
`GPM 08-2026/27` ("long-term lease and development of the following council owned [property]")
links to a single PDF, "Notice 6 of 2026/27" - which is not that tender's own document at all, but
a **combined bulletin listing 6 unrelated tenders together** (GPM 06, 08, 14, 15, 17, 18), each its
own row in a table, all sharing one PDF. Confirmed directly in the real text: "CIDB grading 3ME" and
"CIDB grading 6CE" appear only in GPM 18's and an unrelated "WSBU 01" tender's own rows - nowhere in
GPM 08's own row (a property lease, which has no CIDB angle at all). Running this PDF through
`extract_requirements()` for GPM 08 surfaces `returnable cidb required` anyway, because the engine
has no concept of "this specific tender's own section of a document that covers several tenders" -
it reads the whole file as one document and attributes everything in it to whichever tender is
being processed. **A bidder pursuing GPM 08 would be told a CIDB grading is required when it is
not, and conversely would never be told what GPM 08 itself actually needs**, since its own row
("long-term lease and development... following council owned [properties]") isn't the kind of text
`find_returnables()`/`find_roles()` look for at all.

**Scope, not yet established:** how common this is across buyers beyond City of Tshwane wasn't
checked this pass - municipalities publishing a single "Notice N of FY" PDF covering several
tenders at once, rather than one document per tender, may or may not be common; this is one
confirmed instance, not a surveyed pattern.

**Fix (Sarel's own call, option (a) over (b)):** detect a "combined multi-tender bulletin" shape and
decline to extract tender-specific requirements from it at all, rather than build the meaningfully
harder row/section-scoped extraction (option (b) - isolating a specific reference's own table row,
which nothing in this engine does today). Added `is_combined_bulletin()` / `BULLETIN_ROW_RE` to
`requirements.py`: a buyer-agnostic signal (no reference-number format assumed) - a numbered list
item ("N. ") immediately followed by an uppercase reference-like token (letters then digits) with a
month name within the next 200 characters (the row's own closing date), repeated 3+ times. Checked
against every other real document already in this corpus (every `general_samples/` fixture, plus
the 26 further real tenders sampled for Findings 40/41/42 themselves) before picking the threshold:
**zero false positives** at 3+; the one real bulletin matched 12 times, nowhere near borderline.

A document flagged this way is excluded from every extraction signal (suite decision, forms,
returnables, roles, CIDB, briefing, locality, experience, buyer-form detection) exactly like an
unreadable document already was - not just hidden in the UI - and gets its own specific gap message
("Covers multiple tenders in one document, not just this one...") instead of the generic "couldn't
be read" or "no SBD/MBD forms" wording, which would have been misleading (the document WAS read;
it's deliberately not attributed to this tender).

**Verification:** the real bulletin PDF is now a permanent `general_harness.py` sample,
`templates/general_samples/tshwane_gpm08_bulletin/` (provenance in `sources.json`), with an
`EXPECTED` entry pinning empty returnables/forms - protected by the harness's own baseline-diff
mechanism, not a bespoke assertion. **Proved the regression test actually catches the bug**:
temporarily forced `is_combined_bulletin()` to always return `False` (simulating the pre-fix
behaviour), ran `general_harness.py --only tshwane_gpm08_bulletin` - all 7 company baselines
flagged `changed ['returnables']`; restored the real function, re-ran - clean again, 7/7. Full
`general_harness.py` (all 11 samples x 7 companies, including PDF/Word pack builds) and
`test_requirements.py` both pass with no regression elsewhere.

**Scope, not yet established:** how common this bulletin shape is across buyers beyond City of
Tshwane wasn't checked this pass - this fix handles it wherever it's found, but a wider survey
(does any other municipality do this routinely?) hasn't been done.

## 2026-10-21 (fifty-sixth run): CV engine - a real South African ID number split across a line break by a narrow PDF table cell reached the Anthropic API unredacted

**Why this area:** a parallel sibling session is actively verifying `requirements.py`/
`submission_plan.py` against real current tenders, so picked a different corner to avoid
duplicating that effort. `engine/cv/extract_cv_fields.py`'s SA-ID-redaction step (step 4 of its
own documented pipeline: "found locally and replaced... BEFORE any text leaves this machine") is
a real, narrow, privacy-critical (POPIA) piece of logic with a crisp testable boundary - and
`test_text_extraction()`'s own existing comment already confirms the exact triggering artifact is
real, not hypothetical: "LibreOffice's PDF wraps the narrow table column mid-token
('TMRA/2019/04' / '4') - real behaviour of PDF CVs."

### Finding 43 (CONFIRMED, FIXED, severe - a confirmed-real PDF-extraction artifact bypassing the module's own stated redaction promise)

**Where:** `engine/cv/extract_cv_fields.py`, `SA_ID_RE` / `find_and_redact_sa_ids()`.

**What was tested:** `SA_ID_RE` matched a 13-digit South African ID number's 6/4/3 digit groups
with only a literal space or hyphen (`[ -]?`) as the allowed separator between them. The same
test file's own `test_text_extraction()` already documents, from real LibreOffice-generated PDF
output, that a narrow table column wraps text mid-token - the exact artifact that would land a
digit group of an ID number on one line and the rest on the next. Constructed the real adversarial
case directly: a checksum-valid synthetic ID (`sa_id()`'s own test helper) split across line
breaks exactly the way a narrow "ID Number" table cell would wrap it (`"800101\n5009087\n..."`),
run through the real `find_and_redact_sa_ids()`.

**Confirmed the bug:** neither half of the split ID is 13 digits on its own, so `SA_ID_RE` never
matched anything at all - the function returned the text completely unchanged, `ids == []`. The
full, genuinely valid ID number would have reached the Anthropic API verbatim in the very next
pipeline step, split only by a newline a human reader skips straight past without noticing -
exactly the failure this module's own docstring states step 4 exists to prevent, for the one
field (a government ID number) this whole redaction pipeline was built around.

**Fix:** widened the separator between the three digit groups from `[ -]` to `[\s-]` (any
whitespace, including a line break, not just a literal space or hyphen) - one-character regex
change. The surrounding `(?<!\d)`/`(?!\d)` digit-boundary guards and the downstream Luhn/
month-day/citizenship-digit validity checks (`_plausible_sa_id()`) are untouched, so the fix
doesn't loosen WHAT counts as a valid ID, only how its three groups may be visually separated in
the extracted text.

**Verification:** re-ran the real adversarial case post-fix - the line-split ID is now found and
redacted (`ids == [SYNTH_ID]`, the real ID string no longer present once newlines are stripped
for the check). Mirror case, proving the fix isn't over-broad: two genuinely UNRELATED digit runs
("Phone: 011555" / "1234 ext 99") sitting on either side of a line break are NOT fused into a
false ID - `find_and_redact_sa_ids()` leaves that text completely untouched, confirming the
digit-boundary and validity guards still do their job across the wider separator. Added
`test_sa_id_redaction_line_break()` to `engine/cv/test_extract_cv_fields.py` (2 checks). **Proved
the test actually catches the regression**, not just that it passes: temporarily reverted
`SA_ID_RE` to its pre-fix pattern, re-ran - the line-split check failed exactly as predicted
(`FAIL an ID split across line breaks is still found and redacted, not leaked`); restored the fix
and confirmed the full suite passes clean again (`ALL PASSED`). Ran `engine/cv/test_generate_cv.py`
and the real `process_cv_jobs.py --self-test` end-to-end smoke test for regression safety in the
same engine - both still pass. `python3 -m py_compile` clean on both changed files.

### Finding 44 (CONFIRMED, FIXED, moderate - a contract-administration clause misread as a bid-time ask)

**Where:** `engine/general/requirements.py`, `_key_personnel_gap()`.

**Context:** continuing phase 2 (verifying the requirements engine against real current tenders) -
a third real random batch of 15 more advertised eTenders tenders (sample #4 overall). A second,
independently-sampled City of Tshwane combined-bulletin PDF correctly triggered the Finding 42 fix
(no false requirements shown) - good confirmation the fix generalises, not a new finding on its
own. 14 of 15 behaved reasonably; one (a Passenger Rail Agency tender) surfaced this.

**What was found:** `_key_personnel_gap()` exists to catch a key-personnel ask that `find_roles()`'s
catalogued `ROLE_PATTERNS` list doesn't recognise (an environmental control officer, a land
surveyor...) and warn the UI it might be missing one. It took the FIRST `KEY_PERSONNEL_RE` match in
the whole document with no context check at all. The real document's only "key personnel" mention
was: "The Service Provider shall not, without the prior written consent of the Employer: ... 4.
Deviate from or change the Scope of Services; 5. Change Key Personnel on the Service." - one item
in a list of things needing the buyer's consent to change DURING the contract, not a bid-time ask
for key personnel at all. The manifest told a bidder "this tender asks for key personnel" when it
doesn't say that anywhere.

**Fix:** added `_KEY_PERSONNEL_FALSE_CONTEXT_RE`, a narrow check on the ~20 characters immediately
before a match for "change"/"changing"/"substitut-"/"replac-" (contract-administration verbs that
only make sense applied to an EXISTING assignment, never a bid-time ask) - that match is skipped,
not treated as "no gap" outright: `_key_personnel_gap()` now keeps searching the rest of the
document (and the rest of the corpus) for a genuine mention, rather than returning on the first hit
regardless of context the way it did before.

**Verification:** added `check_key_personnel_false_positive()` to `test_requirements.py` - two real-
shaped cases: a document whose ONLY key-personnel mention is the false-positive clause (now
correctly produces no key-personnel gap) and a document with BOTH the false-positive clause AND a
genuine "submit CVs of key personnel" ask (correctly still surfaces the genuine one, proving the
fix doesn't just suppress the feature entirely). **Proved the regression test actually catches the
bug**: reverted the fix, confirmed the first case now fails exactly as predicted (returns the false-
positive clause as a genuine gap), restored, confirmed both cases pass again. `test_submission_plan.py`
(all 18 checks) and the full `general_harness.py` (91 clean, 0 flagged, 0 failed) both still pass -
no regression elsewhere.

## 2026-10-21 (fifty-seventh run): Discovery - a genuinely different real company could be silently stored as a tender's winner, corrupting award/price intelligence

**Why this area:** a parallel sibling session is actively verifying `requirements.py`/
`submission_plan.py` against real current tenders (phase 2, multiple batches in progress), so
again picked a different corner: `store_award_outcomes.py`'s award/price intelligence - the
original priority area from this review's very first runs ("a genuine R0,00 award") - had no
dedicated test file of its own (`test_award_outcomes.py` only covers the separate,
similarly-named `award_outcomes.py` parsing module). `find_winner()`'s fuzzy name-matching
fallback is the exact same CLASS of risk as Finding 41's municipality mix-up - plain-text
similarity matching between real, independently-named South African entities - just in a
different engine, so it was the natural next thing to check after that finding.

### Finding 45 (CONFIRMED, FIXED, severe - the same fuzzy-matching bug class as Finding 41, now in award/price data)

**Where:** `engine/discovery/store_award_outcomes.py`, `find_winner()` / `merge()`.

**What was tested:** `find_winner()`'s last-resort fallback ("name_token") matched a tender's
announced winner to a bidder in the register by comparing ONLY the first word of each normalized
company name. Real South African company names very commonly share a generic first word (place
names, Nguni/Sesotho words used across many unrelated businesses). Constructed a realistic
adversarial case: a bidders register listing "Bokamoso Trading CC" and "Siyakhula Projects (Pty)
Ltd", with the buyer's announced winner being "Bokamoso Construction (Pty) Ltd" - a real, but
DIFFERENT company, not present in this register at all (a believable real-world data gap: the
award notice and the bidders register often come from different pages/sources and don't list
every company identically). Ran the real `find_winner()`: it matched index 0 ("Bokamoso Trading
CC") on `"name_token"` alone. Before reaching for a code fix, tried the obvious mitigation this
codebase already uses elsewhere (Finding 41's `difflib.SequenceMatcher` ratio) and calibrated it
against both the false-positive case and several realistic LEGITIMATE trading-name variants of
the SAME company ("Khulani Civils CC" vs "Khulani Civil Engineering (Pty) Ltd", etc.) - the
ratios overlap (0.632-0.686 for the false positives, 0.667-0.732 for the legitimate variants),
so **no safe similarity threshold exists** to separate them; a stricter cutoff would also reject
real matches, a looser one wouldn't catch this bug.

**Confirmed the real consequence:** ran the full `merge()` pipeline (not just the isolated
function) with this exact scenario - `bidders[0]["is_winner"]` was set `True` and
`winner_match_basis` was `"name_token"`, with no note anywhere flagging the uncertainty. This
feeds `winner_rank`, `winner_vs_median` and `lowest_bid_won` - real, stored, public award/price
intelligence fields - meaning a company that never won anything could be recorded as this
tender's winner, and the actual winner's price would never be compared against the field at all.

**Fix (given no safe threshold exists, changed what the system is willing to assert instead of
trying to tune the match):** `find_winner()` still returns the `"name_token"` candidate (kept for
diagnostics - see its own updated docstring), but `merge()` now only sets `is_winner`/
`winner_match_basis` for the two CONFIRMED bases (`"name"` exact match, `"amount"` exact price
match). A `"name_token"`-only hit instead produces an honest note: `"The winner (X) could not be
confidently matched to a name on the published register - closest candidate by first word: Y (not
assumed; verify manually)."` - the exact same "never guess, say what you don't know" pattern this
file already uses for the fully-unmatched case, just extended to the previously-overconfident
fallback.

**Verification:** added `engine/discovery/test_store_award_outcomes.py` (first dedicated test
file for this module): 7 checks across 4 cases - the false-positive case (no `is_winner` set, null
basis, the honest note present), the exact-name mirror case (still sets the winner, basis
`"name"`), the exact-amount mirror case (still sets the winner, basis `"amount"`), and confirming
`find_winner()` itself still surfaces the unconfirmed candidate for diagnostics rather than
silently dropping it. **Proved the tests actually catch the regression**, not just that they
pass: temporarily reverted `merge()`'s basis-gating back to trusting any non-null `find_winner()`
result, re-ran - all 3 relevant checks failed exactly as predicted (`is_winner: True` on the wrong
company, `basis: name_token`, no note); restored the fix and confirmed clean again. Ran
`test_award_outcomes.py`, `test_award_prices.py` and `test_etenders_portal.py` (all exercise code
adjacent to or consuming this module) for regression safety - all still pass. `python3 -m
py_compile` clean on both changed files.

## 2026-10-21 (fifty-eighth run): SANRAL pack engine - the offline key-person suggestion could silently disagree with the live Tender Workspace for the identical tied-score candidates

**Why this area:** continuing to avoid `requirements.py`/`submission_plan.py` while the sibling's
phase-2 verification is active there. `engine/pack_generator/suggest_pack.py` (245 lines, zero
dedicated test file) is Step 2 of the SANRAL pipeline - the first thing a human actually reads
(`pack_suggestions.md`) to decide who to confirm for a key position - and its candidate-scoring
function (`score_candidate()`) is reused by `engine/pack/process_pack_jobs.py`'s own
`rank_candidates()` for the LIVE Tender Workspace's re-ranking of the SAME positions. Two
independent call sites doing the same ranking job is exactly the kind of place a convention can
drift between them unnoticed, so read both side by side.

### Finding 46 (CONFIRMED, FIXED, moderate - two code paths silently disagreeing on the same real decision)

**Where:** `engine/pack_generator/suggest_pack.py`, `suggest()`'s own candidate sort (now
extracted into `rank_candidates()`).

**What was tested:** `process_pack_jobs.py`'s own `rank_candidates()` explicitly documents its
tie-break rule: "ties: more years' experience, then name - stated, not hidden." `suggest_pack.py`'s
`suggest()` runs the exact same `score_candidate()` scoring for the exact same positions, but its
own sort was `key=lambda c: c["score"], reverse=True` - no tie-break at all. Python's `sorted()`
is stable, so an unbroken tie fell back to each person's position in the company's own profile
JSON. Constructed a real adversarial case: two candidates tied on score (identical keyword
overlap) but very different years of experience (7 vs 22 years) - a realistic "different company
shapes" scenario (a company with a junior and a senior person both plausible for the same
position). Ran the real `suggest_pack.py` ranking logic with the two people listed in each order.

**Confirmed the bug:** with the junior person listed first in the profile, they were the
"SUGGESTED" top candidate; with the senior person listed first instead, THEY were suggested -
purely from file order, nothing to do with who is actually better qualified. Worse, this offline
suggestion (the one a human reads first, in `pack_suggestions.md`) could silently disagree with
what the SAME company's live Tender Workspace would rank first for the identical position, since
`process_pack_jobs.py`'s `rank_candidates()` already ties-break correctly by years then name - two
code paths computing the same decision, giving different answers for the identical input.

**Fix:** extracted the ranking into a new `rank_candidates(people, position, closing_date)`
function in `suggest_pack.py` itself (mirroring `process_pack_jobs.py`'s own name and tie-break
convention exactly, rather than two independently-maintained copies that could drift again), with
the sort key changed to `(-c["score"], -(c["years_experience"] or -1), c["name"] or "")` - the
documented convention, now actually enforced here too.

**Verification:** re-ran the real adversarial case post-fix in both profile orderings - both now
consistently suggest the senior, more-experienced candidate. Mirror case confirmed the fix isn't
one-sided: a genuinely better keyword-matched junior candidate still correctly outranks a
higher-years but unmatched senior one (score stays the primary key; years only breaks a genuine
tie). Added `engine/pack_generator/test_suggest_pack.py` (first dedicated test file for this
module): 3 cases, 6 checks, including a third tie (same score AND same years) falling through to
the name tie-break deterministically. **Proved the tests actually catch the regression**, not
just that they pass: the first draft of this test reimplemented the sort key independently inside
the test file itself rather than calling the real code - reverting the fix produced `0 failure(s)`
when 3 were expected, exposing that the test exercised its own copy of the logic, not
`suggest_pack.py`'s. Fixed by having the test call the newly-extracted `rank_candidates()`
directly; re-reverted the real fix and confirmed the corrected test suite now genuinely fails (3
failures, including the exact wrong tied-order outputs); restored the fix and confirmed clean
again. Ran `engine/test_form_field_audit.py`, `engine/cv/test_generate_cv.py` and the real
`process_cv_jobs.py --self-test` (all exercise code adjacent to or depending on this module) for
regression safety - all still pass. `python3 -m py_compile` clean on both changed files.

## 2026-10-21 (phase 2, seventh batch): a real fix was tried and rejected before it broke 3 already-correct role detections - confirmed, flagged, not fixed

**Why this batch:** phase 2's 7th real-tender sample (15 tenders, diverse buyers: ACSA, Transnet,
ESKOM, 3 SETAs, City of Johannesburg, 2 development/catchment agencies, a TVET college, Public
Works, Water and Sanitation, Commission for Gender Equality), continuing the "go through each
tender advertised and make sure our engines understand the tender requirements 100%" verification.
Downloaded each release's real documents from eTenders, ran them through the real
`extract_requirements()` and `submission_plan.compile_plan()`, and investigated every result that
looked thin or surprising against the actual PDF rather than assuming either tool was right.

### Finding 47 (CONFIRMED, FIXED in a later pass, moderate - see "Fixed" note below the original write-up)

**Where:** `engine/general/requirements.py`, `find_roles()` / `ROLE_PATTERNS`'s
`contractor.contract_manager` entry (`r"\bcontracts?\s+manager\b"`), no exclusion at all - unlike
`contractor.project_manager`, which already excludes "Employer's/Client's Project Manager" (a
comment there already names this exact bug class: "NEC3's 'Employer's/Client's Project Manager'
is the buyer's own agent, not a bidder role").

**What was tested:** Transnet SOC Ltd's `TPT/2026/10/1428/13269/RFQ` (ocid `ocds-9t57fa-175017`,
real eTenders document `PPA-170758 ELECTRICAL SERVICES & MAINTENANCE 1.pdf`) was flagged with role
`contractor.contract_manager`, 2 mentions, confidence 62. Read both real mentions in the actual
PDF: "Prior to mobilisation, the Contractor shall submit a Project Safety Compliance File for
review and acceptance by **the Transnet Contract Manager** and SHEQ Department" (twice, near-
identical wording). Both are Transnet's own internal contract administrator reviewing the
Contractor's submissions - not a role the bidder is asked to nominate or supply a CV for. Grepped
the entire extracted document text for every other "contract manager" occurrence: there are
exactly these 2, and neither is a genuine ask. The resulting `submission_plan.py` step
(`needs_input`, "No person is tagged for this role yet") would send a real user looking for a
person to tag for a role nobody actually asked them to supply - a genuine false positive, not a
hypothetical one.

**Root cause:** `ROLE_CONTEXT_RE` (the ±250-char context window every role match must pass)
includes `\bmust\b|\bshall\b|required` - words so common in ordinary contract/SHEQ boilerplate
that they trigger on almost any sentence, including ones about the buyer's own named
administrator. Both real Transnet mentions sit directly next to "shall" ("...Contractor shall
submit...") with no personnel-specific word (CV, curriculum, qualifi*, experience, years,
organogram, team) anywhere nearby - confirmed by testing the exact match windows against a
narrower context pattern with `must`/`shall`/`required` removed: both false mentions correctly
drop out.

**Fix attempted and REJECTED:** tried removing `\bmust\b|\bshall\b|required` from the shared
`ROLE_CONTEXT_RE` (used by all 17 role patterns, not just this one). Captured every role detected
across the whole `templates/general_samples/` corpus before and after the change and diffed them -
the change silently **deleted 3 already-correct, previously-verified role detections**:
`eskom_e3703cxmwp` lost `contractor.project_manager` entirely (this is Finding 40's own committed
regression fixture, with an explicit `general_harness.py` `EXPECTED` assertion - running the
harness after the change immediately failed: `EXPECTATION FAILED: role 'contractor.project_manager'
not found`, 7 companies flagged `changed: ['roles']`), `eskom_e3689` lost `hs.safety_officer`, and
`ecdpwi_scmu5_0007` lost `psp.professional_architect`/`psp.architectural_technologist`. Read why:
several genuine asks in those real documents are phrased with "must"/"shall" as their *only* nearby
trigger word within the window (the personnel-specific word that would otherwise qualify them sits
just outside the ±250-char range, or isn't present in that exact sentence at all) - so the three
generic words are doing real, load-bearing work elsewhere even though they're also the exact cause
of this false positive. **Reverted immediately** (`git status` confirmed no uncommitted change
remains); re-ran `general_harness.py --no-pack`: `91 clean, 0 flagged, 0 failed` again, back to
baseline.

**Why not fixed a different way this pass:** a same-document check (also confirmed on
`ecdpwi_scmu5_0007`, which has an identical-shaped "DPWI Project Manager" buyer-reference mention
*alongside* a genuine ask elsewhere in the same document - both patterns coexist in real tenders,
not mutually exclusive) shows the real distinguishing signal isn't a context word at all, it's
*whose* name sits next to "Contract/Project Manager" - the buyer's own name (Transnet, DPWI) versus
no such qualifier. `find_roles()` doesn't currently know the tender's own buyer name, and
hardcoding specific buyer names would not generalise. A real fix needs either plumbing the buyer
name into `find_roles()` so a "<buyer-name> Contract/Project Manager" phrasing can be excluded
regardless of context words, or a smarter per-role-scoped context rule - not a blanket change to
the shared `ROLE_CONTEXT_RE` every other role pattern also depends on. Flagged here rather than
forced, same discipline as Finding 42's "real architectural gap, not a quick regex fix" and Finding
37's ten deferred `date.today()` sites - logged with exact evidence so the next pass (mine or a
sibling's) doesn't have to re-discover it.

**Fixed, later pass (2026-10-21, same day):** plumbed the tender's own buyer name into
`find_roles()` exactly as flagged above, rather than touching the shared `ROLE_CONTEXT_RE`.
`extract_requirements(..., buyer=None)` and `find_roles(docs, ocr_mean=None, buyer=None)` both gained
an optional `buyer` parameter; `_buyer_core_words(buyer)` strips generic legal/government suffixes
("SOC", "Ltd", "Department", "Municipality", ...) and words under 4 characters, keeping only the
buyer's own distinctive words ("Transnet" from "Transnet SOC Ltd"); `_is_buyers_own_person()` checks
only the 60 characters immediately before a role match (not the whole ±250-char context window -
this is about what qualifies THIS specific mention, not the document's general subject) for any of
those words. Wired into the one real production call site that already has the buyer name on hand
(`process_general_jobs.py`'s own `tender.get("buyer")`, confirmed already read on the very next line
for `intake.classify_documents`) and into `general_harness.py`'s regression corpus (loads
`sources.json`'s own recorded `buyer` field per sample, previously never passed through at all).

**A genuine bonus find, not just the originally-reported case:** re-running the full sample corpus
with buyer names wired through flagged `eskom_e3689` as changed (not an EXPECTATION FAILURE - no
`roles` assertion was pinned for that sample - but a real behaviour change, correctly caught by the
harness's own baseline-diff mechanism rather than silently passing). Read the real document text
behind both now-excluded matches before accepting the change: `"...Eskom System engineer, quality
control and project manager"` (a list of ESKOM's own reviewing staff, not a bidder ask) and `"The
Supplier shall appoint a person who will liaise with the Eskom Safety Officer"` (the supplier
appoints a liaison TO Eskom's own Safety Officer - the ask is the liaison appointment, not supplying
"the Safety Officer" role itself). Both were previously-undetected false positives of the exact same
bug class, now correctly excluded by the same fix - not a new bug. Confirmed no other sample in the
corpus was affected (91 clean, 0 flagged after accepting this one intentional baseline change).

**Verification:** `test_requirements.py`'s `check_buyers_own_manager_excluded()` (4 checks) uses the
real quoted Transnet sentence verbatim as its fixture text (not synthetic prose) - confirms the
buyer-prefixed mention is excluded only when the buyer name is actually passed (unchanged default
behaviour with no buyer), that a genuine ask in the SAME document still surfaces, and a negative
control (an unrelated buyer name never coincidentally excludes a genuine ask). Regression-catching
independently verified the usual way: temporarily removed the new exclusion check, confirmed the
exact expected assertion fails (not a different one), restored it, confirmed clean again. Full
`engine/general` suite, the harness, and a full repo-wide `test_*.py` sweep all clean.

**Rest of the batch:** the other 14 tenders sampled were all correctly handled - 2 genuine "advert
only, not the full tender document" cases (ESKOM `E1977DXNCRREGRET`'s only document turned out to
be a Regret Letter for unsuccessful suppliers, not a tender at all; Majuba TVET College's single
page is a 3-service cost/logistics notice directing bidders to buy the real documents by email for
R500, with no SBD/MBD content anywhere - correctly flagged thin, not a Finding-42-style
misattribution risk since all 3 services' visible content is identical non-requirement logistics),
2 genuine scanned-PDF "unreadable" cases (Public Works `MTH09/2026`, a 105-page Konica Minolta scan
with zero text layer; Water and Sanitation `WTE1063CE`'s addendum, same scanner signature - this
sandbox's known no-Tesseract limitation, not a new bug), and a King Shaka Airport NEC3 contract
(`KSIA8233/2026/RFP`) that independently reproduces the SAME underlying false-positive shape for
`contractor.project_manager` (its own NEC3 ECC defines "the Project Manager" as the Employer's own
contract administrator in clause 10.1, then uses the bare term 126 times for contract
administration) but happens to land on the right overall answer anyway, since a genuine separate
ask exists at clause 2.7 ("The Contractor shall appoint a dedicated Project Manager as the single
point of contact...") - the role is correctly flagged, but the representative "quote" shown is the
misleading NEC3-administrator one (about payment certification to subcontractors), not the real
evidence. Noted as the same root cause as Finding 47, not a second finding.

**Phase 2 running total: 7 batches, ~101 real tenders sampled. 4 confirmed bugs found (Findings 40,
42, 44, 47 - 3 fixed, 1 confirmed-real-but-flagged-not-fixed pending a buyer-name-aware
redesign), plus several confirmed-correctly-handled edge cases this batch specifically (thin
adverts beyond a single page, buyer-regret-letter-only listings, scanned documents, a mixed
buyer-reference + genuine-ask document landing on the right answer for the wrong displayed
reason).**

### Finding 48 (CONFIRMED, FIXED, moderate - a general-pack experience-recency check could pass stale evidence)

**Where:** `engine/general/process_general_jobs._within()`, the filter the general (non-SANRAL)
pack bridge applies to every Experience Library row before offering it as evidence for a tender's
`window_years` recency rule (e.g. "only projects completed in the last 5 years"). When the
tender's own `closing_date` is missing or unreadable, `_within()` falls back to "today" as the
reference point (Finding 9c, an earlier pass) - but it got "today" from this module's own `_now()`
helper, which is `datetime.datetime.now(datetime.timezone.utc)`: the same naive-UTC-"today" bug
class this session already fixed in `fill_a_forms.py`/`fill_sbd_docx.py`/`generate_cv.py`/
`pdf_merge.py`/`process_pack_jobs.py` (Findings 37-39), just not yet swept in `engine/general/`.
During the 00:00-01:59 SAST window (22:00-23:59 UTC the day before - worker containers have no TZ
set, so `datetime.now(utc)` is correct UTC but SAST is UTC+2), `_now()`'s calendar day is one day
behind the real SAST day.

**What was tested:** called the real `process_general_jobs._within()` (not a reimplementation)
with `closing=None` (a tender with no closing date on file - plausible: `tenders.closing_date` is
nullable in `0001_init_schema.sql`/`0004_discovery.sql`), a `{"window_years": 5}` rule, and an
Experience Library row dated `2021-10-20`, with `datetime.datetime.now` mocked to
`2026-10-20T22:30:00+00:00` (= 00:30 SAST on 2026-10-21). Real SAST "today" is 2026-10-21, so a
5-year window's cutoff is 2021-10-21 - this row is genuinely one day too old and should be
excluded. Before the fix: `_within()` returned `True` (included) - `_now()`'s UTC-today
(2026-10-20) put the cutoff at 2021-10-20, exactly on this row's date, so `comp_day < cutoff` was
False. After the fix: `False`, correctly excluded.

**Why this is the opposite direction from Findings 37-39, and still real:** those findings were
about a compliance warning silently going missing (document shown as current when it had
expired). This one is a company's own submitted pack being allowed to cite experience evidence
that is actually outside the tender's own recency requirement as if it were inside it - a
compliance-risk-in-the-other-direction, surfaced only in a roughly 2-hour daily window and only
for tenders with no closing date recorded plus a `window_years` rule, which is why it reads
"moderate" rather than "severe" like Finding 37's (narrower combination of conditions, but a real,
reachable one, not contrived).

**Fix:** `_now()` itself is untouched - it is also used to timestamp real DB rows
(`downloaded_at`/`analysed_at`/`started_at`/`completed_at`), where the correct value is a true UTC
instant, not a shifted one, so changing it there would have been its own new bug. Added a local
`SAST = datetime.timezone(datetime.timedelta(hours=2))` constant (same per-file convention as
`watch_deadlines.py`, not a cross-directory import) and changed only `_within()`'s own "today"
fallback to `datetime.datetime.now(SAST).date().isoformat()`.

**Verified the test actually catches the regression:** `engine/general/test_process_general_jobs.py`
got a new `test_within_missing_closing_date_uses_real_sast_today_not_naive_utc()` (plus a second
check that an item exactly on the real cutoff day stays included, so the fix didn't over-correct).
Reverted `process_general_jobs.py`'s diff (`git stash`), re-ran: the new check failed with exactly
the predicted wrong `True`, the rest of the suite (including the pre-existing `fail_stale_jobs()`
test) stayed green; restored the fix (`git stash pop`), re-ran: `0 failure(s)`. Also re-ran
`test_general_bridge.py`, `test_requirements.py`, and `test_submission_plan.py`: all still pass
(no interaction with the private-document-path / role-classification / submission-plan-status
logic those cover).

### Finding 49 (CONFIRMED, FIXED, moderate - a real, client-facing generated CV could print the literal word "None")

**Where:** `engine/cv/generate_cv.build_world_bank()`'s project/employment-record rendering.
`proj.get("start", "?")`, `proj.get("end", "?")`, `proj.get("value_rm", "?")` and
`proj.get("contact", "MISSING")` - the Python `dict.get(key, default)` default only substitutes
when the key is *absent*, never when it's present with value `None`. `start_date`, `end_date`,
`value_rm`, `contact_name` and `contact_phone` are all nullable columns on `projects`
(`0001_init_schema.sql`) - adapted straight through by `process_cv_jobs.adapt_project_row()` with
the same keys and the same `None`s, unchanged. The sibling builder in the same file,
`build_sanral_keyperson()` (same file, same project rows, just above this one), already guards
the identical fields with `proj.get("start", "") or ""` for exactly this reason - this one didn't.

**What was tested:** called the real `build_world_bank()` (not a reimplementation) with one
project shaped like the single most common real case - an ongoing assignment with no end date yet
(`end: None`), plus a referee and a contract value not yet captured (`value_rm`/`contact`/
`contact_phone: None`). Before the fix, the generated World Bank CV's employment-record paragraph
read: `"2022-01-01 to None  —  Ongoing Project A/2022\nPosition: Site Engineer    Value:
RNonem\nReferee: None  None"` - the literal word "None" appearing three times in a document meant
to go to a real buyer, for the ordinary case of a person's current, still-running project (true
for most currently-employed key people, not an edge case).

**Fix:** matched `build_sanral_keyperson()`'s own existing pattern - `proj.get("start") or "?"`,
`proj.get("end") or "?"`, an explicit `is not None` check for `value_rm` (0 is a legitimate value,
not "missing"), `proj.get("contact") or "MISSING"`, `proj.get("contact_phone") or ""`.

**Verified the test actually catches the regression:** new
`test_world_bank_project_with_null_fields_does_not_print_the_word_none()` in
`engine/cv/test_generate_cv.py`. Reverted the fix (`git stash`): both the "not 'None'" checks
failed, showing exactly the predicted `"...to None...RNonem...Referee: None  None"` string;
restored it: `0 failure(s)`. Full `test_generate_cv.py` (8 test functions) and
`test_extract_cv_fields.py` both clean.

**Also checked this pass, no bug found:** `engine/cv/process_cv_jobs.py`'s job-isolation (`claim_job`/
`fail_stale_jobs`/`process_job`/`poll_once`) - each CV job is already wrapped in its own
try/except with a company-scoped, security-checked job context (POPIA cross-company read guard,
confirmed against `0043`'s own DB-level check), and an unexpected `job["format"]` value (the
`{"sanral_keyperson": ..., "world_bank": ...}[fmt]` lookup has no DB CHECK constraint behind it)
already fails just that one job cleanly rather than the whole bridge, by the same per-job
try/except. `claimed_at`'s `fromisoformat()` parse is unguarded but always fed a value this same
code just wrote with `_now_iso()`, never client-supplied, so it can't actually receive a malformed
string.

### Finding 50 (CONFIRMED, FIXED, severe - a brand-new deadline-reminder email could silently never reach every company but one, for any tender tracked by more than one company)

**Where:** `app/scripts/send-deadline-reminders.ts` (the "closing in 3 days / 24 hours" email,
landed this same batch alongside PayFast/Resend) + `supabase/migrations/0079_sent_deadline_reminders.sql`'s
`sent_deadline_reminders` table and `record_deadline_reminder_sent()` function.

**What was tested:** `tenders` is the SHARED/PUBLIC table (`0001_init_schema.sql`'s own split -
one daily-discovery feed serves every tenant) and `tender_packs` is `unique (company_id,
tender_id)`, not `unique (tender_id)` - so more than one unrelated company routinely tracks the
exact same public tender. The script's query (`tenders.select(..., tender_packs!inner(company_id))`)
is a has-many embed: `tender.tender_packs` comes back as the array of EVERY company tracking that
tender. The script read only `tender.tender_packs[0].company_id` and called
`record_deadline_reminder_sent(tender_id, threshold)` once per TENDER - and 0079's own dedupe
table had `unique (tender_id, threshold_days)`, with no `company_id` at all. Reproduced against a
real local Postgres fixture matching 0079's exact schema (not a mock): seeded 2 real companies
each with their own `tender_packs` row for the same tender, called
`record_deadline_reminder_sent()` for the first - `true` (claims it) - then called it again for
the same tender+threshold (what the second company's own claim attempt would do) - `false`
("already sent"). The second company's 3-day/24-hour reminder would never fire, for either
threshold, for as long as that tender stays open - not a corner case, the ordinary shape of this
product's own multi-tenant discovery feed.

**Why severe despite shipping with `RESEND_API_KEY` never set (so nothing has actually misfired
yet):** `.github/workflows/deadline-reminders.yml` is already scheduled daily; the moment that key
is added (which this exact batch's PayFast/Resend work makes imminent), every company sharing a
tracked tender with another company silently loses this notification, permanently, per tender -
with no `system_alerts`-style alerting at all to surface it (this script only `console.error`s,
which nobody watches on a scheduled Action unless it exits non-zero, and this bug never makes it
exit non-zero).

**Fix:**
1. New `supabase/migrations/0080_sent_deadline_reminders_per_company.sql`: adds `company_id` to
   `sent_deadline_reminders`, re-scopes the unique constraint to `(tender_id, company_id,
   threshold_days)`, and recreates `record_deadline_reminder_sent()` with a `p_company_id`
   parameter. A pre-existing row (company_id NULL) is deleted rather than guessed at, per this
   project's own "never guess" rule - confirmed necessary by applying the migration against a
   fixture with a pre-existing row first (`alter ... set not null` failed loudly, as it should).
2. Extracted the fan-out itself into a new, pure, unit-testable `deadlineReminderCandidates()` in
   `lib/deadlineReminders.ts` (one entry per `(tender, company, threshold)`, not per tender), and
   simplified `send-deadline-reminders.ts` to call it instead of its own inline filter/map chain.

**Verified the regression test actually catches the bug:** new tests in
`lib/deadlineReminders.spec.ts`. Reverted `deadlineReminderCandidates()` to the exact old `[0]`
logic: the "not just the first" test failed with exactly the predicted `["company-a"]` instead of
`["company-a", "company-b"]`; restored it: all 4 tests pass. Separately, verified the DB-level fix
end to end against a real local Postgres (not just the TypeScript logic): applied 0079's exact
schema, reproduced the second company's claim being blocked (`false`), applied 0080 on top
(including the pre-existing-row delete path), and confirmed both companies can now independently
claim + a re-claim of the same (tender, company, threshold) still correctly stays blocked.

**Regression:** full app test suite (`npx vitest run`): 8 files, 77 tests, all pass.
`npm run typecheck` (full repo) and `eslint` on every touched file: clean.

### Finding 51 (CONFIRMED, FIXED, severe - a genuinely successful PayFast payment could be charged and then silently never activate the subscription)

**Where:** `supabase/migrations/0078_company_subscriptions.sql`'s `start_payfast_checkout()` /
`apply_payfast_itn()` pair, landed this same batch as Finding 50's deadline-reminder work. This
is the exact function the migration's own header comment calls "the one place in this piece of
work where correctness really matters (money-adjacent)".

**What was tested:** `company_subscriptions` has `payfast_m_payment_id text unique` - ONE slot per
company, overwritten unconditionally on every `start_payfast_checkout()` call, on the documented
assumption that PayFast resends the SAME id on every recurring ITN. Nothing stops a second
checkout before the first payment's ITN lands: `app/billing`'s `CheckoutLink` is a plain `<Link>`
with no debounce and no "checkout in progress" state (confirmed by reading it), and PayFast ITNs
are asynchronous by design (the route handler's own header comment: "PayFast expects a 200
response and retries on anything else"). Reproduced against a real local Postgres running 0078's
exact functions (not a mock): seeded one company, called `start_payfast_checkout('pro', ...)` ->
payment A, then called it again (`'sanral_pro'`, simulating a double-click or a retry before A's
ITN arrived) -> payment B, which overwrote `payfast_m_payment_id`. Payment A's own ITN then
arrived with `payment_status=COMPLETE` (a real, successful charge) - `apply_payfast_itn()` raised
`no subscription pending for this m_payment_id`, and the row stayed `status='trialing'`. The
customer's card was genuinely charged; the subscription never activated.

**Why severe:** there is no `system_alerts`-equivalent anywhere in the TypeScript codebase
(confirmed by grep before writing this up) - the route handler only `console.error`s and still
returns 200 (so PayFast never retries, believing the notification was received). A real charge
with no activated subscription had **zero visibility anywhere in the product**, not even a log
line anyone is likely to watch on a deployed Vercel app.

**Fix:** new `supabase/migrations/0081_payfast_payment_attempts.sql` - an append-only
`payfast_payment_attempts` table (company_id, m_payment_id, created_at) that `start_payfast_checkout()`
now also writes to (in addition to, never instead of, the existing overwrite). `apply_payfast_itn()`
falls back to this log when the primary UPDATE finds no row, but **only for a `COMPLETE`
(successful) notification** - a stale `FAILED` notification for an abandoned, superseded attempt
is deliberately left alone, since it carries no information worth acting on once the company has
moved on, and rescuing it could wrongly downgrade an already-active paying customer whose later
attempt already succeeded. Both functions keep their exact existing signatures - zero changes
needed in `app/api/billing/payfast/itn/route.ts` or `app/api/billing/checkout/route.ts`.

**Verified against a real database, not just by inspection** (migration applied cleanly on top of
a fixture replicating 0078's exact schema): (1) reproduced the bug pre-fix as above; (2) applied
0081, re-ran the identical two-checkout race, confirmed payment A's `COMPLETE` ITN now correctly
sets `status='active'` with the right `payfast_token`, while `payfast_m_payment_id` stays
correctly pointed at payment B (not corrupted); (3) ran payment B's own `COMPLETE` ITN
afterwards - also applied correctly; (4) sent a late, stale `FAILED` notification for the long-
abandoned payment A - confirmed the already-`active` subscription (now on payment B) was left
completely untouched, proving the "don't rescue a stale failure" safety rule actually holds.

**Regression:** no TypeScript file changed (the fix is entirely in the SQL migration layer, by
design, to keep the blast radius contained) - full app suite (`npx vitest run`): 8 files, 77
tests, unchanged and still passing.

### Finding 52 (CONFIRMED, FIXED, moderate - closes the residual edge case a sibling pass flagged after Finding 51)

**Where:** `apply_payfast_itn()`'s rescue path (migration `0081`, Finding 51). A sibling's
independent standing-review verification of that fix (commit `df0892b`) read the actual function
bodies (not just the commit message) and flagged a real residual gap, explicitly deferred rather
than fixed on that pass: "the rescue path updates status/payfast_token/current_period_end but
never touches payfast_m_payment_id itself. If a company starts checkout A (plan X), then checkout
B (plan Y) before A's ITN arrives, and A's COMPLETE ITN is rescued, the subscription activates -
but still under whatever plan company_subscriptions currently holds (B's selection)... If B then
fails, apply_payfast_itn() would set past_due even though A's payment genuinely succeeded."

**What was tested:** reproduced both halves against a real local Postgres running 0081's exact
functions (not a mock, not just re-reading the SQL): started checkout A for 'pro'/'monthly',
started checkout B for 'sanral_pro'/'yearly' before A's ITN arrived, delivered A's own `COMPLETE`
ITN. Confirmed half 1 live: the subscription activated showing `sanral_pro`/`yearly` - the plan
the customer did NOT pay for - while the plan they actually paid for ('pro'/'monthly') was nowhere
recorded. Then delivered B's own later `FAILED` ITN and confirmed half 2 live: the subscription
was downgraded to `past_due`, even though A's payment had genuinely succeeded and was still
sitting there, unresolved and now invisible.

**Fix:** `payfast_payment_attempts` (0081) gains `plan_tier`/`billing_interval` columns, recorded
once at checkout time by `start_payfast_checkout()` (mirroring exactly what that attempt wrote to
`company_subscriptions` at that moment - never changed afterward). The rescue path in
`apply_payfast_itn()` now restores THIS attempt's own recorded plan (not whatever a later,
still-unresolved attempt has since set) and - the key change - reclaims `payfast_m_payment_id`
for the attempt it's rescuing. That second part closes half 2 for free: once reclaimed, a later
`FAILED` notification for the attempt it superseded (B) no longer matches the primary `UPDATE...
where payfast_m_payment_id = p_m_payment_id` at all, so it falls through to the same fallback path
- which (unchanged from 0081) only ever rescues a `COMPLETE`, never a `FAILED` - and is correctly
ignored.

**Verified against a real database, all four scenarios, not just the two the sibling named:**
applied migration `0082` on top of the same fixture; re-ran the identical two-checkout race -
rescuing A's `COMPLETE` now correctly shows `pro`/`monthly`/`active` with `payfast_m_payment_id`
reclaimed back to A; B's own later `FAILED` ITN no longer matches and is correctly ignored
(subscription stays untouched at `pro`/`monthly`/`active`). Also re-confirmed Finding 51's own two
original scenarios still hold under the new logic: both A and B eventually succeeding still ends
with whichever one resolved LAST correctly "winning" (consistent, not a regression); and a late,
stale `FAILED` for an attempt that's been properly superseded by a later SUCCESS stays correctly
ignored.

**Regression:** no TypeScript file changed (same contained, SQL-only blast radius as Finding 51)
- full app suite (`npx vitest run`): 8 files, 77 tests, unchanged and still passing.

### Finding 53 (CONFIRMED, FIXED, severe - the brand-new per-plan bid-pack quota could be bypassed entirely by requesting faster than a worker finishes)

**Where:** `company_can_request_pack()` / `company_packs_this_period()`, migration `0083`'s own
usage-gating functions, landed this same batch as the new Starter/Professional/Business pricing -
the one gate `requestSubmissionPack()` (`app/tenders/[id]/actions.ts`) and `requestJob()`'s
`generate_pack` path (`app/tenders/[id]/general-actions.ts`) check before inserting a new
`pack_generation_jobs` row.

**What was tested:** `pack_generation_jobs.status` is `'requested' | 'generating' | 'ready' |
'failed'` - a job sits in `requested`/`generating` between being inserted and actually finishing,
asynchronously (the pack bridge workers poll every ~30s - `poll_loop.py`'s own default interval -
and a real SANRAL/general pack can take meaningfully longer than that). Both gating functions
counted ONLY `status = 'ready'` rows - a job still in flight was invisible to the gate, which kept
answering "yes, you may request another" for every request made before the FIRST one ever
completed. `requestSubmissionPack()` already blocks a second request for the SAME tender while
one is queued, but nothing stops requesting DIFFERENT tenders' packs in a row - an entirely
ordinary thing to do, not a contrived attack. Reproduced against a real local Postgres running
`0083`'s exact functions (not a mock): a `trialing` company (one pack total, ever) requested packs
for 5 different tenders in a row - `company_can_request_pack()` returned `true` all 5 times, and
all 5 rows were inserted. The identical reproduction against an `active` Starter plan (5
packs/month) let 8 requests through.

**Why severe:** each of these jobs is real, chargeable work once a worker claims it (LibreOffice
merging, Anthropic API calls for CV generation) - this is a direct cost-control and quota-bypass
gap on the exact feature the new pricing tiers (`0083`) exist to meter, reachable with completely
ordinary usage (pursuing several tenders at once), not a timing attack.

**Fix:** new migration `0084_pack_quota_counts_in_flight_jobs.sql` - both functions now count
`status in ('requested', 'generating', 'ready')`, excluding only `failed` (a failed job produced
nothing and shouldn't cost the company its quota - same "never penalise the user for a system
failure" rule this project already applies everywhere else, e.g. every engine bridge's
`fail_stale_jobs()`).

**Verified against a real database, including that the fix doesn't over-correct:** re-ran both
flood scenarios after applying `0084` - the trial company now gets exactly 1 pack allowed (request
2-5 correctly blocked), the Starter-plan company gets exactly 5 (requests 6-8 correctly blocked).
Then confirmed a legitimate retry still works: marking the trial's one job `failed` immediately
re-opened `company_can_request_pack()` to `true`; marking one of the Starter company's 5
`requested` jobs `ready` and another `failed` still correctly allowed a 6th request (1 ready + 3
still requested = 4 counted, under the cap of 5) - a worker failure never locks a company out of
its own quota.

**Regression:** no TypeScript file changed (same contained, SQL-only blast radius as Findings
51/52) - full app suite (`npx vitest run`): 8 files, 80 tests, unchanged and still passing.

### Finding 54 (CONFIRMED, FIXED, moderate - the PayFast signature test suite was not isolated from the real environment's own secrets)

**Where:** `app/lib/payfast.spec.ts`'s `verifyItnSignature` tests - including the one that
reproduces PayFast's own official recorded ITN signature fixture from their open-source SDK's test
suite (the strongest available confirmation that this file's byte-for-byte PHP-`urlencode`
encoding is correct).

**What was tested:** `verifyItnSignature()` reads `payfastPassphrase()`, which reads
`process.env.PAYFAST_PASSPHRASE` directly - every fixture in this test file (including PayFast's
own real recorded signature) was computed assuming NO passphrase, matching PayFast's sandbox
default. None of the tests isolate themselves from the ambient environment. Caught live, not
hypothetically: this session's own environment has a real, non-empty `PAYFAST_PASSPHRASE`
configured (along with a real-looking `merchant_id`/`merchant_key` distinct from PayFast's generic
published test credentials - almost certainly a real PayFast *sandbox merchant* account Sarel
registered, not the shared universal test account) - running `npx vitest run` on main, as-is,
failed 2 of `payfast.spec.ts`'s 11 tests, including the PayFast-SDK-fixture one, purely because
the test never cleared the real passphrase before asserting against a no-passphrase fixture. Not a
code bug in `verifyItnSignature()` itself - the production code correctly uses whatever passphrase
is actually configured - but a real test-isolation gap that would give a false failure in ANY
environment with a real sandbox passphrase set (a developer's own `.env.local`, or any CI
pipeline that happens to inject these secrets), exactly the kind of thing that wastes real time
chasing a "regression" that isn't one.

**Checked whether this currently breaks the real GitHub Actions CI:** read `.github/workflows/
app-ci.yml` in full - its own header comment states "All of it secret-free... no Supabase env
vars", and the workflow declares no `env:`/`secrets:` block at all, so GitHub Actions injects
nothing into `process.env` for this job. Confirmed this is NOT currently failing real CI - it is
specific to any environment (like this one) that has real PayFast secrets configured for other,
legitimate reasons (manual sandbox testing, engine scripts).

**Fix:** `payfast.spec.ts` now stubs `PAYFAST_PASSPHRASE` to empty via `vi.stubEnv()` in a
`beforeEach`, restored via `vi.unstubAllEnvs()` in `afterEach` - standard Vitest env isolation, so
this suite's own correctness never depends on what a given machine happens to have configured.

**Verified the fix actually isolates, not just happens to pass once:** reverted `payfast.spec.ts`
(`git stash`): the exact same 2 failures reappeared against this environment's real passphrase;
restored the fix: `11/11` pass. Full app suite (`npx vitest run`): 8 files, 80 tests, all pass.
`npm run typecheck` and `eslint` on the touched file: clean.

### Finding 55 (CONFIRMED, FIXED, severe - real CI was red on `main` for 3 consecutive pushes)

**Where:** `app/app/_components/document-intake/uploadBatch.ts` (spec v3 Batch 2's new shared
upload engine) used the `@/lib/...` path alias to import `createClient`/`safeFileName` - a Next.js
tsconfig path mapping that only the bundler understands, not plain Node.

**What was tested:** `.github/workflows/app-ci.yml`'s own "Run every `*.test.ts` file directly"
step runs each file with `node --experimental-strip-types "$f"`, no bundler - the exact constraint
`lib/deadlineReminders.ts`'s own header comment already documents for this project
("scripts/send-deadline-reminders.ts ... needs to import this constant, and lib/notifications.ts
has its own ... import that direct node execution can't resolve"). `uploadBatch.test.ts` imports
only pure functions from `uploadBatch.ts`, but importing ANY name from a module makes Node
evaluate the whole file - including its top-level `import { createClient } from "@/lib/supabase/client"`,
which Node's own resolver can't follow at all (`Cannot find package '@/lib'`). Checked the real
GitHub Actions history (not assumed): `app-ci` was `conclusion: "failure"` on the last 3 pushes to
`main` (runs #114, #115, #116 - "Spec v3 Batch 2" onward), each failing on this exact file with
this exact error, confirmed by pulling the real job log.

**Fix:** changed `uploadBatch.ts`'s two imports to plain relative imports with explicit `.ts`
extensions (`../../../lib/supabase/client.ts`, `../../../lib/onboardingScan.ts`), matching the
convention every other currently-passing `*.test.ts`-covered module in this repo already follows
(e.g. `general-pack-review-logic.test.ts` imports `"./pack-review-logic.ts"` the same way).

**Verified by replicating every real CI step locally, not just the one that was failing:**
`npm run typecheck` (clean), `eslint` on the touched file (clean), every one of the 13
`*.test.ts` files run individually via `node --experimental-strip-types` (all 13 pass, including
`uploadBatch.test.ts`'s own 5 tests), the full `npx vitest run` (11 files, 115 tests, unchanged),
and `npm run build` (completes cleanly).

**Why severe despite being a one-line import fix:** this is real CI, genuinely red on `main`
right now (not a hypothetical or an environment-specific false failure like Finding 54) - every
push since "Spec v3 Batch 2" landed has been failing the one check that's supposed to catch
exactly this kind of regression before it reaches `main`.

### Finding 56 (CONFIRMED, FIXED, severe - a chunked SANRAL award backfill resume could silently skip an entire list's worth of pages)

**Where:** `engine/discovery/store_award_outcomes.py`'s `main()` - the CLI driving a fresh,
heavily-iterated resumable-backfill feature (4 commits in a row this same day fixing edge cases
in `award_outcomes.fetch_sanral_list()`/`fetch_sanral_outcomes()`'s own per-list resume cursor:
a silent 2,000-row cap, exact next-page tracking, overshoot-row handling). `--sanral-start-page`
resumes a chunked backfill from a given page instead of always re-reading the newest tender -
built and tested per-list (`--sanral-lists closed` alone), but `--sanral-lists` defaults to
`"awarded,closed"` (BOTH lists together), and the CLI applied the SAME `--sanral-start-page` to
every list named, via one dict comprehension: `{k: ao.fetch_sanral_outcomes(k.strip(),
args.sanral_limit, start_page=args.sanral_start_page) for k in args.sanral_lists.split(",") ...}`.

**What was tested:** `"awarded"` and `"closed"` are two completely independent, differently-sized
SANRAL lists (the closed list alone holds 5,546 tenders), each with its own pagination. Confirmed
live (mocking only the network-touching `fetch_sanral_outcomes`, not reimplementing any logic):
running the CLI's own real argument-building code with `--sanral-start-page 41` (resuming a
"closed"-list chunk, the whole reason this flag exists) and the DEFAULT `--sanral-lists` called
`fetch_sanral_outcomes("awarded", ..., start_page=41)` AND `fetch_sanral_outcomes("closed", ...,
start_page=41)` - the exact same cursor applied to both. Whichever list the operator meant to
resume gets the right page; the OTHER list silently skips however many of its own pages sit
before page 41, a gap no later chunk would ever cover (since every later chunk's own start_page
is chosen relative to whichever list's progress the operator is actually tracking).

**Why severe:** this is the exact "silent gap" bug class the SAME commit chain was built and
re-fixed four times in a row to eliminate elsewhere in this identical code path - just one layer
up, at the CLI argument level rather than inside the pagination logic itself. A full backfill of
the 5,546-tender closed list is explicitly the scenario `--sanral-start-page` exists for (a single
run "risks losing all of it if interrupted" per the commit that added it), and the default
`--sanral-lists` value makes this the easy, unmarked path, not a contrived misuse.

**Fix:** refuse the ambiguous combination outright - `--sanral-start-page != 1` with more than one
list named in `--sanral-lists` now raises a clear `SystemExit` naming the exact problem and what
to do (resume one list per run), rather than silently applying one list's cursor to another.

**Verified the regression test actually catches the bug:** new
`test_sanral_start_page_is_refused_for_more_than_one_list()` in
`engine/discovery/test_award_prices.py` (3 checks: the ambiguous combination is refused with zero
network calls made at all; a single named list still resumes correctly; the unresumed default -
both lists from page 1 - is unaffected). Reverted the fix (`git apply -R`), re-ran: the refusal
check failed exactly as predicted (no `SystemExit`, the run instead failed later for an unrelated
reason, proving the guard clause itself was gone); restored the fix: `0 failure(s)`. The test
mocks `fetch_sanral_outcomes` for every call it makes, including the one expected to be refused
before reaching that function, so it can never hit the real SANRAL site regardless of code state -
confirmed necessary the hard way: an earlier, less-isolated version of this same test accidentally
triggered real unmocked network calls against the live SANRAL site during its own revert-check,
caught and stopped mid-run, then rewritten to mock unconditionally.

**Regression:** full `test_award_prices.py` (Part 1, offline): all checks pass.
`test_discovery_fanout.py` and `test_gov_sources.py`: both clean, unaffected.

### Finding 57 (CONFIRMED, FIXED, severe - a real open-redirect bypass in the post-login/signup redirect, and a redirect sink with no validation at all)

**Where:** three places reading a redirect target from user-controlled input, each with its own
incomplete guard, plus one actual redirect SINK with no guard at all:
`app/app/login/page.tsx` / `app/app/signup/page.tsx`'s `nextParam()` (a `?next=` query param, used
in `router.push()` after email/password login and passed into the OAuth `redirectTo` URL),
`app/app/company/document-scan/actions.ts`'s `backTo()` (a hidden `return_to` form field, added
this same day for Spec v3 Batch 4's `/experience` upload wiring), and `app/app/auth/callback/route.ts`
(the OAuth callback - the actual `NextResponse.redirect()` call right after a real sign-in
succeeds), which read `next` straight off the query string with **zero validation**.

**What was tested:** the three guarded call sites all checked only `value.startsWith("/")`
(`actions.ts`'s own comment explicitly calls this "an open-redirect guard" - the intent was
right, the implementation wasn't complete). Every real browser implements the WHATWG URL spec's
"a backslash is treated as a path separator for a special scheme" rule - confirmed directly with
Node's own WHATWG-compliant URL parser (the identical algorithm Chrome/Firefox/Safari use):
`new URL("/\\evil.com", "https://tender-ready.vercel.app").href` is `"https://evil.com/"`, not a
same-origin path. `"/\\evil.com"` passes `value.startsWith("/") && !value.startsWith("//")` (it
starts with one `/`, not two) - every one of the 3 "guarded" call sites would have accepted it.
The 4th site (`/auth/callback`) had no check at all, so a plain `"@evil.com"` (the classic
userinfo-authority trick: `new URL("https://origin@evil.com/")` navigates to `evil.com`, confirmed
the same way) would have passed straight through there too.

**Why severe:** `next`/`return_to` on `/login`, `/signup` and the OAuth callback is the single
highest-value real-world open-redirect target - a crafted link sends a victim through a genuine
sign-in (or signup) on the real site, then redirects their already-authenticated browser straight
to an attacker's phishing page immediately afterward, trading on the trust of having "just signed
into Tender Ready."

**Fix:** new shared `lib/safeRedirect.ts` (`isSafeRedirectPath`/`safeRedirectPath`), matching the
same "one shared helper, not N independently-drifting inline copies" convention this project
already uses for `safeFileName.ts`. The check is `/^\/(?!\/|\\)/` - exactly one leading `/`, next
character neither `/` nor `\`. Applied at all 4 sites, including `/auth/callback` (which had none
before) - a redirect SINK validating its own input is defense in depth, not redundant, the same
discipline this project already applies to path-traversal checks.

**Verified the regression test actually catches the bug:** new `lib/safeRedirect.spec.ts` (8
checks: ordinary paths accepted, bare root accepted, protocol-relative rejected, the backslash
bypass rejected in 3 forms, the no-leading-slash/`@`-trick cases rejected, empty/null/undefined
rejected). Reverted `isSafeRedirectPath()` to the exact old `startsWith("/") && !startsWith("//")`
check: 2 of 8 tests failed with exactly the predicted backslash-bypass value passing through;
restored the fix: `8/8`. Full app suite (`npx vitest run`): 12 files, 129 tests, all pass. `npm run
typecheck`/`lint`: clean (0 errors). Every `*.test.ts` file run the same way CI runs them: clean.
