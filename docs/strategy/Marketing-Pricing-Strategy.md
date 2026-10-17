# Tender Tool: Marketing, Pricing and Go-to-Market Strategy

Oct 17, 2026 · prepared for @Sarel · research and strategy only, no code changes

## Summary

**The market finding:** South Africa already has about ten tender tools, and the cheap end is crowded (VUZA is free; AITenders charges R199 a month; BidsStack R300; TenderProSA R299). Every one I could check sells discovery, alerts, a compliance-document vault, or AI-written proposal text. **None that I found fills a SANRAL consultant workbook, builds the two-envelope SANRAL submission, or matches staff CVs and company experience evidence to a specific tender's scoring rules.** That narrower gap is where Tender Tool is genuinely alone, and it is also the part that is built and verified today.

**The recommendation in one line:** don't sell a "tender management platform" at R299 to R899 against ten others. Sell a **SANRAL consultant-tender submission engine** to small and medium consulting engineering firms, at **R3,950 a month (excl. VAT)**. Price it against the engineer-hours and score points it saves, not against the discovery tools. Open with a free "Tender Watch" tier as the lead magnet and a founding-member offer for the first 10 firms.

**The honest constraint:** none of this can be sold yet as a live product. No live Supabase project exists (System-Status Gap #9), the bridge worker isn't deployed, and no time saving has been measured on a real tender. Section 7 lists what has to be true before the first rand is charged.

Contents:

1. Competitive landscape (South Africa-specific)
2. The value: what Tender Tool is actually worth to a firm
3. Hormozi's frameworks, applied honestly
4. Pricing recommendations
5. Go-to-market
6. Positioning and messaging
7. Pre-launch checklist, risks and open questions
8. Sources

---

## 1. Competitive landscape (South Africa-specific)

The Deep-Dive's competitor table (`docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md`, "Competitor landscape") already covers TenderProSA, BidsStack, Tender Aid, TenderFlow, AITenders, Flowcase, GovDash, Loopio, AutoRFP.ai and mytender.io. This section re-checks the South African prices (17 Oct 2026), adds the tools that research turned up, and answers the question asked: is there a South African competitor for *what Tender Tool actually does*?

### 1.1 Finding: there are SA tender tools, but no SA SANRAL/consultant-submission tool

Searches run: "South Africa tender management software", "CIDB contractor tender bid software", "SANRAL tender submission software / bid management engineering consultants", "B-BBEE compliance software SaaS", "AI tender response platform South Africa 2026".

- **Searches for SANRAL-specific bid software found nothing.** The results were SANRAL's own notices and tender aggregators that list SANRAL tenders (TenderFlow, VUZA). No product claims to fill SANRAL's Technical/Financial Submission `.xlsm` workbooks, print Forms B1 to B7, or build the envelope packs.
- **CIDB-specific software doesn't exist as a category.** CIDB appears only as free calculators (TenderFlow) or a grade check (TenderProSA).
- **B-BBEE software is a different market.** BEE123 (Sage) is scorecard and verification software for large organisations, with no published price. InGroup lists "from R899" with affidavit generation. Neither touches tender packs.
- **The local tools all cluster in the same four things:** discovery, alerts, a document vault with expiry, and AI-drafted proposal text.

So the market finding is not "no competitors". The landscape splits into two parts:

| Segment | Who | Is Tender Tool competing here? |
| --- | --- | --- |
| Discovery and alerts | VUZA (free), AITenders, BidsStack, L2B, TenderFlow Starter, Tenders SA, TenderFinder, TendX | **Yes, and losing on price is guaranteed** (VUZA is free with no account). Treat discovery as the lead magnet, not the product. |
| Bid management, vault and AI drafting | TenderFlow, TenderProSA, Tender Aid, AITenders Licence | **Partly.** Tender Tool has the vault, expiry tracking and a compliance report. It deliberately does *not* have AI drafting (section 6.3). |
| Buyer-specific submission assembly (SANRAL consultant workbooks, Forms B1-B7, two envelopes, CV-to-position, B6 evidence) | **Nobody found** | **This is the category of one.** It is also the most-built, most-verified part of the product. |

Absence is not proof. Small tender consultancies may do SANRAL packs by hand as a service, and I found no published fees for them. That human service is the real alternative to Tender Tool, more than any software (section 2.4).

### 1.2 Price anchors, re-checked 17 Oct 2026

South African tender tools (prices as shown on the vendor's page):

| Tool | Plans and prices | What you get | Source |
| --- | --- | --- | --- |
| VUZA | **Free, no account** | Discovery across eTenders and about 90 other sources, plain-language summaries | [getvuza.com](https://getvuza.com/) |
| AITenders | Starter R199/mo (R1,990/yr); Pro R899/mo (R8,990/yr), up to 5 users; Licence: custom | Matching, digests, award intelligence; AI drafting only on Licence. Starter and Pro include VAT | [aitenders.co.za/pricing](https://aitenders.co.za/pricing) |
| BidsStack | Starter R300/mo; NotifyPlus R100/mo per province, R500/mo national | Alerts, documents, awarded data back to 2018; 30-day money-back guarantee | [bidsstack pricing](https://app.bidsstack.com/pricing) |
| L2B (Leads 2 Business) | Daily Tenders SA about R1,426/mo excl. VAT (sources conflict) | Tender leads service | [L2B pricing comparison](https://www.l2b.co.za/Tenders/Tender-Pricing) |
| Tender Aid | from R699/yr | Vault, expiry alerts, pre-submission audit; 0 reviews on Capterra | [Capterra](https://www.capterra.com/p/10045780/Tender-Aid/) |
| TenderProSA | R299 / R799 / R1,999 / R4,999 / R7,999 per month, credit-limited (a full analysis is about 50 credits) | Construction BoQ pricing, method statements, PDF bid-pack export | [tenderprosa.co.za/pricing](https://tenderprosa.co.za/pricing) |
| TenderFlow | Free; Professional R1,900/mo or R12,000/yr (2 users, +R200/user); Enterprise R3,500/mo or R25,000/yr (5 users, +R300/user) | Management, CV repository on paid plans, AI proposals, 14-day trial; Tender Academy R4,995 once-off | [tenderflow.co.za/pricing](https://www.tenderflow.co.za/pricing/) |

General SME software that a small engineering firm already pays for (willingness-to-pay context):

| Tool | Price | Source |
| --- | --- | --- |
| Xero (SA) | R450 / R795 / R1,095 per month incl. VAT (80% off for 3 months as a promo) | [xero.com/za](https://www.xero.com/za/pricing-plans/) |
| SimplePay payroll | per active employee per month; third-party listings say R60 to R89.50 starting (unconfirmed) | [Capterra ZA](https://www.capterra.co.za/software/202444/simplepay) |
| InGroup (B-BBEE suite) | from R899 | search result, Capterra listing |
| Flowcase / CV Partner (international CV tool) | quote only; Capterra shows "from US$119" with no period stated | [Capterra](https://www.capterra.co.uk/software/208998/cv-partner) |

**What the anchors say:**

1. **R200 to R900 a month buys discovery.** If Tender Tool is perceived as a discovery tool, it is worth R0 to R899 and nobody will pay more.
2. **R1,900 to R3,500 a month is the ceiling SA firms already pay for "bid management"** (TenderFlow). That's the bracket a buyer will compare against, so the SANRAL tier has to land there or clearly justify going above it.
3. **The annual discounts are very deep.** TenderFlow's annual price is 47% below its monthly price; AITenders gives "2 months free". SA buyers expect a big annual discount. Use it to get cash up front (section 4).

### 1.3 Market-timing fact that matters (verified)

BusinessTech reported on 29 July 2026 that the Pretoria High Court annulled SANRAL's R9.5 billion routine-road-maintenance panel tender (20 firms chosen from 401 bidders, replacing about 251 contractors), and that a Category 2 engineering-consultant panel was also ruled unlawful. SANRAL says it will go back to **individual open tenders for routine maintenance and engineering consultancy, released in batches**. Existing maintenance contractors stay until 30 November 2026, and there are **no extensions for consultants because none are currently in place** ([BusinessTech](https://businesstech.co.za/news/?p=867852)).

This matches what the repo already shows: six SANRAL consultant tenders (R.334-030 to R.396-010, all 2025/1F) close on 22 October 2026 (Deep-Dive, "Discovery: what SANRAL's website offers"). For the next 6 to 12 months, SA consulting engineering firms face an unusually high volume of near-identical SANRAL consultant submissions. That volume is the strongest honest source of urgency this product has (section 3.5).

### 1.4 How dense is the competition for each SANRAL tender? (an example)

SANRAL publishes tender opening results. For contract R.040-060-2020/1RF, the opening register lists **19 consulting firms**. Ten amounts were tendered, between R33.8m and R36.1m. The tender was awarded to Linked Consulting Engineers for **R33,949,796.30 over 18 months** ([nra.co.za](https://www.nra.co.za/awarded-tenders/contract-sanral-r-040-060-2020-1rf)). The bidders range from Zutari and SMEC to small CCs.

Two consequences:

- **Each SANRAL consultant tender is worth tens of millions in fees**, and 10 to 20 firms compete for it. A firm's base win rate is roughly 1 in 10 to 1 in 20 (my estimate from this one register, not a measured rate).
- **SANRAL's own pages are a public, named list of exactly the target customers** (section 5.3).

---

## 2. The value: what Tender Tool is actually worth to a firm

Hormozi's pricing rests on pricing against value delivered. This section estimates that value. Every number is labelled as **Observed** (from the repo or a source), **Calculated** (arithmetic on observed numbers) or **Estimate** (my assumption, to replace with a measured baseline).

### 2.1 What is built and verified today (the only things value is claimed for)

From `docs/specs/System-Status.md`, "Built and verified":

| Capability | Proof in the repo |
| --- | --- |
| SANRAL Conventional (9 sheets, 867 dropdowns) and RRM (15 sheets, 873 dropdowns) workbook fill, with a template fingerprint check before filling | `admin_harness.py` regression on 3 test companies; real tender runs |
| Full SANRAL submission pack: technical envelope plus a separate Envelope 2 financial PDF, with covers, contents page with page ranges, "Page X of N", bookmarks, and a "Not included" table with reasons | Real Klipcorp data on R.396-010-2025/1F: **74-page technical pack plus 29-page Envelope 2**; every contents entry checked against its real start page; stamps and bookmarks read back |
| Tender-customised CVs in SANRAL key-person and World Bank formats, plus "use as-is" | Generated documents read back; specialism warning fires correctly |
| General (non-SANRAL) packs: SBD/MBD 1, 4, 6.1 `.docx` fill; flat-PDF overlay for MBD/SBD 1, 4, 9, the CIDB CEQ and the Form of Offer | 25 real tenders read; overlay verified on 15 flat PDFs from 14 buyers |
| Compliance report: required documents vs vault on the closing date; key-person minimums; company experience vs **this tender's own** evidence rule; SANRAL functionality score estimate with ranges | Real vault values; 12 differently worded real evidence rules extracted |
| Experience Library (reference letters, completion certificates, CIDB PSP reports), tagged to the tender scoring vocabulary | Tenant-isolation SQL tests |
| Document vault with expiry for six tracked documents; reminders that escalate on lapse and flag documents that lapse before a pursued tender's closing date | `test_watch_deadlines_urgency.py` in CI |
| National discovery from the eTenders OCDS API, with a fit verdict and score outlook | Live OCDS runs |
| Pipeline board, tender task timeline, role-based daily digest | Schema replay and local-mode runs |

**Not claimable yet:**

- AI CV extraction accuracy: never run against the real API.
- Any live multi-tenant operation (Gap #9).
- Automatic fulfilment: the worker isn't deployed.
- A measured time saving.
- Narrative or methodology writing: deliberately out of scope.
- Reminder emails actually being *sent*: `watch_deadlines.py` is report-only, and the digest's `--mode live` is unverified.

### 2.2 Value lever 1: engineer and admin hours per submission

**Observed:**

- A SANRAL Conventional workbook has 867 form-control dropdowns. Done by hand, each is a click-and-select, and dates are three dropdowns each.
- The real SASSA two-envelope submission ran to about 358 technical pages plus 8 pricing pages.
- The generated R.396 pack is 74 + 29 pages from roughly 20 separate source documents.
- CVs have to be reformatted per position for every tender.

**Observed, ECSA's own rate formula:** the 2025 ECSA Guideline Scope of Services and Professional Fees (Board Notice 783 of 2025, Gazette 52691) sets time-based rates per R100 of a person's total annual cost of employment:

- Categories A and B (principals and directors): **22.00 cents per hour**
- Category C (registered professionals): **17.5 cents per hour**
- Category D (other technical staff): **16.5 cents per hour**

Source: [ECSA gazette](https://www.ecsa.co.za/download/472/gazettes/1008779/guideline-scope-of-services-and-professional-fees_scope-of-services-and-tariff-of-fees-for-persons-registered-in-terms-of-the-engineering-profession-act), clause 4.4.3.

**Calculated, using those rates.** The salary figures are my **estimates**:

| Who does the tender admin | Cost of employment (estimate) | ECSA hourly rate (calculated) |
| --- | --- | --- |
| Director / principal (Cat B) | R1,200,000 | R1,200,000 / 100 × R0.22 = **R2,640/h** |
| Registered engineer (Cat C) | R800,000 | 8,000 × R0.175 = **R1,400/h** |
| Technician (Cat D) | R450,000 | 4,500 × R0.165 = **R743/h** |
| Admin / bid coordinator (not an ECSA category) | R300,000 | about R150/h at cost (salary / 2,000 h) |

These are what the firm would bill for that hour. In a small firm, tender admin time is billable time lost, so the billing rate is the right opportunity cost for engineers. The admin rate is cost only.

**Estimate, to be replaced by Sarel's baseline:** compiling one SANRAL consultant submission by hand takes about 24 to 40 hours. That covers forms, the workbook, B1-B2 CVs per position, gathering the vault documents, ordering, page-numbering, the envelope covers and the final check. It excludes pricing and the B4/B5 narratives, which stay human anyway. Assume about half the hours are an engineer's and half a coordinator's, and that the tool removes about 60% of them. The pricing hours, the narratives, signatures and the human review all remain.

| | Low | High |
| --- | --- | --- |
| Hours per submission (estimate) | 24 | 40 |
| Blended rate: half Cat C at R1,400, half admin at R150 (calculated) | R775/h | R775/h |
| Manual cost per submission (calculated) | R18,600 | R31,000 |
| Hours removed at 60% (estimate) | 14.4 | 24 |
| **Value saved per SANRAL submission (calculated from the estimates)** | **about R11,000** | **about R18,600** |
| Value saved per month at 2 submissions | R22,000 | R37,000 |
| Value saved per month at 4 submissions (the batch-release months) | R44,000 | R74,000 |

The Deep-Dive's own rule still applies: **don't publish a time-saved figure until it is measured.** Use this table internally to set the price. Externally, quote the measured Klipcorp case study once it exists.

### 2.3 Value lever 2: score points and disqualification risk

This lever is larger than lever 1, but less certain.

**Form B6 past performance: up to 15 of 100 functionality points (Observed).**

- SANRAL requires 70 of 100 functionality points to stay in the tender (Experience-Library-Findings).
- Klipcorp's own completed NRA submission scored B6 on a sworn affidavit declaring **0 projects**, because no reference letters were to hand.
- The engine's own reading (`app/lib/sanralScoring.ts`) is that the affidavit floors at **6 of 15**, three "Adequate" slots at 2 to 3 each. Three "Excellent" rated letters score **15**, and omitting B6 entirely scores **0**.
- So poor record-keeping costs **6 to 9 points**, and a missing form costs all 15.

That swing alone can move a firm from just above to just below the 70-point threshold, and below the threshold means eliminated before price is opened. Tender Tool's Experience Library plus the compliance report's "past-performance evidence: N of 3" line exists to stop that.

**Silent wrong data (Observed, from the SANRAL specification).** A first delivery left the B-BBEE level at SANRAL's default of 9 (non-compliant) and the targeted-enterprise block blank **in seven tenders** before anyone caught it. The product's field-level provenance (confirmed / computed / assumed / missing) and read-back exist precisely for this.

**Expired documents.** If a COID letter, tax PIN or B-BBEE affidavit lapses before the closing date, the bid can be non-responsive. The compliance report checks validity *on the closing date*, not today, and the reminder logic flags a document that lapses before a pursued tender closes.

**Expected value at stake per bid (Calculated from Observed values plus Estimates):**

- Observed: a typical SANRAL consultant contract is about R34m in fees over 18 months (section 1.4).
- Estimate: a 15% net margin gives about R5.1m profit if won.
- Estimate: a base win probability of about 1 in 15 gives **about R340,000 expected profit per serious bid**.
- A disqualification for a missing document or a sub-70 functionality score sets that to **zero**.
- **Even a 1-percentage-point improvement in win probability on one bid is worth about R51,000** (0.01 × R5.1m).

This is not a claim to put in marketing ("we raise your win rate"): it's unprovable. It is the reason the price can sit well above the discovery tools without being expensive.

### 2.4 The real alternative the buyer compares against

For a 5 to 30 person consulting firm, the alternatives are:

1. A director doing it at night. That costs about R2,640/h in forgone billing, plus errors when tired.
2. A bid coordinator salary, about R25,000/month at cost (estimate). A small firm often can't justify one.
3. An outside tender consultant. Fees aren't published; ask 2 or 3 for a quote as a pricing anchor during the interviews (section 5.2).
4. A generic tool (TenderFlow at R1,900 to R3,500) that still leaves the SANRAL workbook, CVs and envelopes to be done by hand.

**Positioning against alternative 2 is the strongest frame:** *"a bid coordinator for SANRAL submissions, for less than a fifth of one."*

---

## 3. Hormozi's frameworks, applied honestly

The sources are secondary summaries of *$100M Offers*, *$100M Leads* and *$100M Money Models* (listed in section 8). The book text was not read, so the frameworks are used as thinking tools, not quoted doctrine. Where a Hormozi tactic would mislead a B2B engineering buyer, this section says so and adapts it.

### 3.1 The market first: is this a "starving crowd"?

Hormozi's test: customers with an existing pressing need, who can afford the product, in a growing market. Then commit to one market and understand it deeply ([Shortform summary](https://www.shortform.com/blog/starving-crowd/)).

| Test | SA consulting engineers bidding SANRAL work | Verdict |
| --- | --- | --- |
| Pressing need | Batch re-tendering after the court ruling; one wrong field can mean disqualification; tenders close within weeks of release | Strong |
| Can afford it | Contracts are worth about R34m in fees; the firms already pay R450 to R1,095/mo for accounting and their professional fees are gazetted | Strong |
| Easy to reach | SANRAL publishes the bidder names on every tender; CESA has almost 600 member firms ([Engineering News via CESA, 2022](https://newsletter.en.creamermedia.com/article/cesa-celebrates-70-years-aims-to-foster-local-capacity-to-overcome-infrastructure-backlog-2022-06-21)), two-thirds with 20 or fewer staff | Strong |
| Growing | Depends on SANRAL's capital programme; tender volume is temporarily high | Medium; stay honest about it |

"Commit to one market" maps exactly onto the Deep-Dive's scope discipline: "a specific process, not a general platform." **The beachhead is SANRAL consultant tenders (professional service providers), not contractors.** SANRAL's *contractor* (construction) tenders use different documents, which this engine doesn't fill. So CIDB contractor directories are **not** the first channel, even though they're the obvious list.

### 3.2 The Value Equation, scored for Tender Tool

> Value = (Dream outcome × Perceived likelihood of achievement) / (Time delay × Effort and sacrifice)

| Lever | What it means here (be specific) | What Tender Tool does today | How to strengthen it honestly |
| --- | --- | --- | --- |
| **Dream outcome** (status in a valued peer group) | Not "save time." For a small firm's director it is: *"We submit SANRAL packs as clean and complete as Zutari's or SMEC's, and we're never the firm eliminated on a technicality."* | A complete, numbered, bookmarked two-envelope pack with a contents page and a "Not included, and why" table | Show a real generated pack (anonymised) as the demo. The artefact *is* the dream outcome. |
| **Perceived likelihood** | "Will this really produce a pack SANRAL accepts, for *my* firm?" | Read-back verification (every contents entry checked against its real page); template fingerprint check that **refuses** to fill a changed template; provenance labels; the admin harness | Proof stack: (1) Klipcorp's own submitted tenders built with it; (2) the verification report shown to the buyer; (3) the founding-member guarantee (3.4). Don't use invented testimonials. |
| **Time delay** (until the first result) | Time from signup to the first useful output | Discovery and score outlook can be instant. A first pack needs the vault, people and CVs entered first. | Done-with-you onboarding: Sarel loads the firm's vault, CVs and experience in one session. The first win is the **compliance report on a live SANRAL tender in the first 48 hours** ("here is what's missing, and your estimated B6 score"), before any pack. |
| **Effort and sacrifice** | Re-entering company data, retyping CVs, learning a tool | Capture once, reuse; "use CV as-is"; one-field onboarding; no tutorial | Onboarding is the effort killer, so Sarel does it. Keep the "no AI blabber" stance: the firm doesn't have to proofread generated prose because there isn't any. |

Hormozi's point that the bottom two levers are often the cheapest to pull fits here exactly. The engine already delivers the outcome; what blocks a buyer is the setup effort and the wait. **The onboarding service is the product's biggest perceived-value lever, and it costs Sarel only hours.**

### 3.3 The Grand Slam Offer, built from the customer's problem list

Hormozi's method: list every problem the customer has around the outcome, give each one a solution, bundle them, and add bonuses, a guarantee, honest scarcity and urgency, and a name.

| The customer's problem (in their words) | Solution in the offer | Already built? |
| --- | --- | --- |
| "We don't even know which SANRAL tenders are out. The open list misses some." | Tender Watch: discovery plus fit verdict | Yes (eTenders OCDS); SANRAL's own site has a download-form question (see the risks in section 7) |
| "Will we even pass functionality?" | Score outlook plus SANRAL functionality estimate with ranges | Yes |
| "Our COID lapsed the week of closing last time." | Vault, expiry checked against the closing date, escalating reminders | Logic yes; email sending needs deployment |
| "We scored the B6 affidavit because the letters were in someone's inbox." | Experience Library plus a "past-performance evidence: N of 3" check | Yes |
| "Retyping the CVs into B1/B2 every time" | CV library, tender-specific CV generation, use as-is | Yes |
| "867 dropdowns" | Workbook fill, fingerprint check first | Yes |
| "Gluing 20 PDFs together at midnight, page numbers wrong" | One ordered pack per envelope, contents page, bookmarks, read-back | Yes |
| "Did we put pricing in the technical envelope by mistake?" | Envelope 1 is price-free by construction | Partly (no automated scan, Gap #12) |
| "Setting all this up will take weeks." | Done-with-you onboarding | Service, not code |

**Bonuses** (cheap for Sarel to give, valuable to the buyer, each solving a secondary problem):

1. **Reference-letter request pack.** A ready letter, in SANRAL's own reference-letter fields (value, completion date, rating, contact), that the firm sends its past clients. It attacks the B6 gap at its source. Cheap to make: a Word template.
2. **"B6 health check" on onboarding.** Sarel reviews their experience evidence against the 3-in-10-years rule and tells them which letters to chase.
3. **Pre-closing review call** on their first live SANRAL pack: 30 minutes, screen-share, before they submit.

Each bonus is a real service with real limits. **No invented "value R9,999" price tags on bonuses.** That Hormozi-style stacking reads as a sales gimmick to engineers. State what each bonus is and leave it there.

**Name.** Use the outcome-plus-container idea, in plain words: **"SANRAL Submission Engine: Founding Firms Programme"**.

### 3.4 Guarantees, chosen for a B2B engineering buyer

Hormozi lists unconditional, conditional and performance-type guarantees. The summaries disagree on how bold to be ([SuperSummary](https://www.supersummary.com/100m-offers/summary/); [Learner's Week](https://thelearnersweek.substack.com/p/book-club-100m-offers)).

Rules that keep it honest here:

- **Never guarantee a win, a score or a time saving.** Tender outcomes depend on price, competitors and SANRAL's evaluation. A score guarantee would also be unenforceable.
- **Guarantee what the engine controls: the deliverable.**

**Recommended guarantee: a conditional "first pack" guarantee.**

> "If Tender Tool doesn't produce your complete SANRAL technical and financial envelope packs for a live tender within your first 30 days (every included document in order, contents page matching the pages, and everything we couldn't include listed with the reason), we refund your first payment in full. The condition: you give us your company documents and key-person CVs in the onboarding session."

Why this works:

- It's the exact thing `verify_pack()` already checks.
- The condition (the customer supplies their data) is reasonable.
- It reverses the risk the buyer actually fears: paying for something that doesn't work on SANRAL's real templates.
- BidsStack already offers a 30-day money-back guarantee, so a guarantee is market-normal in SA, not exotic.

**Template-change promise (an operational guarantee).** "If SANRAL changes its template, the tool stops and tells you, and it never silently fills a changed form. We update the engine before your next pack." That is exactly what the fingerprint check does. Turn a technical safeguard into a stated promise.

### 3.5 Scarcity and urgency: only the true kinds

| Type | Honest version | What not to do |
| --- | --- | --- |
| Scarcity | **"10 founding firms this quarter."** Real: Sarel is part-time, and done-with-you onboarding takes about 3 to 4 hours per firm. 10 firms is roughly the most he can onboard well in a quarter around Klipcorp. | Fake countdowns; "only 2 spots left" when untrue |
| Urgency | **SANRAL's batch re-tendering** after the July 2026 ruling (verified, section 1.3). Each batch closes weeks after release, and the founding price is fixed for 24 months only for firms that join before the founding round closes. | Invented deadlines; pressure tactics on a 20-person firm's director |

Engineers detect manipulation fast, and the SA consulting community is small: 19 firms on one register (section 1.4) all know each other. **Reputation is the scarce asset, so every urgency claim must be checkable.**

### 3.6 Value-based vs cost-based pricing

- **Cost-based would be absurd here.** Running cost per tenant is a few hundred rand a month at most: Railway Hobby about $5/mo for the worker (Automated-Fulfillment-Deployment.md), a shared Supabase or Vercel plan, and about $0.05 to $0.15 per AI-extracted CV (CV-Extraction-Findings). Cost-plus would land at R300 to R500, inside the discovery-tool band, and signal "just another tender app."
- **Value-based:** the per-submission value is about R11k to R19k in hours (2.2) plus the disqualification and score risk (2.3). A common SaaS rule of thumb is to capture roughly 10% to 20% of measurable value. That's my framing, not a Hormozi number. **At 2 to 4 submissions a month, 10% of R22k to R74k is R2,200 to R7,400 a month.** R3,950 sits low in that range, deliberately, because nothing is measured yet.
- **Hormozi's "virtuous cycle of price"** ([Young and Profiting interview](https://youngandprofiting.com/alex-hormozi-the-value-equation-how-to-make-offers-so-good-people-feel-stupid-saying-no-e199/)): a higher price funds better service, attracts committed customers who actually use the product, and signals seriousness. For a solo part-time founder this matters a lot: **10 customers at R3,950 (about R39,500/mo) is a viable side business; 50 customers at R799 is a support burden Sarel can't carry.**

### 3.7 Money model: attraction, core, downsell, continuity

Adapted from *$100M Money Models* summaries ([JXNL report](https://jxnl.co/writing/2025/08/20/the-100m-money-models-the-complete-report); [SuperSummary](https://www.supersummary.com/100m-money-models/summary/)):

| Stage | Tender Tool offer |
| --- | --- |
| Attraction (free, solves a narrow problem and reveals the next one) | **Tender Watch, free:** SANRAL and eTenders discovery, fit verdict, score outlook, and the vault with expiry for one user. It reveals the next problem: "you have 3 matching SANRAL tenders and your B6 evidence covers 1 of 3." |
| Core | **SANRAL Pro subscription** (section 4) |
| Downsell (for firms that bid irregularly) | **Per-pack price** (section 4, model B) |
| Upsell / continuity | Extra users; the general-tender tier for firms that also bid municipal or provincial work; later, award and market-price intelligence (item 28, once data exists) |

---

## 4. Pricing recommendations

All prices are **excl. VAT**. Note that AITenders' Starter and Pro prices *include* VAT, so state VAT treatment clearly on the page to avoid an unfair comparison.

### Model A (recommended): three tiers, SANRAL-led

| | **Tender Watch** | **Tender Pro** (general tenders) | **SANRAL Pro** |
| --- | --- | --- | --- |
| Price, monthly | **Free** | **R1,490 / month** | **R3,950 / month** |
| Price, annual (paid up front) | Free | **R14,900 / year** (2 months free) | **R39,500 / year** (2 months free) |
| Users | 1 | 3 (+R250 per extra user per month) | 5 (+R300 per extra user per month) |
| Discovery, fit verdict, score outlook | ✓ | ✓ | ✓ |
| Vault with expiry, checked against closing dates | ✓ (view only, no reminders) | ✓ plus reminders | ✓ plus reminders |
| Compliance report per tender | 1 tender per month | ✓ | ✓ |
| Experience Library, CV library, tender CVs | – | ✓ | ✓ |
| General pack (SBD/MBD fill, flat-PDF overlay, merged pack) | – | ✓ (fair-use cap: 6 packs per month) | ✓ |
| SANRAL workbook fill plus two-envelope submission pack | – | – | ✓ (no limit) |
| Pipeline, tasks, role-based digest | – | ✓ | ✓ |
| Onboarding | Self-serve | Self-serve plus a 1-hour call | **Done-with-you** (Sarel loads vault, CVs, experience) |

Reasoning for each number:

- **R3,950 (SANRAL Pro):**
  - It sits just above TenderFlow Enterprise (R3,500), on purpose. A buyer comparing the two sees one extra capability that has no SA equivalent, and the R450 difference is about 20 minutes of a director's time at ECSA rates.
  - It is about 10% to 18% of the estimated value at 2 submissions a month (R22k to R37k). One avoided engineer-day (8 h × R1,400 = R11,200) covers almost three months.
  - It is about 16% of a bid coordinator's cost (R25k/mo estimate), which supports the "fifth of a coordinator" frame.
- **R39,500 annual:** matches the "2 months free" convention AITenders uses. It's a shallower discount than TenderFlow's 47%, deliberately: a deep discount teaches buyers the monthly price is fake. Annual-up-front cash is what lets a part-time founder fund the worker, a lawyer's POPIA review, and Supabase Pro without touching Klipcorp money.
- **R1,490 (Tender Pro):** sits between TenderFlow's free and R1,900 tiers and TenderProSA's R799/R1,999. It includes no AI drafting (by design) but does include real form filling and pack merging, which TenderFlow doesn't describe.
- **Free Watch tier:** discovery is free elsewhere (VUZA, TenderFlow Starter), so charging for it can't win. It is the lead magnet: low cost to serve (the OCDS API is free), and it surfaces the B6 or expiry gap that the paid tiers fix.
- **Per-user add-ons are cheap on purpose.** The role-based digest (validator, CV admin, finance) is a real differentiator only if the whole bid team is in the tool.

### Model B (downsell): pay per pack, for irregular bidders

| Item | Price |
| --- | --- |
| Tender Watch | Free (as above) |
| **SANRAL submission pack** (both envelopes for one tender, including tender CVs for every position) | **R2,950 per tender** |
| **General tender pack** (SBD/MBD filled, overlay, merged pack) | **R950 per tender** |
| Vault, CV and Experience Library storage between packs | **R290 / month** (keeps reminders and data live) |

Reasoning:

- R2,950 is about 16% to 27% of the per-submission hours saved (R11k to R19k), and less than 3 hours of a registered engineer's billable time.
- **The crossover is deliberate.** Two SANRAL packs a month on Model B cost R5,900 + R290 = R6,190, against R3,950 for SANRAL Pro. Any firm bidding regularly is nudged to subscribe. A firm bidding twice a *year* still becomes a paying customer instead of a lost one.
- The R290 storage fee covers running cost and keeps the expiry reminders, the stickiest feature, working between bids.

### Model C (launch offer): Founding Firms Programme, first 10 firms only

| Element | Detail |
| --- | --- |
| Price | **R2,500 / month, or R25,000 / year up front, locked for 24 months** (about 37% below SANRAL Pro list). The deadline is the end of the founding round (10 firms, or 31 Jan 2027, whichever comes first). |
| Includes | Everything in SANRAL Pro; done-with-you onboarding; the three bonuses (reference-letter pack, B6 health check, pre-closing review call on the first live pack) |
| Guarantee | Conditional first-pack guarantee (section 3.4), refund of the first payment |
| What Sarel gets | Permission to use anonymised before/after numbers as a case study; a 30-minute feedback call per month; one introduction to another firm if they're happy (no obligation) |
| Why R2,500 and not free | The Deep-Dive's plan (phase 3, "free pilots") is kept, but only for the **first 2 or 3 firms from Klipcorp's direct network**, who are effectively design partners. After them, charge. Paying pilots tell you whether the price works; free pilots only tell you whether the product works. |

**Expected revenue (Calculated):**

- 10 founding firms × R2,500 = **R25,000 a month**, or up to R250,000 cash up front if all pay annually.
- Then new firms at list price. 20 SANRAL Pro firms is about R79,000 a month.

### What I would not do

- **Don't price below R1,000 for anything that includes SANRAL packs.** It puts Tender Tool in the discovery-tool comparison and makes it impossible to fund support.
- **Don't price per user only.** Small firms resent paying per head, and the value is per tender, not per seat. Seats are the add-on, not the core.
- **Don't use credits** (TenderProSA's model). Credits make a buyer ration the feature that creates the value.
- **Don't publish "save X hours" until measured** (Deep-Dive rule, kept).

---

## 5. Go-to-market

This builds on the Deep-Dive's "Go-to-market plan (lean, solo, part-time)", which is still right: conversation first, proof second, no paid ads until customers pay. Additions here: a named beachhead, a concrete list source, Hormozi's channel order, and a weekly time budget that fits around Klipcorp.

### 5.1 Beachhead

**Small and medium SA consulting engineering firms (about 5 to 50 staff) that bid SANRAL consultant tenders (Conventional and RRM consultant families)**, especially black-owned firms. They:

- score well on SANRAL's B-BBEE specific goals (the R.040 award shows 80 of 100 B-BBEE points);
- have the strongest case for being a serious bidder;
- usually have the least bid-office support.

Why this segment and not "SA SMEs that tender":

- **The SANRAL consultant engine is the most-built and best-verified part of the product.** It is real-data tested on R.396 and covered by the admin harness.
- **The pain is acute and recurring:** batch re-tendering (1.3), near-identical submissions repeated across tenders.
- **The firms are identifiable by name** (5.3).
- **Klipcorp is one of them**, so Sarel speaks their language and his own submissions are the case study.

Second segment, later: the same firms' **non-SANRAL** professional-services bids (municipal, provincial, ESKOM, Transnet) on Tender Pro. Third, much later: contractors, which needs new engines first.

### 5.2 Channels, in Hormozi's "Core Four" order

[$100M Leads summaries](https://www.shortform.com/pdf/100m-leads-pdf-alex-hormozi): warm outreach, then cold outreach, then free content, then paid ads. Master one before adding the next.

| Order | Channel | Concrete source | What to do |
| --- | --- | --- | --- |
| 1. Warm outreach | Klipcorp's own network | JV partners, sub-consultants, the key persons Klipcorp has teamed with, engineers Sarel knows from SANRAL, ACSA and SASSA work | Personal message or call: "We built this for our own SANRAL tenders. Can I show you the pack it built for R.396?" Goal: the first 2 or 3 design partners and the first founding firms. Hormozi's "Rule of 100" (100 touches a day) is unrealistic part-time; **use 5 to 10 personal touches a week.** |
| 2. Cold outreach, targeted | **SANRAL's published opening registers** (nra.co.za awarded tenders: every bidder by name) | Build a list of every firm that bid a SANRAL consultant tender in 2024 to 2026 (one register alone had 19). Exclude the large multinationals (Zutari, SMEC, Bosch); they have bid offices. Target the CCs and (Pty) Ltds. | Phone, or LinkedIn message to the director, referencing the specific tender they bid ("you bid R.040-060. We help firms your size assemble SANRAL packs"). Plus the **compulsory briefing sessions**: everyone bidding is in the room, so be there as a bidder (Klipcorp) and network honestly, without pitching in the session. |
| 3. Free content | LinkedIn (where SA engineering directors are), CESA/SAICE communities | Short, specific posts from real findings: "The B6 affidavit floors you at 6 of 15: here's how to get to 15"; "Your COID must be valid on the closing date, not today"; "Why SANRAL's open-tenders list missed six consultant tenders closing 22 Oct" | Each post links to the free Tender Watch. **Disclose that you built the tool** (Deep-Dive caution, kept). |
| 4. Industry bodies | **CESA** (almost 600 member firms, two-thirds with 20 staff or fewer) and **SAICE** (about 10,000 to 16,000 individual members; figures undated and conflicting) | Branch events, the Transportation division, CESA's SMME and young-professional forums | Later: offer a talk ("Getting SANRAL functionality right: B6, key persons, expiry") rather than a sponsored booth. Note that SAACE has long been part of CESA, so CESA is the body to approach. |
| 5. Paid ads | — | — | **Not until 10 paying firms**, per the existing plan |

**POPIA caution for cold outreach.** POPIA treats juristic persons as data subjects too. Section 69 restricts unsolicited *electronic* direct marketing without consent. Prefer phone calls, in-person contact at briefings, and LinkedIn connection requests over bulk email to scraped addresses. Get this checked when the attorney reviews the operator agreement (Deep-Dive POPIA section). This is my reading of the Act's structure, not legal advice.

**Not recommended as a first channel: CIDB contractor directories.** Those are contractors, and SANRAL's contractor tenders use documents this engine doesn't fill yet (3.1).

### 5.3 Weekly time budget (part-time, alongside Klipcorp)

The Deep-Dive assumed 20 to 30 hours a week for the product overall. For marketing and sales specifically, plan on **about 5 hours a week**:

| Activity | Hours/week |
| --- | --- |
| Warm and cold outreach: 5 to 10 personal touches, 1 or 2 demos | 2 |
| One LinkedIn post from a real finding | 0.5 |
| Onboarding a founding firm (amortised: about 3 to 4 h per firm, about 1 firm a fortnight) | 1.5 to 2 |
| Customer feedback calls and fixes triage | 1 |

### 5.4 90-day plan

**Weeks 0 to 4: get to "sellable"** (section 7's checklist)

- Deploy Supabase, the worker and email. Run one real Klipcorp SANRAL submission end to end on the live system. **Time it against a hand-done baseline**: this becomes the case study.
- Open the filled workbook in real Excel once (spec open issue).
- Draft the POPIA operator agreement and privacy notice.

**Weeks 3 to 8: design partners and founding firms**

- 10 warm conversations, using the Deep-Dive's interview questions (how long do CVs and pack assembly take, what do you use now, what do you pay), plus: "what would a tender consultant charge you?"
- 2 or 3 free design partners, then convert to the founding offer.
- Build the SANRAL opening-register list (about 50 to 100 small and medium firms).

**Weeks 6 to 13: first revenue**

- Cold outreach to the register list, about 10 a week.
- Goal: **5 founding firms paying by day 90**, with 10 as the stretch target. "Done" = 5 firms have each built a real pack unaided after onboarding, which matches the Deep-Dive's phase 3/5 gates.
- Publish the measured case study only once Klipcorp's numbers exist and are anonymised.

**After day 90:** referrals (the Deep-Dive's "month free per referral"; with founding firms, give a free extra user or an extra review call instead, so the price anchor holds), then CESA talks, then list price.

---

## 6. Positioning and messaging

### 6.1 Positioning statement

> **For** small and medium consulting engineering firms that bid SANRAL consultant tenders, **Tender Tool is** the submission engine that turns your company documents, people and past-project evidence into SANRAL's complete technical and financial envelope packs, checked page by page against the tender's own rules. **Unlike** tender-alert and AI-proposal tools, it fills SANRAL's own workbooks and forms from your real data, shows exactly what's missing before you submit, and never writes generic AI text into your bid.

The core angle to lead with: **"complete, correct, and yours."** Not "fast", not "AI".

- **Complete:** every returnable, in order, or listed as missing with the reason.
- **Correct:** read back and fingerprint-checked; never silently fills a changed template.
- **Yours:** built from your documents and your words, never AI boilerplate that makes 100 firms' bids look the same.

### 6.2 Headlines and value statements, each tied to a provable capability

| Headline | The capability that backs it (today) | Caveat to respect |
| --- | --- | --- |
| **"Your SANRAL technical and financial envelopes: built, numbered, bookmarked, and checked page by page."** | `assemble_pack.py` and `verify_pack()`: separate Envelope 2 PDF, contents page with every entry checked against its real start page, "Page X of N" on every page | Signatures, pricing and the B4/B5 narratives stay human; say so ("everything except what only you can sign or price") |
| **"867 dropdowns. Zero retyped."** | Conventional workbook fill (RRM: 873) from stored company and CV data | Pricing and hours are still typed by the firm |
| **"Don't let the B6 affidavit cap you at 6 out of 15."** | Experience Library plus the compliance report's B6 check, tied to this tender's own evidence rule | Points depend on the ratings on the client's letters; the tool finds the gap, it doesn't create the evidence |
| **"Valid today isn't enough. It has to be valid on the closing date."** | Compliance report checks expiry against the closing date; reminder logic flags documents lapsing before a pursued tender closes | Say "reminders" only once email sending is live |
| **"If SANRAL changes the form, we stop. We never guess."** | `fingerprint.py` refuses to fill a changed template | — |
| **"See your functionality score range before you spend a weekend on the bid."** | `sanralScoring.ts` / `score_outlook.py` estimates with ranges | Always "estimate" and "range", never "your score" |
| **"No AI blabber. Your bid reads like your firm, because it's built from your firm's documents."** | Product decision to remove AI narrative drafting (Deep-Dive, 2026-10-17); company-voice requirement | Don't contradict this with "AI-powered" headlines (6.3) |
| **"Upload a CV once. Use it as-is, or as a SANRAL B1/B2."** | CV library, use-as-is path, tender CV generation | Don't headline AI extraction accuracy (unmeasured) |
| **"A bid coordinator for SANRAL submissions, for less than a fifth of one."** | Price vs an estimated R25k/mo coordinator | Comparison, not a claim of headcount replaced |

### 6.3 Messaging that must not contradict the product

The Deep-Dive removed AI-drafted narrative sections (item 16) on Sarel's own reasoning:

> "We dont want every tender submission to look the same. Remember there might be 100 companies using the system and they cant all look the same. The tenders must not contain ai blabber."

So:

- **Never** say "AI writes your methodology / executive summary / capability statement." TenderFlow, AITenders (Licence), mytender.io and AutoRFP.ai all sell this. Tender Tool's position is the opposite, and that is a differentiator, not a gap. Make it explicit: *"We don't write your bid for you. We make sure nothing in it is missing, expired or mis-filed."*
- **Use "AI" sparingly and only where true:** reading the tender's own documents for requirements and rules, and (optionally) proposing CV fields for you to confirm, with a verbatim quote for every field. Lead with "reads your tender's own rules", not with "AI".
- **Don't promise "win more tenders".** Promise fewer avoidable losses: "never eliminated on a missing document or a blank form."
- **Don't promise a time saving** until Klipcorp's measured baseline exists. Then quote it exactly, with the tender anonymised.
- **Don't imply the product reaches buyers Tender Tool doesn't fill.** The SANRAL Conventional family is mapped for score estimates; other families show "not mapped yet". General tenders fill SBD/MBD 1, 4, 6.1 (`.docx`), the overlay covers 1, 4 and 9, and other forms are listed "by hand". Say "SANRAL consultant tenders, plus standard SBD/MBD forms for other buyers."

### 6.4 The demo (the most important piece of marketing)

A 15-minute screen-share, in this order:

1. Discovery shows a live SANRAL consultant tender.
2. The compliance report shows what's on file, what's missing, the B6 count and the score range.
3. Click "Generate submission pack".
4. Open the technical PDF: contents page, bookmarks, the "Not included" table.
5. Open the Envelope 2 PDF.

Anonymise Klipcorp's data (or use the `complete_co` test company) per the Deep-Dive's confidentiality caution.

---

## 7. Pre-launch checklist, risks and open questions

### 7.1 Must be true before charging anyone (from System-Status)

1. **A live Supabase project, with the bridge worker deployed** (Gap #9, `Automated-Fulfillment-Deployment.md`). Today nothing has run against live rows.
2. **Email sending for reminders and the digest is live and verified.** Until then, don't sell "reminders" as a feature.
3. **One real Klipcorp SANRAL submission built end to end on the live system, and timed.**
4. **The filled workbook opened in real Excel** once. The spec notes PDFs come from LibreOffice and were never compared with an Excel print.
5. **POPIA:** operator agreement, privacy notice, cross-border basis for Supabase/Vercel/Anthropic hosting (Deep-Dive POPIA section), and registration of the information officer.
6. **Real admin flag** for the review console. "Owner of any company" currently acts as admin (System-Status admin-console note), which is unsafe once customers sign up.
7. **The upload cap** (about 4.4 MB for CVs, experience and the vault, Gap #8). Scanned reference letters and close-out reports will hit it during onboarding.

### 7.2 Risks

| Risk | Mitigation |
| --- | --- |
| SANRAL changes templates mid-batch | The fingerprint check stops the fill; the admin harness; the stated "we stop, we never guess" promise; budget Sarel's time for engine updates during batch releases |
| SANRAL tender volume drops after the batch | Tender Pro (general tenders) as the second leg; annual pricing locks in revenue through slow months |
| A small, connected market: one bad pack becomes known | The guarantee, the pre-closing review call, provenance labels, and "Not included" honesty |
| Competitors (e.g. TenderFlow) add SANRAL support | The 867/873-dropdown, macro-safe workbook work and the verification discipline are a real moat for some time; win the first 10 to 20 firms during the batch window |
| Cold outreach under POPIA | Phone and in-person first; legal check (5.2) |
| Klipcorp's competitors become Tender Tool customers | Real tension: Tender Tool's customers bid against Klipcorp. Data isolation is already enforced by RLS. Sarel must decide whether he's comfortable selling to direct competitors, and state the tenant-isolation and no-staff-browsing policy openly (Deep-Dive POPIA row on s 19) |
| SANRAL's own site requires a download form per tender | Discovery of SANRAL tenders relies on manual load or eTenders; settle SANRAL's terms of use first (Deep-Dive) |

### 7.3 Open questions for Sarel

1. **Is selling to firms that compete with Klipcorp acceptable?** This decides whether the beachhead is "all SANRAL consultant bidders" or "non-competing disciplines and regions only."
2. **How many hours did Klipcorp's last two SANRAL consultant submissions actually take, and who did the work?** This replaces the 24 to 40 hour estimate in 2.2 and sets the case study.
3. **Founding price:** R2,500/mo for 24 months, or prefer R25,000/yr annual only (simpler and better cash)?
4. **Which 10 firms in Klipcorp's own network** (JV partners, sub-consultants, former colleagues) could be warm outreach in week 3?
5. **Is Sarel willing to do done-with-you onboarding** (about 3 to 4 hours per firm)? If not, the time-delay and effort levers weaken, and the price should drop toward R2,950.
6. **VAT:** is the selling entity VAT-registered? Prices here are excl. VAT. Quote consistently.

---

## 8. Sources

**Repo (read in full or in the relevant sections):** `docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md`, `docs/specs/System-Status.md`, `docs/specs/Experience-Library-Findings.md`, `app/lib/sanralScoring.ts` (B6 floor and ceiling).

**SA competitors and price anchors:**

- [TenderFlow pricing](https://www.tenderflow.co.za/pricing/)
- [TenderProSA pricing](https://tenderprosa.co.za/pricing)
- [AITenders pricing](https://aitenders.co.za/pricing)
- [BidsStack pricing](https://app.bidsstack.com/pricing)
- [L2B tender pricing](https://www.l2b.co.za/Tenders/Tender-Pricing)
- [VUZA](https://getvuza.com/)
- [Tender Aid on Capterra](https://www.capterra.com/p/10045780/Tender-Aid/)
- [Xero SA pricing](https://www.xero.com/za/pricing-plans/)
- [SimplePay on Capterra ZA](https://www.capterra.co.za/software/202444/simplepay)
- [CV Partner / Flowcase on Capterra](https://www.capterra.co.uk/software/208998/cv-partner)
- BEE123 and InGroup (search results: [chro.co.za on BEE123](https://chro.co.za/articles/hr-indaba-africa-2019-bee123-is-south-africas-marketleading-bbbee-solution-provider/))
- TendX, Tenders SA, TenderFinder, NowNow (search results: [eNCA on AITenders](https://www.enca.com/promotions/local-ai-company-launches-platform-help-businesses-win-tenders-faster), [BizNews on NowNow](https://www.biznews.com/good-hope-project/local-ai-businessinabox-startup-nownow), [Tenders SA on Product Hunt](https://www.producthunt.com/products/tenders-sa-ai-based-tender-discovery))

**Market and value:**

- [BusinessTech on the SANRAL R9.5bn ruling, 29 Jul 2026](https://businesstech.co.za/news/?p=867852)
- [SANRAL R.040-060-2020/1RF opening register and award](https://www.nra.co.za/awarded-tenders/contract-sanral-r-040-060-2020-1rf)
- [ECSA Guideline Scope of Services and Professional Fees 2025, clause 4.4.3](https://www.ecsa.co.za/download/472/gazettes/1008779/guideline-scope-of-services-and-professional-fees_scope-of-services-and-tariff-of-fees-for-persons-registered-in-terms-of-the-engineering-profession-act)
- [ECSA gazette notice](https://www.ecsa.co.za/news-archives/news-archives-2025/guideline-scope-of-services-and-professional-fees-gazetted/)
- [CESA at 70: about 600 member firms](https://newsletter.en.creamermedia.com/article/cesa-celebrates-70-years-aims-to-foster-local-capacity-to-overcome-infrastructure-backlog-2022-06-21)
- SAICE membership: [village.ai](https://village.ai/company/saice), [NMU SAICE chapter](https://civileng.mandela.ac.za/SAICE-Student-Chapter) (undated, conflicting)

**Hormozi (secondary summaries; the books themselves were not read):**

- [SuperSummary, $100M Offers](https://www.supersummary.com/100m-offers/summary/)
- [abitgamey on the value equation](https://abitgamey.substack.com/p/four-levers-that-drive-customer-value)
- [Creator Economy on the value equation](https://creatoreconomy.so/p/the-value-equation-for-irresistible-products)
- [Learner's Week book club](https://thelearnersweek.substack.com/p/book-club-100m-offers)
- [Max Mednik's notes](https://www.maxmednik.com/blog/notes-on-100m-offers-by-alex-hormozi)
- [Shortform on the starving crowd](https://www.shortform.com/blog/starving-crowd/)
- [Shortform, $100M Leads](https://www.shortform.com/pdf/100m-leads-pdf-alex-hormozi)
- [Bryce Watson, $100M Leads applied](https://brycewatson.com/blog/20-100m-leads-applied)
- [JXNL, $100M Money Models report](https://jxnl.co/writing/2025/08/20/the-100m-money-models-the-complete-report)
- [SuperSummary, $100M Money Models](https://www.supersummary.com/100m-money-models/summary/)
- [Young and Profiting interview, E199](https://youngandprofiting.com/alex-hormozi-the-value-equation-how-to-make-offers-so-good-people-feel-stupid-saying-no-e199/)

**Not verified:**

- Tender consultants' fees: none published.
- Current SAICE and CESA membership counts: latest found is 2022 for CESA, undated for SAICE.
- Whether SANRAL's terms permit automated collection.
- Whether POPIA s 69 applies to every channel listed. Check with an attorney.

---

## 9. Deep dive: Leads 2 Business (L2B)

Added 17 Oct 2026 at Sarel's request: "do some research on leads to business to see if they still exist, what's their coverage on tenders, and how would our product compare with them." **"L2B" in sections 1.1 and 1.2 is the same company.** This section goes past the single price point those sections gave.

### 9.1 Verdict

**L2B is alive, long-established and much bigger than Tender Tool at discovery. It does none of what Tender Tool's paid tiers sell.** It is a research-led lead service for the construction supply chain: tenders, private projects, awards, contacts and a quotation (RFQ/BoQ) marketplace. It doesn't fill forms, check compliance, match CVs or build submission packs.

So L2B is **not a direct competitor** for SANRAL Pro or Tender Pro. It overlaps only with the free Tender Watch tier, where it is clearly better on coverage. Treat it as an upstream source a customer might already pay for, and possibly a channel partner, rather than as a rival to fight feature by feature.

### 9.2 Does it still exist? Yes (Observed)

- **Live site:** [l2b.co.za](https://www.l2b.co.za/), footer "© Cedrus Internet Solutions (Pty) Ltd 2026". A rebuilt platform is running at `next.l2b.co.za`, with public teaser pages for tenders published late July and early August 2026 (for example DTA 1151573, fencing, published 30 Jul 2026; DTA 1152040, pothole patching in KwaDukuza, 31 Jul 2026).
- **Age:** "Established 1999" ([about us](https://www.l2b.co.za/about-us)). It grew out of the DailyTenders notification service, and the research team is based in Hilton, KZN ([FAQ](https://www.l2b.co.za/faq)).
- **Scale, self-reported** in its June 2024 25-year post ([blog](https://www.l2b.co.za/blog/celebrating-25-years-of-leads-2-business)): 1,020,940 tenders published, 31,513 private projects, 21.8 million RFQs sent, 26,742 BoQs uploaded, 384,843 directory entries, and "nearly 4,000 active users" (3,944). These are L2B's own numbers, not independently checked.
- **Selling today:** a current pricing page, a 14-day free trial (no credit card; applications approved within about two working days), and month-to-month terms with 14 days' written notice to cancel.

### 9.3 Coverage: what L2B covers, and how it compares with Tender Tool's discovery

| | L2B | Tender Tool today |
| --- | --- | --- |
| How listings are found | Human research team. Sources named in the FAQ: government gazettes, newspapers, industry publications, online sources, direct industry contacts, the Deeds Office | Machine feed: National Treasury's eTenders OCDS API (`engine/discovery/etenders_national.py`), plus SANRAL's own site (`run_discovery.py`) |
| SA public tenders | Yes: national, provincial, municipal and other public buyers, across industries (public listings include construction, PPE, vehicles, kitchen hygiene, ICT) | Yes, but only buyers that publish through the eTenders portal, plus SANRAL's own site |
| Private-sector and invited tenders | "Primarily public tenders"; private or invited tenders when the inviting organisation shares them officially | **No** |
| Private construction projects (pre-tender leads) | Yes: development phases, the organisations and professionals involved, contacts (Projects service) | **No** |
| Rest of Africa | Yes: separate Africa plan, five regions (public example: a Lesotho Bureau of Statistics tender, DTA 1110712) | **No** |
| Award information | Yes: an awards section, "Request Award Information" from the research team, and award alerts on monitored tenders | **Effectively no.** The module's own testing found `awards` and `contracts` empty on every release sampled (400 releases, Jul to Oct 2026, plus 100 from 2024 H1) |
| Bidders lists, BoQs, site-attendance registers | On request from the research team, where obtainable | **No** |
| Tender documents | Documents and addenda behind the paywall; document collection in Gauteng (Infomessenger) | OCDS `documents` only link back to the buyer's own download pages; SANRAL's reCAPTCHA-gated documents still need a person to fetch them |
| Change tracking | Daily Advisory email flags cancellations, re-advertisements and amendments; "monitor" a tender for emailed updates | No amendment tracking. Note also that OCDS `tender.status` is blank on every release sampled, so "open" is inferred from the closing date |
| Feed reliability | Curated; quality depends on the research team | The OCDS API returns HTTP 500 at about page 5 or 6 (500 to 600 records) on any date window, so long windows get truncated; it repeats some releases across pages (deduplicated in code) |
| Fit to *your* company | Profile-based filtering: location, industry, project stage, CIDB grading | **Stronger here:** a fit verdict and score outlook against the company's own profile, CVs and evidence |

**What this means:** on breadth (private tenders, private projects, Africa, awards, bidders lists, amendments) L2B is plainly better, and its 27-year research operation can't be matched by a free government API. Tender Tool's discovery only wins on the *next* question: "does this tender fit us, and what would we score?" That supports section 4's call: discovery is the free lead magnet, not something to charge for.

One limit on this comparison: I couldn't see inside L2B's paywall. How many SANRAL consultant (professional services) tenders it carries, and how quickly, is unverified. A web search for SANRAL consulting-engineering tenders turned up nra.co.za and TenderFlow listings but no L2B pages. That fits L2B's construction and contractor focus, but it doesn't prove L2B leaves them out.

### 9.4 Usability and user friendliness

- **The product works like this (Observed, from L2B's own guidance):** a **Daily Advisory email** driven by an "Advisory Settings Profile". You open each lead online, "monitor" the ones you want, set reminders for site inspections and closing dates, keep notes, and email the named researcher with questions. L2B's own tips tell users to "go through the daily Advisory email thoroughly each day" ([blog](https://blog.l2b.co.za/how-to-make-the-most-of-our-tenders/)). It is a mature, human-backed, email-first workflow.
- **Help material:** a "How To" video series on L2B's blog (for example about three minutes on managing notifications) and a wiki with screenshots. The tender pages on the new `next.l2b.co.za` platform returned HTTP 503 several times during this research. That may only be a migration under way, but it is worth noting.
- **Reviews:** **no independent reviews found.** There is nothing on Capterra or G2 (the Capterra "Leads2b" listing is an unrelated prospecting tool), and searches found nothing on HelloPeter or Trustpilot. L2B's own testimonials page praises support, training and the value of L2B and L2Q, and shows no negatives because L2B chose them. **I found no real user complaints or independent praise, so I make no usability claim either way.**
- **Compared with Tender Tool:** L2B is built around reading a daily list of leads. Tender Tool is built around preparing a bid for one chosen tender. They are different jobs. A consulting firm could quite reasonably use L2B to find a tender and Tender Tool to build the submission.

### 9.5 Functionality: does L2B do Tender Tool's niche?

| Tender Tool capability (built and verified, per section 2.1 and System-Status) | L2B |
| --- | --- |
| SANRAL Conventional and RRM workbook fill with a template fingerprint check | No |
| Two-envelope SANRAL submission pack (contents page, page ranges, bookmarks, "Not included" table) | No |
| Tender-customised CVs (SANRAL key-person and World Bank formats); CV-to-position matching | No. L2B offers no CV or people functions |
| SBD/MBD form fill and flat-PDF overlay; merged general pack | No |
| Compliance report: required documents against the vault on the closing date; key-person minimums; experience against the tender's own evidence rule; SANRAL functionality score estimate | No |
| Experience Library (reference letters, completion certificates) | No |
| Document vault with expiry tracking | No |
| Pipeline board, task timeline, role-based digest | Partly: monitor lists, notes and reminders on a lead, but no bid workflow |
| **L2B features Tender Tool doesn't have** | Private projects and contacts; Africa; awards; bidders lists; BoQ and site-register requests; **Leads 2 Quotes** (BoQ pricing tool, RFQ distribution to suppliers); **Open Quotes** supplier marketplace; directory; advertising; **L2B Unplugged** data integration (price on application) |

**Plainly: there is zero functional overlap with Tender Tool's paid niche.** L2B's "beyond discovery" products face *downstream suppliers* (contractors pricing BoQs and getting supplier quotes). They don't touch a *consultant's* compliance and submission pack.

### 9.6 Pricing, re-verified 17 Oct 2026 (all excl. VAT, per month)

The R1,426 figure in section 1.2 is **stale**. It matches the *FAQ's* older list. The live [pricing page](https://www.l2b.co.za/pricing) now shows higher prices. The old `/Tenders/Tender-Pricing` link in section 8 returns 404.

| Plan | Live pricing page (17 Oct 2026) | FAQ (older list, still published) |
| --- | --- | --- |
| Tenders South Africa | **R1,495.65** | R1,426.09 (extra user R521.74) |
| Tenders Africa | R1,808.70 | R1,721.74 (extra user R695.65) |
| Tenders SA + Africa | R2,582.61 | R2,460.87 (extra user R704.35) |
| Private Projects (SA + Africa) | R3,200.00 | R3,043.48 (extra user R1,339.13) |
| L2Q (buyer RFQs / BoQ) | R2,634.78 | R2,513.04 (extra user R1,756.52) |
| Open Quotes (suppliers) | R321.74 | R304.35 |
| Price per bill (RFQ service) | R713.04 per bill | — |
| Advertising | R11,426.09 | — |
| L2B Unplugged (data integration) | Price on application | — |

Quarterly, six-monthly and annual billing are offered, but those prices aren't shown. The live page doesn't state per-user prices. The live prices are about 5% above the FAQ's, which looks like a price increase the FAQ hasn't caught up with (my inference).

**What the price says:** SA firms already pay about **R1,500 a month just to be told about tenders**, by L2B, which has around 4,000 users. That is a useful anchor. It makes section 4's R1,490 Tender Pro (discovery *plus* form filling and packs) look cheap. It also means SANRAL Pro at R3,950 is about 2.6 times an L2B SA tenders subscription, for a product that does a different and much heavier job.

### 9.7 Head-to-head summary (honest)

| Dimension | L2B | Tender Tool | Who's better |
| --- | --- | --- | --- |
| Exists and trading | Since 1999, about 4,000 users (self-reported), live 2026 pricing | Not sellable yet (no live Supabase, worker not deployed: section 7.1) | **L2B, by a long way** |
| Coverage breadth | SA public tenders, private and invited tenders, private projects, Africa, awards | eTenders OCDS buyers plus SANRAL's site; no awards in practice | **L2B** |
| Discovery alerts | Mature daily email, amendment and award tracking, a human researcher to email | Daily digest logic built, but `--mode live` unverified and email not sent yet | **L2B** |
| Trust and track record | 27 years, research team, phone line (0860 836 337) | One firm (Klipcorp) using it on its own tenders | **L2B** |
| Fit and score to *your* firm | Profile filters (region, industry, stage, CIDB grade) | Fit verdict plus SANRAL functionality score estimate from your own CVs and evidence | **Tender Tool** |
| Compliance checking | None | Vault against the closing date, key-person minimums, B6 evidence check | **Tender Tool (L2B has none)** |
| CV and people matching | None | Tender CVs per position, World Bank format | **Tender Tool (L2B has none)** |
| Pack generation | None | SANRAL two-envelope packs, SBD/MBD fill and overlay | **Tender Tool (L2B has none)** |
| Supplier quoting (BoQ/RFQ) | L2Q, Open Quotes | None | **L2B (Tender Tool has none, and doesn't need it)** |
| Price | R1,495.65/mo for SA tenders | R0 (Watch) / R1,490 / R3,950 proposed | Not comparable: different jobs |
| Independent reviews | None found | None (not launched) | Neither |

### 9.8 What to do with this

1. **Don't position against L2B.** A director who pays L2B is a *good* prospect: they already pay to find tenders, so the next pain is preparing them. The message: *"Keep L2B for finding work. Tender Tool builds the submission."*
2. **Ask about L2B in the customer interviews** (section 5.4): "Do you pay for L2B or another lead service? Does it carry the SANRAL consultant tenders you bid, and how quickly?" That answers the coverage question 9.3 couldn't, and tells Sarel whether Tender Watch adds anything for that firm.
3. **Possible partnership, later and low priority:** L2B already sells data integration ("L2B Unplugged", price on application). A future "import this L2B tender into Tender Tool" link, or a referral arrangement, would add their coverage to Tender Tool's workflow without competing. Only worth exploring after the first 10 paying firms; nobody has asked L2B anything yet.
4. **Correct section 1.2's L2B row** to R1,495.65/mo (live page, 17 Oct 2026) at the next edit, and point the source link at [l2b.co.za/pricing](https://www.l2b.co.za/pricing).

**Sources for this section:** [l2b.co.za](https://www.l2b.co.za/), [pricing](https://www.l2b.co.za/pricing), [FAQ](https://www.l2b.co.za/faq), [about us](https://www.l2b.co.za/about-us), [free trial](https://www.l2b.co.za/free-trial), [testimonials](https://www.l2b.co.za/testimonials), [25-years post (June 2024)](https://www.l2b.co.za/blog/celebrating-25-years-of-leads-2-business), [how to use tenders (blog)](https://blog.l2b.co.za/how-to-make-the-most-of-our-tenders/), [public tender page, DTA 1110712](https://www.l2b.co.za/Tender/Construction-of-Slab-Supply-and-Mounting-of-Prefa/1110712), [next.l2b.co.za tender listing, DTA 1151573](https://next.l2b.co.za/tenders/supply-delivery-and-installation-of-clearview-fencing/1151573) (returned 503 when fetched; seen in search results), [Mining Weekly on the 2013 mobile app](https://www.miningweekly.com/article/company-annoucementsleads-2-go-mobility-revives-construction-opportunities-2013-10-03). Repo: `engine/discovery/etenders_national.py` (OCDS limits), `docs/specs/System-Status.md`.
