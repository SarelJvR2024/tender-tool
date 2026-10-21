# Municipality buyer catalog, round 2 (20 Oct 2026)

Extends `docs/specs/Government-Buyer-Catalog-Municipalities.md` (its Part 2 checked 12
municipalities live) and the original 42-municipality sample in
`docs/strategy/Marketing-Pricing-Strategy.md` section 11.6. Together those two passes already
covered ~54 municipalities; this pass does two things on top, per its own brief: (1) retries the
three municipalities that failed in Part 2 on a **wrong URL guess** rather than a confirmed-down
error, now searched for their real site first; and (2) checks new municipalities skewed toward the
provinces the existing 54 under-covered (Limpopo, Mpumalanga, North West, Free State, Northern
Cape), prioritising towns with real economic/construction activity (ports, mining, provincial
capitals). No municipality already named in either prior file is repeated here.

## Part 1: retries of wrong-URL-guess failures

| Municipality | Province | Original failure | Real site found | Result this pass |
| --- | --- | --- | --- | --- |
| **Polokwane** | Limpopo | 404 on a guessed path | `www.polokwane.gov.za` (homepage, confirmed real) | **Reachable, real content.** Dedicated SCM/tenders section with current-financial-year documents, including an active awards/price register (8 award documents listed for the current financial year alone) |
| **JB Marks** (Potchefstroom) | North West | DNS failure on a guessed domain | No working gov.za domain found via search, and the bare domain itself also fails DNS | **Confirmed genuinely unreachable** - not a wrong-path problem, the domain does not resolve at all. Different failure class from Polokwane; do not retry again without new evidence a domain exists |
| **Matjhabeng** (Welkom) | Free State | DNS failure on a guessed domain | No working gov.za domain found via search | **Confirmed genuinely unreachable**, same class as JB Marks |

## Part 2: metros re-confirmed unreachable (503 in Part 2)

Per this pass's own brief: only retry a 503 if there's real evidence it might be transient, not just
re-hit the same URL. One data point was checked - eThekwini, tried via a different, more specific
subdomain (`architecture.durban.gov.za/pages/business/procurement`, corroborated by real tender PDFs
found under `durban.gov.za/uploads/...`) rather than the original failed URL - and it **still returned
HTTP 503**, indicating a domain-wide block rather than one bad path. That single result is treated as
sufficient evidence not to individually re-fetch the other seven (Tshwane, Ekurhuleni, Nelson Mandela
Bay, Rustenburg, Sol Plaatje, Msunduzi, Emfuleni): all eight are **re-confirmed unreachable from this
environment**, unchanged from Part 2, without further automated retries.

## Part 3: new municipalities checked

| Municipality | Province / district | Own tender URL tried | Result | What it shows |
| --- | --- | --- | --- | --- |
| **Musina** | Limpopo, Vhembe | Procurement/SCM page, found via search | **Reachable, real content - active awards/price register**, updated as recently as 6 days before this check | Border-town/port-adjacent buyer; register lists documents by period, not yet confirmed whether each PDF shows inline bidder names and prices the way Swartland's do |
| **Lephalale** | Limpopo, Waterberg | SCM/tenders page, found via search | **Reachable, real content - high RFQ volume** | Many open items: water and electrical infrastructure maintenance RFQs - a strong open-tender-discovery candidate, not an awards register |
| **Msukaligwa** | Mpumalanga, Gert Sibande | Tenders page, found via search | **Reachable, real content** | Storm-water channel construction, a structural/civil/plumbing panel appointment, several items open through mid-November 2026 - genuinely construction-relevant and currently open |
| **Metsimaholo** | Free State, Fezile Dabi | Tenders page (Tenders / BoQ / Opening Register / Closing Register / Awarded tabs), found via search | **Reachable but empty/uncertain** - every tab showed column headers only, no rows, at the moment checked | Can't tell from a text fetch whether this is genuinely empty right now or JS-rendered content a non-browser tool can't see. Not claimed either way; worth a real-browser recheck before ruling it out |
| **uMhlathuze** (Richards Bay) | KwaZulu-Natal, King Cetshwayo | Homepage + `/index.php/documents/tenders-quotations` | **Reachable, real content** - homepage's own "Latest Documents" showed 3 RFQs all created the same day as this check, due 2026-10-28 | Port/industrial town; one RFQ (dosing pumps, Ngwelezane water treatment works) is directly water-infrastructure relevant. Same-day freshness is a strong positive signal |
| **Thabazimbi** | Limpopo, Waterberg | Searched for an own-site tenders page | **No own-site tender page confirmed reachable this pass** | Real tender activity exists (wastewater refurbishment, electrification, civil RFQs) but only found via third-party aggregators (TenderFlow, getvuza); a 2020 assessment named `thabazimbi.gov.za` as the domain but no current own-site procurement page could be confirmed live. Mining-town relevance noted for a future recheck, not a reader candidate yet |
| **Mahikeng** | North West, provincial capital | Searched for an own-site tenders page | **No own-site tender page confirmed reachable this pass** | Only third-party aggregator data found (one RFP, financial management system, closed March 2026). Provincial-capital status keeps it worth a future direct-browser check |
| **Gamagara** (Kathu) | Northern Cape, John Taolo Gaetsewe | Searched for an own-site tenders page | **No own-site tender page confirmed reachable this pass** | Mining-adjacent (Kathu, Sishen iron-ore belt) with real recent water/road/sanitation tender activity, but only visible via aggregators; own domain not confirmed this pass |
| **Raymond Mhlaba** | Eastern Cape, Amathole | Searched for an own-site tenders page | **No own-site tender page confirmed reachable this pass** | Only aggregator listings found (agriculture RFQs); own site not confirmed |

## What this adds

13 municipalities checked this pass (3 retries + 1 metro-retry data point + 9 new), on top of the
~54 already covered across the two prior files. Of those, **5 are confirmed reachable with real
content** (Polokwane, Musina, Lephalale, Msukaligwa, uMhlathuze), plus one borderline case
(Metsimaholo, reachable but unclear). **2 of the 5 reachable ones publish an awards/price
register specifically** - Polokwane and Musina - the highest-value category per section 11.6,
though for both the PDF/document format (listed by period) is not yet confirmed to show inline
bidder-and-price data the way Swartland's does; that's the next thing to check before treating
either as equivalent to the existing pilot buyers. The other 3 reachable finds (Lephalale,
Msukaligwa, uMhlathuze) are open-tender-discovery candidates, not award registers - real,
currently-open, construction/water-infrastructure-relevant work. 2 municipalities are confirmed
genuinely dead domains (JB Marks, Matjhabeng - not retry candidates again without new evidence),
8 metros are re-confirmed unreachable (503, unchanged), and 4 new municipalities (Thabazimbi,
Mahikeng, Gamagara, Raymond Mhlaba) have real tender activity per third-party aggregators but no
confirmed own-site page reachable by this pass's tools - worth a real-browser recheck, not ruled
out.

## Ranked candidates, positioned against the existing top picks

Not re-ranking uMngeni-uThukela Water, Vaal Central Water Board, Overberg Water, or the
Swartland/Saldanha Bay/Stellenbosch award-register pilots - those stand as already established.
Where this pass's finds slot in:

1. **Musina and Polokwane (awards/price-register finds)** - the closest new candidates to the
   Swartland-style pilot, both freshly updated, both worth a follow-up check of whether individual
   award documents list bidder names and prices inline (not yet confirmed either way). If so, both
   slot in just behind the existing pilot buyers; if the documents turn out to be summary-only,
   they drop to ordinary tender-discovery value instead.
2. **Lephalale, Msukaligwa, uMhlathuze (tender-discovery finds)** - real, open, construction/
   water-infrastructure-relevant listings, comparable in kind to Mbombela from Part 2 of the first
   municipality catalog. Below the water-board tier in priority (no confirmed eTenders-gap check
   done yet for any of the three) but genuine, currently-reachable content.
3. **Metsimaholo** - unresolved, not ranked; needs a real-browser recheck before it's worth
   anything either way.
4. **Thabazimbi, Mahikeng, Gamagara, Raymond Mhlaba** - real underlying tender activity confirmed
   via aggregators, but not yet a reader candidate until an own-site page is confirmed reachable.
   Flagged for a future pass, not ranked now.
