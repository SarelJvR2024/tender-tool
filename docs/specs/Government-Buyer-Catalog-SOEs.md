# State-Owned Enterprises and national public entities: a tender-reader catalog (20 Oct 2026)

Builds on `docs/strategy/Marketing-Pricing-Strategy.md` section 11.3 (TCTA, ACSA, SITA, SARS,
uMngeni-uThukela Water, Denel, Rand Water/PRASA already checked there) and this session's own work
tonight (`engine/discovery/randwater.py` built against a real saved page after Rand Water refused
every automated fetch attempt; uMngeni-uThukela Water re-confirmed reachable with real content).
Requested alongside two parallel catalogs (national/provincial departments, municipalities) as part
of a full scan of who could issue a tender in South Africa - this file covers the SOE/national-entity
slice specifically, since it's small enough (39 entities in the two most relevant PFMA schedules) to
actually verify properly rather than just list names.

**Source of the entity list**: National Treasury's own `PUBLIC INSTITUTIONS LISTED IN PFMA SCHEDULES
1, 2, 3A, 3B, 3C AND 3D, AS AT 21 NOVEMBER 2025` (https://www.treasury.gov.za/legislation/pfma/public%20entities/Archives.aspx,
PDF fetched and read directly - not a secondary source). This is the authoritative, current list -
confirms that several water boards named in this task's own brief (Bloem Water, Sedibeng Water,
Mhlathuze Water, Bushbuckridge Water) **no longer exist as separate PFMA entities**: South Africa's
water boards were consolidated into 7 regional boards (uMngeni-uThukela being the best-documented
merger, 2022). Chasing the old names would have been chasing entities that don't exist anymore.

## Schedule 2: Major Public Entities (21 entities)

Air Traffic and Navigation Services Company, Airports Company (ACSA), Alexkor, Armaments
Corporation of SA (Armscor), Broadband Infrastructure Company, CEF (Pty) Ltd, **DENEL**,
**Development Bank of Southern Africa (DBSA)**, **ESKOM**, Independent Development Trust (IDT),
Industrial Development Corporation (IDC), Land and Agricultural Bank, SA Broadcasting Corporation
(SABC), SA Forestry Company (SAFCOL), SA Nuclear Energy Corporation (Necsa), SA Post Office,
South African Airways, South African Express, Telkom SA, **Trans-Caledon Tunnel Authority (TCTA)**,
**Transnet**. (Bold = already has its own dedicated reader, or was already checked in the 11 Oct/17
Oct research passes.)

## Schedule 3B: National Government Business Enterprises (18 entities)

**Amatola Water Board**, Council for Scientific and Industrial Research (**CSIR**), Export Credit
Insurance Corporation, **Lepelle Northern Water**, **Magalies Water**, Mintek, Onderstepoort
Biological Products, **Overberg Water**, **Passenger Rail Agency of SA (PRASA)**, Public Investment
Corporation, **Rand Water**, SA Bureau of Standards (SABS), SASRIA, Sentech, Small Enterprise
Development Finance Agency, State Diamond Trader, **uMngeni-uThukela Water**, **Vaal Central Water
Board**. This schedule is where **every one of South Africa's current water boards** lives (7 of
them) - a complete, confirmed set, not a partial one.

**Out of scope for this file**: Schedule 1 (constitutional bodies - Public Protector, IEC, etc. -
not tender-issuing entities of the kind this product cares about), Schedule 3A (SETAs, museums,
regulators - overwhelmingly non-construction), Schedules 3C/3D (**provincial** public entities and
provincial government business enterprises - gambling/tourism/liquor boards, development
corporations - out of this file's SOE/national scope; flagged here for whoever picks up the
provincial-departments catalog, since 3C/3D are provincial *entities*, a different list from
provincial *departments*).

## Reachability and content, checked live tonight (20 Oct 2026)

Every row below was fetched directly, not guessed at. "Reachable" means a real response with real
tender data came back; every failure's exact error is recorded, since (per this session's own
established finding with Rand Water, and the earlier research's own finding for Engineering News/
News24) a 403/503/500/empty-shell each mean something different, and conflating them hides whether
a site is genuinely down versus blocking automated traffic specifically.

| Entity | Schedule | Own tender URL tried | Result | What it shows |
| --- | --- | --- | --- | --- |
| **Rand Water** | 3B | `bids.randwater.co.za/.../ViewPublishedBids.aspx` | Reachable by a real browser only - every automated tool (curl, WebFetch, the original research pass) blocked, 3 different ways (TLS chain error, HTTP 503 x2) | A dedicated reader (`engine/discovery/randwater.py`) exists, built against a real saved page, not yet confirmed to work from a GitHub Actions runner - see that module's own docstring and the reachability-test workflow already pushed tonight |
| **uMngeni-uThukela Water** | 3B | `umngeni-uthukela.co.za/tender/` | **Reachable, real content** (re-confirmed tonight) | Already documented as a confirmed gap vs eTenders (4 open tenders missing) - see Marketing-Pricing-Strategy.md section 11.3 |
| **Magalies Water** | 3B | `magalieswater.co.za/tenders/` | **Reachable, real content** | 2 entries visible tonight (`RFB/MW/ES-09/2026-27/01` Lichtenburg Water Scheme Intervention, `RFB/MW/SS-08/2026-27/01` Hartbeespoort Dam debris removal) - both closing dates already passed by the time of this check, so the live listing is thin right now, not necessarily representative |
| **Vaal Central Water Board** | 3B | `vaalcentralwater.co.za/advertised-tenders/` | **Reachable, real content - 9 tenders** | Real civil/water infrastructure work: potable water leak repairs (Maluti-a-Phofung), a steel by-pass pipeline + break pressure tank (Brandkop Reservoir), the Intabazwe Rising Main upgrade, WWTW refurbishment (Nyakallong/Allanridge), a WTW upgrade (Winburg) - clean reference numbers (`VCW###/...`), real closing dates. Not yet cross-checked against eTenders - that's the next step before building a reader, not assumed either way |
| **Overberg Water** | 3B | `overbergwater.co.za/index.php/procurement/open-rfps-rfqs` | **Reachable, real content - 6 open RFPs/RFQs** | Clean structured data, each with a real closing date AND compulsory briefing session date/time where applicable (`OW-019` tariff model review, `OW-020` smart meters, `OW-021` maintenance materials, `OW-022` plant/equipment hire, `OW-023` legal services, `OW-004` insurance broker). Mostly services/goods, not construction - still real, still not on eTenders by default assumption, not yet verified either way |
| **SA Nuclear Energy Corporation (Necsa)** | 2 | `necsa.co.za/tenders` | **Reachable, real content - 15 tenders** | Includes real engineering/construction-relevant work: `FIN-SCM-TEN-0246` (professional engineering services, Radioiodine API facility modification), `FIN-SCM-TEN-0242` (design and upgrade of a Grade C facility to cGMP Grade B), `FIN-SCM-TEN-0254` (core network infrastructure). The page itself flags its own data quality issue (one reference duplicated, two different references sharing an identical description) - worth building defensively around if this becomes a reader, the same way `randwater.py` refuses to silently drop data on an unexpected page count |
| **Lepelle Northern Water** | 3B | `lepelle.co.za/tenders` | **HTTP 503** | Unreachable tonight - same error class as the original research found for Rand Water, not confirmed whether transient or a standing block |
| **Amatola Water** | 3B | `amatolawater.co.za` (homepage, not just the tenders page) | **HTTP 500** | The *entire site* is down, not just one page - a genuinely broken server right now, different from a bot-blocking 403/503 |
| **SA Forestry Company (SAFCOL)** | 2 | `safcol.co.za/tenders` | **HTTP 503** | Unreachable tonight; SAFCOL's construction/engineering tender relevance is low regardless (forestry operations, not infrastructure) |
| **Passenger Rail Agency (PRASA)** | 3B | `prasa.com/tenders`, `prasa.com/Pages/Tenders.aspx` | **Effectively unreachable** - both URLs returned only a bare page title, no content, consistent with a JavaScript-rendered single-page app that a text-fetch tool can't execute | Matches the original research's own finding ("Rand Water, PRASA ... Not reachable from this environment") - re-confirmed tonight, same conclusion, different specific symptom |
| **Council for Scientific and Industrial Research (CSIR)** | 3B | `csir.co.za/tenders` | **Blocked by a login wall** | Tenders are genuinely not public here - a real "no", not a reachability failure to retry |

## What this means, ranked (building on Marketing-Pricing-Strategy.md section 11.7, not replacing it)

That section's own ranking already named uMngeni-uThukela Water as the clear top pick ("a small
job... adds the 4 open works and services tenders the portal lacks") and flagged Rand Water/PRASA as
needing a recheck. Updating with tonight's evidence:

1. **uMngeni-uThukela Water** - still the top pick, unchanged from before, confirmed reachable again
   tonight. Build this next (already recommended to Sarel this session).
2. **Vaal Central Water Board and Overberg Water** - both newly confirmed reachable tonight, both
   with real, clean, structured listings (9 and 6 entries respectively). Vaal Central is the more
   construction-relevant of the two (pipelines, WWTW/WTW refurbishment). **Neither has been
   cross-checked against eTenders yet** - that's the real next step before claiming a gap, not
   something to assume from reachability alone. Worth that check before committing to a reader.
3. **Necsa** - reachable, real engineering-relevant tenders, but a narrower, more specialised buyer
   (nuclear/radiochemistry facilities) than this product's core SANRAL-adjacent customer base. Lower
   priority than the water boards unless Sarel's own customer mix suggests otherwise.
4. **Magalies Water** - reachable and parseable, but the live listing was thin (2 entries, both past
   closing) at the moment checked - worth re-checking at a different time before judging its real
   tender volume, not enough evidence yet either way.
5. **Rand Water** - reader already built (`engine/discovery/randwater.py`), reachability from a real
   scheduled run still unconfirmed - see the dedicated reachability-test workflow already pushed.
6. **Don't build yet, not a capability gap**: Lepelle Northern Water and SAFCOL (both 503 tonight -
   re-check later, don't build against an unreachable site); Amatola Water (the whole site is down,
   not a reader problem); PRASA (JS-rendered, needs a different approach - likely a headless browser
   or finding an underlying API, not a plain HTML parse - bigger job, not attempted here); CSIR
   (genuinely not public).

## What wasn't checked, named rather than silently skipped

The remaining Schedule 2 entities (ATNS, Alexkor, Armscor, Broadband Infrastructure Company, CEF,
IDT, IDC, Land Bank, SABC, SA Post Office, SAA, SA Express, Telkom) and Schedule 3B entities
(Export Credit Insurance Corp, Mintek, Onderstepoort Biological Products, Public Investment Corp,
SABS, SASRIA, Sentech, Small Enterprise Development Finance Agency, State Diamond Trader) were not
individually checked tonight - most are a poor fit for this product's construction/engineering/
consulting customer base (airlines, broadcasters, a diamond trader, financial institutions, a
telecoms carrier) and checking all 39 properly, the way the 10 above actually were, would have
meant far shallower verification across the board. Worth a pass later only if Sarel's own customer
base broadens beyond engineering/construction/built-environment work.
