# Municipality buyer catalog, round 3: KwaZulu-Natal and Free State (20 Oct 2026)

Extends the two prior municipality catalog files and `Marketing-Pricing-Strategy.md` section 11.6,
which together already covered these KZN/FS entities: eThekwini, Msunduzi (both metros, confirmed
unreachable, HTTP 503), Newcastle (loaded, in the original 42-sample), uMhlathuze (reachable, real
content), Mangaung (metro), Matjhabeng (confirmed genuinely dead domain), Metsimaholo (reachable but
empty/unclear). This pass checks 11 NEW, not-yet-checked municipalities across the two provinces'
remaining districts, prioritising towns with real economic/construction activity (coastal/port,
industrial, provincial-capital-adjacent, agricultural-hub). No municipality named above is repeated
here.

**Yield was low this round** - lower than prior rounds' already-thin hit rate. Of 11 checked, only
2 produced a confirmed-reachable official page with real content, and both came with real caveats
(one all-stale, one a flat-document-archive like Mbombela/Polokwane). This is itself useful
information: the "easy" KZN/FS municipalities were likely already surfaced in the original 42-sample
and earlier rounds; what's left skews toward sites genuinely hard to find or reach from this
environment.

## Results

| Municipality | Province / district | Official URL found? | Result | What it shows |
| --- | --- | --- | --- | --- |
| **uMngeni** (Howick) | KwaZulu-Natal, uMgungundlovu | `umngeni.gov.za/open-tenders/` (confirmed; a `/current-tenders/` guess 503'd first) | **Reachable, real content - 8 tenders on page 1 of 3** | Panel appointments (electrical consultants, town planners), IT (VoIP/internet, Adobe licensing), two long-term leases (a gorge-walk tourism concession, a restaurant at Howick Falls). **All 8 closing dates have already passed** (most recent 12 Oct 2026) - real content, but a stale snapshot, not a confirmed-currently-open listing; would need a recheck closer to a genuinely upcoming closing date |
| **Setsoto** (Ficksburg/Senekal) | Free State, Thabo Mofutsanyana | `setsoto.gov.za` (posts under a "Community" category) | **Reachable, real content** - real road-construction tenders (Ficksburg CBD resurfacing, Meqheleng road reconstruction/stormwater), panel appointments (electrical, water/sanitation engineering consultants) | **Same structural problem as Mbombela and Polokwane's tender-documents page**: a flat PDF-per-post archive under a WordPress category, not a dated table - the closing date (where present) is only inside the file name or the PDF itself, not a structured field on the listing. Not a clean reader candidate for the same reason those two aren't |
| **Ray Nkonyeni** (Port Shepstone) | KwaZulu-Natal, Ugu | `rnm.gov.za/index.php/opportunities/tenders/current-tenders` (confirmed via search) | **Blocked - HTTP 403** | A real, confirmed official URL (not a guess) refused outright - a different failure class from a 503 (server overload) or a 404 (wrong path); worth a second attempt from a different network before writing it off, same caveat as Rand Water's own blocking pattern |
| **Dihlabeng** (Bethlehem) | Free State, Thabo Mofutsanyana | `dihlabeng.gov.za/strategic-documents/bid-documents` (confirmed via search, National Treasury filings corroborate the domain is real) | **Blocked by this session's own egress proxy** (`connect_rejected`, "the host is not allowed for this session") - NOT a site-down or DNS failure | A fourth distinct failure class this research has now found (alongside 503, DNS-NXDOMAIN, and Rand Water's TLS-chain error): the proxy itself refused the connection, which says nothing about whether the real site is reachable. Needs a recheck from an environment whose egress isn't restricted this way, not ruled out |
| **Abaqulusi** (Vryheid) | KwaZulu-Natal, Zululand | Not confirmed - `abaqulusi.gov.za` appears to be the real domain (staff email addresses reference it) but no tenders page URL was found via search | Real tender activity exists per third-party aggregator (getvuza) - road rehabilitation (3 Vryheid streets, R15-25m range), stock/cable supply contracts - but not independently confirmed on the official site | Same "real activity, no confirmed own-site page" pattern as several Round 2 findings (Thabazimbi, Mahikeng, Gamagara) |
| **Maluti-a-Phofung** (Phuthaditjhaba/Qwaqwa) | Free State, Thabo Mofutsanyana | Not found via search | Real tender activity per aggregators (PPE panel, auctioneering, wastewater works, landfill management, security) - notably, this is the SAME municipality Vaal Central Water Board's own `VCW380/PWLPLM/24` tender (potable water leak repairs) is being contracted to do work IN, i.e. VCW does infrastructure work for this municipality's area - but Maluti-a-Phofung's own procurement site wasn't located | Context link to an already-built reader, not a reader candidate itself this pass |
| **KwaDukuza** (Ballito/Stanger) | KwaZulu-Natal, iLembe | Not found via search | Real activity per aggregators (road/stormwater rehabilitation ~R12m, infrastructure contractor panel, banking services) but all closing dates already past and no official site confirmed | Coastal/high-growth area (Ballito) - worth a future targeted recheck given its economic profile |
| **Alfred Duma** (Ladysmith) | KwaZulu-Natal, uThukela | Not found via search | Real activity per aggregators (vehicle spares/mechanical panels, civil engineering consultants for roads/stormwater) but no official site confirmed, all dates past | - |
| **Ngwathe** (Parys) | Free State, Fezile Dabi | Not found via search | Real activity per TenderFlow (Edenville municipal offices construction, Heilbron reservoir telemetry, oxidation pond upgrade) but no official site confirmed. Separately: the municipality is in serious financial distress (news report: R2.7bn Eskom debt, 6% payment rate as of Sept 2025) - a solvency red flag worth knowing regardless of reader-building | - |
| **Mtubatuba** | KwaZulu-Natal, uMkhanyakude | Not found via search | No municipal tender activity found at all (the one real hit was a KZN provincial Public Works tender physically located in Mtubatuba, not this municipality's own procurement) | Weakest finding this round - genuinely little signal either way |
| **Nala** (Bothaville) | Free State, Lejweleputswa | Not confirmed - `nala.org.za` guessed from a contact email domain, not verified live | One aggregator listing (`NLM/TS/002/2026-27`, sports-facility fencing) marked "Open" with a deadline that has already passed - stale | Weak signal, low volume regardless |

## What this adds

11 KZN/Free State municipalities checked, bringing this research's total municipality coverage to
roughly 78 of 257. **Zero new clean reader candidates** came out of this round - the two reachable
results (uMngeni, Setsoto) both have real structural problems (stale-only content, and a flat
document archive with no dated field, respectively) that rule them out the same way Mbombela and
Polokwane's tender-documents page were ruled out in
`Government-Buyer-Catalog-eTenders-Overlap-Checks.md`. One genuinely new and useful finding instead:
a **fourth distinct failure class** - this session's own egress proxy refusing a connection outright
(Dihlabeng), different from a site's 503, a DNS NXDOMAIN, or Rand Water's TLS-chain error. Ray
Nkonyeni's 403 on a confirmed-real URL (not a guess) is also worth a flagged recheck.

## Ranked candidates, positioned against the existing picture

Nothing from this round beats or changes the existing priority order
(`Government-Buyer-Catalog-eTenders-Overlap-Checks.md`'s own conclusion: Vaal Central Water Board is
built; nothing else checked so far is a clean next reader). Where this round's finds slot in, if
anyone revisits them later:

1. **Ray Nkonyeni and Dihlabeng** - both have a confirmed-real official URL blocked for a reason
   that has nothing to do with whether the site itself has good data (a 403, and a proxy-level
   rejection respectively) - worth a retry from a different environment before concluding anything
   either way, ahead of the "no URL found at all" group below.
2. **uMngeni and Setsoto** - confirmed reachable, confirmed real, but neither is reader-buildable as
   found (stale-only / undated-archive). Not ranked as candidates; flagged for context only.
3. **Abaqulusi, Maluti-a-Phofung, KwaDukuza, Alfred Duma, Ngwathe** - real underlying activity per
   third-party aggregators, no official site located this pass. Same "needs a human with local
   knowledge, or a longer search, to find the real URL" category as several Round 2 entries.
4. **Mtubatuba, Nala** - weakest signal this round, lowest priority of anything checked.
