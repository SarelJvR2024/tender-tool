# Municipality catalog, round 4 (final, bounded sweep) - 21 Oct 2026

Tightly-bounded follow-up per Sarel's instruction to "relook at the entire list" before moving on -
not another broad sweep (this research has already covered all 39 PFMA SOEs, all 9 provinces'
Public Works departments, and ~85 of 257 municipalities across prior rounds). This pass re-finds
real URLs for the highest-confidence leads already named as "real activity, no URL found" or
"URL guess 404'd" in `Government-Buyer-Catalog-eTenders-Overlap-Checks.md` and the Round 2/3 files,
rather than sampling new provinces. Bounded to ~20 minutes of real work.

## Results

| Municipality | Real URL found | Result | eTenders overlap |
| --- | --- | --- | --- |
| **Lephalale** | `www.lephalale.gov.za/pages/tenders.php` | **Reachable, real content, clean structure** - ~21+ current RFQs/tenders with both an upload date and a closing date on the listing itself (not a flat undated archive like Mbombela/Polokwane/Overstrand), plus a separate "Tender Adverts" section and older archives by year. Real municipal operational work (water meters, pump repairs, sewer main repair, lab equipment, electrical materials) | **Zero results for `--buyer "lephalale"` - confirmed real gap**, and now has a real, structured, closing-dated URL ready to build a reader against |
| **Msukaligwa** | `www.msukaligwa.gov.za/index.php/tenders-rfqs` | **Reachable, real content, clean structure** - 17 tenders/RFQs with closing dates on the listing, confirming the construction-relevant finds the original catalog named (item 15: panel of providers for structural/civil/plumbing/construction on municipal buildings, closing 18 Sep 2026; item 16: stormwater channel construction at Wesselton Ext 6, closed 20 Jul 2026) | **7 of these already on eTenders** (the panel-appointment items: skills training, transport, VIP protection, Microsoft licensing, lowbed/towing) - but the two construction-relevant ones (items 15/16 above) are **not** among eTenders' Msukaligwa listings, a real partial gap on exactly the content this product cares about most |
| **Kouga** (Jeffreys Bay/Humansdorp) | `www.kouga.gov.za/tenders` | **Reachable, real content, clean structure, very high volume** - a proper paginated table (ref no, title, start date, closing date), 95 pages. Page 1 alone: RFQs for walk-behind rollers, truck repairs, cable supply, office equipment, plus one real construction item (`225/2026`, "RESEALING OF ROADS - PHASE 4") | **5 of the 10 sampled (231/2026, 253/2026, 247/2026, 246/2026, 245/2026) already found verbatim on eTenders** - a high overlap rate on this small sample; with 95 pages total this needs a proper full-portal comparison before calling it a gap either way, not assumed from 10 rows |
| **Ndlambe** (Port Alfred) | `www.ndlambe.gov.za/quotations-and-tenders/` | **Reachable, real content, mixed structure** - the "Requests for Quotations" section (60+ rows) has real closing dates on every row; the separate "Formal Tenders" list (T01/2627 through T33/2526) has **no closing dates shown at all** on this page - real construction content there though (T01-T03/2627: Port Alfred sewerage pump station/sewer-system upgrades; T28/2526: road upgrades). Not checked against eTenders this pass (time budget) | Not checked |
| **Theewaterskloof** | `twk.gov.za/category/documents/supply-chain-management/quotations-and-tenders/` | **Reachable, but genuinely stale** - every entry on the main page dates from May-June 2024, over a year old; no closing dates shown at all. The page links to a separate "Quotations and Tenders Awarded" category (the higher-value award-register type per section 11.6) that this pass did not open - worth a follow-up, not this entity's main page | Not checked, and not worth it on the main page as found |
| **Swellendam** | Not found | **HTTP 403 on the homepage itself** - blocked outright, not a wrong-URL guess | N/A |

## What this adds

3 genuinely strong, structured, closing-dated candidates found this pass (Lephalale, Msukaligwa,
Kouga), resolving the "URL not yet re-found" flag from the previous overlap-checks file for two of
them. None is a flat undated document archive - all three have real closing dates on their listing
pages, the key structural requirement every reader built this session has needed.

## Ranked candidates

1. **Lephalale** - the strongest of the three: zero eTenders overlap confirmed, clean structure,
   real operational/construction content. Top candidate for the next reader build.
2. **Msukaligwa** - confirmed partial gap specifically on its two construction-relevant tenders
   (the ones that matter most for this product); its service/goods tenders are already on
   eTenders. A reader here would need to not re-duplicate those 7 - same `BUYER_FAMILY`-style
   merge discipline every reader already follows.
3. **Kouga** - highest volume (95 pages) but highest sampled overlap rate (5/10) too; needs a
   fuller eTenders comparison across more pages before ranking it above Lephalale/Msukaligwa -
   not ruled out, just not yet proven to be worth the volume.
4. **Ndlambe** - real construction content (sewerage/sewer upgrades) but the formal-tenders list
   has no visible closing dates - would need the same care as Mbombela/Polokwane to confirm
   whether dates exist elsewhere (an individual tender's own page, not checked this pass) before
   it's buildable.
5. **Theewaterskloof, Swellendam** - not candidates right now (stale data; blocked outright,
   respectively). Theewaterskloof's separate "Awarded" category is worth a dedicated future look,
   not its main page.

Not reached this pass (time budget): Makana, King Sabata Dalindyebo, Enoch Mgijima, Abaqulusi,
Maluti-a-Phofung, KwaDukuza, Alfred Duma, Ngwathe - all still in the "real activity, no official
URL confirmed" state from prior rounds, unchanged.

## Addendum (2026-10-21, later the same day): Lephalale and Kouga built; Msukaligwa checked, not built

**Lephalale** (`engine/discovery/lephalale.py`, `35f6222`) and **Kouga**
(`engine/discovery/kouga.py`, `363f042`) are both now built and committed - see their own module
docstrings and `System-Status.md` for what each one found. Kouga in particular turned out bigger
than this file estimated: not "95 pages" (a misread somewhere upstream) but a confirmed 28 real
pages, 280 tenders, only 4 of which are on eTenders at all.

**Msukaligwa checked properly, not built this pass.** Its real listing (`/index.php/tenders-rfqs`)
is clean and reachable (17 rows, a genuine "CLOSING DATE" column, format "13 November 2026 at
12H00" - parseable with source_http's existing DMY format plus a small local pre-clean for the "at"
and "H" time separator, the same "handle a buyer's own quirk locally, don't touch the shared
ambiguous parser" discipline Lephalale's DD/MM/YYYY dates already established). **But: 5 of the 17
rows share one identical PDF link** (`12-october-2026-tender-advert.pdf`) with 5 different titles
and the same closing date - the same "one PDF, several real tenders" shape Lephalale's own batches
have, not a Finding-42-style wrong-buyer problem, but it does mean there's no clean reference-number
field anywhere on the listing (unlike Lephalale's "Ref no:", Kouga's "Ref No:", or Vaal Central
Water's own clean per-tender numbers) - a release's identity would have to be synthesized from the
title text itself (a hash or slug), a real design choice not yet made. Given Msukaligwa's own
confirmed value is modest (2 construction-relevant tenders out of 17, the rest already on eTenders -
see `Government-Buyer-Catalog-eTenders-Overlap-Checks.md`), deprioritized in favour of the bigger,
cleaner finds (Lephalale, Kouga) and continuing phase 2 (verifying the requirements engine) - not
ruled out, just not worth building today.
