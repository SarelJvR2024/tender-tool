# General Tender Engine — Findings

Oct 16, 2026 · research pass before writing any generic filler

## Question this answers

Sarel asked: is the engine ready to complete a non-SANRAL tender? **No.** Before writing a single line of a generic filler, this doc looks at real downloaded documents from six structurally diverse, real, currently-open national tenders and reports what is actually there — same evidence discipline as the rest of this project (`docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md`, `fingerprint.py`, `provenance.py`): **Observed** (with the source file) vs **Assumed**, nothing guessed.

## Method (Observed)

1. Ran `python3 engine/discovery/etenders_national.py --days 30 --out national_sample.json` against the live National Treasury OCDS API. Got 300 real, currently-open releases across 126 distinct buyers (pulled 2026-10-16; the API's own page-4 500 error cut the window short at 300 of a larger total — not all releases in the 30-day window, but a large and genuinely diverse sample).
2. Picked 6 samples deliberately for structural diversity, not convenience: a national department (most standard-forms use), a small national public entity, a parastatal that re-types its own copies, a SETA/quality council, a major SOE with its own non-SBD document set, and a local municipality with its own single-PDF bundle.
3. Downloaded the real documents from each release's own `documents[].url` (the same `etenders.gov.za/home/Download?blobName=...` public, unauthenticated URLs `etenders_national.py`'s docstring already confirms are legally reusable — no SANRAL-style reCAPTCHA gate involved).
4. Extracted real text from each file (`pdftotext -layout` for PDFs, `python-docx` for `.docx`, LibreOffice headless conversion for legacy `.doc`) and diffed samples against each other directly — not inferred from one file or from titles.

| # | Buyer | Release (ocid) | Title | Why picked |
|---|---|---|---|---|
| 1 | National Treasury | ocds-9t57fa-174464 | RT83-2026RA (fuel tank panel) | National department, SBD forms as `.docx`, newest PPR2022 wording |
| 2 | South African Library for the Blind (SALB) | ocds-9t57fa-174225 | SALB 15/10/2026 (alarm monitoring RFQ) | Small public entity, SBD forms as flat `.pdf` |
| 3 | Road Accident Fund (RAF) | ocds-9t57fa-174266 | PR10118921 (plumbing RFQ) | Parastatal, SBD forms as mixed `.docx`/legacy `.doc` |
| 4 | Quality Council for Trades and Occupations (QCTO) | ocds-9t57fa-174485 | QCTO 15/2026 (media room fit-out) | SETA-type entity, SBD forms as flat `.pdf`, plus a buyer-specific CV template |
| 5 | ESKOM | ocds-9t57fa-174369 | E3689GXMPLET (thermocouples supply) | Major SOE — deliberately picked to test whether a big buyer skips SBD forms entirely |
| 6 | Dawid Kruiper Local Municipality | ocds-9t57fa-174000 | TN051/2026 (security services) | Municipality, single bundled PDF, no SBD forms at all |

## Finding 1 — SBD forms are genuinely common, but NOT byte-identical across buyers (Observed)

SBD1 (Invitation to Bid), SBD4 (Bidder's Disclosure) and SBD6.1 (Preference Points Claim) appear, under those exact National Treasury form names, in 4 of the 6 samples (Treasury, SALB, RAF, QCTO). SBD8 and SBD9 appear in the SALB sample. All five are standardised National Treasury forms, confirmed by direct text extraction, not title inference.

Direct diff, SALB's `SBD1.pdf` vs QCTO's `SBD1.pdf` (both labelled "SBD1", both "PART A — INVITATION TO BID"):

- 194 diff lines out of ~115/99 lines total — **not byte-identical.**
- QCTO's copy adds an extra "BIDDING PROCEDURE ENQUIRIES / TECHNICAL ENQUIRIES" contact block SALB's copy does not have.
- Whitespace/column layout differs throughout (expected — each buyer re-typed or reformatted the template rather than reusing one master file).
- The field *labels* that matter for filling are identical or near-identical in both: `NAME OF BIDDER`, `POSTAL ADDRESS`, `STREET ADDRESS`, `TELEPHONE NUMBER` / `CODE` / `NUMBER`, `FACSIMILE NUMBER`, `E-MAIL ADDRESS`, `VAT REGISTRATION NUMBER`, `TCS PIN` / `CSD No`, the B-BBEE Yes/No block, `ARE YOU THE ACCREDITED REPRESENTATIVE...`, `ARE YOU A FOREIGN BASED SUPPLIER...`, signature/date/capacity.

SBD4 shows the same pattern one level deeper — two live "editions" exist in the wild concurrently:
- SALB, QCTO and RAF's copies share near-identical body wording and the heading **"2. DECLARATION ON EMPLOYMENT BY ORGAN OF STATE"**.
- Treasury's own current copy (its own form, dated 2026, logically the most authoritative) drops that numbered heading entirely, reorders the declaration, and adds a clause neither of the other three have: *"If so, indicate all companies registered in the CSD in the table below. Failure to disclose all CSD-registered active companies linked to all Directors will lead to disqualification."*
- Net: SBD4's **purpose and core fields are the same** (employed-by-organ-of-state Y/N + names/ID table, relationship-with-employee Y/N, interest-in-other-enterprise Y/N, signature/date/designation/name of bidder) but **exact section numbers and legal wording are not** — a filler keyed to an exact paragraph number or exact sentence would break on at least one of these four real samples.

SBD6.1 shows the same split: SALB and RAF use near-identical older "PPR2022 / tenderer" wording (same sentences, same declaration block: company name, registration number, company-type tickboxes, specific-goals points table, signature/surname/date/address). Treasury's own copy uses newer "bidder" wording with different sentence structure for the same two preference-point systems. Two wording editions, same underlying form and same fillable fields.

**Conclusion:** treat each SBD form number as one *family* (same purpose, same core field set) with *known wording variance between buyers*, not as one fixed template. A filler must match by **field label text**, never by fixed paragraph number, fixed sentence, or fixed byte offset.

## Finding 2 — the file format split is the harder problem, not the wording (Observed)

Checked every downloaded SBD `.pdf` for AcroForm fillable fields with `pypdf.PdfReader.get_fields()`:

```
downloads/salb/SBD1.pdf   -> fillable fields: 0
downloads/qcto/SBD1.pdf   -> fillable fields: 0
downloads/salb/SBD4.pdf   -> fillable fields: 0
downloads/salb/SBD6_1.pdf -> fillable fields: 0
downloads/salb/SBD8.pdf   -> fillable fields: 0
downloads/salb/SBD9.pdf   -> fillable fields: 0
```

**Every SBD PDF in this sample is a flat, printed-to-PDF layout with zero AcroForm fields** — the blanks are literal dotted lines (`………………………`) or empty table cells baked into a non-editable page, the same way SANRAL's own PDFs work, except SANRAL's workflow never tries to fill a flat PDF (`fill_tender.py`/`fill_docx_forms.py` only ever touch the editable `.docx`/`.xlsx` originals). Filling a flat PDF reliably would mean either overlaying text at measured pixel coordinates (fragile — any buyer reformat breaks it silently, exactly the failure mode `fingerprint.py` exists to catch for SANRAL) or OCR-plus-coordinate-guessing (worse). Neither is safe to ship without per-buyer fingerprinting, which defeats the point of a *general* filler.

By contrast, every `.docx` SBD form checked (Treasury's SBD1/SBD4/SBD6.1, RAF's SBD6.1) is a normal Word document with real tables and real paragraph runs — `python-docx` reads and edits them exactly the way `fill_a_forms.py` already edits SANRAL's A-forms. Confirmed directly:

```
Treasury SBD1.docx, table 0, row 10: ['NAME OF BIDDER', '']
Treasury SBD1.docx, table 0, row 18: ['VAT REGISTRATION NUMBER', '']
Treasury SBD1.docx, table 0, row 19: ['', 'TCS PIN:', 'OR', 'CSD No:']
```

— label cell, blank adjacent cell, exactly the key-position-matching shape `fill_a_forms.py`/`pack_generator` already handle for SANRAL. RAF's SBD6.1 docx uses the *other* convention `fill_a_forms.py` also already has code for: a plain paragraph with a dotted blank (`Name of company/firm…………………………………………………`), not a table — confirmed by `DOTS_RE`/`clear_paragraph`/`set_paragraph_text` already existing in that file for SANRAL's own forms.

**Conclusion:** the format split, not the wording split, is the real fork in the road. A safe general filler can only target the **`.docx` edition** of each SBD form. Of the 4 SBD-using buyers sampled, only Treasury supplied `.docx` for all three forms checked; RAF supplied `.docx` for SBD6.1 but legacy `.doc` for SBD4; SALB and QCTO supplied PDF-only for all of theirs. **Roughly half of real SBD-using buyers in this sample give bidders no editable form at all** — those need a checklist entry telling a human to retype the form from scratch (or source a `.docx` edition of that SBD number from a different, editable release, which several buyers' releases above show does circulate), not an auto-fill attempt.

## Finding 3 — not every buyer uses SBD forms at all (Observed)

- **ESKOM** (E3689GXMPLET): three zips — `Technical and NEC.zip` (containing an actual **NEC3 Supply Contract** draft, not an SBD form), `Commercial.zip`, `SHEQ & Contractual.zip`. No SBD form of any kind in the document list. ESKOM runs its own SCM/contract-form system built around the NEC3 family, unrelated to National Treasury's SBD suite.
- **Dawid Kruiper Local Municipality** (TN051/2026): one single bundled PDF containing everything — general conditions, specifications, and the municipality's own **"Form of Quotation"** (bidder name, contact details, CSD number, locality, total bid amount — all free-text blanks on page 1, Afrikaans/English bilingual municipal letterhead). No SBD form appears anywhere in its 2,285 extracted lines.

**Conclusion:** across this sample, SBD-form usage correlates with *type* of buyer — national departments, SOEs/parastatals with standard SCM offices, and smaller entities (SETAs, libraries) tend to use them; a vertically-integrated SOE with its own contracting regime (ESKOM) and a municipality bundling its own quotation form do not. This matches the existing spec's framing of this as "Gap (to verify)" — it is now verified as **partially true, buyer-dependent, not universal.**

## Finding 4 — envelope-cover / submission convention is genuinely buyer-specific, no common pattern (Observed)

- Treasury: bid response "SUBMITTED ELECTRONICALLY ON ETENDERS WEBSITE".
- SALB and QCTO: "BID RESPONSE DOCUMENTS MAY BE DEPOSITED IN THE BID BOX SITUATED AT (STREET ADDRESS)".
- Dawid Kruiper: a single combined PDF with its own cover page and its own section lettering (A/B/C), no SBD terminology at all.
- ESKOM: three separately-zipped categories (Technical/NEC, Commercial, SHEQ & Contractual) with no single cover document observed at all.

No shared envelope/cover convention was found across the 6 samples. This confirms the spec's assumption cannot be generalised: SANRAL's own envelope-cover generator (`make_envelope_covers.py`) is SANRAL-specific and nothing here suggests a cross-buyer equivalent is safe to build yet.

## Finding 5 — fields actually common across every sample vs buyer-specific

**Common across every SBD-using sample** (safe to source from `config/klipcorp_profile.json`, which already carries all of them):
- Company legal/trading name, registered address, postal address, telephone/cellphone/fax/email, VAT registration number, CSD supplier number (`MAAA0910499`), SARS TCS PIN, B-BBEE level/status, director name, signature/designation/date blocks.

**Common across every sample regardless of SBD usage** (even ESKOM's and Dawid Kruiper's non-SBD forms ask for these): company/bidder name, contact details, total bid price, CSD or registration number.

**Buyer-specific, not generalisable from this sample:** exact wording of declarations, section numbering, which specific-goal categories appear in the SBD6.1 points table (RAF's sample lists Historically Disadvantaged Individuals/Women/Persons with Disability; SALB's lists different categories per its own table — not independently re-confirmed as identical, each buyer sets its own specific-goal weightings per PPR2022 §4), envelope/cover format, and whether a `.docx` edition exists at all.

## What this does and does not support building

**Supports:** a narrow filler for the `.docx` edition of SBD1 / SBD4 / SBD6.1, using label-based key-position matching (not fixed position, not byte/paragraph-number matching), reusing `engine/provenance.py`'s `ProvenanceLog` exactly as `fill_a_forms.py` does, sourced from `config/klipcorp_profile.json`.

**Does not support (yet):**
- Filling SBD forms distributed only as flat PDF — no safe mechanical approach found; this is a "missing" case for provenance/checklist purposes, not something to force.
- A single cross-buyer envelope-cover generator — no common pattern observed.
- SBD8/SBD9 as `.docx` — only PDF editions were in this sample; not attempted (would need its own real `.docx` sample to confirm the field-label pattern first, same discipline as everything else here).
- ESKOM-style NEC3 or municipality-style bespoke "Form of Quotation" filling — out of scope; each would need its own importer per the project's own scope-discipline rule ("a template family gets its own importer"), and this sample size (one ESKOM release, one municipality release) is not enough evidence to design one yet.

## What was built (Finding 1 + 2 together do support a first version)

Built `engine/general/fill_sbd_docx.py` — fills SBD1, SBD4 and SBD6.1 **only when supplied as `.docx`**, using label-based table/paragraph matching (the same two patterns already proven in `fill_a_forms.py`: label-cell→adjacent-cell for tables, dotted-blank replacement for paragraphs), logging every field through `ProvenanceLog` exactly like the SANRAL fillers, reading `config/klipcorp_profile.json` as-is (no new profile format). Fields the form asks for that the profile cannot answer (e.g. a buyer-specific specific-goals category not in the standard three, or a field format this script's label matcher does not recognise in that buyer's copy) are logged `missing` with a reason and left blank — never guessed — matching the project's existing honesty model exactly.

It explicitly refuses to touch a `.pdf`, `.doc` or `.xlsx` SBD form and says why (Finding 2), rather than attempting an unreliable fill.

Verified against a real downloaded sample — see the "Verification" section below.

## Verification (Observed, not claimed)

Ran `fill_sbd_docx.py` against the real Treasury `SBD1.docx` and `SBD4.docx`, and RAF's real `SBD6_1.docx` (the same files diffed above, not synthetic test files):

```
Wrote SBD1_FILLED.docx
Wrote SBD4_FILLED.docx
Wrote SBD6_1_FILLED.docx
Wrote provenance.json: 26 provenance entries ({'confirmed': 11, 'missing': 12, 'assumed_default': 3})
```

Opened `SBD1_FILLED.docx` back up with `python-docx` and confirmed the real values actually landed in the real blank cells next to their real labels — not just that the script ran without error:

```
NAME OF BIDDER            -> Klipcorp (Pty) Ltd
VAT REGISTRATION NUMBER   -> 4620293326
CSD No:                   -> MAAA0910499
```

`SBD4_FILLED.docx`'s three "YES/NO" declarations each now read `... YES/NO  (No)`, and its footer line reads `Designation Senior Manager   Name of bidder Klipcorp (Pty) Ltd` — both real values from `config/klipcorp_profile.json`, correctly separated (an early version of the label-matching helper for the dotted/whitespace-blank convention merged two labels sharing one line with no space between them — e.g. `...Senior ManagerName of bidder...` — because the blank in that convention is plain whitespace, not literal dots; fixed by padding the replacement, confirmed by re-running against the same real file).

Ran the existing `generate_action_checklist.py` against this log with **zero changes to that script** and got a correct `ACTIONS_TO_SIGN.md` (16 items: 15 from this run's provenance, 1 standing) — confirming the general filler is a drop-in participant in the project's existing honesty/checklist pipeline, not a parallel one.

Also ran the script against SALB's real `SBD1.pdf` (passed as `--sbd1`) to confirm the PDF-refusal path works rather than silently doing nothing or guessing: it logged exactly one `missing` entry naming the file and explaining why a flat PDF is refused, and wrote no output file.

RAF's `SBD6_1.docx` uses "Name of company/firm" rather than SALB's "SURNAME AND NAME" for its signatory-name line (the wording variance Finding 1 already confirmed) — this run correctly filled the company-name/registration-number fields it does recognise and logged `missing` with a clear reason for `sbd6_1.signatory_name`/`sbd6_1.signatory_address` rather than guessing at the unrecognised label or crashing. That is the intended behaviour, not a bug: a label this script doesn't recognise in a given buyer's edition is exactly a "needs a human to check" case, same discipline as everything else in this project.

## Realistic next step

Do **not** expand this to PDF forms, ESKOM-style NEC3 documents, or municipality bundles yet — each is a separate, real problem (flat-PDF filling, NEC3, free-form municipal quotation forms) that needs its own real-sample research pass first, same as this one, before any code is written for it. The next concrete, evidence-backed step is: get a second real `.docx` sample of SBD4 and SBD6.1 from a third buyer beyond Treasury/RAF to confirm the label-matching approach holds past two data points, and separately, decide whether flat-PDF SBD forms are worth solving with coordinate-overlay-plus-fingerprinting (SANRAL's own `fingerprint.py` pattern, re-applied per buyer) given roughly half the SBD-using sample here provided no editable form at all.
