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
| Financial Submission filler | **Does not exist.** Only the structure is mapped (see `financial-submission-workbook.md`). Writing `TENDERER INPUT DATA` (company name, key-person names/positions) is mechanical and could be built next. The actual hours and pricing figures are a business decision — the engine should refuse to guess these, the same way it already refuses to guess C2.4 on the Technical side. |
| Form B4 (quality systems) | No template exists anywhere. Needs real content drafted per tender, not filled from data. Not something to auto-generate from a data pack — it's professional-judgment content. |
| Form B5 (programme) | Same — no template, needs a real Gantt/programme specific to this contract's dates and scope. |
| Form B6 (past performance / reference checks) | No template exists, but Henning's 3 ACSA projects (already in the pack) are a strong starting point for the narrative — this one's realistic to semi-automate once a standard B6 layout is agreed. |
| A-Forms bundle (Authority of Signatory, B-BBEE affidavit, bank details) | Not attempted this round. Authority of Signatory needs a real director sign-off naming the signatory for these specific bid numbers — not something to fabricate. B-BBEE affidavit and bank details are already-known data (`config/klipcorp_profile.json`) that could be mechanically inserted into the docx template once that's built. |
| C.1.1.1 Form of Offer / C.1.2.3 Contract Data | Not attempted this round. Price-in-words/figures depends on the Financial Submission being complete first. |
| Compulsory briefing attendance (17 Sep 2026) | Not a document-generation problem — needs confirming with Sarel directly, separately from any of this. |

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
