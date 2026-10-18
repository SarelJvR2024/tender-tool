# Tender Regulatory Compliance Review

2026-10-17. Sarel: *"Review all tender regulations to make sure we are compliant and that there is nothing we are missing in our app."*

**Scope.** This review covers the rules that govern South African public tenders: procurement law, preferential procurement, Treasury SCM instructions and forms, CIDB, B-BBEE, professional registration, and SANRAL's own framework. Personal-data law (POPIA) is covered by a separate audit and is not repeated here.

**Method.** Each rule was checked against a primary source wherever one could be reached: the Government Gazette, National Treasury's own downloads, the CIDB's gazetted standard, SANRAL's own policy and tender books, and court judgments as reported. Secondary sources (law firms, verification agencies, news) are named as such. The code was then read to see what the product actually does. Every citation is listed in §10.

**Not legal advice.** Items marked **Confirm with a professional** carry real financial exposure (lost preference points, disqualification, a false declaration). They should be confirmed with a procurement lawyer or a SANAS-accredited B-BBEE verification agency before the product, or Klipcorp, relies on them.

---

## 0. Summary

| # | Finding | Status |
|---|---|---|
| 1 | **The Public Procurement Act 28 of 2024 is dead.** It never commenced. On **17 September 2026** the Constitutional Court declared it unconstitutional and invalid in its entirety, because of inadequate public participation (*Premier of the Western Cape v Speaker of the National Assembly*, CCT 103/25 with CCT 144/25, [2026] ZACC 37). The declaration was **not suspended**. The draft General Public Procurement Regulations, 2026 now have no enabling Act. **The PPPFA + Preferential Procurement Regulations, 2022 remain the law**, and the product is built on the right framework. | No action. Watch for a new Bill (§1) |
| 2 | PPR 2022 (80/20 up to R50m, 90/10 above, price formula, buyer-defined specific goals, deadlock rule) is **correctly reflected** in `score_outlook.py` and `sanralScoring.ts` | Confirmed (§2) |
| 3 | **B-BBEE affidavit risk (highest financial exposure).** SANRAL's own Form A12 (R.396 Book 1 T-48) and SANRAL's board-approved Interim Preferential Procurement Policy both require a **SANAS verification certificate** under the **amended Construction Sector Code**. A12 accepts a sworn affidavit or CIPC certificate **only from an EME with annual revenue under R1.8 million**. The app told every company that a QSE sworn affidavit is "equivalent evidence". Klipcorp's own vault holds exactly that: a QSE sworn affidavit claiming Level 1. | **Wording fixed; rule flagged for Sarel and a B-BBEE verifier (§5)** |
| 4 | SBD forms. Treasury's current national set has a consolidated **SBD 4 "Bidder's Disclosure"**, which absorbed the old SBD 8 and SBD 9 content (PFMA SCM Instruction 03 of 2021/22), and **SBD 6.1 "in terms of PPR 2022"**. The product fills **the buyer's own edition** of each form and stores no Treasury template, so no stored form is outdated. One real wording error was found and fixed: the SBD 4 related-enterprise question. | **Fixed (§4)** |
| 5 | CIDB. The 2019 tender value limits are still current; the CIDB registration rules haven't changed. A **draft second edition of the Standard for Uniformity** was published for comment on 18 Sept 2026. The product only checks whether a company **has** a grading. It never compares the grade number, class, "or higher", PE or JV-combined grading against what the tender asks. | Flagged (§6) |
| 6 | SANRAL is a PFMA Schedule 3A public entity: PPPFA, PPR 2022 and Treasury SCM instructions apply, and **no exemption was found**. Its own policy adds a fixed B-BBEE-level specific-goals table, a certificate requirement, and **30% subcontracting to Targeted Enterprises** (by contract-value category), captured on Form B7. ~~The product never captures or fills Form B7.~~ **Closed 2026-10-18:** the company answers B7 per tender on the Workspace; the pack fills it, or says why not, and refuses when it applies unanswered (§8.4) | **Fixed (§8.4)** |

---

## 1. Public Procurement Act 28 of 2024: status

### 1.1 What happened (Observed, primary + reported)

- **23 July 2024: published as an Act.** It was approved by the President and published as an Act in the Government Gazette on 23 July 2024 (Treasury media statement, 13 Aug 2024).
- **Never commenced.** Treasury: *"the provisions of the Act are not in force yet. The President will bring the provisions of the Act into operation through a proclamation in the Gazette."* Commencement was to be phased under s69. Treasury added that *"the repeal of the PPPFA, and Chapter 4 of the Act ... and required regulations should take effect on the same date."* It also said *"The current procurement framework provided for under the PFMA, MFMA, the PPPFA and other applicable legislation, remain in place until the relevant provisions of the Public Procurement Act, 2024, and accompanying regulations take effect."* No proclamation was ever issued; gov.za lists commencement as "To be proclaimed".
- **16 April 2026: draft regulations published.** The draft General Public Procurement Regulations, 2026 (GG 54528) and the draft Public Procurement Tribunal Regulations, 2026 (GG 54527) were published. Comment closed on 15 July 2026, after a 30-day extension.
- **18-19 May 2026: hearing.** The Constitutional Court heard the challenges by the Western Cape Premier and the City of Cape Town (with Solidarity and amaBhungane).
- **17 September 2026: judgment.** The Court **unanimously declared the Act unconstitutional and invalid**, because Parliament failed to facilitate reasonable public participation. Chapter 4 (preferential procurement) had been substantially rewritten after the public comment stage, from an enabling framework into a prescriptive one with mandatory qualification criteria. The public had hours to assess the change. The declaration was **not suspended**, and the Court did not decide the other substantive challenges. GroundUp, IOL, The Citizen, Western Cape Government, Deneys, LnP and the Accountability Tracker all report the same outcome. Infrastructure News (7 Oct 2026): *"Public procurement reform returns to the starting blocks"*.
- **After the judgment.** The Finance Minister said government remains committed to reform and will engage Parliament's presiding officers. **No new Bill and no timetable** had been announced as at 17 Oct 2026.

### 1.2 What it means for the product

- **Nothing in the product is built against a superseded framework.** The law that applies is:
  - s217 of the Constitution;
  - the PPPFA (Act 5 of 2000) and the Preferential Procurement Regulations, 2022;
  - the PFMA + Treasury Regulations 16A + PFMA SCM Instructions (national and provincial departments, Schedule 2/3 entities, including SANRAL);
  - the MFMA + the Municipal SCM Regulations, 2005 + MFMA circulars (municipalities);
  - the CIDB Act and Regulations;
  - the B-BBEE Act and the Codes.
- **The SBD forms tied to the PPA never happened.** No new form suite was ever issued under it.
- **Risk now:** low for the next 12-24 months. A new Bill needs a fresh, full parliamentary process with real public participation. The court's reasoning targets *process*, and commentators note it does not strike down preferential procurement in substance. A re-introduced Bill may well return with a prescriptive Chapter 4 (mandatory qualification criteria, set-asides). That would change SBD 6.1-type scoring.
- **What to watch** (suggested: a quarterly check, not a build item): a new Public Procurement Bill in Parliament; any Treasury instruction replacing the PPR 2022 SBD 6.1; and the CIDB SFU second edition (§6.3), which is independent of the PPA and still live.
- **Confirm with a professional?** Not needed for the PPA itself: the invalidity is unanimous and reported consistently. The Deep-Dive spec's "Legal framework to recheck before launch" line is now answered.

---

## 2. PPPFA and the Preferential Procurement Regulations, 2022

### 2.1 The current regulations (Observed: GG 47452, Notice 2721 of 4 Nov 2022, in force 16 Jan 2023)

| Rule | Regulation | Text |
|---|---|---|
| Which system | reg 3(1) | The tender documents must state the preference point system, *"the specific goal ... for which a point may be awarded, and the number of points ... and proof of the claim for such goal"* |
| Unclear value | reg 3(2) | The tender must say either system may apply, and that *the lowest acceptable tender* (highest, for income-generating tenders) decides which |
| 80/20 | reg 4 | Rand value **≤ R50 million**, inclusive of all taxes: Ps = 80(1 − (Pt − Pmin)/Pmin); **max 20** for specific goals; total rounded to 2 decimals |
| 90/10 | reg 5 | **> R50 million**: Ps = 90(1 − (Pt − Pmin)/Pmin); **max 10** for specific goals |
| Income-generating | regs 6-7 | Same thresholds, scored on Pmax |
| Deadlock | reg 8 | Equal totals → the highest specific-goals score wins; then lots |
| False claims | reg 9 | 14 days to make representations, then disqualification or termination, plus damages |
| Transition | reg 10 | Tenders advertised before 16 Jan 2023 stay under the PPR 2017 |

Further facts from the gazette text:

- **No lower Rand bound.** The draft's R30 000 floor was dropped.
- **No pre-qualification regulation.** PPR 2017 reg 4 is gone.
- **No local content regulation.** PPR 2017 reg 8 is gone.
- **No B-BBEE points table.** The 2017 level table is gone; each organ of state chooses its own specific goals.

Treasury's current **SBD 6.1 "in terms of PPR 2022"** (downloaded from the OCPO page) also says: *"Failure on the part of a tenderer to submit proof or documentation required ... to claim points for specific goals ... will be interpreted to mean that preference points for specific goals are not claimed."*

**No amendment to the PPR 2022 since 2023 was found.** The searches and Treasury's legislation page show none. The PPR 2022 are the current version.

### 2.2 What the product does vs the regulations

| Product rule | Where | Matches? |
|---|---|---|
| Price points never estimated before closing (Ps against the lowest acceptable tender) | `score_outlook.py` docstring + summary, `sanralScoring.ts`, `compliance-report.tsx` | **Yes** (regs 4(1)/5(1)) |
| 80/20 vs 90/10 read from the tender's own words, never from the OCDS value. "Either ... or" or both systems listed → `ambiguous` | `score_outlook._preference_system()` | **Yes**: this is exactly reg 3(2)'s mechanism. Reporting it as ambiguous rather than guessing is correct, because the lowest acceptable tender decides |
| Specific goals are buyer-defined; only recognised rows are estimated; "check the tender's table for any other goal" | `score_outlook._specific_goals()` | **Yes** (reg 3(1)(b); Hardcoded-Assumptions Q8 already open for veterans, rural etc.) |
| B-BBEE level table parsed only when Level 1 = 10/20 | `_bbbee_points_by_level()` | **Yes for SANRAL's table.** A buyer whose B-BBEE table tops out below 10/20 (sharing points with other goals) is correctly *not* estimated |
| "No valid proof → 0 points, not disqualified" | `tenderCompliance.ts` B-BBEE row | **Yes**, per SBD 6.1 and R.396 Book 1 *"SANRAL will not disqualify the bidder"* |
| Deadlock rule | not modelled | Not needed (it is an evaluation step, not a bidder input) |
| SANRAL functionality threshold | `sanralScoring.ts` default `threshold = 70` | **Partly.** R.396 is 70, but Book 1 Annexure A: *"the threshold is either Category 1, 2 or 3, which equates to 70%, 80% or 85% respectively ... indicated in the tender document"*. The workspace always passes 70 (`compliance-data.ts`), so an 80- or 85-threshold tender is over-reported as "clears". **Gap G7** |

### 2.3 Buyers still issuing PPR 2017 wording (Observed)

- **The case.** SALB's live SBD 1 (`templates/general_samples/salb_15-10-2026/SBD1.pdf`, a 2026 tender) still says *"THIS BID IS SUBJECT TO ... THE PREFERENTIAL PROCUREMENT REGULATIONS, 2017"*.
- **Why it happens.** Treasury's own OCPO page still hosts the PPR 2017 SBD 6.1/MBD 6.1 and SBD/MBD 6.2 editions beside the PPR 2022 ones, without marking them superseded.
- **What it means.** This is a buyer-side defect. The PPR 2017 are repealed for any tender advertised after 16 Jan 2023 (reg 10), and the bidder can't fix it by editing the buyer's form ("not to be re-typed", SBD 1 §2.2).
- **What the product could do.** Spot the reference and suggest a clarification question to the buyer. **Gap G11** (low).

---

## 3. National Treasury SCM instructions and the SBD forms

### 3.1 Current forms (Observed: OCPO "Standard Bidding Forms" page, downloaded 2026-10-17)

| Form | Current Treasury edition | What the product does | Verdict |
|---|---|---|---|
| **SBD 1** Invitation to bid | "REVISED SBD1" (.docx): bidder block, TCS PIN **or** CSD MAAA, accredited-representative / foreign-supplier Part B + the 5-question foreign-supplier questionnaire, *"ALL BIDS MUST BE SUBMITTED ON THE OFFICIAL FORMS PROVIDED (NOT TO BE RE-TYPED)"*, *"each party [to a JV] must submit a separate TCS certificate / PIN / CSD number"* | Fills the buyer's own .docx edition by label, or types onto the buyer's flat PDF (`fill_flat_pdf.py`), never re-typing the form. B-BBEE tick boxes are optional, because the revised edition has none | **Matches.** The never-re-type rule is exactly why the product fills the buyer's copy. JV: see G9 |
| **SBD 2** Tax clearance | Not on Treasury's current page (replaced by the SARS TCS PIN + CSD) | `requirements.py FORMS["2"]` = "attach" the TCS PIN | Correct |
| **SBD 3.1/3.2/3.3** Pricing | Current | Never filled, by design | Correct |
| **SBD 4** | **"Bidder's Disclosure"**, introduced with **PFMA SCM Instruction 03 of 2021/22** ("Preventing and combating abuse in the SCM system"; R.396's A11 cites paragraph 6 of it). It has 3 YES/NO declarations: employed by an organ of state (+ table: full name, ID number, organ of state); relationship with an employee of the procuring institution; **interest in any other related enterprise "whether or not they are bidding for this contract"** (+ table of every CSD-registered company linked to the directors, MAAA + status, *"Failure to disclose ... will lead to disqualification"*). It **also carries the old SBD 9 independent-bid-determination certification and the old SBD 8 restricted-supplier/tender-defaulter consequence** | Fills the 3 declarations from the person's own answers (general flow) or as logged `assumed_default` No (SANRAL A11). The directors' tables are not filled | Form matched. **Wording bug fixed (§4)**. Tables: **Gap G4** |
| **SBD 5** NIPP | Still listed (PDF) | by hand | Fine |
| **SBD 6.1** | **"SBD 6.1 in terms of PPR 2022"** (+ MBD 6.1 PPR 2022). Treasury still also lists the PPR 2017 editions | Fills name/company type/signatory; points table by hand (each buyer's goals differ) | Matches. The company-type tick was fixed upstream today (`7ae7fb3`) |
| **SBD 6.2** Local content | Only "in terms of PPR 2017" editions exist. The PPR 2022 have no local-content regulation; designations by the dtic are still applied by some buyers through Treasury instruction notes (SANRAL policy §6.6: *"as a condition of award and not an eligibility criterion"*) | by hand | Fine. The legal footing of designations after the PPR 2022 is unclear (§9, Q-R6) |
| **SBD 7.1/7.2/7.3** Contract forms | Revised editions listed | by hand (signed after award) | Fine |
| **SBD 8 / SBD 9** | **Not on Treasury's current national SBD list**; their content is inside the revised SBD 4 | Filled when a tender's **own** documents include them (many still do: Mthashana SBD 8/9, SALB SBD 9; SANRAL keeps a separate A15 "past SCM practices") | Correct: the product only asks what the tender's own forms ask. It never adds SBD 8/9 on its own |
| **MBD suite** | Treasury's municipal zip still ships MBD 1, 2, 3.x, 4 (2013 "Declaration of interest"), 5, 6.1 (2017), 6.2 (2015), 7.x, **8, 9** (2011), plus "REVISED MBD 1/7.x" and MBD 6.1 PPR 2022 separately | Same label-matched / overlay filling | Matches what municipalities actually issue (General-Tender-Preparation Finding 1) |

**Verdict on form versions.**

- **No stored template is outdated, because the product stores none.** It always completes the buyer's own published edition (`fill_sbd_docx.py`, `fill_flat_pdf.py`) and matches fields by label, never by position. That design is the right answer to Treasury's "official forms, not re-typed" rule. It also absorbs edition drift (old vs new SBD 4, PPR 2017 vs 2022 SBD 6.1) without code changes.
- **The remaining version risk is wording in the product's own questions.** One error was found and fixed (§4).

### 3.2 Other Treasury rules that touch the product

- **CSD registration** is a precondition for award (eligibility: R.396 Book 1 *"Only tenderers who are registered on the ... Central Supplier Database at the tender closing date, are eligible"*). Handled: the A7 row and the general returnables.
- **Register for Tender Defaulters / List of Restricted Suppliers** means automatic disqualification (SBD 4 §1.2). The product asks (SBD 8 questions) or logs `assumed_default` No with "not checked against the live register today". It never checks the live registers. **Gap G10** (low; a manual check is normal practice).
- **PFMA SCM Instruction 02 of 2021/22** (thresholds for quotations vs competitive bids, in effect since 1 Aug 2021 per its amendment). The product doesn't use thresholds. Not relevant to bidder compliance.
- **Persons in the service of the state** may not be awarded tenders (SBD 1 closing line; MFMA SCM Reg 44 for municipalities). That is the SBD 4 / MBD 4 declaration. The product asks it per company.

---

## 4. Fixed: the SBD 4 "related enterprise" question

**What was wrong.** The general workspace asked:

> *"Does the bidder or any director have an interest in another related enterprise **bidding for this contract**?"*

Every edition of the form asks something broader:

- Treasury's current SBD 4: *"... have any interest in any other related enterprise, **whether or not they are bidding** for this contract?"*
- R.396 A11 2.3: the same words.

A company whose director holds another, non-bidding company would truthfully answer "No" to the app's question, and that answer would then be written onto the form as a false declaration. Under the current SBD 4 that is *"disqualification"*, and *"restricted ... for a period not exceeding 10 years"* under PRECCA (SBD 4 §3 general declaration; PPR 2022 reg 9).

**Fixed:**

- `engine/general/requirements.py`: the question label and help now carry the form's real wording. The help explains that, if Yes, Treasury's current edition requires the table of every CSD-registered company linked to the directors (completed by hand).
- `engine/general/fill_sbd_docx.py`: the round-1 CLI `fill_sbd4()` reason text says the same.
- `app/lib/pastSubmissionReuse.ts`: the reuse label and the "why not copied" reason now give the real reason. The rule is unchanged (still re-asked per tender, the safe choice).

**Not changed, on purpose:** the completion-guide row label in `build_general_pack.py` (*"Interest in a related enterprise bidding?"*). That label is also the provenance key the general harness pins (`build_general_pack.py` line ~408), so renaming it would change every baseline. **Gap G4b**: rename it together with a baseline reset.

**Verified:** `py_compile`; `test_general_bridge.py` ALL PASSED; `tsc --noEmit` and `eslint` clean on the touched files.

---

## 5. B-BBEE: certificates, affidavits and the Construction Sector Code (highest exposure)

### 5.1 The rules

- **Generic Codes** (B-BBEE Commission): EME ≤ R10m turnover, QSE R10-50m. An EME uses a sworn affidavit, and *QSEs at least 51% black owned "are only required to present sworn affidavits"*, which *"must be accepted"* (B-BBEE Commission via Bizcommunity / RSM). An affidavit is valid 12 months from the date sworn.
- **Sector codes replace the Generic Codes for entities in their sector.** Consulting engineers are Built Environment Professionals (BEPs) under the **Amended Construction Sector Code** (Notice 931 of 2017, GG 41287, 1 Dec 2017). Its thresholds and affidavit rules (1st Verification Networx summary for Master Builders; Econoservices; CSC affidavit template):

  | Item | Built environment professionals (BEPs) | Contractors |
  |---|---|---|
  | EME | ≤ R6m | ≤ R10m |
  | QSE | R6-25m | R10-50m |
  | Generic | > R25m | > R50m |
  | Affidavit or CIPC certificate allowed | **only EMEs under R1.8m** | **only EMEs under R3m** |
  | Above that | a SANAS verification certificate | a SANAS verification certificate |

  A **QSE** BEP must be rated on its scorecard. A 100% black-owned QSE gets automatic Level 1 **only if** it meets 40% of the Skills Development element (9.6 of 24 points); otherwise it drops to Level 2. An affidavit can't show that. (Sources disagree here: AQRate's 2025 notice says a black-owned EME/QSE "should provide a sworn affidavit" for ownership. That is why this is marked *Confirm with a professional*.)
- **SANRAL applies the Construction Sector Code explicitly.**
  - R.396 Book 1, Form A12 (T-48): *"A valid B-BBEE verification certificate must be submitted ... issued in accordance with the amended Construction Sector Codes ... issued by a verification agency accredited by SANAS; or be in the form of a sworn affidavit or a certificate issued by CIPC in the case of an Exempted Micro Enterprise (EME) with a total annual revenue of less than R1,8 million ... have a date of issue less than 12 months prior to the original advertised tender closing date"*.
  - For a JV: *"a project-specific consolidated ... certificate in the name of the JV, issued by a [SANAS] verification agency"*.
  - SANRAL's **Interim Preferential Procurement Policy** (Board, effective 28 Nov 2023) §6.4.1 says the same after its specific-goals table: *"A valid B-BBEE verification certificate must be submitted."*

### 5.2 What the product did

- **`app/lib/tenderCompliance.ts`, SANRAL A12 row.** It told every company: *"The sworn affidavit is the standard accepted template - equivalent evidence to a verification certificate"*, and *"either is accepted"*. This was based on Sarel's answer 9 (2026-10-16).
- **`compliance-report.tsx`.** It said *"certificate or sworn affidavit both count"*.
- **Klipcorp's own vault** (`config/klipcorp_profile.json`): `bee_proof_type: qse_affidavit`, Level 1, `status: QSE`. The 2026-09-09 affidavit is in the completed tender sample as "BEE Avadavit.pdf".

**If SANRAL's evaluators apply A12 as written, a QSE affidavit scores 0 of 20 preference points** (an 80/20 tender: 20% of the total score). The text also raises a PPR 2022 reg 9 / B-BBEE Act question if the claimed level can't be substantiated on the sector code's own scorecard.

### 5.3 What was changed (wording only; status logic untouched)

- The A12 row's detail for a QSE affidavit now says: *"Check before relying on it: R.396's Form A12 asks for a SANAS-accredited verification certificate under the amended Construction Sector Code, and accepts a sworn affidavit only from an EME with annual revenue under R1.8 million - a QSE affidavit is not listed. Confirm this tender's A12 accepts it, or the 10/20 specific-goal points may score 0."*
- An EME affidavit gets the R1.8m note.
- The "not which proof" branch and the compliance-report sentence no longer say "either is accepted" or "both count".
- The `beeProofValidAtClosing()` docstring records this as OPEN.

**Not changed:** the row's status ("have" while unexpired). Overriding Sarel's recorded answer is his decision, and SANRAL may in practice have accepted Klipcorp's affidavit before.

### 5.4 For Sarel (Q-R1, Confirm with a professional: highest priority)

1. **Has SANRAL actually scored Klipcorp's QSE affidavit at Level 1 on an awarded or evaluated tender?** The SANRAL opening registers and award pages that `award_outcomes.py` reads carry points. If SANRAL scored it, that is evidence of practice. If not, Klipcorp may be losing up to 20 points per SANRAL tender.
2. **Ask a SANAS-accredited verification agency** whether Klipcorp, as a consulting-engineering BEP QSE, can lawfully use a sworn affidavit under the amended Construction Sector Code, and whether its Level 1 holds after the Skills Development sub-minimum.
3. **Then decide the product rule**:
   - (a) keep "affidavit accepted" for everyone (today);
   - (b) make proof type + sector + turnover part of the check (needs new fields: sector code applied, annual revenue band, and a `cipc_certificate` proof type; Master-Data C1/C7 already list these as gaps);
   - (c) read each tender's own A12 / proof clause (like the evidence rules).

---

## 6. CIDB Act, Regulations and the Standard for Uniformity

### 6.1 Grading limits (Observed: CIDB memo 16 Aug 2019, GG 42561 of 5 July 2019, in effect 7 Oct 2019; repeated in a CIDB presentation at the Dept of Employment & Labour OHS conference, Oct 2024)

| Grade | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| Upper tender value (incl. VAT) | R0.5m | R1m | R3m | R6m | R10m | R20m | R60m | R200m | no limit |

**No later adjustment was found.** Several 2026 blogs still print the pre-2019 figures (R200k / R650k / R2m ...); those are wrong. The Deep-Dive spec's "2019 limits" line is still correct.

### 6.2 Eligibility rules that matter to a bidder (Observed: draft SFU 2nd ed. §5.8, which restates the existing CIDB Regulations wording)

- **Grade and class.** A grading is written as grade number + class, e.g. `6CE`.
- **Sum tendered, not estimated value.** Eligibility is a grade *"equal to or higher than a contractor grading designation determined in accordance with the **sum tendered**"* in the stated class (or classes, "6CE **or** 6GB").
- **Potentially emerging (PE).** Regulation 25(1B)/(7A) and the PE provisions (reg 25(8)) let an employer accept one grade lower for potentially emerging contractors in a targeted development programme.
- **JVs.** Every member must be CIDB-registered, the lead partner must hold a grading in the class, and the **combined** grading must be high enough. SANRAL's policy adds that the lead partner may be *"not lower than one level below"*.
- **Registered in time.** The firm must be registered, or capable of being registered, before evaluation (works) or within 21 working days (expressions of interest).
- **Consultants are not on the Register of Contractors.** A BEP/PSP tender's CIDB text is the CIDB **Standard Conditions of Tender** (SANS 10845-3) and the **PSP Performance Report** (Annex 1), not a grading requirement. R.396 has no grading requirement.

### 6.3 Standard for Uniformity: draft second edition (Observed: Board Notice 986 of 2026, GG 55409, 18 Sept 2026)

- **What it is.** The CIDB published a *draft* second edition of the Standard for Uniformity in Construction Procurement. It replaces the 2004 first edition (last amended by BN 136 of 2015) and the Standard for Uniformity in Engineering and Construction Works Contracts (Notice 423 of 2019).
- **The comment date is wrong in the notice.** It says comments by 31 Aug 2026, before its own publication date, so the deadline is evidently a defect in the notice.
- **It stays on SANS/ISO 10845.** It still prescribes the SANS ISO 10845-2 Form of Offer and Acceptance, the 10845-3 Standard Conditions of Tender, T2 returnable documents, and the §5.8 CIDB wording.
- **Effect.** It is not in force. If finalised, the product's Form of Offer / Compulsory Enterprise Questionnaire overlay (label-anchored) should survive, but the **CEQ and returnable-schedule layouts may change**. Watch item, no build.

### 6.4 What the product does vs the rules

| Rule | Product | Gap |
|---|---|---|
| Grade ≥ required, in the right class, by sum tendered | `assess_tender.py` / `score_outlook.py` only test `has_cidb_grading` (any value on file). `CIDB_RE` captures the **first** grading only (`([0-9]+\s*[A-Z]{1,3})`), so it drops "or 6GB", "PE" and "or higher" | **G5**: no grade/class comparison; a 4CE company is told "has a grading on file" for a 7CE tender |
| Multiple classes per company | `companies.cidb_grading` is one text value | **G5** (also Master-Data E1) |
| CRS number | no column | Already open (General-Tender gap 11; Master-Data E1) |
| PE / JV combined grading | not modelled | **G5** |
| Consultant tenders citing the CIDB boilerplate | `requirements.py` `cidb` returnable fires on the Standard Conditions boilerplate (Master-Data §2.3); `assess_tender` downgrades to `not_a_fit` when a CIDB *grading* string is found and none is on file | Low for consultants (the grading regex needs "CIDB ... grading"), but **G5** should treat "PSP / no grading required" explicitly |
| Tender value limits | not encoded anywhere | Fine. Encoding them is only needed for G5's "by sum tendered", which the bidder knows only at pricing |

---

## 7. Professional registration

### 7.1 What the law requires (Observed)

- **ECSA, Engineering Profession Act 46 of 2000.**
  - s18: only registered persons may use the professional titles.
  - s26: ECSA must identify engineering work. The **Identification of Engineering Work (IDoEW)** was gazetted on 26 March 2021 (Board Notice 21 of 2021, GG 44333). It demarcates which activities each category (Pr Eng, Pr Tech Eng, Pr Techni, Pr Cert Eng) may perform.
  - ECSA required the profession to submit compliance plans so that engineering work is *"ascribed to registered persons"*; enforcement is being phased in.
  - In practice, design and sign-off of engineering work must be done by, or under the control of, an appropriately registered person. Tenders enforce it through key-person minimums (R.396 C3.1.11: Pr Eng for PL/DS).
- **SACPCMP, Project and Construction Management Professions Act 48 of 2000.**
  - Construction Regulations 2014 (OHS Act): the client's **Construction Health and Safety Agent** and the contractor's **Construction Health and Safety Officer/Manager** must be SACPCMP-registered.
  - Pr CPM / Pr CM appear as key-person requirements (Master-Data t-sample: "Contracts Manager PrCPM/PrCM").
  - SACPCMP's **revised Rules for Registration** take effect 1 Aug 2025 (BN 835 of 2025, GG 53455, 1 Oct 2025, on qualification/competency exemptions).
  - **Draft Construction Regulations** (published for comment 12 March 2025) would repeal the 2014 Regulations; no final gazette was found. Watch item.
- **SACNASP / SAGC / SACAP / SACQSP / SACPLAN / SACPVP**: each statute reserves its own titles and work. They appear in tenders as key-person or firm conditions (Master-Data E4).

### 7.2 What the product tracks vs the requirements

| Requirement | Product | Verdict |
|---|---|---|
| ECSA category, number, renewal | `people.ecsa_*` (+ expiry since `0035`); C3.1.11 cross-check; role tags | Matches what tenders test |
| SACPCMP (CHSA/CHSO, PrCPM/PrCM) | `people.sacpcmp_*` + role catalog (`tender_roles` SACPCMP safety officer) | Matches |
| SACNASP / SAGC | `0040`, conditional | Matches (Q5) |
| SACAP / SACQSP / SACPLAN / SACPVP / PSIRA | role catalog only, **no person fields** | Already open (Discipline-Taxonomy O4; CV-Extraction gap) |
| Candidate ≠ professional | role-fit compares ECSA level | Fine |
| **Firm-level registration through a named director** (SAGC land surveyor, SACPVP valuer, IIA for audit firms) | not modelled | Already open (Master-Data E4) |
| **Only a registered person may sign certain documents** | No tender document the product fills requires a registered person's signature. The bid itself is signed by an *authorised* signatory (SBD 1 *"Proof of authority must be submitted e.g. company resolution"*), not a registered one. Registered-person signatures arise **after** award (design certificates, OHS appointments under Construction Regs 5/8), outside the product | **No gap** in the tender pack. Note for later phases: a generated CV or "declaration of key person" must never imply a registration the person doesn't hold; the product reads registrations from records, never generates them |
| Registration valid **at closing** | `validityAtClosing()` for person expiries (`0035`), geologist/surveyor checks | Matches |

---

## 8. SANRAL as an entity

### 8.1 Legal position (Observed)

- **What SANRAL is.** The South African National Roads Agency SOC Ltd, established under the SANRAL Act 7 of 1998.
- **PFMA status.** It is a PFMA **Schedule 3A** national public entity. The **Board is the accounting authority**, and there is no accounting officer (CEO's PFMA statement). Treasury Regulation 16A and PFMA SCM Instructions apply to Schedule 3A entities (the Treasury instructions are addressed to "Accounting Authorities of Schedule 3A and 3C Public Entities").
- **PPPFA status.** The PPPFA and PPR 2022 apply. Schedule 2/3 entities were recognised as organs of state by GN R.501 of 8 June 2011, footnoted in PPR 2022 reg 2.
- **No exemption found.** No PPPFA s3 exemption and no special procurement framework exempting SANRAL from the standard rules was found. SANRAL's own documents say it procures *"in terms of"* the PPPFA, B-BBEE Act, CIDB Act, PFMA and Treasury instructions (Interim PP Policy §5.1).
- **FIDPM.** SANRAL uses the **Framework for Infrastructure Delivery and Procurement Management (FIDPM)** (Policy §4.2) for engineering, construction and related services. The FIDPM is a Treasury framework, not an exemption, and is one reason SANRAL's documents follow the CIDB/SANS 10845 format.

### 8.2 SANRAL's own rules on top of the national framework (Observed: Interim Preferential Procurement Policy, Board-approved, effective 28 Nov 2023; R.396 Book 1)

| Rule | Source | Product |
|---|---|---|
| 80/20 for R2 000 up to R50m; 90/10 above | Policy §6.4 | Matches |
| Specific goals = fixed **B-BBEE level table** (L1 10/20, L2 9/18, L3 6/14, L4 5/12, L5 4/8, L6 3/6, L7 2/4, L8 1/2, non-compliant 0) | Policy §6.4.1 Table 1 = R.396 Book 1 | `score_outlook._bbbee_points_by_level()` parses it from the tender. `compliance-report.tsx` says "Specific goals at SANRAL follow the B-BBEE level table" (true under this policy; it is labelled *interim*, so read each tender) |
| **A valid B-BBEE verification certificate must be submitted** | Policy §6.4.1; A12 | See §5 |
| **30% subcontracting to Targeted Enterprises** (EME or QSE > 51% black owned, Level 1 or 2) as a **contractual obligation**. Consultants (Annexure 3): < R6m → none for EMEs, 30% for QSE/Generic; R6-25m → none for EME/QSE, 30% for Generic; > R25m → 30% for all. RRM consulting and ad-hoc consulting are exempt | Policy §7.1, Annexure 3 | Captured on **Form B7** (*"Targeted Enterprise/Sub-contractor details and declaration"*). `fill_conventional.py`/`fill_tender.py` write B7 **only if** `td["targeted_enterprise"]` exists, and **nothing produces it** (no column, no UI, no pack input). R.396 itself waives B7 (*"No sub-contracting requirement ... submission of form B7 is not required"*), so the 6 samples never exercised it. **Gap G3 - closed 2026-10-18 (§8.4)** |
| JV allowed only if one partner is a Targeted Enterprise (R.396); JV needs a consolidated SANAS certificate; ownership mismatches reported "for possible fronting" | Book 1 p.T-74; Policy Annex 3(b) | JV is a per-tender yes/no only. **G9** |
| Functionality threshold 70 / 80 / 85 by category, stated per tender | Book 1 Annexure A | **G7** (always 70) |
| Main contractor/consultant may not hold equity in its Targeted Enterprise | Policy §4.6.24 | Not modelled (a declaration; part of G3) |

### 8.3 Current SANRAL context (reported, for awareness)

- **28 July 2026.** After the High Court (Pretoria) set aside the R9.5bn RRM contractor panel, and a Category 2 engineering-consultant panel was declared unlawful, SANRAL said it **is scrapping panels and reverting to open tenders for RRM and engineering consultancy services**, issued in batches (SAnews, IOL, Engineering News).
- **Incumbents** stay to 30 November 2026.
- **For the product:** more SANRAL consultant tenders in the RRM family soon. The RRM template family is the less-exercised one (`admin_harness` covers Conventional; RRM scoring is a range).
- **N.011-010-2027/1F** (Master-Data §7.1) shows a **different A-form set**: A4 debt to SANRAL, A5 DPIP/FPPO, A18 FSP/bank letter. The SANRAL A-form filler is label-matched but has only been checked against R.396's edition. **Gap G8** (re-run fingerprint + filler against it).

### 8.4 Closed: Form B7 answered by the company (2026-10-18, migration `0056`)

Sarel: *"B7 must be answered by the company."*

- **Contract value is not needed and not captured.** SANRAL writes the category into every Technical workbook (`SETUP!L1`, 1 < R6m / 2 R6-25m / 3 > R25m) together with the Annexure 3 matrix (`SETUP!J27:L35`). `engine/sanral_b7.py` reads both from the tender's own template and applies them to the company's size. Samples: R.334 category 2; R.343, R.352-020, R.352-030, R.394, R.396 category 3; live N.011-010-2027/1F category 3 (Book 1: *"Minimum sub-contracting requirement for all Entities is 30%"*); Klipcorp's real RRM bid category 1, QSE, B7 completed.
- **The buyer's own waiver wins, but is recorded, not assumed.** R.396's workbook says category 3 / compulsory YES, its Book 1 says B7 is not required. The company records the waiver with the quoted Book 1 text; it is printed as the "not included" reason.
- **Unknown = ask.** Category not read, or company size not EME/QSE/Generic, means B7 is treated as required until answered.
- **Capture:** Tender Workspace "Form B7" card. 1-4 Targeted Enterprises with every field the form asks (name or "to be identified after award", EME/QSE, % of contract, % excl. provisional sums, % black ownership, B-BBEE level, offices, in-province, consulting firm, tax number), plus comments, or the waiver.
- **Gate:** pack request and bridge both refuse when B7 applies and is unanswered or invalid. Warnings (< 30%, a TE not meeting Clause 1 (>= 51% black, L1/L2), unnamed TE, local share < 1/3) need the "draft anyway" tick.
- **Not checked (needs the TE's own records):** the 6-concurrent-projects limit, no shared equity (Policy §4.6.24), the TE's B-BBEE proof and proof of address, the duplicate B7 signed by both parties (listed as a pack warning).

Verification: System-Status.md, pass entry of 2026-10-18.

---

## 9. Prioritised gap list

### Fixed in this pass

| # | What | Files |
|---|---|---|
| F1 | SBD 4 "interest in any other related enterprise" question asked only about enterprises *bidding for this contract*; the form asks "whether or not they are bidding". A truthful answer to the app's question could be a false declaration on the form | `engine/general/requirements.py`, `engine/general/fill_sbd_docx.py`, `app/lib/pastSubmissionReuse.ts` |
| F2 | The SANRAL B-BBEE row told every company a QSE/EME affidavit is "equivalent evidence"/"either is accepted"; SANRAL's own A12 and policy say otherwise. The text now states A12's actual condition. **Status logic unchanged** | `app/lib/tenderCompliance.ts`, `app/app/tenders/[id]/compliance-report.tsx` |

No migration was added.

### Flagged for Sarel: decisions or professional confirmation

| Priority | # | Gap | Why it matters | Suggested next step |
|---|---|---|---|---|
| **P0** | **Q-R1 / G1** | **Klipcorp's QSE sworn affidavit vs SANRAL A12 and the Construction Sector Code** (§5) | Up to 20 of 100 points on every SANRAL 80/20 tender; possible reg 9 exposure if the Level 1 claim can't be substantiated | **Confirm with a SANAS verification agency** (sector code, level after the Skills sub-minimum) and check SANRAL's published points for Klipcorp's past bids. Then choose product rule (a)/(b)/(c) in §5.4 |
| **P1** | G2 | Default "No" answers on declarations: SANRAL A11 employed-by-state and A15 4.1-4.4 are written as `assumed_default` No; the SBD 4 directors' tables (state employees with ID numbers; every CSD-registered company linked to the directors, MAAA + status) are never captured | A false or incomplete SBD 4 means disqualification and up to 10 years' restriction (SBD 4 general declaration; PRECCA). These are listed on `ACTIONS_TO_SIGN.md`, but nothing captures the tables | Build with the directors/shareholders register (Master-Data A5/A7/A11, already the top-ranked gap): one register feeds SBD 4 tables, SANRAL A5 DPIP, MBD 4 3.9-3.14 |
| ~~P1~~ **Closed 2026-10-18** | G3 | SANRAL Form B7 Targeted Enterprise / 30% subcontracting never captured or filled - **now answered by the company and filled (§8.4)** | A SANRAL consultant tender over R6m (QSE/Generic) or R25m (all) makes it a contractual obligation, and B7 is a returnable. The spec's own "targeted-enterprise block blank in seven tenders" incident | Read the tender's B7 note at intake (R.396: "not required"); if required, capture the subcontractor (name, B-BBEE level, black ownership, % of contract) per tender and fill the existing B7 cells; warn when missing |
| **P1** | G5 | CIDB: only "has a grading" is checked; no grade/class/"or higher"/PE/JV/sum-tendered comparison; one grading per company | A company is told it qualifies for a tender its grade doesn't allow (non-responsive), or the reverse | Store gradings as (grade, class) rows + CRS number; parse every grading in the tender text (incl. "or", "PE"); compare grade ≥ required in class; say "by sum tendered - check at pricing" |
| **P1** | G7 | SANRAL functionality threshold hardcoded to 70; Book 1 says 70/80/85 per tender **(fixed 2026-10-18, `Form-Field-Audit.md` §8: read from the tender at intake, else labelled assumed)** | "Clears the threshold" can be wrong on 80/85 tenders | Pass the tender's own threshold (already read by `score_outlook` `THRESHOLD_RE` at Discovery / intake) into `estimateSanralConventional` |
| P2 | G4b | Completion-guide label "Interest in a related enterprise bidding?" in `build_general_pack.py` **(fixed 2026-10-18, `Form-Field-Audit.md` §5.4)** | Same misleading wording on the printed guide | Rename together with a general-harness baseline reset (it is the provenance key) |
| P2 | G8 | SANRAL A-form set differs between tenders (N.011: A4/A5 DPIP/A18) | The A-form filler is only verified against R.396 | Fingerprint and run the filler on N.011's Returnable Schedules (Master-Data §7.1 follow-up) |
| P2 | G9 | JV: SBD 1 needs a separate TCS/CSD per JV party; SANRAL needs a consolidated JV SANAS certificate, a Targeted-Enterprise partner and a CIDB combined grading | JV bids fail on these | Only when a JV feature is built; today JV is a yes/no |
| P2 | Q-R2 | Construction Sector Code applicability per company: the product has no "which B-BBEE code / turnover band" fields | Needed for rule (b) in §5.4 for every BEP/contractor tenant | Decide with Q-R1 |
| P3 | G10 | Restricted-supplier / tender-defaulter registers never checked live | Automatic disqualification if listed | Keep as a manual checklist item; consider a link to Treasury's lists in `ACTIONS_TO_SIGN.md` |
| P3 | G11 | Buyer forms still citing PPR 2017 (e.g. SALB SBD 1) | The bidder may want to raise a clarification | A manifest gap line when a form cites "Regulations, 2017" in a tender advertised after 16 Jan 2023 |
| P3 | Q-R6 | Local content (SBD 6.2) designations after the PPR 2022 dropped reg 8: legal footing unclear, but buyers (incl. SANRAL policy §6.6) still apply them | Product leaves SBD 6.2 by hand, which is safe | **Confirm with a professional** only if a tenant bids on designated-sector goods |
| Watch | W1 | A new Public Procurement Bill after the ConCourt judgment | Would replace the PPPFA/PPR 2022 and likely SBD 6.1 | Quarterly check of Treasury + Parliament |
| Watch | W2 | CIDB SFU second edition (draft, GG 55409, 18 Sept 2026) | May change CIDB returnable layouts (CEQ, Form of Offer) the overlay targets | Re-run `fill_flat_pdf.py` samples when the final edition and new CIDB templates appear |
| Watch | W3 | Draft Construction Regulations (2025) replacing the 2014 set | May rename or change the SACPCMP H&S appointments tenders ask for | Update the role catalog when gazetted |

---

## 10. Sources

Primary (read from the document itself):

- National Treasury, *Commencement of Public Procurement Act, 2024* (media statement, 13 Aug 2024): https://www.treasury.gov.za/comm_media/press/2024/2024081301%20Media%20Statement%20-%20Commencement%20of%20Public%20Procurement%20Act.pdf
- Public Procurement Act 28 of 2024, gov.za listing ("Commencement: To be proclaimed"): https://www.gov.za/documents/acts/public-procurement-act-28-2024-english-setswana-23-jul-2024 ; text: https://lawlibrary.org.za/akn/za/act/2024/28/eng@2024-07-23
- Draft General Public Procurement Regulations, 2026 (GG 54528): https://www.treasury.gov.za/public%20comments/ProcReg/GG%20No%2054528%20Notice%20Draft%20General%20Public%20Procurement%20Regulations,%202026.pdf
- Preferential Procurement Regulations, 2022 (GG 47452, Notice 2721, 4 Nov 2022): https://www.treasury.gov.za/legislation/regulations/PREFERENTIAL%20PROCUREMENT%20REGULATIONS,%202022.pdf
- National Treasury OCPO, Standard Bidding Forms (REVISED SBD1, REVISED SBD 4 - Annexure A, SBD 6.1 in terms of PPR 2022, MBD 6.1 in terms of PPR 2022, Municipal Bidding Documents.zip): https://ocpo.treasury.gov.za/Buyers_Area/Standard-Bidding-Forms/
- Amendment to PFMA SCM Instruction No. 02 of 2021/22: https://ocpo.treasury.gov.za/Legislation/Instruction%20Notes/Amendment%20to%20PFMA%20SCM%20Instruction%20No.%2002%20of%202021-2022%20-%20Procurement%20Thresholds%20and%20processes.pdf
- CIDB memo, *Adjustments to tender value ranges* (16 Aug 2019, GG 42561): https://safcec.org.za/wp-content/uploads/2023/01/cidbregamendmenttendervaluer.pdf
- CIDB Board Notice 986 of 2026, draft second edition of the Standard for Uniformity in Construction Procurement (GG 55409, 18 Sept 2026): https://www.gov.za/sites/default/files/gcis_document/202609/55409bn986.pdf
- SANRAL Interim Preferential Procurement Policy (effective 28 Nov 2023): https://www.nra.co.za/uploads/8/SANRAL%20INTERIM%20PREFERENTIAL%20PROCUREMENT%20POLICY.pdf
- SANRAL R.396-010-2025/1F Book 1 (Tender Data C.3.11; Annexure A; Forms A11, A12, B7), in `templates/incoming/R.396-010-2025.1F/`
- ECSA, Identification of Engineering Work: https://www.ecsa.co.za/enforcement-and-conduct/identification-of-engineering-work/

Reported or secondary (named as such in the text):

- Constitutional Court judgment, 17 Sept 2026: GroundUp https://groundup.org.za/article/new-procurement-act-unconstitutional-court-rules/ ; Accountability Tracker https://accountability-tracker.org/anti-corruption-policy-monitor/public-procurement-act/ ; Infrastructure News https://infrastructurenews.co.za/2026/10/07/public-procurement-reform-returns-to-the-starting-blocks/ ; IOL https://iol.co.za/capeargus/news/2026-09-18-concourt-strikes-down-public-procurement-act-after-flawed-public-participation/ ; Western Cape Government https://www.westerncape.gov.za/treasury/article/western-cape-government-welcomes-constitutional-court-ruling-declaring-public-procurement ; Deneys https://www.deneys.co.za/thinking/news/public-procurement-act-2024-invalid-says-constitutional-court-what-it-means-south ; CivicLedger status note https://www.civicledger.co.za/news/public-procurement-act-28-2024-commencement-status/
- Draft regulations comment extension: SAnews https://www.sanews.gov.za/south-africa/public-comment-period-draft-public-procurement-regulations-extended ; CDH https://www.cliffedekkerhofmeyr.com/en/news/publications/2026/South-Africa/Dispute-Resolution/dispute-resolution-alert-26-may-key-issues-covered-in-the-draft-general-public-procurement-regulations-2026
- Amended Construction Sector Code thresholds and affidavits: 1st Verification Networx for Master Builders https://cdn.ymaws.com/masterbuilders.site-ym.com/resource/resmgr/docs/2019/amended_construction_sector_.pdf ; Econoservices https://econoservices.co.za/amended-construction-sector-codes-affidavits-explained/ ; AQRate (conflicting) https://www.aqrate.co.za/2025/03/05/notice-to-amended-construction-sector-codes-gazette-41287-eme-black-owned-qse-clients/
- Generic Codes affidavits (B-BBEE Commission, reported): https://www.bizcommunity.com/Article/196/820/179185.html ; https://www.rsm.global/southafrica/insights/legal-insights/determining-validity-sworn-affidavit-b-bbee-compliance
- CIDB limits, 2024 presentation: https://www.labour.gov.za/DocumentCenter/Publications/Occupational%20Health%20and%20Safety/OHS%20Construction%20Conference%202024%20-%20Presentations/Compliance%20with%20cidb%20precripts.pdf
- SBD 4 consolidation (secondary; confirmed by Treasury's current SBD 4 text): https://www.sourcefin.co.za/sbd-forms-government-tenders-south-africa/
- Draft Construction Regulations (2025) and SACPCMP rules: https://www.labour.gov.za/DocumentCenter/Regulations%20and%20Notices/Regulations/Occupational%20Health%20and%20Safety/Construction%20Regulations,%202024%20Invitation%20of%20Public%20Comments%20on%20the%20Draft%20Construction%20Regulations.pdf ; https://cdn.ymaws.com/www.masterbuilders.co.za/resource/resmgr/docs/2025/SACPCMP-Rules-for-Registrati.pdf
- SANRAL panels to open tenders (28 July 2026): https://sanews.gov.za/south-africa/sanral-scrap-contractor-panels-and-revert-open-tenders

**Not reached:** the B-BBEE Commission's Practice Guide 01 of 2022 (server 503) and the Construction Sector Charter Council's own affidavit notice. Both would settle Q-R1's legal half, and are worth asking the verification agency for.
