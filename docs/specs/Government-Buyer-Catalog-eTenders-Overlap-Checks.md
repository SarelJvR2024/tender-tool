# eTenders-overlap checks on the remaining reader candidates (20 Oct 2026)

Every candidate named across the five `Government-Buyer-Catalog-*.md` files as "not yet
cross-checked against eTenders" now has that check done, using the standard method: run
`etenders_portal.py --buyer "<name>"` for the real current advertised-tab listing under that buyer
name, then compare directly against the candidate's own site (re-fetched live, not assumed from
the earlier research pass). One candidate came out a confirmed, buildable gap and already has a
reader (`vaal_central_water.py`, committed `5e24ae8`). This file is everything else checked after
that.

## Confirmed NOT a gap - eTenders already carries them, no reader needed

| Entity | Evidence |
| --- | --- |
| **Overberg Water** | 5 of its 6 open RFPs/RFQs (`OW-022`, `OW-019`, `OW-004`, `OW-021`, `OW-023`) found verbatim on eTenders under "Overberg Water". The 6th (`OW-020`, smart meters) closes today (20 Oct, noon) on its own site and isn't in the advertised tab at the time of this check - almost certainly already moved to the portal's Closed tab rather than a real gap, not confirmed further given the near-certainty from the other 5 |
| **Industrial Development Corporation (IDC)** | Its own single best find (`T57/10/2026`, the Pilanesberg Airport transaction-advisor tender) is on eTenders verbatim under "Industrial Development Corporation of South Africa Limited", alongside several other IDC references (`T54/09/26`, `T55/08/26`, `T56/09/26`, `FOSPHB-RFP-21-26/27`, etc.) |
| **SA Nuclear Energy Corporation (Necsa)** | Its own flagged construction-relevant tenders (`FIN-SCM-TEN-0254`, and related `FIN-SCM-TEN-0252`/`0253`) are on eTenders under "South African Nuclear Energy Corporation Limited" - a `--buyer "necsa"` search found nothing only because the portal's buyer field spells out the full name, not the acronym; searching "nuclear" found them straight away |
| **Limpopo Dept of Public Works, Roads and Infrastructure** | 17 of its ~21 `LDPWRI-P/206xx` office-accommodation tenders found on eTenders under "Limpopo - Public Works" (two closing-date batches: 23 and 30 Oct). Not a clean 100% match - `LDPWRI-B/20646` (the mobile-toilet-servicing validity extension) was not found under this buyer name - but with 17/21 already duplicated, the remaining gap is one RFQ, not a volume worth a dedicated reader for |

## Confirmed real gaps, but NOT good reader candidates as found - a genuine finding, not a dead end

| Entity | What's there | Why it's not buildable as-is |
| --- | --- | --- |
| **Mbombela (City of Mbombela)** | `mbombela.gov.za/tenders-and-notices/tenders/` - a WordPress Download Manager archive, ~36 pages, roughly 468 entries by page-count estimate (13/page, not a stated total). Real, current, construction-relevant work mixed in (`COM93/2026` - construction of a road and bridge). Only 2 of its references found on eTenders at all (`COM88/2026`, `COM82/2026`) - this is a real, large gap | **No closing date anywhere** - not on the listing page, not on an individual document's own page (checked `COM93/2026` directly: "Create Date" is the upload date, not a deadline; its own "2024" category tag doesn't even match its 2026 reference, a second internal inconsistency). A structured reader needs `closing_date` to compute `is_closed` - without it, every one of ~468 entries (including genuinely years-old ones like `COM67/2024`, which sits on page 1 unsorted among current ones) would read as permanently "open", which is actively wrong, not just incomplete. The real closing date almost certainly only exists inside each tender's own PDF - a per-document PDF-text-extraction job for ~468 documents, a materially bigger and more fragile undertaking than every other reader built this session, not attempted here |
| **Polokwane** | `polokwane.gov.za/?page_id=638` ("Tender Documents") - the same shape of problem as Mbombela: 100+ entries (`PM01` through `PM84`, spanning FY2023-24 through 2026-27), flat document list, no closing dates on the listing or a per-document page. **This is also the wrong page for the earlier catalog's "active awards/price register, 8 documents this FY" finding** - that register lives somewhere else on the site that this pass did not relocate. Worth a second, more targeted search for the actual award-register section before writing this entity off; the tender-documents page alone is not reader-buildable for the same reason Mbombela isn't |

## Confirmed real gaps, not yet built (lower priority this round, genuinely still open)

| Entity | Evidence of gap | Note |
| --- | --- | --- |
| **Lephalale** | Zero results for `--buyer "lephalale"` | Exact current tenders-page URL wasn't re-confirmed this pass (a direct guess 404'd); needs a fresh search before a reader can be built, same discipline as every other candidate - not attempted further this round |
| **Magalies Water** | Zero results for `--buyer "magalies"` | Already flagged as thin (2 entries, both already closed by the original check) - a confirmed gap, but low volume; lowest priority of the real gaps |

## Partial overlap - mixed value, not ruled in or out

| Entity | What was found |
| --- | --- |
| **Musina** | 8 open tenders found on eTenders under "Musina Local Municipality" (construction: bridge, community hall, pedestrian sidewalk, plus services). Its own site's higher-value find per `Marketing-Pricing-Strategy.md` section 11.6 is a separate **awards/price register**, not these open tenders - whether that register duplicates data eTenders doesn't carry is a different, still-unanswered question this check didn't resolve |
| **uMhlathuze** | Only 1 of its references (`8/2/1UMH1792-26/27`, road-marking paint) found on eTenders; the water-infrastructure-relevant RFQ the catalog flagged (dosing pumps, Ngwelezane) was not among the matches - real signal of a gap on the RFQ side, but low confirmed volume (1 municipality-site RFQ set, not independently re-confirmed this pass) |
| **Msukaligwa** | 7 tenders found on eTenders (services/goods: printing, towing, transport, VIP protection, licensing, skills panels) - but none of these match the specific construction-relevant finds the catalog named (storm-water channel, structural/civil/plumbing panel), which may be closed, awarded, or simply listed under different references. A direct recheck of the municipality's own site 404'd on a guessed URL this pass - unresolved either way |

## What this means for reader-building priority, right now

1. **Vaal Central Water Board** - done (committed `5e24ae8`).
2. Nothing else checked this pass is a clean, buildable, high-confidence next reader. The
   highest-volume finds (Mbombela, Polokwane's tender-documents page) are real gaps but need a
   fundamentally different, heavier approach (PDF-level parsing) that doesn't fit this session's
   "robust reader" standard without that extra work being done deliberately, not as a rushed
   add-on.
3. **Worth a second look before the next reader is built**: finding Polokwane's actual
   award/price register (separate from the tender-documents page checked here), and re-finding
   Lephalale's and Msukaligwa's real current tender-page URLs (both 404'd on a guessed path this
   pass).
4. Overberg Water, IDC, Necsa and (mostly) Limpopo Public Works can be considered closed out -
   real, reachable sites, but already duplicated on eTenders, not worth a dedicated reader.
