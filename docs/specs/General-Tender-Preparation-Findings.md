# General (non-SANRAL) Tender Preparation - Findings and Build

Oct 16, 2026 · round 3 of the general engine, after `General-Tender-Engine-Findings.md` (round 1, 6 buyers) and `Tender-Evaluation-Engine-Audit.md` (round 2, 14 more buyers' evaluation rules)

## What Sarel asked

> "keep working on automating the non-SANRAL tender preparation and the UI for capturing info needed for the tender. Keep going with both engines until it is fully automated."

The bar, the same as the SANRAL side's: open a non-SANRAL tender in the Tender Workspace, see exactly what **this** tender needs, answer only what can't be pulled from the company profile, vault, people and experience library, and get a generated, complete submission pack.

## Corpus (Observed)

25 real non-SANRAL tenders, all public eTenders releases (OCDS feed, PDDL licence):

- **Round 1 (6):** National Treasury RT83, SALB, RAF, QCTO, ESKOM E3689 (thermocouples), Dawid Kruiper LM TN051.
- **Round 2 (12, text):** Gauteng DRT, DPWI EC, Transnet TPT, Cape Winelands, BCMDA, uMlalazi LM, TNPA (x2), Overberg DM, DLRRD, Sentech, LEDA.
- **Round 3 (7, new):** pulled live today (`etenders_national.py --days 21`: 300 releases, documents by type: pdf 476, docx 35, zip 25, xlsx 7, doc 5, rar 1, xls 1, png 1). The 7 releases with `.docx` documents were downloaded and read: DSTI (science & technology), Tourism, SITA, Mthashana TVET, SANEC, State Security Agency, ESKOM (kitchen consumables, E-tender with 20 documents). Western Cape TPW's "TENDER DOCS.docx" turned out to be a one-line pointer to a helpdesk e-mail.

Nine of these are committed as regression inputs in `templates/general_samples/` (with `sources.json`: ocid, buyer, reference, closing date).

## Findings

### 1. Municipalities DO use standard forms - the MBD suite (correction to round 1, Finding 3)

Round 1 said Dawid Kruiper "uses no SBD forms at all". That is literally true and practically wrong: its bundle says (TN051 §3.4) *"The following forms, Summary of items and bid price, MBD 1, MBD 4, MBD 6.1, MDB 7.1, MBD 8 and MBD 9, must be completed"* (the "MDB" typo is verbatim). The Municipal Bidding Documents are the MFMA twin of Treasury's SBD suite - same purpose, same core fields. Seen in five of five municipal-type tenders:

| Buyer | MBD forms named |
| --- | --- |
| Dawid Kruiper LM | MBD 1, 4, 6.1, 7.1, 8, 9 (inside the single PDF) |
| Overberg DM | MBD 1, 2, 3.1, 4, 5, 6.1, 6.1(a), 7.1, 8, 9, 16 (index on p.1) |
| Cape Winelands DM | MBD 1, 4 B, 6.1, 7.1/7.2, 9 |
| uMlalazi LM | MBD 4, 6.1, 8 |
| BCMDA | MBD 4, 6.1, 8, 9 |

**But MBD 4 is an older layout than SBD 4.** Dawid Kruiper's "DECLARATION OF INTEREST" asks 3.1 full name of the bidder's representative, 3.2 ID number, 3.4 company registration number, 3.5 tax reference, 3.6 VAT, 3.8 "Are you presently in the service of the state?", and further questions about relatives - about 14 items against SBD 4's three. The engine covers the three SBD 4 core declarations and the name/registration/VAT fields; the rest stay on the completion guide as "by hand".

### 2. ESKOM uses both its own forms and SBD forms (correction to round 1, Finding 3)

Round 1's ESKOM sample only downloaded `Technical.zip` (Technical and NEC); the `Commercial.zip` and `SHEQ & Contractual.zip` of the same release were never opened. Today's ESKOM release (kitchen consumables) has 20 documents: its own Form A, Declaration of Shareholding and Directorship, Declaration of Shareholding or Beneficiaries, Supplier Declaration of Interest, Method Statement template, Annexure C3, the NEC3 contract (`.doc`) **and** an Invitation to Tender PDF containing SBD 1, SBD 4, SBD 6.1 and SBD 6.2. So "ESKOM skips SBD" is not established; what is established is that ESKOM's **own** forms dominate and have no Tender Tool template. Three of its annexures (C, D, E) are scanned images with no text layer.

### 3. Editable `.docx` SBD editions are common, and often bundled

Round 1 found `.docx` editions for Treasury only (plus RAF's SBD 6.1). Round 3: DSTI (SBD 1+4+6.1 in **one** file, "0) SBD FORMS.docx"), SSA (SBD 1/2/3.3/4/6.1/7 inside the whole tender document), SITA (SBD 1/4/6.1 in "Annexure 6a"), Mthashana TVET (SBD 1/2/4/6.1/7.1/8/9 inside the tender document), Tourism (a revised SBD 4). The round-1 filler assumed one form per file and filled the **first** matching label - wrong for every bundle.

### 4. SBD 1's bidder block and the buyer's enquiries block share labels

`TELEPHONE NUMBER` / `E-MAIL ADDRESS` / `FACSIMILE NUMBER` appear twice in SBD 1: once for the buyer's "BIDDING PROCEDURE / TECHNICAL ENQUIRIES" contacts and once for the bidder. DSTI puts the enquiries block **before** the bidder block (rows 7-11 vs 13-20), Treasury **after** it (rows 24-28 vs 10-18), and DSTI's technical-enquiries cells are **blank**. A first-match or any-blank-cell filler writes the bidder's phone into the buyer's enquiry cell. The filler now scopes bidder fields to the rows from "NAME OF BIDDER / SUPPLIER INFORMATION" to the next "ENQUIRIES" row. Read back on both layouts: enquiry cells untouched.

### 5. Four Yes/No layouts

1. A `YES/NO` cell next to the question (DSTI SBD 4 2.1-2.3);
2. separate `Yes` and `No` cells (Mthashana SBD 8 4.1-4.4);
3. `Yes   No` in one cell (SBD 1 Part B, every table edition);
4. `YES/NO` at the end of the question paragraph (Treasury, Tourism, SITA SBD 4) - or `YES or NO` (Mthashana SBD 1).

The older SBD 4 edition (Mthashana) repeats "employed by the state" in several prose bullets; only a paragraph that is the question (has a "?" or its own YES/NO) is marked, and only once.

### 6. Field labels and blanks vary inside one form family

Dots (RAF), underscores (Treasury SBD 6.1), empty cells (SBD 1 tables), a caption **below** a blank line (SBD 9 "(Name of Bidder)", Treasury SBD 6.1 "NAME OF BIDDER'S REPRESENTATIVE", Mthashana "SURNAME AND INITIALS OF REPRESENTATIVE"), "I, ......, the undersigned" vs "I, the undersigned, (name)......". DSTI pre-prints "MAAA" in the CSD number cell. Some editions simply lack fields: DSTI's SBD 1 has no TOTAL BID PRICE; SITA's SBD 1 has no TCS PIN / CSD rows ("Bidder Representative:" instead). The filler logs every field it can't place as `missing` with the reason - never writes it somewhere else.

### 7. A legacy `.doc` edition can be filled after LibreOffice conversion

RAF's SBD 4 is a Word 97 `.doc`. `soffice --convert-to docx` produces a document python-docx reads; the three declarations, declarant name, designation and bidder name were filled and read back. The manifest marks it "converted from .doc - check the layout".

### 8. Supporting documents named across 18 text sets

Count of mentions per tender (`survey.py` over the round-1/2 texts; full table kept with the run logs). The ones every buyer type asks for: CSD (16 of 18), tax compliance (15), B-BBEE certificate/affidavit (12). Municipal-only: **municipal rates account not in arrears** (BCMDA, Cape Winelands, Dawid Kruiper, Overberg, uMlalazi). Sector-specific: PSIRA (BCMDA, Dawid Kruiper), CIDB (8), public liability (5), SHE plan (5), audited financial statements (4). `requirements.py RETURNABLES` holds only keys with real hits; each item carries a verbatim quote and "required" vs "mentioned" (a must/attach/submit/non-responsive word within 200 characters).

### 9. Scanned documents

Tourism NB143's main tender PDF and three ESKOM annexures have no text layer. They are listed as "couldn't read - check by eye", never guessed at.

## What was built

### Stage 1 - requirement extraction (`engine/general/requirements.py`)

`extract_requirements(paths)` reads the document set (pdf via `pdftotext -layout`, docx via python-docx incl. tables, legacy doc via LibreOffice, zips unpacked with a zip-slip guard) and returns the manifest stored on `tenders.document_requirements`:

- `forms`: every SBD/MBD form named or present, per code, with status `auto` (an editable edition exists - filled), `by_hand` (flat PDF edition, form inside a bundled PDF, or no copy) or `attach` (SBD 2 = the TCS PIN), plus the edition documents and a quote. Edition detection uses each form's own field labels (SBD 1 needs 3 of: VAT number, TCS PIN/CSD, accredited representative/foreign supplier, postal address) - not just a mention.
- `buyer_forms`: buyer-specific forms by file name (declarations, Form A, templates, consent forms...) and in-text (Form of Quotation, Form of Offer, NEC3, Compulsory Enterprise Questionnaire, Record of Addenda, certificate of authority, declaration of shareholding).
- `returnables`, `roles` (the 17 non-SANRAL `tender_roles` codes, with a context check and an abbreviation-list filter), `cidb`, `briefing`, `scoring` (re-uses `score_outlook.estimate_score_outlook`), `experience_evidence` and `locality` (re-uses `extract_experience_evidence()` / `extract_locality()` unchanged - confirmed generic: no SANRAL assumptions in either; the SANRAL B6 fallback lives only in the app's `chooseEvidenceRule`, which the general flow does not use).
- `questions` / `company_fields`: only the ones the required forms or conditions (CIDB, compulsory briefing, JV) need.
- `gaps`: plain sentences for what can't be done for this tender.

Verified on 12 real document sets (Treasury, RAF, DSTI, SSA, SITA, Mthashana, Tourism, SANEC, SALB, QCTO, ESKOM x2, Dawid Kruiper) and pinned for 9 of them in the harness (Stage 4). False positives found and fixed along the way: SBD 4/6.1 editions mis-tagged as SBD 1 (they also say "NAME OF BIDDER"); the CSD supplier leaflet mis-tagged as SBD 8 (it names both registers); a glossary line in Treasury RT83 read as a required role; NEC3's "Employer's Project Manager" and ESKOM's "Purchaser's Safety Officer" read as bidder roles.

### Stage 2 - capture UI (Tender Workspace) + migration `0018`

- **Discovery → Workspace:** a "Prepare this tender" button on each open opportunity calls `pursue_discovered_opportunity()` (SECURITY DEFINER, membership checked first): creates or reuses the shared `tenders` row by OCDS `ocid` (family `General (non-SANRAL)`, buyer, document links, the outlook's evidence/locality rules), the company's `tender_pack`, and an `extract_requirements` job.
- **General workspace** (`general-workspace.tsx`, mounted instead of the SANRAL compliance report for this family): what the tender needs (forms with filled-for-you / by-hand chips, the buyer's own forms, the gaps banner, preference/functionality/CIDB/briefing chips); supporting documents checked against the vault on the closing date with an inline "Upload for this tender" slot where the vault has no field; one "Questions only you can answer" form (signatory from People, total bid price, SBD 1 Part B, SBD 4, SBD 6.1 points claimed, SBD 8, JV, briefing - only those this tender's forms need; company telephone/cellphone/e-mail/CIDB saved to the company, asked once); roles named with who is tagged; experience against **this tender's** rule (never SANRAL B6 here); locality; and the pack card.
- **Migration `0018_general_tender_preparation.sql`:** `tenders.buyer/ocid/source/document_urls/document_requirements`, `discovered_opportunities.description`, `companies.telephone/cellphone/email/cidb_grading`, `tender_answers` (tenant + tender scoped, RLS `is_company_member`, path-prefix check on uploads), `tender_engine_jobs` (insert-only for clients, one open job per company/tender/kind), `pursue_discovered_opportunity()`.

### Stage 3 - generation bridge (`build_general_pack.py`, `process_general_jobs.py`)

- `fill_sbd_docx.fill_sbd_document()` (same file, round-1 functions untouched) fills SBD/MBD 1, 4, 6.1, 8, 9 in any editable edition, bundles included, from the company row, the chosen signatory and the human's answers; every field goes through `ProvenanceLog`.
- `build_general_pack()` orders: completion guide (every SBD/MBD field with the value to write, for filled and by-hand forms) → filled forms → blank by-hand editions → the bundled tender document when its forms are done by hand (municipal PDFs) → the buyer's own forms as published → vault documents and this tender's uploads → experience evidence the tender's rule accepts → CVs of people tagged for the roles named. Merged with the SANRAL side's `engine/pack/pdf_merge.py` (reused, not copied): contents page with a "not included" table, page stamps, bookmarks, and `verify_pack()` read-back.
- `process_general_jobs.py` (bridge contract `--once`/`--loop`, registered in `engine/worker/run_bridges.py` as `general`): atomic claim, downloads the buyer's documents, extraction writes `document_requirements` (+ `evaluation_rules` when empty or from the outlook), pack generation uploads to `submission-packs/<company>/tenders/<tender>/<job>/`, writes `field_provenance` (so the existing readiness report lights up), and is only marked ready after the read-back passes.
- **No SBD/MBD forms (ESKOM):** the pack still builds - completion guide, the company documents in the tender's order, the buyer's forms listed by hand - and the gap is stated on the page and in the pack.

### Stage 4 - regression coverage

- `engine/general/general_harness.py`: 9 real samples x 3 test companies; per sample an `EXPECTED` block read by hand from the documents (suite, which forms are auto/by hand, key returnables, roles, mandatory local office, buyer forms); full pack built and read back; provenance/section shape baselined and flagged on change.
- `engine/general/test_general_bridge.py`: the bridge end to end against an in-memory Supabase fake, real documents as download links.
- Both added to `.github/workflows/bridge-worker-ci.yml`.

## Verification (Observed)

- **Fill read-back on 9 real editions** (Treasury SBD 1/4/6.1, RAF SBD 6.1 + converted .doc SBD 4, DSTI bundle, SSA, SITA, Mthashana, Tourism): values counted in the re-opened `.docx`; SBD 1 table dumped row by row on Treasury and DSTI - bidder block filled, enquiry blocks untouched, CSD "MAAA" prefix replaced, B-BBEE affidavit box marked, Part B "[X] No". Mthashana paragraph edition checked line by line after fixing two real bugs (the old SBD 4's prose bullets got "(No)" appended; "Full Name of bidder or his or her representative" got the company name spliced in mid-sentence).
- **Pack read-back**: DSTI (20 pages, 8 sections, verify OK, company name in the text 6x), Dawid Kruiper (52 pages incl. the 44-page bundle, MBD forms listed by hand, verify OK). Pages rendered to PNG and looked at: filled SBD 1 and the completion guide.
- **Bridge end to end** (`test_general_bridge.py`, 22 checks, all pass): extraction → manifest; pack → PDF uploaded under the right prefix, page count matches, filled `.docx` read back for name/VAT/TCS PIN/CSD/signatory, an SBD 4 "Yes" answer stored as confirmed Yes, DSTI's missing bid-price field logged missing (not written elsewhere), claimed jobs left alone, pack-before-extraction fails with a reason, ESKOM builds with its forms listed by hand.
- **Harness**: 27 runs (9 samples x 3 test companies): all manifest expectations met, every pack passes `verify_pack`; a second full run matched all 27 stored baselines (0 flagged, 0 failed).
- **Migration replay** `0001`→`0018` on scratch Postgres 16 (same auth/storage stub as earlier passes): all apply. RLS/function tests: a member pursues their own opportunity (tender + pack + one job), not another company's (error); re-pursuing is idempotent; a second company pursuing the same ocid reuses the shared tender; clients can't write `tenders`; answers upsert; cross-company answer rejected; an upload path outside the company/tender prefix rejected; an empty answer rejected; a second open pack job rejected by the partial unique index; a pre-completed job rejected by the insert policy; client updates to jobs change 0 rows; the other company sees 0 answers/jobs.
- `npm run typecheck` / `npm run lint` clean.

## Round 4 (Oct 17, 2026): flat-PDF forms, buyer-form templates, one job queue

Asked: (1) decide whether coordinate-overlay filling of flat municipal MBD PDFs is buildable and reliable, and build it if so; (2) build templates for the 1-2 buyer-specific forms that matter most to Klipcorp, backlog the rest; (3) an "upload my own tender documents" path; (4) merge `tender_engine_jobs` into `pack_generation_jobs`.

### Corpus added (Observed)

`etenders_national.py --days 30` on 2026-10-17: 100 releases. Buyer mix: 20 municipalities (Cape Winelands x4, Ingquza, Umzinyathi x2, Dawid Kruiper, Ratlou, uMlalazi, Stellenbosch, Overberg, Nama Khoi, Kareeberg, Joe Gqabi, MISA...), 7 ESKOM, 4 Transnet/TNPA, 3 PRASA, 2 Sentech, 10 departments, the rest entities/SETAs. Every document of the 52 municipal / SOE / roads / engineering releases was downloaded (132 files) and read.

### Finding 10 - fixed x/y coordinates can't work; label-anchored placement can

The same MBD 1 is laid out differently by every municipality (measured with pdfplumber on the real pages):

| Buyer | MBD 1 layout |
| --- | --- |
| Dawid Kruiper | ruled table, label column ends ~95pt, value cells from 116pt; Part B on the next page |
| Umzinyathi | ruled table under a letterhead (~40pt lower), value cells from 200pt |
| Joe Gqabi | table without a left grid; B-BBEE tick boxes; "R" pre-printed in the bid-price cell |
| Nama Khoi | labels wrap ("TELEPHONE / NUMBER", "VATREGISTRATION" glued); the E-MAIL row has no right-hand rule; Yes/No boxes BELOW the words |
| Cape Winelands | "MAAA" pre-printed in the CSD cell; a contact-person row |
| Ingquza / Overberg / TNPA | Part B's two questions share one row, split into sub-rows |
| Ratlou | separate one-form PDFs |

MBD 4 varies the same way: ruled two-column table (Overberg, Cape Winelands), dotted leaders on the same line (Ingquza, Kareeberg, Dawid Kruiper, Joburg Water), dotted leaders on the NEXT line (uMlalazi). MBD 9: underscored lines with the caption below (Ingquza, uMlalazi, Joe Gqabi, Kareeberg), or the bid and municipality already printed by the buyer (Dawid Kruiper, Overberg). So a per-form x/y template is wrong on the next municipality. What is consistent is the **wording of the labels** - they're all copies of the same Treasury/MFMA forms. The overlay therefore anchors every value to its label in the PDF's own text layer.

### Built - `engine/general/fill_flat_pdf.py`

- Finds each form's page (heading in the top lines + its own field labels - a contents page that lists "MBD 1" doesn't count), then places each value in one of four layouts: the first **empty table cell** right of the label (pdfplumber's table finder; CODE/NUMBER split for telephone; text after a pre-printed "MAAA"/"R"; the row's blank width when a cell has no right rule), **dotted leaders** on the same line (white patch under the text, extended into blank margin when the dots are short), dots on the **next line**, a **drawn underline** (TNPA), or the dotted line **above a caption** ("(Name of Bidder)", "Position"). Yes/No answers are an X in the box next to / below the chosen word, or a circle round it ("YES / NO").
- Safety rules: only provably blank targets; text that doesn't fit at 6pt isn't written; two fields aimed at the same spot -> neither is written; the buyer's own pre-print is detected and left; the Form of Offer is searched only up to the ACCEPTANCE heading and only one signature block; every typed value is **read back from inside its own box** in the written PDF before it counts. Anything not placed is reported with the reason and stays on the completion guide.
- Forms: MBD/SBD 1 (name, postal/street address, contact person, telephone, cellphone, e-mail, VAT, TCS PIN, CSD, total bid price if answered, capacity, accredited-representative / foreign-supplier / B-BBEE certificate-or-affidavit ticks), MBD/SBD 4 (registered name, representative name, ID number, position, company registration, tax reference, VAT, CSD, "I, the undersigned (name)", the "presently in the service of the state" Yes/No, footer name/capacity), MBD/SBD 9 (bid number and description, institution, "on behalf of", position). 6.1 and 8 stay by hand (6.1's points table is buyer-specific; 8's Yes/No are captured but MBD 8 layouts weren't sampled enough to commit to).
- Wiring: `requirements.py` marks such a form `overlay` (new status, "Typed onto the PDF" chip on the workspace) once the form's page is found; `build_general_pack.py` types onto one copy per PDF, puts the typed copy in the pack in place of the blank, lists what's still to write per form, and logs every field in `field_provenance` (typed -> confirmed / assumed_default; not placed -> missing with the value to write).
- Dependency: `pdfplumber==0.11.10` added to `engine/worker/requirements.txt` (positions of words, characters, table cells and drawn lines - neither pypdf nor pdftotext gives cells). Writing uses pypdf + raw PDF operators, same as `pdf_merge`'s page stamp.

### Finding 11 - which buyer forms matter to Klipcorp (evidence, not guesses)

Klipcorp's profile disciplines are `roads_civil` and `professional_services`. Counts over the 52 downloaded municipal/SOE/roads/engineering releases (text search of every document):

| Buyer-specific form | Releases | Where |
| --- | --- | --- |
| **Form of Offer and Acceptance** (CIDB SANS 10845 / Standard Conditions of Tender) | **16** | every construction/PSP tender seen: EC Roads PSP, uMlalazi roads, MISA, TNPA x2, Overberg, Cape Winelands x4, Sentech x2, ESKOM |
| **Compulsory Enterprise Questionnaire** (CIDB returnable) | **7** | EC Roads PSP, MISA, TNPA x2, Overberg, Ingquza x2 |
| Certificate / resolution of authority for signatory | 7 | Gauteng Roads, EC Roads, MISA, uMlalazi, Ingquza x2, Sentech |
| ESKOM Form A / declarations of shareholding | 8 / 3 | ESKOM only (goods: gearboxes, kitchen consumables, data concentrators) |
| Record of Addenda | 6 | same CIDB tenders as the Form of Offer |
| Consent forms | 5 | Joburg Water x3, Sentech x2 |
| NEC3 contract | 4 | ESKOM, TNPA, MISA |
| Municipal "Form of Quotation" | 1 | Dawid Kruiper |

Built (same overlay engine, as field maps over the buyer's own published form - the bidder must return the buyer's page, so a re-typed "template" would be wrong): **Compulsory Enterprise Questionnaire** (company-constant fields: name, VAT, CSD, company registration, tax reference, contact person, e-mail, telephone, cellphone, physical/postal address, bank and branch; tender/human fields left: CIDB registration number (no column yet), partner/principal particulars, bank account number, signature) and the **Form of Offer offer signatory block** (signatory name, capacity, tenderer name, address, telephone; left: the offered price in words and figures, signature, witnesses, and the whole Acceptance part). Verified on Overberg (CEQ 12 fields, offer 4), EC Roads PSP (CEQ 4, offer 2), TNPA (CEQ 5 on drawn underlines), uMlalazi (offer 5), Cape Winelands (offer 3).

**Backlog, in priority order:** (1) Certificate of authority for signatory - 7 releases, but it's a board resolution with directors' signatures, mostly by hand; worth only the company/signatory names. (2) Record of Addenda - 6, a table of addenda numbers only the bidder knows; low value. (3) ESKOM Form A + shareholding declarations - 8 ESKOM releases, none in Klipcorp's disciplines this month; several ESKOM annexures are scans. (4) Consent forms (Joburg Water / Sentech) - 5. (5) NEC3 contract data - 4, mostly tender-specific. (6) Municipal Form of Quotation - 1 sighting; not worth a template yet.

### Item 3 - "upload my own tender documents"

Landed concurrently by the manual-tender-load work (`8945b0b` / `487b964`: `/tenders/new`, migration `0024`, `engine/intake/`): documents go straight from the browser to `tender-documents/manual/<company>/<tender>/`, `process_general_jobs.py` downloads storage-backed documents, and the extraction job runs the same `requirements.py` -> manifest -> `build_general_pack.py` pipeline. Nothing was duplicated here; the overlay and the buyer-form maps apply to manually loaded tenders automatically because they live in that shared pipeline.

### Item 4 - one job queue (migration `0026_unified_job_queue.sql`)

`pack_generation_jobs` gains `engine` ('sanral' default | 'general') and `kind`; `tender_pack_id` is nullable for general rows only (check constraint); 0018's one-open-job unique index moves here with the same predicate; RLS = select + strict insert for all, update/delete kept for SANRAL rows as 0017 had them. Existing `tender_engine_jobs` rows are copied (same ids), the table dropped, and `tender_engine_jobs` recreated as a security-invoker view (`engine = 'general'`, inserts default to general, `with cascaded check option`) so 0024's `load_manual_tender()` / `add_manual_tender_documents()` / `pursue_discovered_opportunity()` and `intake-card.tsx` keep working unchanged. `process_pack_jobs.py` claims only `engine = 'sanral'` rows (poll + stale-job sweep), `process_general_jobs.py` only `engine = 'general'` rows of the same table; the app's general workspace reads/writes `pack_generation_jobs` directly.

### Verification (Observed)

- Overlay on 15 real flat PDFs from 14 buyers (Dawid Kruiper, Umzinyathi, Joe Gqabi, Nama Khoi, Cape Winelands, Overberg, Ingquza, Kareeberg, uMlalazi, EC Roads PSP, MISA, TNPA, Joburg Water, Ratlou, plus SALB's committed SBD 1/4/9): placed per form, e.g. MBD 1 = 13 / 12 / 15 / 12 / 15 / 15 / 13 fields (DK, UZ, JG, NK, CW, Overberg, Ingquza), MBD 4 = 9 on six of them, CEQ 12 (Overberg). Every placed value read back from its own box. Pages rendered at 60-110 dpi and checked by eye for 13 buyers; bugs found and fixed that way: telephone in the CODE cell, "R"/"MAAA" pre-print overwritten, a SANAS line read as the accredited-representative question, two Part B ticks in one box, a "Position occupied..." sentence taken as a footer caption, a prose line above an underline taken as the buyer's pre-print, the Form of Offer scope closed by "acceptance and returning" in the offer text. Known not-placed (stay on the guide, correctly): TNPA's TCS PIN / CSD split over three lines, EC Roads' wrapped TCS label, Nama Khoi's e-mail row, MISA's form of offer (price-only page).
- Full pack on Overberg Q12: 69 pages, `verify_pack` clean, the typed bundle in the pack (MBD 1 on p.6 renders typed, with the page stamp), provenance 37 confirmed / 1 assumed (foreign supplier = No) / 21 missing.
- `general_harness.py`: 2 samples added (`overberg_q12`, `ecdpwi_scmu5_0007`), expectations extended with `overlay` forms, typed buyer forms and `typed_keys` that must come back confirmed from the typed PDF for every test company.
- Migration replay `0001`->`0026` on scratch Postgres 16; `0026` applied over seeded rows of both old tables (rows moved with ids, duplicate open SANRAL jobs failed-not-deleted); RLS/constraint tests (SANRAL row without pack / with extract kind rejected; second open job per engine/kind rejected; insert through the view lands as `general`, `engine='sanral'` through the view rejected by the check option; ON CONFLICT through the view is a no-op; client updates change 0 general rows and 1 SANRAL row; pre-completed insert rejected; other company sees 0 rows and can't insert); 0024's `load_manual_tender()`, `add_manual_tender_documents()` and `pursue_discovered_opportunity()` run against the view and queue exactly one open extraction each; `engine/pack/bridge_selftest.py` (SANRAL bridge, real SQL) still goes `requested`->`ready` (63-page pack) on the unified table.

## Gaps - named, not papered over

1. ~~Flat-PDF SBD/MBD editions are completed by hand~~ - **narrowed (Round 4)**: MBD/SBD 1, 4 and 9 are typed onto the printed PDF next to their labels (`fill_flat_pdf.py`). Still by hand: MBD/SBD 6.1 and 8 in flat editions, any field the overlay couldn't place safely (listed per form in the pack), scanned editions with no text layer, and the human check of every typed page before signing.
2. **Buyer-specific forms - narrowed (Round 4)**: the CIDB Compulsory Enterprise Questionnaire and the Form of Offer signatory block are typed onto the buyer's own PDF. Still no template: certificate of authority, Record of Addenda, ESKOM Form A / declarations / Method Statement / NEC3, consent forms, municipal Form of Quotation, QCTO CV template, Treasury's Category Selection form - prioritised backlog in Round 4, Finding 11.
3. **MBD 4's extra questions**: ID number, tax reference and "presently in the service of the state" are now typed (Round 4); the relatives / twelve-months / directors questions (3.9-3.14) and the directors table aren't captured. SBD 8 is filled only in `.docx` editions.
4. **SBD 6.1's specific-goal points table is not ticked** - each buyer's table differs; the claim is captured and written on the guide.
5. **Pricing** (SBD 3.x / bills of quantities) is never filled - by design.
6. **Experience scope** is judged by a human: all tagged disciplines are counted against the tender's evidence rule; "similar scope" is shown verbatim.
7. **No live Supabase** (System-Status gap #9): the web flow is typechecked and its logic run against real manifests, the bridge runs against a fake and the schema against scratch Postgres - never against a real project.
8. ~~Tenders not on eTenders can't be pursued~~ - **closed** by the manual tender load (`/tenders/new`, migration `0024`), which feeds the same extraction and pack pipeline (Round 4, item 3).
9. **Scanned tender documents** are not OCR'd - and the overlay needs a text layer, so a scanned form stays fully by hand.
10. **Overlay placement is checked by machine (read-back) but signed by a person**: the read-back proves the text is in the target box, not that the box is the right one on a layout nobody has seen yet. The pack says "check, then sign" on every typed form, and the harness pins 4 real municipal/PSP layouts.
11. **CIDB registration (CRS) number has no column** - the CEQ asks for it; `companies.cidb_grading` is the grading, not the number.
