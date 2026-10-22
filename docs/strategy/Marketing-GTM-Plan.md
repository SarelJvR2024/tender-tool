# Tender Ready — Marketing, Brand & Go-To-Market Plan

Status: living document, first drafted 2026-10-21, refined overnight across multiple research passes.
Supersedes the pricing section of `Marketing-Pricing-Strategy.md` (keep that file for its competitive
notes and ECSA value-calc work — the pricing itself is now the founder's own verbatim 4-tier structure
below, not that doc's "Model A/B/C").

**Pricing confirmed, 2026-10-22**: a real conflict surfaced across sessions — the live homepage and
already-merged billing code were running a different, older scheme (Tender Watch/Tender Pro/SANRAL
Pro) than this document's own 4-tier structure. Sarel confirmed directly, in chat: *"Starter
R1,490/Professional R2,990/Business R4,990/Enterprise — that one's correct."* Every number in this
document is now the confirmed, final pricing — the homepage, billing schema and usage-limit
enforcement have all been reconciled to match (see `docs/specs/System-Status.md` and PR #71).

## 0. The headline number the founder should see first

**Pricing (confirmed, 2026-10-22):** Starter R1,490/mo · Professional R2,990/mo · Business R4,990/mo ·
Enterprise (custom). No feature gating — every tier gets every engine; tiers differ only by seats and
bid-pack volume.

The founder's three stated goals were "100 clients", "R100k/month", "R500k/month" — stated as if in that
order. **They are not in that order.** Run the math on a realistic SaaS tier distribution (roughly
40% Starter / 45% Professional / 12% Business / 3% Enterprise, which is a normal shape for a
usage/seat-tiered product where the middle tier is pitched as the default):

| Milestone | Clients needed | Tier mix assumption |
|---|---|---|
| R100,000/mo | **~32–35 clients** | Professional-centric mix (roughly 6 Starter / 21 Professional / 4 Business) |
| R100,000/mo (floor case) | ~68 clients | Starter-only, nobody upgrades |
| **100 clients** (founder's own first milestone) | 100 clients | at the realistic blended mix above → **≈R278,000/mo**, not R100k |
| R500,000/mo | **~150–180 clients** | same blended mix, or ~100–120 clients if the mix skews harder toward Business/Enterprise as the company matures |

**The implication:** if the real near-term goal is R100k/mo, that is a ~35-client problem, not a
100-client problem — achievable through founder-led channels alone (see Part 4). "100 clients" is
already most of the way to R500k/mo. This changes the plan: don't treat these as three sequential
walls to climb one at a time. Treat it as **one push to ~35 clients (R100k/mo, prove the model),
then a second push of the same shape but wider (to ~150–180 clients, R500k/mo)** — the GTM motion
doesn't need to change qualitatively between them, it needs to add a second channel and, later, a
first hire.

---

## 1. Competitive landscape

**Fully researched this pass (direct vendor pricing pages, not secondary sources) — the earlier
"nobody else does AI" claim below was WRONG and has been corrected.** The previous draft of this
section leaned on an assumption (every SA competitor is a plain workflow tool, none do AI compliance
or opportunity scoring) that a background research pass never actually confirmed — it had silently
drifted off-task. This pass replaces it with real, current, vendor-sourced pricing and features.

| Competitor | Pricing (current, vendor site) | What it actually does | How it compares to Tender Ready |
|---|---|---|---|
| **L2B** ("Leads 2 Business") | R1,426/mo ex VAT (SA-only tier); R2,461/mo for SA+Africa | Tender listing/alert feed only | Not a real competitor to the core workflow — a category Tender Ready's own opportunity-discovery engine already subsumes. Worth asking early customers if they're paying L2B separately: a clean "why pay for both" pitch. |
| **TenderFlow** (tenderflow.co.za) | **Free** (1 user, 3 AI analyses/mo) · **Professional R1,900/mo** (2 users, 25 AI analyses + 25 AI proposal generations/mo) · **Enterprise R3,500/mo** (5 users, unlimited AI) — 14-day free trial, no card, on paid tiers | Has **real AI tender analysis and AI proposal generation** — this is the one identified competitor whose own marketing claims genuine AI, not just workflow automation. Also: deadline/BBBEE/CIDB calculators, briefing/proposal templates, a tender-readiness score. | **The closest real competitor found.** No evidence of CV tailoring, cover-page auto-fill, or SANRAL-specific schedule automation — its "AI proposal generation" is generic, not tied to a specific engine like SANRAL's Book 1 schedules. Its pricing is also meaningfully higher per seat than Tender Ready's equivalent tiers (R1,900/2 users vs. Tender Ready's Professional R2,990/5 users) — worth a direct seat-count comparison in sales conversations. |
| **AITenders** (aitenders.co.za, by Tactical) | **R199/mo**, custom "bid teams" tier on request | AI opportunity matching (fit score vs. sector/CIDB/BBBEE/geography), drag-and-drop bid pipeline, win-rate analytics, a **Claude-powered chat feature** that can "flag compliance gaps" on request | A genuine opportunity-scoring competitor, and the only one found with any AI compliance angle — but it's a **conversational, user-prompted** check (you ask it), not an automatic, built-into-the-submission-workflow check the way Tender Ready's compliance engine is. No CV tailoring or document generation found. Cheapest of the AI-capable competitors. |
| **TenderProSA** (tenderprosa.co.za, by Dauntless AI) | From **R299/mo + 100 free credits on signup** (credit-based beyond that, exact structure unclear) | CIDB grading match-check, B-BBEE preference-point calculator (80/20, 90/10), OHSA method-statement generation, priced Bills of Quantities (50,000+ SA material rates), SBD-form flagging | The closest thing to a direct "compliance + document generation" competitor found — genuinely does some of what Tender Ready does (CIDB check, B-BBEE calc, document generation). No evidence of CV tailoring or a SANRAL-specific schedule engine. Vendor-claimed figures only, no independent reviews found — treat performance claims skeptically until verified. |
| **BidsStack** (bidsstack.com) | **Starter R300/mo** flat (unlimited alerts, open/closed/awarded tender search back to 2018) · **TenderScout** (a separate bid-qualification product: tender-pack review, requirement extraction, fit/risk/disqualification signals, bid/no-bid recommendation) — pricing not published | Starter tier is an alert/search feed, closer to L2B. TenderScout sounds closer to Tender Ready's compliance angle, but no pricing was found and its depth is unconfirmed. | Worth a follow-up check once TenderScout's pricing surfaces — it's the one named competitor whose positioning (tender-pack review → fit/risk signals → bid/no-bid) most directly overlaps Tender Ready's own compliance-check framing. |
| Generic RFP tools (Loopio, Responsive, PandaDoc) | Enterprise pricing, not SA-market-specific | Content-library-driven proposal assembly for large enterprise RFP teams | Wrong market entirely — priced and built for large corporate bid teams, not SA SME tenderers. Not a real competitive threat in this segment. |

**The corrected, defensible differentiation claim**: Tender Ready is not the only competitor with
*any* AI feature — TenderFlow has AI proposal generation, AITenders has AI opportunity scoring and an
on-demand compliance chat, TenderProSA has CIDB/B-BBEE compliance calculators and document generation.
**But no competitor found combines all of**: (1) compliance checking that's *automatic and built into
the submission workflow itself* (not a chatbot you have to remember to ask), (2) CV tailoring per
tender, (3) cover-page/client-template auto-fill, and (4) a named, SANRAL-specific schedule-automation
engine. That combination — not "we're the only one with AI" — is the real, checkable wedge. Positioning
(Part 3) has been corrected to match this.

**Pricing context**: Tender Ready's Professional tier (R2,990/mo, 5 people, 15 packs) sits between
TenderProSA/AITenders (R199–299/mo, narrower feature sets) and TenderFlow's Professional (R1,900/mo
but only 2 users) — not the cheapest, but priced for meaningfully more seats and a wider feature set
per tier than anything else found. This is worth testing directly in messaging once the pricing
conflict above is resolved.

The deeper, more important competitor, confirmed by direct evidence below, is **not other software —
it's Word, Excel, email, and a disqualified bid.** See Part 2.

---

## 2. Ideal Customer Profile

### 2.1 Who this actually is

South African SMEs whose revenue meaningfully depends on winning tenders — concentrated in
construction, civil engineering, the built environment, and adjacent professional/technical
services (security, facilities, ICT, consulting engineering). The clearest segmentation axis in
this market is **CIDB grading band**, because it's both a legal gate on what tenders a company can
even bid for and a rough proxy for size:

- **CIDB Grade 1–5 / turnover roughly under R1m–R5m** ("Emerging", per SAFCEC's own current
  membership-guide wording — confirmed directly against SAFCEC's site, not just a secondary source).
  This is the **Starter tier** buyer: an owner-operator who does the tendering personally, alongside
  running the actual work.
- **CIDB Grade 6–9 / turnover R6m+** ("Established"). This is the **Professional/Business tier**
  buyer: has at least a small team, may have one person whose job is substantially tender
  administration, bids most weeks rather than occasionally.
- **Multi-branch or multi-entity operators, or firms with their own dedicated tender/bid
  department** — **Enterprise**, priced on request as the pricing structure already states.

CIDB's own data point worth internalizing: SMEs are the large majority of the contractor register,
but have a *rising* failure rate and only a small share become durably successful firms (Journal of
Construction Project Management and Innovation). That's consistent with a market where the gap
between "registered and eligible to bid" and "actually winning enough to survive" is wide — which is
exactly the gap Tender Ready is selling a way to close.

### 2.2 Four buyer personas

**1. "Solo Sipho" — the owner-operator (Starter tier, the primary near-term ICP)**
CIDB Grade 2–4 contractor or professional-services owner. Does the tendering himself, nights and
weekends, on top of running jobs and managing staff. Tools today: Word templates he's patched
together over years, a shared Excel tracker (if that), email. Trigger to look for a tool: a bid
rejected on a technicality he didn't even know was required, or simply the exhaustion of doing it
alone as volume increases. Budget holder and user are the same person — the sales cycle is one
conversation, not a procurement process. Price-sensitive but not price-primary: the real objection
is "will this actually save me time," not "is R1,490 too much."

**2. "Tender Administrator Thandi" — the first dedicated hire (Professional tier, "most companies
start here")**
Works at a Grade 5–7 firm that tenders most weeks. Either just hired into this role, or the first
person to have it formalized (before her, the owner or a rotating junior did it badly). Reports to
the owner/director, who holds the budget but defers to her on tooling. Her week is dominated by
chasing documents from colleagues, reformatting the same cover page for the fifth time this month,
and tracking closing dates in a calendar she built herself. Trigger: a missed deadline that nearly
happened, or did happen once and cost the company a contract everyone agrees they should have won.

**3. "Ops Director Olwethu" — running several bids/branches at once (Business tier)**
Grade 8–9 firm, or several branches each bidding locally. Cares about visibility across bids more
than any single bid's mechanics — wants to know win rate, where deals are stuck, who on the team is
overloaded. Budget holder, not the day-to-day user necessarily. Trigger: growth outpacing the
company's informal coordination — a second branch opened, or bid volume that one person can no
longer track in their head.

**4. "Group Executive" (Enterprise)**
Multiple entities or a dedicated tender function already. Needs custom reporting, SSO/training,
probably needs to be sold rather than self-served. Not a near-term GTM priority — the pricing page
should route them to "contact us" and nothing more should be built for this segment yet.

### 2.3 Pain points, with real evidence (not just plausible-sounding ones)

This is the strongest card Tender Ready has, and it's grounded in actual South African case law, not
supposition — real companies have lost real tenders, sometimes worth tens or hundreds of millions of
rand, over exactly the kind of compliance failure the product's AI check exists to catch:

- **Missing/invalid B-BBEE certificate or sworn statement** → disqualification (SANRAL procurement
  case law; a bidder was excluded from a SANRAL tender specifically because its sworn B-BBEE
  statement was invalid).
- **Expired good-standing letter / invalid certificate** → an award itself set aside after the fact
  (KwaZulu-Natal border wall tender, ~R85.7m, 2026 — "an invalid certificate amounted to no
  certificate being submitted").
- **Unsigned/uncommissioned JV agreement** → bid rejected on a pure technicality (Du Toitskloof Pass
  tender, Western Cape High Court, 2023 — the JV agreement hadn't been authenticated by a
  Commissioner of Oaths).
- **Missing mandatory certificate, ambiguously worded requirement** → a R16bn Eskom tender dispute
  that went to the Supreme Court of Appeal (Babcock vs. Eskom).
- General pattern from a practitioner's own review notes: missing/expired CSD registration report,
  SARS tax compliance PIN, or B-BBEE certificate are the most common immediate-disqualification
  triggers, and poorly structured submissions that ignore the requested format or lack an annexure
  index fail on compliance even when the underlying bid was competitive.

**This is the single best piece of brand and sales material available.** "A JV that wasn't stamped
by a Commissioner of Oaths lost a tender in the Western Cape High Court. Your compliance check would
have caught that in thirty seconds" is a more persuasive sentence than any feature list.

Other pressures, less dramatically evidenced but well-understood in the market: rigid, non-negotiable
closing dates with no late submissions accepted; requirements that vary drastically between
procuring entities so templates don't transfer cleanly; decisions that can take up to 60 days,
meaning a lot of unpaid waiting between effort and revenue; institutional knowledge walking out the
door when the one person who "knows how we do tenders" leaves or is overloaded.

### 2.4 Objections and how to answer them

| Objection | Answer |
|---|---|
| "My process is fine, I've been doing this for years" | Reframe from "replace your process" to "catch the one thing your process can't catch at 11pm before a submission" — the B-BBEE/JV/certificate failure mode above. Nobody budgets for a disqualification; it still happens to experienced bidders. |
| "I don't want my pricing/bid data in someone else's cloud" | Needs a plain-language security answer on the marketing site and in sales conversations: what's encrypted, what Supabase RLS actually guarantees (tenant isolation is a tested, verified property of this product, not a claim — this is something the engineering side can back up concretely), who can see what. Don't hand-wave this one. |
| "Can I trust AI with compliance-critical work?" | Position the AI as a *check*, not a *decision-maker* — it flags what a human still signs off on. "A second pair of eyes that never gets tired at 11pm the night before closing," not "an AI that submits your bid for you." |
| "R1,490–R2,990/month is real money for a small operation" | Anchor against the cost of one disqualified bid, or the ECSA-rate value of the hours it saves (the existing pricing doc already has value-calc work here) — not against competitor price. |

### 2.5 Where to find them

- **Industry bodies**: SAFCEC (civil engineering contractors — membership split into Emerging/
  Established), Master Builders South Africa and its regional MBAs (MBA North, MBA Free State, MBA
  KZN, etc.), SAICA's and SAIPA's SME-support arms (SAICA's "Enterprisation Hub") — no searchable
  public membership directory was found for any of these; reaching members means contacting the
  secretariats directly or attending their events, not scraping a list. Worth noting: SAFCEC's own
  membership has reportedly shrunk from ~450 (2015) to ~148 (2024) per its own 2024 turnaround
  presentation — it's a smaller, more intimate body than its public profile suggests, which cuts
  both ways: fewer members to reach, but plausibly easier to get real relationships with the ones
  that remain (e.g. a talk at a regional event) than with a larger, more anonymous association.
- **A confirmed non-finding, worth not re-chasing**: no public Facebook/WhatsApp/online community
  specifically for SA tendering contractors turned up in two separate search passes. These likely
  exist (this kind of niche trade community usually does) but aren't publicly indexed — finding one
  would need an insider referral (e.g. ask the first few paying customers what groups they're
  already in) rather than more web search.
- **CIDB** itself — the contractor register is public; grading band is a usable segmentation/targeting
  signal even without a full directory.
- **Accountants and business consultants serving this SME segment** — a warm, trust-transferring
  referral channel (they already have the relationship and the credibility; see Part 4).
- **LinkedIn**, where South African construction/engineering SME owners and tender administrators are
  findable by job title + CIDB-adjacent company description, though no large dedicated public
  community was identified in this pass — worth a second look specifically for closed/private
  LinkedIn or Facebook groups, which often exist for this kind of niche trade community but don't
  surface in general web search.

---

## 3. Brand & positioning

**Positioning statement (working draft):**
> Tender Ready is the AI compliance and opportunity engine for South African companies that live or
> die by tenders — built so the thing that disqualifies an experienced bidder at 11pm the night
> before closing never happens to you again.

**What this is NOT:** a document-management tool, a generic proposal tool, a workflow tracker with AI
bolted on as a feature. **Correction from an earlier pass**: several competitors (TenderFlow,
AITenders, TenderProSA — see Part 1's now-complete table) do have real AI features, so "nobody else
has AI" is not a safe or honest claim to lead with. The real, checkable wedge is narrower and
stronger: nothing found combines *automatic, workflow-embedded* compliance checking (not a chatbot you
have to remember to ask), CV tailoring, cover-page auto-fill, and a named SANRAL-specific schedule
engine, all in one product. Tender Ready's wedge is **compliance-and-opportunity intelligence that's
built into the submission itself** — catching the B-BBEE/JV/certificate failure before submission
without the user having to prompt an AI to check, and telling a company which tenders are actually
worth bidding on before they spend the hours.

**Tone:** plain, direct, evidence-literate — this market has seen a lot of vague "digital
transformation" sales pitches and is skeptical of hype, especially AI hype, in compliance-critical
work. The real court cases above are more convincing than any adjective. Lead with specifics, not
superlatives.

**Visual/voice notes:** not covered in this pass — defer to whatever design-system work the product
already has (check `app/design/page.tsx` and existing UI conventions before inventing new brand
visuals from scratch; the product's own UI is already a brand surface).

**Messaging the "no feature gating" pricing structure itself:**
This is genuinely unusual — most SaaS gates *features* by tier and this product gates only *seats and
volume*. That's worth stating explicitly as a trust signal, not burying in fine print: "every plan
gets every AI engine — we don't hold back the thing that would have saved your bid for a higher
tier." Said as a deliberate, drawn-attention-to choice, it reads as a fairness signal that addresses
the "SaaS companies nickel-and-dime you" skepticism this market plausibly already holds.

---

## 4. General SaaS growth playbook, distilled for this situation

Sources here are a mix of credible-but-vendor-interested blogs (flagged inline) — directional, not
gospel, cross-check before over-indexing on any single number.

**What actually works 0→first 10-20 customers, solo/founder-led, no ad budget:**
Founder-led outreach and the founder's own network/referrals are consistently named as the dominant
early channel for bootstrapped B2B SaaS — not content, not paid ads, not a sales team. One 2026
channel-cost estimate (vendor-sourced, treat as directional): founder network/referrals ≈ R2,800/
customer-equivalent CAC for the first 10–20 customers, versus cold outreach ≈ R7,500 CAC for the
20–100 range. **Paid acquisition and broad content marketing are explicitly advised to wait** until
well past this stage (one source says $1M+ ARR) — not relevant to Tender Ready for a long while yet.

**Realistic timeline:** one vendor source puts "first paying customer to 100 paying customers" at
12–24 months for a typical seed-stage B2B SaaS. That's a useful outside-view sanity check against
the revenue-math scenarios in Part 0 — a ~35-client first milestone inside a year is plausible by
this benchmark; "100 clients" at the low end of that range (12 months) would be aggressive but not
unheard of for a product with this strong a compliance-evidence story in a niche market.

**Conversion/retention, honestly caveated:** no benchmark source found speaks directly to the
~R1,500–5,000/month price band or to this specific vertical. General B2B SaaS trial-to-paid ranges
cited: roughly 18% median (opt-in, no card required — which matches the 14-day-no-card trial
structure already decided on), with top performers at 35-45%. Logo churn benchmarks for small-ACV
B2B SaaS skew high (18-32% annual, one source), though vertical SaaS specifically trends lower
(7-12%, same source) — a strong case for staying genuinely vertical and not drifting toward
horizontal "proposal software for anyone."

**Pricing psychology notes directly applicable here:**
- The "most popular" badge on Professional (already the stated framing — "This is the plan most
  companies start on") is a well-evidenced anchoring tactic; keep it prominent on the pricing page,
  not just in sales conversation.
- Lead pricing-page copy with **outcomes**, not features — "never miss a compliance requirement
  again" beats "AI compliance engine" as a headline, with the feature name as supporting detail.
- The free trial's "one real bid pack" is a strong, concrete trial design — it gives a tangible
  deliverable rather than just time-boxed access. Make this the trial's headline promise in all
  marketing copy ("see a real submission come out the other end"), not a buried detail.

**Failure modes to actively avoid**, specific to a narrow vertical B2B SaaS: generic SaaS growth
advice (content flywheels, product-led self-serve virality, broad SEO) assumes either large search
volume or a product with built-in sharing/collaboration virality. This market is small, relationship-
driven, and not actively "shopping" online for this category in high volume — assume **outbound and
relationships will outperform inbound content for a long time**, and don't over-invest in content/SEO
before the outbound motion is proven.

---

## 5. Go-to-market plan

### 4.1 First 90 days — get to first 10-20 paying customers

*(Two-week sprints; a solo founder with AI assistance can realistically execute this.)*

- **Sprint 1-2**: Nail the pitch using the evidence in Part 2.3 (the real court cases). Build a
  one-page pitch/landing asset built around "the compliance failure that cost someone a R85m tender."
  Identify 30-50 target companies by CIDB grading band + sector, sourced from the CIDB register
  itself and LinkedIn. List-build, don't buy a list.
- **Sprint 3-4**: Founder-led outreach to that list — direct, personal, referencing something specific
  about each company where possible (a tender they're known to have bid for, their CIDB grade/sector).
  In parallel, reach out personally to 5-10 accountants/business consultants who serve this SME
  segment (SAICA/SAIPA-affiliated where possible) to explore a referral arrangement — they have
  existing trust with exactly this buyer and no competing product of their own.
- **Sprint 5-6**: Convert the first handful of trial users into vocal, specific case studies/
  testimonials. A single "we would have been disqualified and didn't know it" story from a real SA
  company is worth more than any ad spend at this stage.
- **Sprint 7-8**: Widen outreach based on what worked in sprints 3-4 (channel evidence, not guesswork)
  - likely more of whichever of {direct outreach, accountant referrals, industry-body contact} produced
  the first conversions, cut whichever produced nothing.
- **Sprint 9-10 (and ongoing)**: Direct contact with SAFCEC, Master Builders regional MBAs, and
  relevant chambers — not for a membership directory (none is public) but to explore being featured,
  speaking, or sponsoring a small local event. This is slower but compounding and credibility-building
  in a trust-driven market.

### 4.2 Scaling beyond first traction, toward 100 clients / R100k–R500k/mo

- Once a channel is *proven* (not just tried) — i.e., it has produced several paying customers at a
  CAC that makes sense against a R1,490-4,990/mo subscription — put more founder time into it before
  diversifying further.
- **First hire** consideration point: once outbound + referrals are producing more qualified
  conversations than the founder can personally run, not before. A dedicated tender-administrator-
  turned-salesperson (someone who's lived this pain) could be a uniquely credible first sales hire in
  this market.
- **Paid acquisition**: hold off, per Part 4's "wait until well past $1M ARR equivalent" guidance -
  this market's buyers are not likely to be well-targeted by broad paid channels, and the budget is
  better spent on founder time and relationship-building at this stage.
- **Content/SEO**: worth a slow-burn parallel investment once outbound is running (e.g. content
  targeting "CIDB grading," "SANRAL tender requirements," "B-BBEE certificate tender disqualification"
  - searchable, evidenced, specific terms this ICP plausibly searches when panicking about a real
  compliance question) — but per Part 4, don't expect this to be the primary growth engine for a long
  while.

### 4.3 Using public tender data as a lead source — flagged for the founder's own judgment, not decided here

The eTender Publication Portal is the free, central, national channel where government bodies post
tenders, corrigenda, **and award notices**. Disclosure of unsuccessful bidders is inconsistent and
institution-by-institution (SARS discloses only successful-bidder awards; the Housing Development
Agency separately lists both successful and unsuccessful bidders per closed tender) — there does not
appear to be one clean national list of "companies that bid and lost." Building an outbound list from
this is *possible* in principle (an unsuccessful bidder is a near-perfect prospect — they're already
proven to bid, and just lost) but:
- It would need to be assembled institution-by-institution, which is real, non-trivial manual/
  scripted effort, not a single data pull.
- There's a judgment call here that is explicitly **not** being made in this document: is cold outreach
  to a company identified as "you lost tender X" appropriate, or does it read as presumptuous/
  invasive given it's using information about a specific loss? This is a tone and ethics call, not a
  legal one as far as this research found (the data is public), and it's the founder's call, not an
  autonomous decision — flagging it here rather than building it.

---

## 6. Open items / next refinement pass

- [x] **Competitive landscape, fully researched this pass** (direct vendor pricing pages): TenderFlow
  (free/R1,900/R3,500), AITenders (R199/mo), TenderProSA (from R299/mo), BidsStack (R300/mo, plus an
  unpriced TenderScout product). The earlier "nobody else does AI" claim was corrected — several
  competitors have real AI features; Tender Ready's defensible wedge is narrower (see Part 1/3).
- [x] SAFCEC's Emerging/Established turnover cutoff — confirmed directly: Emerging is CIDB grade
  1-5 and/or turnover under R1-5m, Established is grade 6-9 and/or turnover over R6m.
- [x] Closed/private LinkedIn/Facebook/WhatsApp groups for SA tendering SMEs — two search passes
  found no public trace of one. Treat as a dead end for web research specifically; ask early
  customers instead (see Part 2.5).
- [x] L2B's current public pricing — confirmed (~R1,426/mo ex VAT, SA-only tier) and it's a
  listing/alert feed, not a bid-prep competitor — see Part 1.
- [ ] **BidsStack's TenderScout pricing** — the one named competitor whose positioning most directly
  overlaps Tender Ready's compliance framing, but no price was found; worth a follow-up check.
- [x] **Which pricing scheme is real — confirmed by Sarel directly, 2026-10-22**: Starter/
  Professional/Business/Enterprise, as this document always used. The homepage and billing code
  (which had drifted to a different, older scheme) are now reconciled to match — see
  `docs/specs/System-Status.md` and PR #71.
- [ ] Revenue-math scenarios in Part 0 assume a tier distribution that is itself an assumption (40/45/
  12/3 split) — revisit once there's real trial/conversion data from the first cohort of actual
  customers, rather than a modeled guess.

## 7. This pass's refinement notes (2026-10-22 ~00:30 UTC)

This pass did two things: (1) folded in the pricing conflict discovered by this session's own standing
code-review pass (a different, separately-verified finding, not marketing research — see the flag at
the top of this document) and (2) actually completed the competitive-landscape research the previous
draft had only assumed would land from a background pass that, on inspection, never delivered usable
findings (it drifted into unrelated work). Every competitor's pricing/features above came from this
pass's own direct vendor-site searches and fetches, not secondary sources.

**Stopping here rather than chaining another overnight pass**: the single biggest named gap
(competitive landscape) is now filled with real, multi-source data, and the one major finding
(positioning needed correcting — several competitors DO have AI features) has been folded into both
Part 1 and Part 3. The pricing conflict is resolved (Sarel confirmed directly, 2026-10-22; PR #71
reconciled the homepage and billing code to match — see the flag at the top of this document). What
remains open (BidsStack's TenderScout price, the tier-distribution assumption) isn't something another
research pass can resolve — both need real product/trial data that doesn't exist yet. This document is
ready to present as a solid first draft, with no open blocker left.
