# Provincial government departments: a reachability + content catalog (20 Oct 2026)

Closes the gap `docs/specs/Government-Buyer-Catalog-National-Provincial.md` explicitly left open:
that file catalogued the common ~12-13 department portfolio template every province follows, but
checked zero provincial department tender pages live (out of scope for that pass). This file does
that check, scoped to the most construction-relevant portfolio in every province - Public Works
(sometimes combined with Transport and/or Roads, naming varies by province) - since that's where
the real budgets and the real civil/engineering work sit.

**Method, same discipline as the sibling SOE catalog**: search for the real official URL first
(the national/provincial catalog's own finding - "3/3 blind URL guesses failed for municipalities"
- held again here: several guessed URLs 404'd), then fetch it, and record the exact result.
"Human Settlements" (the third construction-relevant portfolio named in the brief) was **not**
separately checked - finding each province's real Public Works URL alone took most of this pass's
fetch budget; flagged here rather than silently skipped.

## Results, all 9 provinces

| Province | Department (real current name where found) | URL tried | Result |
| --- | --- | --- | --- |
| **Limpopo** | Public Works, Roads and Infrastructure | `dpw.limpopo.gov.za/pages/advertised_tenders.php` | **Reachable, real content - 21 entries** (see below) |
| Eastern Cape | Public Works and Infrastructure | `ecdpw.gov.za` | Reachable, but its Tenders link only surfaces a stale 2022 PDF "bid book" banner - no current structured listing found |
| Western Cape | Infrastructure (combines Transport + Public Works, confirmed via its own site) | `westerncape.gov.za/department-of-infrastructure` | Reachable, but no real tender data on the page itself - a Tenders menu link and the same kind of stale PDF banner as Eastern Cape. The province's own general tenders page (`westerncape.gov.za/tenders`) says "content last updated 16 April 2021"; a newer "interim" tenders URL mentioned in a third-party repost 404'd |
| North West | Public Works and Roads | `nwpg.gov.za/Public Works/Pages/Tenders.aspx`, `.../Pages/default.aspx` | Both guessed listing pages **404**. Real tender/award PDFs genuinely exist on this domain (confirmed via search - e.g. `PWR 14-25 ADVERT.pdf`, monthly award lists) under `/Public Works/Documents/SupplyChain/`, but no browsable listing page (vs. a raw document folder) was found this pass |
| KwaZulu-Natal | Transport | `kzntransport.gov.za` | **HTTP 503** |
| Northern Cape | Roads and Public Works | `ncrpw.ncpg.gov.za` | **HTTP 503** |
| Gauteng | Infrastructure Development (and Property Management) | `gauteng.gov.za/Departments/DepartmentDetails/CPM-001008` | **HTTP 404** on direct fetch (search had indexed a cached version of this page with department info, but no tenders content, and the live fetch failed outright) |
| Free State | Community Safety, Roads and Transport (renamed from "Police, Roads and Transport" - confirmed via a Nov 2025 tender repost) | No official domain found via search | **Not checked** - every search result was a third-party aggregator (TenderFlow); real reference-number prefix confirmed (`CSR&T/BID`) but no official fs.gov.za-style URL surfaced to try |
| Mpumalanga | Public Works, Roads and Transport | No official domain found via search | **Not checked** - same situation as Free State, no official URL surfaced despite several search attempts |

## The one real finding: Limpopo Department of Public Works, Roads and Infrastructure

`dpw.limpopo.gov.za/pages/advertised_tenders.php` - genuinely reachable, a real structured table,
21 entries visible (page 1 of what's likely 2-3 pages). Sample of what's there: a validity
extension for mobile toilet servicing across five districts (`LDPWRI-B/20646`, closing 31 Jan
2027), and six near-identical office-accommodation acquisition tenders across different towns
(Soekmekaar, Phalaborwa, Polokwane, Seshego, Molemole, Lephalale, Modimolle - `LDPWRI-P/206xx`
series, 9-year-11-month terms, closing 30 Oct 2026). The page itself has a minor data-quality
issue worth knowing about before building a reader: row 8 and row 9 share an identical reference
number (`LDPWRI-P/20680`, Lephalale) - the same kind of real-world duplication `Necsa`'s listing
showed in the sibling SOE catalog, not unique to this site.

**Not yet checked**: whether any of these 21 tenders are already on eTenders (the standard check
every candidate needs before being called a real gap - not assumed either way here), and whether
there's a separate awards/price register on the same domain (the higher-value find per
`Marketing-Pricing-Strategy.md` section 11.6).

## What this means, ranked against the existing top candidates

Doesn't displace anything already ranked ahead of it. Positioned here:

1. uMngeni-uThukela Water, Vaal Central Water Board, Overberg Water - unchanged, still ranked
   ahead (confirmed gaps or stronger construction relevance, found in earlier passes tonight).
2. **Limpopo Public Works, Roads and Infrastructure - new candidate, slots in alongside Necsa**:
   reachable, real, structured, genuinely construction/property-relevant content, but (like Necsa)
   not yet cross-checked against eTenders for a confirmed gap. Worth that check before building a
   reader, same as every other candidate in this whole scan.
3. Everything else checked this pass (Eastern Cape, Western Cape, North West, KZN, Northern Cape,
   Gauteng) - **not a reader candidate right now**, either because there's no real current listing
   to read (EC/WC) or because the site is unreachable tonight (NC/KZN/GP) or a real listing page
   couldn't be located (NW). None of these are confirmed dead ends - EC/WC/NW in particular likely
   have real content somewhere on their domains that a longer search would surface (NW's own PDF
   award lists prove real data exists there) - just not found within this pass's scope.
4. Free State and Mpumalanga - **genuinely unchecked**, not even attempted, since no official URL
   could be found via search at all. A different kind of gap from "blocked" - these need a human
   with local knowledge (or a direct ask to Sarel, who may already know these department sites) to
   supply the real URL before any reachability check is possible.
