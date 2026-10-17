# Tender Tool – Competitor Feature Deep-Dive & Phased Feature List

Oct 15, 2026 · @Sarel

## Summary

The niche still holds, but it is narrower than we said by voice: nobody I could verify matches a tender's requirements to the right CVs, reformats them, and merges your existing loose files into one submission pack for South African tenders. Every other piece (discovery, deadlines, compliance tracking, AI analysis) is already sold locally.

## Product stance: SaaS from day one, Sarel's requirements set the priority order

This is being built as a multi-tenant SaaS product, not a one-off application for a single client. "Build for my requirements first" means something specific: Sarel's own SANRAL, ACSA and SASSA tenders decide which features get built first and prove that each one works, not that the product is designed only for him.

What this means in practice:

- **Prioritisation, not scope-narrowing:** his real tenders choose the order of Phase 1 features (per the combined feature list) and supply the test scenarios (per the build-discipline section above). A feature is not added just because a future customer might want it; it is added because Sarel's own tenders need it next.
- **Architecture assumes other tenants from the start:** data model, storage and access control are built for multiple separate companies' documents and CVs from the first version, even while Sarel is the only user. Do not hard-code assumptions that only his company, his CVs, or his SANRAL account exist.
- **Generalise the document handling:** the SANRAL, PDF and Word template work (build-discipline section) is built so another company's templates could be added later without a rebuild, even though only Sarel's own templates are used to build and test it now.
- **Pricing stays deferred, not decided:** as agreed, no pricing work now. This does not change the SaaS architecture decision above.

If this stance changes later, the Phase 1 scope and the architecture choice should both be revisited together, since they were decided as one piece.

Two things I told you earlier were wrong or too strong:

- **A local tool does export a bid pack.** TenderProSA lists a PDF export with table of contents, page numbers, separated technical, pricing and compliance sections, and digital signatures ([features page](https://tenderprosa.co.za/features)). It is built for construction BoQ pricing and I found no CV feature, so the gap is CV matching and merging your own files, not "any pack export".
- **The R300 to R800 per month SME band is already occupied**, and cheaper in places. TenderProSA is R299 to R799 per month; Tender Aid is R699 per year. The mid-market locals charge more: TenderFlow R1,900 per month; AITenders' current site shows R199 and R899 per month. Price cannot be the differentiator on its own.

What to build first, in one line: CV library, requirement-to-CV matching, CV reformatting to the tender's template, and a one-click merge of CVs plus compliance documents into one ordered PDF. Deadline tracking is included as supporting table stakes. HR, resource allocation and project finance stay on the later roadmap.

Not verified: I could not find any live page for Tenderplus.io or Track My Tenders, so they are not in the tables below.

## Guiding goal: save time and get tender work done efficiently

Every feature earns its place by cutting the hours spent per tender; anything that does not is deferred. The pain Sarel described is finding the right CV, reformatting it, and gathering loose files into one pack, so those steps are measured first.

| Measure | How to capture it | Target to set |
| --- | --- | --- |
| Hours from tender received to pack ready | Time two or three recent tenders by hand now, as the baseline | Set after baseline; the product should beat it clearly |
| Minutes to choose and reformat key-person CVs | Time it per tender | Set after baseline |
| Minutes to assemble and check the final PDF | Time it per tender | Set after baseline |
| Documents re-entered per tender | Count repeated company details | Zero: entered once, reused |

No time-saving figures are claimed in this document: none of the competitor pages I opened published a measured saving I could verify, so the baseline must come from Sarel's own tenders.

### Manual step each feature removes

Phase 1 and 2 features, with the manual task each one replaces. Time saved is described, not quantified, until the baseline above is measured. Item numbers match the combined feature list.

| Item | Feature | Manual step it removes |
| --- | --- | --- |
| 1 | Document vault with expiry dates | Hunting through folders and email for the latest certificates; noticing too late that one has expired |
| 2 | CV library with structured fields | Opening old CVs to remember who has which experience |
| 3 | Tender upload and requirement extraction | Reading a long tender document to build the list of required documents and key-personnel needs |
| 4 | Staff-to-requirement matching | Deciding by memory or by rereading CVs who fits each key-person role |
| 5 | CV reformatting to the tender template | Retyping or restyling each CV by hand for every tender |
| 6 | Ordered pack builder with merge | Dragging loose files into one PDF, ordering them, and adding page numbers |
| 7 | Pre-submission check | Manually checking that every document is present and still valid on the closing date |
| 8 | Deadline and milestone reminders | Keeping closing dates, briefings and clarification deadlines in a separate calendar or spreadsheet |
| 9 | Reuse of past submissions | Starting each pack from scratch |
| 10 | Pipeline board | Tracking submitted and won tenders in a spreadsheet |
| 12 | SBD form fill | Retyping company details into the same forms for every tender |
| 13 | SANRAL template automation | Selecting hundreds of dropdown entries by hand and generating the PDF print reports one at a time |
| 14 | B-BBEE and CIDB checks | Checking by hand whether the company qualifies for a tender |

The efficiency case rests on repeated company and CV data being entered once and reused across every tender, so the product's value grows with each additional tender a customer submits.

## Design priority: UI and UX from day one

UI and UX are a non-negotiable priority from the first build, and possibly the main selling point: Sarel wants the product modern, clean and enjoyable to use, so people choose it over tools that do roughly the same things.

Plain rules for the build, drawn from the earlier design research in the voice chat (not re-checked in this document):

- **No training needed.** No mandatory tutorial; help appears in place, such as a hover tip.
- **Show the next decision only.** New users see the minimum for their next step; more appears as they go.
- **Start view by role.** A tender manager and an admin capturing documents open to different screens.
- **Proactive but calm.** The app flags an expiring document before the user looks, without alarming or black-box wording.
- **Basics done well.** Consistent layout, clear labels, little clutter, subtle polished transitions.

Competitor interfaces were not assessed in this research. Before design starts, screenshot the trial flows of TenderFlow, TenderProSA and Tender Aid and note where each takes the most clicks to produce a pack. Design acceptance criteria for Phase 1 (for example, a new user builds a pack without help) should be written before any screens are built.

### Scope discipline: a specific process, not a general platform

Sarel's explicit instruction (2026-10-16): this is **not** an ERP system that has to accommodate hundreds of fields and arbitrary processes. It automates one specific, already-known process - a known buyer's known document set, known required information, known steps. Design and build like that's true:

- **No field or screen earns its place just because "a system like this might need it."** Every field captured must map to something a real generated document or a real decision actually uses - check against the real schema (`app/supabase/migrations/`) and the real templates (`templates/forms/`) before adding one, not against what a generic tender-management product might offer.
- **No flow for a case that doesn't happen.** Don't build configurability, multi-path branching or settings for hypothetical future buyers/processes Klipcorp doesn't actually work with yet - extend when a real one shows up, not before.
- **Every screen should feel like it was built for exactly this job**, not adapted from a general-purpose records system. If a screen reads like a generic CRUD admin panel, it's wrong, even if it's "complete."
- **Prefer fewer, sharper screens over more, flexible ones.** The win over a general tender-management tool is depth on this one process, not breadth.

### CVs: upload once, never recapture

A specific, named pain point (Sarel, 2026-10-16): nobody wants to retype a CV into form fields. CV capture must be upload-and-done:

- A person uploads their CV in whatever format they actually have it in (PDF, Word, scanned image - whatever exists), once.
- An AI step extracts the structured fields the `people` table and the tender forms actually need (qualifications, ECSA/SACPCMP registration + dates, project/reference history, years of experience inputs) from that document - the human never re-types what's already written on their own CV.
- The extracted result is shown back for a quick confirm/correct, not blind-trusted and not a second manual form to fill in from scratch - correcting a wrong field beats typing every field.
- Re-uploading a newer CV version should update the same person's record, not force recapturing everything again.
- This is the single most time-consuming manual step in the whole process today (CVs for every key person, on every tender) - solving it properly is worth real effort, more than most other individual screens.

**"Use as-is" option (Sarel, 2026-10-16):** AI extraction/reformatting must be optional, not forced. A company can upload a CV and have it used **exactly as uploaded**, with no AI interference at all - no re-extraction, no reformatting into one of `engine/cv/`'s templates. This is a real, separate path from both "AI-extracted into structured fields" (above) and "AI-generated tender-specific CV" (`engine/cv/generate_cv.py`'s `sanral_keyperson`/`world_bank` formats) - some buyers or some people's own CVs are already in a form the company wants submitted untouched, and the product must not force every CV through the AI pipeline. Concretely: the people/CV flow needs a per-upload choice (AI-extract and reformat vs. use this file as-is), and "use as-is" means the original uploaded file is what gets attached to a submission - not re-rendered, not re-typed, not run through `generate_cv.py` at all.

Not yet built as of 2026-10-16: `app/app/people/` currently has a manual add/edit form (real columns, no invented fields - see that page's own build notes), not CV upload/parsing yet. That's the gap to close, not a reason to add more manual-entry polish to the form itself.

### No AI-drafted narrative sections - and why: company voice, not AI blabber (Sarel, 2026-10-17)

**Explicitly removed from scope, not deferred:** item 16 in the phased feature list ("AI-drafted narrative sections: executive summary, methodology, capability statement") is cut, not postponed to a later phase. Sarel's own reasoning, direct quote: "We dont want every tender submission to look the same. Remember there might be 100 companies using the system and they cant all look the same. The tenders must not contain ai blabber." A generic AI-generated executive summary/methodology, run the same way for every tenant, produces exactly the homogenized, generic-sounding output this product must avoid - it would make every one of this product's customers' submissions readable as "AI-written" and interchangeable with each other, which is a real competitive and credibility risk for every company using this system, not a cosmetic concern.

**What replaces it: a company-level "how we work" profile that every engine actually reads from, not a free-text field nobody uses.** Concretely:

- Each company captures its own description of itself and its approach - in its own words, not a generic template: who they are, how they actually approach a tender/project (their real methodology, not a generic one), what makes their submission theirs. This lives on the company profile (alongside the Document Vault, office locations, etc.), is written once and reused, same "capture once, reuse everywhere" principle as the CV library above.
- **Every engine that produces company-facing or tender-facing output must read and apply this, not just the ones that happen to generate prose.** This is the actual spec correction: it's not "build a narrative generator that reads a company bio field" (that's just item 16 with extra steps) - it's "every existing and future engine (CV generation's cover-page framing, the pack builder's cover letter/transmittal content if any, the compliance report's own tone, any future narrative-adjacent output) must be customizable per company from this profile, so a Company A submission and a Company B submission produce genuinely different output reflecting each company's own real voice and approach, not the same AI-generated shape with different logos swapped in."
- This is explicitly a cross-cutting spec requirement, not a single feature/page: whoever builds or extends any engine going forward must check whether company-specific voice/approach data should flow into that engine's output, the same way "evidence-first, don't assume Klipcorp's data is universal" is already a cross-cutting discipline for this project.
- Keep this proportionate to what's actually used today - most of this product's real output (filled forms, CVs, compliance reports) is NOT free-prose narrative, so this is mainly a readiness requirement for when a genuinely free-text/narrative output point exists, plus the few output points that do have some company-specific framing today (e.g. `generate_cv.py`'s cover page). Don't build a narrative-generation feature just to have somewhere to use this field - that reintroduces exactly the "every submission looks the same" problem being solved here.

**Built 2026-10-17:** `companies.how_we_work` (migration `0030`), edited in the "How we work" section of the Company page. Audit of every current output point: `Company-Voice-Audit.md`. Result: no engine produces company-descriptive prose today, so nothing is wired in yet. The one real narrative point, SANRAL Form B4/B5, is written by hand on purpose.

**Standing discipline for anyone building or extending a company-facing or buyer-facing output** (same standing as "evidence-first, don't assume Klipcorp's data is universal"):

1. Before adding any text to a generated document, ask: is this text the same for every tenant? If it describes the company or its approach, it must come from `companies.how_we_work` (or another field the company filled in itself), not from a template sentence or an LLM.
2. Use the company's text **verbatim**. Don't paraphrase it, summarise it, "improve" it or extend it with an LLM. If it needs to be shorter for a particular form, show the company its full text and let it decide what to cut. The tool doesn't make that choice.
3. If `how_we_work` is empty, leave the spot visibly blank and add a to-do on the action checklist (provenance `missing`). Never fill in generic wording instead.
4. Text written to the company's own staff (completion guides, digests, the readiness report) isn't company voice, but it doesn't belong in the submitted documents either. Keep tool-internal wording (script names, file paths, scoring internals) out of anything the buyer sees. `Company-Voice-Audit.md` records one existing case of this, in the CV cover page.
5. When a new output point does use the field, add a row for it to `Company-Voice-Audit.md`.

### Onboarding: guided, not a wall of fields

Company onboarding (`app/app/onboarding/`) should stay true to the same discipline: the minimum to get a company into the system (today: just a legal name), with everything else - registration numbers, BEE, CIDB, bank details, documents - filled in progressively afterward through the Document Vault, never demanded upfront as a long signup form. A new user should reach something useful (their dashboard, a first tender to look at) in well under a minute, not after a multi-page intake form.

### Document expiry reminders, and a tender task/deadline timeline (Sarel, 2026-10-16)

Two related but separate gaps, both real, neither built yet:

**1. Document expiry reminders.** The Document Vault (`app/app/company/page.tsx`) already color-codes expiry (green/amber/red) when someone looks at the page, but that's passive - nothing actively tells anyone a document needs renewing with enough lead time. Needs a real reminder: before a tracked document (COID, B-BBEE, insurance, CSD, and anything else with a real expiry date on file) expires, by enough margin to actually get it renewed in time - not a same-day surprise. Same notification channel already built for the daily tender-watch email (`engine/discovery/watch_new_tenders.py` + the scheduled check-in that emails Sarel) is the natural reuse, not a new channel invented from scratch.

**2. A tender task/deadline timeline, standard steps plus manual ones.** Item 8 ("Tender record with closing date, briefing, clarification, submission and signature milestones; email reminders") is marked Existing (competitors have it) but isn't built here yet. What it needs to actually do:

- Standard tender milestones where the date is known (closing date - already captured; briefing/clarification dates - `assess_tender.py`'s signal extraction already detects "compulsory briefing mentioned" in a document, but doesn't currently capture the actual date; this needs extending or a manual entry point when extraction can't get the exact date).
- **Manual, tender-specific tasks** - real examples Sarel gave, to ground this rather than build an abstract generic task system: selecting a partner/subcontractor for a specific tender, sourcing the right product/material, arranging a reference letter or confirmation from an existing client, asking an existing client whether they're willing to act as a reference if the tender reaches a second stage. These don't follow a fixed template - the system needs a genuinely free-form "add a task for this tender" with a description and a due date, not a fixed dropdown of anticipated task types. (One example in Sarel's own words - "ask them if they're willing to do a sidewalk" - wasn't fully clear in the source transcript; whoever builds this should ask Sarel directly what that one meant rather than guess, but the general free-text task capability covers it regardless of the exact wording.)
- Each task (standard or manual) needs: a due date, a status (not started/in progress/done), and eventually a reminder before its due date - reusing the same reminder mechanism as the document-expiry reminders above, not a second parallel notification system.
- This lives at the tender level (`tenders/[id]`, the Tender Workspace page already built) - alongside the readiness report, not a separate disconnected page.

### Roles and the role-based daily digest (Sarel, 2026-10-16)

Sarel's own framing of the need, in his words: "some people might only do validation, some only updating of CVs, some the end-to-end process, some just the finances." He asked explicitly for roles to be defined for this one workflow before anything gets built on top of them - not a generic access-control system. Per the scope-discipline section above, this is deliberately **not** a general RBAC layer: five roles, each named for a real slice of the one process this product automates, not an abstract permission matrix.

**Where "role" actually lives, checked against the real schema first:** `company_members` (`0001_init_schema.sql`) already has a `role` column - `'owner' | 'admin' | 'member'`, a check constraint, no other values possible. That column is an **account-permission** role (who can manage the company record and billing, in effect), not a **workflow** role (what this person actually does on a tender day to day) - the two are different questions answered by the same English word. Nothing in the schema today captures the workflow question; `people` (the CV library of staff/candidates for key positions) is a different table entirely from `company_members` (the actual signed-in users) and has no role-like column that means this either. Part 3's migration adds a new, separate column for this rather than overloading `company_members.role` or repurposing it.

**Open question, flagged rather than guessed:** is a workflow role global per-user (one setting on the person's `company_members` row, same for every tender) or per-tender-assignment (a validator on this tender, the end-to-end owner on that one)? Nothing in the schema or the app today models "assigned to tender X" for a person at all - no `tender_assignments` table, no per-tender owner field anywhere in `0001`-`0008`. Building per-tender assignment now would be inventing a table Sarel never asked for and the product has no other use for yet (classic scope creep per this doc's own discipline section). **Decision made here, flagged for Sarel to confirm or override:** ship the role as global-per-user on `company_members` for now - the simpler, smaller change that still lets the digest work correctly for "some people only do X" - and revisit per-tender assignment only if Sarel says a single person genuinely plays different roles on different live tenders at the same time.

#### Part 1: the five roles

Named for what the person actually does in this one workflow, grounded in the pages and actions that exist or are specified above - not invented capabilities.

| Role | What they do (the real task) | Pages/actions they use | What they should be notified about, and why |
| --- | --- | --- | --- |
| **Full cycle** | Owns a tender start to finish: discovery through submission. The default today - every current page already behaves as if everyone is this role. | Everything: `/discovery`, `/tenders/[id]` (readiness report, pack actions), `/people`, `/company`, `/admin` (if also an account owner/admin). | Everything relevant to their tenders - new matching tenders, every document expiry, every task deadline, every readiness change, every submission due date. They are the one person who needs the whole picture, so the digest for this role is the least filtered of the five. |
| **Validator / reviewer-only** | Checks a compiled pack before it goes out - reads the readiness report (item 32) and the admin review console's judgment (item 31) for a tender already assembled by someone else. Does not compile a pack, does not touch CVs or company documents. | `/tenders/[id]`'s readiness report (read-mostly); `/admin` review console if also trusted with that. Not `/people`, not `/company` edit, not pack assembly actions. | Readiness-report flags (an `assumed_default` or `missing` field that needs a human call) and submission-due-soon, so they review at the right moment - not new-tender discovery (not their job to decide fit) and not CV-completeness or document-expiry detail (not what they're checking). |
| **CV / people-admin-only** | Manages the CV library - uploads, extracts, corrects, and keeps people's structured fields current (item 2). Doesn't touch company compliance documents or pricing. | `/people`, `/people/[id]` (add/edit, and the upload-once flow once built). Not `/company`, not finance fields. | Tender key-personnel requirements needing a CV match or showing a specialism gap (readiness-report rows that are about *people*, specifically), and any task on the tender-task timeline that's about a person (reference letter, CV for a new position) - not finance-document expiry, not the general "new tender discovered" fit signal (that's a discovery/full-cycle decision, not theirs to act on). |
| **Finance-only** | Handles bank, financial and tax documents - BEE affidavit, SARS TCS PIN, COID Letter of Good Standing, professional indemnity insurance, CSD, pricing-schedule-adjacent paperwork. | `/company` (the compliance-document fields that are financial/tax in nature). Not `/people`, not pack assembly, not discovery. | Expiry of financial/tax/compliance documents specifically (COID, BEE, SARS TCS, insurance, CSD) and submission-due-soon where a financial document or the pricing envelope is on the critical path - nothing about CV completeness, nothing about general tender discovery. |
| **Viewer / read-only** | Wants visibility without doing any of the above - e.g. a director who wants to know the pipeline is healthy, without acting on anything. | Read access to the pages above (`/dashboard`, `/discovery`, `/tenders/[id]`, `/company`, `/people`), no write actions. | A light rollup only, not the full detail any other role gets - what's new, what's overdue, nothing else needs action from them, so the digest for this role should be the shortest, not a filtered copy of someone else's. |

Explicitly not built as part of this: per-tender role assignment (see the open question above), any notion of a role hierarchy or permission inheritance, and any role beyond these five - if a sixth kind of person shows up in practice, add a sixth row here first, the same build discipline the rest of this document already follows.

#### Part 2: notification content matrix

What each role's daily digest email should actually *contain* for each event type - not a yes/no, the specific information. "—" means that role's digest omits the section for that event type entirely (not an empty placeholder - it is not shown at all, so the email stays short and role-relevant rather than a filtered copy of the full-cycle version).

| Event type | Full cycle | Validator | CV/people-admin | Finance-only | Viewer |
| --- | --- | --- | --- | --- | --- |
| **New matching tender discovered** (`assess_tender.py` verdict `strong_fit`/`possible`, per `watch_new_tenders.py`) | Full row: contract number, buyer, title, verdict, closing date, document link(s), the `reasons` list from `assess_fit()` | — | — | — | Count only ("3 new matching tenders this week") plus the single closest closing date, no detail |
| **Document expiring soon** (a tracked company document with a real expiry date, e.g. COID, BEE affidavit, SARS TCS PIN, professional indemnity) | Every tracked document inside its lead-time window, with days-left and the renewal action | — (not a validator's job to renew anything) | Only if the expiring document would block a *specific person's* registration/compliance being usable on a pack (since `0035`: a person's ECSA/SACPCMP registration lapsing or due for renewal - the only per-person expiry dates recorded) | Every financial/tax/compliance document inside its lead-time window - this is the core of this role's digest, same fields as full cycle | Count only, no document names |
| **Tender task/deadline approaching** (the task timeline - standard milestones and manual free-text tasks, per the spec section above once built) | Every task across every tender they're tied to, due date and status | Only tasks whose status affects whether the pack is ready to review (e.g. "awaiting reference letter" blocking submission) | Only tasks tagged as about a person (CV, reference letter, specialist confirmation) | Only tasks tagged as financial (pricing sign-off, bank-letter renewal) | — |
| **Tender readiness status changing** (a `field_provenance` row moving between confirmed/computed/assumed_default/missing, per item 29/32) | Every change, with the field name and old/new status | Every change - this is the core of this role's digest, since reviewing readiness flags is the job | Only changes to people/CV-sourced fields (a key-person CV field moving to missing/assumed_default) | Only changes to financial/compliance fields | — |
| **Submission due soon** (a tender's closing date inside a lead-time window, same style as the document-expiry lead time) | Every tender they're tied to, full detail | Every tender, since a validator's review has to land before this date | Only if a person-related item (CV, reference letter) is still outstanding against that date | Only if a financial document or the pricing envelope is still outstanding against that date | Count only, nearest date |

Grounding for the "—" cells: each is an explicit decision that this role's job (per Part 1's "what they do" column) has no action to take on that event, not an oversight. If a role turns out to need a signal marked "—" here, that's a Part 1/2 correction to make deliberately, not a default-to-everything fallback.

## UI/UX research and design framework

The research supports one design stance: make the product feel familiar, show one decision at a time, and let help stay optional. Each row below states what a source says, then how it applies to the tender tool.

| Principle | What the source says | Applied to the tender tool |
| --- | --- | --- |
| Progressive disclosure | Reveal complexity gradually; "each screen should present only the content needed for one task or decision"; hidden features must still be findable ([UXPin](https://www.uxpin.com/studio/?p=41489)). | Pack builder as a step-by-step flow: pick tender, confirm requirements, choose people, review pack, export. Advanced settings sit behind one visible control. |
| Match existing expectations | Users expect a product to work like the ones they already use; innovate only where the new interaction is intuitive and tested ([Helio on Jakob's Law](https://helio.zurb.com/ux-research/laws-of-ux/jakobs-law/)). | Use familiar patterns: left navigation, drag-and-drop upload, a checklist with ticks, a standard PDF preview. Spend the originality on the CV-to-pack flow, not on navigation. |
| Role-based start view | Segment dashboards by persona and tailor them in onboarding; customisation alone leaves many users to churn before reaching value ([insightsoftware](https://insightsoftware.com/blog/the-role-of-persona-segmented-dashboards-in-user-onboarding/)). | One question at signup ("What will you do most?"). Tender manager lands on the pipeline and next deadlines; document-capture person lands on the vault and expiring items. Allow a switch back to the default layout. |
| Optional, ambient help | Keep tours short (3 to 5 tooltips, about 140 characters each); full-screen takeovers only for required input; never put essential information in a tooltip ([Appcues](https://www.appcues.com/blog/user-onboarding-guide)). | Persistent setup checklist and a help button; hover tips for non-essential terms. No blocking walkthrough. One required first step: add company details. |
| Trustworthy AI | Show the plan before action, a short plain reason ("Because X, I did Y"), a confidence signal, an action log with undo, and ask when unsure ([Smashing Magazine](https://shop.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/)). Suggestions beat automatic actions; separate AI-generated from user content ([Goji Labs](https://gojilabs.com/blog/ux-patterns-that-increase-trust-in-ai/)). | Expiry flags read "B-BBEE certificate expires 12 days before closing date. Replace it?" with a button, not a red alarm. CV matches show why each person ranks where they do and a "low confidence" tag when a requirement is unclear. AI never edits a document without a preview and undo. |
| Polish and micro-interactions | Each micro-interaction needs a purpose; 200 to 500 milliseconds with smooth easing for most; consider users with visual, motor or cognitive impairments ([Cieden](https://cieden.com/book/sub-atomic/microinteractions/designing-neat-microinteractions)). | Subtle progress and success motion when a pack builds; reduced-motion setting; no decorative animation. Consistent spacing, labels and one visual language across screens. |

### Design vision for the core flow

1. **First run:** company details, then upload the first documents; the product shows the expiry dates it found.
2. **Home:** role-based; the single most useful next action is the largest element.
3. **New tender:** drop in the tender file; the product lists required documents and key-personnel needs.
4. **People:** upload a CV once in whatever format it's in, AI extracts the structured fields for a quick confirm (never a manual recapture form); ranked CV suggestions with reasons; the user picks; the CV is reformatted with a live preview.
5. **Pack:** ordered checklist on the left, merged PDF preview on the right; problems listed in plain words with a fix button.
6. **Export:** one button, with a clear "ready to upload" state.

### Phase 1 design acceptance criteria

- A new user builds a first pack with no tutorial and no help call.
- Every error message states what is wrong and offers a fix.
- Nothing the AI changes is applied without a preview and an undo.
- Every screen has one clearly primary action.

### Limits of this research

These are mostly practitioner and vendor blogs (UXPin, Appcues and insightsoftware sell related software), plus one Smashing Magazine article, so treat them as guidance, not measured proof. I did not read Nielsen Norman Group directly; Jakob's Law is cited through a secondary summary. Appcues does not say to avoid tours entirely; it says keep them short and optional, so the earlier voice summary ("avoid forced tutorials") is slightly stronger than the source. The figures (3 to 5 tooltips, 200 to 500 milliseconds) are one article's recommendations, not standards. None of this replaces testing with real tender staff.

## Competitor landscape

South Africa has at least five local tools at SME to mid-market prices, while the CV and proposal-automation tools are foreign and not localised. Prices are from vendor pages, in the currency shown there.

| Tool | Origin | Aimed at | Published price | Source |
| --- | --- | --- | --- | --- |
| TenderProSA | South Africa | Construction contractors, BoQ pricing | R299, R799, R1,999 per month (plus higher tiers) | [pricing](https://tenderprosa.co.za/pricing) |
| BidsStack | South Africa | Tender discovery and award intelligence | R300 (Starter), R750 (Pro) per month | [features](https://app.bidsstack.com/features) |
| Tender Aid | South Africa | Government bids, compliance vault | R699 or R1,749 per year; R799 once-off | [Capterra](https://www.capterra.com/p/10045780/Tender-Aid/) |
| TenderFlow | South Africa | Tender management for SA and Africa | Free; R1,900 per month; R3,500 per month; R12,000 or R25,000 per year | [site](https://www.tenderflow.co.za) |
| AITenders.co.za | South Africa (Cape Town) | Discovery plus bid management | R199 (Starter) or R899 (Pro) per month on its current site; R2,900 per month in a sponsored article | [eNCA](https://www.enca.com/promotions/local-ai-company-launches-platform-help-businesses-win-tenders-faster) |
| Flowcase | Norway | Consulting and engineering firms, CV and case-study database | Not published | [Flowcase](https://www.flowcase.com/cv-and-case-study-tool-for-enterprise-professional-services) |
| GovDash | US | US federal contractors | Quote only | [GovDash](https://www.govdash.com/proposal) |
| Loopio | Canada | Proposal teams, answer library | Quote only; third-party estimate about $20,000 per year, unconfirmed by Loopio | [SiftHub](https://www.sifthub.io/blog/loopio-rfp) |
| AutoRFP.ai | International | Teams handling 40 to 200 tenders a year | $899 or $1,299 per month | [AutoRFP.ai](https://autorfp.ai/blog/tender-software.md) |
| mytender.io | UK | Small to mid-sized bid teams | Not published | [Capterra](https://www.capterra.com/p/10031061/mytender-io/) |

Award intelligence (BidsStack Pro, AITenders) is not a data moat: checked 2026-10-17, the same award records are public on the eTenders portal's Awarded tab (35,316 awards, all buyers), and SANRAL additionally publishes every bidder's tendered price in its opening registers - see `Award-Outcomes-Findings.md`. Our capture of both is built (report-only, `award_outcomes.py`); what competitors add on top is storage, name matching and search, not access.

Caveats: Tender Aid's Capterra page shows zero reviews, and its "98% extraction accuracy" is the vendor's own claim. Loopio's limitations come from a competitor's blog. AutoRFP.ai's comparison page is written by AutoRFP.ai.

## Feature inventory across competitors

Discovery, deadlines and compliance tracking are widespread; CV tailoring and bid-pack export each appear in only one or two tools. "Offered by" lists only tools whose own page or listing I opened; a missing name means not found, not confirmed absent.

| Category | Feature | Offered by |
| --- | --- | --- |
| Discovery | Search and browse tenders by category, region, institution, value, deadline | TenderFlow, BidsStack, AITenders, TenderProSA, Tender Aid (eTenders.gov.za integration) |
| Discovery | Profile-based tender recommendations | AITenders, Tenders Agent (listing, India-priced) |
| Discovery | Keyword and saved-filter email alerts | BidsStack, TenderFlow |
| Discovery | Awarded-tender and competitor intelligence (winners, pricing patterns, history to 2018) | BidsStack Pro, AITenders |
| Tracking | Deadline reminders and calendar integration | TenderFlow, TenderProSA, AutoRFP.ai (portal extension) |
| Tracking | Working-day deadline calculator excluding SA public holidays | TenderFlow (free tool) |
| Tracking | Pipeline from discovery to submission, task owners, comments | AITenders, TenderFlow, Loopio (project management), Tender Aid (3-Gate workflow) |
| Tracking | Go/No-Go screening | AutoRFP.ai, GovDash ("Score & Decide") |
| Compliance | Document vault with expiry alerts (B-BBEE, tax, certificates) | TenderFlow, Tender Aid, TenderProSA |
| Compliance | CIDB grade check against tender value and work class | TenderProSA, TenderFlow (free calculator) |
| Compliance | B-BBEE preference-point calculation, SMME affidavit prep | TenderProSA, TenderFlow (free calculator) |
| Compliance | Eligibility and document-readiness dashboard against company profile | TenderFlow |
| Compliance | Audit trail for PFMA and MFMA | Tender Aid |
| AI analysis | Read tender PDF, extract requirements, criteria, deadlines | TenderFlow, Tender Aid, TenderProSA, AutoRFP.ai, mytender.io, GovDash |
| AI analysis | Compliance matrix traced to source clauses | GovDash |
| AI drafting | Cover letter, executive summary, capability statement, methodology | TenderFlow, mytender.io, AutoRFP.ai, GovDash |
| AI drafting | Method statements, quality plans, risk assessment | TenderProSA |
| Content library | Reusable approved answers and case studies | Loopio, AutoRFP.ai, mytender.io, GovDash (past performance) |
| Pricing | Automated BoQ pricing with SA rates, supplier RFQs, quote comparison | TenderProSA |
| CVs | Searchable CV and case-study database with master-data cleanup (TenderFlow has a simpler employee CV repository on paid plans) | Flowcase |
| CVs | Tailored CV versions per bid, aligned to RFP requirements | Flowcase |
| CVs | Score key personnel against requirements and show staffing gaps (resume-template filling not confirmed) | GovDash |
| CVs | Word, PDF, PowerPoint export with consistent templates | Flowcase |
| Pack assembly | PDF bid pack with contents page, sections, branding, digital signature, size optimisation | TenderProSA |
| Pack assembly | "Compile the bid pack" from verified repository documents (merge behaviour not described) | TenderFlow |
| Output | Word export; export in buyer's original format | TenderFlow (.docx); Loopio, AutoRFP.ai |
| Collaboration | Roles, version history, comment threads, approvals | TenderProSA, TenderFlow, Loopio, AutoRFP.ai |
| Integrations | Salesforce, Microsoft 365, SharePoint, Slack and Teams, REST API | Loopio, AutoRFP.ai, GovDash (Word add-in), Flowcase (API) |
| Platform | Android app with offline mode | TenderProSA |
| Security | POPIA and GDPR statement | TenderFlow |
| Learning | Paid tender course with AI tutor | TenderFlow Tender Academy (R4,995 once-off) |

Sources: [TenderFlow](https://www.tenderflow.co.za), [TenderFlow compliance guide](https://www.tenderflow.co.za/blog/tenderflow-product-comparisons/product-guides/how-tenderflow-simplifies-tender-compliance/), [TenderProSA features](https://tenderprosa.co.za/features), [Tender Aid](https://www.capterra.com/p/10045780/Tender-Aid/), [BidsStack](https://app.bidsstack.com/features), [AITenders](https://www.enca.com/promotions/local-ai-company-launches-platform-help-businesses-win-tenders-faster), [Flowcase](https://www.flowcase.com/cv-and-case-study-tool-for-enterprise-professional-services), [GovDash](https://www.govdash.com/proposal), [Loopio](https://www.sifthub.io/blog/loopio-rfp), [AutoRFP.ai and mytender.io](https://autorfp.ai/blog/tender-software.md).

## Gap analysis: where the niche is

The open space is the last mile between "we know what is required" and "one signed PDF ready to upload": picking people, reformatting their CVs, and merging your own documents in the right order. TenderFlow has an employee CV repository on its paid plans, but I found no South African tool that matches CVs to requirements or reformats them (absence is not proven).

| Gap | What exists today | What is missing | Confidence |
| --- | --- | --- | --- |
| Requirement-to-CV matching | Flowcase tailors CVs per bid and GovDash scores key personnel against requirements, both foreign and not localised; TenderFlow stores CVs | A local tool that reads the tender's key-personnel clauses and ranks your staff against them | Medium to high: TenderFlow stores CVs; no matching or reformatting found in any local tool, but absence is not proven |
| CV reformatting to tender template | Flowcase exports Word, PDF, PowerPoint templates; GovDash shows staffing gaps | Reformat to the specific format a SANRAL or ACSA tender demands, with gaps flagged | High for SA; medium overall |
| Merge your own loose files into one pack | TenderProSA exports a PDF pack of its own generated sections; TenderFlow says it compiles a bid pack but does not describe merging | Upload certificates, SBD forms and CVs, order them per the tender checklist, merge, number pages, one file | Medium: TenderProSA may cover part of this, and its pack merge behaviour on uploaded files is untested |
| Pack validation | Document-readiness dashboards (TenderFlow), pre-submission audit (Tender Aid) | Check the finished pack: expiry dates still valid at closing date, signatures present, page limits, file size | Medium |
| Non-construction focus | TenderProSA leans on BoQ pricing for contractors | Services, consulting and engineering tenders where CVs and experience dominate scoring | Medium |
| Price point | Locals range from R199 per month (AITenders Starter) and R299 per month (TenderProSA) up to R1,900 per month (TenderFlow Professional) | A price below TenderFlow and AITenders with CV and pack features | Low as a differentiator: R300 to R800 per month already has competitors |

What this means for scope: the two features competitors do not show are CV matching with reformatting, and ordered merge of uploaded documents into one validated PDF. Treat everything else as table stakes to match, not to win on.

To test before committing: take three of your real past tenders and check whether TenderProSA's trial or TenderFlow's bid pack would assemble the pack from your existing files. If either does, the merge half of the niche shrinks and CV matching carries the product.

## Later-phase roadmap (not in the first build)

Three later phases extend the same people-and-projects data the CV engine already holds; each enters a different competitive space and should start only after the earlier phase has paying users.

| Phase | Scope | Why it follows the core | Watch-out |
| --- | --- | --- | --- |
| A: HR-lite | Employee onboarding, self-service CV and credential capture, certificate and registration expiry reminders | Credentials feed CV matching and tender compliance, and an expired certificate can disqualify a bid | Flowcase's page does not describe certification tracking, so the closest direct comparison is thin; leave management would meet established SA payroll and HR tools (named earlier by voice, not researched here) |
| B: Resource allocation | Assign people to won projects, availability and utilisation view, capacity check against the tender pipeline | Won tender becomes a project that needs staffing | Mature resource-planning tools exist; keep it to "can we staff this bid?" |
| C: Project financials | Budget versus actual, margin against the bid price, cost per person | Links bid price to delivered margin | Largest scope; accounting integration is a separate product |
| Optional: Leave | Leave balances and requests | Natural once employee records exist | Different competitive set; defer until A has users |

## Combined feature list, phased

Phase 1 is the narrow niche you can use on your own tenders; Phase 2 adds the table-stakes features a paying customer expects; Phases 3 onward are the roadmap. "Type" says whether competitors already have it (Existing), nobody local does (Gap), or it is roadmap.

| # | Feature | Type | Phase |
| --- | --- | --- | --- |
| 1 | Company document vault with expiry dates: CIPC registration, CSD summary, SARS tax status, B-BBEE affidavit or certificate, bank letter, CIDB, COID, ID copies | Existing | 1 |
| 2 | Staff CV library with structured fields: qualifications, registrations, project experience, years per skill. Must be upload-and-AI-extract, never manual recapture - see "CVs: upload once, never recapture" above (flagged 2026-10-16, highest-effort-justified gap in the people flow) | Gap (local) - `app/app/people/` has manual add/edit today, CV upload/AI extraction not yet built | 1 |
| 3 | Upload a tender and extract its required documents, forms and key-personnel requirements | Existing | 1 |
| 4 | Match staff to key-personnel requirements and rank them, with reasons and gaps | Gap | 1 |
| 5 | Reformat chosen CVs into the tender's required template, output PDF and Word | Gap | 1 |
| 6 | Ordered pack builder: arrange vault documents, CVs and completed forms per the tender checklist, merge into one PDF with contents and page numbers | Gap | 1 |
| 7 | Pre-submission check on the pack: documents valid on the closing date, missing items, file size and page limits | Existing (partial) | 1 |
| 8 | Tender record with closing date, briefing, clarification, submission and signature milestones; email reminders | Existing | 1 |
| 9 | Reuse of past submissions: copy a previous pack as the starting point | Gap | 2 |
| 10 | Tender pipeline board: found, bidding, submitted, won, lost; submitted and won history | Existing | 2 |
| 11 | Tender discovery: continuously scrape public portals (eTenders, provincial, municipal, SANRAL's own listings), store a full opportunity database, download each tender's own documents and forms, and auto-check new tenders against the vault and CV library to flag readiness gaps (see build shape, stream 5) | Existing | 2 |
| 12 | Fill standard SBD forms from company data (SBD 1, 4, 6.1, 8, 9) | Gap (to verify) | 2 |
| 13 | SANRAL template automation: fill SANRAL's macro-heavy Excel tender workbook from stored company data and the key-person CV, then generate its PDF print reports (see the SANRAL section below) | Gap | 2 |
| 14 | B-BBEE points and CIDB grade checks against a tender | Existing | 2 |
| 15 | Team roles, comments, version history | Existing | 2 |
| 16 | ~~AI-drafted narrative sections~~ - removed from scope 2026-10-17, see "No AI-drafted narrative sections" above: replaced by a per-company "how we work" profile every engine must read from, not a generic generator | Removed | - |
| 17 | Awarded-tender and competitor intelligence | Existing (competitors); capture built 2026-10-17 (report-only) - `engine/discovery/award_outcomes.py`: eTenders portal Awarded tab (all buyers, winner/amount, some bidder lists) and SANRAL tender opening registers (every bidder and price). No storage/UI yet - see `Award-Outcomes-Findings.md` | 3 |
| 18 | Go/No-Go scoring | Existing (competitors); built 2026-10-16, hardened 2026-10-16 - `engine/discovery/assess_tender.py`, category + eligibility signals + fit verdict against a company profile loaded from the tenant's own profile JSON (not a hardcoded company), run against the widened national discovery feed (item 11). Hardening pass: closed-tender short-circuit (no wasted document fetch), duplicate-release removal upstream in `etenders_national.py`, multi-document handling per tender, graceful degrade on a failed/corrupt document download, and the OCDS `mainProcurementCategory` folded in as a fallback label when keyword categorisation finds nothing | 3 |
| 19 | Case-study and past-project library with tailored write-ups | Existing (Flowcase, GovDash) | 3 |
| 20 | Employee onboarding and self-service CV and credential capture | Roadmap (HR-lite) | 4 |
| 21 | Credential and certificate expiry reminders per person | Built 2026-10-17 for ECSA and SACPCMP (the only per-person registrations the schema records): migration `0035` adds `people.ecsa_expiry`/`sacpcmp_expiry`, `watch_deadlines.py` reminds through the same window and seen-store as the company vault, expiry badges on the People pages, routed to full-cycle and CV/people-admin digests. Other professional bodies (SACAP, SACPLAN, ...) still have no registration columns | 4 |
| 22 | Leave management | Roadmap (optional) | 4+ |
| 23 | Resource allocation and utilisation across projects | Roadmap | 5 |
| 24 | Project financials: budget versus actual, margin against bid | Roadmap | 6 |
| 25 | POPIA-compliant storage of ID copies and personal data (needed from Phase 1 because the vault holds them) | Existing | 1 |
| 26 | Record who on the team submitted each tender, and any revenue-share or commission tied to that person | Gap | 3 |
| 27 | Record the company's own submitted price per tender, building an internal pricing history by tender type, client and sector | Gap | 3 |
| 28 | Capture public award outcomes (winner and price) from buyers that publish them, such as SANRAL, to show market-pricing trends | Gap; capture built 2026-10-17 (`award_outcomes.py`, report-only), storage + trend view pending Sarel's call on SANRAL's "no charge to recipients" term - `Award-Outcomes-Findings.md` | 3 |
| 29 | Field-level provenance tagging on every generated value: confirmed, computed, assumed-default, or missing - the data foundation items 30-32 below depend on | Built (CLI/engine layer; Supabase table only, not yet wired to the web app) | 1 |
| 30 | Admin test-company harness: every open tender automatically runs full pack generation against several test companies loaded in for this purpose at different data-completeness levels | Built (CLI: `engine/admin_harness.py`; "automatically" on discovery, and the web console in item 31, are not yet built) | 2 |
| 31 | Admin review console: visual queue of every test-company generation result, for Sarel to confirm correctness before a real customer relies on that tender template | Gap | 2 |
| 32 | User-facing tender readiness report: before and during pack generation, a plain breakdown of what's already known (with the value), what's missing, and what's uncertain and needs review | Gap (the data it would read already exists, per item 29) | 1 |
| 33 | Leads and informal quotations pipeline: a lighter-weight track alongside formal tenders for informal work - someone asking for a quote, a partnering/JV lead, a follow-up with an individual contact - with just a contact, what they're asking for, status (new -> quoted -> follow-up -> won/lost) and a next-action date. Deliberately NOT the documents/forms engine (items 6, 13 etc.) - no pack generation, no SANRAL-style forms, just tracking so nothing falls through the cracks. Same pipeline concept as item 10 (tender pipeline board), different lane within it, not a separate tool - flagged 2026-10-16, explicitly a later item, build only once the core tender workspace (discovery, readiness report, document vault, people) is proven out in daily use | Roadmap (explicitly deferred - not for the initial build, Sarel's own call) | 3 |

Access to external data is the main risk to Phase 2: portal scraping terms and eTenders access need checking before item 11 is promised, including whether each portal's terms of service permit downloading its documents, not only listing its tenders. Item 12 needs checking that the SBD form templates can be filled legally and reliably; I did not verify that any competitor does it.

**Item 11 update (checked 2026-10-16):** eTenders.gov.za is not scraped at all - National Treasury runs a public OCDS (Open Contracting Data Standard) API at `ocds-api.etenders.gov.za`, confirmed live: no authentication, no robots.txt entry, no terms-of-use page found anywhere on the site, and every response is explicitly licensed under the Open Data Commons PDDL (public-domain-equivalent). This is a different situation in kind from SANRAL's own reCAPTCHA-protected site, not a workaround of it - it's a government API built for exactly this kind of reuse. Implemented in `engine/discovery/etenders_national.py`. Two real limits confirmed by direct testing, not assumed: `tender.status` is an empty string on every release sampled (use `tenderPeriod.endDate` vs today instead), and the API itself returns HTTP 500 after roughly 500-600 records regardless of date range - a real upstream limitation that narrower date windows work around, not a bug in this client. **Item 28 (award/price capture)** is the same API's `awards`/`contracts` fields in principle, but confirmed empty on every one of 500 sampled releases across two different date windows - this matches, rather than contradicts, the Open Cities Lab finding already cited above that award-stage fields are rarely completed. The module reports whatever award data a release actually carries, but it will come up empty for the large majority right now; this is a real data gap in what buyers publish, not something more scraping would fix.

**Item 28 update (checked 2026-10-17):** re-confirmed on 800 fresh OCDS releases across five windows (Nov 2025 - Oct 2026): still 0 awards, 0 contracts, 0 tenderers, 0 values. But the 2026-10-16 conclusion above was too narrow: the gap is in National Treasury's OCDS *export*, not in what buyers publish. The eTenders portal's own public "Awarded" tab holds 35,316 awards (winner, amount, date; some with the full bidders list), each joinable to its OCDS release (`ocds-9t57fa-<portal id>`), and SANRAL's own awarded and closed tender pages publish the tender opening register - every tenderer and price - including Klipcorp's own consulting tenders (NRA 2026/0084(B) lists Klipcorp beside 10 competitors). Neither source needs a login or touches a CAPTCHA; SANRAL's Terms & Conditions permit reproduction with acknowledgement and "no charge ... upon any recipient". Captured by `engine/discovery/award_outcomes.py` (report-only). Evidence, data quality and open decisions: `docs/specs/Award-Outcomes-Findings.md`.

## Build discipline: finish and test before moving on

Even within Phase 1, build one feature at a time, test it properly against real tenders, and only then start the next. Do not run two features in parallel at half-finished quality.

- **Order inside Phase 1:** document vault, then tender upload and requirement extraction, then CV matching, then CV reformatting, then pack merge, then the pre-submission check. Each one should work reliably on a real tender before the next starts.
- **"Properly tested" means:** run it on at least 2 or 3 of Sarel's own real tenders (SANRAL, ACSA, SASSA), not a sample file, and check the output by hand against what he would have produced manually.
- **Gate before moving on:** a feature is done when it produces a correct result unattended on a real tender, not merely when the code runs.
- **Applies to SANRAL automation too:** treat it as its own feature inside item 13, built and tested on its own before anything else in Phase 2 starts.

* **Applies across file types, not only SANRAL's Excel workbook:** the same template-by-template, field-by-field approach applies to any tender document type Sarel works with, including PDF forms (often fillable fields, or static layouts that need populating and flattening without losing the form's structure) and Word templates (placeholder text or tables that need company and CV data dropped in without breaking formatting). For each document type: get a real blank example, map which fields are constant (company details, key-person CVs) versus tender-specific (project name, number, dates), then test against Sarel's real past submissions before trusting the output.

## Build shape: five streams

The build breaks into five streams. The first four are ordered; Sarel's own tenders set the pace and supply the test cases, per the build-discipline rule above. Stream 5 is lower priority than streams 2 to 4, because discovery and tracking are already well covered by competitors (see the feature inventory); the CV and pack work is the niche and the reason to build this at all.

1. **Foundation:** multi-tenant data model, authentication, and the document vault with expiry tracking. Everything else depends on documents already being stored against the right company.
2. **Tender intake:** upload a tender document, extract its requirements. Real tenders become the test cases here.
3. **CV layer:** the CV library, requirement-to-CV matching, and reformatting. This is the core niche.
4. **Pack builder:** merge documents and CVs into one ordered, validated PDF, plus the pre-submission check.
5. **Discovery, wired to the vault and CV library, not a standalone feed:** continuously search and store tenders from public portals (eTenders, provincial, municipal, SANRAL's own listings) to build a full opportunity database. Download the tender's own documents and forms as part of discovery, not only its listing, so the full pack is already in the system before a customer logs in; a customer can still upload their own copy, but the product is not dependent on that upload. As each new tender arrives, run it through the same checks as a manually uploaded one: match it against stored CVs and compliance documents, and flag or fix what is missing or needs attention automatically, rather than waiting for a customer to upload a tender and ask. This turns discovery from a list of opportunities into an automatic readiness check, with the paperwork already in hand, on every one.

SANRAL, PDF and Word template automation (see the build-discipline section) runs alongside these as its own stream, tested separately once blank examples are available.

**Open items for stream 5, to settle before building it:** which portals to start with (SANRAL's own listings first is the closest fit to Sarel's immediate need); whether each portal's terms of service permit scraping, checked before building against it; and how to avoid duplicate or stale listings across portals.

## Admin maintenance console and tender readiness reporting

Raised 2026-10-16: Sarel needs a way to maintain the app himself as new tenders and new SANRAL template versions arrive, without waiting for a real customer to hit a broken field first. This is two views onto one underlying mechanism - an admin-facing QA harness, and a user-facing readiness report - so they are specified together rather than as separate features.

### The shared foundation: field-level provenance, not just a filled document

Every value this product writes into a document already comes from one of a small number of sources - the fingerprint check (`engine/fingerprint.py`), the pack generator's suggest/confirm flow (`engine/pack_generator/`), the financial-hours capture (`engine/fill_financial_hours.py`, which already refuses to fill a value that is still null rather than silently writing zero) all already distinguish "known and confirmed" from "not yet known" internally. What's missing is making that distinction a first-class, queryable part of the data model instead of something each script handles its own way. Every generated value needs one of four states, recorded alongside it, not just inside a comment or a console warning:

- **Confirmed:** came from a value a human explicitly entered or approved for this company (a CV field, a confirmed key-person assignment, a captured hours figure).
- **Computed:** derived mechanically from confirmed values with no judgment call (years of experience from a graduation date and the tender's closing date is the existing example - see `klipcorp_profile.json`'s own note on why this is never stored as a static number).
- **Assumed-default:** filled with the best available answer when nothing on file contradicts it, but not independently re-verified for this specific submission (the SBD4 "No" answers in `fill_a_forms.py` are the existing example - each one is also a named line on `ACTIONS_TO_SIGN.md`, which is this same idea, just not yet a structured field).
- **Missing:** genuinely not available - left blank in the document, listed as an action item.

This status already exists, scattered across module docstrings and checklist files. Item 29 above is making it one consistent structure (most naturally: a column or side-table alongside `generated_documents` and `financial_captures` in the Supabase schema) that both views below read from, rather than four different scripts each inventing their own way to say "I'm not sure about this."

### Admin side: a test-company harness and review console (items 30-31)

**The harness:** maintain several test companies in the same `companies` table as real tenants (a simple `is_test_company` flag, never surfaced to real users or counted in any customer-facing report), each representing a different realistic completeness level - for example: a company with every document and CV complete and current; one with an expired certificate (COID, B-BBEE) to prove expiry checks actually block instead of silently passing; one with no confirmed specialist for a position the tender requires, to prove the specialism-warning path still fires; one brand-new company with almost nothing on file, to see what the product does with the worst case rather than only the best one. Every time stream 5's discovery picks up a new tender, or the fingerprint check on an existing tender's template comes back changed (not just "first seen" - an actual MISMATCH, which today stops the pipeline and prints a diff, per `fingerprint.py`), the harness runs full pack generation for every test company against it automatically, before any real customer's data goes anywhere near that template.

**The review console:** a visual queue, not a log file - each test-company-×-tender run shows its generated documents inline (same rendering the user-facing document review screen already uses, per the `DocumentReview.dc.html` design) alongside its provenance breakdown, so Sarel can actually look at the filled Technical Submission or A-Forms bundle and confirm it reads correctly, not just that the script exited 0. A run is flagged for review whenever: a confirmed/computed field came out empty where the test company's own data should have produced a value (a real bug); an assumed-default fired somewhere it hadn't before (SANRAL added a new declaration, for instance); or the fingerprint check's warning path fired (the known-noisy macro-hash signal, say) on a template that hadn't shown it before. Sarel clears a flagged run by marking it reviewed, which is the record that this tender/template combination is now trusted for real customers - not an assumption baked into the code.

### User side: the tender readiness report (item 32)

The same provenance data, read by a real customer instead of Sarel, answering the exact question in his request: *what's going into this tender, where did it come from, and what do I need to do about it.* Shown before a customer commits to starting a pack, and kept visible while they work on it - not a one-time gate. Grouped the same way the provenance states are defined above:

- **Already have it** - the field and its actual value, so the customer can skim and object to something wrong before it's buried forty pages into a filled workbook, not catch it on the printed copy.
- **Missing - needs your input** - exactly what item 32's own existing cousins already do (the financial-hours capture's refusal to fill a null, `ACTIONS_TO_SIGN.md`'s per-form checklist): named fields, not a vague "incomplete" badge.
- **Uncertain - please review** - an assumed-default or a specialism-style warning, with the reason stated plainly (why the product picked this answer, and what evidence would change it), so the customer makes the actual call instead of trusting a silent guess.

This is the same pre-submission check already named as item 7, widened from "is everything present" to "here's exactly what's in it and why" - the natural next step for that feature, not a separate one, and it should replace rather than duplicate item 7 once built.

### Open questions, not yet settled

- How many test companies, and which failure modes, are actually worth maintaining long-term versus a one-time test during development - this could grow without bound if not scoped.
- Whether "tender template changed" (a fingerprint MISMATCH) should pause real customers' in-progress packs on that template until Sarel clears a review, or only block *new* packs starting after the change - pausing in-progress work has its own cost.
- Where the line sits between "assumed-default" and "missing" for a given field is a judgment call per field, not a mechanical rule - needs deciding form-by-form as item 29 is built, the same way `fill_a_forms.py`'s own module docstring already works through it form-by-form today.

## Tender financial and market-intelligence records

This is a new item, distinct from the later-phase "project financials" roadmap entry (budget versus actual on won projects): it is about recording tender-level submission and outcome data, both internal and public, to build pricing and market intelligence over time.

- **Internal submission records:** for each tender submitted, record who on the team worked on or submitted it, and any revenue-share or commission arrangement tied to that person for that tender.
- **Submitted pricing history:** record the price the company submitted at for each tender, building an internal pricing history over time by tender type, client and sector.
- **Public award data:** where a buyer publishes it (SANRAL, for example, posts award outcomes on its website), capture who won each tender and at what price. Over time this builds a market-pricing trend across tender types, not just Sarel's own submissions.
- **A use case beyond the bidder:** this award data has value to people who are not bidding themselves, such as suppliers or competitors wanting to know who won a tender so they can approach the winning contractor. This could be a distinct feature or a separate audience from the core product, worth treating as its own idea rather than assuming it is the same buyer as the rest of this document.

This depends on stream 5 (discovery) already capturing and storing tender listings, and extends it to capture outcomes too, not only opportunities. Researched 2026-10-17 (`Award-Outcomes-Findings.md`): the eTenders portal's Awarded tab (all buyers) and SANRAL's own awarded/closed pages (winner, points, amount, and the opening register of every bidder's price) publish outcomes; the OCDS API does not. SANRAL's terms allow reproduction with acknowledgement but say no charge may be made upon recipients of the material - fine for internal bid intelligence, a decision for Sarel before selling it to others.

## SANRAL project document preparation

SANRAL template automation is an explicit Phase 2 feature (item 13) and is the product's first real-world test case, because Sarel already does this work by hand. What follows is from his own description; I have not opened the template, so SANRAL's actual form list must be taken from the workbook itself.

- **The problem:** SANRAL issues a standardised Excel tender workbook with heavy VBA macros and hundreds of dropdown form controls, reissued per tender with the project name and number pre-filled. Public SANRAL notices show per-contract macro-enabled workbooks (for example Financial Submission.xlsm and Technical Submission.xlsm) and a Form A1.1 certificate of intention to submit, and the loaded specification shows two template families, not one (see below). Completing it by hand is very slow.
- **What to automate:** fill the workbook from stored company data and the key-person CV, then generate the PDF print reports the workbook produces, for several SANRAL tenders reusing the same information.
- **Non-negotiable:** the automation must not corrupt SANRAL's macros, formulas or print setup, and must not risk disqualification. Treat the workbook as read-only except the input cells, and check every output against the untouched original before it is offered for submission.
- **How it ties to the niche:** the same stored company record and CV library feed both the SANRAL workbook and the generic pack builder. The SANRAL printed reports then become pack sections, so one source of truth produces the whole submission.
- **Scope guard:** SANRAL is one buyer with a fixed template. Build it as a separate importer so a template change does not break the rest of the product.

The loaded specification (below) now answers which sections repeat and which are tender-specific; its open issues are listed at the end of this section.

### SANRAL specification (loaded 15 October 2026)

A specification from Sarel's earlier SANRAL work is saved in Drive as [SANRAL Tender Automation Specification](https://drive.google.com/file/d/1-R6hR6Onqk432O57hJaYOj42_nCM2vi8/view) with the [source-code appendix](https://drive.google.com/file/d/12NUzoLQiGXoPpN_Y7pufMRhUuDVmKwBS/view), in the Tender Tool folder. It labels each fact Observed or Assumed. Its main findings, as written there:

| Topic | What the specification says |
| --- | --- |
| Template families | Two exist: RRM Consultant Tender (15 sheets, about 873 dropdowns) and Conventional Consultant Tender (9 sheets, about 867 dropdowns). The main tender sheet (TEND 1X) uses the same layout for Forms B1 to B7 in both. SANRAL pre-fills the SETUP sheet (contract number, closing date, position codes), and the tool must never override it. |
| Inputs | Input cells are those that are unlocked and not formulas, not just yellow ones. A yellow-only scan missed several. |
| Dropdowns | They are legacy form controls storing a 1-based index; a date is three dropdowns (year, month, day). The tool sets dropdowns by label, read from the template's own list. |
| Macros | They only set print areas and page set-up; none prints. The tool replicates that page set-up to produce the PDFs. |
| Outputs per tender | The filled workbook plus 5 or 6 PDFs (Forms B1-B2 per position, B3, B4, B5, B7). |
| Method | Edit the workbook's XML directly and copy every other part byte for byte. Never use a library that rewrites the package (openpyxl dropped validations and form controls). Never write to a formula cell. |
| Verification | A 12-point checklist: zip integrity, XML validity, macro file identical, same part count, values read back, dropdown labels, PDF page counts, no formula errors, text present, visual check, package hash, and open in real Excel. |

**Lessons that become product requirements:**

- **Silent wrong data is the main risk.** A first delivery left the B-BBEE level at SANRAL's default of 9 and the targeted-enterprise block blank in seven tenders. It was caught and fixed, but it shows why the product needs a read-back check of every required field before any pack is released.
- **Check the rendered page, not extracted text.** Hidden values under dropdowns showed up as false alarms in PDF text.
- **The PDFs come from LibreOffice, not Excel.** They were never compared with a real Excel print, and no filled file has been opened in Excel yet. Do this before any submission relies on the product.
- **Personal data in the data pack.** The pack holds ID numbers, professional registration numbers and contact details, so it falls under the POPIA section above.

**Open issues from the specification** (to settle before calling SANRAL end-to-end): C2.4 hours and budgets are pending per tender; Form B3 partner names and the director list are blank; B4 and B5 attachments (quality certificate, programme) are not produced; the B6 past-performance sheets and the BEE A3 reports are not generated; alternate key positions are blank; RRM outputs were not re-verified; and the RRM pack may still clip long institution names. The specification lists ten questions for Sarel; Q1 to Q10 are in its section 8.2.

### Required first step: check the template before filling

Every run must begin by checking whether the incoming template or document has changed, because SANRAL and other buyers reissue them and a silent change could produce a wrong submission. If the check fails, the tool stops and flags it; it does not fill.

- **Fingerprint what the tool already depends on:** sheet names and count, number of dropdowns, checkboxes and buttons, each dropdown's list range and options, the SETUP layout (position codes in row 6), print areas, and the macro file's hash. The specification records known values: Conventional 9 sheets and 867 dropdowns, RRM 15 sheets and 873 dropdowns.
- **Known family, no change:** fill as normal.
- **Known family, something differs:** stop, show exactly what differs, and ask for review before any filling.
- **Unknown document or new family:** do not guess; send it for a field-by-field review like the ones used to build the first two families, and add it as a new family once reviewed.
- **Status today:** the specification lists a changed template as scenario S14, not tested, so this check is new work.

### Document packaging convention: never make SANRAL's own layout reflow

Found by Sarel reviewing generated output against a real completed Klipcorp tender, 16 October 2026: several forms looked "not neat" - spacing was out, and the outer envelope cover consistently spilled one line onto an otherwise-blank second page. Root cause in both cases was the same mistake: typing a value directly into a space SANRAL's own template sized for something else, instead of adding it alongside without touching that space.

- **Never type a value onto an existing dotted/underscore blank, or append it immediately after one.** SANRAL's own templates size a dotted blank assuming a short, hand-written entry; typing a full-size value there (replacing or appending next to the dots) produces a line far longer than the blank was ever laid out for, and Word reflows it - usually wrapping the rest of the sentence onto an extra line, sometimes pushing a whole page over. Found concretely in Form A14 (and the same "(name)"/"(position)"/"(name of company)" hint-marker pattern recurs across A4, A6, A9, A11, A15, A21-A23): the dots plus hint text were left completely untouched, and `HENNING JANSEN VAN RENSBURG, Senior Manager, on behalf of Klipcorp (Pty) Ltd` was added as a new line directly **above** the dotted sentence instead - SANRAL's own blank, and its layout, never changes at all. This is the same principle already used for A3 ("Not Applicable"), A8 (litigation "None"), A10 (deviations "None") and A16 (addenda "None") - add a line, never edit SANRAL's own line - just now applied to a value substitution, not only a statement.
  - The one case that's safe to fill inline is when the match already consumes the dots themselves (e.g. `"I, the undersigned," + <dots>` replaced wholesale by `"I, the undersigned, HENNING JANSEN VAN RENSBURG "`) - the dots are gone, not left sitting next to new text, so the line is usually shorter than before, not longer.
- **A generated document's own spacing can cost a full page.** `engine/make_envelope_covers.py`'s outer envelope cover was overflowing by exactly one line (the CIPC registration number) on every tender generated so far, caused by default 1in/1.25in margins plus several blank spacer paragraphs. Fixed by tightening margins (0.75in top/bottom, 0.9in sides) - a page-layout change only, no tender fact or field touched. Any future document-generation script (the financial workbook's own covers, a new buyer's cover format) should check its own page count the same way before calling itself done, not assume default margins are fine.
- **This is a packaging convention, not a one-off fix:** any script that writes a value next to SANRAL's own printed layout (dots, underscores, a fixed-width table cell) must add the value as new content beside/above the original, never edit or crowd the original space itself.

### Two-envelope submissions

Many tenders require the technical and the pricing proposals in two separately sealed envelopes. The structure below is taken from the cover pages of last week's SASSA submission in your Drive (bid number, company registration and contact details left out here); it shows what the product must produce.

| Part | What it contains |
| --- | --- |
| Outer envelope cover | Bid number, tender title, closing date and time, delivery address, bidder details, a note that it holds two separately sealed envelopes, and contents (Envelope 1: 1 original and 1 copy; Envelope 2: 1 original and 1 copy) |
| Inner cover 1 of 2: Technical proposal | Same header details; a tab list (covering letter and index; SBD forms, authority, CIPC, CSD, tax status, B-BBEE; ISO, project leader, experience; proposal, CVs, profile, insurance); the statement that it contains no pricing information |
| Inner cover 2 of 2: Pricing proposal | Same header details; tab A pricing covering letter, tab 1 SBD 3.1 pricing schedule, tab 2 Annexure C pricing per region; the statement that it is opened only after technical evaluation |

Requirements that follow:

- **Two separate packs:** build the technical and pricing packs separately, each as its own PDF with its own tab dividers and page numbering; the file names in Drive show about 358 pages for the technical envelope and 8 for pricing.
- **Envelope covers generated from tender data:** outer and both inner covers filled from the tender's bid number, title, closing time, address and the bidder record, with the correct tab list for each tender.
- **Pricing guard:** scan the technical pack and block release if it contains pricing; confirm the pricing pack holds only pricing.
- **Copies:** record how many originals and copies each envelope needs.
- **SANRAL:** public notices show separate Technical Submission and Financial Submission workbooks for SANRAL tenders. The loaded specification covers only the technical workbook (Forms B1 to B7); the financial workbook and its envelope are not yet specified and need a workbook example.

I took "Sonnet" in the last voice note to mean SANRAL or SASSA; the two-envelope example here is SASSA's, and the SANRAL part is limited to what the specification and public notices show.

### Discovery: what SANRAL's website offers (checked 15 October 2026)

SANRAL publishes a public list of open tenders with structured fields, but each tender pack sits behind a download form, so fully automatic download needs a decision first. Source: SANRAL's [open tenders list](https://www.nra.co.za/sanral-tenders/list/open-tenders) and one [tender detail page](https://www.nra.co.za/sanral-tenders/detail/sanral-x-004-099-2022-1f).

- **List:** 10 open tenders at the time of checking, each with a reference, project type, closing date and time, region and a link to a detail page. This list was incomplete: six further consultant tenders (R.334-030, R.343-020, R.352-020, R.352-030, R.394-010 and R.396-010, all 2025/1F) close on 22 October 2026 at 12:00 and were reachable only through their detail pages. Discovery must therefore not trust the open-tenders list alone.
- **Other lists:** the site also links closed, awarded, cancelled and archived tenders, second-tier procurement (a separate site) and SAP Ariba tenders. These could hold the tender you meant; I did not open them.
- **Detail page:** description, dates, submission rules, contact email, and a zipped tender document (one example was 31 MB). Award and opening results fields exist and fill in later, which supports the award-data feature.
- **Download:** no login was needed, but a form asks for name, company, phone, email and agreement to the privacy policy before the file downloads.
- **Terms (read 2026-10-17, `/terms-conditions`):** reproduction and publication of the site's material is permitted provided SANRAL is acknowledged as copyright owner, the material is not modified or used prejudicially, and no charge is made upon any recipient of it; robots.txt allows all. This does not change the download form: its reCAPTCHA is still not automated around.

## South African tender compliance coverage

The feature list covers the common national requirements below; four rows (financial standing, local content, industry registrations, SANRAL-specific forms) are tender-specific and must be confirmed against each tender's own checklist. Requirements are from [TenderFlow](https://www.tenderflow.co.za/q/what-documents-with-tender-response/), [GovChain](https://www.govchain.co.za/blog/documents-needed-to-apply-for-tender-south-africa) and [TenderProSA](https://tenderprosa.co.za/features).

| Requirement | Typical evidence | Product feature | Covered in list |
| --- | --- | --- | --- |
| Company registration | CIPC certificate (COR14.3) or incorporation notice (COR14.1) | Vault with expiry or validity | Item 1 |
| Supplier database | CSD registration summary and supplier number | Vault; check validity at closing date | Item 1 |
| Tax compliance | SARS tax compliance status PIN | Vault; check status at closing date | Items 1, 7 |
| B-BBEE | Affidavit or SANAS-accredited certificate, as each tender specifies; SBD 6.1 preference claim (the 2022 regulations award points for specific goals, so follow each tender's form) | Vault, points check, SBD 6.1 fill | Items 1, 12, 14 |
| CIDB grading | CIDB registration, grade against tender value (use CIDB's current limits; the 2019 limits run from Grade 1 R500,000 to Grade 9 unlimited, and some sites still show older figures) | Grade check and expiry | Item 14 |
| Conflict of interest | SBD 4 declaration of interest | Form fill | Item 12 |
| Anti-collusion | SBD 9 independent bid determination | Form fill | Item 12 |
| Past supply-chain practices | SBD 8 | Form fill | Item 12 |
| Invitation and pricing forms | SBD 1, SBD 3.3 pricing schedule | Form fill | Item 12 |
| Banking | Stamped bank confirmation letter dated within 3 months | Vault with age rule | Item 1 |
| Financial standing | Audited financials or management accounts; surety or guarantee capacity letter | Vault; tender-specific; I found no authoritative source requiring it generally | Item 1 (add per tender) |
| Local content and preferencing | Local production and content declaration (SBD 6.2) for designated sectors | Form fill where the tender designates the sector; SBD 6.2 is listed on National Treasury's practice-notes page | Item 12 |
| Industry registrations | PSiRA, ECSA, NHBRC, FSP, COID letter of good standing, health and safety file | Vault with expiry, per tender | Item 1 |
| Identity and address | Certified ID copies of directors, recent utility bill | Vault; certification date rule | Items 1, 25 |
| Experience | References, completion certificates, signed past contracts, CVs | CV and project library | Items 2, 4, 5, 19 |
| Insurance and municipal | Professional indemnity cover, municipal account compliance | Vault with expiry | Item 1 |

The table covers the common national requirements; several rows are set per tender, so the tender's own wording always decides. The pre-submission check (item 7) should read the tender's own returnable-documents list as the final authority and flag anything not in the vault.

**Added after an independent fact-check (15 October 2026):** the table above omits several items the check found in public tenders: SBD 7 (contract form), municipal MBD forms, SANRAL Form A1.1 (certificate of intention to submit, which gates receipt of addenda), compulsory briefing sessions, VAT registration, joint-venture agreements, and an up-to-date COID letter of good standing. Add them to the vault and pack checklist as tender-specific items.

**Legal framework to recheck before launch:** the 2022 Preferential Procurement Regulations took effect on 16 January 2023 (80/20 up to R50 million, 90/10 above). The Public Procurement Act 28 of 2024 was signed, but I could not confirm whether it is in force in October 2026, and draft General Public Procurement Regulations, 2026 were reported for comment. Check National Treasury's site before fixing any rule in the product.

## POPIA compliance requirements

POPIA compliance is a foundational requirement from the first build, because the product stores customers' company documents and their employees' personal CVs, ID copies and credentials. Clients are likely to ask for it before signing. This section is a research summary, not legal advice; have a South African attorney review the final terms.

**Likely roles (my reading, to confirm with a lawyer):** each customer company is the "responsible party" for its staff's information, and the product is its "operator" processing that information on its behalf. For the product's own account and billing data about customers, the product is a responsible party.

| Obligation | What the sources say | Product requirement |
| --- | --- | --- |
| Written operator agreement (s 21) | A written contract with any operator is mandatory; its absence is itself a contravention. It should cover scope, security, breach notice, deletion or return, sub-processors and audit rights ([MJK](https://mjkinc.co.za/software-technology-law/popia-for-tech-companies)). | Standard data processing agreement signed at signup; list sub-processors (hosting, AI provider, email). |
| Security safeguards (s 19) | Responsible parties must secure integrity and confidentiality; operators must keep personal information confidential ([MJK](https://mjkinc.co.za/software-technology-law/popia-for-tech-companies)). | Encryption in transit and at rest, role-based access, access logs, backups, no staff browsing of customer files without permission. |
| Breach notification (s 22) | Operator must tell the responsible party immediately; the responsible party notifies the Information Regulator and affected people as soon as reasonably possible. No fixed deadline in the Act; the Regulator has indicated about 72 hours as a guideline ([MJK](https://mjkinc.co.za/software-technology-law/popia-for-tech-companies)). | Documented incident procedure; alert customers immediately; keep an audit trail to show what was accessed. |
| Telling people their information is collected (s 18) | Data subjects must be told about collection and use ([MJK](https://mjkinc.co.za/software-technology-law/popia-for-tech-companies)). | Privacy notice; a way for customers to record staff consent or notice for CV storage. |
| Access, correction and deletion | Data subjects have these rights; build deletion and export into the platform ([MJK](https://mjkinc.co.za/software-technology-law/popia-for-tech-companies)); the page does not set out the rights in detail, so check the Act. | Per-person view, edit, export and delete; when a person leaves, their CV and credentials can be removed; delete on account closure. |
| Cross-border transfer (s 72) | Transfers outside South Africa need at least one condition: adequate foreign law, binding corporate rules, a binding agreement, consent, or contract necessity; the source says the US is no longer regarded as adequate, and GDPR terms should not be assumed to satisfy POPIA ([Michalsons](https://www.michalsons.com/focus-areas/privacy-and-data-protection/transfers-of-personal-information-outside-south-africa), [MJK](https://mjkinc.co.za/software-technology-law/popia-for-tech-companies)). | Prefer South African hosting if available; otherwise record the s 72 basis for every country the data reaches, including AI providers that read uploaded CVs. |
| Information officer | Each organisation has one by default (a company's CEO or equivalent); register with the Information Regulator before duties start, on its eServices Portal ([Michalsons](https://www.michalsons.com/focus-areas/privacy-and-data-protection/information-officer-popi-paia)). | Register Sarel's business and appoint the information officer before launch. |

Two product decisions follow from this: collect only the personal information needed for a tender (a CV and qualifications, not unneeded ID data), and be clear about where uploaded CVs go when an AI feature reads them. The sources I opened are law-firm articles; I did not read the Act's text or the Information Regulator's own guidance, so confirm section numbers there before relying on them.

## Go-to-market plan (lean, solo, part-time)

Sell by conversation first and proof second, with no paid advertising until a few customers pay. The plan fits a founder with about 20 to 30 hours a week alongside a day job and no marketing budget; every step below costs time, not money. Durations are my estimates and depend on how fast the product is built.

| Phase | Goal | What to do | Done when |
| --- | --- | --- | --- |
| 1. Validate and build a list | Learn if the pain is real; start a pipeline | Talk to 5 to 10 South African SMEs that tender regularly, drawn from your own network (SANRAL, ACSA and your other tender work). Ask how long CVs and pack assembly take per bid, what they use now, and what they pay. Ask each to be a first tester. | You have 5 or more interviews and 3 or more people who want to try it |
| 2. Prove it on your own tenders | Create the case study | Use the product on real submissions and record the hours before and after against the baseline in the time-saving section. Write one short case study with the numbers. | One real tender with measured before and after times |
| 3. Free pilots | Get usage and feedback | Give the testers free access in return for feedback and permission to quote them. Watch where they stall; fix that before adding features. | 3 testers each complete a pack unaided |
| 4. Show up where tenderers talk | Build trust before selling | Join LinkedIn groups, WhatsApp groups and forums where South African SMMEs discuss tenders. Answer questions, share a compliance checklist or template, and mention the product only when asked. | Inbound questions or messages from people you did not know |
| 5. First paying customers | Prove willingness to pay | Convert pilots to paid at a price set after the pricing decision. Offer a free trial like the others do. | 3 to 5 paying customers |
| 6. Referrals | Grow through networks | Ask paying users for introductions to others who bid on similar tenders; offer a month free for each referral that subscribes. | Referrals are a regular source of new trials |

**Core pitch:** lead with measured time saved on a real tender ("this took X hours, now Y"), not the feature list. Do not publish a time-saved figure until you have measured it.

**Competitors already offer free entry:** TenderFlow has a free plan and a 14-day trial ([site](https://www.tenderflow.co.za)), TenderProSA offers a free trial ([pricing](https://tenderprosa.co.za/pricing)) and Tender Aid has a free trial ([Capterra](https://www.capterra.com/p/10045780/Tender-Aid/)). Expect buyers to want a trial; plan one.

**Cautions:**

- **Confidentiality:** a case study from real SANRAL or ACSA tenders must not reveal confidential tender content, pricing or personal details. Use anonymised numbers and check any contract terms or get the client's agreement first.
- **Honesty in groups:** say you built the product when you recommend it; undisclosed promotion in community groups can cost trust.
- **POPIA:** do not collect or store prospects' personal information beyond what they give you for the pilot; follow the POPIA section above.
- **Time:** with limited weekly hours, phases 1 and 2 matter most; skip a community channel rather than do it badly.

Open questions: Which tender groups does Sarel already belong to? How many SMEs does he know personally who tender? Neither is known to me yet, and I did not research which communities exist, so this plan names channel types, not specific groups.

## Validation caveats and open questions

Demand is not yet proven, and some competitor claims rest on vendor marketing or one listing.

- **Not found:** Tenderplus.io and Track My Tenders returned no pages I could open. Either they are very small or the names differ. Ask in tender groups before assuming they do not exist.
- **Vendor claims, not tested:** every feature above is from the vendor's own page or a Capterra listing. I did not run any trial. Tender Aid shows zero reviews; its accuracy figure is self-reported.
- **Pack merge is the key unknown:** run a trial of TenderProSA and TenderFlow with three of your real tenders (one SANRAL, one ACSA, one SASSA) before building item 6.
- **Tender requirements:** the required-documents list in item 1 comes from [TenderFlow's guidance](https://www.tenderflow.co.za/q/what-documents-with-tender-response/) and [GovChain](https://www.govchain.co.za/blog/documents-needed-to-apply-for-tender-south-africa). Neither lists CVs as standard; National Treasury professional-services bids do require strict-format CVs (for example 4 pages maximum, with references and certified qualifications), so CV demand depends on the tender type; check this against your own submissions.
- **Price point:** decide between undercutting TenderFlow and AITenders, or matching TenderProSA's R299 to R800 band, once you know which features customers will pay for.
- **Demand:** talk to five other South African SMEs that tender regularly and ask how long CVs and pack assembly take them per bid.

As of 15 October 2026. Pages opened: [TenderFlow](https://www.tenderflow.co.za), [TenderFlow compliance](https://www.tenderflow.co.za/blog/tenderflow-product-comparisons/product-guides/how-tenderflow-simplifies-tender-compliance/), [TenderProSA features](https://tenderprosa.co.za/features), [TenderProSA pricing](https://tenderprosa.co.za/pricing), [Tender Aid on Capterra](https://www.capterra.com/p/10045780/Tender-Aid/), [BidsStack](https://app.bidsstack.com/features), [AITenders on eNCA](https://www.enca.com/promotions/local-ai-company-launches-platform-help-businesses-win-tenders-faster), [Flowcase](https://www.flowcase.com/cv-and-case-study-tool-for-enterprise-professional-services), [GovDash](https://www.govdash.com/proposal), [Loopio via SiftHub](https://www.sifthub.io/blog/loopio-rfp), [AutoRFP.ai tender software guide](https://autorfp.ai/blog/tender-software.md), [mytender.io on Capterra](https://www.capterra.com/p/10031061/mytender-io/).
