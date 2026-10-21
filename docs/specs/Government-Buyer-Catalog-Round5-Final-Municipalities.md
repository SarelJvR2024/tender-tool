# Municipality catalog, round 5 (remaining unconfirmed) - 21 Oct 2026

Bounded follow-up (~20 min) closing out the "real activity, no official URL confirmed" flag left by
`Government-Buyer-Catalog-Round4-Final-Sweep.md` for 8 municipalities: Makana, King Sabata
Dalindyebo, Enoch Mgijima, Abaqulusi, Maluti-a-Phofung, KwaDukuza, Alfred Duma, Ngwathe. This pass
used web search plus direct fetches of guessed/discovered domains - no reader code written, research
only.

## Results

| Municipality | Real URL found | Result | eTenders overlap |
| --- | --- | --- | --- |
| **Makana** | Not found - `makana.gov.za` does not resolve (DNS failure, confirmed by direct fetch, not a guess) | **No official site reachable at all.** Only third-party aggregator listings exist (one getvuza.com entry for tender MLM-2025-26-INFRA-017, already closed) | Not checked - no own-site to compare against |
| **King Sabata Dalindyebo** | Not found | **No official domain surfaced** in search results at all - every hit is a third-party aggregator (tenderflow.co.za institution page EC157, getvuza.com). One listing mentions bidders can get documents from "the KSD Municipality website" but never names it | Not checked |
| **Enoch Mgijima** | Not found (own domain `enochmgijima.gov.za` exists only as an email contact domain in aggregator listings, never confirmed as a working tenders page - no working URL attempted-and-reachable this pass) | **Could not confirm a reachable own-site tenders page.** All real-looking tender numbers (SCM20/04/2026, SCM21/04/2026, etc.) come from bidsstack.com/getvuza.com, not the municipality's own site | Not checked |
| **Abaqulusi** | `www.abaqulusi.gov.za/tenders` - **confirmed reachable** (unlike the other 7, this one is a real, live, reachable municipal domain) | **Partial finding, not resolved this pass.** The `/tenders` page itself is a real, current (2026 copyright) site with a proper nav structure, but the actual listing is split across sub-category links ("Quotations", "Tender Adverts", "Tender Erratums", "Tender Openings", etc.) rendered as placeholder `#` hrefs in the fetched snapshot - the real sub-URLs weren't captured. Two guessed sub-paths (`/tender-adverts`, `/business/tenders/tender-adverts`) both 404'd. **Needs a follow-up pass that finds the real sub-page URLs (e.g. by loading the live page in a browser, not guessing paths) before this can be ruled in or out** | Not checked (blocked on reaching real listing data) |
| **Maluti-a-Phofung** | Not found | **No official domain surfaced.** Aggregators (tenderflow.co.za, getvuza.com) show real-looking current tenders (auctioneering services closing 22 Oct 2026, office furniture closing 1 Oct 2026) but no confirmed own-site URL | Not checked |
| **KwaDukuza** | Not found reachable this pass (own domain referenced only in old notices/contact emails as `www.kwadukuza.gov.za`; a direct guess at `/tenders/` returned HTTP 404) | **Domain exists per historical references but the guessed tenders path doesn't resolve.** Real current-looking tenders exist per aggregators (MN 95/2026, Sokesimbone road/stormwater, closing 08 Oct 2026) | Not checked |
| **Alfred Duma** | Not found reachable this pass (own domain `alfredduma.gov.za` confirmed only via contact emails in aggregator listings; a direct guess at `/tenders` returned HTTP 404) | **Domain exists, guessed tenders path doesn't resolve.** Aggregators show real current tenders (PS 08/2026 workshop management system, DF-05-2026 fuel supply closing 1 Oct 2026) | Not checked |
| **Ngwathe** | Not found (own domain referenced as `ngwathe.co.za` in one contact email, not fetched this pass) | **Unconfirmed, and a serious caveat**: Wikipedia reports a June 2025 Free State High Court order dissolving the municipality - its tendering status/authority right now is genuinely unclear, not just a missing-URL problem | Not checked |

## What this adds

None of the 8 produced a confirmed reachable, structured, closing-dated **own-site** listing this
pass - a materially different (worse) result than round 4's three strong finds (Lephalale, Msukaligwa,
Kouga). The one partial exception is **Abaqulusi**: its domain is real, live, and has a genuine
Tenders section in its nav, but the actual per-tender data lives behind sub-page URLs not captured
in this pass's snapshot fetches - worth one more targeted look, not a dead end.

For the other 7, every single data point (tender numbers, closing dates, descriptions) available
right now comes from third-party aggregators (tenderflow.co.za, getvuza.com, bidsstack.com,
safcec.org.za) - exactly the kind of source this project has deliberately avoided building readers
against, since aggregator freshness/accuracy can't be verified the way a municipality's own page can.

## Ranked candidates

1. **Abaqulusi** - the only one with a confirmed-live own domain and a real Tenders nav section.
   Needs one more pass to find the actual sub-page URLs (try loading the live page with a real
   browser/JS-capable fetch rather than guessing paths - the same "landing page is a JS shell, real
   listing is one level deeper" shape Kouga had).
2. **KwaDukuza, Alfred Duma** - domains are real (confirmed via contact emails on real-looking
   tender notices) but the specific tenders-page path wasn't found this pass - same follow-up
   approach as Abaqulusi would likely work.
3. **Enoch Mgijima, Maluti-a-Phofung, King Sabata Dalindyebo** - no own domain surfaced in search
   at all this pass; would need a dedicated domain-discovery step (e.g. checking the municipality's
   own official social media or provincial government directory) before even attempting a fetch.
4. **Makana** - ruled out: its own domain does not resolve at all (DNS failure). Not a reader
   candidate unless that changes.
5. **Ngwathe** - not just unconfirmed but genuinely uncertain in status given the reported 2025
   court-ordered dissolution; needs clarification on who is actually issuing tenders before any
   technical work would make sense.

This closes out the "not reached this pass" list from round 4 - all 8 have now been looked at, even
though only one (Abaqulusi) is a live follow-up candidate. Recommend treating remaining municipality
discovery as done for now unless a human points at a specific additional lead; the two bigger, proven
candidates from round 4 (Lephalale, Kouga) are already built, and diminishing returns are setting in
on this specific research method (web search + URL guessing) the way they already did for phase 2's
sampling.
