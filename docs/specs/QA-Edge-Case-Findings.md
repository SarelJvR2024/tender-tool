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
