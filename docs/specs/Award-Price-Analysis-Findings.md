# Award and price analysis: what we built, and how much of it the data supports

Built 2026-10-17/18. It follows on from `Award-Outcomes-Findings.md`, which describes the two
public sources. Every number below comes from live reads made on 2026-10-17. The commands are
in "Verification".

Sarel's request: "see what we can do with tender submission and award and award price
information to provide this as an added benefit to give that analysis feedback."

## 1. Decision

The brief offered three directions. I checked each one against what the sources actually hold:

| Direction | Built? | Why |
| --- | --- | --- |
| 1. "How did my price compare?" for a tender the company bid on | **Yes, in full** | The data is real and exact for SANRAL tenders. SANRAL publishes the opening register (every bidder and price) within days of closing. Comparing prices within one tender is a fair comparison, because every bidder priced the same scope. |
| 2. Benchmarks before pursuing a tender | **Yes, scale-free numbers only** | Comparing rand amounts across tenders is misleading, because a R20m fee and a R60m fee are different scopes. Bidders per tender, how often the lowest bid won and the winning bid against the median bid all hold across tenders. Every figure shows its own sample size. |
| 3. Competitor intelligence | **Yes, narrowly scoped** | Two things are shown. (a) The published register of a tender the company itself bid on, which is literally what SANRAL publishes. (b) "Firms you have bid against most", drawn only from those same registers. Across a whole segment, only counts are shown ("76 firms won 287 awards; the top 3 won 14%"), with **no names**. There is no page that profiles another company. See §6, Q1. |

Both views sit where the brief suggested:

- **Tender Workspace, "Market" card** (jump-nav "Market"). It shows this tender's published
  result, where the company's price placed, and similar published tenders.
- **`/pipeline/pricing`, "How your prices compared with the published results".** It shows
  every priced tender that has a published result, plus the firms met most often.

## 2. What the real data holds (live, 2026-10-17)

The reads were: eTenders Awarded tab, newest 1,000 + 200 rows across all buyers and all 648
SANRAL rows; SANRAL awarded list (all 69 the endpoint returns); SANRAL closed list, newest 150 +
60. Stored through the new writer, that gives **1,761 distinct tenders**:

| | SANRAL | Other buyers (eTenders only) |
| --- | --- | --- |
| Tenders | 775 | 986 |
| Awarded (winner known) | 627 | 957 |
| Competitive (not sole/single source, emergency, piggy-back) | 738 | 560 (43% of other buyers' awards are not open competitions) |
| Any bidders list | 382 | 334 |
| **2+ priced bids (a usable register)** | **124** | **177** |
| Winner located in that register | 55 | 158 |
| Register only in the reCAPTCHA-gated download | 2 (of 4 seen) | - |
| Batch register (one price per contract) | 1 | - |

What this means:

- **SANRAL's own pages are the only rich source for SANRAL.** The eTenders portal lists 212
  SANRAL bidders lists, and **none of them carries prices** (names only). Every priced SANRAL
  register comes from nra.co.za.
- **SANRAL consulting engineering** is Klipcorp's segment and the one the feature matters most
  for. There are 325 competitive outcomes, almost all awards with winner and amount. But only
  **33 have a priced register, and in only 14 is the winner placed in it**. Those 14 give:
  - the lowest bid won 7 of 14;
  - the winner was typically 3% below the median bid;
  - the median field was 23 priced bids.

  These are labelled **thin** on screen, and the label is correct.
- **Other buyers:** 177 of 986 awards (18%) carry a priced bidders list. These are mostly RFQs.
  Discipline segments outside SANRAL will often show "too few to compare". The card hides those
  columns and says so in one line.
- **Coverage grows only if we keep reading.** The SANRAL closed list holds 5,546 tenders, and
  only 210 were read. The eTenders Awarded tab holds 35,316, and about 1,850 were read. The
  writer is built for a backfill, but no backfill or schedule has run (§5).

## 3. How it works

- **`engine/discovery/store_award_outcomes.py`** (new) is the writer. `award_outcomes.py` is
  still the reader and is unchanged apart from its docstring. The writer:
  - groups source rows into one row per real tender. A SANRAL tender appears on SANRAL's closed
    list, its awarded list and the eTenders tab; 57 tenders merged this way;
  - keeps each source's own record under `parts` and recomputes everything else on every
    write, so one source's later run never wipes another's;
  - places the winner in the register: by exact name (54), by the awarded amount when the names
    differ (11, e.g. "NEXOR 312 T/A VNA CONSULTING" = "VNA Consulting"), or by a unique first
    word (2), and records which method was used;
  - works out field numbers only for a single-contract register with 2+ priced bids;
  - attaches a plain-language note to each record it cannot fully use: batch, multi-package
    award, gated register, panel award, non-competitive, implausible amount, or a register typo
    more than 5x off the median (real cases: "R39 1453 554.20" and "R 539 343 850,26" in a field
    of ~R37m);
  - sorts each tender into the existing discipline taxonomy (`assess_tender.categorize()`;
    89% categorised).
- **Migration `0053_public_tender_outcomes.sql`** adds:
  - a shared table that any signed-in user can read and only the service role can write (same
    pattern as `discipline_categories`);
  - `award_match_keys(text)`, which normalises SANRAL contract and NRA references whatever
    dot/dash/slash variant was typed: "N001-013-2026/1", "X.005-069-2025-1",
    "N.008-080-2020.2", "NRA 2026/0084 (B)";
  - `tender_market_outcomes(uuid[])`, a security-invoker function that joins a company's
    tenders to their outcomes by OCDS id or SANRAL reference, under the caller's RLS.

  Other buyers' tenders join **only by OCDS id**, because their bid numbers ("RFQ 01/2026") are
  not unique.
- **`app/lib/marketPricing.ts`** does the per-company matching at read time, so there is no
  per-company storage. It applies the same confirmed / assumed / missing discipline as field
  provenance:
  - *name and price* means confirmed;
  - *name only*, *price only* ("a bid at exactly your price under another name - a JV?") and
    *similar name* ("Klipcorp Consulting" for "Klipcorp (Pty) Ltd") are each shown as
    "probably you - check", never as certain;
  - *not found* says so, and adds "if you bid as a JV the register lists that name".

  On a batch register it reads the column where the recorded price appears, and it never
  claims a per-contract winner. If the published figure differs from the recorded one, it says
  so and notes that buyers don't state the VAT basis.
- **Benchmarks** come from up to two comparison groups: this buyer + discipline, and all
  buyers + discipline. Only competitive tenders are counted. Every figure shows its own sample
  size: under 5 it is not shown, and under 15 it is marked "thin".

## 4. Data-coverage caveats (say these out loud to customers)

1. **Most tenders will show nothing.** Outside SANRAL, 82% of published awards have no priced
   bidders list, and many buyers publish nothing at all on eTenders.
2. **VAT basis is never stated.** A register amount may be incl. or excl. VAT. A company that
   recorded its incl.-VAT price against an excl.-VAT register is shown as "found under your
   name, price differs", not matched.
3. **Names are typed by buyers.** Klipcorp appears as "Klipcorp Pty Ltd" on one real register
   and "Klipcorp Consulting" on another, so a JV or trading name won't match. The company's own
   legal and CSD trading names are the only aliases used. There is no alias list yet (§6, Q4).
4. **SANRAL's gated registers** (about 2% of closed pages read) are reported, not fetched. This
   is the same policy as the original document-download finding.
5. **The SANRAL awarded list endpoint only returns 69 of the 90 it claims.** Older awards come
   from the eTenders tab, which carries the winner but not SANRAL's register. Closed-list
   registers carry every price but no winner. The winner-placement figures rest on the overlap,
   which is why SANRAL consulting has only 14.
6. **The winning bid is not always the lowest priced bid.** SANRAL scores functionality and
   B-BBEE points too. "Lowest bid won 7 of 14" is the market fact, not a pricing rule.
7. **Amounts across tenders differ with scope.** "Contract size awarded" is shown as size, never
   as "what to bid".

## 5. Not done

- **No scheduled run and no backfill.** Run
  `store_award_outcomes.py --fetch --source both --limit 2000 --sanral-limit 300` by hand, or
  pass `--report` with `award_outcomes.py` output. The live read showed that a SANRAL list read
  can stall on a dropped connection, so wrap a scheduled run in a timeout. A daily slot next to
  the Discovery watch is the natural home.
- **Never run against a live Supabase** (Gap 9). It was verified on a replay plus PostgREST
  12.2.3 with RLS.
- The **taxonomy misses some titles.** For example, ESKOM's "Owner's Engineer (OE) services"
  is uncategorised. These are visible with `taxonomy.py coverage`.

## 6. Open questions for Sarel

1. **Competitor framing (a product call).** Built today:
   - other firms' names appear only on registers of tenders the company itself bid on, plus a
     "firms you have bid against most" table drawn from those registers;
   - segment-level data is counts only.

   Not built: a "top winners in roads consulting" leaderboard, or any per-firm page. The public
   data would support it, because these are public award notices. But it changes the product
   from "feedback on your own bids" to market surveillance, and it is the part most likely to
   make customers uneasy about being on the other end. Do you want named winners at segment
   level, an opt-in, or neither?
2. **SANRAL licensing.** SANRAL's terms allow reproduction with acknowledgement but say "no
   charge ... upon any recipient". Every SANRAL figure on screen carries the attribution. Is it
   acceptable to show this inside a paid product, or should we ask SANRAL? The `sources` column
   lets a deployment drop SANRAL rows if needed.
3. **POPIA lawful-basis note.** A paragraph is drafted in the migration header (juristic
   persons' names as published in statutory notices, kept only to the same purpose). Should it
   go into the POPIA section as is?
4. **Company aliases.** Should a company be able to list its JV and trading names (for example
   "Klipcorp Consulting") so its own registers match with confidence?
5. **Refresh cadence.** How often should the backfill run, and how far back? SANRAL's closed
   list goes back years (5,546 tenders).

## Verification

- **`engine/discovery/test_award_prices.py`** (new, added to CI) runs in two parts.
  - Part 1 uses 9 real records committed as
    `fixtures/award_prices/real_outcomes_2026-10-17.json`. It checks:
    - the X.003-080 merge across the SANRAL page and the eTenders row;
    - the VNA amount match;
    - NRA 2026/0084(B) as a batch register, with Klipcorp's three real prices kept;
    - the multi-package amount refused;
    - the gated register;
    - a sole-source award;
    - the eTenders ESKOM list;
    - the cross-run merge;
    - 24 real reference formats;
    - the typo outlier.
  - Part 2 (`AWARD_PRICES_PSQL`) runs on a fresh `0001`→`0053` replay. It checks:
    - the stored rows, and that a second store is idempotent;
    - that SQL `award_match_keys` equals the Python version on all 24 references;
    - that company A's four tenders match by "NRA 2026/0084 (B)" spacing, by contract in
      `nra_reference`, and by OCDS id, and that the one without a published result matches
      nothing;
    - that company B's private manual tender never matches for A, and does match for B;
    - that a signed-in user can read but not insert or update, and anon reads nothing.

  0 failures. `test_award_outcomes.py` and `test_taxonomy.py` (DB part) are unchanged.
- **TypeScript matching was checked on the same real rows** (jiti, scratch, not committed):
  - `normName` / `firstToken` are identical to Python on 129 real register names;
  - Klipcorp is found by name and price on NRA 2026/0084(B) in contract column 2, 6th of 41,
    and the column switches when the contract-3 price is recorded;
  - an incl.-VAT price gives "name only, differs";
  - "Klipcorp Consulting" gives "similar name";
  - an exact price under another name gives "price", 6th of 11, +1.4% vs the winner;
  - the winner's own view says "won", 2nd lowest.
- **Rendered** with `next dev` against PostgREST 12.2.3 and RLS on a replay holding all 1,761
  real outcomes:
  - Klipcorp's real NRA 2026/0084(B) bid shows 6th lowest of 41, +4.3% vs the lowest bid and
    -5.5% vs the median;
  - R.062-070-2021/1F (real award) shows "price only - check";
  - R.396 (nothing published) shows benchmarks only;
  - the eTenders ESKOM award matched by OCDS id shows "not on register", with the
    ESKOM-segment column hidden as too few;
  - the pricing page summary and the firms-met table render.

  The card has no horizontal overflow at 390 px, apart from the scrolling tables.
  `tsc --noEmit` and `eslint` are clean.
