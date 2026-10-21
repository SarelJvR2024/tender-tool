# Municipality buyer catalog, round 3: Eastern Cape and Western Cape (20 Oct 2026)

**Correction, verified independently against the real saved HTML of both pages (not an AI-summarized
read) before this file was committed:** the fork that wrote this file's own characterization of
Overstrand and Knysna as "clean structured reference/title/date data" below is **wrong for
Overstrand and overstated for Knysna**. Checked directly:

- **Overstrand** (`overstrand.gov.za/document/supply-chain-management/tenders/`, a Joomla DOCman
  listing): no closing date anywhere on the page or in any document title - only a Joomla
  `datePublished` (upload date, not a deadline). The 5 "closing" hits on the whole 411KB page are
  all "Notice of Amendment of Closing Date" document titles (an amendment notice, not the date
  value itself). This is the exact same "flat document archive, no closing date" trap that already
  ruled out Mbombela and Polokwane - **not** a clean reader candidate as found.
- **Knysna** (`knysna.gov.za/do-business/bidding-opportunities/tenders/`, a WordPress Download
  Manager archive): better than Overstrand but still not clean. Its own "Current Tenders" accordion
  is actually **cancellation notices**, not open tenders; the genuinely current, open tenders for
  this financial year (T21/2026/27, T19/2026/27, etc. - the ones the fork quoted) sit under an
  accordion literally labelled **"Archived Tenders - 2027"** - a real site-side labelling
  inconsistency, not a fork error, but one that means a reader can't trust the accordion header to
  mean "open" vs "closed". Some (not all) of its document descriptions do embed a real
  "Closing Date: DD Month YYYY" as free text - a genuine advantage over Mbombela/Polokwane/
  Overstrand - but each tender is split across 2-4 separate document entries (Tender Document,
  Advert, MBD 5, etc.) needing reference-based grouping, and the page spans 6 years of archives
  (2022-2027, ~498 entries total) with no reliable section-label signal for current-vs-expired.

**Neither is being built this round.** Both are real, confirmed eTenders gaps (independently
re-verified: Overstrand 1 of many duplicated, Knysna 0 of several duplicated), but both need
meaningfully more parsing care than this file's own ranking below assumes - closer in difficulty to
the Mbombela/Polokwane class of problem than to Vaal Central Water Board. Worth a dedicated, careful
build later, not a quick add. The rest of this file (the 7 real-but-URL-unresolved municipalities,
and the two paragraphs ranking Overstrand/Knysna as "the strongest new candidates... since Vaal
Central Water Board itself") is kept as written below for the research record, but that specific
ranking claim should be read in light of this correction, not taken at face value.

Extends `Government-Buyer-Catalog-Municipalities.md` (Part 2's 12-municipality sample) and
`Government-Buyer-Catalog-Municipalities-Round2.md` (13 more). Of the ~67 municipalities covered
across those two files plus `Marketing-Pricing-Strategy.md` section 11.6's original 42-sample,
almost none were in Eastern Cape (only Buffalo City and Nelson Mandela Bay metros, both unreachable,
plus Raymond Mhlaba, not confirmed reachable) - this pass targets that gap specifically, plus the
remaining uncovered Western Cape locals. No municipality already named in any prior file is
repeated here.

## Results

| Municipality | Province / district | What was tried | Result | What it shows |
| --- | --- | --- | --- | --- |
| **Overstrand** (Hermanus) | Western Cape, Overberg | `overstrand.gov.za/document/supply-chain-management/tenders/` | **Reachable, real content - high volume (56 pages)** | Clean structured listing: reference, title, date, e.g. `OVM-05.2026.27` (retaining wall replacement, Pearly Beach), `SC2671/2026` (sidewalks and road/stormwater upgrades, Kleinmond and Gansbaai), `SC2662/2026`/`SC2663/2026` (construction materials, bitumen products). **eTenders overlap checked: only 1 of many found** (`OVM-13/2026/27`, a water-pipe-replacement tender not even on this page's own first screen) - a real, high-volume, largely unduplicated gap. A separate bid-reports/awards folder exists but its most recently indexed year is 2024/2025 - not confirmed still active, a 2026 awards register was not found this pass |
| **Knysna** | Western Cape, Garden Route | `knysna.gov.za/do-business/bidding-opportunities/tenders/` | **Reachable, real content - 17 current tenders, clean** | Confirmed clean reference/title/closing-date triples (not a flat document archive like Mbombela/Polokwane): `T21/2026/27` (lifesaving services), `T08/2026/27` (surfacing of gravel roads, Sedgefield - construction-relevant), `T16/2026/27` (heavy vehicles and plant). **eTenders overlap checked: zero found** under "knysna" - a clean, confirmed, buildable gap, comparable in quality to Vaal Central Water Board |
| **Ndlambe** (Port Alfred) | Eastern Cape, Sarah Baartman | Searched for a tenders index page | **Real tender PDFs confirmed to exist** (water/sewer pump station maintenance, a sewerage pump station upgrade, fencing/legal/uniforms panels) but **no working browsable index/listing page found this pass** - every result was either an individual PDF URL or a third-party aggregator. Not confirmed reachable as a structured source |
| **Kouga** (Jeffreys Bay/Humansdorp) | Eastern Cape, Sarah Baartman | Searched for a tenders page | Same situation as Ndlambe - real tenders confirmed via aggregators (office equipment, consumables, roads/stormwater equipment), `kouga.gov.za` domain confirmed from contact emails, but no own-site listing page located this pass |
| **Makana** (Grahamstown/Makhanda) | Eastern Cape, Sarah Baartman | Searched for a tenders page | Real current tender confirmed (`MLM/2025-26/INFRA/017`, asbestos water pipe replacement, R8.5m) via aggregator and municipal contact emails at `makana.gov.za`, but a 2020 assessment's own URL for the tenders page could not be re-confirmed live this pass. Separately, governance reporting (unspent-grant repayment order, an undelivered 2022 pump tender) suggests this municipality's procurement may be lower-trust data even if a reader were built - worth weighing before prioritizing |
| **King Sabata Dalindyebo** (Mthatha) | Eastern Cape, OR Tambo | Searched for a tenders page | Real tender activity confirmed via aggregators (`ksd.gov.za` contact domain, a R15m tender closing 15 Sep 2026), but no own-site listing page found. Note: King Sabata Dalindyebo TVET College is a separate institution whose tenders route through PURCO SA, not the municipality - don't conflate the two if this name resurfaces |
| **Swellendam** | Western Cape, Overberg | Searched for a tenders page | Real tender activity confirmed via aggregators only (an asbestos-to-PVC pipe replacement in Suurbraak, a bulk water pipeline to Railton pumpstation - both construction-relevant), `swellendam.gov.za` not found live this pass |
| **Theewaterskloof** | Western Cape, Overberg | Searched for a tenders page | Real site confirmed at `twk.gov.za` (not `theewaterskloof.gov.za` as the name would suggest - a real adverts folder with PDFs exists), but no browsable current-tenders index page located this pass, only individual PDF URLs and aggregator mirrors |
| **Enoch Mgijima** (Queenstown/Komani) | Eastern Cape, Chris Hani | Searched for a tenders page | Real, possibly-still-open tenders confirmed via aggregators only (a security-services tender closing 7 Oct 2026); no official site page found |

## What this adds

9 municipalities checked, all in Eastern Cape or Western Cape (the two provinces this pass targeted
specifically). **2 are confirmed, clean, high-confidence reader candidates** (Overstrand, Knysna) -
both passed the eTenders-overlap check with near-zero duplication, both have real structured
reference/title/date data (not a flat document archive), both have genuine construction/
infrastructure content. **7 have real, confirmed tender activity but no browsable index page found
this pass** (Ndlambe, Kouga, Makana, King Sabata Dalindyebo, Swellendam, Theewaterskloof, Enoch
Mgijima) - a different and more tractable gap than "genuinely unreachable": a more targeted search,
or a direct ask to Sarel (who may know these council websites), would likely surface the real
listing page for several of these, same as happened for Polokwane in round 2 (its "404 on a guessed
path" turned out to be a wrong URL, not a dead site).

**Eastern Cape remains the most under-covered province in this whole multi-round scan** - of the 37
non-metro Eastern Cape municipalities, only Raymond Mhlaba (round 2, inconclusive) and the 5 checked
here (none with a confirmed working index page) have been looked at at all. A further pass focused
specifically on finding real tender-page URLs for Eastern Cape municipalities (rather than new
provinces) would likely be the highest-value next step in this ongoing sweep, ahead of continuing
into provinces already well-sampled (Western Cape is now reasonably covered: of its ~29 locals plus
Cape Town metro, roughly 16 have been checked across all rounds).

## Ranked candidates, positioned against the existing top picks

Not re-ranking Vaal Central Water Board (reader built, committed `5e24ae8`), or the water-board/
municipality picks already ranked in prior files. Where this pass's finds slot in:

1. **Overstrand and Knysna** - the strongest new candidates from this whole multi-round municipality
   scan since Vaal Central Water Board itself: both confirmed clean structured data, both confirmed
   near-zero eTenders overlap, both genuinely construction-relevant. Knysna is smaller (17 tenders,
   one page, simpler to build) and would likely be the faster of the two to turn into a reader;
   Overstrand is higher-volume (56 pages) but needs a pagination strategy, the same category of
   extra care `randwater.py`'s own `PAGE_COUNT` safety-guard was built for. Both are ahead of
   Musina/uMhlathuze/Msukaligwa (round 2's partial-overlap, unresolved cases) in priority - these
   two are confirmed, not partial.
2. **Ndlambe, Kouga, Makana, King Sabata Dalindyebo, Swellendam, Theewaterskloof, Enoch Mgijima** -
   real confirmed tender activity, not reader candidates yet; each needs its real listing-page URL
   found (a more targeted search, or asking Sarel directly) before an eTenders-overlap check is
   even possible. Not ruled out, just not actionable this pass.
