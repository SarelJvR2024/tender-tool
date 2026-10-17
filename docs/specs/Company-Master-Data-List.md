# Company Master Data List

2026-10-17. Research and specification only: nothing in the schema, onboarding or the Company page was changed by this pass.

Sarel, 2026-10-17: *"Let's build a master data list of all information that should be collected in the system as part of onboarding. Everything that we need as a full set of documents and information about a company that the engines would need to compile any tender ... go through all the tenders currently open ... read through all of them, pick up all the requirements for each of the tenders ... also per tender, and then let's start looking at categorizing the tenders, which service or services or products each of those tenders fall into."*

This document is that list, built from 123 tenders that were open on eTenders today. It is meant to be the spec a later task uses to extend onboarding and the Company page, and the checklist Sarel fills in with Klipcorp's real information.

**How to read it:**

- **Section 3 is the master list.** It has 85 items in 13 categories. Each item shows:
  - what buyers actually ask for;
  - how many sampled tenders and buyers asked for it, with each one cited;
  - where it lives in today's schema;
  - whether that home is complete, partial, or a **GAP**.
- **Section 4** ranks the gaps to close first.
- **Section 5** covers requirements that are tender-specific but recur often enough to model.
- **Section 6** categorises every sampled tender, cross-checked against the discipline taxonomy that landed on `main` today (`a9a5364`).
- **Appendix B** holds the per-tender notes every count is built from.

Builds on, and does not repeat: `General-Tender-Preparation-Findings.md` (25 + 52 tenders, forms and returnables), `Tender-Evaluation-Engine-Audit.md` (evidence and locality rules from 14 buyers), `Experience-Library-Findings.md`, `CV-Engine-Findings.md`, `Hardcoded-Assumptions-Audit.md`, `Discipline-Taxonomy-Findings.md`.

---

## 0. Summary

- **Sample.**
  - **123 open tenders** from **102 buyers**, pulled live from the OCDS feed today.
  - **104 were read in full**: 93 from their text layer and 11 by OCR of scanned PDFs.
  - **14 published only a newspaper advert** on eTenders.
  - **5 couldn't be reached at all.** Four City of Tshwane tenders are only on SAP Ariba, which needs registration; one Western Cape TPW tender is a pointer to a helpdesk e-mail.
  - The 104 read tenders come from **88 buyers, 73 of which were never sampled before** in any findings doc.
  - **Mix:** 39 municipal tenders (incl. municipal entities), 19 provincial, 13 national departments, 31 national public entities, 21 SOEs.
  - **Work types:** cleaning, security, IT, audit, health, food, leases, waste, training, events, valuation, mediation, pharmaceuticals, construction, consulting engineering and more. Roads/civil is 10 of 123.
- **What the read was.** Every tender's returnable, mandatory, administrative-compliance, functionality and specific-goals sections were read by hand and noted (Appendix B). `engine/general/requirements.py` was run on every tender too, and its automated returnables were compared with the hand read (§2.3). It finds the 10-15 standard items reliably, but misses most of what is buyer- or sector-specific.
- **What the list is.** 85 distinct company-level items across 13 categories (§3):
  - **13 have a complete home** in today's schema;
  - **22 are partial**;
  - **49 are a genuine GAP**;
  - **1 is answered per tender by design.**
- **Biggest structural finding.** The schema models a company as **one director** (`companies.director_name` / `director_id_number`) and **one ownership number** (`black_ownership_pct`). Real tenders ask for a full **directors / members / shareholders register**:
  - names, ID or passport, nationality, gender, race, % held, and executive or not;
  - each person's certified ID, municipal account and qualifications;
  - ownership split by **black, women, youth and disabled** for specific goals.

  Across the sample this is the most-asked family that has no home: 28 tenders want certified director/shareholder IDs, 18 ownership %-by-group, 13 a shareholder register and 11 a directors table. It also blocks automatic specific-goals claims.
- **Top gaps by reach** are in §4. In short:
  1. directors/shareholders register;
  2. CIPC registration documents;
  3. municipal rates & taxes per company **and per director**;
  4. CSD report document;
  5. B-BBEE proof variants and ownership %;
  6. authority-to-sign resolution in the general pack;
  7. CIDB CRS number and multi-class grading;
  8. buyer supplier-database registrations;
  9. a generic registrations/licences store for company and people (PSIRA, SARACCA, ICASA, HPCSA, waste and pest permits ...);
  10. public liability and other insurance;
  11. plant/vehicle register;
  12. financial statements and turnover.
- **Two findings for other work:**
  - **SANRAL publishes some full tender packs on eTenders, no CAPTCHA.** N.011-010-2027/1F came as a zip with Book 1, Books 2 & 3, the Technical and Financial `.xlsm` and a `.docx` Returnable Schedules. Its A-form set differs from R.396's, e.g. new A5 DPIP/FPPO and A18 "registered FSP letter and bank details" (§7.1).
  - **OCDS buyer names can be wrong.** `ocds-9t57fa-174039` is filed under "Abaqulusi Local Municipality", but its document is the **Mpumalanga Economic Regulator's** MER/T01/2027 (§7.4).

---

## 1. The sample

### 1.1 How it was fetched

- **Feed.** `engine/discovery/etenders_national.py fetch_releases()` was called in 3-day windows going back 45 days.
  - The API answered for the most recent windows: **500 releases, 464 still open.**
  - Older windows returned HTTP 500 on page 1, the upstream limit the module already documents.
- **Selection.** From the 464 open releases, 123 were chosen by hand for breadth:
  - at most a few per buyer, preferring buyers never sampled before;
  - a spread across buyer types and kinds of work;
  - "publication of bidders", regret letters and intention-to-award notices skipped.
- **Download.** All 287 documents were downloaded from `etenders.gov.za/home/Download`: pdf, docx, doc, zip, xlsx, 305 MB. A few needed retries after connection resets; all succeeded.
- **Reading.**
  - Text came from `requirements.read_document()` (pdftotext, python-docx, LibreOffice for `.doc`, zip unpacking).
  - One ESKOM `.docx` crashed python-docx (bad XML) and one `.doc` was read through LibreOffice separately.
  - Scanned PDFs were OCR'd with Tesseract 5 at 150 dpi, one thread per page, the same engine as `engine/ocr/scan_ocr.py`.
- **Scratch work.** Scripts, raw texts and manifests are in the session scratchpad. They are not committed: they contain buyers' documents and are reproducible from the OCIDs in Appendix B.

### 1.2 Who is in it

| Buyer type | Tenders | Distinct buyers | Examples |
|---|---|---|---|
| Municipal (local, district, metro, municipal entities) | 39 | 29 | City of Cape Town, City of Johannesburg, City Power, CTICC, ERWAT, Joburg Market, Tshwane, George, Mossel Bay, Metsimaholo, Nkangala, Sekhukhune, Gert Sibande, Umzimvubu, Elundini, Ndlambe, Garden Route, Moqhaka |
| Provincial (departments and provincial entities) | 19 | 17 | EC Agriculture, EC Health, Coega DC, Gauteng COGTA, KZN Human Settlements, KZN Public Works, Limpopo Premier, MEGA, Mpumalanga Social Development, NW Public Works, Tygerberg Hospital, WC Mobility, Ezemvelo, Mpumalanga Economic Regulator |
| National departments | 13 | 12 | Defence, Correctional Services, Health, Agriculture, DALRRD, DWS, National Treasury, SARS, SIU, The Presidency, Border Management Authority |
| National public entities (incl. SETAs, councils, TVETs) | 31 | 28 | CSIR, CGS, NRF, NMISA, NHBRC, NLC, SANAS, SABS, SANParks, SAHRA, SASSA, RAF, Legal Aid, MRC, QCTO, CATHSSETA, ETDP SETA, merSETA, SASSETA, SA Tourism, SAWS, WRC, Iziko, Land Bank, South Cape TVET |
| SOEs (incl. water boards) | 21 | 16 | ACSA (4), ATNS, ESKOM (2) + NTCSA, Transnet (2) + TNPA, PRASA, SAA, SAPO, SANRAL, CEF, TCTA, IDC/Foskor, Amatola Water, Lepelle Northern Water, Rand Water |

OCDS `mainProcurementCategory` of the 123: services 51, blank 39, works 19, goods 14.

### 1.3 What couldn't be read, and why

Named so that no buyer's requirements are skipped silently.

| What | Tenders | Why | Effect on this list |
|---|---|---|---|
| **City of Tshwane**, 4 tenders | t018-t021 | The eTenders file is "Notice 6 of 2026/27". Tshwane now publishes bid documents **only through SAP Ariba Business Network**, which needs a supplier registration. The notice gives only CIDB grades (6CE for WSBU 01, 3ME for GPM 18) and briefings | Tshwane's returnables aren't in the counts. **Discovery can't download Tshwane documents through the open-data path at all**, a real limit for metros moving to e-procurement portals |
| **Western Cape TPW** | t122 | "TENDER DOCS.docx" is a one-line pointer to a helpdesk e-mail (same as Round 3 found) | Not counted |
| **Advert-only releases**, 14 | t008, t009, t013, t017, t035, t039, t051, t059, t060, t065, t072, t085, t108, t109 | The buyer posted only the newspaper advert. Full documents are **sold** (fee + proof of payment), collected at buyer offices, e-mailed after payment or posted elsewhere (consultant's office, municipal website). 6 adverts are scans | Only what the advert states was used (CIDB grade, TCS PIN, VAT proof, vehicles in the bidder's name, compulsory meetings). It is never counted as the full returnable list |
| **Scanned annexures inside otherwise-readable sets** | ESKOM NTCSA Annex C/D/E (t040); 3 of Hessequa's 4 files (t047) | No text layer. Not OCR'd: the main documents of these sets were readable | Small; standard ESKOM/municipal annexures already seen elsewhere |
| **SANRAL's own site** | - | Not used: its download form is reCAPTCHA-gated (Deep-Dive doc). **One SANRAL tender came through eTenders with its full pack instead** (t099, §7.1) | SANRAL's requirements are covered by t099 plus the 6 earlier samples |
| **OCR quality** | 11 tenders | Tables come out jumbled and a few words misread ("B-BBEF", "4ij"). Every requirement taken from OCR text was read in context, and none is counted on a single garbled word | Counted, marked `read: ocr` in Appendix B |

Coverage was not a problem: no tender was dropped for size, format or language. George is bilingual Afrikaans/English and was read in English.

---

## 2. Method

### 2.1 What counts as a company-level item

**Company-level** means true of the company whatever the tender: registrations, certificates, people, ownership, finances, experience, premises, standing declarations.

**Tender-specific** means price, programme, methodology, this project's key-person allocation, a site-visit certificate, or this tender's addenda. Those are left out, except where the same kind of requirement recurs often enough to model (§5).

A few items sit in between: specific goals, locality, SBD 4 answers. They are listed in §3 where the **data** is company-level, even though each tender **scores** it differently.

### 2.2 How each tender was read

Each tender was handled the same way:

1. Locate its returnable list, mandatory / eligibility / administrative-compliance table, functionality table and specific-goals table. These are the T2.1 schedules in CIDB-format tenders, "Phase 1/2" tables in departmental RFQs, ESKOM's "List of Tender Returnables" and SANRAL's A/B forms.
2. Read those sections line by line.
3. Note every company-level ask with its qualifiers (validity window, certification age, issuer, "in the company's name", "for each director").

Notes are in Appendix B. Counts in §3 come only from tenders where the ask was read. An item is **never** inferred from the tender type.

For the universal standard-form data (legal name, CSD, TCS, SBD 4 declarations), the hand tags are backed by the forms the documents contain:

- **SBD/MBD 4** in 91 of the 104 text-readable sets;
- **6.1** in 85;
- **1** in 78;
- **9** in 25;
- **8** in 24;
- **5** (>R10m declaration) in 14;
- **6.2** (local content) in 7.

### 2.3 Hand read vs `requirements.py` (cross-check)

The automated manifest was compared with the hand read on 18 tenders: ATNS, ACSA RFQ12076, Amatola Water, CTICC, City Power, CGS, CSIR, ESKOM HVAC, EC Agriculture security, Coega, Gauteng COGTA, Lepelle, Metsimaholo, Nkangala, SAA, SAPO, SARS, South Cape TVET.

**What it gets right.** `find_returnables()` reliably finds CSD, tax compliance, B-BBEE proof, COID, CIDB, CIPC documents, municipal account and bank letter when they're required.

**What it misses entirely** (it has no key for them):

- PSIRA, UIF and bargaining-council letters, firearm licences, police clearance and the office-for-one-year rule (EC Agriculture security);
- the SARACCA registration, commissioner-certified trade tests, the organogram with names and IDs, and vehicle registration papers (ESKOM HVAC);
- the whole SAA vendor form (account number, TCC dates, B-BBEE certificate number, % black women / disabled ownership, turnover);
- the SARS financial-risk questionnaire;
- the shareholding breakdown by race and gender (CGS, South Cape TVET);
- NCCA/BEECA membership and the local-footprint proof (ATNS);
- ICASA and authorised-ISP proof (Amatola Water).

**False or weak hits:**

- `jv_agreement` comes back "required" in nearly every tender, because the JV clause is conditional;
- `cidb` fires on the CIDB Standard Conditions of Tender boilerplate even when no grading is required (City Power as "required"; Nkangala as a mention);
- `pi_insurance` fires on GCC text (ATNS).

**Verdict.** It is a good first pass for the vault's six documents, but it isn't a requirements reader for anything else. §8 suggests how the master list should feed it.

---

## 3. The master data list

**Columns:**

- **Asked for by:** "**n / b**" = n sampled tenders from b distinct buyers whose own documents ask for the item, split by buyer type, then the tenders cited (short label + sample id; full labels and OCIDs in Appendix B).
- **Where it lives today:** checked against the migrations on `main` (`0001`-`0040`), not guessed.
- **Status:**
  - *Has a home*: a field exists and holds the item as tenders ask for it;
  - ***Partial***: a field exists but misses part of what tenders ask (e.g. a number but no document, one director instead of all);
  - ***GAP***: no table or column holds it;
  - *Per tender*: deliberately answered per tender (`tender_answers`).

**Schema baseline used** (all read from the migration files):

- `companies`: 0001 + 0014 vault + 0018 contacts/CIDB + 0030 `how_we_work`.
- `people`: 0001 + 0035 expiries + 0036 `employment_status` + 0040 SACNASP/SAGC.
- `projects` (person CV history).
- `experience_items`: 0012, disciplines opened by 0036.
- `company_offices`: 0015.
- `company_document_templates`: 0037, open `document_type` slug; only `authority_to_sign` is wired.
- `cv_uploads` / `generated_cvs`: 0008.
- `person_role_eligibility`: 0016.
- `tender_answers`: 0018, per tender.

### A. Legal identity, directors and ownership structure

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| A1 | Registered (legal) name | **100 / 85** (municipal 22, provincial 16, national 13, public_entity 30, soe 19): MER (Mpumalanga Economic Regulator) MER/T01/2027 (t000); ATNS RFP15/06/2026/27 (t001); ACSA ORTIA8160/2026 (t002); ACSA COR8138/2026 (t003); ACSA RFQ 16820 (t004); ACSA RFQ12076 (t005); Amajuba DM Q2026/10 (t006); Amatola Water AW2026/27/04 (t007); plus t010, t011, t012, t014, t015, t016, t022, t023, t024, t025, t026, t027, t028, t029, t030, t031, t032, t033, t034, t036, t037, t040, t041, t042, t043, t044, t045, t046, t049, t050, t052, t053, t054, t055, t056, t057, t058, t061, t062, t063, t064, t066, t067, t068, t069, t070, t071, t073, t074, t075, t076, t077, t078, t079, t080, t081, t082, t083, t084, t086, t087, t088, t089, t090, t091, t092, t093, t094, t095, t096, t097, t098, t099, t100, t101, t102, t103, t104, t105, t106, t107, t110, t111, t112, t113, t115, t116, t117, t118, t119, t120, t121 | companies.legal_name | Has a home |
| A2 | CIPC registration documents (COR14.3 / certificate of incorporation / CK1-CK2), certified, showing active directors and ownership | **34 / 32** (municipal 9, provincial 6, national 4, public_entity 10, soe 5): MER (Mpumalanga Economic Regulator) MER/T01/2027 (t000); ACSA COR8138/2026 (t003); ACSA RFQ12076 (t005); Amajuba DM Q2026/10 (t006); City of Johannesburg COJ0011-26/27 (t014); Council for Geoscience CGS-2026-046NM (t023); CATHSSETA CATHS/QAS/02/2026 (t026); Dept of Defence CPSC/B/365/2026 (t027); plus t028, t036, t038, t042, t045, t049, t050, t057, t058, t061, t062, t064, t066, t070, t071, t080, t084, t087, t090, t091, t093, t094, t101, t106, t117, t118 | - (no document field; System-Status lists CIPC in vault scope but 0014 has no column) | **GAP** |
| A3 | Certified ID copies of all directors / members / owners / shareholders (certification age rules) | **28 / 27** (municipal 10, provincial 5, national 5, public_entity 3, soe 5): ATNS RFP15/06/2026/27 (t001); ACSA RFQ12076 (t005); Amajuba DM Q2026/10 (t006); CTICC 009/2027 (t012); City Power JHB BID-2656S (t015); Correctional Services KZN 05/2025 (t022); Dept of Defence CPSC/B/365/2026 (t027); DALRRD RQ-016988 (t028); plus t036, t038, t042, t044, t045, t050, t054, t057, t066, t070, t071, t080, t084, t087, t090, t093, t094, t101, t103, t117 | - (no per-director document storage) | **GAP** |
| A4 | Company / CC registration number (CIPC) | **19 / 18** (municipal 8, provincial 3, national 3, public_entity 4, soe 1): CTICC 009/2027 (t012); Dept of Defence CPSC/B/365/2026 (t027); George LM GMQ010 (t043); Gert Sibande DM GSDM 07/2026 (t045); National Dept of Health HP08-2026SSP/01 (t046); Iziko Museums (t049); KZN Public Works ZNTM01233W (t054); Limpopo Office of the Premier PRDP 01 (t058); plus t061, t066, t077, t081, t082, t083, t089, t090, t093, t099, t121 | companies.cipc_registration_number | Has a home |
| A5 | Shareholders register: names, ID numbers, % held, race, gender (incl. non-individual shareholders); share certificates | **13 / 13** (municipal 2, provincial 1, national 1, public_entity 4, soe 5): MER (Mpumalanga Economic Regulator) MER/T01/2027 (t000); ATNS RFP15/06/2026/27 (t001); ACSA COR8138/2026 (t003); Council for Geoscience CGS-2026-046NM (t023); CSIR RFP 3785 (t025); Dept of Defence CPSC/B/365/2026 (t027); Gert Sibande DM GSDM 07/2026 (t045); Joburg Market PMO-CP-003 (t050); plus t087, t094, t099, t101, t106 | companies.black_ownership_pct only (one number) | **Partial** |
| A6 | Legal entity type (Pty Ltd / CC / sole proprietor / partnership / trust / co-op / NPC) - drives which registration documents apply | **11 / 9** (municipal 5, provincial 2, national 1, public_entity 2, soe 1): ETDP SETA RFQ 16 (t036); George LM GMQ010 (t043); Gert Sibande DM GSDM 07/2026 (t045); National Dept of Health HP08-2026SSP/01 (t046); merSETA RFQ-LEA-180 (t061); Metsimaholo LM 02/2026/27 (t064); MEGA MEGA/2027/05 (t070); MEGA MEGA/2027/07 (t071); plus t082, t083, t094 | - (no column; forms fork on it) | **GAP** |
| A7 | Directors / members / partners / trustees register: full names, ID or passport, nationality, gender, race, executive or not, residential address, qualifications & years experience, other directorships | **11 / 11** (municipal 3, provincial 1, national 3, public_entity 1, soe 3): ACSA COR8138/2026 (t003); CTICC 009/2027 (t012); Correctional Services KZN 05/2025 (t022); Dept of Defence CPSC/B/365/2026 (t027); George LM GMQ010 (t043); Gert Sibande DM GSDM 07/2026 (t045); National Dept of Health HP08-2026SSP/01 (t046); Limpopo Office of the Premier PRDP 01 (t058); plus t091, t099, t101 | companies.director_name + director_id_number (ONE director only) | **Partial** |
| A8 | Date of establishment / date operations began / years in business | **8 / 8** (provincial 2, national 1, public_entity 2, soe 3): Amatola Water AW2026/27/04 (t007); CEF (SOC) ISP/10/2026 (t011); Dept of Defence CPSC/B/365/2026 (t027); EC Health SCMU3-0038 (t034); Limpopo Office of the Premier PRDP 01 (t058); Medical Research Council (t062); SAA (t094); SANAS (t096) | - (not stored; CIPC registration date not captured) | **GAP** |
| A9 | Founding statement / MOI / partnership agreement / trust deed / letters of authority from Master | **8 / 7** (municipal 3, provincial 3, public_entity 1, soe 1): ACSA RFQ12076 (t005); Gert Sibande DM GSDM 07/2026 (t045); merSETA RFQ-LEA-180 (t061); Metsimaholo LM 02/2026/27 (t064); MEGA MEGA/2027/05 (t070); MEGA MEGA/2027/07 (t071); NW Public Works PWR 39 (t084); Umzimvubu LM UMZ/2026-27/C&CS/03 (t117) | - | **GAP** |
| A10 | Trading name (if different) | **4 / 4** (municipal 1, national 2, soe 1): Correctional Services KZN 05/2025 (t022); Gert Sibande DM GSDM 07/2026 (t045); National Dept of Health HP08-2026SSP/01 (t046); SAA (t094) | companies.csd_trading_name | Has a home |
| A11 | Other companies (CSD MAAA + status) linked to each director; standing partnerships / associations | **4 / 4** (provincial 1, national 1, soe 2): Amatola Water AW2026/27/04 (t007); National Dept of Health HP08-2026SSP/01 (t046); Limpopo Office of the Premier PRDP 01 (t058); SA Post Office (t101) | - (SBD 4 asks per tender; tender_answers only) | **GAP** |
| A12 | Core business description (and since when) | **3 / 3** (provincial 1, national 1, public_entity 1): Dept of Defence CPSC/B/365/2026 (t027); Limpopo Office of the Premier PRDP 01 (t058); Medical Research Council (t062) | companies.how_we_work is free prose; no short 'core business' field | **Partial** |
| A13 | Senior management names & IDs; management structure / top-management experience | **3 / 3** (provincial 1, national 1, soe 1): ACSA COR8138/2026 (t003); Limpopo Office of the Premier PRDP 01 (t058); SARS RFP14-2026 (t102) | - | **GAP** |
| A14 | Proof of director name change / marriage certificate (when records disagree) | **2 / 2** (municipal 2): ERWAT ERW2605/01 (t037); Metsimaholo LM 02/2026/27 (t064) | - (rare) | **GAP** |

### B. Tax, supplier registers and municipal accounts

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| B1 | CSD supplier number (MAAA) and CSD registration (summary/full) report | **69 / 64** (municipal 16, provincial 14, national 11, public_entity 19, soe 9): ATNS RFP15/06/2026/27 (t001); ACSA COR8138/2026 (t003); ACSA RFQ12076 (t005); Amajuba DM Q2026/10 (t006); Amatola Water AW2026/27/04 (t007); Border Management Authority H004L2706RFP00075 (t010); CEF (SOC) ISP/10/2026 (t011); CTICC 009/2027 (t012); plus t014, t016, t017, t022, t023, t026, t027, t028, t031, t032, t033, t034, t036, t037, t041, t045, t046, t049, t050, t052, t053, t054, t055, t056, t057, t058, t061, t062, t064, t066, t067, t070, t071, t073, t075, t076, t078, t079, t080, t081, t084, t085, t087, t089, t091, t093, t094, t095, t098, t099, t102, t103, t106, t107, t111, t112, t116, t117, t119, t120, t121 | companies.csd_supplier_number (number only; no report file, no report date/validity) | **Partial** |
| B2 | SARS tax compliance status PIN (+ printed TCS / tax clearance certificate number, issue & expiry) | **47 / 45** (municipal 15, provincial 8, national 7, public_entity 10, soe 7): ATNS RFP15/06/2026/27 (t001); ACSA RFQ12076 (t005); Amajuba DM Q2026/10 (t006); Amatola Water AW2026/27/04 (t007); CEF (SOC) ISP/10/2026 (t011); CTICC 009/2027 (t012); City of Johannesburg COJ0011-26/27 (t014); Correctional Services KZN 05/2025 (t022); plus t023, t026, t027, t028, t031, t034, t037, t041, t044, t045, t049, t053, t054, t055, t057, t058, t062, t066, t067, t068, t073, t080, t081, t084, t090, t093, t094, t095, t096, t098, t099, t102, t103, t106, t108, t109, t117, t119, t121 | companies.sars_tcs_pin / _expiry / _document_path (0014); no issue date / certificate number | Has a home |
| B3 | Registration on the buyer's own supplier database / portal (municipal accredited DB, LOGIS, WCSEB, SAP Ariba, ESKOM/Transnet e-tender profile, DOD supplier code, SAA vendor no.) | **21 / 17** (municipal 11, provincial 2, national 3, soe 5): Bitou LM SCM/2026/111 (t009); CTICC 009/2027 (t012); City of Johannesburg COJ0011-26/27 (t014); City of Cape Town 096Q/2026/27 (t017); City of Tshwane GFS 04 (t018); City of Tshwane GPM 06 (t019); City of Tshwane EEBU 06 (t020); City of Tshwane WSBU 01 (t021); plus t027, t028, t029, t030, t032, t040, t041, t046, t047, t066, t094, t115, t121 | - (no per-buyer registration table) | **GAP** |
| B4 | Municipal rates & taxes statement (<=3 months, not >90 days in arrears) or billing clearance certificate - for the COMPANY and EACH DIRECTOR; address must match CIPC; lease / SAPS affidavit / tribal-authority or councillor letter alternatives | **20 / 19** (municipal 16, provincial 1, public_entity 1, soe 2): ATNS RFP15/06/2026/27 (t001); Amajuba DM Q2026/10 (t006); CTICC 009/2027 (t012); City of Johannesburg COJ0011-26/27 (t014); City Power JHB BID-2656S (t015); Coega DC CDC/441/26 (t033); ERWAT ERW2605/01 (t037); Garden Route DM IGRDM/03 (t041); plus t044, t045, t050, t057, t064, t066, t081, t082, t083, t093, t106, t117 | company_offices.proof_type='municipal_account' + proof_date (company offices only; no per-director accounts, no arrears status, no file) | **Partial** |
| B5 | VAT registration number / proof of VAT registration (or 'not VAT registered') | **14 / 14** (municipal 4, provincial 4, national 3, public_entity 2, soe 1): CTICC 009/2027 (t012); Dept of Defence CPSC/B/365/2026 (t027); Coega DC CDC/441/26 (t033); George LM GMQ010 (t043); Gert Sibande DM GSDM 07/2026 (t045); National Dept of Health HP08-2026SSP/01 (t046); KZN Public Works ZNTM01233W (t054); Limpopo Office of the Premier PRDP 01 (t058); plus t065, t090, t094, t095, t103, t116 | companies.vat_number (no certificate file, no explicit 'not registered' flag) | **Partial** |
| B6 | Income tax reference number | **6 / 6** (municipal 3, public_entity 3): CTICC 009/2027 (t012); George LM GMQ010 (t043); Iziko Museums (t049); Ndlambe LM (t081); SANAS (t096); SANSA (t100) | companies.income_tax_number | Has a home |
| B7 | PAYE / UIF / SDL registration numbers and UIF proof of registration | **4 / 4** (municipal 1, provincial 3): EC Agriculture SCMU8-0043 (t032); EC Health SCMU3-0038 (t034); George LM GMQ010 (t043); KZN Human Settlements ZNB161 (t053) | companies.paye_number only; no UIF reference or proof | **Partial** |

### C. B-BBEE, ownership percentages and specific-goals proof

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| C1 | B-BBEE proof: SANAS certificate / EME-QSE sworn affidavit / CIPC B-BBEE certificate / dtic certificate (certified, valid at closing; consolidated for JV) | **47 / 44** (municipal 8, provincial 6, national 4, public_entity 19, soe 10): MER (Mpumalanga Economic Regulator) MER/T01/2027 (t000); ATNS RFP15/06/2026/27 (t001); ACSA RFQ12076 (t005); Amatola Water AW2026/27/04 (t007); Border Management Authority H004L2706RFP00075 (t010); CEF (SOC) ISP/10/2026 (t011); City of Johannesburg COJ0011-26/27 (t014); City Power JHB BID-2656S (t015); plus t022, t023, t024, t025, t026, t027, t033, t036, t038, t041, t043, t044, t049, t052, t054, t056, t057, t062, t066, t075, t078, t079, t081, t087, t088, t091, t094, t095, t096, t097, t098, t099, t101, t106, t111, t112, t116, t119, t121 | companies.bee_proof_type (certificate|qse_affidavit|eme_affidavit) + expiry + file; no 'cipc_certificate'/'dtic' type, no certificate number/verification date | **Partial** |
| C2 | Ownership percentages by group: black, black women, youth (18-35), people with disability, military veterans, HDI (specific-goals tables) | **18 / 18** (municipal 5, provincial 3, national 2, public_entity 4, soe 4): MER (Mpumalanga Economic Regulator) MER/T01/2027 (t000); ATNS RFP15/06/2026/27 (t001); Amatola Water AW2026/27/04 (t007); City Power JHB BID-2656S (t015); Council for Geoscience CGS-2026-046NM (t023); DALRRD RQ-016988 (t028); ETDP SETA RFQ 16 (t036); ERWAT ERW2605/01 (t037); plus t038, t042, t050, t054, t089, t090, t094, t101, t106, t117 | companies.black_ownership_pct only | **Partial** |
| C3 | Office location for locality points / mandatory local office (municipality, district, province), with proof and how long operational | **13 / 13** (municipal 4, provincial 4, public_entity 4, soe 1): ATNS RFP15/06/2026/27 (t001); City Power JHB BID-2656S (t015); EC Agriculture SCMU8-0043 (t032); Coega DC CDC/441/26 (t033); EC Health SCMU3-0038 (t034); ETDP SETA RFQ 16 (t036); Garden Route DM IGRDM/03 (t041); Joburg Market PMO-CP-003 (t050); plus t054, t062, t089, t105, t117 | company_offices (province, district, local municipality, proof_type, proof_date); no proof file, no 'operational since' | Has a home |
| C4 | Proof per owner for specific goals: ID (age), disability medical certificate (doctor/psychologist/SASSA, practice number) | **11 / 11** (municipal 4, provincial 2, national 2, public_entity 2, soe 1): ATNS RFP15/06/2026/27 (t001); City Power JHB BID-2656S (t015); DALRRD RQ-016988 (t028); ETDP SETA RFQ 16 (t036); ERWAT ERW2605/01 (t037); Elundini LM ELM-4/004 (t038); Gauteng COGTA 01/01/2026 (t042); Joburg Market PMO-CP-003 (t050); plus t054, t089, t090 | - (person-level documents for owners) | **GAP** |
| C5 | Rural / traditional-area address proof (ward councillor letter, PTO, tribal authority letter) | **7 / 7** (municipal 4, provincial 2, soe 1): Amajuba DM Q2026/10 (t006); EC Health SCMU3-0038 (t034); ERWAT ERW2605/01 (t037); KZN Public Works ZNTM01233W (t054); Lepelle Northern Water LNW01/26/27 (t057); Metsimaholo LM 02/2026/27 (t064); Moqhaka LM 5/2/001 (t066) | company_offices.proof_type='other' | **Partial** |
| C6 | B-BBEE status level | **5 / 5** (provincial 1, national 1, soe 3): ACSA RFQ12076 (t005); Dept of Defence CPSC/B/365/2026 (t027); Coega DC CDC/441/26 (t033); SAA (t094); SANRAL N.011-010-2027/1F (NRA 2026/0779) (t099) | companies.bee_level | Has a home |
| C7 | Enterprise size / scorecard (EME / QSE / Generic), annual turnover previous FY | **5 / 5** (provincial 2, national 1, public_entity 1, soe 1): Coega DC CDC/441/26 (t033); ETDP SETA RFQ 16 (t036); KZN Public Works ZNTM01233W (t054); SAA (t094); SARS RFP14-2026 (t102) | companies.status (free text e.g. 'QSE'); no turnover | **Partial** |

### D. Labour and statutory compliance

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| D1 | COID registration + letter of good standing (valid at closing; class of works / sector; DoEL, FEM or RMA) | **23 / 21** (municipal 4, provincial 6, national 1, public_entity 5, soe 7): ATNS RFP15/06/2026/27 (t001); ACSA COR8138/2026 (t003); ACSA RFQ 16820 (t004); ACSA RFQ12076 (t005); City Power JHB BID-2656S (t015); City of Cape Town 99S/2026/27 (t016); CSIR RFQ 9548 (t024); EC Agriculture SCMU8-0043 (t032); plus t033, t034, t040, t042, t047, t048, t053, t062, t065, t071, t089, t097, t099, t102, t106 | companies.coid_registration_number, coid_letter_of_good_standing_number/_expiry, coid_letter_document_path; no issuer/class | Has a home |
| D2 | Bargaining council / sector provident fund letter of good standing (CCNPF cleaning, PSSPF security, bargaining council registration) | **5 / 5** (provincial 4, national 1): EC Agriculture SCMU8-0043 (t032); EC Health SCMU3-0038 (t034); Gauteng COGTA 01/01/2026 (t042); KZN Human Settlements ZNB161 (t053); SARS RFP14-2026 (t102) | - | **GAP** |
| D3 | Staff complement: total, management, technical; employee database / list (names, IDs, experience) | **5 / 5** (provincial 2, national 1, public_entity 1, soe 1): Dept of Defence CPSC/B/365/2026 (t027); ESKOM LC SI-138 (t029); EC Health SCMU3-0038 (t034); Limpopo Office of the Premier PRDP 01 (t058); Medical Research Council (t062) | companies.total_employees, ecsa_/sacpcmp_registered_staff_count | **Partial** |
| D4 | UIF registration proof + list of registered employees | **3 / 3** (provincial 3): EC Agriculture SCMU8-0043 (t032); EC Health SCMU3-0038 (t034); KZN Human Settlements ZNB161 (t053) | - | **GAP** |
| D5 | Employment equity compliance (EE plan/report), number and composition of employees | **2 / 2** (national 1, soe 1): Dept of Defence CPSC/B/365/2026 (t027); Transnet TCC/2026/07/0099 (t115) | companies.total_employees (count only) | **GAP** |
| D6 | Executive Authority approval letter where a director/member is a government employee | **2 / 1** (provincial 2): MEGA MEGA/2027/05 (t070); MEGA MEGA/2027/07 (t071) | - | **GAP** |
| D7 | Police clearance of owners / directors (and later staff) | **1 / 1** (provincial 1): EC Agriculture SCMU8-0043 (t032) | - | **GAP** |
| D8 | Personal-service-provider / labour-broker status facts (>=3 full-time non-connected employees, >80% income from one client) - ESKOM PAYE pack | **1 / 1** (soe 1): ESKOM LC SI-138 (t029) | - | **GAP** |

### E. Industry registrations, licences and accreditations

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| E1 | CIDB registration: grading per class (often more than one), CRS number, certificate | **22 / 20** (municipal 11, provincial 2, public_entity 3, soe 6): ACSA ORTIA8160/2026 (t002); ACSA RFQ 16820 (t004); ACSA RFQ12076 (t005); Cederberg LM CED 22 (t013); City of Johannesburg COJ0011-26/27 (t014); City of Cape Town 096Q/2026/27 (t017); City of Tshwane WSBU 01 (t021); CSIR RFQ 9548 (t024); plus t029, t033, t040, t043, t050, t063, t065, t069, t071, t081, t086, t097, t106, t109 | companies.cidb_grading (single text value); no CRS number, no certificate file, no multiple classes | **Partial** |
| E2 | OEM / principal authorisation: accredited implementation partner, authorised reseller/distributor letter, OEM SLA, franchise accreditation | **8 / 8** (provincial 2, national 3, soe 3): MER (Mpumalanga Economic Regulator) MER/T01/2027 (t000); ATNS RFP15/06/2026/27 (t001); Amatola Water AW2026/27/04 (t007); CEF (SOC) ISP/10/2026 (t011); National Dept of Health HP08-2026SSP/01 (t046); Limpopo Office of the Premier PRDP 01 (t058); National Treasury (t080); DWS (t119) | - (could live in company_document_templates as uploads) | **GAP** |
| E3 | PSIRA company registration certificate + letter of good standing (company and directors) | **6 / 6** (municipal 1, provincial 3, national 1, public_entity 1): City of Cape Town 99S/2026/27 (t016); EC Agriculture SCMU8-0043 (t032); KZN Human Settlements ZNB161 (t053); Mpumalanga Social Development (t073); Road Accident Fund (t089); SARS RFP14-2026 (t102) | - (role catalog only, not company) | **GAP** |
| E4 | Professional-council registration held through a DIRECTOR/member as a condition for the FIRM (SAGC land surveyor, SACPVP valuer, SACPLAN, IIA/ISACA membership for audit firms) | **6 / 6** (municipal 2, provincial 2, public_entity 2): KZN Public Works ZNTM01233W (t054); Maluti TVET (t059); Mossel Bay (t068); MEGA MEGA/2027/05 (t070); National Lotteries Commission (t078); Nkangala DM 35358 (t082) | people.ecsa_*/sacpcmp_* (+ sacnasp_*/sagc_* from 0040) - person-level only; nothing says the FIRM qualifies through a named director | **Partial** |
| E5 | Trade / industry association registrations: SARACCA (HVAC), SAQCC Gas (B6), NCCA/BEECA (cleaning), ISPA (internet), Ethics Institute Safeline-EX | **5 / 5** (municipal 1, public_entity 1, soe 3): ATNS RFP15/06/2026/27 (t001); CEF (SOC) ISP/10/2026 (t011); CSIR RFQ 9548 (t024); ESKOM LC SI-138 (t029); ERWAT ERW2605/01 (t037) | - | **GAP** |
| E6 | Waste permits: hazardous-waste transporter permit, waste licence, provincial Waste Information System registration, disposal-facility licence + account | **4 / 4** (municipal 1, provincial 1, public_entity 2): City Power JHB BID-2656S (t015); Gauteng COGTA 01/01/2026 (t042); NMISA (t074); SANSA (t100) | - | **GAP** |
| E7 | Training-provider accreditation: SETA / QCTO accredited SDP or assessment centre, qualification-specific (SAQA ID) accreditation | **4 / 4** (municipal 1, public_entity 2, soe 1): City of Johannesburg COJ0011-26/27 (t014); CATHSSETA CATHS/QAS/02/2026 (t026); merSETA RFQ-LEA-180 (t061); Rand Water (t088) | - | **GAP** |
| E8 | Health/medical licences: HPCSA registrations, ambulance licence per district (DoH), SAHPRA licence to manufacture, medicine registration certificates, GMP | **3 / 3** (national 2, public_entity 1): Correctional Services KZN 05/2025 (t022); National Dept of Health HP08-2026SSP/01 (t046); SASSA KZN (t103) | - | **GAP** |
| E9 | Food safety / product certificates: HACCP, certificate of acceptability for food premises (R638), health certificate (catering), Halaal certificate in bidder's name | **3 / 3** (municipal 1, provincial 1, national 1): City of Johannesburg COJ0011-26/27 (t014); The Presidency (t110); Tygerberg Hospital TBH 304/2026 (t116) | - | **GAP** |
| E10 | Security vetting / clearance of company and personnel (SSA screening, Transnet CONFIDENTIAL, DOD security questionnaire) | **3 / 3** (national 1, soe 2): CEF (SOC) ISP/10/2026 (t011); Dept of Defence CPSC/B/365/2026 (t027); Transnet TCC/2026/07/0099 (t115) | - | **GAP** |
| E11 | Firearm licences in company name, firearms register, firearm range approval, armed response capability | **2 / 2** (provincial 1, national 1): EC Agriculture SCMU8-0043 (t032); SARS RFP14-2026 (t102) | - | **GAP** |
| E12 | ICASA licence (ISP / radio frequency) | **2 / 2** (provincial 1, soe 1): Amatola Water AW2026/27/04 (t007); EC Agriculture SCMU8-0043 (t032) | - | **GAP** |
| E13 | Sector licences seen once: Banks Act registration, diamond dealer licence (s32) + authorised representative (s54) | **2 / 2** (municipal 1, national 1): Mossel Bay TDR31 (t067); SIU (t107) | - | **GAP** |
| E14 | Electrical contractor registration (Dept of Employment & Labour) + wireman's licence of a registered person | **1 / 1** (public_entity 1): CSIR RFQ 9548 (t024) | - | **GAP** |
| E15 | Pest control & fumigation registration (Act 36, Dept of Agriculture) | **1 / 1** (provincial 1): Gauteng COGTA 01/01/2026 (t042) | - | **GAP** |

### F. Financial and banking

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| F1 | Bank details: bank, branch name & code, account holder name, account type, account NUMBER, bank contact, account age | **9 / 8** (municipal 4, provincial 1, national 2, soe 2): Amajuba DM Q2026/10 (t006); Correctional Services KZN 05/2025 (t022); Gert Sibande DM GSDM 07/2026 (t045); National Dept of Health HP08-2026SSP/01 (t046); Nkangala DM 35358 (t082); Nkangala DM (t083); NW Public Works PWR 39 (t084); SAA (t094); plus t099 | companies.bank_name, bank_branch_code; account number deliberately NOT stored (0001 comment) | **Partial** |
| F2 | Annual / audited financial statements (last 3 years; audited vs reviewed; going-concern; ratios) | **7 / 7** (municipal 4, provincial 1, national 2): City Power JHB BID-2656S (t015); Dept of Defence CPSC/B/365/2026 (t027); EC Health SCMU3-0038 (t034); Joburg Market PMO-CP-003 (t050); Metsimaholo LM 02/2026/27 (t064); Sekhukhune DM (t093); SARS RFP14-2026 (t102) | - (no financial statements store) | **GAP** |
| F3 | Bank confirmation letter (stamped; validity 3 months to 1 year) / cancelled cheque | **6 / 5** (municipal 3, soe 3): ACSA RFQ12076 (t005); Amajuba DM Q2026/10 (t006); Nkangala DM 35358 (t082); Nkangala DM (t083); SAA (t094); SANRAL N.011-010-2027/1F (NRA 2026/0779) (t099) | companies.bank_confirmation_letter_date/_valid_until/_path (0014) | Has a home |
| F4 | Financial / trade references | **5 / 4** (municipal 4, provincial 1): Coega DC CDC/441/26 (t033); George LM GMQ010 (t043); Gert Sibande DM GSDM 07/2026 (t045); Nkangala DM 35358 (t082); Nkangala DM (t083) | - | **GAP** |
| F5 | Bank rating / credit rating letter for the tender sum; registered FSP letter | **3 / 3** (municipal 1, soe 2): ACSA RFQ12076 (t005); Nkangala DM 35358 (t082); SANRAL N.011-010-2027/1F (NRA 2026/0779) (t099) | - | **GAP** |
| F6 | Financial profile: annual turnover, public vs private revenue split, top customers / suppliers, debtors & creditors age, contingent liabilities | **3 / 3** (provincial 1, national 1, soe 1): Limpopo Office of the Premier PRDP 01 (t058); SAA (t094); SARS RFP14-2026 (t102) | - | **GAP** |
| F7 | Letter of solvency from auditor / accountant | **1 / 1** (soe 1): ACSA RFQ12076 (t005) | - | **GAP** |
| F8 | Proof of financial capacity / funds: credit-facility letter or bank statement (<=3 months), scored in rand bands | **1 / 1** (provincial 1): EC Agriculture SCMU8-0043 (t032) | - | **GAP** |

### G. Insurance

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| G1 | Public liability insurance (cover amount, insurer, expiry, certificate) - scored or mandatory | **9 / 9** (municipal 2, provincial 3, public_entity 2, soe 2): ACSA RFQ 16820 (t004); EC Agriculture SCMU8-0043 (t032); Gauteng COGTA 01/01/2026 (t042); Medical Research Council (t062); Mpumalanga Social Development (t073); Nkangala DM (t083); SANRAL N.011-010-2027/1F (NRA 2026/0779) (t099); SA Tourism (t104); plus t117 | - (only PI exists) | **GAP** |
| G2 | Professional indemnity insurance (insurer, policy, cover amount, expiry; or insurer letter of intent) | **4 / 4** (municipal 1, national 1, public_entity 1, soe 1): ACSA COR8138/2026 (t003); CSIR RFP 3785 (t025); National Treasury (t080); Nkangala DM 35358 (t082) | companies.pi_insurance_* (0014); no letter-of-intent status | Has a home |
| G3 | Other cover: contract works / CAR, motor, goods-in-transit, employer's liability; insurance commitment form | **4 / 2** (soe 4): ACSA ORTIA8160/2026 (t002); ACSA RFQ 16820 (t004); ACSA RFQ12076 (t005); IDC/Foskor FOSPHB-RFP-23 (t048) | - | **GAP** |

### H. Quality and SHEQ

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| H1 | SHE / OHS policy and H&S plan capability; OHS Act s37(2) agreement; environmental policy | **7 / 7** (municipal 2, provincial 2, public_entity 1, soe 2): City of Johannesburg COJ0011-26/27 (t014); City Power JHB BID-2656S (t015); EC Agriculture SCMU8-0143 (t031); Coega DC CDC/441/26 (t033); Medical Research Council (t062); PRASA (t086); TNPA (t113) | - (company_document_templates could host) | **GAP** |
| H2 | ISO 9001 certificate (scope, certification body, accreditation, expiry) | **5 / 5** (municipal 1, national 1, public_entity 1, soe 2): City of Cape Town 99S/2026/27 (t016); Council for Geoscience CGS-2026-046NM (t023); ESKOM LC SI-138 (t029); Eskom NTC E3681NTCSANEG (t040); National Treasury (t080) | companies.iso_9001_* (0014); no scope / certification body | **Partial** |
| H3 | Quality management plan / contract quality plan (ISO 10005) / ITP-QCP example | **4 / 4** (provincial 1, soe 3): ACSA ORTIA8160/2026 (t002); ESKOM LC SI-138 (t029); Coega DC CDC/441/26 (t033); Eskom NTC E3681NTCSANEG (t040) | - (company_document_templates could host an upload) | **GAP** |
| H4 | Documented QMS without certification: QMS manual, quality policy & objectives, document-control / NC / corrective-action / internal-audit procedures, latest internal & external audit reports, management review records | **2 / 2** (soe 2): ESKOM LC SI-138 (t029); Eskom NTC E3681NTCSANEG (t040) | - | **GAP** |

### I. Experience and track record

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| I1 | Company experience evidence: reference letters / completion certificates / appointment letters / POs, with client, contract no., value, dates, scope, contact; rules on which count | **38 / 34** (municipal 6, provincial 4, national 4, public_entity 12, soe 12): ATNS RFP15/06/2026/27 (t001); ACSA ORTIA8160/2026 (t002); ACSA COR8138/2026 (t003); ACSA RFQ 16820 (t004); ACSA RFQ12076 (t005); Amatola Water AW2026/27/04 (t007); Council for Geoscience CGS-2026-046NM (t023); CSIR RFQ 9548 (t024); plus t026, t028, t029, t033, t034, t043, t045, t048, t049, t054, t055, t057, t062, t069, t073, t079, t082, t083, t088, t089, t092, t096, t099, t106, t107, t110, t111, t112, t117, t120 | experience_items (0012); value, client, scope, dates, contact all present | Has a home |
| I2 | Company profile / capability statement document | **10 / 10** (municipal 1, provincial 2, national 1, public_entity 4, soe 2): Amatola Water AW2026/27/04 (t007); Dept of Defence CPSC/B/365/2026 (t027); EC Health SCMU3-0038 (t034); Gert Sibande DM GSDM 07/2026 (t045); IDC/Foskor FOSPHB-RFP-23 (t048); Limpopo Office of the Premier PRDP 01 (t058); Medical Research Council (t062); SASSETA (t092); plus t096, t118 | company_document_templates (open slug) but 'company_profile' not wired; how_we_work prose | **Partial** |
| I3 | Schedule of current contracts / commitments (work in hand) | **5 / 4** (municipal 2, provincial 1, soe 2): ACSA RFQ12076 (t005); Coega DC CDC/441/26 (t033); Nkangala DM 35358 (t082); Nkangala DM (t083); SANRAL N.011-010-2027/1F (NRA 2026/0779) (t099) | - (experience_items has no 'in progress' status) | **GAP** |
| I4 | Portfolio of work (photos, sample videos), track record & achievements, awards | **4 / 4** (national 2, public_entity 2): Dept of Defence CPSC/B/365/2026 (t027); Iziko Museums (t049); SASSETA (t092); SARS RFP14-2026 (t102) | - | **GAP** |
| I5 | Client list (incl. other state departments served, periods, contacts) | **3 / 3** (provincial 1, national 1, public_entity 1): Dept of Defence CPSC/B/365/2026 (t027); Limpopo Office of the Premier PRDP 01 (t058); Medical Research Council (t062) | derivable from experience_items.client_name | **Partial** |

### J. People, signatories and contacts

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| J1 | Key personnel CVs + qualifications + professional registrations (buyer CV templates) | **30 / 26** (municipal 3, provincial 3, national 5, public_entity 11, soe 8): ACSA ORTIA8160/2026 (t002); ACSA COR8138/2026 (t003); ACSA RFQ12076 (t005); Amatola Water AW2026/27/04 (t007); Border Management Authority H004L2706RFP00075 (t010); CSIR RFQ 9548 (t024); CSIR RFP 3785 (t025); CATHSSETA CATHS/QAS/02/2026 (t026); plus t028, t029, t033, t036, t043, t054, t055, t062, t073, t078, t082, t083, t087, t088, t089, t096, t099, t103, t107, t110, t112, t120 | people, projects, cv_uploads, person_role_eligibility | Has a home |
| J2 | Authority to sign: board / members / partners resolution (certified), named signatories with ID and position | **26 / 23** (municipal 5, provincial 7, national 6, public_entity 3, soe 5): MER (Mpumalanga Economic Regulator) MER/T01/2027 (t000); ACSA COR8138/2026 (t003); ACSA RFQ12076 (t005); Amatola Water AW2026/27/04 (t007); Border Management Authority H004L2706RFP00075 (t010); CEF (SOC) ISP/10/2026 (t011); CTICC 009/2027 (t012); City of Johannesburg COJ0011-26/27 (t014); plus t022, t024, t033, t041, t043, t045, t046, t053, t061, t070, t071, t073, t080, t084, t098, t099, t119, t120 | people.signatory_capacity; company_document_templates 'authority_to_sign' (wired for SANRAL pack only) | **Partial** |
| J3 | Person registrations beyond ECSA/SACPCMP: SACAP, SACQSP, SACPLAN, SACPVP, SACNASP, SAGC, EAPASA, HPCSA, PSIRA grade, IIA/CIA, ISACA, change-mgmt/IT certs, SAQA evaluation of foreign quals, mediation certificate | **18 / 18** (municipal 3, provincial 2, national 4, public_entity 5, soe 4): ACSA COR8138/2026 (t003); Amatola Water AW2026/27/04 (t007); Border Management Authority H004L2706RFP00075 (t010); City of Cape Town 99S/2026/27 (t016); Correctional Services KZN 05/2025 (t022); CATHSSETA CATHS/QAS/02/2026 (t026); DALRRD RQ-016988 (t028); ETDP SETA RFQ 16 (t036); plus t054, t059, t068, t070, t078, t082, t088, t103, t112, t120 | people.ecsa_*, sacpcmp_*, and (0040, landed today) sacnasp_*, sagc_*; nothing for SACAP, SACQSP, SACPLAN, SACPVP, EAPASA, HPCSA, PSIRA, IIA/ISACA, IT/change certs | **Partial** |
| J4 | Certified copies of each person's qualifications, trade-test certificates, course certificates (certification <=3-6 months) | **11 / 10** (national 2, public_entity 4, soe 5): ACSA ORTIA8160/2026 (t002); ACSA RFQ12076 (t005); Amatola Water AW2026/27/04 (t007); Border Management Authority H004L2706RFP00075 (t010); CATHSSETA CATHS/QAS/02/2026 (t026); ESKOM LC SI-138 (t029); ETDP SETA RFQ 16 (t036); QCTO (t087); plus t088, t103, t107 | - (cv_uploads holds the CV only) | **GAP** |
| J5 | Company organogram / organisation chart with names (and IDs), responsibility matrix; project structure | **10 / 9** (municipal 2, provincial 1, public_entity 1, soe 6): ACSA ORTIA8160/2026 (t002); ESKOM LC SI-138 (t029); Eskom NTC E3681NTCSANEG (t040); IDC/Foskor FOSPHB-RFP-23 (t048); Limpopo Office of the Premier PRDP 01 (t058); Medical Research Council (t062); Nkangala DM 35358 (t082); Nkangala DM (t083); plus t099, t113 | - (no document type) | **GAP** |
| J6 | Named contacts: contract/tender contact person, orders contact, key-account manager (name, tel, cell, e-mail), fax | **6 / 6** (municipal 2, provincial 1, national 1, public_entity 1, soe 1): CTICC 009/2027 (t012); George LM GMQ010 (t043); National Dept of Health HP08-2026SSP/01 (t046); Limpopo Office of the Premier PRDP 01 (t058); Medical Research Council (t062); SAA (t094) | companies.telephone/cellphone/email (0018); no contact-person name, no fax, no role-specific contacts | **Partial** |
| J7 | Person nationality / passport number (CV templates, director profiles) | **4 / 4** (national 3, public_entity 1): Border Management Authority H004L2706RFP00075 (t010); Dept of Defence CPSC/B/365/2026 (t027); National Dept of Health HP08-2026SSP/01 (t046); SASSA KZN (t103) | - | **GAP** |

### K. Premises and resources

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| K1 | Plant, equipment, vehicle & tools register with proof (registration papers in company/director name, or hire agreements) | **12 / 11** (municipal 3, provincial 4, national 2, public_entity 1, soe 2): ACSA RFQ12076 (t005); ESKOM LC SI-138 (t029); Coega DC CDC/441/26 (t033); EC Health SCMU3-0038 (t034); EC Transport SCMU10-0017 (t035); George LM GMQ010 (t043); Mpumalanga Social Development (t073); NMISA (t074); plus t082, t083, t102, t110 | - (no resources table) | **GAP** |
| K2 | Physical / registered / postal address (with city, province, postal code) | **7 / 7** (municipal 2, provincial 1, national 2, public_entity 1, soe 1): CTICC 009/2027 (t012); Dept of Defence CPSC/B/365/2026 (t027); George LM GMQ010 (t043); National Dept of Health HP08-2026SSP/01 (t046); Limpopo Office of the Premier PRDP 01 (t058); Medical Research Council (t062); SAA (t094) | companies.registered_address, postal_address, head_office (free text) | Has a home |
| K3 | Head & regional offices, national/regional footprint, business hours | **2 / 2** (provincial 1, public_entity 1): Limpopo Office of the Premier PRDP 01 (t058); Medical Research Council (t062) | company_offices (no business hours) | **Partial** |

### L. Company-constant declarations

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| L1 | Directors / owners in the service of the state; relationships with buyer staff (SBD/MBD 4) | **36 / 32** (municipal 10, provincial 7, national 6, public_entity 8, soe 5): MER (Mpumalanga Economic Regulator) MER/T01/2027 (t000); ACSA COR8138/2026 (t003); ACSA RFQ12076 (t005); Amatola Water AW2026/27/04 (t007); Border Management Authority H004L2706RFP00075 (t010); CEF (SOC) ISP/10/2026 (t011); CTICC 009/2027 (t012); City of Johannesburg COJ0011-26/27 (t014); plus t022, t024, t031, t033, t036, t037, t041, t045, t046, t053, t057, t062, t066, t070, t071, t078, t080, t082, t083, t093, t095, t098, t100, t103, t116, t117, t119, t120 | tender_answers (+ reuse allowlist) | Per tender |
| L2 | Litigation / disputes history of company and directors (10 years), restrictions, terminated contracts, criminal implication | **7 / 6** (municipal 2, national 2, soe 3): CEF (SOC) ISP/10/2026 (t011); Dept of Defence CPSC/B/365/2026 (t027); Nkangala DM 35358 (t082); Nkangala DM (t083); SANRAL N.011-010-2027/1F (NRA 2026/0779) (t099); SARS RFP14-2026 (t102); Transnet TCC/2026/07/0099 (t115) | - (per-tender answers only) | **GAP** |
| L3 | Politically exposed / prominent influential persons among owners & directors (DPIP/FPPO) | **3 / 2** (soe 3): ACSA COR8138/2026 (t003); ACSA RFQ12076 (t005); SANRAL N.011-010-2027/1F (NRA 2026/0779) (t099) | - | **GAP** |

### M. Branding and presentation

| # | Item (what it is) | Asked for by (tenders / buyers) | Where it lives today | Status |
|---|---|---|---|---|
| M1 | Company letterhead (pricing/letters on letterhead) and company stamp on pages | **7 / 7** (provincial 1, public_entity 3, soe 3): Amatola Water AW2026/27/04 (t007); CATHSSETA CATHS/QAS/02/2026 (t026); EC Health SCMU3-0038 (t034); Iziko Museums (t049); merSETA RFQ-LEA-180 (t061); SA Post Office (t101); Transnet TCC/2026/07/0099 (t115) | companies.logo_storage_path only | **GAP** |
### 3.1 Qualifiers that recur across items

Several items come with conditions that change what "on file" means. The onboarding flow has to capture these, not just the document:

- **Certification age.** Certified copies must be certified within:
  - **3 months** (ATNS NCCA certificate, City Power B-BBEE and IDs, Joburg Market IDs, ESKOM trade tests);
  - **6 months** (Amatola Water, Correctional Services, COGTA insurance certificate, Lepelle IDs, Moqhaka IDs, NW Public Works, SASSA);
  - **30 days** (Umzimvubu).

  Correctional Services, NW Public Works and SASSA all reject "a copy of a certified copy". Correctional Services also requires the commissioner's signature, date and printed name. A stored certified copy therefore needs its **certification date**, not just an upload date.
- **"In the company's name" / "in the director's name".** Tenders specify this for COID (COGTA), insurance (COGTA), firearm licences (EC Agriculture security), vehicle registrations (ESKOM HVAC, EC scholar transport), Halaal and food-premises certificates (Tygerberg), the municipal account or lease (Lepelle, Metsimaholo) and the SARACCA certificate ("company's or director's name", ESKOM).
- **For each director as well as the company.** This applies to municipal accounts (Amajuba, CTICC, CoJ, City Power, ERWAT, Metsimaholo, Ndlambe, Umzimvubu), IDs (most), SBD 4 relationships, and the litigation history (Nkangala, SANRAL A4/A8).
- **Validity at closing / for the contract.** ACSA, CEF and SAPO require returnables to stay valid for the whole contract and renewals to be supplied. That is the same expiry tracking the vault already does for six documents.
- **Address consistency.** Metsimaholo accepts a municipal account or lease only if its address matches the address on the CIPC registration documents. Several buyers score locality from the **CSD** address (EC Agriculture security, Coega). The company's CIPC address, CSD address and office addresses must agree, which is a check the app could run.

---

## 4. Priority gaps: what to close first

Ranked by how many different tenders and buyers ask, how many buyer types they span, and whether a missing item disqualifies a bid rather than costing points. Counts are from §3.

| Rank | Gap (items) | Reach | Why it ranks here | Shape of the fix (for the future task) |
|---|---|---|---|---|
| **1** | **Directors / members / shareholders register**: A3 IDs, A5 shareholders, A7 directors table, C2 ownership % by group, C4 per-owner proof, A13 senior management | IDs 28 tenders / 27 buyers, ownership-by-group 18 / 18, shareholders 13 / 13, directors table 11 / 11, per-owner SG proof 11 / 11; all 5 buyer types | The schema holds one director and one ownership number. Tenders want every principal with ID, nationality, gender, race, % held, exec/non-exec, residential address and municipal account, plus certified IDs. **Specific goals (black / women / youth / disabled ownership) can't be claimed automatically without it**, and disability needs a medical certificate per owner | A `company_principals` table: person, role (director / member / partner / trustee / shareholder / senior manager), ID or passport, nationality, gender, race, date of birth (youth), disability flag + proof, % shareholding, exec flag, appointed date, certified ID upload + certification date. Derive the ownership percentages; don't store them twice |
| **2** | **CIPC registration documents and entity type**: A2, A9 founding docs, A6 entity type, A8 date established | CIPC docs 34 / 32 (all types); entity type 11; date established 8; founding docs 8 | The single most-requested document with no home. Several buyers mark it compulsory or disqualifying (Moqhaka, Sekhukhune, Amajuba; DWS checks the company is "actively registered with CIPC"). Which document applies (COR14.3, CK1/CK2, partnership agreement, trust deed) depends on entity type, which isn't stored | `companies.entity_type`, `companies.registration_date`, and a typed document slot (COR14.3 / CK / MOI / trust deed / partnership agreement) with certification date |
| **3** | **Municipal rates & taxes: company and each director**: B4, C5 | 20 tenders / 19 buyers, 16 of them municipal | Near-universal in municipal and municipal-entity tenders, and a disqualifier. The rules are intricate: ≤3 months old, not >90 days in arrears, company **and every director**, address must match CIPC, lease/SAPS-affidavit/tribal-letter/councillor-letter alternatives, billing clearance certificate. Today only `company_offices.proof_type` + `proof_date` exist, for the company's offices | Per principal and per company: account number, municipality, statement date, in-arrears flag, document; plus the alternative-proof type. Re-use `company_offices` proof types |
| **4** | **CSD report**: B1 | Number on file; report asked by 69 / 64 | `csd_supplier_number` exists, but the CSD summary/full report (a dated PDF) isn't stored. System-Status Gap 7 already names "CSD registration validity has no column". The CSD report is also the **evidence** several buyers use for ownership, address and tax | Document slot + report date + optional "CSD status" (tax compliant / active) |
| **5** | **B-BBEE proof variants and certificate facts**: C1, C7 | 47 / 44 | `bee_proof_type` allows certificate / QSE affidavit / EME affidavit only. Tenders also accept the **CIPC B-BBEE certificate** (ETDP SETA, Coega for EMEs under R3m) and the **dtic certificate** (Rand Water, SANParks). SAA asks for the certificate **number** and **verification date**. Coega's construction-codes rule makes the type depend on **annual turnover** and black ownership, and turnover isn't stored | Extend the CHECK list; add certificate number, verification date, issuing agency; add `annual_turnover` + financial year end (also F7) |
| **6** | **Authority to sign: resolution document and signatory table**: J2 | 26 / 23 | Almost every tender asks for a board/members/partners resolution, often certified. National Health and SANRAL want tables of directors **and** named signatories with ID and position. The mechanism exists (0037 `authority_to_sign`) but is wired into the SANRAL pack only. This is System-Status backlog item 1 | Wire `authority_to_sign` into `build_general_pack.py`; let the resolution name several signatories (people rows) |
| **7** | **CIDB details**: E1 | 22 / 20 | `cidb_grading` is one text value. Tenders need the **CRS number** (Gap #11 already named), the **certificate**, and **more than one class** (MEGA: 5GB **and** 5EB; JV rules per member) | `company_cidb_gradings` (class, level, PE flag, expiry) + CRS number + certificate |
| **8** | **Buyer supplier-database registrations**: B3 | 21 / 17 | Municipal accredited-supplier databases, LOGIS (EC), WCSEB (WC), Tshwane SAP Ariba, ESKOM and Transnet e-tender profiles, the DOD supplier code, the SAA vendor number and provincial Health databases. Some are prerequisites to bid at all (Tshwane, Transnet) | Small table: buyer/portal, registration or vendor number, status, date, login owner |
| **9** | **Registrations, licences and accreditations, company and person**: E2-E15, J3 | Person bodies 18 / 18; company licences 1-6 each but **18 different bodies** | Many different bodies, each asked for by a few tenders: PSIRA (5), SARACCA, SAQCC Gas, NCCA/BEECA, ISPA, Ethics Institute, ICASA, electrical contractor, Act 36 pest control, waste permits, HPCSA, ambulance licence, SAHPRA, HACCP / food-premises COA / Halaal, SETA/QCTO accreditation, Banks Act, diamond dealer. People additionally need SACAP, SACQSP, SACPLAN, SACPVP, EAPASA, HPCSA, PSIRA grade, IIA/CIA, ISACA, IT and change-management certifications, mediation certificates and SAQA evaluations. Adding a column per body doesn't scale. The 0040 SACNASP/SAGC pattern (show only when a tender asks) is the right UX, but the storage should be a list | `company_registrations` and `person_registrations` tables: body (open slug), number, category/grade, issued, expiry, document, "held through director X". Feed `watch_deadlines.py` from them, as 0035/0040 do for ECSA/SACPCMP/SACNASP/SAGC |
| **10** | **Insurance beyond PI**: G1, G3 | Public liability 9 / 9 (mandatory at EC Agriculture R2m and COGTA R1m; 40 of 100 functionality points at Umzimvubu); other cover 4 | Only professional indemnity has fields (0014) | `company_insurances` (type, insurer, policy no., cover, expiry, document); PI moves into it |
| **11** | **Plant, vehicle and equipment register**: K1 | 12 / 11 | Construction, security, cleaning, HVAC, hazardous waste and food logistics score or require it, with proof of ownership in the company's or a director's name, or hire agreements | `company_assets` (type, description, registration no., owned/hired, proof document) |
| **12** | **Financial statements and financial profile**: F2, F4-F8 | AFS 7 / 7; financial references 5; profile 3; bank rating 3 | MBD 5 (>R10m) needs **3 years' audited AFS** (Metsimaholo, Sekhukhune). Joburg Market computes ratios from them. SARS asks for turnover split, key customers/suppliers and debtors/creditors ageing. Nothing is stored | `company_financial_years` (year end, turnover, audited/reviewed/compiled, AFS document, auditor) + financial-references list |
| 13 | Organogram, company profile, QMS documents, quality plan, SHE policy, letterhead/stamp: J5, I2, H1, H3, H4, M1 | 10 + 10 + 2 + 4 + 7 + 7 | All are company documents that are re-attached every time. The 0037 mechanism (`company_document_templates`, open slug, "upload your own") already fits them. Only the types need adding (System-Status backlog items 2-3) | Register document types; no new table |
| 14 | Bank account details: F1 | 9 / 8 | Nkangala (Form H, unresponsive without it), SAA vendor form and SANRAL A18 ask for the **account number**, holder name, type and account age. 0001 deliberately doesn't store the number | Sarel's call: either a restricted table (0001's own suggestion) or keep it "by hand" and list it on the completion guide. **Decision needed, not a silent add** |

Not ranked high, but worth noting:

- **Litigation / restriction / PEP declarations (L2-L3):** 7 + 3 tenders. These are company-constant facts re-declared every tender. Store them once with "last confirmed" dates and pre-fill.
- **Staff complement and UIF / bargaining council (D2-D5):** sector-specific, with security and cleaning dominant. Mandatory where asked.

---

## 5. Tender-specific requirements that recur (worth tracking as patterns)

These aren't company master data, but they recur enough that the engines should model them as known patterns rather than meet them as surprises.

| Pattern | Seen in | What to model |
|---|---|---|
| **JV / consortium** | ~28 tenders, e.g. ACSA, Amatola, CGS, CSIR x2, Coega, COGTA, George, Gert Sibande, Joburg Market, Lepelle, Metsimaholo, MEGA, Mpumalanga SD, NW PW, QCTO, SANRAL, SAPO, South Cape TVET, Transnet, DWS | The agreement shows the % split and lead partner (Lepelle, Transnet, SANRAL: "lead bidder majority share"). Each member submits its own CSD / TCS / CIPC / B-BBEE. A **consolidated, project-specific** B-BBEE certificate plus the members' own (Coega, CSIR). Signed by all and **notarised** (COGTA, DWS) or **commissioner-attested** (Mpumalanga SD). Letter of intent instead of an agreement (Coega, Transnet). A JV authority/power of attorney for the lead (ACSA, George). Teaming agreement (ERWAT). The Compulsory Enterprise Questionnaire per member (Nkangala, CTICC, WC) |
| **Subcontracting** | ACSA, CSIR x2, SAWS, DOD, ESKOM, Transnet | Signed subcontract agreement; the subcontractor's own documents; a reference letter per subcontracted discipline (CSIR); a sub-contractor compliance certificate (DOD) |
| **Compulsory briefing / site visit** | ~12: ATNS, ACSA COR8138, EC Agriculture lease, Coega, COGTA, Joburg Market, KZN PW, Mossel Bay, Swellendam, DWS x2, KZN HS | A signed / stamped attendance certificate is a mandatory returnable. Already a `tender_tasks` milestone kind; the certificate itself needs an upload slot |
| **Document certification rules** | see §3.1 | Certification date per stored copy; reject copies of certified copies |
| **Specific-goals tables** | ~85 SBD/MBD 6.1 forms; table contents vary per buyer | Data comes from §3 C (ownership by group, locality, EME/QSE). Each buyer's table and point values differ, so it is read per tender (`score_outlook.py` already does this for B-BBEE / ownership / locality). New goal kinds seen: **youth defined as 18-35** (Elundini); **disability via a SASSA certificate** (Elundini); **cooperatives / NPOs** (ETDP SETA); **"promotion of business located in the province / in SA"** (ETDP SETA); **rural / tribal-area enterprises** (KZN PW) |
| **Locality and local office** | ~13 (§3 C6) | Already modelled (0015). New wrinkles: office **operational ≥1 year**, verified on site (EC Agriculture security); office **within 50 km** (RAF); **site inspection / due diligence of premises** before award (COGTA, SAWS, EC Agriculture); locality scored from the **CSD address** (EC Agriculture security, Coega) |
| **Tender document fees** | Bitou, Cederberg, DALRRD, Elundini (R250), Garden Route, KZN PW, Mossel Bay, Ndlambe (R147.55), Mopani (refundable) | A tender task + proof-of-payment upload; some fees buy the only copy of the documents |
| **Buyer CV templates** | BMA (nationality, NQF level, professional body + category + expiry), QCTO ("compulsory CV template for uniformity"), ESKOM PAYE pack, SANRAL B1/B2 | Confirms `CV-Engine-Findings.md`: buyer formats differ. Nationality and NQF level aren't stored (J7) |
| **Pricing / letters on company letterhead; company stamp on every page** | CATHSSETA, Iziko, merSETA, EC Health, SAPO, Transnet, Amatola | Company letterhead and stamp image (M1) |
| **Two-envelope / separate pricing file** | ATNS, ACSA, DOD, SARS, CTICC | Already modelled for SANRAL; general packs build one PDF today |
| **Buyer-own form sets** | ESKOM (Form A, Supplier Quality Mgmt 240-105658000, Integrity Pact, PAYE pack), Transnet (Breach of Law, Integrity Pact, POPIA operator contract), ACSA (Declaration of Forbidden Practices, Transformation Framework), SANRAL A1-A23, Nkangala / George / CTICC (municipal T2.1 forms B-U), National Health (PBD forms), DOD (security questionnaire), SAA (vendor form), SARS (supplier risk questionnaire) | Each of these is mostly company-constant data in a buyer's own layout. With §3 filled in, the flat-PDF overlay (`fill_flat_pdf.py`) and docx filler could type most of them. Today none has a field map except the CEQ and Form of Offer |
| **Security vetting** | CEF (SSA screening), Transnet (CONFIDENTIAL clearance), DOD | Post-award mostly; a company-level "vetted until" fact |
| **Samples / site verification / presentations** | CSIR, Tygerberg, DWS, NRF, SAWS, ESKOM HVAC | Tasks, not data |

---

## 6. Tender categorisation

### 6.1 Approach

Every tender was categorised **by hand** from what the documents say the work is, using the discipline taxonomy that landed on `main` today. That taxonomy is the parallel discipline-taxonomy work: `config/discipline_taxonomy.json`, 19 groups and 93 disciplines (`a9a5364`, `Discipline-Taxonomy-Findings.md`). I used its slugs so the two pieces of work can be reconciled directly rather than duplicated.

Each tender was then also run through `taxonomy.py Taxonomy.match()` on its OCDS title and description, which is exactly what Discovery sees.

**Hand vs automatic, by group** (a tender can be in several):

| Group | Tenders (hand) |
|---|---|
| professional_services | 28 |
| security_facilities | 18 |
| electrical_mechanical | 15 |
| buildings | 12 |
| goods_supplies | 12 |
| business_financial_legal | 12 |
| it_telecoms | 10 |
| roads_civil | 10 |
| marketing_media_printing | 6 |
| training_education | 5 |
| water | 5 |
| waste_environment, health_social, property_leasing_disposals, events_hospitality_travel | 3 each |
| agriculture_forestry | 2 |
| mining_industrial, fleet_transport_plant, supplier_database_notices | 1 each |

**Agreement:** the automatic match agrees with the hand category (same discipline or its group) on **104 of 123**.

The 19 disagreements are below. Neither side was changed by this pass: they are input for the taxonomy's review loop (`taxonomy.py coverage` / `add`), which belongs to that work, not this one.

| Tender | Hand | Automatic | What happened |
|---|---|---|---|
| t002 ACSA fire water pump stations | fire_protection, mechanical_plant_equipment | water_wastewater_treatment | "pump station" read as water works; the description's "fire" didn't trigger `fire_protection` |
| t015 City Power oil-spillage clean-up | environmental_rehabilitation, waste_collection_disposal | cleaning_hygiene | "cleaning" wins over "oil spillage ... rehabilitation" |
| t032 EC Agriculture security management | security_guarding | networks_telecoms | "security management services" not matched; another word hit telecoms |
| t033 Coega new/replacement school | building_construction | (none) | "NEW/REPLACEMENT SCHOOL" not caught (the keyword likely needs "construction") |
| t046 National Health semi-solid dosage forms | medical_supplies_equipment | software_systems, goods_supplies | pharmaceutical vocabulary ("dosage forms", "powders") missing |
| t062 MRC COID claims administration | banking_insurance_investment | building_construction, audit_accounting_finance | "Compensation for Occupational Injuries" + something read as construction |
| t028 DALRRD ESTA mediation | legal_services | building_construction | OCDS text is generic ("assist the department ... "); only the ToR says mediation |
| t049 Iziko exhibition cabinetry | furniture (joinery / shopfitting) | mechanical_plant_equipment, events_management, arts_culture_sport | no joinery / shopfitting discipline |
| t023 CGS diamond core drilling equipment | mining_quarrying, appliances_equipment | building_materials_hardware | drilling consumables read as hardware |
| t079 NRF botanical resurvey | environmental_assessment, laboratory_scientific | (none) | ecological / vegetation survey vocabulary missing |
| t107 SIU diamond valuator | property_valuation (closest) | (none) | no category for valuation of minerals / precious stones; worth adding |
| t030 ESKOM skills audit & competence framework | hr_recruitment_staffing, management_consulting | (none) | "skills audit", "competence framework" not keywords |
| t006 Amajuba garden tools | appliances_equipment | gardening_landscaping, building_materials_hardware | goods vs the service they're for |
| t020 Tshwane LED luminaires | electrical_installation_reticulation | goods_supplies | group-only match |
| t021, t026, t036, t038, t103 | sibling disciplines | sibling disciplines | same group, different sibling (e.g. training vs education services). Acceptable |

**Extra wrong tags** even where the main discipline was right:

- `furniture` on CSIR's fluidised-**bed** design (t025);
- `building_construction` on KZN HS security at "Eagle **Building**" (t053);
- `mining_quarrying` on IDC/Foskor cleaning (t048);
- `agriculture` on Presidency groceries (t110);
- road, water and building tags on KZN PW land surveying, from the project the surveyor serves (t054).

These are the place-name / scope-word false positives the taxonomy doc already lists as a known limit (§4 there).

### 6.2 What categorisation means for the master list

The categories show **which sector-specific items a company in each line of work must have**. That is the practical way to keep onboarding from becoming "a wall of fields" (Deep-Dive doc, Onboarding section): ask for the universal items from every company, and the sector items only from companies whose disciplines (from their Experience Library tags) match.

| Company works in ... | Ask for, in addition to the universal items |
|---|---|
| security_guarding / electronic_security | PSIRA company + LoGS, firearm licences & range, ICASA (radio), bargaining council + PSSPF, UIF, police clearances, armed-response proof, public liability, vehicle register |
| cleaning_hygiene / pest_control | NCCA/BEECA, CCNPF, UIF + employee list, Act 36 pest registration, hazardous-waste permit, public liability, equipment list |
| building / civil / road works | CIDB (all classes, CRS no.), COID with class of works, plant & equipment register, H&S plan / SHE policy, financial references, bank rating, current commitments, public liability / CAR |
| electrical_mechanical / hvac | DoEL electrical contractor registration, wireman's licence holder, SAQCC Gas, SARACCA, CIDB EB/ME |
| consulting_engineering / professional services | PI insurance, person registrations (ECSA, SACAP, SACQSP, SACPLAN, SACPVP, SACNASP, SAGC, EAPASA), a director's registration where the firm qualifies through it |
| audit / accounting / ethics | IIA / ISACA / SAICA / SAIPA memberships, CIA, Ethics Institute accreditation |
| training | SETA / QCTO accreditation per qualification, ETDP assessor / moderator |
| health | HPCSA (person + LoGS), ambulance / EMS licence per district, SAHPRA licences, work permits |
| food / catering | HACCP, certificate of acceptability (R638), Halaal, health certificate, cold-chain vehicles |
| IT / telecoms | OEM / partner authorisations, ICASA / ISPA, NOC letter, staff certifications (CCNP, CISSP, NSE, ...) |
| waste / environment | waste permits, Waste Information System registration, facility licences, PrDP drivers |
| property leasing (landlords) | title deeds, mandates, zoning certificate, occupancy certificate, building grade, OHS / electrical CoC / fire certificates (these are **per building**, a separate "property" record, not company data) |

The full per-tender list (hand category + automatic match) is in Appendix A.

---

## 7. Other findings

### 7.1 SANRAL tender packs are on eTenders, at least sometimes

`ocds-9t57fa-174470` (SANRAL N.011-010-2027/1F, NRA 2026/0779, consulting engineering for flood-mitigation measures on national roads, Conventional Consultant family) published **the full tender pack as one zip on eTenders**. It holds:

- Book 1, Books 2 & 3 and the appendices;
- the **Technical Submission and Financial Submission `.xlsm`**;
- `Returnable Schedules.docx`.

There was no CAPTCHA and no form. That is a 7th SANRAL Conventional sample, and a different project type from the 6 RRM / pavement ones.

Its A-forms differ from R.396's in form numbering and content:

- A4 (sworn declaration of debt to SANRAL, tenderer and directors);
- **A5 DPIP / FPPO declaration** (shareholder names, IDs and % plus prominent-person links);
- A6 fronting practices;
- A14 permission for due diligence;
- A17 certificate of insurance cover;
- **A18 "Tenderer's registered Financial Service Provider letter and bank details"**;
- A22 independent technology-based intellectual service provider;
- A23 single tender submission;
- B1-B7 as before.

**Suggested follow-ups** (not done here: out of scope):

- run `fingerprint.py` on its workbooks;
- check the docx fillers against this Returnable Schedules edition;
- add it to the admin harness as a test tender;
- have Discovery look for SANRAL releases on OCDS with documents attached, as a CAPTCHA-free path.

### 7.2 Metros are moving off eTenders downloads

City of Tshwane (4 sampled releases, 21 open in the feed) publishes documents only through SAP Ariba. City of Cape Town publishes 5-page adverts on eTenders with the full document on its own e-procurement portal. Discovery's "documents already in the system" promise (Deep-Dive build stream 5) doesn't hold for these buyers. A company that bids there would load the documents through the manual load (`/tenders/new`, 0024).

### 7.3 Requirement families no previous findings doc had seen

| Family | Where |
|---|---|
| Supplier vendor forms | SAA (bank account no., TCC number & dates, B-BBEE certificate no. & verification date, % black women / disabled ownership, turnover, months in operation) |
| Financial-risk questionnaires | SARS (King governance, restrictions, terminated contracts, disputes, awards, top-5 suppliers / customers, % dependence on SARS, debtors / creditors ageing, going concern, contingent liabilities) |
| Security questionnaires | DOD (core business, operation start date, shareholders %, services to other departments, EE plan and staff composition, fraud / corruption / criminal implication, under investigation) |
| Bidder-profile questionnaires | Limpopo Premier (entity / management / operating structure, geographical spread, core business since when, partnerships, major technology suppliers, staff complement split, client list) |
| Personal-service-provider tax test | ESKOM PAYE pack (≥3 full-time non-connected employees, >80% income from one client) |
| Specialist association registrations | SARACCA, NCCA/BEECA, ISPA, Ethics Institute Safeline-EX, SAQCC Gas |
| Food | Halaal and R638 certificates in the bidder's name |
| Health | HPCSA LoGS, ambulance licence per district, work permits for foreign practitioners, an affidavit of never being suspended from medical evaluations |

### 7.4 OCDS data-quality note

`ocds-9t57fa-174039`'s buyer is "Abaqulusi Local Municipality", but the document is MER/T01/2027 of the **Mpumalanga Economic Regulator**. Any per-buyer statistic or award join built on the OCDS buyer name will occasionally be wrong. The document itself is the authority.

---

## 8. How this list should be used (handoff to the onboarding task)

1. **Populate first, in this order:**
   - the universal items (section 3: legal identity, CSD / TCS, B-BBEE, COID, CIPC documents, directors and shareholders, authority to sign, bank letter, municipal account);
   - then the sector items for the company's disciplines (§6.2).

   For Klipcorp (roads / civil consulting) that sector set is: CIDB (if contracting), PI insurance, ECSA / SACPCMP people, experience evidence, ISO 9001 / QMS documents, organogram and company profile.
2. **Keep "minimum to get started".** Onboarding stays one field (Deep-Dive). This list is what the Company page fills **progressively**, with the next missing item suggested by the tenders the company is actually pursuing. A tender that asks for PSIRA is what makes PSIRA appear: the same rule Sarel gave for SACNASP / SAGC.
3. **Feed `requirements.py`.** Each §3 item with a reliable wording could become a `RETURNABLES` key with a `vault` pointer once its home exists. The general workspace would then show "on file / don't have" for it the way it does for the six vault documents today. Item labels and quotes in Appendix B are the starting regexes.
4. **Decisions for Sarel before building:**
   - **Q-MD1. Bank account number** (rank 14): stored in a restricted table, or always by hand?
   - **Q-MD2. Directors' personal data** (IDs, residential addresses, municipal accounts, disability proof): POPIA scope. This is the largest new body of personal information the product would hold. Confirm it is in scope, and that each company records consent for its principals.
   - **Q-MD3. Landlord / property tenders** (EC Agriculture, Legal Aid, NW PW leases): support them? Their requirements are per **building**, not per company, which is a different record type.
   - **Q-MD4. Shared registrations list.** Should the registration-body list (§4 rank 9) be a shared, admin-maintained catalog like `tender_roles` and `discipline_categories`, with companies adding their own entries? Recommended: yes, the same pattern as 0016 / 0040.

---

## Appendix A - every sampled tender, with category

`read`: full = text read; ocr = scanned, read by OCR; advert = only the advert is on eTenders; none = documents not reachable.

| Id | Tender | Buyer type | Read | Category (hand) | Automatic match (`taxonomy.py`) |
|---|---|---|---|---|---|
| t000 | MER (Mpumalanga Economic Regulator) MER/T01/2027 - Plumsoft ERP modules | provincial | full | `software_systems` | `software_systems` |
| t001 | ATNS RFP15/06/2026/27 - cleaning, East London/Mthatha | soe | full | `cleaning_hygiene` | `cleaning_hygiene` |
| t002 | ACSA ORTIA8160/2026 - fire water pump stations D&B (7ME) | soe | full | `fire_protection, mechanical_plant_equipment` | **differs:** `water_wastewater_treatment` |
| t003 | ACSA COR8138/2026 - multidisciplinary PSP, gas-to-power trigeneration | soe | full | `consulting_engineering, project_construction_management, quantity_surveying, environmental_assessment, renewable_energy` | `professional_services,goods_supplies` |
| t004 | ACSA RFQ 16820 - stormwater & drain maintenance CDSIA (2CE) | soe | full | `stormwater_drainage` | `stormwater_drainage` |
| t005 | ACSA RFQ12076 - civil maintenance King Phalo (4CE) | soe | full | `road_maintenance, building_maintenance_renovation` | `roads_civil` |
| t006 | Amajuba DM Q2026/10 - garden tools | municipal | full | `appliances_equipment` | **differs:** `gardening_landscaping,building_materials_hardware` |
| t007 | Amatola Water AW2026/27/04 - hosting & support | soe | full | `it_support_managed_services, software_systems` | `software_systems` |
| t008 | Ba-Phalaborwa LM - training panel (advert) | municipal | advert | `training_skills_development` | `training_skills_development` |
| t009 | Bitou LM SCM/2026/111 - 1MVA transformer (advert) | municipal | advert | `electrical_installation_reticulation` | `electrical_installation_reticulation,goods_supplies` |
| t010 | Border Management Authority H004L2706RFP00075 - org design | national | full | `management_consulting, hr_recruitment_staffing` | `management_consulting` |
| t011 | CEF (SOC) ISP/10/2026 - internet, firewall, network | soe | full | `networks_telecoms, cybersecurity` | `networks_telecoms,cybersecurity` |
| t012 | CTICC 009/2027 - CCTV & access control | municipal | full | `electronic_security` | `electronic_security` |
| t013 | Cederberg LM CED 22 - MR539 road rehab (advert) | municipal | advert | `road_construction_upgrade` | `road_construction_upgrade` |
| t014 | City of Johannesburg COJ0011-26/27 - branded merchandise | municipal | full | `signage_promotional` | `goods_supplies,events_management,advertising_marketing,signage_promotional` |
| t015 | City Power JHB BID-2656S - oil spillage clean-up | municipal | full | `environmental_rehabilitation, waste_collection_disposal` | **differs:** `cleaning_hygiene` |
| t016 | City of Cape Town 99S/2026/27 - urban CCTV | municipal | full | `electronic_security` | `electronic_security` |
| t017 | City of Cape Town 096Q/2026/27 - treated effluent term tender (5-page advert) | municipal | advert | `water_wastewater_treatment` | `water_wastewater_treatment` |
| t018 | City of Tshwane GFS 04 - municipal valuer support (SAP Ariba only) | municipal | none | `property_valuation` | `property_valuation` |
| t019 | City of Tshwane GPM 06 - land development PM/transaction advisory (SAP Ariba only) | municipal | none | `project_construction_management, feasibility_research_advisory` | `project_construction_management,feasibility_research_advisory` |
| t020 | City of Tshwane EEBU 06 - LED luminaires (SAP Ariba only) | municipal | none | `electrical_installation_reticulation` | **differs:** `goods_supplies` |
| t021 | City of Tshwane WSBU 01 - water appurtenant works (SAP Ariba only) | municipal | none | `water_supply_reticulation` | **differs:** `water_wastewater_treatment` |
| t022 | Correctional Services KZN 05/2025 - ambulance services | national | ocr | `health_services` | `health_services` |
| t023 | Council for Geoscience CGS-2026-046NM - core drilling equipment | public entity | full | `mining_quarrying, appliances_equipment` | **differs:** `building_materials_hardware` |
| t024 | CSIR RFQ 9548 - office refurbishment (4GB) | public entity | full | `building_maintenance_renovation` | `building_maintenance_renovation,office_accommodation_leasing` |
| t025 | CSIR RFP 3785 - fluidised-bed detailed design | public entity | full | `consulting_engineering` | `consulting_engineering,furniture` |
| t026 | CATHSSETA CATHS/QAS/02/2026 - QA assessor panel | public entity | full | `training_skills_development` | **differs:** `education_services` |
| t027 | Dept of Defence CPSC/B/365/2026 - tents | national | ocr | `goods_supplies` | `building_maintenance_renovation,goods_supplies,events_management` |
| t028 | DALRRD RQ-016988 - ESTA mediation | national | ocr | `legal_services` | **differs:** `building_construction` |
| t029 | ESKOM LC SI-138 - HVAC maintenance LimLanga (2ME) | soe | full | `hvac_refrigeration, facilities_management` | `hvac_refrigeration,facilities_management` |
| t030 | ESKOM E3668CXMWP - skills audit & competence framework | soe | full | `hr_recruitment_staffing, management_consulting` | **differs:** `(none)` |
| t031 | EC Agriculture SCMU8-0143 - office lease Joubertina | provincial | full | `office_accommodation_leasing` | `office_accommodation_leasing` |
| t032 | EC Agriculture SCMU8-0043 - security Uitenhage | provincial | full | `security_guarding` | **differs:** `networks_telecoms` |
| t033 | Coega DC CDC/441/26 - new school Amaoti (8GB) | provincial | full | `building_construction` | **differs:** `(none)` |
| t034 | EC Health SCMU3-0038 - cleaning Flagstaff CHC | provincial | full | `cleaning_hygiene` | `cleaning_hygiene,health_social` |
| t035 | EC Transport SCMU10-0017 - scholar transport panel (addendum only) | provincial | advert | `transport_logistics` | `transport_logistics,education_services` |
| t036 | ETDP SETA RFQ 16 - research methodology framework | public entity | full | `feasibility_research_advisory` | **differs:** `training_skills_development` |
| t037 | ERWAT ERW2605/01 - external whistleblowing hotline | municipal | full | `legal_services, management_consulting` | `management_consulting,legal_services` |
| t038 | Elundini LM ELM-4/004 - data backup & replication | municipal | ocr | `it_support_managed_services` | **differs:** `software_systems` |
| t039 | Emalahleni LM - multidisciplinary PSP landfill (advert, scanned) | municipal | advert | `consulting_engineering, waste_collection_disposal` | `consulting_engineering,project_construction_management,waste_collection_disposal` |
| t040 | Eskom NTC E3681NTCSANEG - line emergency equipment maintenance | soe | full | `mechanical_plant_equipment, electrical_installation_reticulation` | `electrical_installation_reticulation,mechanical_plant_equipment,laboratory_scientific` |
| t041 | Garden Route DM IGRDM/03 - lifesaving De Hoek | municipal | full | `facilities_management` | `facilities_management` |
| t042 | Gauteng COGTA 01/01/2026 - cleaning, hygiene, pest control | provincial | full | `cleaning_hygiene, pest_control` | `cleaning_hygiene,pest_control` |
| t043 | George LM GMQ010 - rigging 66kV transformers | municipal | full | `electrical_installation_reticulation` | `electrical_installation_reticulation` |
| t044 | George LM GMQ009 - office furniture | municipal | full | `furniture` | `furniture` |
| t045 | Gert Sibande DM GSDM 07/2026 - lab reagents | municipal | full | `chemicals, laboratory_scientific` | `laboratory_scientific,building_materials_hardware,chemicals` |
| t046 | National Dept of Health HP08-2026SSP/01 - semi-solid dosage forms | national | full | `medical_supplies_equipment` | **differs:** `software_systems,goods_supplies` |
| t047 | Hessequa LM HES-TECH 04 - renewable energy install (part scanned) | municipal | full | `renewable_energy` | `renewable_energy,goods_supplies` |
| t048 | IDC/Foskor FOSPHB-RFP-23 - cleaning & hygiene | soe | full | `cleaning_hygiene` | `cleaning_hygiene,health_services,mining_quarrying` |
| t049 | Iziko Museums - exhibition cabinetry RFQ | public entity | full | `furniture` | **differs:** `mechanical_plant_equipment,events_management,arts_culture_sport` |
| t050 | Joburg Market PMO-CP-003 - furniture | municipal | full | `furniture` | `project_construction_management,furniture` |
| t051 | Kagisano-Molopo LM KMLM2027-001 - community hall (advert, scanned) | municipal | advert | `building_construction` | `building_construction` |
| t052 | Ezemvelo KZN Wildlife RFQ 12/10/2026 - play equipment & minor works | provincial | full | `sports_recreation_facilities, building_maintenance_renovation` | `buildings` |
| t053 | KZN Human Settlements ZNB161 - security guarding | provincial | ocr | `security_guarding` | `building_construction,security_guarding` |
| t054 | KZN Public Works ZNTM01233W - land surveying firm | provincial | full | `surveying_gis` | `road_construction_upgrade,water_wastewater_treatment,building_construction,surveying_gis` |
| t055 | Land Bank - farm viability assessment | public entity | full | `agriculture, feasibility_research_advisory` | `agriculture` |
| t056 | Legal Aid SA 51/2026 - office accommodation Soweto | public entity | full | `office_accommodation_leasing` | `office_accommodation_leasing` |
| t057 | Lepelle Northern Water LNW01/26/27 - communications agency | soe | full | `advertising_marketing` | `marketing_media_printing` |
| t058 | Limpopo Office of the Premier PRDP 01 - infrastructure master plan review | provincial | ocr | `feasibility_research_advisory` | `feasibility_research_advisory` |
| t059 | Maluti TVET - property valuation & GRAP asset register (advert) | public entity | advert | `property_valuation` | `property_valuation,audit_accounting_finance` |
| t060 | Mangaung Metro bids bulletin 217 (scanned) | municipal | advert | `water_wastewater_treatment` | `water_wastewater_treatment` |
| t061 | merSETA RFQ-LEA-180 - accredited SDP / assessment centre | public entity | full | `training_skills_development` | `building_materials_hardware,training_skills_development,education_services` |
| t062 | Medical Research Council - COID claims administration | public entity | full | `banking_insurance_investment` | **differs:** `building_construction,audit_accounting_finance` |
| t063 | Metsimaholo LM 01/2026/27 - 1.52km paved road | municipal | full | `road_construction_upgrade, stormwater_drainage` | `road_construction_upgrade,stormwater_drainage` |
| t064 | Metsimaholo LM 02/2026/27 - PSP panel | municipal | full | `consulting_engineering` | `road_construction_upgrade,stormwater_drainage,earthworks_bulk_services,water_wastewater_treatment,consulting_engineering,project_construction_management` |
| t065 | Mopani DM 2026/27-08 - Thapane water scheme (advert) | municipal | advert | `water_supply_reticulation` | `water_supply_reticulation` |
| t066 | Moqhaka LM 5/2/001 - 5-year plan | municipal | full | `town_planning_urban_design, management_consulting` | `town_planning_urban_design` |
| t067 | Mossel Bay TDR31 - banking services | municipal | full | `banking_insurance_investment` | `banking_insurance_investment` |
| t068 | Mossel Bay - town & regional planners panel | municipal | full | `town_planning_urban_design` | `town_planning_urban_design` |
| t069 | Mossel Bay - building maintenance & repairs | municipal | full | `building_maintenance_renovation` | `building_maintenance_renovation` |
| t070 | MEGA MEGA/2027/05 - internal audit panel | provincial | full | `audit_accounting_finance` | `audit_accounting_finance` |
| t071 | MEGA MEGA/2027/07 - factory renovation (5GB+5EB) | provincial | full | `building_maintenance_renovation` | `building_maintenance_renovation,industrial_manufacturing` |
| t072 | Mpumalanga PWRT - road D4382 completion (advert, scanned) | provincial | advert | `road_construction_upgrade` | `road_construction_upgrade` |
| t073 | Mpumalanga Social Development - event management | provincial | ocr | `events_management` | `events_management` |
| t074 | NMISA - hazardous waste management | public entity | full | `waste_collection_disposal` | `waste_collection_disposal` |
| t075 | NMISA - penetration testing | public entity | full | `cybersecurity` | `cybersecurity` |
| t076 | National Dept of Agriculture - recruitment advertising | national | full | `advertising_marketing, hr_recruitment_staffing` | `hr_recruitment_staffing` |
| t077 | NHBRC - biometric fingerprint devices | public entity | full | `electronic_security, it_hardware` | `electronic_security` |
| t078 | National Lotteries Commission - internal audit EQA | public entity | full | `audit_accounting_finance` | `audit_accounting_finance` |
| t079 | NRF (SAEON) - botanical resurvey | public entity | full | `environmental_assessment, laboratory_scientific` | **differs:** `(none)` |
| t080 | National Treasury - transversal fuel equipment panel | national | full | `mechanical_plant_equipment, fuel_lubricants_gas, fire_protection` | `mechanical_plant_equipment,software_systems,fuel_lubricants_gas,disposals_auctions` |
| t081 | Ndlambe LM - civil & building contractors panel | municipal | full | `building_construction, road_maintenance` | `buildings,consulting_engineering` |
| t082 | Nkangala DM 35358 - ICT internal audit panel | municipal | full | `audit_accounting_finance, cybersecurity` | `audit_accounting_finance` |
| t083 | Nkangala DM - passenger lift maintenance | municipal | full | `mechanical_plant_equipment` | `building_maintenance_renovation,mechanical_plant_equipment` |
| t084 | NW Public Works PWR 39 - office lease 154m2 | provincial | ocr | `office_accommodation_leasing` | `office_accommodation_leasing` |
| t085 | Oudtshoorn LM TD 01/10/2026 - firefighting PPE (advert) | municipal | advert | `clothing_uniforms_ppe` | `clothing_uniforms_ppe` |
| t086 | PRASA - signalling supply & install | soe | full | `rail_infrastructure, electrical_installation_reticulation` | `rail_infrastructure,electrical_installation_reticulation` |
| t087 | QCTO - media/podcast studio | public entity | full | `media_production, it_hardware` | `media_production` |
| t088 | Rand Water - learnership (Occupational Certificate) | soe | full | `training_skills_development` | `training_skills_development` |
| t089 | Road Accident Fund - security services RFQ | public entity | full | `security_guarding` | `security_guarding` |
| t090 | Rural Development & Land Reform - development plan consortium | national | full | `town_planning_urban_design, agriculture` | `town_planning_urban_design` |
| t091 | SASRIA - ethics risk assessments | public entity | full | `management_consulting` | `management_consulting` |
| t092 | SASSETA - filming & live-streaming | public entity | full | `media_production` | `events_management,media_production` |
| t093 | Sekhukhune DM - electro-mechanical term contract panel | municipal | full | `mechanical_plant_equipment, electrical_installation_reticulation` | `mechanical_plant_equipment` |
| t094 | SAA - IT resources (vendor form) | soe | full | `it_support_managed_services, hr_recruitment_staffing` | `it_telecoms` |
| t095 | SAHRA - Duncan Village memorial rehabilitation | public entity | full | `building_maintenance_renovation, arts_culture_sport` | `building_maintenance_renovation` |
| t096 | SANAS - accessibility ramp assessment | public entity | full | `architecture, consulting_engineering` | `architecture` |
| t097 | SANParks GNP-033-26 - Groenkloof renovations | public entity | full | `building_maintenance_renovation, electrical_installation_reticulation` | `building_maintenance_renovation,electrical_installation_reticulation` |
| t098 | SANParks - borehole drilling | public entity | full | `boreholes_groundwater` | `boreholes_groundwater` |
| t099 | SANRAL N.011-010-2027/1F (NRA 2026/0779) - flood mitigation consulting | soe | full | `consulting_engineering, stormwater_drainage, road_maintenance` | `road_construction_upgrade,consulting_engineering` |
| t100 | SANSA - fuel tank inspection & cleaning | public entity | full | `cleaning_hygiene, mechanical_plant_equipment` | `mechanical_plant_equipment,cleaning_hygiene` |
| t101 | SA Post Office - fence & building repairs Hammersdale | soe | full | `fencing_gates, building_maintenance_renovation` | `building_maintenance_renovation,fencing_gates` |
| t102 | SARS RFP14-2026 - armed escort of high-risk assets | national | full | `security_guarding` | `security_guarding,goods_supplies` |
| t103 | SASSA KZN - HPCSA health practitioners panel | public entity | ocr | `health_services` | **differs:** `medical_supplies_equipment` |
| t104 | SA Tourism - global brand experiential | public entity | full | `events_management, advertising_marketing` | `advertising_marketing` |
| t105 | SA Weather Service - digital marketing training | public entity | full | `training_skills_development` | `training_skills_development,advertising_marketing` |
| t106 | South Cape TVET - roof waterproofing (1SN) | public entity | full | `building_maintenance_renovation` | `building_maintenance_renovation` |
| t107 | SIU - diamond valuator expert | national | full | `property_valuation` | **differs:** `(none)` |
| t108 | Swellendam LM SMQ12 - grass cutting (advert) | municipal | advert | `gardening_landscaping` | `gardening_landscaping` |
| t109 | Swellendam LM SMT17 - Railton walkway (advert) | municipal | advert | `road_construction_upgrade` | `road_construction_upgrade` |
| t110 | The Presidency - prestige groceries panel | national | full | `food_provisions` | `food_provisions,agriculture` |
| t111 | SABS - strategic advisory, bankable business case | public entity | full | `feasibility_research_advisory` | `feasibility_research_advisory` |
| t112 | TCTA - IT change management specialist | soe | full | `management_consulting, it_support_managed_services` | `it_telecoms,management_consulting` |
| t113 | TNPA - Dom Pedro quay refurbishment | soe | full | `ports_marine_works` | `ports_marine_works,building_maintenance_renovation` |
| t114 | Transnet Engineering - approved supplier list | soe | full | `supplier_database_notices` | `goods_supplies,industrial_manufacturing,supplier_database_notices` |
| t115 | Transnet TCC/2026/07/0099 - biodiversity footprint | soe | full | `environmental_assessment` | `environmental_assessment` |
| t116 | Tygerberg Hospital TBH 304/2026 - frozen chicken | provincial | ocr | `food_provisions` | `goods_supplies,catering` |
| t117 | Umzimvubu LM UMZ/2026-27/C&CS/03 - tree felling | municipal | full | `gardening_landscaping` | `gardening_landscaping` |
| t118 | Water Research Commission - institutional assessment (RFI) | public entity | full | `management_consulting` | `feasibility_research_advisory,management_consulting` |
| t119 | DWS - 19mm stone aggregate Midmar | national | ocr | `building_materials_hardware` | `road_construction_upgrade,dams_irrigation,building_materials_hardware` |
| t120 | DWS - biomonitoring & water-quality monitoring | national | full | `laboratory_scientific, environmental_assessment` | `dams_irrigation,laboratory_scientific` |
| t121 | WC Mobility MT04-2026 - GMT accounting services | provincial | full | `audit_accounting_finance` | `transport_logistics,audit_accounting_finance` |
| t122 | WC Transport & Public Works - mechanical ventilation (pointer only) | provincial | none | `hvac_refrigeration` | `hvac_refrigeration,mechanical_plant_equipment` |

## Appendix B - per-tender requirement notes

My notes from reading each tender, in its own words where it mattered. Every count in section 3 comes from these lines. Sample ids (t000-t122) are the ones cited throughout; Appendix A gives each one's buyer and reference, and the OCDS id below finds the release on the feed.

- **t000 - MER (Mpumalanga Economic Regulator) MER/T01/2027 - Plumsoft ERP modules** - provincial; closes 2026-11-06; `ocds-9t57fa-174039`; read: full; category: `software_systems`
  - CIPC docs listing members % (CC) or certified share certificates (company); certified B-BBEE cert/affidavit; per JV/consortium member/subcontractor; Plumsoft OEM accreditation/implementation partner proof (M3); board resolution certified (offer); POPIA consent; SG: 51% black, black women, black youth, black disabled
- **t001 - ATNS RFP15/06/2026/27 - cleaning, East London/Mthatha** - soe; closes 2026-11-24; `ocds-9t57fa-174018`; read: full; category: `cleaning_hygiene`
  - 3 contactable reference letters on client letterhead, last 5 yrs, appointment letters NOT accepted; COIDA letter of good standing valid at closing; MSDS/product brochures; NCCA or BEECA membership certificate certified <3 months; local operational footprint proof (municipal account / lease / MoU with local partner) in name of company or director; SG proof: CSD report, shareholder certificates, ID copies of shareholders, B-BBEE cert/affidavit; TCS/CSD; OEM authorisation letter if reseller; JV joint responsibility agreements; PI insurance mentioned
- **t002 - ACSA ORTIA8160/2026 - fire water pump stations D&B (7ME)** - soe; closes 2026-11-13; `ocds-9t57fa-174353`; read: full; category: `fire_protection, mechanical_plant_equipment`
  - CIDB 7ME (JV: every member CIDB registered, lead ME); returnables include key personnel CVs with qualification + ECSA (PrEng/PrTechEng) + SACPCMP (Construction Manager/ CPM) certificates for Resident Engineer, Electronic Engineer, Electrical Engineer, Fire systems practitioner (ECSA), OHS agent (SACPCMP); reference letters (compliant); project-specific organogram; quality control plan/QA plan (post-award); performance guarantee 5%
- **t003 - ACSA COR8138/2026 - multidisciplinary PSP, gas-to-power trigeneration** - soe; closes 2026-11-17; `ocds-9t57fa-174463`; read: full; category: `consulting_engineering, project_construction_management, quantity_surveying, environmental_assessment, renewable_energy`
  - Appendix A certificate of authority (certified extract of board minutes); Appendix B JV authority + JV agreement with % share; record of addenda; NEC3 PSC; annual compliant BEE certificate clause
  - ACSA COR8138 PSP: mandatory: compulsory briefing cert; form of offer. Other returnables: SBD4; tax PIN; names & ID numbers of directors/trustees/members/shareholders AND senior management; certificate of incorporation showing ownership split; CSD report; declaration of interest & politically exposed persons; declaration of forbidden practices; NDA; cert of authority to sign; JV authority; record of addenda; schedule of tenderer's experience (Appendix E) OR reference letters (completion certs/appointment letters NOT accepted); CVs of key personnel (Appendix G); proof of professional registration (Appendix H): Pr Eng civil/electrical/mechanical (ECSA), Pr CPM (SACPCMP), Pr QS (SACQSP), EAP registered with EAPASA, Pr CHSA (SACPCMP); transformation framework forms; proposed subcontractor; letter of good standing with Compensation Commissioner; SBD 6.1; PI cover R5m/R10m; all docs to remain valid for contract duration (update on expiry)
- **t004 - ACSA RFQ 16820 - stormwater & drain maintenance CDSIA (2CE)** - soe; closes 2026-11-02; `ocds-9t57fa-174235`; read: full; category: `stormwater_drainage`
  - CIDB 2CE; form of offer; functionality: company references/completion certs min 4 letters on letterhead with client name, contract description, value, contact+signature, past 10 yrs; foreman qualification; years experience similar; COID letter of good standing before commencing; public liability insurance; vehicles licensed & insured; airside induction/permits (post-award); annual BEE certificate (contract clause Z16)
- **t005 - ACSA RFQ12076 - civil maintenance King Phalo (4CE)** - soe; closes 2026-10-27; `ocds-9t57fa-173343`; read: full; category: `road_maintenance, building_maintenance_renovation`
  - T2 list: certificate of authority for signatory; cert of authority for JV; schedule of recent experience; completion certificates; client/trade reference letters (min 3 on letterhead); proof of contract values; schedule of current commitments; SBD4; SBD6.1; NDA; declaration of interest & politically exposed person; insurance commitment; COIDA LoGS; CIDB certificate; SARS PIN; bank letter of good standing with bank rating for tender sum; CSD; letter of solvency from auditors/accountants; CIPC docs/partnership/JV/trust; IDs of all shareholders/directors/members/trustees/partners; Compulsory Enterprise Questionnaire; domestic subcontractors schedule + their docs; plant & equipment; B-BBEE cert+report or affidavit (JV consolidated cert); CVs key personnel; qualification certificates; foreman qualification; SACPCMP H&S officer
- **t006 - Amajuba DM Q2026/10 - garden tools** - municipal; closes 2026-10-23; `ocds-9t57fa-174271`; read: full; category: `appliances_equipment`
  - certified ID copies all members/directors; bank details with original cancelled cheque/bank stamp or bank letter; CSD; company registration docs; JV: CKs of each member; municipal account for ALL directors AND company not owing >90 days, or lease; if run from director's residence: certified SAPS affidavit stating address; affidavit if directors not liable for rates; rural/traditional: proof of residence certified by traditional council leader + ward councillor; printed SARS tax PIN; MBD forms
- **t007 - Amatola Water AW2026/27/04 - hosting & support** - soe; closes 2026-11-06; `ocds-9t57fa-174370`; read: full; category: `it_support_managed_services, software_systems`
  - SBD1/3/4/6.1; Form A authority to sign (board resolution); Form B1/B2 schedule of previous contracts (2 contracts, min 3 yrs, last 12 yrs, public sector) - reference letters NOT accepted; company profile reflecting relevant experience; ICASA ISP certification or authorised partner proof (not older than 6 months); key personnel CVs + certified qualifications (certification not older than 6 months): NQF6 IT project leader 5yrs, Cisco CCNP/CCIE, Fortinet NSE7/CISSP; methodology; CSD + TCS; JV agreement; SG: HDI 51% black 8, black women 4, black youth 4, disability 20%+ 4
- **t008 - Ba-Phalaborwa LM - training panel (advert)** - municipal; closes 2026-11-06; `ocds-9t57fa-174258`; read: advert; category: `training_skills_development`
  - Ba-Phalaborwa LM training panel (scanned advert); t009 Bitou LM 1MVA transformer (document fee, register on municipal supplier database); t013 Cederberg LM road rehab MR539 (CIDB 4CE, proof; fee via consulting engineer UDS Africa); t035 EC Transport scholar transport panel addendum (vehicles must be registered in bidder's / director's name; public transport operating requirements); t039 Emalahleni multidisciplinary PSP landfill (scanned advert); t051 Kagisano-Molopo community hall (scanned advert); t060 Mangaung bids bulletin (scanned); t065 Mopani DM water schemes (proof of CIDB grading, certified Workmen's Compensation certificate, proof of VAT registration; refundable doc fee); t072 Mpumalanga PWRT road D4382 (scanned 1 page); t085 Oudtshoorn firefighting PPE (CSD); t108 Swellendam grass cutting (TCS PIN); t109 Swellendam Railton walkway (CIDB 4CE, TCS cert + PIN, compulsory site meeting, relevant key personnel)
- **t009 - Bitou LM SCM/2026/111 - 1MVA transformer (advert)** - municipal; closes 2026-11-13; `ocds-9t57fa-174094`; read: advert; category: `electrical_installation_reticulation`
  - Advert only on eTenders - see the advert-only list in section 1.3.
- **t010 - Border Management Authority H004L2706RFP00075 - org design** - national; closes 2026-11-17; `ocds-9t57fa-174106`; read: full; category: `management_consulting, hr_recruitment_staffing`
  - admin: SBD1, CSD declaration, SBD3, SBD4, authority to sign, SBD6.1 + active B-BBEE cert/affidavit, SBD7; mandatory: copies of qualifications of Org Design / Workforce Planning / Job Evaluation / Change Mgmt specialists, detailed CVs in buyer's CV template (nationality, contact, qualification + institution + year + NQF level, professional body + reg number + category + expiry, training/certifications, summary of experience); proof of current registration & good standing
- **t011 - CEF (SOC) ISP/10/2026 - internet, firewall, network** - soe; closes 2026-11-05; `ocds-9t57fa-174484`; read: full; category: `networks_telecoms, cybersecurity`
  - valid TCS (separate per JV party) + SARS verification PIN; B-BBEE affidavit/cert; CSD report/MAAA; signing power - board resolution; certificates of acquaintance; breach of law form; SBD1/4/6.1; mandatory: own Network Operation Centre in SA >=3 yrs (company-letterhead letter); OEM SLA/certificate letter (internet, switches, firewall); ISPA membership; SSA security screening pre-appointment; returnables must stay valid for contract duration
- **t012 - CTICC 009/2027 - CCTV & access control** - municipal; closes 2026-11-10; `ocds-9t57fa-173294`; read: full; category: `electronic_security`
  - bid submission checklist; Compulsory Declaration: enterprise details (contact person, email, tel, cell, fax, physical address, MUNICIPAL ACCOUNT NUMBER, postal), company representative (name, ID, position, email), authority resolution copy, TCS PIN/certificate, company reg no, tax ref, VAT no, PRINCIPALS table (name, ID number, residential address, municipal account number) + certified IDs + municipal accounts of principals; lease or affidavit if not owned/rented; record of service to the state; MBD 9; MBD 5 (>R10m); confirmation of CTICC supplier database + CSD; MBD 6.1; insurance schedule; minimum requirements; tenderer's experience; key staff experience; methodology
- **t013 - Cederberg LM CED 22 - MR539 road rehab (advert)** - municipal; closes 2026-11-17; `ocds-9t57fa-174358`; read: advert; category: `road_construction_upgrade`
  - Advert only on eTenders - see the advert-only list in section 1.3.
- **t014 - City of Johannesburg COJ0011-26/27 - branded merchandise** - municipal; closes 2026-10-22; `ocds-9t57fa-174236`; read: full; category: `signage_promotional`
  - original certified company registration document; rates & taxes invoice for COMPANY or certified lease or lessor affidavit (commissioner/SAPS); rates & taxes for ALL DIRECTORS or lease/lessor affidavit; declaration on state of municipal account; MBD4, 6.1, 6.2 (local content), 8, 9; statement of authorisation (Form D); OHS Act article of agreement (Form I); original certified B-BBEE cert or sworn affidavit; original tax clearance or SARS PIN; IF REQUIRED: SETA accreditation (training suppliers), Health Certificate (catering suppliers), CIDB registration (construction) - certified copies; City supplier database registration
- **t015 - City Power JHB BID-2656S - oil spillage clean-up** - municipal; closes 2026-11-19; `ocds-9t57fa-174468`; read: full; category: `environmental_rehabilitation, waste_collection_disposal`
  - mandatory: valid COIDA certificate; valid waste licence incl hazardous waste for disposal facility (DFFE); returnables: municipal rates statement company OR any director (<=90 days arrears, not older than 3 months) or lease signed both parties; SHERQ; MBD 1,3.1,3.2,4,5,6.1,6.2,7.1,8,9; certified (<=3 months) B-BBEE cert/affidavit, consolidated cert if JV; certified (<=3 months) ID copies of owners; tax clearance/PIN; financial statements past 3 years; CSD report; SG: 51% black 5, 30% black women 4, 51% black youth 4, 51% black disabled 3 (doctor/psychologist letter), local within CoJ 4 (municipal account statement or lease)
- **t016 - City of Cape Town 99S/2026/27 - urban CCTV** - municipal; closes 2026-11-20; `ocds-9t57fa-174355`; read: full; category: `electronic_security`
  - eligibility: PSIRA certificate of registration + valid PSIRA letter of good standing at closing (non-responsive without); technicians: PSIRA registration + CCTV/networking course certs with CVs; system manufacturers ISO 9001; COID with approved licensed compensation insurer (FEM/RMA); fails if not maintaining mandatory statutory registrations; tax compliance verification; data protection (POPIA)
- **t017 - City of Cape Town 096Q/2026/27 - treated effluent term tender (5-page advert)** - municipal; closes 2026-11-18; `ocds-9t57fa-174357`; read: advert; category: `water_wastewater_treatment`
  - CIDB 3CE/4CE/5CE; registered on supplier databases (City's + CSD); full doc via City e-procurement portal
- **t018 - City of Tshwane GFS 04 - municipal valuer support (SAP Ariba only)** - municipal; closes 2026-11-27; `ocds-9t57fa-174523`; read: none; category: `property_valuation`
  - eTenders file is only Notice 6 of 2026/27; actual bid documents ONLY via SAP Ariba Business Network (registration required) - NOT ACCESSED; notice lists CIDB 6CE (WSBU 01), 3ME (GPM 18), compulsory briefings
- **t019 - City of Tshwane GPM 06 - land development PM/transaction advisory (SAP Ariba only)** - municipal; closes 2026-12-03; `ocds-9t57fa-174532`; read: none; category: `project_construction_management, feasibility_research_advisory`
  - Documents not reachable - see section 1.3.
- **t020 - City of Tshwane EEBU 06 - LED luminaires (SAP Ariba only)** - municipal; closes 2026-12-04; `ocds-9t57fa-174546`; read: none; category: `electrical_installation_reticulation`
  - Documents not reachable - see section 1.3.
- **t021 - City of Tshwane WSBU 01 - water appurtenant works (SAP Ariba only)** - municipal; closes 2026-11-30; `ocds-9t57fa-174549`; read: none; category: `water_supply_reticulation`
  - Documents not reachable - see section 1.3.
- **t022 - Correctional Services KZN 05/2025 - ambulance services** - national; closes 2026-10-30; `ocds-9t57fa-173383`; read: ocr; category: `health_services`
  - CSD (business registration, directorship/ID numbers, tax status, banking info uploaded); B-BBEE cert/affidavit; CERTIFICATION RULES: commissioner of oaths signature + date + printed name, certification date not older than 6 months, copy of a certified copy not accepted; SBD1/3.1/4/6.1 handwritten in ink; every page initialled; certified HPCSA licences to practise / membership; certified Ambulance Service licence from Dept of Health stating the district accredited to operate; TCS PIN + CSD number
- **t023 - Council for Geoscience CGS-2026-046NM - core drilling equipment** - public entity; closes 2026-11-11; `ocds-9t57fa-174466`; read: full; category: `mining_quarrying, appliances_equipment`
  - 1 original + 2 copies; TCS; SBD1/4/6.1; CSD report (supplier application form); latest original certified copies of company registration certificate; SHAREHOLDING BREAKDOWN per race, gender and percentage (incl non-individual shareholders); certified SANAS B-BBEE cert/DTI cert/sworn affidavit (consolidated for JV); mandatory: valid internationally recognised QMS certificate (ISO 9001); 2 contactable client reference letters (letterhead, items, delivery date, signed; POs/appointment letters NOT accepted) last 5 yrs; JV agreement with % split; subcontracting agreement
- **t024 - CSIR RFQ 9548 - office refurbishment (4GB)** - public entity; closes 2026-11-10; `ocds-9t57fa-174505`; read: full; category: `building_maintenance_renovation`
  - CIDB 4GB+ (CRS number or proof); COIDA letter of good standing relevant to scope/class of works (DEL or private insurer); electrical contractor registration with Dept of Labour; wireman's licence (Installation Electrician) own or subcontracted; SAQCC Gas card category B6 (refrigeration, CoC); SABS-approved glazing certificate of compliance; 3 contactable reference letters/completion certs 2020-2026 multidisciplinary (POs/contracts/appointment letters NOT accepted) + 1 per subcontracted discipline; JV agreement; subcontract agreement; SANAS B-BBEE cert; ID needed for site access
- **t025 - CSIR RFP 3785 - fluidised-bed detailed design** - public entity; closes 2026-11-06; `ocds-9t57fa-174507`; read: full; category: `consulting_engineering`
  - mandatory: proof of valid ECSA registration (or international equivalent signatory body) for each lead engineer; proof of degree (BEng/BSc/BTech) for each; PI insurance R50m OR letter of intent from registered insurer; JV agreement; subcontract agreement; copies of affiliations/memberships/accreditations; JV: proof of ownership/shareholder certificates; B-BBEE cert/affidavit (consolidated scorecard for JV; both parties if subcontracting)
- **t026 - CATHSSETA CATHS/QAS/02/2026 - QA assessor panel** - public entity; closes 2026-11-06; `ocds-9t57fa-174438`; read: full; category: `training_skills_development`
  - mandatory: proof of ETDP SETA assessor & moderator statement of results or OD ETD qualification for 9 QA assessors; SBD1, 3.3, 4, 6.1, 7.2; GCC; TCS with PIN; valid B-BBEE certificate; company registration documents; CSD summary; pricing on official corporate letterhead; CVs + certified qualifications of assessors & project lead; 3+ signed reference letters for accreditation visits
- **t027 - Dept of Defence CPSC/B/365/2026 - tents** - national; closes 2026-11-05; `ocds-9t57fa-174076`; read: ocr; category: `goods_supplies`
  - two-envelope; SBDs; B-BBEE certificate (0 points if missing); CSD report; VAT number; DOD SECURITY "GROUP QUESTIONNAIRE: PRIVATE COMPANIES" (mandatory, invalid if incomplete): company name, registration no, DOD supplier code, personal particulars of directors (+ RSA ID AND PASSPORT copies), subcontractors' particulars + IDs, physical & postal address, CORE BUSINESS, date operations began, tax clearance number + certified copy, CIPC registration number + certified certificate, SHAREHOLDERS and % each, services to other state departments (names, periods), implicated in fraud/corruption/criminal activity, EMPLOYMENT EQUITY PLAN + number & composition of employees, track record & achievements, under investigation by any security agency, factors preventing contracting; attach director profiles, current FINANCIAL STATEMENTS, valid tax clearance, COMPANY PROFILE; sub-contractor compliance certificate
- **t028 - DALRRD RQ-016988 - ESTA mediation** - national; closes 2026-10-22; `ocds-9t57fa-174063`; read: ocr; category: `legal_services`
  - SBD1, 3.1, 4, 6.1, GCC; mandatory: certificate of mediation training from SAQA-accredited institution (verified); >=1 yr experience as mediator or attorney (CV with contactable references); mediators drawn from department's Procurement Database System of accredited mediators; SG proof: ID copy + company registration, doctor's letter for disability; printed copy R100
- **t029 - ESKOM LC SI-138 - HVAC maintenance LimLanga (2ME)** - soe; closes 2026-11-03; `ocds-9t57fa-174516`; read: full; category: `hvac_refrigeration, facilities_management`
  - mandatory: SARACCA registration certificate (HVAC contractor, company or director's name); CIDB 2ME; functionality: trade test certs (refrigeration & air-con) certified by Commissioner of Oaths within 3 months for 2 technicians, supervisor National Diploma, 2 artisans, 2 installers (N1-N3/short course); company ORGANOGRAM with personnel names + ID numbers + detailed CVs; experience: 3+ HVAC maintenance projects - completion certificate or signed letter on letterhead with contract number, scope, duration; VEHICLES: certified vehicle registration documents in company/owner/director name OR rental agreement; tools & equipment list; site verification; Supplier Quality Mgmt 240-105658000: Form A, valid ISO 9001 (or applicable QMS cert), latest internal + external audit reports with NC/corrective actions, documented QMS roles (org charts, job descriptions), draft contract quality plan (ISO 10005), ITP/QCP example, control of externally provided processes, management review records; OHS acknowledgement form; Supplier Integrity Pact; EME/QSE affidavit templates; e-tendering training acknowledgement; ESKOM Supplier Evaluation (PAYE/personal-service-provider) Pack: representative ID, residence, number of full-time employees NOT connected persons (>=3 affidavit), >80% income from one client test, labour-broker / independent contractor declarations
- **t030 - ESKOM E3668CXMWP - skills audit & competence framework** - soe; closes 2026-10-30; `ocds-9t57fa-174281`; read: full; category: `hr_recruitment_staffing, management_consulting`
  - Annexure A authorisation form, B acknowledgement, C TENDERER'S PARTICULARS, D integrity pact declaration; CPA forms; SBD1/4/6.1; e-tendering acknowledgement; CIDB proof (where applicable)
- **t031 - EC Agriculture SCMU8-0143 - office lease Joubertina** - provincial; closes 2026-11-09; `ocds-9t57fa-174526`; read: full; category: `office_accommodation_leasing`
  - SBD docs; CSD with compliant tax; compulsory briefing; JV agreement; certified title deed (owner) or title deed + power of attorney/mandate letter, or deed of sale; OHS certificates for building; written NBR compliance warranty; in loco inspection
- **t032 - EC Agriculture SCMU8-0043 - security Uitenhage** - provincial; closes 2026-11-09; `ocds-9t57fa-174531`; read: full; category: `security_guarding`
  - CSD AND LOGIS registration; PSIRA company certificate (active); UIF registration; COIDA letter of good standing (certified); bargaining council registration; firearm licence in company/owner name; police clearance for owner(s); liability insurance >= R2m; fully functional office >=1 year in local municipality (site inspection; same evidence as SG + CSD address); owner must be SA citizen; proof of armed response in local municipality; ICASA licence (radio) or lease; references; financial capacity: credit facility letter or bank statement not older than 3 months (R200k-R1m bands); locality scored from CSD address + proof; post-award payslips/payroll/staff police clearance
- **t033 - Coega DC CDC/441/26 - new school Amaoti (8GB)** - provincial; closes 2026-11-25; `ocds-9t57fa-174518`; read: full; category: `building_construction`
  - T2: SBD1/4/6.1; CIDB proof (reg number); schedule of work carried out (25 projects/5yrs with appointment letters AND completion certificates); schedule of current contracts; key personnel CVs + qualifications; schedule of plant & equipment; FINANCIAL REFERENCES; programme & methodology; record of addenda; OHS Form L; authority for signatory (company resolution per entity; JV lead authority); JV disclosure / letter of intent or JV agreement; B-BBEE preferencing (construction codes: generic & QSE <51% black -> SANAS certificate; EME >R3m turnover -> SANAS cert; EME <R3m -> sworn affidavit OR CIPC certificate confirming ownership + turnover; JV consolidated project-specific cert + individual certs); QUALITY MANAGEMENT PLAN; POPIA consent (per JV party); certificate of acquaintance; Form K EME/QSE CPG declaration; VAT registration required; CSD MAAA; proof of office establishment for locality: title deed in bidder's name / signed lease (landlord contacts) / municipal account <3 months in bidder's name / municipal billing clearance certificate (CSD, CIPC, letterheads NOT accepted); post-award: SACPCMP CHSO (8 yrs, no candidate), Environmental Officer (ND/BTech, 8 yrs), Contracts Manager PrCPM/PrCM; public servants prohibited (directors verified); construction guarantee
- **t034 - EC Health SCMU3-0038 - cleaning Flagstaff CHC** - provincial; closes 2026-11-06; `ocds-9t57fa-174477`; read: full; category: `cleaning_hygiene`
  - CSD registration certificate; SBD1/3.1/4/6.1; company profile + technical proposal (capacity); JV agreement; COIDA certificate or tender letter from Dept of Labour; UIF registration + list of registered employees (or DoL tender letter); database of >=12 cleaners with experience; local labour letter on company letterhead (stamped); agreements/letters of intent with EC-based manufacturers (uniforms, SABS cleaning materials, machinery); post-award: National Provident Fund (contract cleaning) registration + employee list; experience: client reference letters on letterhead with value, start/end dates, square meterage (years in business scored 1-6+ yrs); locality proof: title deed / councillor letter / signed lease; tools & equipment site visit; consortium consolidated B-BBEE cert; audited financial statements mentioned
- **t035 - EC Transport SCMU10-0017 - scholar transport panel (addendum only)** - provincial; closes 2026-11-06; `ocds-9t57fa-174419`; read: advert; category: `transport_logistics`
  - Advert only on eTenders - see the advert-only list in section 1.3.
- **t036 - ETDP SETA RFQ 16 - research methodology framework** - public entity; closes 2026-10-28; `ocds-9t57fa-174229`; read: full; category: `feasibility_research_advisory`
  - certified B-BBEE cert (SANAS) OR CIPC B-BBEE certificate OR sworn affidavit; JV consolidated cert for this bid + each member's accreditation cert; CSD; deregistered/blacklisted companies & linked directors excluded; companies in CIPC de-registration excluded; project team structure with names & roles; PM certified qualifications + CV (Master's minimum); foreign qualifications need SAQA evaluation letter; SG: 100% black women 4, 51% black women 1, 51% youth 2, 51% disabled 1 (medical report), SMME/QSE/EME 2, cooperatives/NPC/NPO/CBO registration docs (CIPC/DSD), located in province 2 / in SA 1 (municipal account); ID copy of director/owner
- **t037 - ERWAT ERW2605/01 - external whistleblowing hotline** - municipal; closes 2026-11-19; `ocds-9t57fa-174503`; read: full; category: `legal_services, management_consulting`
  - CSD; SARS PIN; rates & taxes record not older than 3 months for company AND ALL directors; leased premises: lease + SAPS affidavit; traditional land: recent Tribal Authority letter + SAPS affidavit; spouse-directors with different surnames: certified marriage certificate; MBD forms; JV/consortium/trust/partnership: TCS for both + signed teaming agreement; mandatory: certified Ethics Institute Safeline-EX accreditation certificate in company's name; disability proof from medical doctor; CSD checks: ID number, tender default/restriction status
- **t038 - Elundini LM ELM-4/004 - data backup & replication** - municipal; closes 2026-11-17; `ocds-9t57fa-174425`; read: ocr; category: `it_support_managed_services`
  - eligibility in Tender Data (separate); functionality company experience 50/expertise 40/methodology 10; tender document sold R250 + proof of payment; JV consolidated B-BBEE (original/certified) or sworn affidavit attested by commissioner; compulsory returnables for JV; SG: EME/QSE 51% black women (company registration doc + certified ID), 51% black youth 18-35 (reg doc + certified ID), 51% black disabled (certificate from SASSA or doctor), 51% black (reg doc + certified B-BBEE cert or original sworn affidavit)
- **t039 - Emalahleni LM - multidisciplinary PSP landfill (advert, scanned)** - municipal; closes 2026-11-17; `ocds-9t57fa-174089`; read: advert; category: `consulting_engineering, waste_collection_disposal`
  - Advert only on eTenders - see the advert-only list in section 1.3.
- **t040 - Eskom NTC E3681NTCSANEG - line emergency equipment maintenance** - soe; closes 2026-11-24; `ocds-9t57fa-174495`; read: full; category: `mechanical_plant_equipment, electrical_installation_reticulation`
  - Cat 2 quality returnables: ISO 9001 certificate (scope relevant, accredited CB, international accreditation, valid) OR documented QMS (QMS manual, quality policy & objectives approved by top mgmt, document control, nonconforming output, corrective action, internal audit procedures); org chart + responsibility matrix incl quality role; external provider control procedure; latest internal audit report; management review records; draft contract quality plan (ISO 10005); ITP/QCP example; Form A; supplier declaration of interest; NDA; SHE rules acknowledgement; CIDB proof within 21 days if applicable; SDLI (supplier development) strategy; annexures C/D/E are scans (not read)
- **t041 - Garden Route DM IGRDM/03 - lifesaving De Hoek** - municipal; closes 2026-10-30; `ocds-9t57fa-174100`; read: full; category: `facilities_management`
  - checklist: MBD1/3.1/4/6.1/7.1/8/9; terms of reference; CURRENT MUNICIPAL CERTIFICATE / lease agreement (primary business location, also locality points); form of offer; authority of signatory (resolution); TCS PIN + MAAA; registration on accredited supplier database (municipal); valid original or certified B-BBEE certificate (JV cert in JV name); lifesaving qualifications (scope)
- **t042 - Gauteng COGTA 01/01/2026 - cleaning, hygiene, pest control** - provincial; closes 2026-11-09; `ocds-9t57fa-174204`; read: full; category: `cleaning_hygiene, pest_control`
  - Stage 1 statutory: certified COIDA letter of good standing in company name; liability insurance R1m in company name (certified copy, certification <= 6 months); CCNPF (Contract Cleaning National Provident Fund) letter of good standing; pest control & fumigation registration with Dept of Agriculture (Act 36); hazardous waste disposal registration with Dept of Environment; compulsory briefing; authority proof; JV agreement NOTARIZED by attorney; subcontracting agreement; SG proofs: CSD, CIPC documents, certified IDs of directors/shareholders / share certificate, disability medical certificate (practitioner with practice number), proof of address / municipal statement / lease; site inspection/due diligence of premises & equipment
- **t043 - George LM GMQ010 - rigging 66kV transformers** - municipal; closes 2026-10-30; `ocds-9t57fa-174160`; read: full; category: `electrical_installation_reticulation`
  - CIDB registered; valid original/certified B-BBEE cert; T2.1: Form 2.1.1 General Information (name, address, tel, fax, email, legal entity type, income tax ref, regional services area + RSC levy reg number, VAT no, company/CC reg no, details of proprietors/partners/members/directors with NAME, ID, technical qualifications, years of relevant experience; JV: written power of attorney + JV agreement compulsory); 2.1.2 authority for signatory; 2.1.3 schedule of work carried out; 2.1.4 key personnel; 2.1.5 schedule of infrastructure & resources; 2.1.6 approach & methodology; 2.1.7 subcontractors; 2.1.8 FINANCIAL REFERENCES
- **t044 - George LM GMQ009 - office furniture** - municipal; closes 2026-10-23; `ocds-9t57fa-174171`; read: full; category: `furniture`
  - valid original or certified B-BBEE certificate; tax clearance for > R30k; status of municipal accounts (certificate for municipal services); certified IDs of directors and owners; MBD 6.1, 9
- **t045 - Gert Sibande DM GSDM 07/2026 - lab reagents** - municipal; closes 2026-11-06; `ocds-9t57fa-173384`; read: full; category: `chemicals, laboratory_scientific`
  - MBD1; Form A past SCM; B declaration of interest; C authority of signatory; D SARS good standing (CSD); E FINANCIAL REFERENCES / BANK DETAILS; F MUNICIPAL UTILITY ACCOUNT (compulsory) + municipal clearance where based; G preference; I MBD9; J >R10m declaration; K addenda; M form of offer; >=3 appointment letters/POs for lab chemicals past 5 years; company profile; quote with trade name, legal name, VAT number; CC: CK1/CK2 + certified director IDs; Company: certificate of incorporation + certified director IDs + SHAREHOLDERS REGISTER; JV agreement + each member's docs; partnership: partner IDs; sole trader: ID; certificate of analysis traceable (product)
- **t046 - National Dept of Health HP08-2026SSP/01 - semi-solid dosage forms** - national; closes 2026-11-16; `ocds-9t57fa-174553`; read: full; category: `medical_supplies_equipment`
  - PBD3 bid signature authorisation: table of directors/members/owners/partners (name, ID, signature) + authorised signatories (name, ID, position); PBD4.1 contact details: registered name matching banking detail, contract enquiries contact (name, email, tel, fax, cell), orders contact + address for posting orders, national key account manager; PBD9.1/9.2 directors profile: full names, surname, ID/passport, nationality, executive/non-executive, ownership/directorship in related enterprises; CSD MAAA; company reg no; VAT; Medicine Registration Certificate, Licence to Manufacture (number, expiry), GMP status, third-party sourcing authorisation letters (PBD1); QSE/EME affidavit guide (deponent director/owner, enterprise name per CIPC, financial year end, commissioner independent); provincial Health supplier databases separate
- **t047 - Hessequa LM HES-TECH 04 - renewable energy install (part scanned)** - municipal; closes 2026-11-20; `ocds-9t57fa-174017`; read: full; category: `renewable_energy`
  - (mostly scanned; text pages): valid COIDA certificate; preference to suppliers on Municipality's accredited supplier database; tender fee via bank deposit
- **t048 - IDC/Foskor FOSPHB-RFP-23 - cleaning & hygiene** - soe; closes 2026-11-10; `ocds-9t57fa-174418`; read: full; category: `cleaning_hygiene`
  - organisation chart with manpower resources; organogram of key persons (site manager etc) with years experience; COC/OH&S; list of cleaning agents; detailed work methodology (disqualification if missing); company profile / portfolio of similar contracts with references; insurances incl COID letter of good standing; site manager Foskor legal liability certificate on commencement
- **t049 - Iziko Museums - exhibition cabinetry RFQ** - public entity; closes 2026-10-23; `ocds-9t57fa-174178`; read: full; category: `furniture`
  - CSD report with supplier number + tax status PIN + tax registration number; pricing on company letterhead; valid B-BBEE cert/affidavit; SBD4/6.1; PORTFOLIO of >=5 relevant projects in past 10 years (photos/details); SG proof: B-BBEE cert, company registration
- **t050 - Joburg Market PMO-CP-003 - furniture** - municipal; closes 2026-10-28; `ocds-9t57fa-174014`; read: full; category: `furniture`
  - CSD; MBD 1,4,6.1,7.1,8,9; GCC signed; rates & taxes account not older than 3 months OR lease; ID copies of shareholders/directors AND share certificates (certification <=3 months); JV agreement + separate CSD + consolidated B-BBEE; CIDB where applicable; FINANCIAL STATEMENTS analysed with ratios (current ratio, solvency ratio, operating profit margin, cost coverage); locality proof: municipal statement / lease / ward councillor letter; SG: 51% black (CSD, B-BBEE, owner IDs, shareholder certificate), 51% women, etc.; compulsory briefing
- **t051 - Kagisano-Molopo LM KMLM2027-001 - community hall (advert, scanned)** - municipal; closes 2026-11-13; `ocds-9t57fa-174021`; read: advert; category: `building_construction`
  - Advert only on eTenders - see the advert-only list in section 1.3.
- **t052 - Ezemvelo KZN Wildlife RFQ 12/10/2026 - play equipment & minor works** - provincial; closes 2026-10-30; `ocds-9t57fa-174252`; read: full; category: `sports_recreation_facilities, building_maintenance_renovation`
  - email-only single submission; compulsory site attendance; SBD forms; B-BBEE cert/affidavit; CSD details declaration (information correct and up to date)
- **t053 - KZN Human Settlements ZNB161 - security guarding** - provincial; closes 2026-11-03; `ocds-9t57fa-173376`; read: ocr; category: `security_guarding`
  - Sections: CSD registration (declaration CSD info up to date), official briefing/site inspection certificate, SBD 6.1, ToR; pricing breaks out statutory cost lines per officer: UIF, COIDA/WCA, bargaining council levy, PSIRA per-SO fee (i.e. company must be registered for all four); proof of authority; restriction rules apply to directors/partners
- **t054 - KZN Public Works ZNTM01233W - land surveying firm** - provincial; closes 2026-10-26; `ocds-9t57fa-174046`; read: full; category: `surveying_gis`
  - Section C CSD registration; D declaration CSD info up to date; E PROFESSIONAL COUNCIL certificate of a DIRECTOR/MEMBER of the company + letter of good standing + professional registration number (here SAGC land surveyor); SBD4; form of offer; SBD6.1; compulsory briefing (site inspection certificate stamped); TCS; authority to sign; VAT no; SG proofs: EME affidavit signed by commissioner of oaths or B-BBEE cert + certified ID; locality Umgungundlovu: municipal account showing physical address <=3 months / lease / certified ward councillor letter; rural: ward councillor letter / certified PTO / tribal council lease; tender-document fee with proof of payment
- **t055 - Land Bank - farm viability assessment** - public entity; closes 2026-10-23; `ocds-9t57fa-174493`; read: full; category: `agriculture, feasibility_research_advisory`
  - mandatory: quotation; >=3 client reference letters or completion certificates for comparable agricultural viability/turnaround assignments within 10 yrs; signed letter of undertaking to deploy qualified, resourced team; essential: SARS good standing (CSD/e-filing PIN), CSD vendor proof, SBD4, SBD6.1, team CVs
- **t056 - Legal Aid SA 51/2026 - office accommodation Soweto** - public entity; closes 2026-11-17; `ocds-9t57fa-174402`; read: full; category: `office_accommodation_leasing`
  - SBD forms; original/certified B-BBEE cert/affidavit (JV consolidated); CSD report for ALL parties (agent, landlord, JV partners); title deed (or title deed + owner mandate/relationship agreement/letter of authority); building compliance docs: occupancy certificate, zoning certificate, fire safety compliance, electrical CoC, pest control certificate (<12 months) or undertakings
- **t057 - Lepelle Northern Water LNW01/26/27 - communications agency** - soe; closes 2026-11-20; `ocds-9t57fa-174547`; read: full; category: `advertising_marketing`
  - admin: SBD1, SBD6.1, valid SARS tax PIN, company registration docs/CIPC (CK), valid B-BBEE cert/affidavit; mandatory: JV agreement (lead partner + % split = 100%), SBD4 + SBD3.1, CSD summary (all JV partners), company's OR director's municipal rates & taxes account <=3 months, or signed lease in company name, or dated & stamped traditional authority letter, certified director IDs not older than 6 months; functionality: up to 5 signed, verifiable reference letters
- **t058 - Limpopo Office of the Premier PRDP 01 - infrastructure master plan review** - provincial; closes 2026-11-17; `ocds-9t57fa-174393`; read: ocr; category: `feasibility_research_advisory`
  - SECTION B BIDDER PROFILE: entity particulars (business address, company + VAT registration numbers, contact details), ENTITY STRUCTURE, MANAGEMENT STRUCTURE, operating structure, GEOGRAPHICAL SPREAD / presence, JV role & management structure, years in business + DATE OF ESTABLISHMENT + proof of registration with Registrar of Companies, CORE BUSINESS and how long, standing partnerships/business associations (schematic), major technology suppliers, TOTAL STAFF COMPLEMENT, MANAGEMENT & TECHNICAL STAFF complement, SA client list (names, contact persons, nature of services), VAR/franchisee accreditation proof from principals + written backing; brochure of services (no website link); company profile; JV agreement; each party on CSD
- **t059 - Maluti TVET - property valuation & GRAP asset register (advert)** - public entity; closes 2026-10-27; `ocds-9t57fa-173295`; read: advert; category: `property_valuation`
  - CSD compliant tax; Professional Valuer registered with SACPVP (commercial category); 5 yrs valuation experience incl GRAP public sector; briefing; SBD1, 3.3, 4, 6.1, 8, 9
- **t060 - Mangaung Metro bids bulletin 217 (scanned)** - municipal; closes 2026-11-19; `ocds-9t57fa-174538`; read: advert; category: `water_wastewater_treatment`
  - Advert only on eTenders - see the advert-only list in section 1.3.
- **t061 - merSETA RFQ-LEA-180 - accredited SDP / assessment centre** - public entity; closes 2026-10-21; `ocds-9t57fa-174010`; read: full; category: `training_skills_development`
  - CSD; SBD4; SBD6.1; registration certificates for companies/CCs/partnerships (or agreements); board resolution on company letterhead; accreditation as SDP/assessment centre (QCTO/SETA)
- **t062 - Medical Research Council - COID claims administration** - public entity; closes 2026-10-22; `ocds-9t57fa-173363`; read: full; category: `banking_insurance_investment`
  - company information pack: brief overview, head office & regional offices, core business hours, company organogram, account manager + key technical staff, key contacts, national/regional footprint (GP, WC, KZN), operational status, number of years in business, experience/history, HSE policy or commitment statement, quality systems info; >=3 references (company, contact, tel/email, nature of service, period) on customer letterhead or spreadsheet; draft master service agreement; returnables: CSD, TCS/PIN, company registration docs, B-BBEE status + certified SANAS certificate, SBD docs, JV authority, Compensation Fund letter of good standing, certified public-environmental liability insurance
- **t063 - Metsimaholo LM 01/2026/27 - 1.52km paved road** - municipal; closes 2026-11-09; `ocds-9t57fa-173992`; read: full; category: `road_construction_upgrade, stormwater_drainage`
  - CIDB-format T2.1 returnables; proof of specific goals docs; municipal rates & taxes statement; (structure same as t064 municipal rules)
- **t064 - Metsimaholo LM 02/2026/27 - PSP panel** - municipal; closes 2026-11-09; `ocds-9t57fa-173993`; read: full; category: `consulting_engineering`
  - CSD summary/number; company registration docs WITH director details (or sole prop ID / partnership agreement); proof of director NAME CHANGE if applicable; MBD forms handwritten black ink; JV agreement; latest municipal rates & taxes (Aug/Sep/Oct 2026) for COMPANY AND ALL DIRECTORS/TRUSTEES/MEMBERS/SHAREHOLDERS, not >3 months arrears, address must MATCH address on company registration documents; lease (signed both parties, commencement & expiry dates; expired lease + renewal confirmation letter); rural: municipality letter not liable for rates OR chief's letter; affidavits/address letters/body-corporate invoices NOT accepted; MBD 5 + AFS past 3 years if > R10m; reference forms (buyer template)
- **t065 - Mopani DM 2026/27-08 - Thapane water scheme (advert)** - municipal; closes 2026-11-09; `ocds-9t57fa-173444`; read: advert; category: `water_supply_reticulation`
  - Advert only on eTenders - see the advert-only list in section 1.3.
- **t066 - Moqhaka LM 5/2/001 - 5-year plan** - municipal; closes 2026-11-17; `ocds-9t57fa-174067`; read: full; category: `town_planning_urban_design, management_consulting`
  - company registration document (CIPC-CK showing name, reg no, date, active directors); valid tax clearance or TCS PIN (each JV member); CIDB certificate if applicable; municipal rates statement in company name <=3 months OR municipal clearance certificate OR municipal form stamped by municipality/landlord OR tribal authority letter OR valid lease + landlord statement OR landlord/director statement + commissioner-certified affidavit; certified director IDs not older than 6 months (180 days) - disqualified if none; CSD; B-BBEE cert/affidavit; registration on municipal accredited supplier database
- **t067 - Mossel Bay TDR31 - banking services** - municipal; closes 2026-12-18; `ocds-9t57fa-174247`; read: full; category: `banking_insurance_investment`
  - only banks registered under Banks Act 94 of 1990; CSD; TCS PIN; MBD 1/4/6.1/7/8/9; CIDB N/A; B-BBEE certificate guidance still names Accounting Officer/IRBA-registered auditor letterhead & practice numbers (legacy); tender fee for hard copy
- **t068 - Mossel Bay - town & regional planners panel** - municipal; closes 2026-11-27; `ocds-9t57fa-174371`; read: full; category: `town_planning_urban_design`
  - SACPLAN registration (30 points); local government experience (20 points); TCS PIN; MBD forms; CIDB N/A
- **t069 - Mossel Bay - building maintenance & repairs** - municipal; closes 2026-11-20; `ocds-9t57fa-174380`; read: full; category: `building_maintenance_renovation`
  - compulsory information meeting; references related to experience (15 points); CIDB registration number (if applicable); MBD forms
- **t070 - MEGA MEGA/2027/05 - internal audit panel** - provincial; closes 2026-11-12; `ocds-9t57fa-173996`; read: full; category: `audit_accounting_finance`
  - mandatory: company/CC/trust/partnership registration certificates; pricing; SBD1/4/6.1; letter of authority to sign; certified copies of directors'/shareholders' IDs; CSD detailed report; LETTER OF APPROVAL BY EXECUTIVE AUTHORITY if any member is a government employee; professional: IIA membership (audit manager, engagement director), ISACA/IIA/EC-Council (ICT audit), SAICA/SAIPA/IRBA for AFS review (per discipline)
- **t071 - MEGA MEGA/2027/07 - factory renovation (5GB+5EB)** - provincial; closes 2026-11-10; `ocds-9t57fa-174001`; read: full; category: `building_maintenance_renovation`
  - Compensation Fund letter of good standing valid at closing (letter of intent NOT accepted); company/CC/trust/partnership registration certificates; BOQ; letter of authority to sign; certified director/shareholder IDs; CSD detailed report; Executive Authority approval letter if government-employee member; JV agreement; CIDB 5GB + 5EB
- **t072 - Mpumalanga PWRT - road D4382 completion (advert, scanned)** - provincial; closes 2026-11-16; `ocds-9t57fa-174398`; read: advert; category: `road_construction_upgrade`
  - Advert only on eTenders - see the advert-only list in section 1.3.
- **t073 - Mpumalanga Social Development - event management** - provincial; closes 2026-11-09; `ocds-9t57fa-174145`; read: ocr; category: `events_management`
  - mandatory: SBD1, SBD4, SBD6.1; JV agreement signed & attested by commissioner of oaths; CSD; SAFETY OFFICER qualification (H&S diploma); LIABILITY COVER policy certificate; PSIRA registration certificate (security component) + SARS good standing; appointment letters/orders from previous clients; catering & décor capability; detailed CVs & project references
- **t074 - NMISA - hazardous waste management** - public entity; closes 2026-10-23; `ocds-9t57fa-174396`; read: full; category: `waste_collection_disposal`
  - valid Waste Accreditation Permit (collect/transport hazardous waste) from municipality/authority; registration on Gauteng AND Western Cape Waste Information Systems as hazardous-waste transporter; licences of landfill/treatment facilities used + proof of account/relationship with facility; vehicles with hazardous goods permits; drivers PrDP & hazmat training; references; SHE compliance
- **t075 - NMISA - penetration testing** - public entity; closes 2026-10-23; `ocds-9t57fa-174292`; read: full; category: `cybersecurity`
  - SBD4, SBD6.1, CSD report, valid B-BBEE certificate; licensed testing tools; methodology; references; compulsory technical specification yes/no with evidence
- **t076 - National Dept of Agriculture - recruitment advertising** - national; closes 2026-11-06; `ocds-9t57fa-174052`; read: full; category: `advertising_marketing, hr_recruitment_staffing`
  - GCC, SBD1, SBD3, SBD4, SBD6.1; CSD reference numbers on SBD1; capacity/ media placement proof
- **t077 - NHBRC - biometric fingerprint devices** - public entity; closes 2026-10-30; `ocds-9t57fa-174109`; read: full; category: `electronic_security, it_hardware`
  - SBD forms; 90/10 system; company registration number
- **t078 - National Lotteries Commission - internal audit EQA** - public entity; closes 2026-10-23; `ocds-9t57fa-174267`; read: full; category: `audit_accounting_finance`
  - admin: SBD6.1, CSD report, B-BBEE cert/affidavit (consolidated for JV); mandatory: JV agreement, SBD4, returnable SBD docs + pricing, lead validator recognised by IIA SA as External Quality Assurance Reviewer (certificate) or IIA quality-assessor training evidence, team member CIA certification (IIA)
- **t079 - NRF (SAEON) - botanical resurvey** - public entity; closes 2026-10-23; `ocds-9t57fa-174422`; read: full; category: `environmental_assessment, laboratory_scientific`
  - returnable documents checklist with page references; CSD master registration (supplier) number; B-BBEE cert or sworn affidavit; >=2 relevant references for botanical/vegetation survey work in fynbos; reference letters verified for recommended bidder; due diligence interviews/proof of concept
- **t080 - National Treasury - transversal fuel equipment panel** - national; closes 2026-11-16; `ocds-9t57fa-174464`; read: full; category: `mechanical_plant_equipment, fuel_lubricants_gas, fire_protection`
  - Table 1: pricing; SBD1 + proof of authority; SBD4; SBD5 NIPP; SBD6.1; TCD 13 authorisation declaration (OEM/agent) + 13.1 goods list + 13.2 authorisation letter of undertaking; written confirmation for SARS to disclose tax status; CSD report; CIPC company registration documents; copy of IDs of OWNERS AND DIRECTORS; per category: proven track record of installed systems, ISO 9001 certificate, (professional) indemnity insurance
- **t081 - Ndlambe LM - civil & building contractors panel** - municipal; closes 2026-11-09; `ocds-9t57fa-173297`; read: full; category: `building_construction, road_maintenance`
  - tax reference number + PIN or TCC; MBD9; MBD6.1 + original certified B-BBEE cert or original sworn affidavit; MUNICIPAL BILLING CLEARANCE CERTIFICATE for company AND directors/owners (declaration form); CSD supplier number; POPIA notice; tender fee (R147.55)
- **t082 - Nkangala DM 35358 - ICT internal audit panel** - municipal; closes 2026-11-03; `ocds-9t57fa-173355`; read: full; category: `audit_accounting_finance, cybersecurity`
  - Form B Compulsory Enterprise Questionnaire (consortia/JV); C POPI notice & consent; D MBD8; E declaration of interest; F authority of signatory; G tax good standing declaration; H FINANCIAL REFERENCES: bank letter <=3 months confirming account + bank name, ACCOUNT NAME, ACCOUNT TYPE, ACCOUNT NUMBER, bank address, bank contact person & tel, how long account has existed (0-6/7-12/13-24/>24 months) - unresponsive without letter; I municipal utility account declaration; J preference; K MBD9; L LITIGATION HISTORY (tenderer + directors/shareholders/senior members incl previous companies, 10 yrs, with organs of state); M proof of membership IIA/ISACA; N PI insurance (min R50k per claim); O project structure; P key personnel; Q previous experience; R current projects; S infrastructure & resources; T sub-consultants; U addenda
- **t083 - Nkangala DM - passenger lift maintenance** - municipal; closes 2026-11-02; `ocds-9t57fa-173382`; read: full; category: `mechanical_plant_equipment`
  - same Nkangala form set: B-L as t082 incl Form H bank letter/account details, I municipal account, L litigation; Form M PUBLIC LIABILITY INSURANCE; N project structure; O key personnel; P previous experience; Q current projects; R infrastructure & resources; S subcontractors
- **t084 - NW Public Works PWR 39 - office lease 154m2** - provincial; closes 2026-10-30; `ocds-9t57fa-174028`; read: ocr; category: `office_accommodation_leasing`
  - valid bank account; company registration certificate from Registrar of Companies; original valid tax clearance; JV agreement; ORIGINALLY certified IDs of main shareholders/directors (certification within 6 months, copies of previously certified copies rejected); CSD report; building grade (A/B/C) proof not older than 12 months by SAPOA-type accredited professional; zoning certificate, approved building plans, tenant layout plans; title deed / sale agreement + bond
- **t085 - Oudtshoorn LM TD 01/10/2026 - firefighting PPE (advert)** - municipal; closes 2026-10-30; `ocds-9t57fa-173359`; read: advert; category: `clothing_uniforms_ppe`
  - Advert only on eTenders - see the advert-only list in section 1.3.
- **t086 - PRASA - signalling supply & install** - soe; closes 2026-11-17; `ocds-9t57fa-174363`; read: full; category: `rail_infrastructure, electrical_installation_reticulation`
  - contractor warranties incl no winding-up/liquidation; all contract insurances; Railway Safety Regulator Act compliance; OHS sec 37(2) mandatary agreement; construction work supervisor appointment; site access certificate; CIDB (>= level 6 / R13m triggers H&S specialist); (returnable list in separate volume - contract-heavy text)
- **t087 - QCTO - media/podcast studio** - public entity; closes 2026-11-06; `ocds-9t57fa-174485`; read: full; category: `media_production, it_hardware`
  - COMPULSORY buyer CV template (role, references relevant to practice area, qualifications from most recent with copies in CV pack); consortium agreement signed by all, lead member authorisation; SG proof: B-BBEE cert/affidavit, ID copy & share certificate, CSD report; technical literature for brands
- **t088 - Rand Water - learnership (Occupational Certificate)** - soe; closes 2026-10-22; `ocds-9t57fa-174259`; read: full; category: `training_skills_development`
  - proof of SETA/QCTO accreditation for the qualification (SAQA ID 118766); qualified accredited facilitators; signed reference letters on referee letterhead (1-3+ scored); PM CV + qualifications; facilitator CV + qualifications; assessor & moderator accreditation for SAQA ID + CVs; SANAS B-BBEE cert / EME-QSE affidavit / dtic B-BBEE certificate
- **t089 - Road Accident Fund - security services RFQ** - public entity; closes 2026-10-20; `ocds-9t57fa-174081`; read: full; category: `security_guarding`
  - valid letter of good standing from Compensation Commissioner or authorised entity (sec 30/80 COIDA) for security guards sector; PSIRA letter of good standing for the company (and directors); PSIRA company registration certificate; office within 50 km of RAF offices; guards PSIRA-registered, Grade 12, experience; disability medical certificate from registered medical practitioner; CSD unique supplier number; company registration number
- **t090 - Rural Development & Land Reform - development plan consortium** - national; closes 2026-11-06; `ocds-9t57fa-174443`; read: full; category: `town_planning_urban_design, agriculture`
  - SBD1, 3.3, 4, 6.1, GCC; VAT registration number; original valid tax clearance (SBD2) question; B-BBEE cert issuer (SANAS); SG proof: certified ID + company registration doc / CSD report to substantiate % (black, female, youth, disability)
- **t091 - SASRIA - ethics risk assessments** - public entity; closes 2026-10-28; `ocds-9t57fa-174483`; read: full; category: `management_consulting`
  - CSD + tax compliant; valid B-BBEE cert or sworn affidavit; SBD forms; director/shareholder registration details with SARS/CIPC verified; mandatory technical requirements with cross-referenced substantiation
- **t092 - SASSETA - filming & live-streaming** - public entity; closes 2026-11-09; `ocds-9t57fa-174501`; read: full; category: `media_production`
  - company profile demonstrating filming/editing/streaming capability; >=3 signed reference letters with traceable references; >=3 sample videos (downloadable link); SBD forms; SBD6.1
- **t093 - Sekhukhune DM - electro-mechanical term contract panel** - municipal; closes 2026-11-19; `ocds-9t57fa-174424`; read: full; category: `mechanical_plant_equipment, electrical_installation_reticulation`
  - certificate of authority for JV; certified copy of IDs of directors; company registration documents / CK1 (compulsory); MBD5 with 3 years AUDITED financial statements for >R10m + certificate of no undisputed commitments for municipal services; MBD6.1; MBD9; valid tax clearance or PIN; CSD summary (compulsory)
- **t094 - SAA - IT resources (vendor form)** - soe; closes 2026-10-23; `ocds-9t57fa-174221`; read: full; category: `it_support_managed_services, hr_recruitment_staffing`
  - SAA VENDOR APPLICATION FORM: registered name, trading name, physical & postal address, phone, email, fax, city, province, postal code, contact person + phone + cell; BANK: bank name, branch name/number, BANK ACCOUNT NUMBER; VAT number; TAX CLEARANCE certificate number, approved date, expiry date; B-BBEE certificate number, verification date, expiry date; applicable scorecard (EME/QSE/Generic); status level; enterprise development Y/N; B-BBEE value-adding Y/N; % BLACK OWNERSHIP; % BLACK WOMEN OWNERSHIP; % BLACK PEOPLE WITH DISABILITIES; months/years in operation; ANNUAL TURNOVER previous financial year; authorised signatory name/phone/designation; attach: cancelled cheque/stamped bank confirmation letter not older than 1 year, B-BBEE cert/affidavit, tax clearance/SARS PIN, CSD report, certified company registration docs, certified shareholder IDs, certified shareholders' certificates
- **t095 - SAHRA - Duncan Village memorial rehabilitation** - public entity; closes 2026-10-28; `ocds-9t57fa-173307`; read: full; category: `building_maintenance_renovation, arts_culture_sport`
  - SBD1, SBD2 TCS PIN, SBD3, SBD4, SBD6.1 + valid B-BBEE certificate, SBD7.2, GCC initialled; CSD MAAA status; mandatory subcontract work & specified suppliers (PS10); VAT number
- **t096 - SANAS - accessibility ramp assessment** - public entity; closes 2026-10-27; `ocds-9t57fa-174201`; read: full; category: `architecture, consulting_engineering`
  - mandatory: company profile with minimum 5 yrs experience in feasibility studies/building assessment; CV + proof of qualification of at least one professional engineer / built-environment consultant / safety specialist / accessibility consultant; >=3 reference letters or contactable references; valid tax reference + PIN; certified valid B-BBEE cert or sworn affidavit signed by commissioner of oaths
- **t097 - SANParks GNP-033-26 - Groenkloof renovations** - public entity; closes 2026-11-20; `ocds-9t57fa-174416`; read: full; category: `building_maintenance_renovation, electrical_installation_reticulation`
  - CIDB registered (JV every member registered); CSD; COIDA letter of good standing in Building/Civil/Construction field from DoEL Compensation Fund or licensed mutual (FEM); SBD6.1 + B-BBEE (DTIC or SANAS) cert or affidavit (original/certified); trust/consortium/JV consolidated B-BBEE; functionality threshold
- **t098 - SANParks - borehole drilling** - public entity; closes 2026-10-29; `ocds-9t57fa-174134`; read: full; category: `boreholes_groundwater`
  - proof of authority (company resolution); tax clearance; SANAS B-BBEE cert or affidavit; CSD proof; mandatory documents list (cross-referenced); water analysis via SANAS-accredited lab (SANS 241); yield testing
- **t099 - SANRAL N.011-010-2027/1F (NRA 2026/0779) - flood mitigation consulting** - soe; closes 2026-11-19; `ocds-9t57fa-174470`; read: full; category: `consulting_engineering, stormwater_drainage, road_maintenance`
  - FULL SANRAL tender pack downloadable from eTenders (zip: Book 1, Books 2&3, appendices, Technical + Financial Submission .xlsm, Returnable Schedules.docx) - NO CAPTCHA; returnable forms in .docx: A2 authority (board resolution on letterhead; JV each member), A3 JV agreement (lead bidder majority share), A4 sworn declaration of debt outstanding to SANRAL (tenderer + directors), A5 DPIP/FPPO declaration (shareholder names, ID numbers, shareholding %, PIP links), A6 fronting practices, A7 CSD, A8 litigation history, A9 tax compliance, A10 deviations, A12 B-BBEE verification certificate (incl SBD 6.1), A14 permission for due diligence, A15 past SCM, A16 addenda, A17 certificate of insurance cover, A18 registered FINANCIAL SERVICE PROVIDER letter and bank details, A19 current commitments, A20 COID compliance, A21 financial submission declaration, A22 independent technology-based intellectual service provider, A23 single tender submission, B1.1/B1.2/B2.1/B2.2 key person records, B3 project structure, B4 quality systems certificate, B5 programme, B6 past performance, B7 targeted enterprise/subcontractor; Appendix D3 OHS audit questionnaire
- **t100 - SANSA - fuel tank inspection & cleaning** - public entity; closes 2026-10-20; `ocds-9t57fa-173421`; read: full; category: `cleaning_hygiene, mechanical_plant_equipment`
  - competent personnel; calibrated equipment; waste transfer notes/disposal certificates; workmanship warranty; tax reference number; SG proof attached; SBD forms; persal/state employment declaration
- **t101 - SA Post Office - fence & building repairs Hammersdale** - soe; closes 2026-10-23; `ocds-9t57fa-174024`; read: full; category: `fencing_gates, building_maintenance_renovation`
  - SBD4 with disclosure of ALL CSD-registered companies linked to directors (MAAA + status) - disqualification if not; list of DIRECTORS on company letterhead (first, middle, surname, GENDER, RACE) + ID copies + CIPC certificate; list of SHAREHOLDERS on letterhead (same fields) + ID copies + share certificates; certificate of acquaintance; consolidated B-BBEE for JV + proof of JV; B-BBEE valid at closing (expired not accepted)
- **t102 - SARS RFP14-2026 - armed escort of high-risk assets** - national; closes 2026-11-17; `ocds-9t57fa-174492`; read: full; category: `security_guarding`
  - SUPPLIER COST & RISK ASSESSMENT QUESTIONNAIRE: King governance (JSE only), top management average experience band, restrictions on company/directors/shareholders, contracts terminated early, legal disputes (nature, year, value, verdict), service excellence awards last 3 years, 5 key suppliers (country, % purchases), % business dependent on SARS; FINANCIAL: attach financial statements, going-concern basis, turnover split public vs private past 1/2/3 yrs, 5 key customers by % of debtors book, debtors age spread, 5 key products/services revenue %, creditors age spread, major debts/bonds/contingent liabilities; checklist: 3 most recent ANNUAL FINANCIAL STATEMENTS, SBD1/4/6.1, CSD, GCC; mandatory: PSIRA letter of good standing, COIDA letter of good standing, PRIVATE SECURITY SECTOR PROVIDENT FUND letter of good standing, firearms range approval (Firearms Control Act / SABS); functionality: control room & vehicle satellite tracking, armoured CIT + escort vehicle registration copies + photos (company name), list of registered firearms with licences (handguns, rifles), PSIRA numbers of officers
- **t103 - SASSA KZN - HPCSA health practitioners panel** - public entity; closes 2026-11-09; `ocds-9t57fa-174175`; read: ocr; category: `health_services`
  - tax compliant (TCS PIN letter / CSD MAAA); valid HPCSA registration proof + HPCSA LETTER OF GOOD STANDING; HPCSA number & practice number; valid WORK PERMIT for non-SA citizens; CSD report; proof not permanently employed by the state (letter on departmental letterhead); sworn affidavit never excluded/suspended from medical evaluations; certified ID of each director per CIPC / sole proprietor (<=6 months; copy of certified copy rejected); certified qualifications (<=6 months); SBD1/3.3/4/6.1; VAT vs non-VAT rate; 90/10
- **t104 - SA Tourism - global brand experiential** - public entity; closes 2026-11-09; `ocds-9t57fa-174489`; read: full; category: `events_management, advertising_marketing`
  - public liability insurance for activations; commercial transparency disclosure; admin & mandatory bid evaluation; 90/10 preference
- **t105 - SA Weather Service - digital marketing training** - public entity; closes 2026-10-23; `ocds-9t57fa-174404`; read: full; category: `training_skills_development`
  - subcontracting agreement proof; duly approved operational premises with infrastructure and relevant accreditation (due diligence site visit); reference/background checks on bidders & individuals; B-BBEE cert/affidavit; presentation for shortlisted; supplier performance management agreement
- **t106 - South Cape TVET - roof waterproofing (1SN)** - public entity; closes 2026-10-26; `ocds-9t57fa-173296`; read: full; category: `building_maintenance_renovation`
  - tax PIN certificate; latest municipal account or lease; CIPRO documents listing members with % (CC) or all share certificates (copy with original stamp) (company); SHAREHOLDING BREAKDOWN per race, gender & % (incl non-individual shareholders); declaration of interest; SANAS B-BBEE cert or affidavit; COIDA certificate with industry classification Building Construction (Class V); CIDB 1SN; 2 completion letters for similar work; same docs for all consortium members
- **t107 - SIU - diamond valuator expert** - national; closes 2026-10-23; `ocds-9t57fa-174494`; read: full; category: `property_valuation`
  - CSD; tax compliant (CSD overall status); CV of diamond valuator expert (10+ yrs, 4Cs, Precious Metals Act); >=3 client reference letters; qualifications/certifications in diamond valuation; valid Diamond DEALER'S LICENCE (s32 Diamonds Act); licence of authorised representative (s54); B-BBEE affidavit commissioned
- **t108 - Swellendam LM SMQ12 - grass cutting (advert)** - municipal; closes 2026-10-23; `ocds-9t57fa-174152`; read: advert; category: `gardening_landscaping`
  - Advert only on eTenders - see the advert-only list in section 1.3.
- **t109 - Swellendam LM SMT17 - Railton walkway (advert)** - municipal; closes 2026-10-30; `ocds-9t57fa-173312`; read: advert; category: `road_construction_upgrade`
  - Advert only on eTenders - see the advert-only list in section 1.3.
- **t110 - The Presidency - prestige groceries panel** - national; closes 2026-11-05; `ocds-9t57fa-174061`; read: full; category: `food_provisions`
  - original + 2 copies + electronic; SBD forms; cold-chain mandatory (lot); HACCP certification mandatory (lot); vehicle compliance & temperature logs; Presidency returnable project reference form (Annexure A) signed with contact person; key staff CV (corporate/hospitality); project completed min value R500k
- **t111 - SABS - strategic advisory, bankable business case** - public entity; closes 2026-10-22; `ocds-9t57fa-174519`; read: full; category: `feasibility_research_advisory`
  - CSD report; valid B-BBEE cert/affidavit; SBD6.1; mandatory: >=5 project reference letters (last 10 yrs) on company letterhead with prescribed content
- **t112 - TCTA - IT change management specialist** - soe; closes 2026-10-22; `ocds-9t57fa-174174`; read: full; category: `management_consulting, it_support_managed_services`
  - mandatory: pricing; recognised change-management certification of proposed specialist (Prosci, APMG Change Management Practitioner or equivalent); >=3 reference letters (Annexure A content); specialist degree (BSc CS etc); non-mandatory: SBD1/4/6.1, SANAS B-BBEE cert or EME/QSE affidavit complying with Annexure B minimum requirements, consolidated JV cert, CSD report
- **t113 - TNPA - Dom Pedro quay refurbishment** - soe; closes 2026-11-16; `ocds-9t57fa-174509`; read: full; category: `ports_marine_works`
  - environmental: EMP compiled by expert with CV, environmental officer CV (alternate if unavailable), organogram with names of contractor's staff & reporting lines, MSDS for substances; EA/permits; (13 docs, mostly scope/specs; returnables in TNPA CIDB format)
- **t114 - Transnet Engineering - approved supplier list** - soe; closes 2027-02-26; `ocds-9t57fa-174123`; read: full; category: `supplier_database_notices`
  - NDA; master terms; registration no; (8 docs incl locomotive annexures)
- **t115 - Transnet TCC/2026/07/0099 - biodiversity footprint** - soe; closes 2026-11-05; `ocds-9t57fa-173400`; read: full; category: `environmental_assessment`
  - SBD1; JV/consortium agreement with % split & responsibilities (or written intention letter); consolidated B-BBEE for JV; Employment Equity Act compliance (s53); SECURITY CLEARANCE to CONFIDENTIAL level for company, personnel, subcontractors (post-award); signature + COMPANY STAMP on every page; Transnet e-tender portal company profile registration; certificate of acquaintance & breach of law form; specific goals claim form; POPIA formal + operator contract; supplier integrity pact; NDA; master agreement; scoring annexures: company experience (F), key personnel (G), methodology (H), timelines (I)
- **t116 - Tygerberg Hospital TBH 304/2026 - frozen chicken** - provincial; closes 2026-11-06; `ocds-9t57fa-173315`; read: ocr; category: `food_provisions`
  - CSD registered at closing (CSD-held mandatory docs accepted by WC Health); WCBD4; VAT registration; B-BBEE cert/affidavit + 6.1; mandatory: valid HALAAL certificate in bidder's name (MJC/ICSA etc), certified Certificate of Acceptability for food premises (R638) issued by an Environmental Health Practitioner in bidder's name; samples; no subcontracting
- **t117 - Umzimvubu LM UMZ/2026-27/C&CS/03 - tree felling** - municipal; closes 2026-10-23; `ocds-9t57fa-173427`; read: full; category: `gardening_landscaping`
  - SARS confirmation with verification PIN; company registration/founding statement/CIPC document; ORIGINALLY CERTIFIED ID copies of managing directors/owners (certification within 30 days); MBD 1, 4, 6.1, 8, 9; billing clearance certificate or municipal account statement or affidavit or lease or residential confirmation + declaration that active directors don't owe municipal services >90 days; CSD confirmation; functionality: company experience 30, methodology 30, PUBLIC LIABILITY INSURANCE 40 points; SG: 50%+ youth 4, 50%+ female 4, 100% black 4, disability 4, Umzimvubu-based 4; no award to persons in service of the state
- **t118 - Water Research Commission - institutional assessment (RFI)** - public entity; closes 2026-10-30; `ocds-9t57fa-174496`; read: full; category: `management_consulting`
  - company profile; company registration documents; reference projects; (RFI - last three financial statements per annual report referenced for WRC itself)
- **t119 - DWS - 19mm stone aggregate Midmar** - national; closes 2026-11-03; `ocds-9t57fa-174293`; read: ocr; category: `building_materials_hardware`
  - compulsory site briefing; SBD1, 3.1, 4; SBD6.1; CSD registered & compliant; tax compliant (CSD/SARS); ACTIVELY REGISTERED with CIPC (verified via CSD/CIPC); certified B-BBEE certificate / sworn affidavit; Annexure 1 & 2 affidavits signed by a local commissioner of oaths (PPR 2022 specific goals); board resolution certified by chairman; JV: original or notarially certified JV document + per-member authorisation certificate; manufacturer/supplier confirmation letter if not manufacturer; samples
- **t120 - DWS - biomonitoring & water-quality monitoring** - national; closes 2026-10-29; `ocds-9t57fa-174327`; read: full; category: `laboratory_scientific, environmental_assessment`
  - mandatory: compulsory site briefing; SBD1, 3.1, 4; Pr.Sci.Nat (SACNASP) registered scientist; SASS5 accredited practitioner certificate; natural science degree/BTech NQF7; quality: company experience 40, key personnel 40, technical proposal 20; admin: SBD6.1, CSD; company board resolution certified by chairman; JV: original or notarially certified JV document + certificate per participant
- **t121 - WC Mobility MT04-2026 - GMT accounting services** - provincial; closes 2026-11-13; `ocds-9t57fa-173995`; read: full; category: `audit_accounting_finance`
  - WC returnables: WCBD1 bid form; Compulsory Enterprise Questionnaire; WCBD6.1(a); WCBD4; WCBD7.1; contract data by supplier; pricing; goods & services information; B-BBEE status level verification certificate; PRINTED CURRENT TCS RESULT SUMMARY page; company registration number; CSD / WCSEB (Western Cape Supplier Evidence Bank) registration number MAAA; initial every page
- **t122 - WC Transport & Public Works - mechanical ventilation (pointer only)** - provincial; closes 2026-11-17; `ocds-9t57fa-174440`; read: none; category: `hvac_refrigeration`
  - eTenders file is a 1-line pointer (docs via WC tender helpdesk e-mail) - NOT ACCESSED
