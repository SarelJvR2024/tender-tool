# Award outcomes and competitor intelligence: findings (Deep-Dive items 17 and 28)

Investigated 2026-10-17. Every claim below comes from a request made that day; the
commands are reproducible with `engine/discovery/award_outcomes.py` and the notes
under each check.

## Summary

The earlier finding still holds: the OCDS API has no award data. It was wrong to
read it as "South African buyers don't publish awards", though. Two public sources
publish them, and neither goes through the OCDS feed:

1. **The eTenders portal's own "Awarded" tab** (National Treasury). It holds
   35,316 awarded tenders across all buyers, with the winning supplier, the award
   amount, the award date and the enterprise type. Some rows also list the
   bidders and their amounts. Each row links back to its OCDS release.
2. **SANRAL's own "Awarded tenders" and "Closed tenders" pages.** These carry the
   winner, the B-BBEE and total points, the approved contract amount and the award
   date. They also carry **the tender opening register: every tenderer and the
   amount it tendered**, and SANRAL publishes that register before the award. This
   covers SANRAL's consulting tenders, which is Klipcorp's own segment.
   NRA 2026/0084(B) lists Klipcorp Pty Ltd next to 10 competitors, with each
   firm's price per contract.

Both sources are public: no login, and no CAPTCHA on the data. **Built:** a
lightweight, report-only capture module, `engine/discovery/award_outcomes.py`. It
follows `etenders_national.py`'s conventions and reuses `list_tenders.py`'s SANRAL
list reader rather than adding a parallel scraper. It has an offline test
(`test_award_outcomes.py`, now in CI). **Not built:** storage in Supabase or any UI
(see "What is not built").

## 1. OCDS `awards`/`contracts`: still empty

`ocds-api.etenders.gov.za/api/OCDSReleases` was sampled in pages of 10. The API
returns HTTP 500 on many pages; at 100 per page most windows fail outright. Failing
pages were skipped.

| Window | Releases read | Pages that 500'd | awards | contracts | tender.tenderers | tender.value | parties roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-15..16 | 300 | 0 of 30 | 0 | 0 | 0 | 0 | none |
| 2026-10-01..02 | 250 | 5 of 30 | 0 | 0 | 0 | 0 | none |
| 2026-09-02..03 | 90 | 21 of 30 | 0 | 0 | 0 | 0 | none |
| 2026-06-02..03 | 70 | 13 of 20 | 0 | 0 | 0 | 0 | none |
| 2025-11-04..05 | 90 | 11 of 20 | 0 | 0 | 0 | 0 | none |

That is 800 unique releases, and every one is tagged only `compiled`. The keys
`awards` and `contracts` are present but always `[]`. Since the earlier check, the
API's `swagger/v1/swagger.json` has started to resolve (the earlier pass found no
swagger). It documents only `GET /api/OCDSReleases` and
`GET /api/OCDSReleases/release/{ocid}`. The second endpoint returned 404 or 500 for
the ocids tried. There is no awards endpoint.

**The same awards are on the portal but not in OCDS.** Portal award row 174379
(uMngeni-uThukela Water, awarded 2026-10-14 to AUMANAT for R551,189) has OCDS ocid
`ocds-9t57fa-174379` by the join rule below. Its OCDS release carries no award. So
the data exists, and National Treasury's OCDS export simply doesn't include it.
That is a gap in the publishing pipeline, not a gap in what buyers capture.

## 2. eTenders portal "Awarded" tab

**Access.** `https://www.etenders.gov.za/Home/opportunities?id=2` is the public page.
Its DataTable reads `GET /Home/PaginatedTenderOpportunities?status=2` or
`GET /Home/TenderFilter/?status=2&department=<id>` (status 1/2/3/4 =
advertised/awarded/closed/cancelled; read from the page's own JS). The public
checks found:

- no login and no CAPTCHA (`captcha` appears 0 times on the page);
- `robots.txt` returns 404, and `/Home/Terms`, `/Home/TermsAndConditions` and
  `/Home/Disclaimer` all return 404;
- the only policy linked is National Treasury's POPIA Privacy Statement (2026, 6
  pages, read in full), which says nothing about reuse of published tender data.

The page offers its own Excel/PDF export of the awarded list. Unlike the OCDS API,
there is no explicit open-data licence (PDDL). It is the official publication
channel for award notices, read the same way the public page reads it.

**Content** (`award_outcomes.py --source portal`):

| Read | Rows | Winner | Award amount | Award date | Bidders list | Broken records skipped |
| --- | --- | --- | --- | --- | --- | --- |
| All buyers, newest 200 | 200 | 196 | 187 | 196 | 32 | 15 |
| SANRAL (`--department 618`, 649 awarded in total), newest 100 | 100 | 100 | 100 | 99 | 17 | 1 |

In a separate sample of 300 rows across all buyers, 286 had a winner and an amount,
and none had evaluation points (`pointsAwarded` is always null).

**Join to Discovery.** A portal row's numeric `id` is the OCDS `tender.id`, and its
ocid is `ocds-9t57fa-<id>`. Checked: 205 of 275 active portal rows matched the 300
OCDS releases from 2026-10-15..16 by that rule, and each matched OCDS `tender.title`
equals the portal `tender_No`.

**Data quality, observed:**

- **Broken records.** Some single records make the server return 500 for a whole
  page. The module re-reads that page one record at a time and skips only the
  broken one.
- **Duplicate entries.** The same award is often entered twice in two formats
  (`678228,5` and `R678 228,50`). The module deduplicates them.
- **Bad dates.** Some award dates are `0001-01-01`; the module treats these as no
  date.
- **Inconsistent amounts.** Amounts can be `R0,00`, inclusive or exclusive of VAT
  (not stated), or the total of a multi-year contract.
- **Messy names.** Names are typed by hand: wrapped in parentheses, with stray
  spaces, and spelled several ways ("Roadmac Surfacing Cape (Pty) Ltd." vs
  "ROADMAC SURFACING CAPE").

Any pricing trend built on this needs name matching and outlier handling. It can't
just average the raw figures.

## 3. SANRAL awarded and closed tenders

**Access.** `https://www.nra.co.za/sanral-tenders/list/awarded-tenders` and
`/closed-tenders` use the same JSON list endpoint as `list_tenders.py`'s open list,
so it now takes a `list_slug` parameter. The detail pages are
`/awarded-tenders/<slug>` and `/closed-tenders/<slug>`. The public checks found:

- **robots.txt:** `User-agent: * Allow: /`.
- **Terms & Conditions** (`/terms-conditions`; this closes the "terms not readable"
  open item from 15 October): "the reproduction, publication, performance,
  communication or adaptation of the material presented on this web site is
  permitted, provided that SANRAL is acknowledge[d] as the copyright owner", the
  material is "not modified or used in a manner prejudicial to the purposes and/or
  reputation of SANRAL", and "no charge, claim or encumbrance is made upon any
  recipient of the material".
- **reCAPTCHA:** it is present on these pages, but only on the document-download
  form. That is the same finding as `detail.py` and `download_documents.py`.
  Reading the page's award table does not touch it. A register published as
  "REFER TO ATTACHED OPENING REGISTER" points at a file inside that gated
  download. It is reported as such and not fetched, under the same policy as the
  original document-download finding.

**Content** (`award_outcomes.py --source sanral --sanral-limit 100`):

| List | On the list | Listed by the endpoint | Pages read | Winner | Contract amount | Award date parsed | Opening register | Register only in gated attachment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Awarded | 90 | 69 | 69 | 64 | 64 | 60 (raw kept for all) | 67 | 0 |
| Closed (newest 60) | 5,546 | n/a (stops at 60) | 60 | 0 (not awarded yet) | 0 | n/a | 48 | 4 |

- **Project types.** Awarded: 46 construction, 18 consulting, 5 other. Closed,
  newest 60: 25 consulting, 19 of them with a register.
- **Register entries.** Across both lists there are 2,321 register entries.
  527 entries carry no parseable amount:
  - 230 come from registers that list names only (no amount column, e.g.
    technical-envelope openings);
  - 278 have a blank amount cell;
  - the rest are remarks such as "NO FORM OF OFFER INCLUDED" or "LATE BID
    SUBMISSION".

  The competitor names are still valid in all of these.
- **Listing shortfall.** The awarded list says 90 but its endpoint yields 69
  distinct rows over every page, the same shortfall `list_tenders.py` already
  records for the open list.
- **Source typos.** Some SANRAL source data has typos that no parser can fix:
  "R39 1453 554.20" reads as R391m, and dates like "24 JANAUARY 2023". Raw text is
  always kept next to the parsed value.

Consulting tenders with full price registers include X.004-113/114-2024/1F, N.011-014-2024/1F, N.002-213-2024/1F, the
X.002-160..163-2025/1F batches, R.573-020-2026/2S and NRA 2026/0084(B). The last
one lists Klipcorp Pty Ltd at R39,057,887.00 / R23,004,609.96 / R38,280,869.00
across its three contracts, alongside VST, Civil Design, Madan Singh, Ikusaselihle,
Moralla, Wamil, Nankhoo, Dyosana, PMAX and Dinokeng. Register columns vary: some
registers have one amount column per contract in a batch, plus a B-BBEE level. The
parser reads columns by their header.

**What this means for Klipcorp:** for a SANRAL consulting tender, the opening
register shows who bid and at what fee within days of closing. The award page
later adds the winner, its points and the approved amount. That is the "market
pricing by tender type" item 28 asked for, for the segment Klipcorp actually bids
in.

## 4. Competitor registers

- **CIDB Register of Contractors** (`portal.cidb.org.za/RegisterOfContractors/`, a
  Power Pages site): public, with no login and no CAPTCHA on the search page.
  - **Filters:** province, city, status (Active / DeRegistered / Expired /
    Suspended), grade designation 1-9 and class of work (CE, GB, EB, EP, ME, SB...).
  - **Grid data:** the grid loads through the portal's `_services/entity-grid-data.json`
    with an anti-forgery token.
  - **Terms:** none found; the only policy is CIDB's POPIA privacy statement.
  - **Old host:** `registers.cidb.org.za` returns 403 (Azure Application Gateway).

  **Not built:** CIDB registers *contractors* only. Klipcorp's SANRAL work is
  consulting engineering (ECSA-registered people), which CIDB does not register, so
  it would not show Klipcorp's competitors. It is useful context for a
  contractor-segment customer later: for example, how many active 7CE+ firms are in
  a province. The SANRAL opening registers above already name Klipcorp's real
  competitors directly.
- **ECSA's registered-persons search** lists individuals (personal information).
  It was not pursued for competitor intelligence.

## 5. What was built

`engine/discovery/award_outcomes.py` (report-only, like `etenders_national.py`):

- `--source portal`: the portal Awarded tab, newest first (`--limit`), optionally
  for one organ of state (`--department`, e.g. 618 = SANRAL) or filtered by buyer
  name. Records carry the ocid, so they join to `discovered_opportunities.ocid`.
- `--source sanral`: SANRAL's awarded and/or closed lists (`--sanral-lists`,
  `--sanral-limit`). Records carry the winner, points, amount, award date, the
  opening register and the SANRAL attribution string.
- **Data minimisation:** the module drops the portal's contact person, contact
  number, the buyer official's email and telephone, created/updated-by, and
  SANRAL's "Tenders Opened by" / "Tender Recorded by" / "In Attendance" names when
  it parses each record. It keeps company names, amounts, dates, points and B-BBEE
  level.
- **Politeness:** pages of 25 with a 0.5 s pause on the portal, 1 s between SANRAL
  detail pages, retries with backoff, and a hard page cap.
- **Tests:** `test_award_outcomes.py` uses offline fixtures trimmed from real
  responses: amount formats, dedupe, the ocid join, dropped personal fields, the
  batch register and the "refer to attached" register. It is in
  `bridge-worker-ci.yml`.
- **Change to existing code:** `list_tenders.fetch_tenders()` gains
  `list_slug="open-tenders"`. The default is unchanged (re-run: open list still
  returns rows).

## 6. What is not built, and what to decide

- **No storage or UI.** No table exists for public award records, and none was
  added. A shared, non-tenant table keyed by ocid / SANRAL reference, with the
  register as jsonb, read on `/pipeline/pricing` next to the company's own
  submitted prices (item 27, migration `0034`), is the natural next step. It is a
  product decision first:
  - **SANRAL's terms say no charge may be made "upon any recipient of the
    material".** Using it inside Klipcorp's own bidding is clearly fine. Showing
    it to paying SaaS customers, or selling it to non-bidders (the "use case
    beyond the bidder" in the Deep-Dive), needs Sarel's call. Possibly ask SANRAL.
  - **POPIA:** company names of juristic persons are personal information under
    POPIA too. They are public-record award notices published by law, and only the
    fields needed are kept, but a lawful-basis note should go into the POPIA
    section before storing them at scale.
- **No scheduled run.** Run the module by hand (or add it to the daily discovery
  watch once storage exists).
- **Name matching.** Competitor names need normalising before any "who wins what"
  statistics.
- **Side finding, flagged and not fixed:** `etenders_national.normalize()` stores
  OCDS `tender.id` as `contract_number`, and `tender.title` as `title`. On the live
  API, `tender.id` is the portal's internal number (e.g. `174382`), `tender.title`
  is the bid number (e.g. `RFX6000003683`) and `tender.description` is the actual
  title. Discovery therefore shows a portal id where a contract number is expected.
  Fixing it touches what `seed_supabase_opportunities.py` and the pipeline's
  contract-number join read, so it is left for whoever next touches Discovery.
- **Revisit OCDS** if National Treasury starts exporting the portal's awards into
  `awards`/`contracts`. `etenders_national.py` already reports `has_award_data`,
  so a non-zero count will show up there.
