# Sample pack run: R.334-030-2025/1F (2026-10-15)

A full practice run of the pack-compilation pipeline against one real tender, done to find out
what's actually missing before any of this touches a real submission. **This is not a
submittable pack** — Henning Jansen van Rensburg was deliberately used for both key positions
(Project Leader and Design Specialist 1 - Pavement and Materials), per instruction, as a
stand-in since no Pavement/Materials specialist CV is on file yet. Several fields are
explicit placeholders (see `packs/r334-030-2025-1f.yaml`).

## What's built and confirmed working (Technical Submission)

1. **Stream 1 — fingerprint check.** Ran first, as required. Matched the stored baseline.
2. **Stream 2 — fill.** `fill_conventional.py` against the real template, using
   `packs/r334-030-2025-1f.yaml`. 136 cell writes, no errors, `FORM C2.4 TECH` correctly left
   untouched (no real hours/budget figures exist yet — the engine already refuses to guess
   these, confirmed working).
3. **Verification (V1–V6, V7–V10 from the main spec):**
   - V1 zip integrity: pass
   - V2 XML well-formed: pass, 0 errors
   - V3 macro untouched: `vbaProject.bin` byte-identical to template
   - V4 structure: 1031 parts in both, 82 differ — **matches the exact count the original spec
     recorded** for this same contract family, a strong cross-check
   - V5 values read back correctly (company name, BEE level, both key persons' names/roles)
   - V6 dropdown labels resolve correctly (employment status, ECSA level, qualification,
     client type, project type, position code — all round-tripped to the exact label written)
   - V7 PDF page counts: Position PDFs 2pp, B3 1pp, B4 2pp, B5 2pp, B7 1pp — **matches the
     spec's recorded counts exactly**
   - V8 formula-error scan: 0 hits
   - V9 text-presence check: confirmed by `pdftotext`
   - V10 visual check: rendered a page to PNG and inspected it directly — dropdowns display the
     correct selected values, layout is clean, no overlap or clipping

## A real bug found and fixed

The template itself prints "ID NUMBER SHOULD BE 13 DIGITS" directly next to the ID field. The
inherited engine code wrote `id_number` via `int(...)`, which silently strips leading zeros —
confirmed by rendering the PDF: a placeholder ID starting with `0` showed as a single `0`
instead of 13 digits. Many real South African ID numbers start with 0 (anyone born in the
2000s), so this would have corrupted a real submission. Fixed in both `fill_conventional.py`
and `fill_tender.py` to write the ID as text. Verified fixed by re-rendering the PDF — the full
13-digit placeholder now displays correctly.

## One unexplained discrepancy, flagged not resolved

`print_reports.py` reported "1937 controls aligned to Excel positions" for this file. The
original spec recorded 867 for this same template family. The dropdown-selection count (866)
and every visual/text check still passed, so this didn't break anything observed — but the
control-count mismatch is real and unexplained. Worth root-causing before relying on this
path at scale; noted here rather than quietly ignored.

## What this run proves is NOT yet built

| Piece | Status |
|---|---|
| Financial Submission filler (mechanical fields) | **Built**, round 2: `fill_financial.py` fills `TENDERER INPUT DATA` (company name, key-person names). Hours/pricing sheets deliberately untouched - that's the BOQ, out of scope by instruction. |
| C.1.2.3 Contract Data | **Built and filled**, round 2 - see above. |
| C.1.1.1 Form of Offer | **Built and filled**, round 2, except the price field itself (BOQ-dependent, out of scope). |
| A18 bank details | **Built and filled**, round 2. |
| Form A2 (Authority of Signatory) | **Deliberately not automated** - the template itself says the example page, completed, isn't valid authorisation. Needs a real board resolution. |
| Form A12 (B-BBEE) | **Deliberately not automated** - needs the actual certificate/affidavit attached, not text in a template. |
| Form B6 (past performance) | **Compiled, not drafted**, round 2 - matched real existing performance reports to each project; 1 of 3 confirmed, 1 unconfirmed (contract number mismatch), 1 missing entirely. See `B6_past_performance_compilation.md`. |
| Form B4 (quality systems) | **Skeleton built**, round 2 - structure and confirmed facts filled in; the QMS content itself is marked `[NEEDS INPUT]`, not invented. |
| Form B5 (programme) | **Skeleton built**, round 2 - same approach; contract dates/scope filled in from real tender data, programme content marked `[NEEDS INPUT]`. |
| Compulsory briefing attendance (17 Sep 2026) | Still not a document-generation problem - needs confirming with Sarel directly. |
| Still fully untouched | The actual Financial Submission hours/pricing figures (BOQ) - a business decision, out of scope by instruction. |

## Round 2 (2026-10-15): the docx forms, except the BOQ

Per instruction, completed everything that's safely completable without touching the
pricing/BOQ. Downloaded the real per-contract docx templates from Drive (not reconstructed
from memory, since the headers/NRA numbers differ per contract) and built
`engine/fill_docx_forms.py`.

- **C.1.2.3 Contract Data** — fully filled: company contact details, key-person table
  (both roles, per the stand-in instruction), directors table. Two fields flagged as
  genuinely missing rather than guessed: the company's own telephone number, and Henning's
  email address (neither is on file anywhere).
- **C.1.1.1 Form of Offer** — B-BBEE level and organisation name/address filled. Price
  deliberately left untouched (the BOQ). Signatory name filled as an explicit
  `[DRAFT - pending signature]` — never presented as if actually signed.
- **A Forms bundle** — only Form A18 (bank details) was filled: account holder name, bank
  name, branch number. Account number deliberately left out (withheld even locally).
  **Form A2** (Authority of Signatory) was deliberately NOT filled — its own notes say
  submitting the example page completed "shall not be accepted as authorisation"; it needs
  a real board resolution on letterhead. **Form A12** (B-BBEE) was deliberately NOT filled —
  it needs the tenderer's actual certificate/affidavit attached, not text typed into a
  template.
- **Form B6 (past performance)** — not drafted, *compiled*: matched Henning's 3 listed
  projects against real signed client performance reports found in Drive. One confirmed
  exact match (project 3, contract numbers match exactly), one unconfirmed (project 1's
  source report is titled a different contract number than the one in the CV), one with no
  source report found at all (project 2). See `B6_past_performance_compilation.md`.
- **Forms B4 and B5** — built as structural skeletons with every confirmed fact filled in
  (company details, contract scope/dates/key positions), but the actual professional content
  (QMS description, programme milestones) is marked `[NEEDS INPUT]` rather than invented.
  No blank template exists for either anywhere, and fabricating a quality-system description
  or programme for a real government tender isn't something to automate — that's a real
  representation to a client, not a data-entry field.

**A real bug caught during this round:** a naive "fill every NAME (IN CAPITALS) field"
approach on the Form of Offer put the signatory's own name into the witness signature fields
too. Witnesses must be different real people. Fixed before saving the output — caught by
actually reading the filled document back, not by trusting the fill logic.

All filled outputs live in `out/R.334-030-2025.1F/forms/` (gitignored - contains real company
contact data). The blank source templates are committed under
`templates/forms/R.334-030-2025.1F/` since they contain no tenant data, only SANRAL's own
boilerplate for this specific contract.

## Recommended next build order

1. Financial Submission filler for the mechanical fields only (company name, key-person
   names/positions) — mirrors what `fill_conventional.py` already does, smaller scope.
2. A docx-filling path for the A-Forms bundle and C.1.1.1/C.1.2.3, using
   `python-docx` or a mail-merge-style approach, for the fields that are already known data
   (company details, BEE level) — not the parts needing human judgment (QMS text, programme,
   signatory authorisation).
3. A B6 draft-generator that turns a person's `projects` list (already in the data pack schema)
   into B6-formatted reference-check text, as a starting draft a human reviews and signs off —
   not a replacement for the real reference-check process.
4. Leave B4, B5, and all signature/authorisation steps as explicitly human-owned — the engine's
   job there is to produce a clean checklist of what's needed and flag when it's missing, not to
   invent professional content.
