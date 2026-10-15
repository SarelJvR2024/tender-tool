# Tender compilation playbook: process, specs & requirements

Master reference for building the full automation. Everything in this document was
exercised for real on R.334-030-2025/1F across three rounds (2026-10-15) - it is a
record of what the pipeline actually does today, not an aspirational design. Where a
step is still manual, that's stated explicitly rather than glossed over.

Companion documents, not duplicated here:
- `SANRAL-Tender-Automation-Specification.md` - the file-format internals (cell
  addresses, raw-XML editing rules, verification checklist definitions V1-V12).
- `tender-pack-checklist.md` - the generic returnable-documents list confirmed from
  real 2026 submissions.
- `financial-submission-workbook.md` - Financial Submission workbook structure.
- `sample-pack-r334-030-2025-1f.md` / `audit-r334-030-2025-1f.md` - the specific run
  this playbook was extracted from, with every finding and bug caught along the way.

## 1. The end-to-end pipeline, in order

| # | Step | Script | Input | Output |
|---|---|---|---|---|
| 0 | Daily discovery - list all open SANRAL tenders, detect new/changed ones, surface document downloads for those | `engine/discovery/run_discovery.py` (orchestrates `list_tenders.py`, `detail.py`, `download_documents.py`) | `config/contact.json` (submitter identity for SANRAL's download form), `state/discovery_state.json` (diff baseline) | **The list/detail/diff part is fully automated** (confirmed working on a real VPS, 2026-10-15: 137 tenders fetched, diffed cleanly). **The actual document download is NOT automatable** - see the reCAPTCHA finding below. Default behaviour now prints direct manual-completion links for new/changed tenders instead of attempting the form |
| 1 | Fingerprint check - confirm the downloaded template matches a known family/baseline before touching it | `engine/fingerprint.py` | The downloaded `.xlsm` | Pass/fail + a stored baseline in `fingerprints/` if new |
| 2 | Build the data pack - the one YAML file that drives everything else | **Automated, 2026-10-15**: `engine/pack_generator/suggest_pack.py` + `confirm_pack.py`. Reads required positions straight from the template's own `SETUP` sheet, scores every candidate on file against each position (keyword overlap, flags unevidenced specialisms), computes experience dynamically from each candidate's qualification date rather than trusting a stored number. Never decides on its own - `confirm_pack.py` refuses to produce a pack unless a named human has written an explicit `confirmed_person` for every position | `config/klipcorp_profile.json` + the template's own `SETUP` row 6 (positions) and `C3` (closing date) + a human's written confirmation | `pack_suggestions.md` (for review) -> human edits `pack_selections.yaml` -> `pack.yaml` |
| 3 | Fill Technical Submission | `fill_conventional.py` (Conventional family) or `fill_tender.py` (RRM family) | Real blank `.xlsm` template + the pack | `<contract>_FILLED.xlsm` |
| 4 | Verify Technical Submission | `print_reports.py` + manual PDF render/visual check | The filled `.xlsm` | V1-V10 pass/fail report (see §6) |
| 5 | Fill Financial Submission (mechanical fields only - company name, key-person names) | `fill_financial.py` | Real blank Financial `.xlsm` + the pack | `<contract>_Financial_FILLED.xlsm` (hours/pricing sheets untouched) |
| 6 | Fill docx returnable schedules: C.1.1.1 (Form of Offer), C.1.2.3 (Contract Data), A18 (bank details) | `fill_docx_forms.py` | Real per-contract blank `.docx` templates (downloaded fresh per tender - headers/NRA numbers differ) + `klipcorp_profile.json` | `*_FILLED.docx` files |
| 7 | Compile Form B6 (past performance) - match each cited project to its real signed client performance report | manual research this round; a matcher script is the next automation target | `klipcorp_profile.json` project list + Drive search for signed Annex 4/PSP performance reports | `B6_past_performance_compilation.md` (status per project: confirmed / unconfirmed / missing) |
| 8 | Build B4 (quality systems) and B5 (programme) skeletons | manual this round | Confirmed contract facts (scope, dates, positions) from the tender itself | `B4_quality_systems_SKELETON.md`, `B5_programme_SKELETON.md` with `[NEEDS INPUT]` markers - never fabricated content |
| 9 | Generate A2 authority-of-signatory letter on letterhead | `fill_authority_letter.py` | `klipcorp_profile.json`, `assets/klipcorp_logo.png`, this tender's contract no/NRA ref/description | DRAFT `.docx` + rendered `.pdf`, blank signature line |
| 10 | Generate envelope covers (Outer, Technical, Financial) | `make_envelope_covers.py` | Same as above + real closing date (read from `SETUP!C3`) | 3x `.docx` + `.pdf` |
| 11 | Audit / cross-check pass - re-verify every filled field against requirements and against every OTHER filled field for internal consistency (names, titles, dates must all agree across every document) | manual this round, following the same method each time: open every output, read field-by-field, diff against source | All outputs from steps 3-10 | Findings doc, e.g. `audit-r334-030-2025-1f.md` |
| 12 | Human review & signature | **always manual, by design** | Printed/reviewed pack | Signed originals |
| 13 | Physical/electronic submission | **not attempted, not automated** | Signed pack | Submitted tender |

## 1a. Confirmed, closed: the document download form cannot be automated

Tested live on real infrastructure, 2026-10-15 - not a guess, a closed investigation:

- **Original finding** (earlier round): the shared sandbox IP got reCAPTCHA v3's "invalid
  source" rejection. Hypothesis at the time: a bad IP reputation on a shared/known-automation
  IP range; a dedicated clean IP should fix it.
- **Disproven**: provisioned a dedicated VPS specifically to get a clean IP. Same exact
  rejection, word for word, on every one of 6 real tenders.
- **Second hypothesis tested**: headless Chromium has a detectable fingerprint; try headed
  mode. Required installing `xvfb` (no X server on a headless VPS) to even launch headed
  Chromium. Same exact rejection again.
- **Conclusion**: the common factor across every failure is that Playwright controls the
  browser via CDP, which sets `navigator.webdriver = true` - one of the most basic signals
  any bot-detection system checks, independent of IP and independent of headless/headed. This
  is reCAPTCHA v3 correctly identifying real automation, not a bug to patch around.
- **Decision**: not pursued further. The standard fixes (stealth plugins suppressing
  `navigator.webdriver`, residential proxy rotation, browser-fingerprint spoofing) exist
  specifically to disguise automated traffic as human - that is out of scope for this
  project, full stop, regardless of how close it would get working automation.
- **What this means for the pipeline**: everything upstream and downstream of this one form
  stays fully automated (list/detail/diff, fingerprinting, pack generation, form-filling,
  letter/envelope generation). This one step needs a human to click through manually -
  `run_discovery.py` now prints direct links for exactly the tenders that need it, so that's
  a few clicks per day, not a research task. `--attempt-automated-download` still exists as
  an explicit opt-in, clearly labelled as expected to fail, in case SANRAL's defenses or
  terms ever change.

## 2. Verification checklist (V1-V12), consolidated

From `SANRAL-Tender-Automation-Specification.md`, confirmed working in practice:

| ID | Check | How |
|---|---|---|
| V1 | Zip integrity | `.xlsm` is a valid zip |
| V2 | XML well-formed | every part parses, 0 errors |
| V3 | Macro untouched | `vbaProject.bin` byte-identical to template |
| V4 | Structure diff | part count matches template; only expected parts differ |
| V5 | Values read back | re-open filled file, confirm written values round-trip |
| V6 | Dropdown labels resolve | form-control selection index maps to the exact expected label text |
| V7 | PDF page counts | render each relevant sheet, page counts match expectation |
| V8 | Formula-error scan | 0 `#REF!`/`#VALUE!`/etc. anywhere |
| V9 | Text-presence check | `pdftotext` confirms expected strings appear on the rendered PDF |
| V10 | Visual check | render a page to PNG, actually look at it - layout, no overlap/clipping, correct values displayed |
| V11 | RRM-only: Form B7 closing date matches SETUP closing date | both read and compared |
| V12 | RRM-only: every bundled contract row is YES/has a C2.4 value | read and compared |

**One more verification habit worth formalising for automation**: a full
`PIL.Image.load()` (not just a `file`/magic-byte check) on every binary asset before
using it. Caught a corrupted logo file this round that a magic-byte check missed
entirely.

## 3. Information & evidence needed from Klipcorp - ONE-TIME, reusable across every tender

This is the real gap list. Everything below either doesn't exist in Drive yet, exists
but is stale/wrong, or exists but was never confirmed. Automation can't fill these in -
they need to come from Sarel/Klipcorp directly.

### Company identity & compliance (currently contradictory or expired)
- [ ] **Reconcile legal name vs CSD trading name** - "Klipcorp (Pty) Ltd" vs "Klipcorp
  Consulting Services" don't match.
- [ ] **Reconcile head office address** - Form B3 precedent says Pretoria; CIPC/CSD
  registered address says Modderfontein/Edenvale. Which is current?
- [ ] **Renew COID letter of good standing** - the one on file expired 2022-04-30.
  Any tender citing it as current is a real compliance risk.
- [ ] **Refresh B-BBEE certificate/affidavit** - the 2026 affidavit and 2021 CSD report
  disagree on details (different commissioners). Needs a single current source.
- [ ] Current CIPC company registration printout/certificate (confirm the
  2013/052202/07 number is still current and unencumbered).
- [ ] Current SARS tax compliance status / TCS pin (needed fresh per tender, <some
  validity window - confirm SANRAL's exact requirement).
- [ ] Current CSD registration printout (the Central Supplier Database one).

### Banking & admin
- [ ] A current bank confirmation letter (<3 months old at time of use, per SANRAL's
  own A18 requirement) - the one on file is not dated recently enough to assume
  reusable.
- [ ] **Company's own telephone number** - not on file anywhere, genuinely missing.
- [ ] A real company letterhead template (if one exists beyond the logo) - confirm
  whether Klipcorp's actual letterhead paper carries registration numbers, address,
  etc. in a header/footer beyond just the logo mark.

### People - CVs and credentials
- [ ] **CVs for every potential key person**, not just Henning. No Pavement and
  Materials Design Specialist CV is on file - Henning was used as an explicit stand-in
  for the sample run, which is NOT submittable as-is for a real tender needing that
  specialism.
- [ ] Confirm/identify the CVs found in a "00 Opportunities" folder that may belong to
  Klipcorp but aren't confirmed: Maxwell Pawandiwa, Richard Lindeque, Phuthuma Lawana,
  Chris Muir, and a set of "Sagient CVs."
- [ ] Each key person's **full ID number** (currently withheld/placeholder in the
  sample pack - needed for real submissions, never to be committed to the public repo).
- [ ] Each key person's direct phone and email (only Henning's mobile is on file;
  his email is still missing).
- [ ] ECSA/SACPCMP registration certificates for each registered person cited (not
  just the number - the actual certificate, which some forms require attached).

### Quality & programme content
- [ ] **ISO 9001 certificate, or a written description of Klipcorp's in-house QMS** -
  nothing found in Drive. Form B4 cannot be properly completed without this.
- [ ] Someone who can write real programme/methodology content for Form B5 per
  contract - this is professional judgment, not a data field, and needs a real person
  (whoever will run the contract) each time.

### Past performance evidence
- [ ] **Signed client performance reports (Annex 4 / PSP Performance Report format)
  for every project that might be cited in a CV.** This is the single biggest gap:
  of 3 projects checked for this sample pack, only 1 had a matching signed report; 1
  had a report under a different contract number (needs reconciling); 1 had nothing
  at all. This needs to become a standing Drive folder of "every signed reference we
  can actually attach," kept current as projects complete.
- [ ] A process for requesting a performance report from a client when one doesn't
  exist yet (e.g. Project 2 / ORT 3961) - not a document problem, a client-relationship
  one.

### Governance / signing authority
- [ ] Confirm who currently has signing authority (director(s), any delegation) -
  the sample used Krisun Naidoo per the 2023 precedent letter; confirm this is still
  current.
- [ ] Confirm the actual job title(s) currently used for whoever signs/represents the
  company - caught a real mismatch this round ("Senior Manager" in a 2023 letter vs
  "Business Development Manager" sourced from current tender forms). Pick one,
  consistently, going forward.

## 4. Information & evidence needed PER TENDER (changes every time)

- [ ] The full downloaded document set: Technical Submission `.xlsm`, Financial
  Submission `.xlsm`, docx returnable schedules (C.1.1.1, C.1.2.3, A-Forms bundle),
  and the Book 1-3 PDFs - downloaded fresh each time (headers/NRA numbers/contract
  numbers differ per contract, never reused from a prior tender).
- [ ] Required positions for this tender, read from the template's own `SETUP` row 6 -
  don't guess; the template always states exactly which key-position codes are needed.
- [ ] Closing date **and time** - the date is on `SETUP!C3` as an Excel serial; the
  time is NOT in that cell and needs to be read from Book 1/Tender Data C2.15 or the
  advert (never defaulted to a guess like "11:00").
- [ ] A human decision on who fills each required key position for this specific
  tender (depends on who's available/qualified and not already committed elsewhere).
- [ ] Confirmation of compulsory briefing attendance, if the tender requires one -
  this is a hard eligibility gate, not a form-filling problem, and needs confirming
  with Sarel every time one is listed.
- [ ] The real pricing/BOQ figures for the Financial Submission - a business decision,
  always supplied by Sarel, never automated or guessed.
- [ ] Project-specific B5 programme content and any B4 QMS evidence specific to this
  contract type, from whoever would run the contract.

## 5. Known data-quality issues to carry into any future automation

Do not let an automated pipeline silently trust these without a human gate:
- Company name has two spellings in official records (legal vs CSD trading name).
- Head office address has two different values in official records.
- COID letter of good standing is expired.
- B-BBEE source documents disagree with each other.
- At least one past-performance report is filed under a different contract number
  than the CV that cites it.
- A corrupted binary file can pass a `file`/magic-byte check and still be unusable -
  always verify with a real load (e.g. `PIL.Image.load()`, not just header
  inspection), for any binary asset an automated pipeline handles.

## 6. What's still manual today (automation targets, roughly in priority order)

1. ~~Data-pack generation (step 2)~~ - **done, 2026-10-15**: `engine/pack_generator/`.
2. **B6 matcher** - automatically search Drive for a performance report matching each
   project's client+contract number, flag confirmed/mismatched/missing instead of a
   manual search each time.
3. **Closing-time extraction** - parse Book 1/Tender Data for the actual time, not just
   the date from SETUP.
4. **Cross-document consistency check** - an automated version of the step-11 audit:
   diff every name/title/date that appears in more than one output document and flag
   any disagreement, instead of relying on a manual read-through every round.
5. The document-download step (now §1a) is deliberately NOT on this list - it's closed,
   not pending; see §1a for why.
6. B4/B5 content generation is deliberately NOT a target - this is professional
   engineering judgment and a real representation to a government client; the tool's
   job there stays "produce a clean skeleton and flag what's missing," not write the
   content.
