# National and provincial government buyer catalog (20 Oct 2026)

Sarel asked for a comprehensive scan of every government/SOE/other body that could issue a
tender for suppliers, contractors, vendors or consultants - scope confirmed as "everything"
(national + provincial departments + SOEs + all ~257 municipalities), for both finding new
reader candidates AND as a standing reference catalog. **This file covers national and
provincial government departments only** - two other forks were dispatched in parallel for
SOEs/parastatals and municipalities; see those files for the rest of the full scan. All three
together are the complete answer to Sarel's request.

**Companion documents, already in this repo:** `Government-Tender-Coverage-Findings.md` (what's
actually built - the 8 sources `gov_sources.py` reads today) and
`../strategy/Marketing-Pricing-Strategy.md` section 11 (the research this catalog extends -
section 11.1's own finding, worth repeating here since it governs everything below: **"for every
buyer subject to the PFMA, eTenders already is the source"** - a 2015 National Treasury
instruction, reinforced by PFMA SCM Instruction 09 of 2022/23, requires every national/provincial
department, public entity and SOE to publish on eTenders. The real gaps found so far are water
boards and RFQ-level procurement below the formal-bid threshold, not whole departments missing
from the portal).

## The headline finding from this pass: most national department sites refuse automated access

Before cataloging names, the more actionable finding: of 3 national departments' own tender
pages tried directly this pass (Public Works and Infrastructure, Water and Sanitation,
Transport), **none were reachable by an automated fetch** -
`publicworks.gov.za` (both its root and `/Tenders.html`) returned **HTTP 503**, `dws.gov.za/Tenders/`
returned **HTTP 403**, and no working `transport.gov.za` tenders URL could even be found via
search. This is the same pattern already confirmed this session for Rand Water (503 from three
separate automated tools) and already documented in the Marketing-Pricing-Strategy research for
Engineering News (403) and News24 (Cloudflare challenge) - **not a one-off, a systemic pattern
across South African government web infrastructure.** A real browser likely works fine for all
three (per the Rand Water precedent), but that's not something this pass could confirm without
access to one.

**What this means for build priority:** even where a national/provincial department DOES publish
something beyond eTenders (section 11.1 already names water boards as the real exception, not
whole departments), building a direct reader for it faces the same reachability fight as Rand
Water for every single one - a fight only resolved per-site, by hand, with a real browser and a
human willing to try. This makes a broad sweep of national/provincial department readers a poor
use of effort compared to the already-identified, already-reachable water-board targets
(uMngeni-uThukela Water, confirmed reachable this session) and the award/price-register pilot
(Swartland, Saldanha Bay) the research already recommends building first.

## 1. National departments

Compiled from the current national government portfolio structure (post-2024 Government of
National Unity Cabinet). **Not independently verified against a live, current source this
pass** - the standard caveat that applies to any list of this kind: department names, splits and
mergers do shift with cabinet reshuffles, and this pass's own attempts to verify the three
sampled departments' tender pages were blocked before reaching the point of confirming anything
about departmental structure itself. Treat department boundaries as "best known, not freshly
confirmed" - the names below are stable, well-documented portfolios, not a guess.

Construction/engineering-relevant departments (the ones that actually matter for this product's
customer base) are **bolded**.

| # | Department | Procures (one line) |
|---|---|---|
| 1 | The Presidency | Coordination, communications, minimal direct procurement |
| 2 | Planning, Monitoring and Evaluation | Research, M&E services |
| 3 | Women, Youth and Persons with Disabilities | Grants, programme services |
| 4 | Defence | Equipment, facilities, logistics - large but highly specialised/security-cleared |
| 5 | Police (SAPS) | Vehicles, equipment, **stations and facilities (construction-relevant)** |
| 6 | State Security | Minimal public procurement visibility |
| 7 | Justice and Constitutional Development | Court facilities, IT, legal services |
| 8 | Correctional Services | **Facilities (construction-relevant)**, catering, security equipment |
| 9 | Home Affairs | IT systems, **offices/facilities** |
| 10 | Cooperative Governance | Municipal support programmes, disaster relief |
| 11 | Traditional Affairs | Minor, often combined administratively with #10 (CoGTA) |
| 12 | Public Service and Administration | Internal systems, training |
| 13 | **Public Works and Infrastructure** | **Government buildings, facilities management, property - directly construction/engineering relevant. Own site unreachable this pass (503), not verified** |
| 14 | Finance (National Treasury) | Financial systems; also runs eTenders itself |
| 15 | Trade, Industry and Competition | Industrial support programmes |
| 16 | Small Business Development | Grants, SMME support |
| 17 | Employment and Labour | IT systems, inspectorate operations |
| 18 | Mineral and Petroleum Resources | Mining regulation, **mine-site infrastructure** |
| 19 | Electricity and Energy | Energy programmes, **grid-related infrastructure** - split from #18 in the 2024 GNU restructuring |
| 20 | Communications and Digital Technologies | IT, broadcasting infrastructure |
| 21 | Tourism | Marketing, minor facilities |
| 22 | Agriculture | Research facilities, extension services |
| 23 | Land Reform and Rural Development | **Rural infrastructure, land surveying** |
| 24 | Forestry, Fisheries and the Environment | Conservation, **environmental infrastructure** |
| 25 | **Water and Sanitation** | **Dams, pipelines, bulk water infrastructure - directly construction/engineering relevant. Has its own real tender archive (`dws.gov.za/Tenders/`, real PDF adverts found via search) but blocked this pass (403), not verified live** |
| 26 | **Transport** | **Roads, rail, ports, aviation infrastructure - directly construction/engineering relevant.** No working own-site tenders URL found this pass; provincial transport departments appear to have their own sites (see below) |
| 27 | **Human Settlements** | **Housing construction - directly construction/engineering relevant.** No national-level own tender page found this pass (only a Western Cape provincial one, itself possibly stale - last updated 2023) |
| 28 | Science, Technology and Innovation | Research grants, facilities |
| 29 | Basic Education | **School infrastructure** (often delegated to provincial education depts) |
| 30 | Higher Education and Training | **Campus infrastructure**, bursaries |
| 31 | Health | **Hospital/clinic infrastructure** (often delegated to provincial health depts), medical supplies |
| 32 | Social Development | Grants administration, social facilities |
| 33 | Sport, Arts and Culture | **Sports/cultural facilities**, programme funding |
| 34 | International Relations and Cooperation (DIRCO) | Embassies, diplomatic facilities abroad |
| 35 | Military Veterans | Support services, housing programmes |
| 36 | Government Communication and Information System | Internal communications services |

~36 national departments, consistent with the earlier research's own "~40" estimate (the exact
count moves with every cabinet reshuffle - boundary departments like Traditional Affairs and GCIS
are sometimes counted separately, sometimes folded into a parent department's own procurement).

## 2. Provincial departments

Every one of South Africa's 9 provinces (Eastern Cape, Free State, Gauteng, KwaZulu-Natal,
Limpopo, Mpumalanga, Northern Cape, North West, Western Cape) runs its own version of a similar
~12-13 department portfolio structure, mirroring the national cluster above at provincial scale.
**Exact department names and groupings differ by province** (e.g. Western Cape combines
Transport and Public Works into one department; KwaZulu-Natal keeps them separate; Gauteng has a
standalone Infrastructure Development department) - a precise, verified name for each of the
roughly 110 individual province x department combinations needs per-province confirmation, out of
scope for this pass (the brief explicitly said not to deep-check all ~120 entities). What's
reliable without that per-province work is the common portfolio template every province follows:

| Common provincial portfolio | Construction/engineering relevant? |
|---|---|
| Office of the Premier | No |
| Provincial Treasury | No (runs provincial-level eTenders oversight) |
| Cooperative Governance and Traditional Affairs | Minor (municipal support) |
| Economic Development / Tourism / Environmental Affairs (naming varies) | Minor |
| Education | **Yes (school infrastructure)** |
| Health | **Yes (clinic/hospital infrastructure)** |
| Social Development | No |
| Agriculture / Rural Development / Land Reform (naming varies) | **Yes (rural infrastructure)** |
| **Public Works** (sometimes "...and Infrastructure" or "...and Roads") | **Yes - directly** |
| **Transport** (sometimes combined with Public Works) | **Yes - directly** |
| **Human Settlements** | **Yes - directly** |
| Sport, Arts and Culture | Minor (facilities) |
| Community Safety / Police Oversight | Minor |

One confirmed real lead from the earlier research, worth repeating here since it's the one
provincial-level finding anyone actually verified live: **KwaZulu-Natal's Provincial Treasury**
runs its own SharePoint site (Advertisements, Awards, Closed Tenders, "Publication of Bidders",
Cancellations - all PDF links) and its two current bids were BOTH also on eTenders, so it adds
no new listings - only value is in the award/bidder-list PDFs, same pattern as the price-register
opportunity described in the companion research doc's section 11.6.

**Reachability, same caveat as the national list:** no provincial department tender page was
tried directly this pass (out of scope per the brief - deep-checking was reserved for the
national sample above). Given 3 of 3 national attempts failed, there's no reason to expect
provincial sites behave differently; if anything, smaller provincial IT budgets likely mean worse
reachability, not better. Treat every provincial department as "unverified, probably blocked
the same way" until someone actually tries one from a real browser.

## 3. What this means for build priority (the actual decision this catalog should drive)

**Don't build direct readers for national/provincial departments next.** Three separate reasons,
all from real evidence gathered this pass and the companion research:

1. **eTenders already covers them** (section 11.1's own confirmed finding - the PFMA mandate
   works for formal bids). The exceptions found so far are water boards and sub-eTenders-threshold
   RFQs, not whole departments.
2. **Reachability is a real, confirmed fight**, not a theoretical risk - 3 of 3 department sites
   tried this pass were blocked, matching Rand Water's own pattern exactly.
3. **Higher-value, already-reachable targets exist and are ranked ahead of this** in the
   companion research: uMngeni-uThukela Water (confirmed reachable, confirmed gap, called "a
   small job") and the Swartland/Saldanha Bay award-register pilot (confirmed reachable, the
   single highest-value find - every bidder's name AND price, something no paid competitor
   offers either).

If a specific department becomes worth checking later (e.g. Sarel names one with a known direct
relationship or a known gap), check it the same way Rand Water was checked - from a real browser
first, HTML shared for an offline-built-and-tested reader second - rather than guessing at a
reader's structure blind.
