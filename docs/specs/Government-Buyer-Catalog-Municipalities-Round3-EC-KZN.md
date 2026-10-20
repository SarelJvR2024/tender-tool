# Municipality buyer catalog, round 3: Eastern Cape and KwaZulu-Natal (20 Oct 2026)

Targeted sweep of the two provinces this research's prior passes covered the least (Eastern Cape:
only Buffalo City checked, unreachable; KwaZulu-Natal: only eThekwini [dead], Newcastle, Msunduzi
[dead], uMhlathuze checked), per the user's own instruction to keep checking until genuinely
confident there's nothing left. A smaller, direct sample (4 towns) rather than the usual
12-13-municipality sweep - a parallel background pass is covering North West/Northern Cape/the
remaining Limpopo-Mpumalanga-Gauteng municipalities at the same time; this file doesn't duplicate
that scope.

## Results

| Municipality | Province / district | Own tender URL found | Result | What it shows |
| --- | --- | --- | --- | --- |
| **King Sabata Dalindyebo** (Mthatha) | Eastern Cape, OR Tambo - former Transkei capital | `ksd.gov.za/procurements/tenders/`, `/tender-register/`, `/awarded-tenders/` | **Reachable, but inconclusive** - a real, structured procurement section exists (Tenders & RFQs with an explicit "green = open, red = closed" legend, a separate Tender Register, Addendum, Cancelled Tenders and Awarded Tenders pages), but every page returned only navigation/menu text to a plain fetch, no actual entries - the listings are very likely JS-rendered (same pattern Round 2 hit at Metsimaholo). A real-browser recheck is needed before ruling this in or out either way - the site structure alone (a dedicated Awarded Tenders page, separate from the open list) makes it worth that recheck |
| **Ulundi** | KwaZulu-Natal, Zululand - former KwaZulu homeland capital | `ulundi.gov.za/awarded` (also has `/opentend`, `/closedtend`, `/intentiontoaward`, `/openreg`, `/quotations`) | **Reachable, real content - 83 entries, plain text (not JS-rendered)** | A genuine tender-status register spanning FY2022/23 through 2025/26, each row showing a bid number, title and status (Open/Closed/Intention to Award/Cancellation/Re-Invitation) - but **no bidder name and no award amount on this page**, so it's a status tracker, not the bidder+price award register section 11.6 is chasing (the actual award amounts would be in the linked PDFs, not checked this pass). Real construction/infrastructure relevance among the "Open" rows: hire of plant and equipment, civil-engineering contractor and consulting panels (3-year terms), MV/LV electrical reticulation, road maintenance material, electrical cable fault-finding. A real data-quality issue worth flagging before any reader: the same bid number recurs under different statuses in different years (`32/2022/2023` appears 5 times across Invitation/Re-Invitation/Cancellation/Open/Intention-to-Award) - the same class of duplicate-reference problem already seen at Necsa and Limpopo Public Works, not unique to this site |
| **Makana** (Grahamstown/Makhanda) | Eastern Cape, Sarah Baartman - university town | `makana.gov.za/category/tenders/` | **Reachable, but thin and poorly structured** | 10 entries on page 1 of (at least) 2, but these are mostly monthly PDF-bulletin posts ("Tenders October 2025", "Tenders August 2025") rather than individual structured tender rows - only 1 of the 10 carries a reference number in the listing itself (`MLM/2025-26/INFRA/011`, an erratum for a road upgrade), none shows a closing date. Real content exists but is locked inside the linked PDFs/sub-pages, not on the listing - not a clean reader candidate as found |
| **KwaDukuza** | KwaZulu-Natal, iLembe - coastal, real development activity (Ballito) | Guessed `kwadukuzamunicipality.gov.za` | **DNS failure on the guessed domain** - a wrong-URL guess, not confirmed as a genuinely dead municipality (same caveat the existing catalogs apply elsewhere - worth a proper search before concluding either way, not attempted further this pass) |

## What this means, ranked against the existing top picks

Doesn't change the existing ranking (Vaal Central Water Board has a built reader; uMngeni-uThukela
Water is the next recommended build; Overberg Water, IDC, Necsa and Limpopo Public Works are
confirmed NOT gaps). Where this pass's finds slot in:

1. **Ulundi** is the one genuine new candidate from this pass - real, plain-text, structured data,
   not JS-rendered, not a flat undated document archive (the Mbombela/Polokwane trap). But it's a
   status register, not a bidder+price award register, so it ranks below the existing Swartland/
   Saldanha Bay/Stellenbosch-tier pilots on value, and the real duplicate-reference issue needs
   deliberate handling (same discipline as every reader this session, not assumed away). Not yet
   cross-checked against eTenders - that's the next step before building anything, same as every
   other candidate in this whole scan.
2. **King Sabata Dalindyebo** - worth a real-browser recheck specifically because its site
   structure (separate Awarded Tenders page) suggests real award data might exist behind the
   JS rendering - genuinely unresolved, not ruled out.
3. **Makana** and **KwaDukuza** - not reader candidates as found this pass (thin/unstructured,
   and an unconfirmed domain respectively) - not ruled out permanently, just not worth further
   budget this round.

## Honest scope note

This is a 4-municipality direct sample, not the fuller ~15-20-municipality sweep used in the parallel
North West/Northern Cape/Limpopo-Mpumalanga-Gauteng pass running alongside it - Eastern Cape and
KwaZulu-Natal between them have ~65 more local municipalities nobody has checked yet (Amathole,
Chris Hani, Joe Gqabi, Alfred Nzo and most of Sarah Baartman in the Eastern Cape; most of Amajuba,
Harry Gwala, iLembe, uMgungundlovu, uMkhanyakude, uMzinyathi, uThukela and Zululand in KwaZulu-Natal).
Genuinely not exhausted - flagged plainly rather than implied otherwise.
