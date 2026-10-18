# Government tender coverage and listing-change tracking: what was built (17-18 Oct 2026)

Builds on Strategy sections 10 and 11. Sarel asked for "the same service [as Leads 2 Business] ... for government tenders, including all our other services". This file covers the engineering. The coverage question itself (can free sources match L2B on government work?) is answered in `docs/strategy/Marketing-Pricing-Strategy.md` section 10, written by a parallel research pass. This work builds on it. Section 10.5's items 1 to 3 are now built, item 4 is started (Cape Town), and the change tracking it calls for is in place.

Scope: government buyers only (national, provincial, municipal, SOEs). There are no private-sector leads, and nothing depends on a person reading gazettes or newspapers.

## 1. Sources (each read live on 17 Oct 2026)

| Source | Module | Read | Overlap with the eTenders portal (as matched by `gov_sources.merge`) | What it adds |
| --- | --- | --- | --- | --- |
| eTenders portal, advertised tab (National Treasury) | `etenders_portal.py` | 2,211 open, 408 buyers, in 5 requests of 500 | (base) | The full portal rather than the OCDS API's ~300-600 releases per window. Adds status, province, tender type, the briefing session (date, venue, compulsory), each document's upload time, and the real bid number |
| eTenders portal, Cancelled tab | `etenders_portal.py --status cancelled` | Newest first. 42 tenders cancelled in the last 14 days, each with the buyer's reason and time | - | **Cancellations**: the only automatable source. The OCDS feed still showed tenders cancelled on 16 Oct with status `''` on 17 Oct |
| eTenders portal, Closed tab (newest 3,000) | `etenders_portal.py --status closed` | Server 500s on some pages; re-read in chunks of 25, skipping only the broken chunk | - | Finds tenders the portal has closed while the buyer's own site has extended them |
| SANRAL's own site | `gov_sources.sanral_releases` (list + `detail.py` per open tender) | 137 rows, 86 still open; of those, 72 are SANRAL's own tenders (vacancies and contractor sub-packages excluded) | **69 of 72 matched to an advertised portal row, plus 3 to a Closed portal row** (NRA 2026/0754 (A), NRA 2026/0021 (B), NRA 2026/0062). Matching uses **both** identifiers: the contract number and the NRA bid number from the SCM reference. That agrees with section 10.2's 72 of 73 | Extensions eTenders doesn't show, addenda file names, subcontract packages |
| Eskom Tender Bulletin | `eskom_bulletin.py` (public JSON API behind the SPA) | 325 entries: 180 tenders and 145 notices | 159 of 180 tenders on the portal; 21 bulletin-only | Notices: 45 bidders lists, 16 award notices, 42 regret letters, 29 cancellations, 11 validity extensions, 2 closing-date extensions. Also tenders the portal already shows as closed but Eskom has extended (3 found) |
| Transnet eTenders | `transnet_etenders.py` | 104 open (TNPA 57, TFR 31, TPT 7, TCC 5, others); 453 document links, addenda included | 68 matched by reference; 36 not found on the portal's advertised tab. Section 10.4 counted 90 with a looser match, so 36 is an upper bound on what's new | Divisions, briefing details, every addendum as a public link |
| City of Cape Town procurement portal | `capetown_procurement.py` | 246 open RFQs | **0** on eTenders | RFQs that never reach eTenders (section 10.4), plus RFQ award notices with the supplier's name |

`gov_sources.fetch_all()` merges them: 2,590 tenders (2,540 open) from 415 buyers, with 296 listed by more than one source. If the portal read fails, it falls back to the OCDS feed. A full read takes about 7 minutes, most of it the polite per-tender document reads for Eskom, Transnet and SANRAL.

**Fixed on the way:** `etenders_national.normalize()` stored the portal's internal id as `contract_number` and the bid number as `title`. That was the side finding in `Award-Outcomes-Findings.md`. It now stores the bid number and the real title, keeps `portal_id`, and `pursue_discovered_opportunity()` (migration `0051`) takes `contract_no` from `contract_number`.

## 2. Listing-change tracking (`tender_changes.py`, migration `0051`)

These are listing-level facts about **every** tender in the sources, whether or not anyone is pursuing it. The document-reading watch for pursued tenders is `watch_tender_updates.py` (0039, a separate agent's work). It is not duplicated here: this tracker sees documents by name only and never downloads or reads them.

| Change | How it is detected | Verified live, 17 Oct 2026 |
| --- | --- | --- |
| `cancelled` | Portal Cancelled tab (reason and time), plus Eskom cancellation notices | 55 in 14 days, e.g. IHLM-59/2026-27/ADMIN, Ingquza Hill, 16 Oct 15:22, "Error by publisher ie. Incorrect date, incorrect documents". Its OCDS release still had status `''` |
| `sources_disagree` | The buyer's own site says open, with a later date, while the portal has moved the tender to Closed. Also used when two sources give different closing *days* (a same-day hour difference is ignored) | **9 real extensions eTenders doesn't show:** SANRAL NRA 2026/0754 (A) (portal closed 15 Oct, SANRAL says 6 Nov), 0754 (B), 0021 (B) (2 Oct to 2 Nov), 0021 (D), 0062, 0063; Eskom E3586GXGPLET, E3572GXGPLET, E3594GXGPLET. Transnet TNPA/2026/09/0003-0005: Transnet says 13 Nov, portal says 2 Nov |
| `readvertised` | The buyer lists the same bid number again with another closing date. Also a listing that calls itself a re-advert, or one whose buyer and title match a recent cancellation | EC Transport SCMU10-26/27-0017 A and F were listed closing 26 Oct and again (0017A, 0017F) closing 6 Nov. Defence CPSC/B/338/2026 (22 Oct, relisted 30 Oct). Elundini ELM-4/020/2025-2026R re-advertised after ELM-4/R020 was cancelled ("Duplicates") |
| `document_added` | First sighting: a document whose own upload time is a day or more after publication, and whose **name** says addendum, notice, amended, extension and so on. After that: any document name not in the last snapshot | 597 addendum-named late documents on 301 open tenders. Example: WTE1062CE "Wte1062-Addendum.pdf", uploaded 17 Oct to a tender published 16 Oct. The other agent's document reader found the briefing move inside it. Another: "Second Extension of Tender Closing Date to 28 October 2026.pdf" |
| `closing_date_changed`, `briefing_changed`, `title_changed` | Snapshot diff between runs. OCDS releases and portal rows are updated in place under a stable id (`ocds-9t57fa-<id>-<publish date>`): ocds-9t57fa-174359 gained its addendum without a new release | Two re-reads of the portal (18:00 and 19:10 UTC, Saturday) showed **no** date edits: nothing changed in that hour. The diff is covered by `test_gov_sources.py` on real rows (extension, brought forward, briefing move, new document). Two Eskom "TENDER CLOSING EXTENDED" notices are recorded as `closing_date_changed` |
| `bidders_list_published`, `award_published`, `validity_extended`, `regret_published` | Eskom bulletin notices, attached to the tender they name (`eskom_bulletin.base_reference`). Also the portal Closed tab's own `bidders` field (Strategy 11.7 item 1): names and any amounts, with the official who typed them dropped | Eskom: 26 bidders lists, 12 awards, 8 validity extensions and 16 regret letters in the last 60 days. Portal: 20 of the newest 201 closed rows (18 Oct) carry bidders, e.g. Johannesburg Water 6000080648 (154 bidders) and Transport RFQ/397/2026 (8) |

Each change has a `dedupe_key`, so a re-run records nothing twice (a third run recorded 0 new). Storage: `tender_listing_snapshots` (service role only) and `tender_listing_changes` (readable by any signed-in user, since these are public listing facts). Without Supabase, `state/listing_snapshots.json` and `state/listing_changes.json` are used.

## 3. Where it shows up

- **`watch_new_tenders.py`** now reads every source by default (`--sources all`; `--sources ocds` gives the old behaviour). `--days N` now means "published in the last N days", and the full portal is read, so a 14-day window holds about 1,400 tenders instead of about 300. Change tracking runs on the same read (`--no-track-changes` turns it off). The listing fields go through to `discovered_opportunities` (0051: `listing_sources`, `province`, `tender_type`, `briefing`, `listing_status`, `source`).
- **Discovery page:** source chips (eTenders portal / SANRAL site / Eskom / Transnet / Cape Town), province and type, the briefing (amber when compulsory), and a "Changed" filter. Each card shows its changes, most urgent first (a red Cancelled badge, amber for a moved date, blue for an addendum, with a source link). A cancelled tender loses the "Prepare this tender" button. The page text now says what is and isn't covered.
- **Daily digest:** a `listing_changes` section for every role: the changes recorded in the last day on tenders in that company's feed, with cancellations first. The viewer gets counts.
- **`award_outcomes.py`:** `--source capetown` (Cape Town RFQ awards with supplier names; 7 of 8 read named one) and `--source eskom` (award, bidders-list and regret notices with document links).

## 4. Verification

- `engine/discovery/test_gov_sources.py` runs in CI, offline, on real trimmed rows. It covers every reader's normalisation, Eskom notice classification (including "EXECUTIVE OFFICE EXTENSION", which is a tender), SANRAL dual-identifier matching, buyer-family and lot guards, the closed-tab fold, every change type, store dedupe and the digest section.
- The existing suites pass: `test_award_outcomes`, `test_discovery_fanout` (including Part 2 on a replay), `test_tender_updates` (including Part 3 on a replay), `test_digest_live` (one stub updated to the new return shape) and `test_taxonomy` Part 1.
- `test_taxonomy` Part 2 has 1 failure ("price_sector legacy group value"). It reproduces on a replay **without** this change, so it isn't caused by this work.
- Migration replay: `0001` to `0051` on scratch Postgres 16 (auth and storage stubs). On that replay: the new source values are accepted and an unknown one is refused; an authenticated user reads changes but can't insert them or see snapshots; an unknown `change_type` is refused; `pursue_discovered_opportunity()` gives an Eskom-only listing `contract_no` = its bid number and a null `tenders.ocid` (slug `eskom-bulletin:...`), gives a portal listing its real OCDS ocid, and keeps 0043's `search_path = public, pg_temp`. Seeded rows from a real watch fan-out were inserted with their listing fields.
- `tsc --noEmit` and `eslint` are clean. **The page was not rendered against a live project (Gap #9).**

## 5. What is still not covered (honest)

- **Municipalities that don't use eTenders**, and municipal RFQs other than Cape Town's. This is section 10.4's finding: it is not mandatory, many sites are down or are PDF lists, and it is where L2B's research team earns its fee. Each further metro reader is a custom scraper with ongoing upkeep.
- **Gauteng's provincial e-Tender portal** (Power Pages with PowerBI: no plain data endpoint was found) and **Eskom's NTCSA bulletin** (403 to scripts). NTCSA tenders still arrive through the portal.
- **Bidders lists and site registers for most buyers.** Only SANRAL's registers and Eskom's notices are covered. The portal's own `bidders` field is sometimes filled (see `Award-Outcomes-Findings.md`).
- **The cross-run date diff has not yet caught a real edit live.** The one-hour window had none. The disagreement, relisting and late-addendum checks did catch real ones (above).
- **Volume:** the first watch run scores every open tender published in the window (about 1,400 for 14 days), with document reads. Later runs score only the new ones (about 130 a day). Expect a long first run.
