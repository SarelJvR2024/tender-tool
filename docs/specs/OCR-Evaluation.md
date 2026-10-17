# OCR for scanned documents: evaluation (experimental)

**Date:** 2026-10-17. **Status:** built as an experiment, switched on in the worker image, easy to remove.
**Question Sarel asked:** "Build it, then we can test and see if it is worth keeping."
**Short answer:** worth keeping, with caveats. It turns a hard refusal into a usable reading for clean
office scans. Every OCR'd result is clearly marked and starts unticked. It is not reliable enough to trust
individual numbers without a human check, and it never will be.

## 1. What was built

| Piece | Where | What it does |
| --- | --- | --- |
| OCR module | `engine/ocr/scan_ocr.py` | Renders a page with `pdftoppm` (A4 at about 300 dpi, larger sheets scaled down), runs **Tesseract 5** (`tesseract` command line, English), and checks quality page by page. It retries pages that are sideways or upside down using Tesseract's orientation check. It also reads image uploads (PNG/JPEG/TIFF/BMP/GIF/WebP). |
| Tender documents | `engine/general/requirements.py` `ocr_scanned_pages()` | A PDF page is offered to OCR when its text layer has fewer than 200 characters **and** the page holds an image. The OCR text replaces the page only when it is clearly more than the text layer, so the rest of the pipeline is unchanged and there is no parallel pipeline. The manifest records `documents[].ocr` (pages read, mean confidence, pages not read), `from_ocr: true` on every form, returnable, role or buyer form quoted from an OCR'd document, and one plain line under "What Tender Tool can't do" per OCR'd document. Flat-PDF typing (`fill_flat_pdf`) is never offered on an OCR'd page, because it needs a real text layer. |
| CV extraction | `engine/cv/extract_cv_fields.py` | Scanned PDF pages and photo uploads are OCR'd, then go through the same redaction, Claude call and quote checks as a text CV. `text_method` says `OCR (tesseract …)`. The first warning says which pages were OCR'd and at what confidence. **Every value read from OCR'd text is set `verified: false` and carries a warning**, so the review screen leaves it unticked. For OCR'd text, **every** 13-digit run is removed before the text is sent to the API, not only checksum-valid SA ID numbers, because an ID that OCR misread by one digit fails the checksum but is still someone's ID. |
| UI | `app/app/tenders/[id]/ocr-notice.tsx` (+ one line in `general-workspace.tsx`), `cv-review.tsx`, `lib/generalTender.ts` types | A blue "Read by OCR from a scan - check against the original" box lists each OCR'd document, its pages and its confidence. Requirement quotes from OCR'd documents are prefixed "Read by OCR - check the scan:". The CV review card shows an OCR banner. |
| Worker | `engine/worker/Dockerfile` | `tesseract-ocr tesseract-ocr-eng tesseract-ocr-osd` sit next to `poppler-utils`. No Python package is added; requirements.txt has a note saying so. `OCR_DISABLED=1` switches OCR off without a rebuild, and `OCR_MAX_PAGES` (default 60) caps the pages OCR'd per document. |
| CI | `.github/workflows/bridge-worker-ci.yml` | Installs tesseract for the CV test step. `test_extract_cv_fields.py` §6 OCRs a scan made from the synthetic CV, checks the flags, and checks that an illegible scan is refused. |

**Fallback is the old behaviour.** OCR may be missing (no tesseract, `OCR_DISABLED`), it may crash, or every
page may fail the quality gate. In each case the document is refused exactly as before. The refusal now adds
why OCR did not help, for example "no text layer (scanned image), and OCR couldn't read it clearly: too
unclear for OCR to read reliably (OCR confidence 49/100; …) - read it by eye". Nothing is guessed.

**No migration.** The flags live in the existing JSON (`tenders.document_requirements`) and in the existing
`cv_extraction_results.text_method` / `warnings` / `proposed` columns.

**Removing it:** delete `engine/ocr/`, the two `scan_ocr` call sites (search "scan_ocr"), the three tesseract
packages in the Dockerfile and CI, `ocr-notice.tsx` and its line in `general-workspace.tsx`, and the OCR
banner in `cv-review.tsx`. Leftover `from_ocr` / `ocr` fields in stored JSON are optional and harmless.

## 2. The quality gate (and why it is set where it is)

Tesseract gives a confidence (0-100) for every word. A page is used only when it has at least 5 words, a mean
word confidence of at least 75, and at least 70% of its words at 60 or more. The thresholds come from the
measurements below:

| Input | Mean conf | Result | Was the text actually right? |
| --- | --- | --- | --- |
| Every real scan in the corpus (17 Tourism pages, 3 ESKOM annexures, ESKOM SOW, 3 CV certificates) | 81-96 | read | Yes, see §3 |
| ECSA certificate as a heavily compressed tiny JPEG (q5) | 49 | **refused** | No: it read "7 May 2013" for 4 May 2015 and "2070155" for 20150155 |
| Tourism p.1 / p.3, Gaussian blur 4 px | 46 / 70 | **refused** | No: word salad ("COMPARES AND TELLECTUA…") |
| Tourism p.1 / p.3, JPEG q5 | 29 / 25 | **refused** | No |
| Pages rotated 90° / 180° | 33-47 first pass | read after auto-rotate (88-94) | Yes |
| Skewed 4° | 85-92 | read | Yes |
| Skewed 12° | 0 words | **refused** ("no readable text … badly skewed scan") | n/a. Tesseract gives up and we do not deskew |
| Blank page with scanner speckle | 0 words | **refused** | n/a |
| Low resolution (72-150 dpi equivalent, upscaled) | 77-94 | read | Mostly: the 72 dpi ECSA copy **silently dropped the "Date 4 May 2015" line** |
| ECSA certificate, Gaussian blur 4 px | 81 | **read** | **Partly wrong:** the registration number came out as "2015015:" (a digit lost) **with word confidence 84**, and "Act No. 46 of 2000" became "Art No. 46 of JUAK)" |

**What the gate can and cannot do.** It reliably stops pages that are visibly garbage (wrong dates, word salad).
It **cannot** stop a single confidently-misread number on an otherwise clean page (the blurred ECSA case).
Word confidences do not separate those cases either: the wrong "2015015:" scored 84, while the correct
"|NB143/2026" on the Tourism page scored 54. That is the reason every OCR'd CV value starts unticked and every
OCR'd tender requirement carries the "check the scan" label. A per-word filter would remove correct words
and keep wrong ones, so none was added.

**False refusals:** a clean, perfectly legible contents page (ESKOM SOW p.2) was refused at 57 because
Tesseract reads dot leaders ("1. INTRODUCTION ........ 3") as long nonsense words. The signature pages of
SALB SBD 8 and SBD 9 (dotted fill-in lines) were refused the same way. A false refusal costs only what we had before OCR: that page
stays "read it by eye".

## 3. Accuracy on the real scanned samples

These are the documents the findings docs named as pure scans (`General-Tender-Preparation-Findings.md` §9:
Tourism NB143 and the ESKOM annexures; `CV-Extraction-Findings.md` §1: the three scanned person documents).
Each OCR output was read back against the scan image.

### Tourism NB143 (17-page scanned RFQ, 200 dpi colour JPEG): **good**
- All 17 pages passed (mean confidence 91). The body text (terms, returnables list, preference-point
  definitions, scope of work) is near-verbatim. One sentence in §4.6 lost a line ("DOES NOT EXERCISE CONTROL…"
  was merged into the next line as "BE AWARDED Se CONTROL").
- Header fields: NB143/2026 ✓, 20 OCT 2026 ✓, closing time **"10HOO"** ✗ (letter O for zero), contact
  numbers 012 444 6096/012 444 6042 ✓, the two e-mail addresses **run together**, with "/" read as "l" ✗.
  The tick boxes come out as junk ("CINo", "[INO").
- Handwritten name, designation and date on p.6: garbage ("O APC) PH/2)"), so handwriting is not read.
- **Manifest before OCR:** the main document was "Couldn't read", only the separate SBD 4 .docx was found,
  and 1 returnable was listed. **After OCR:** SBD 1 is found in the scan (by hand, "only a scanned PDF
  edition…"), with SBD 4, plus 5 returnables (CSD, tax compliance, B-BBEE sworn affidavit, CIPC documents
  - all "required" - and director IDs), SBD 1's questions (signatory, price, accredited representative,
  foreign supplier) and the company contact fields. All of these match what a person reads on the scan.
- Still missed: the 80/20 preference system is reported "ambiguous". The tender says "THE 80 / 20
  PREFERENTIAL POINT SYSTEM WILL BE APPLIED", a phrasing `score_outlook.py`'s patterns don't cover. OCR read
  it correctly, so a text copy would have the same miss. The engine misses this wording; OCR doesn't cause it.

### ESKOM Annex C, D, E (SATS 1286 local-content forms, 300 dpi bilevel): **usable for identification, weak on tables**
- All three passed (84, 84, 86). Titles, form codes (C1-C25, D1-D53, E1-E13) and row labels are read, so each
  is now correctly listed as a buyer form instead of "Couldn't read".
- The column headings of Annex D's wide tables are interleaved into nonsense lines.
- **White text on black bars is mostly lost:** "Manpower costs" became "EERE" and "Factory overheads" became
  "ACs A edicceed" (Annex E), and "Calculation of imported content" came out clipped.
- Pre-printed values on the form: "R 9.00" ✓ and "R 12.00" ✓.

### ESKOM Scope of Work (6 pages, also a scan, not previously listed): **good, 5 of 6 pages**
- Pages 1 and 3-6 were read cleanly (mean 93). Page 2 (contents page) was a false refusal, see §2.

### CV-related scans (Klipcorp B2.1CE folder, 200 dpi Konica Minolta): **text right, but these aren't CVs**
- ECSA registration certificate: name ✓, "Professional Engineer" ✓, "4 May 2015" ✓, "20150155" ✓.
- MEng certificate (Stellenbosch): name ✓, degree ✓, "5 March 2015" ✓, certificate number ✓.
- BEng certificate (Pretoria, in Afrikaans): body text ✓ ("Baccalaureus in Ingenieurswese (Siviele
  Ingenieurswese)", name, "2010-04-23"). "Hoër" came out as "Hoér", because English language data reads
  Afrikaans diacritics badly. The certified-copy stamp and the signatures are dropped, not garbled.
- **Untested end to end:** these files are certificates, not CVs, and no `ANTHROPIC_API_KEY` is available
  in this environment. The Claude step was therefore exercised only with the existing stub client (CI test
  §6). With a key, I expect the model to answer "not_a_cv", which fails the job with that reason; that is
  the existing behaviour for a certificate.

### Ground truth: real text documents turned into scans
To get an exact measure, real documents **with** a text layer were rasterised into image-only "scans"
(200 dpi, JPEG quality 60, slight skew, blur and speckle). They were OCR'd and compared with their own text
layer and with the manifest built from it:

| Document | Pages OCR'd | Manifest vs the text-layer manifest |
| --- | --- | --- |
| SALB SBD 1/4/8/9 (4 PDFs) | 9 of 11 (the SBD 8 and SBD 9 signature pages, all dotted lines, refused) | **Identical** suite, returnables, roles, buyer forms, CIDB, briefing, preference system, questions. Only difference: SBD 1, 4 and 9 change from "typed onto the PDF" to "by hand", by design |
| Dawid Kruiper TN051 (44 pages, MBD bundle) | 43 of 44 (p.37 refused at 74), mean 93, 257 s | **Identical** apart from the same by-design overlay → by hand change for MBD 1, 4, 9 |
| Overberg Q12 (66 pages, MBD bundle) | 58 of 60 tried (p.18, p.21 refused), **pages 61-66 not tried (60-page cap)**, mean 93, 369 s | Same by-design overlay change. **MBD 6.2 missing:** it is only named on p.66, beyond the cap, and the gap line says pages 61-66 were not OCR'd. **One extra role:** "proposed Project Manager" (p.16). It really is on the page, but in the text layer the context check missed it, and OCR's different line order put "registration" within reach. Neutral |

SANRAL Form B1.1/B2.1 (Henning's real key-person form, the closest thing to a CV in the repo), scanned the
same way: about 28 of the 30 visible key values were read correctly (name, ID number, every date, every
project value, the ECSA number and date, the qualifications and institutions). The two errors are the ones
that hurt: contract number **"IORT5737/2018/REP"** for ORT5737/2018/RFP, and a referee phone number
**"427.61 077 1225"** for +27 61 077 1225. Both sit on a page with confidence 87-89, which passes the gate.
The CV review step catches this kind of error only because every OCR'd value starts unticked.

## 4. Speed and cost

- **Cost: R0 per page.** Tesseract runs in the worker container, and no API is involved.
- **Time:** about 3-4 s per page on an idle 4-core box, and 6 s per page while other jobs ran (44 pages took 257 s, 60 pages 369 s) (the 17-page Tourism scan took about 1 minute; the 3
  ESKOM annexures and the SOW about 40 s together). Tesseract's own multi-threading had to be switched off
  (`OMP_THREAD_LIMIT=1`): under load, one page took **3 min** with it on and **4 s** with it off. Text PDFs
  pay only for low-text pages that hold an image (maps, photos). Dawid Kruiper's two map pages and six of
  DPWI's picture pages are OCR'd and then discarded because they add nothing, which costs a few seconds.
- **Image size:** about +29 MB (measured on the image layer) for the three Debian packages (tesseract 5.5.0 on the worker's Debian base).
  Checked: the apt layer installs cleanly in `python:3.13-slim`. In an image with those packages plus
  poppler, OCR read ESKOM Annex E as the non-root `worker` user, with the same result as here. A full
  `docker build` of the real Dockerfile couldn't finish in this sandbox: its `pip install` step fails on
  the sandbox's TLS proxy, which has nothing to do with OCR. CI's `container-build` job builds it for real.

### Paid alternatives, costed in case local OCR isn't enough
- **Claude reading the scan itself** (PDF/image input). A page image is about 1,500-2,500 input tokens. At
  Opus 5.5's $4 / $20 per million tokens (prices from `CV-Extraction-Findings.md`, cached 2026-10-06), a
  one-page CV scan adds about $0.01 of input to the extraction call already being made. Transcribing a
  17-page tender would cost about $0.15 input plus about $0.35 output, roughly **R9 per scanned tender**.
  It handles tables, white-on-black text and some handwriting far better than Tesseract. **But it sends
  the unredacted scan, ID number included, to the API.** The CV pipeline's local ID redaction can't apply
  to an image. That is a real privacy step backwards, and Sarel should decide it explicitly.
- **Cloud OCR (Google Document AI / Vision, AWS Textract):** list prices as I know them are about
  $1.50 per 1,000 pages for plain text detection (not re-checked today). That is cheap, but it needs a new
  account, keys and a new data processor, and its accuracy on these clean office scans would be similar to
  Tesseract's. It is not worth the extra moving part unless Tesseract's table weakness turns out to matter.

## 5. Recommendation

**Keep it, with caveats.** The reasons:

1. **It turns a dead end into a useful result on the real scans.** The Tourism RFQ went from "Couldn't read"
   to a correct requirement list. Four ESKOM documents went from "Couldn't read" to identified. On the
   ground-truth tests, requirement manifests built from OCR matched the text-layer ones apart from the
   by-design overlay change.
2. **It fails honestly.** Visibly bad scans (blur, heavy compression, strong skew, blank pages) are refused
   with a reason. Anything it does read is labelled as OCR everywhere it appears, and CV values from it are
   never pre-ticked.
3. **It costs nothing to run** and is easy to switch off (`OCR_DISABLED=1`) or remove (§1).

The caveats Sarel should accept knowingly:

- **Individual numbers can be wrong at high confidence:** a contract number, a phone number, a registration
  number with a digit dropped, "10HOO". OCR is good for *finding what a tender requires*. It is not
  trustworthy for *copying a value onto a sworn form* without a human comparing it to the scan. The design
  enforces that check: values start unticked, and the tender UI and gaps carry the label.
- **Weak spots:** wide tables (headers interleaved), white text on dark bars, handwriting (ignored or
  garbled), contents pages with dot leaders (falsely refused), Afrikaans accents, and pages skewed more than
  about 10° (refused).
- **Not yet measured:** the Claude extraction step on a real OCR'd CV (no API key here, and the team's
  scanned "CV" files are certificates). Measure on 2-3 real scanned CVs once the key is set.
- **Possible follow-ups, only if real use shows the need:** add `tesseract-ocr-afr` (+2 MB) for Afrikaans
  certificates; deskew before OCR; teach `score_outlook.py` the "80 / 20 PREFERENTIAL POINT SYSTEM WILL BE
  APPLIED" phrasing (an engine gap, not an OCR gap); consider Claude-vision for CVs only if Sarel accepts
  sending unredacted scans.

**Drop it if:** in the first few weeks of real use, people trust the OCR'd values despite the labels, or
OCR'd tenders produce requirement lists that are wrong more often than a person reading the scan would
accept. Then delete it as described in §1 and keep the honest refusal.

## 6. How this was verified (reproducible)

- `python3 engine/ocr/scan_ocr.py <file> --show-text` shows the per-page status, confidence and text.
- `python3 engine/general/requirements.py <dir>` (and the same with `OCR_DISABLED=1`) gives the before/after
  manifests for Tourism NB143 and ESKOM (the samples are in the discovery download cache, not committed:
  eTenders releases 174192 and 174488).
- `python3 engine/cv/extract_cv_fields.py --file <scan.pdf> --text-only` shows the OCR'd CV text that would
  be sent, with 13-digit numbers removed.
- `python3 engine/cv/test_extract_cv_fields.py` passes both with OCR available and with `OCR_DISABLED=1`.
- `python3 engine/general/general_harness.py --no-pack`: 44 clean, 0 flagged. With tesseract installed, no
  committed sample's manifest changes; none of them is a scan.
- The degraded copies and the ground-truth "scans" were generated by throwaway scripts (Pillow +
  pdftoppm), which are not committed.
