# State-Owned Enterprises and national public entities: round 2 (20 Oct 2026)

Extends `Government-Buyer-Catalog-SOEs.md` (which checked 10 of 39 PFMA Schedule 2/3B entities
live) to the remaining entities that file's own "what wasn't checked" section named. Selective,
not exhaustive, per that file's own reasoning: entities with no plausible construction/
engineering/consulting angle (airlines, broadcasters, telecoms, financial institutions, a diamond
trader) are confirmed-and-skipped with a one-line reason, not silently dropped, rather than
wasting a fetch proving the obvious.

## Checked live this round

| Entity | Schedule | Result | What it shows |
| --- | --- | --- | --- |
| **Industrial Development Corporation (IDC)** | 2 | **Reachable, real content - 100+ tenders**, a structured list going back to March 2025 | The single best new finding this round. Most entries are financial/consulting/advisory (valuations, audits, transaction advisory - IDC is a development finance institution, so this fits its actual business), but a real, non-trivial construction/infrastructure-feasibility subset exists: transaction advisor for Pilanesberg International Airport redevelopment (T57/10/2026), feasibility studies for Sasolburg/Oppitoppi reservoirs, Leandra landfill, Boegoebaai port (Northern Cape), Coega Automotive Park masterplan, a green hydrogen infrastructure roadmap, plus direct physical works (office renovations, electrical maintenance, BMS/AV installation work). **Not yet cross-checked against eTenders** - IDC's own tenders may well already be there (National Treasury-bound entity), that check is the next step before calling this a gap, not assumed either way. Page only read to character 100,000 of 193,850 - more history exists beyond what's captured here |
| **Independent Development Trust (IDT)** | 2 | **Reachable, but empty right now** | Real site, real tender/RFQ/awarded-tenders page structure (`idt.org.za/advertised-tenders-3/`, `/rfq/`, `/awarded-tenders-3/`), but all three pages returned no visible entries at the moment checked - either genuinely nothing open right now, or the listing loads dynamically and a plain fetch can't see it (inconclusive, not confirmed either way). Context worth knowing: IDT's own published SCM policy says it advertises construction bids on the CIDB i-Tender site, its own website, AND eTenders - so even a working IDT page would likely duplicate eTenders, same conclusion ATNS reached below. IDT has also been in the news for a serious 2025 procurement-fraud finding (an oxygen-plant tender) - unrelated to reachability, just context if the name comes up |
| **Air Traffic and Navigation Services (ATNS)** | 2 | Reachable via aggregators only, not confirmed on `atns.co.za` itself | Real recent tenders exist (flight progress strips, ICT equipment, fleet vehicle leasing, radar tools) but every one explicitly routes through the National Treasury eTender portal in its own listing text - this is a duplicate of eTenders, not a gap. Also low construction relevance (equipment/goods/services, not infrastructure) |
| **Armscor** | 2 | Not checked on `armscor.co.za` directly; third-party listings only | Recent real tenders found (mobile air compressors, tallow/pine wood, a portable X-ray tube) are all goods procurement for its Dockyard facility, not construction/engineering/consulting work. Low relevance regardless of reachability |

## Confirmed-and-skipped, not silently dropped

No fetch attempted - each has an obvious, low-value profile for a construction/engineering/
consulting tender-discovery product:

- **SA Post Office, South African Airways, South African Express, Telkom SA, SA Broadcasting
  Corporation (SABC), Sentech** - airline, postal, telecoms and broadcast-infrastructure operators;
  their own procurement is overwhelmingly IT/logistics/media, not construction
- **Land and Agricultural Bank, Export Credit Insurance Corporation, Public Investment
  Corporation, SASRIA, Small Enterprise Development Finance Agency, State Diamond Trader** -
  financial institutions and an insurer; procurement is corporate services (IT, legal, audit), not
  construction/engineering
- **SA Bureau of Standards (SABS), Mintek, Onderstepoort Biological Products** - standards/
  research bodies; some facilities maintenance procurement plausible but low volume and not this
  product's customer base
- **Alexkor, CEF (Pty) Ltd, Broadband Infrastructure Company** - a diamond mining company, an
  energy holding company, and a broadband infrastructure SPV; none large enough or public enough
  in their own procurement footprint to be worth a dedicated reader check this round

## Where this slots into the existing ranking

Doesn't change the existing top 3 from `Government-Buyer-Catalog-SOEs.md` (uMngeni-uThukela
Water, Vaal Central Water Board, Overberg Water, all still ranked ahead - all three are more
directly construction-relevant and already confirmed real gaps or near-gaps). **IDC slots in as a
genuine 4th candidate**, ahead of Necsa: higher volume (100+ vs 15 tenders), broader
infrastructure-advisory relevance (ports, airports, water, energy, waste - matching this product's
actual engineering-consulting customer base more closely than Necsa's narrow nuclear-facility
work), but still needs the same eTenders-overlap check before it's worth building, and its
tenders skew toward advisory/feasibility work rather than construction contracts themselves -
worth a second look at whether that's actually useful to this product's customers before
committing engineering time to it.
