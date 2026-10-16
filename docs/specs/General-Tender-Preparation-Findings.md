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

## Gaps - named, not papered over

1. **Flat-PDF SBD/MBD editions are still completed by hand** (SALB, QCTO, every municipal bundle). The completion guide gives every value; no coordinate overlay is attempted (round 1, Finding 2 still holds). This is the single biggest remaining manual step for municipalities.
2. **Buyer-specific forms have no templates**: ESKOM Form A / declarations / Method Statement / NEC3, municipal Form of Quotation, Sentech consent form, QCTO CV template, Treasury's Category Selection form. Each would need its own importer from real samples.
3. **MBD 4's extra questions** (ID number, tax reference, relatives in the service of the state) aren't captured; SBD 8/9 are filled only in `.docx` editions.
4. **SBD 6.1's specific-goal points table is not ticked** - each buyer's table differs; the claim is captured and written on the guide.
5. **Pricing** (SBD 3.x / bills of quantities) is never filled - by design.
6. **Experience scope** is judged by a human: all tagged disciplines are counted against the tender's evidence rule; "similar scope" is shown verbatim.
7. **No live Supabase** (System-Status gap #9): the web flow is typechecked and its logic run against real manifests, the bridge runs against a fake and the schema against scratch Postgres - never against a real project.
8. **Tenders not on eTenders** (or whose links fail) can't be pursued - there is no "upload the tender's own documents" path yet.
9. **Scanned tender documents** are not OCR'd.
