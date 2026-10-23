<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product promise

Tender Ready is "your tender department, without hiring one". Users are directors and managers of small South African companies with little or no tender staff. The product finds tenders, assesses fit and compliance with AI, and assembles the full submission from the company vault. The user should only verify AI-filled content, provide pricing and signatures, and fix flagged compliance gaps.

Design rules that follow from this:
1. Never ask the user to type information that already exists in the company vault, people/CVs or experience records. Prefill it and show a "Verify" state.
2. Every bid screen groups tasks into three types: Verify (AI filled, green when confirmed), Provide (only the user can supply: pricing, signatures, missing docs, amber), Fix (disqualification risks, red, with a one-line reason and a fix action).
3. Every screen belongs to one stage: Find, Decide, Build, Submit, Track.
4. UI copy is plain South African English using tender terms (tender, bid, briefing session, CSD, B-BBEE, CIDB grade, SBD forms). Avoid "workflow", "entity", "artefact", "pipeline item".

## Design system decisions

- Direction is "confident & premium": deep navy ink, one blue accent, neutral soft grey canvas (no cream or beige anywhere), Fraunces for display/headings, Inter Tight for UI/body - see app/globals.css for the full token set. (Originally a warm off-white canvas with a gold accent - replaced 2026-10-21, see "Color scheme update" below.)
- shadcn/ui is on the current `shadcn@latest` "Nova" preset (Base UI primitives, not Radix) and the `cn` npm package, not a hand-rolled `clsx`+`tailwind-merge` `cn()` - that's what `shadcn init` wires up by default now.
- The accent color is reserved for the single most important action or highlight on a screen, not a general-purpose second color.
- Every status/semantic color pairs with dark-ink or white text chosen for contrast at that color's lightness, not a blanket white-on-color rule - this differs by color: `accent-foreground` is white (blue is dark/saturated enough that dark ink loses contrast on it), but `success-foreground`/`warning-foreground`/`destructive-foreground`/`info-foreground` are also white already. A SOLID fill is the only place `*-foreground` tokens apply; a soft 10%-tint badge or icon roundel should read `text-accent`/`text-success`/etc. directly - see "Color scheme update" below for why this distinction matters now.
- Badges/status chips use a soft 10%-tint style (bg/10, full-strength text, /20 border) everywhere, including the two outcome states (won/lost) - no solid-fill badges, for a consistent, non-shouty tone.
- Shadows are navy-tinted, not black and not blue-tinted either - elevation should read as "lifted off the grey page", not a generic UI-kit drop shadow.
- `.dark` tokens exist and are complete, but nothing adds the `dark` class anywhere - no toggle was built. Don't treat its presence as a signal that dark mode is live.
- `/design` (app/app/design) is the live reference for every token and component - dev-only, 404s when `NODE_ENV=production`, and is deliberately not linked from SiteNav.
- No existing app page has been migrated to this system yet - it coexists with the inline-CSSProperties app until pages are migrated one prompt at a time.

### Dashboard migration (prompt 2)

- `/dashboard` is migrated; `SiteNav` (the shared top bar every page mounts) deliberately was not - it's a separate migration unit spanning the whole app, not part of "migrate the dashboard". Until SiteNav itself is migrated, every newly-migrated page will show a visible seam between its own navy ink and SiteNav's old amber (#D97706) active-tab color and old Civic Navy (#16233B, close to but not identical to the new ink) - known and expected, not a bug to chase per-page.
- Added a `Button` `variant="accent"` (`bg-accent`/`text-accent-foreground` - gold at the time, blue since the prompt-3 color update below) - the original dashboard's one amber CTA ("Load a tender manually") was already treating that button as the screen's single most important action, exactly the job `accent` is reserved for. shadcn's own default variant set has no accent option, so this was added to `components/ui/button.tsx` directly rather than worked around with a one-off className per call site, since any future migrated page's primary CTA will want the same thing.
- shadcn's built-in button sizes top out at `lg` (36px) - below this app's existing 40-44px touch-target convention for a primary action, re-affirmed on a screen checked constantly on a phone. Bumped with `className="min-h-10"` rather than inventing a new named size; revisit if a real fourth size turns out to be needed across more than one migrated page.
- `StatusBadge`/status mapping preserves the dashboard's exact original wording ("Complete", "Needs your input") via its `children` override, even though the variant's own default label differs ("Ready", "In progress") - the migration changes how a status looks, never its words, unless asked.
- The original showed a past deadline as literal negative text ("-48 days left"); `DeadlineChip`'s existing "Closed" state fixed that for free, by simply using the shared component as designed - noted as a side-effect of the migration, not a separate ask.
- `StatCard` gained an optional `tone` prop (colors the value itself: default/success/warning/destructive) and `EmptyState`'s `description` was widened from `string` to `ReactNode` (so a sentence with inline links, like the dashboard's empty-state copy, doesn't need rewriting into a different shape) - both small, backward-compatible extensions made in service of a real migration, not speculative.

### Color scheme update (prompt 3)

- Flagged and confirmed with Sarel before touching anything: the colors requested (navy #0B1F3A, blue accent #1D4ED8, green #16A34A) didn't match what prompts 1-2 had actually built (navy #14213D, gold accent #C9962B, green #1E7A52) - no "blue buttons" existed anywhere in this codebase before this prompt. Confirmed this was an intentional accent swap (gold -> blue), not a mistake or a different preview being described, before changing anything.
- Canvas: `--background` is now a neutral soft grey `#F4F5F7` (near-zero chroma, no blue or cream tint); `--card` stays pure white. `--secondary`/`--muted` (`#E9EAED`) and `--border` (`#DDE0E3`) were also moved off their old warm cream/beige tones (`#EFEAE1`/`#E4DED2`) to match "no cream or beige anywhere" - that phrase covers every neutral/surface token, not just the page background. `--warning` stays a warm amber on purpose: it's a semantic status color, not a neutral/surface tone, so the "no cream or beige" rule doesn't apply to it.
- Accent is now blue `#1D4ED8`, `accent-foreground` is white (not dark ink) - blue at this saturation/lightness loses contrast under dark text the way gold never did. This EXPOSED a real pairing bug: `EmptyState`'s icon, `StatusBadge`'s "submitted" variant, and `Stepper`'s "current" step all used `text-accent-foreground` for a soft 10%-tint wash, assuming a dark foreground - with accent-foreground now white, that text would have been invisible (white on a near-white tint). Fixed by switching those three to `text-accent` directly, matching how every other semantic color's soft-tint variant already worked (`text-success`, `text-warning`, etc.) - a latent inconsistency in the original variant set, not something new introduced by the color change. If you add a new soft-tint usage of any semantic color, use the bare color token (`text-accent`) for its text/icon, and reserve `*-foreground` tokens for a SOLID fill only.
- `--ring`, `--chart-2`, `--gradient-hero`'s accent corner, and the shadow tokens' navy hue all updated in step with the above (they reference `--accent`/`--foreground` directly or were hardcoded duplicates of the old values that needed the same update).
- `.dark` was deliberately left untouched (still gold accent, still the old dark-mode background) - dark mode has no toggle and isn't live, and this prompt was about the light-mode canvas/accent only. Means light and dark now genuinely disagree on accent color; flagged in the token file itself so this isn't a surprise whenever dark mode actually ships.
- Swept the whole design-system surface (`components/`, `app/design`, `app/dashboard`) for hardcoded hex/rgb/oklch colors before making any token change: zero hits - everything was already reading through tokens from prompts 1-2, so there was nothing to "replace with the background token" beyond the token definitions themselves.
- "The tender workspace" (`/tenders/[id]`) has NOT been migrated to this design system yet (still 100% the original inline-CSSProperties styling) - this color change has no visible effect there. Screenshots for this prompt cover `/dashboard` (the only migrated real page) and `/design` instead.

### App shell (prompt 4)

- `SiteNav` (the old navy top bar) is gone - deleted, not deprecated. Every signed-in page now wraps its content in `AppShell` (`app/app/_components/AppShell.tsx`), the same page-level mounting pattern `SiteNav` used (not a Next.js `layout.tsx`) - lower-risk for a page-by-page migration, at the cost of the sidebar remounting on every navigation (its open/collapsed state survives via a cookie, shadcn's own default, so this reads as instant anyway). `/tools` and `/onboarding` were deliberately left out - `/tools` is the public, unauthenticated lead-magnet section (see its own file comment); `/onboarding` runs before a company exists, so none of the shell's company-scoped chrome (notifications, company name) would have anything to show yet.
- **Home vs Bids, confirmed with Sarel before building anything:** the prompt's sidebar list named both "Home" and "Bids" as separate rows, but its own label-change rule ("Tenders" -> "Bids") named the same `/dashboard` route a "Home" row would naturally use - those can't both be true without picking one. Resolved as: **Home = `/dashboard`** (the tracked-tenders list, unchanged content, still the landing page after login) and **Bids = `/pipeline`** (the kanban, relabeled from "Pipeline" to "Bids"). Because of this, the original prompt's "keeping /pipeline working via redirect" doesn't apply - `/pipeline` IS the real, canonical Bids URL now, not a retired one, so no redirect was added. If this reads backwards from what you had in mind, it's a one-line nav-items.ts change, not a rebuild.
- "Merge Pipeline into Bids as a Board view tab" became: `/pipeline`'s existing kanban (completely unchanged, including its inline-CSSProperties styling - no body restyle beyond the header swap) now sits inside a single `TabsTrigger value="board"` rather than a bare div. One tab today, on purpose - the real reason for making it a `Tabs` component now rather than later is that a future "List" tab has somewhere to land without a second restructure.
- Sidebar items (`app/app/_components/nav-items.ts`, the one list both `AppSidebar` and `CommandPalette` read from): Home, Opportunities (was Discovery), Bids (was Pipeline), Company vault (was Company), People & CVs (was People), Experience, Tools (new - previously reachable only as a public page, now also a direct sidebar link to that same public `/tools`, so a signed-in visitor briefly leaves the shell when they click it), Admin (only when `is_platform_admin` - exact same `supabase.rpc("is_platform_admin")` check `SiteNav` used, unchanged). Active-item highlighting is computed from `usePathname()`, not a prop each page passes - `/tenders/*` highlights Home (drill-down from its list), everything else matches its own prefix (`/pipeline/pricing` still highlights Bids).
- In-page copy that named the old labels was updated to match where it was already being touched (the pipeline page's "Find more in Discovery" link, now "Find more in Opportunities") - dashboard's own "Tenders" `PageHeader` title and its "Check the Discovery feed" copy were deliberately left as-is, since those weren't part of this prompt's own file changes and touching them would be restyling a page body beyond removing its header.
- Command palette (Cmd/Ctrl+K, `app/app/_components/CommandPalette.tsx`): pages/actions are filtered client-side against the typed query (`shouldFilter={false}` on the underlying `Command` - cmdk's own fuzzy filter would otherwise re-filter, and sometimes hide, the server's already-matched tender rows); tenders are a real debounced search (`searchTenders` server action, `ilike` on `contract_no`/`description`, RLS-scoped) because contract numbers aren't a fixed list that could ever be preloaded.
- Notifications bell is read-only and genuinely data-backed, not a placeholder with nothing behind it: `lib/notifications.ts` reads the company vault's `*_expiry` columns, `held_registrations`, people's `ecsa_expiry`/`sacpcmp_expiry`, and tenders closing within 14 days - the same "renew soon" (60-day) and "closing soon" (14-day) windows `expiryStatus()`/`DeadlineChip` already use elsewhere, so the bell agrees with what the vault and dashboard already say. Nothing is ever marked read or persisted; it's recomputed on every page load.
- Avatar dropdown's "Profile" link points at `/company` - there's no dedicated per-user profile route in this app (`/company` is the closest existing page to "your own profile"), and "routes stay the same" ruled out inventing one. Revisit if a real profile page ever gets built.
- shadcn's Sidebar component already handles "becomes a sheet on mobile" itself (its own `useIsMobile` breakpoint, 768px) - nothing custom was built for that part. Mobile touch targets were bumped to 44px (`size-11`/`h-11`, shrinking to the desktop 36px at `md:`) on the topbar's own controls (sidebar trigger, search button, bell, avatar) and the sidebar's nav rows - the rest of the app keeps its existing 40px convention; this prompt only asked for 44px on the new shell.
- shadcn's generated `components/ui/sidebar.tsx` composes via Base UI's `render` prop (`<SidebarMenuButton render={<Link href=".."/>}>`), not Radix's `asChild`+`<Slot>` - same "Nova"/Base UI preset note as prompt 1, just hit for the first time here because this is the first prompt using composed trigger/menu-item components (sidebar, dropdown-menu, popover, command). `components/ui/sidebar.tsx`'s own generated `useIsMobile` hook set state inside a plain `useEffect` (calling `setIsMobile` synchronously on mount) - that trips `react-hooks/set-state-in-effect`, which this repo runs as a real lint error. Rewritten with `useSyncExternalStore` instead (the React-blessed way to read `matchMedia`), not disabled - this is vendored-but-committed code now, held to the same lint bar as everything else.

### Auth + onboarding (prompt 5)

- `AuthShell` (login/signup/forgot-password/reset-password/onboarding's shared split-screen) is migrated to the design system - navy `bg-foreground` panel, Fraunces headline ("Win more tenders. Miss fewer deadlines."), lucide icons (not checkmarks) on the 3 proof points, and a small static product-preview mock built from real `tt/` components (`StatusBadge`, the same stat-card shape as `/dashboard`) - not a screenshot image, since none exists to drop in; close enough that a visitor sees the same product they're about to sign into. The breakpoint that hides the left panel moved from the old `@media (max-width: 860px)` custom block to Tailwind's `md:` (768px), matching every other migrated page - a deliberate small change, not an oversight.
- Every auth page's `supabase.auth.*`/`supabase.rpc(...)` call is byte-for-byte unchanged, per the prompt's own instruction - only the markup/styling changed, plus real inline per-field validation (email format, password length/match) that runs BEFORE those calls, and a show/hide toggle (`PasswordInput`, `app/_components/PasswordInput.tsx`) on every password field. Loading state (`pending`) already existed; restyled with a spinner, not reworked.
- **Onboarding is now a 5-step wizard** (`app/onboarding/_components/Step1..5.tsx` + `EndScreen.tsx`, orchestrated by `app/onboarding/page.tsx` reading `?step=`), not the old single "company name" screen. Autosave per step is real - each Continue submits a Server Action that writes to the same tables/columns the rest of the app already uses, then redirects to the next step; "Skip for now" (every step but 1) is a plain link, no write.
- **`proxy.ts` changed**: it no longer redirects a member away from `/onboarding` once `company_members` has a row for them (it used to, straight to `/dashboard`). The wizard keeps using `/onboarding?step=2..5` well after step 1 already created that row, so "membership exists" can no longer mean "onboarding is done" - `/onboarding/page.tsx` itself now decides what to show (the bid-readiness end screen by default for a member with no `step` param).
- **Why these aren't literally the existing `/company`, `/people` and `/company/officeActions.ts` Server Actions, reused as-is**: every one of them ends with a hardcoded `redirect()` to its own page (`/company`, `/people/[id]`) - calling them from a wizard step would bounce the visitor straight out of the wizard. Reused instead: the exact same tables, columns and constants (`PROVINCES`, `OFFICE_KINDS` from `lib/locality.ts`; the `cv_uploads`/`people` row shapes from `people/actions.ts`), via new thin wrappers in `app/onboarding/actions.ts` whose only real difference is the redirect target. The one place this got a proper shared-core refactor rather than a parallel thin wrapper: `updateCompanyProfile`'s field validation/shaping moved into `lib/companyProfileUpdate.ts` (`buildCompanyUpdate()`), used by both the company edit form and the wizard's compliance step (step 2) - that one has enough fields and validation rules that duplicating it instead would have been a real drift risk.
- **CIDB grade & class** (step 2) is shown **read-only** with a link to Company vault, not an editable field, even though `cidb_grading`/`cidb_expiry` already exist in the schema - the ONLY existing way those columns get written is the document-scan/OCR pipeline on an uploaded CIDB certificate (`company_document_templates`/`onboarding_document_results`), not a manual text edit; there is no existing "just type the grade in" action to reuse, and building one would be new business logic, not a styling pass.
- **Three fields don't exist in the schema yet - shown disabled with a "coming soon" note, flagged here as the prompt asked, nothing invented or migrated for them:**
  - **Disciplines you work in** (step 3) - no company-level disciplines table exists (disciplines are tagged per-tender and per-experience-item today, never company-wide).
  - **Preferred buyers** (step 5, e.g. SANRAL/ACSA/SASSA) - not tracked anywhere.
  - **Typical tender value range** (step 5) - not tracked anywhere.
  The one step-5 field that DOES already exist - the daily digest email opt-in (`company_members.daily_digest_opt_in`, `set_my_daily_digest_opt_in()` RPC) - is fully wired up, same RPC `app/company/digestActions.ts` already calls.
- The bid-readiness score shown on the end screen started as a wizard-local `computeBidReadiness()` (6 checks, weights summing to 100) - superseded in prompt 6 by the project-wide canonical version; see "Bid readiness score (prompt 6)" below.
- Step 4 ("Your people") caps at 3 and keeps the add-person fields to name + role only - a deliberate subset of `people/actions.ts` `savePerson`'s full row shape (every other field - ID number, employment status, registrations - stays something you fill in later on that person's own People page, same place it always lived). CV upload defaults to "as_is" mode (no AI-extract choice) - simpler for a first pass; the full choice already exists on the People page if someone wants it.

### Bid readiness score (prompt 6)

- **Single source of truth, three surfaces.** `lib/readiness.ts` exports a 100%-pure `computeBidReadiness(input)` - no I/O, fully unit-tested - scoring 9 weighted checks against the prompt's exact weights (company basics 10, CSD 15, tax compliance 15, B-BBEE 15, CIDB 15, bank confirmation 5, ≥1 principal 5, ≥2 people with a CV 10, ≥3 experience projects 10; sums to 100). `lib/companyReadinessData.ts` is the one place that fetches the real Supabase data and calls it. Home (`/dashboard`, large card), Company vault header (`/company`, compact card) and the onboarding end screen (`/onboarding?step=done`) all call `fetchCompanyReadiness(supabase)` directly - none of them computes its own score, so they can't drift apart. This superseded and deleted the wizard-local `app/onboarding/_components/readiness.ts` + `EndScreen.tsx` from prompt 5, which had a different signature and would otherwise have been a second, disagreeing implementation.
- **Expired vs expiring-soon vs missing** are three distinct blocker reasons (`BlockerReason`), reusing `lib/dates.ts`'s existing `daysUntil()` math: no date on file at all is "missing" (not treated as an expiry failure); a past date is "expired"; a date within 14 days is "expiring_soon" and scores as a hard 0, same as expired - not a softer warning. A document with no expiry date on file at all (`taxPinExpiry`/`beeProofExpiry`/`cidbExpiry` all `null`) is treated as "doesn't expire" rather than penalized, so the compliance/BEE/CIDB checks only fail on an actual recorded expiry.
- **`BidReadinessCard`** (`components/tt/bid-readiness-card.tsx`) is the one place the score renders - a `size="large"` variant (ring + top-3-blockers list, each linking to the page that fixes it) for Home and the onboarding end screen, and a `size="compact"` variant (small ring + one-line summary, links to the onboarding end screen) for Company vault's header. Company vault itself is still 100% inline-CSSProperties, unmigrated - the same kind of visible seam SiteNav/Dashboard left on every newly-migrated page before it (see "Dashboard migration" above); dropping a Tailwind-based card into that page is accepted the same way, not a bug to chase.
- **CIDB's "Fix" link** on the blockers list points to `/company#bee-cidb`, not back into the onboarding wizard - CIDB grading/expiry are populated only by the document-scan pipeline on Company vault (see "Auth + onboarding" above), so that's the only place fixing it actually means anything.
- **New test convention: vitest, `.spec.ts` only.** The prompt asked for "vitest tests" specifically, while every existing test in this repo is `node:test` (`*.test.ts`, run directly via `node --experimental-strip-types`, deliberately not `node --test`'s own glob - see `app-ci.yml`'s header). Rather than migrate anything, vitest was added as a second, parallel convention scoped strictly to `**/*.spec.ts` (`vitest.config.ts`'s `test.include`) so the two runners never touch the same files; `npm run test:unit` runs vitest and is wired into `app-ci.yml` as its own CI step, separate from (and before) the existing `*.test.ts` loop. Pinned to `vitest@^3` (not latest 5.x) because 5.x's peer dependency (`@types/node@^22`) conflicts with this project's pinned `@types/node@^20`; 3.2.7 resolves with zero peer conflicts.
- `lib/readiness.spec.ts` covers the prompt's 4 named cases (empty company = 0, full company = 100, expired BEE removes exactly 15, a document expiring in 10 days is a blocker) plus 2 more for the 14-day boundary (15 days out still counts as current) and blocker ordering (sorted by weight, highest first).

### Home cockpit (prompt 7)

- **No new schema, one new cross-route dependency.** Everything on the rebuilt `/dashboard` reads existing tables/views, but the "specific next step" per tender (see below) imports two route-local modules - `app/tenders/[id]/compliance-data.ts` and `app/tenders/[id]/general-pack-review-data.ts` - that nothing outside the tender workspace had previously imported. Deliberate: both are already the single source of truth for "what's missing from this pack," and a dashboard-local reimplementation would be a second, driftable copy of that logic. If either file ever moves, `lib/tenderNextStep.ts` moves with it.
- **`lib/notifications.ts` (document/deadline expiry scan) is ported verbatim from the still-open `design-system/app-shell` branch (#28)**, which built it for the topbar notifications bell but hasn't merged yet. Copied byte-for-byte rather than re-derived, specifically so there's no risk of two slightly-different "what's expiring" implementations once #28 merges - that merge should either no-op on this file or be a trivial conflict, not a behavior question.
- **"Specific next step" (`lib/tenderNextStep.ts`) is short, verb-first text** ("Confirm pricing", "Upload COID letter"), not the compliance report's own long catalog sentences (e.g. "A4 Standard declarations (debt, fronting, litigation, SBD 4, POPIA, past SCM practices, addenda, commitments...)") - those read fine as a report line, not as a one-line dashboard badge, and the first version of this screen proved that out directly: dropping the full sentence into `StatusBadge` (which is `whitespace-nowrap` by design, for short status words) overflowed the card at mobile widths. `SHORT_ACTION_FOR_FORM` is a presentation-only rephrasing of each SANRAL doc-item's own form code - which item is actually missing/to-confirm still comes from `packReadiness()` itself, never re-derived. General-family tenders (no short form-code system) get a generic "Review compliance" when a gap exists, `null` when the pack's clean - no invented short labels for a system this app doesn't have a catalog for.
- **Both loaders `nextStepFor()` calls (`loadTenderCompliance`, `loadGeneralPackReviewSnapshot`) are real, multi-query per-tender reads - the same cost the tender workspace page itself pays.** Only ever called for the bounded "closing within 14 days" list, never the full tender list - an N+1 risk flagged during research and designed around from the start, not discovered after the fact.
- **The old "every tracked tender" flat list is gone from Home entirely**, replaced by the bounded 14-day "Closing soon" timeline. Not a loss of reachability: `/pipeline` (SiteNav's "Pipeline" link, present on every signed-in page) already lists every tender regardless of deadline, pack state, or pipeline stage (`pack?.pipeline_stage ?? "found"` - a tender with no pack yet still shows up there, bucketed as "found") - it was already the complete list in parallel, Home's own flat list was the redundant one.
- **Next best action priority** (deadline under 7 days with an incomplete pack → an expiring document → a new matching opportunity → "nothing urgent") is computed from data already fetched for the rest of the page - the urgent-deadline check reuses `closingSoon`'s already-computed next steps rather than a second lookup, `notifications` is already sorted soonest-first by the ported module itself, and the opportunity fallback is just the first row of the same "New opportunities for you" query.
- **"New opportunities for you"** reuses `discovered_opportunities.verdict` - already a real, per-company matching signal (`strong_fit`/`possible`/`needs_review`/`not_a_fit`/`closed`, set by `engine/discovery/assess_tender.py`'s own fit assessment) - filtered to `tender_id is null` (not yet pursued) and the three non-rejecting verdicts, newest first, capped at 5. No new "matching" concept invented; `/discovery`'s own verdict chip styling wasn't reused as-is (that page is still 100% unmigrated inline-CSSProperties) - a small Tailwind-based equivalent was written for Home instead, same 3 verdicts only.
- **Active bids** reuses `lib/discoveryReassessment.ts`'s existing `ACTIVE_PURSUIT_STAGES` (`found`/`bidding`/`submitted`) rather than a new definition - this already excludes `won`/`lost`, matching `/pipeline`'s own "in progress" framing.
- **Company name in the greeting** reads `companies.csd_trading_name` (falling back to `legal_name`) - no person-level display name exists anywhere in this app (no `people.user_id` link, no auth `user_metadata` used for names), so the greeting personalizes by company, not by the signed-in person.
- Screenshots for this prompt cover 3 states at `/dashboard`: populated (closing-soon timeline + next best action = an incomplete pack closing soon), and a brand-new company with zero tracked tenders (next best action falls through to the one expiring document; the rich EmptyState - onboarding gaps + "Browse opportunities"/"Load a tender" - replaces the closing-soon section; "New opportunities for you" still renders independently, since a fresh company can already have real unclaimed Discovery matches).
- **Post-merge correction (once #28 merged):** the "`/pipeline` (SiteNav's 'Pipeline' link...)" reachability note two bullets up is stale - `SiteNav` is gone; the equivalent link is now the App shell's sidebar "Bids" row (same destination, `/pipeline`), always present via `AppShell`.

### Verify/Provide/Fix grouping (prompt 8, step 1 of 4)

- **The product-promise audit (prompt 7.5) found 3-4 independent, disagreeing status vocabularies on the tender workspace cluster alone**: `pack-review-logic.ts`'s 5-way `ReviewStatus`, `compliance-report.tsx`'s own "On file/Confirm by hand/Don't have", `page.tsx`'s "Already confirmed/Please review/Needs your input" cards, and the key-people section's un-grouped chips. This prompt replaces the first of those four - `compliance-report.tsx`'s required-documents section - with the Product promise's own Verify/Provide/Fix grouping. The other three are known, named follow-up scope, not touched here.
- **One shared classifier, zero new data.** `app/tenders/[id]/bid-task-status.ts`'s `classifyComplianceItem()` reclassifies `lib/tenderCompliance.ts`'s existing `ComplianceItem` (`status: "have"|"missing"|"check"` + `mandatory`) into Verify/Provide/Fix, reading nothing new: `mandatory && status !== "have"` → **Fix** (a real disqualification risk by this data's own definition, "failing it disqualifies" - deliberately covers both outright-missing AND still-unconfirmed mandatory items, which the old "Don't have" bucket's `mandatory && status === "missing"` count missed for the unconfirmed case); `!mandatory && status === "missing"` → **Provide**; everything else (confirmed, or an optional item still needing a look) → **Verify**.
- **`SHORT_ACTION_FOR_FORM` moved from `lib/tenderNextStep.ts` to a shared export in `lib/tenderCompliance.ts`** so the dashboard's "specific next step" and this section's own fix actions never maintain two copies of the same form-code → short-phrase map. `tenderNextStep.ts` now only imports it.
- **`FIX_HREF_FOR_KEY`** (in `bid-task-status.ts`) sends each doc item's fix action to where it's actually fixed: the Company vault's own existing section anchors (`/company#compliance-documents`, `#bee-cidb`, `#bank-details`) for anything that lives in the vault, a same-page anchor for anything tied to this tender itself (briefing attendance, pack generation/pricing). Falls back to `#compliance-check` for any key this map doesn't know about yet, rather than a dead link.
- **Row behavior**: a Verify row shows a green "Confirmed" chip once `status === "have"`; everything else (Fix, Provide, and an unconfirmed-but-optional Verify row) shows a short fix-action link (`fixLabel` → `fixHref`) instead - so an optional item still needing a look isn't a dead end, it's just not colored as urgent as Fix. The per-item "MANDATORY" tag is suppressed on Fix rows (the Fix column itself already says that) but kept on Verify rows where a mandatory item has been confirmed, since that's still useful context.
- **Test infrastructure finding**: this repo's `*.test.ts` convention (run via `node --experimental-strip-types --test`, no bundler) cannot resolve the `@/` tsconfig alias at all, and fails one level deeper than that for any relative-import chain reaching a file that itself has its own extensionless relative imports (e.g. `tenderCompliance.ts` imports `"./dates"` with no extension) - confirmed by a minimal `node -e` reproduction. This is exactly why `pack-review-logic.ts`'s own header comment mandates "zero imports" for files meant to be tested that way. `bid-task-status.ts` imports the `@/` alias (for `ComplianceItem`), so its test (`bid-task-status.spec.ts`) uses this repo's other, vitest-based `*.spec.ts` convention instead (started by `lib/readiness.spec.ts`) - except `vitest.config.ts` had no `resolve.alias` for `@/`, so `lib/readiness.spec.ts`'s own relative-only imports had never actually exercised it. Added `resolve.alias: { "@": ... }` to `vitest.config.ts`, mirroring tsconfig's own `"@/*": ["./*"]`, rather than rewriting the alias import away - every future `*.spec.ts` covering app code gets this for free now.
- Screenshots for this prompt cover the "Compliance check - required documents" card in isolation, at 1440px and 390px, old vs. new grouping, using the same mock `ComplianceItem[]` data for both (no real Supabase backend in this environment) - rendered via a temporary dev-only route under `app/design/`, deleted again immediately after the screenshots were taken.

### Verify/Provide readiness-report cards (prompt 8, step 2 of 4)

- **Continues the product-promise audit's 4-system list** (see "Verify/Provide/Fix grouping" just above, #35): step 2 is `app/tenders/[id]/page.tsx`'s own "Already confirmed"/"Please review"/"Needs your input" `ReportCard`s, driven by `field_provenance.status` (`"confirmed"|"computed"|"assumed_default"|"missing"`) - a different data model from step 1's `ComplianceItem` (intake facts read off the tender document, not SANRAL compliance docs), so no shared classifier applies here; this is a presentation-only regrouping of the same 3 existing row arrays (`confirmedRows`/`reviewRows`/`missingRows`).
- **"Already confirmed" and "Please review" merged into one "Verify" card** - both are the same task type (AI-filled, confirm it), just at different points of being confirmed, matching step 1's pattern of one Verify bucket covering both states. Unconfirmed (`reviewRows`) rows render first, with their existing `ReviewButton`; confirmed rows render below, unchanged.
- **"Needs your input" renamed to "Provide" and recolored amber (`#FEF3C7`/`#B45309`), not red (`#FEE2E2`/`#B91C1C`)** - a missing intake fact (e.g. an unstated evaluation threshold) isn't a disqualification risk the way a missing mandatory compliance document is, so Fix's red doesn't apply; Provide's amber does. The sticky summary-chip row above the cards got the same recolor + relabel (`"missing"` → `"to provide"`) for the same reason, kept as 3 separate chips (confirmed/to verify/to provide) rather than merged, since the at-a-glance counts are still useful split out.
- No change to `field_provenance` itself, `ReviewButton`, or `markFieldReviewed` (still the documented no-op pending a `reviewed_at` column) - this pass is markup/grouping only.
- Screenshots cover `#readiness-report` in isolation (old 3-card vs. new 2-card grouping), 1440px and 390px, mock `ProvenanceRow`-shaped data, via a temporary dev-only route under `app/design/` deleted immediately after.

### Pack Review: collapse 5-way ReviewStatus to Verify/Provide/Fix (prompt 8, step 3 of 4)

- **Step 3 is `pack-review-logic.ts`'s own 5-way `ReviewStatus`** (`"confirmed"|"needs_input"|"assumed_default"|"warning"|"missing"`), rendered as 5 differently-colored/labeled Pills by BOTH `pack-review.tsx` (SANRAL) and `general-pack-review.tsx` (general tenders) - the two files duplicate an identical `STATUS_STYLE` map (a pre-existing, deliberate convention per `general-pack-review.tsx`'s own header comment: "not imported from there since that file is SANRAL-only by convention and exports no shared components"), so this needed the same fix made twice, not once.
- **The 5-way vocabulary itself is unchanged** - `fieldStatus`/`provenanceStatus`/`docItemStatus`/`positionStatus`/`b7Status`/`signatureStatus` (and general's own `answerStatus`/`roleStatus`/`signatureAnswerStatus`/`localityStatus`) all still return `ReviewStatus` exactly as before, and their existing tests still key off it directly - this pass only changes how a `ReviewStatus` is PRESENTED, via one new pure function, `reviewStatusToBidTask()` in `pack-review-logic.ts`.
- **Checked every producer of "missing" and "warning" across both logic files before deciding the mapping** (not a guess): every "missing" is a genuine blocker (no confirmed key person, no signatory at all, an unanswered mandatory Form B7, a mandatory-and-disqualifying locality miss) - `missing` → **Fix**. Every "warning" is a softer, non-blocking concern (a role-fit mismatch, a B7 plan note, no signatory capacity on file yet, a non-disqualifying locality miss) - `warning` → **Provide**, not Fix; this is a real fix in its own right, since the old `STATUS_STYLE` painted `warning` the same red as `missing`, visually overstating a role-fit mismatch as a hard blocker. `confirmed`/`assumed_default` → **Verify**; `needs_input` → **Provide**.
- **One known, flagged imprecision, not fixed here**: `signatureStatus`'s "nobody chosen yet, but a suggested default exists" case returns `needs_input`, which this mapping sends to Provide - but it's really Verify-unconfirmed (a default WAS picked, same as `assumed_default`), just under the wrong label. Fixing it means changing `pack-review-logic.ts`'s actual return value (not just its presentation) and touching `pack-review-logic.test.ts`'s existing assertion for that case - judged out of scope for a presentation-only pass; `reviewStatusToBidTask()`'s own comment documents this for whoever picks it up.
- **`BidTaskStatus` is reused, not re-declared**: `pack-review-logic.ts` type-imports it from `bid-task-status.ts` (`import type { BidTaskStatus } from "./bid-task-status"`) - confirmed empirically (a minimal `node -e` repro) that a type-only import is fully erased by `node --experimental-strip-types`, with zero runtime module resolution attempted, so this doesn't violate the file's own "zero imports" rule for direct `node:test` execution (bid-task-status.ts's real runtime import of the `@/` alias is never reached). `general-pack-review-logic.ts` already relied on this same erasure for its own `import type { ReviewStatus }` from this file, confirming the pattern was already proven safe in this codebase before this pass reused it.
- Screenshots cover the Pack Review card in isolation (5-Pill vs. 3-Pill, same 5 mock rows covering every `ReviewStatus` value), 1440px and 390px, via a temporary dev-only route under `app/design/` deleted immediately after.

### Full tender-workspace V/P/F redesign (prompt 9, part 0 of several) - pack-review's own mandatory-blind bug

- **Found while researching the full unified Fix/Provide/Verify redesign Sarel asked for next**: `pack-review-data.ts`'s "Supporting & vault documents" section and `general-pack-review-data.ts`'s "Supporting documents" section both classified every doc item via the plain `docItemStatus(status)` (have/check/missing -> confirmed/needs_input/missing, mandatory-blind) rather than this session's own mandatory-aware `classifyComplianceItem()` (`bid-task-status.ts`, PR #35) - so a SANRAL mandatory doc left merely unconfirmed (`"check"`), or a general tender's `strength: "required"` returnable left unconfirmed, could show as Fix on the compliance/returnables report itself but only Provide on the Pack Review card for the exact same document - two already-shipped screens genuinely disagreeing about the same fact.
- **Fixed both, without changing `docItemStatus()` or its own tests**: `pack-review-data.ts` gained `docItemReviewStatus(item: ComplianceItem)` (reuses `classifyComplianceItem()` for the fix/provide/verify call, keeps `docItemStatus()`'s own `checklistStatus` - pack-compilation inclusion was never mandatory-dependent, so that half was already correct); `general-pack-review-data.ts` gained the equivalent `returnableReviewStatus(check: ReturnableCheck)`, using `checkReturnable()`'s own `strength: "required" | "mentioned"` field as the general-tender analogue of `mandatory` (there is no `mandatory` boolean on `ReturnableCheck` - `strength` is the real disqualification-equivalent signal there). Both reconstruct whichever `ReviewStatus` value makes `reviewStatusToBidTask()` agree with `classifyComplianceItem()`'s own answer (`"confirmed"` when actually on file, `"missing"` for Fix, `"needs_input"` for Provide, `"assumed_default"` for an unconfirmed-but-optional Verify item) rather than inventing a parallel vocabulary.
- **No new test file**: both new functions are thin compositions of already-tested logic (`classifyComplianceItem`'s 8 cases, `reviewStatusToBidTask`'s 5 cases) with no new branching of their own, and both live in files with `next/headers`/Supabase-server imports at module scope - unsafe to import directly into a `.spec.ts`/`.test.ts` file the way this session's other pure-logic functions are. Correctness here rests on the already-tested composed functions, confirmed by `npm run typecheck`/`lint`/`build` passing end to end.
- Not a visually screenshottable change on its own (it's inside a Supabase-reading loader, not a pure UI component) - verified by re-reading the full diff against `classifyComplianceItem`'s own branch logic rather than a screenshot. This is prep work before the larger unified redesign below, not a standalone screen change.

### Tender-workspace header: client + unified readiness score (prompt 9, part 1 of several)

- **Full scope of what Sarel asked for this prompt is large** (header score, 3 top-level collapsible Fix/Provide/Verify groups replacing the scattered sections, per-item "what was filled and from where" + "Looks right"/fix actions, live-updating score, Submit-button gating, a Disqualification Guard view, a Company vault document-expiry overview) - being built as several small, separately-shipped pieces rather than one giant PR, same discipline as every other multi-part prompt this session. This piece: the header's new client line and the unified 0-100 readiness score + "X things left before you can submit" line. The 3-group restructuring, per-item actions, Submit-button gating, Disqualification Guard and vault overview are separate, still-pending pieces of this same prompt.
- **Client was already being READ, just never shown**: `tenderFacts.buyer` (`page.tsx`'s own tender query, used today only by `MarketContext`) is the real "client" field the spec asked for - added to the header as a plain line under the title, no new query.
- **One new pure function, `tender-readiness.ts`'s `computeTenderReadiness(sections)`**, flattens a Pack Review snapshot's `ReviewSection[]` (SANRAL's `PackReviewSnapshot` or general's `GeneralPackReviewSnapshot` - identical shape, confirmed by reading both loaders) into Fix/Provide/Verify groups plus the score, via `reviewStatusToBidTask()` (already built, PR #37) - no new classification rules, this only flattens and counts what the Pack Review card already computes per item. Read "confirmed" strictly (`item.status === "confirmed"`): an item bucketed Verify only because it's non-disqualifying (`"assumed_default"`) still needs a look, so it's one of the "things left", not counted as done.
- **`page.tsx` calls `loadPackReviewSnapshot()`/`loadGeneralPackReviewSnapshot()` directly now, not just inside `<PackReview>`/`<GeneralTenderWorkspace>` further down the page** - both loaders are already `React.cache()`'d, so this is the same single Supabase read, not a second one; doing it here means the header's score can never disagree with the detailed card below it, since both read the exact same cached result for this request.
- **`tenderReadiness` is `null`, not a fake 100%, when there's no pack yet or this family's returnables list isn't mapped** - "nothing to assess yet" and "fully ready" are different states, and the header simply shows nothing in that case rather than inventing a number. Families outside SANRAL/general (none currently reachable, but the branch is explicit) also get `null` rather than guessed.
- **Why a new file instead of extending `pack-review-logic.ts`**: that file's own "zero imports" rule is for direct `node:test` execution without a bundler; `tender-readiness.ts` needed a real (non-type-only) import of `reviewStatusToBidTask` from it, which only resolves under `node --experimental-strip-types` with an explicit `.ts` extension on the relative import (confirmed empirically) - so its own test file imports it the same way `pack-review-logic.test.ts` imports its own target, while every regular `.tsx` consumer (`page.tsx`) imports it extension-free as usual, since Next's bundler (and `allowImportingTsExtensions`) accept either form.
- `tender-readiness.test.ts` (5 cases, `node:test`): empty sections, a failed section excluded from the count, all-confirmed = 100%/nothing left, a realistic mixed scenario bucketing correctly with the right score, and rounding (1/3 -> 33, not 33.33 or 34 via a different rounding rule).
- Screenshots cover the tender-facts header card in isolation (old vs. new, with the client line + score + "things left"), 1440px and 390px, mock tender data, via a temporary dev-only route under `app/design/` deleted immediately after.

### Submit button: disabled while any Fix item is open (prompt 9, part 2 of several)

- **Both tender families' "Generate submission pack" button now gate on `computeTenderReadiness(...).fix.length > 0`** - `submission-pack.tsx` (SANRAL) reads `loadPackReviewSnapshot()` and extends its existing `reviewed`/`blockers` gate (unchanged) with the new Fix check; `general-workspace.tsx`'s own button (previously ungated beyond "at least one document uploaded") gets the same check against `loadGeneralPackReviewSnapshot()`. Both are the same cached snapshot the workspace header's readiness score and the Pack Review card itself already read - this can't disagree with what's shown above it.
- **The disabled reason is shown two ways, not one**: the button's own `title` (hover, desktop) AND a plain-text line right below it, always rendered when disabled - a `title` tooltip never reaches a touch device, so a phone user with no mouse would otherwise see a greyed-out button with no explanation at all.
- **Priority when more than one reason applies** (SANRAL only, since general has no separate review-confirmation gate yet): Fix items block first ("Fix N items first"), falling back to the existing "Confirm the Pack review above first" only when there are no Fix items left - a Fix-item reason is always more specific/actionable than "go confirm the review."
- Not covered: the hard `blockers` array (no confirmed key person, missing blank templates, Form B7 unanswered, a pack already queued) stays a separate, pre-existing gate that hides the whole form rather than just disabling the button - unchanged by this pass, since those are genuinely different situations ("can't generate at all" vs. "can generate once you fix something").
- Screenshots cover the button in both states (disabled-with-reason, enabled) in isolation, 1440px, via a temporary dev-only route under `app/design/` deleted immediately after.

### Disqualification guard (prompt 9, part 3 of several)

- **New `disqualification-guard.tsx`, mounted on both tender families right after the tender-facts header** - Sarel's own 7-check list, built entirely from data this app already computes elsewhere, never re-derived: SANRAL reads `loadTenderCompliance()`'s `docItems` (filtered to keys `tax`/`csd`/`bbbee`) through the same `classifyComplianceItem()` the compliance report itself uses (PR #35), plus `positionRows` for key-personnel CVs; general tenders read `loadSubmissionPlan()` - a sibling session's same-day TypeScript port of `engine/general/submission_plan.py` (see `docs/specs/System-Status.md`) - filtering its already-classified `steps` by their stable catalog ids (`returnable:tax_compliance`, `returnable:csd_report`, `returnable:bbbee_proof`, `cidb_grading`, every `category: "role"` step for CVs). Confirmed those 3 returnable ids are genuinely stable (not a per-tender slug) by reading `engine/general/requirements.py`'s own catalog, which always emits those exact literal keys for the 3 known vault types.
- **CIDB grade comparison exists for general tenders, not SANRAL** - a real correction to this session's own earlier research, which only checked SANRAL's `tenders`/`evaluation_rules` schema (genuinely nothing there) and missed that `RequirementManifest.cidb.grading` (general tenders' own extracted manifest) already carries the tender's required grade, via the sibling session's `cidbGradingStep()`. SANRAL tenders get no CIDB row at all (still no data source there) rather than a wrong one.
- **2 of the 7 checks Sarel asked for have no backing data anywhere in this schema, confirmed by reading every candidate table/column before concluding that**: "required SBD forms present and signed" and "every page needing a signature is signed" - both families only ever track WHO is meant to sign (`signatureStatus`/`signatureAnswerStatus`), never whether a physical signature actually happened on a given page. Rather than omitting these silently or faking a pass/fail, they're shown as their own explicit grey "Not tracked yet" rows, visibly distinct from a real Clear/Fix/Provide verdict - the gap is visible, not hidden.
- **Zero new classification logic**: every status shown is a `BidTaskStatus` already computed by an existing classifier; this component only selects, relabels and renders a curated subset of already-right answers.
- Screenshots cover the card in isolation (every state: Clear/Would disqualify/You need to supply this/Not tracked yet, one mock example each), 1440px and 390px, via a temporary dev-only route under `app/design/` deleted immediately after.

### Company vault: document-expiry overview (prompt 9, part 4 of several - final piece)

- **New `lib/documentExpiry.ts`, a widened version of `lib/notifications.ts`'s own expiry scan** - same source tables and the exact same exported `COMPANY_EXPIRY_FIELDS` list (7 company fields: COID, CIDB, SARS TCS PIN, PI insurance, ISO 9001, bank confirmation letter, B-BBEE proof) plus `held_registrations` and per-person ECSA/SACPCMP, but reads EVERY row regardless of how far out it expires - `getNotifications()` deliberately only surfaces what's within its 60-day "renew soon" bell window, since that's a glance, not a full list. Both read the same tables the same way, so the vault's own list can never disagree with what the topbar bell already says about the same document.
- **4 states, not 3**: Sarel's own spec named Valid/Expiring in 30 days/Expired; a 4th, "Not on file" (grey, neutral), covers a company field with no expiry date recorded at all - a real gap distinct from "expired" (which implies a date WAS on file, just passed), shown rather than silently treated as either "fine" or "a problem that isn't really there." Per-person ECSA/SACPCMP rows are the one exception: skipped entirely when nobody has one on file at all, since not every person needs those two trades tracked (unlike the 7 core company fields, which every company is expected to have).
- **"N documents need attention before your next bid"** counts expired + expiring-soon + missing (not just the 2 states Sarel's own wording named) - a document with no date recorded at all is at least as real a gap as one expiring soon, so it would have understated the real count to leave it out.
- **Sort order**: expired, then expiring soon (Sarel's own two named priorities), then missing, then valid last - within a tied status, soonest-to-expire first.
- `lib/documentExpiry.spec.ts` (9 cases, vitest): status-bucket boundaries (the 30-day cutoff is inclusive), detail-text pluralization, and the sort comparator's full ordering plus its within-status tiebreak.
- Mounted as a new `DocumentExpiryOverview` component right under `BidReadinessCard` on `/company` (`#document-expiry`, added to the page's existing jump-nav) - a new top-of-page card, not a rewrite of the page's existing per-section expiry chips (`#compliance-documents`, `#bee-cidb`, etc.), which stay exactly as they are; splitting this 1000+-line page into proper sections is its own, separate, later piece of work Sarel named.
- Screenshots cover the card in isolation (expired/expiring/missing/valid, one of each, with the attention-count banner), 1440px and 390px, via a temporary dev-only route under `app/design/` deleted immediately after.

## SANRAL schedules: a visible premium feature (prompt 10, item 2)

Sarel: "Make the SANRAL automation a clearly visible, premium feature." The automation itself (`requestSubmissionPack`, `engine/pack/process_pack_jobs.py`, `SubmissionPack` in `app/app/tenders/[id]/submission-pack.tsx`) is unchanged - this is presentation and discoverability only, same instruction as every other piece of this prompt.

- **Sidebar nav entry**: `NavItem` (`app/_components/nav-items.ts`) gained an optional `badge?: string`. A new item, "SANRAL schedules" (`/sanral-schedules`), carries `badge: "Roads & Civils"` - the one nav item with a badge, deliberately, since it's the one automation specific to a single discipline rather than every tender. `AppSidebar.tsx` renders it as a small pill, hidden when the sidebar is collapsed to icons (`group-data-[collapsible=icon]:hidden`).
- **`/sanral-schedules` hub page** (new, `app/app/sanral-schedules/page.tsx`): the front door the nav item points to. Shows the same "usually 6 to 8 hours by hand" promise, the 3-step explainer (reading the file / filling schedules / checking totals), and a list of this company's SANRAL-family tenders (`tenders` joined `tender_packs!inner(id)`, filtered to `SANRAL_CONVENTIONAL_FAMILY`) each with its latest `pack_generation_jobs` status and a "Fill SANRAL schedules" button straight to `/tenders/[id]#submission-pack`. Deliberately does NOT duplicate `requestSubmissionPack()` or any pack-building logic - it only reads already-existing rows and links into the one real action.
- **Promo strip + button rename, in `submission-pack.tsx` itself**: a highlighted amber strip ("SANRAL schedules - usually 6 to 8 hours by hand. We fill them in minutes.") above the existing description, and the submit button renamed from "Generate submission pack" to "Fill SANRAL schedules". No change to what the button does.
- **Progress display** (`app/app/tenders/[id]/sanral-progress.tsx`, new client component `<SanralProgress active={...}>`): cycles the three plain-word captions ("Reading the file…", "Filling schedules…", "Checking totals…") every 4s while a job is `requested`/`generating`. **This is cosmetic, not real** - confirmed by reading `engine/pack/process_pack_jobs.py` in full: a job row only ever carries the same four-value `status` (`requested`/`generating`/`ready`/`failed`); there is no granular per-stage signal anywhere in the engine or the database to drive this from honestly. If the engine ever reports a real stage, this component should read that instead of cycling on a timer.
- **"Time saved" line**: for a `ready` job, shows "Time saved: usually 6-8 hours by hand - this run took Xm" using the real elapsed `started_at` → `completed_at` (both already existed on `pack_generation_jobs`, 0017 - `started_at` just wasn't being selected by this query before now; no new column). The "6 to 8 hours by hand" half is Sarel's own fixed marketing claim, not a per-tender measurement - nothing in this app tracks how long a human would actually have taken; only the engine's own run time is real and shown.
- **Gap flagged, not built**: "(3) any cell the engine couldn't fill becomes a Provide item in the workspace" is **not implemented** - there is no existing signal to build it from. Checked: `pack_generation_jobs.manifest` and `manifest.financial` (engine/pack/pdf_merge.py, engine/pack/assemble_pack.py) only carry document-level inclusion/omission (which whole documents made it into the pack), never a per-cell or per-rate signal inside the filled `.xlsm` workbooks. The actual pricing/hours capture (`engine/fill_financial_hours.py`) writes a "blank capture skeleton" a human fills in entirely outside the web app and database - there is nothing in Supabase this could read today. Building this needs new engine instrumentation (the fill engine reporting specific unfilled cells/rows into the manifest) before a Provide item can honestly exist for it - flagged to Sarel rather than faked.

## CV tailoring and cover page (prompt 10, item 3)

- **The per-role match reason and "change person" control already existed** - found while researching this item, not built fresh: `lib/positionSuggestions.ts`'s `whySuggested()` (e.g. "ECSA Pr Eng, 12 years, matches pavement, materials"), stored on `tender_pack_assignments.suggested_rationale`/`suggested_score`/`suggested_person_id` (migration 0031), rendered by `PositionPersonSelect` (`position-person-select.tsx`) in the Key positions section. Only a visual change was made there: an unconfirmed position now shows a red "Fix: no key person confirmed - blocks the submission pack" chip instead of the old plain amber "Not confirmed yet" text, matching the rest of the app's Fix/Provide/Verify vocabulary (this is the exact same fact `pack-review-data.ts`'s `positionStatus()` already classifies as Fix elsewhere on this page - no new rule, just now shown where the person-picker itself lives, not only in the aggregated readiness score).
- **New `cv-compare.tsx`**: a real side-by-side of the person's original uploaded CV (`cv_uploads`, newest row) and the tender-specific generated one (`generated_cvs`, newest `ready` row for this tender+position+person), each a genuine download link (signed URLs, `cv-documents` bucket), plus an "Edit on People page" link to `/people/[id]#cv-documents` (real - re-uploading there does change what "original" is).
- **Two parts of Sarel's own spec checked and NOT built, because they'd be cosmetic, not real**: a line-level diff with "changed lines highlighted" between original and tailored, and "Use tailored"/"Use original" buttons. Checked before deciding this: the two documents aren't the same file with edits - the original is whatever a person uploaded (any layout), the tailored one is a wholesale fresh render by `engine/cv/generate_cv.py` onto the SANRAL key-person template, so there's no line-level correspondence to diff. And the pack engine already auto-picks which CV goes into a pack itself (`pack_generation_jobs`'s own migration comment: "the newest ready generated CV (else the person's newest as-is upload)") with no per-position override input anywhere a button's choice could be written to and actually honored - building clickable buttons that store a preference nothing reads would be exactly the "fake it" this whole prompt series has avoided. Would need: a real per-position CV-choice column, and `process_pack_jobs.py` reading it, before these buttons could do anything.
- **New `cover-page-preview.tsx`** (`#cover-page`, SANRAL family only, mounted next to `TenderTemplates`): a read-only preview of exactly what `engine/make_envelope_covers.py`'s `make_outer`/`make_inner` print today - logo, contract number + NRA reference, description, client, closing date/time, tenderer name - all from `tenderFacts` (already loaded by this page) and `companies.legal_name`/`logo_storage_path`.
- **Deliberately not editable - two real gaps found and flagged, not faked**: (1) Sarel's spec asked for two user-editable fields here, "title wording" and "contact person" - checked `make_outer`/`make_inner`'s actual function signatures in `make_envelope_covers.py` and `process_pack_jobs.py`'s call into them: **neither accepts a title override or a contact-person argument today**. A text box for either would store something nobody reads and change nothing about the real generated cover - building it would be the same mistake as the CV buttons above, so it wasn't built. Needs a new engine parameter (plus somewhere to store the value - `tender_answers`' existing field-key pattern, the same one `signatory_person_id` already uses, would cover storage with no migration; the engine side is the real gap) before this is real. (2) **The logo preview is always "No logo on file" in practice** - `companies.logo_storage_path` is a column with no storage bucket ever created for it (checked every migration's `storage.buckets` insert) and no upload control anywhere in this app. Flagging rather than building an upload flow, since that's its own feature, not a styling pass on an existing one.
- **Drag-to-reorder submission pack order**: **not built, flagged** - same architectural reality as item 2's pack order (`engine/pack/assemble_pack.py` fixes section order itself; nothing in the schema or any table carries a user-settable sort order for pack contents). A reorderable list that didn't actually reorder the real PDF would be worse than no control at all.
- **One-click "Download submission pack" (new `download-all-button.tsx`)**: real and built - for a ready job, fires every already-computed signed URL (the PDF plus every `output_files` entry) from one click instead of one link at a time. No new data; the signed URLs already existed for the per-file links right next to it.

## Bids pipeline redesign (prompt 10, item 4)

Sarel's spec named 7 columns, a card shape (tender/client/value/closing-date-colour/owner-avatar/readiness), an Awarded/Lost outcome form, a list-view toggle and a header stats strip. Built within this prompt's own instruction ("use existing fields; tell me which new fields would be needed rather than adding a migration") - no migration added anywhere in this piece.

- **7 columns asked for, 5 stored values exist**: `tender_packs.pipeline_stage` (migration 0021) has a hard `check` constraint allowing exactly `found`/`bidding`/`submitted`/`won`/`lost` - confirmed by reading the constraint itself, not assumed. Two of Sarel's 7 requested columns genuinely need new stored state that doesn't exist today: splitting "Bidding" into separate **Assessing** and **Building** states, and a separate **Briefing/Shortlisted** state between Submitted and an outcome. Rather than silently skip these or invent a fake in-memory split, `STAGE_META` (`lib/pipeline.ts`) was relabeled as far as a true 1:1 rename allows - `found`→**Discovered**, `bidding`→**Assessing & building** (one real column covering both requested names), `submitted`→**Submitted** (unchanged), `won`→**Awarded** (a rename, not a new state), `lost`→**Lost** (unchanged). The 2 missing columns are flagged here, not built: they need a migration widening `pipeline_stage`'s check constraint (and deciding what existing `bidding`/`submitted` rows backfill to), which this piece's own instruction says to flag rather than add unasked.
- **Card**: tender name/client/closing-date (unchanged, already shown) gained 3 real additions. **Value** reads `tender_packs.submitted_price_zar` (items 26/27, already stored, already shown inside the collapsed Price & credit form) - now also a plain line on the card face. **Owner avatar** is the exact same `submitted_by_person_id` ("credit for the submission") rendered as a small initials circle - no separate "bid owner" concept was invented; it's the same fact EconomicsForm already writes, just also shown as an avatar. **Closing-date colour** now matches Sarel's exact thresholds (red < 3 days, amber < 7 days, via a new shared `closingColor()`) - the pre-existing code only had one amber tier at `<= 7` with no red tier at all. **Readiness score**: reuses `computeTenderReadiness()` (prompt 9) via the exact same cached `loadPackReviewSnapshot`/`loadGeneralPackReviewSnapshot` the tender workspace's own header score reads - but **only computed for "Assessing & building" cards**, not every card on the board. A full Pack Review read is real, multi-query Supabase cost per tender (same N+1 concern already flagged for Home's own "specific next step", see "Home cockpit" above); Found hasn't started a pack, and Submitted/Awarded/Lost are already past needing a readiness number, so bounding to the one stage it's actually relevant to keeps this from becoming a board-wide N+1.
- **List view** (the "list-view toggle"): a second `TabsTrigger`/`TabsContent`, reading the exact same `cards` array the board already built - no second query, a flat table with the same value/closing-colour/owner/readiness columns as the card.
- **Outcome form (new `outcome-form.tsx` + `recordOutcomeAndMoveStage`, `pipeline/actions.ts`)**: winning company, winning price, number of bidders, reason lost. **None of these 4 facts exist as a column anywhere in this schema** (checked `tender_packs`, every migration's own `alter table tender_packs`, and the won-project-sync columns from 0065, which are about OUR OWN completed-project value after winning, not the competitive award facts) - so, per this item's own instruction, no migration was added. Stored instead in `tender_answers` (0018's generic company+tender+field_key+value table, already reused cross-family for things like `signatory_person_id`) under new `outcome:*` keys (`lib/pipeline.ts`'s `OUTCOME_FIELD_KEYS`) - a real, working store (nothing needs to read these back except this same form and the card's own outcome summary line), not a placeholder. Shown on Submitted (open by default, to record the outcome as part of the move) and on Awarded/Lost (collapsed, pre-filled, to correct it later) via two submit buttons in one form (`name="stage" value="won"|"lost"`) that write the answers and move the pipeline stage in the same request.
- **Found, and NOT used for the outcome form, by design (flagged for follow-up)**: `public_tender_outcomes` (migration 0053) already holds real, publicly-published SANRAL/eTenders award data - `winner_name`, `winner_amount_zar`, `bidders` (a full bidders list on some rows), matched to a real tender via `award_match_keys()`, a SQL function keyed on contract number/NRA reference/OCDS id. This is a genuinely better source than manual entry for the two fields it actually covers (winning company, winning price) **when a match exists** - but nothing in this app today joins ONE tracked tender to its OWN `public_tender_outcomes` row (confirmed by grepping every caller of `award_match_keys()` - it's only ever used inside migrations 0053/0062's own SQL, for the market-trend aggregate across MANY tenders, never a single-tender lookup). Wiring that up for real needs: calling `award_match_keys()` (or porting its normalisation) against this specific tender's `contract_no`/`ocid`, joining `public_tender_outcomes`, and deciding how to merge "the public register says X" against "the user typed Y" when they disagree (and what `winner_match_basis`/`register_columns`'s own caveats about match confidence mean for how much to trust an auto-fill) - a real piece of its own, not a two-line addition, so it's flagged here rather than attempted under this already-multi-part prompt. Until it exists, the outcome form stays fully manual for all 4 fields, for every tender family alike.
- Screenshots cover the Bids board (before/after: old 5-column labels and plain cards vs. new labels, value/owner/readiness on a card, the Submitted-stage outcome form open) and the new List tab, 1440px and 390px, via a temporary dev-only route under `app/design/` deleted immediately after.

## Company vault: shell (sub-PR 1 of 5)

First of 5 planned sub-PRs restyling Company vault/Registrations/Bank/Principals/Properties/People/Experience to the design system. This piece: `/company`'s own shell only - the left sub-nav, extracting its ~1100-line monolithic `page.tsx` into real components, and converting company-identity/size-offices/how-we-work/BEE-CIDB/bank-details to Tailwind+tokens. The 4 separate routes (`/company/bank-accounts`, `/principals`, `/properties`, `/registrations`, `/document-scan`) and People/Experience are untouched - later sub-PRs.

- **Horizontal `CompanyJumpLink` pill row → persistent left sub-nav** (`app/company/_components/CompanySubNav.tsx`): same 11 section anchors as before (Expiry/Documents/Identity/Size & offices/How we work/BEE & CIDB/Bank details/Notifications/Registers/Letters/Offices), not a re-scoped set - "convert the existing nav" read as a layout change, not a chance to drop or add sections. Renders as a sticky vertical list at `lg:` and up (`lg:sticky lg:top-20`, beside the content column so it stays pinned across every section, including `RegisterLinks`/`LettersSection`/`Notifications`/`OfficeLocations`, now all moved inside the same scrolling column for exactly that reason), and as the original horizontal scrollable pill row below `lg:` - one component, two Tailwind layouts, rather than a second nav for mobile.
- **Completion ticks reuse exactly 2 existing signals, nothing invented for the nav itself**: `company-identity`'s and `bee-cidb`'s ticks are `readiness.criteria` entries (`company_basics`+`csd`, `bee`+`cidb`) already computed by `lib/readiness.ts`; `compliance-documents`'s tick reuses `lib/documentExpiry.ts`'s own `statusFor(daysUntil(...))` against the same `COMPANY_EXPIRY_FIELDS` (`lib/notifications.ts`) the document-expiry overview already reads - "valid" on all 7 means the tick shows. Every other section (size/offices, how-we-work, bank-details' plain fields, registers, letters, offices) has no existing single-criterion signal to borrow, so it gets no tick rather than a guessed one - per the prompt's own "where there's real data to compute it from."
- **`DocumentExpiryOverview` moved, not rebuilt**: same `loadDocumentExpiryOverview()` call, same rows - now the first card inside the new content column (beside the sub-nav) instead of a full-bleed card above the old horizontal nav, and its own card shell converted from inline hex to `SectionCard` + soft-tint tone classes.
- **Extraction**: `ReadOnlyView`, `EditForm`, `Section`, `Badge`, `DocumentRow`, `LettersSection`, `RegisterLinks` (all previously inline functions in `page.tsx`) are now real files under `app/company/_components/` - `ReadOnlyView` itself split further into one file per section (`CompanyIdentitySection`/`SizeOfficesSection`/`HowWeWorkSection`/`ComplianceDocumentsSection`/`BeeCidbSection`/`BankDetailsSection`) since each is its own sub-nav anchor. `CompanyRow`/`DocUrls` moved to `app/company/types.ts` so the split files share one shape without importing the page module. Every field, label and real value is unchanged - confirmed by keeping each section's JSX a line-for-line Tailwind translation of its old inline-CSSProperties version, not a rewrite.
- **New `ChipBadge`/`toneForChip`** (`_components/shared.tsx`): `lib/dates.ts`'s `StatusChip` (expiry/BEE/doc status - `expiryStatus()`'s 4-state red/amber/green/grey) still returns a literal hex pair, not a tone name, and `StatusBadge` itself is typed to `TenderStatus` only, so it doesn't fit. `toneForChip()` maps the same 4 literal hex values (already identical across every inline-CSS screen that renders a `StatusChip` today, e.g. `DocumentExpiryOverview`, `disqualification-guard.tsx`) onto the design system's soft-tint tone classes - `expiryStatus()`'s own logic is untouched, this only changes how its result is painted. `NotStated()` was changed from returning a literal grey hex pair to an empty string, since `toneForChip` already falls back to `muted` for anything that isn't one of the 3 named colors.
- **`EditForm` converted to shadcn `Input`/`Textarea`/`Label`/`Button`** (no shadcn `Select` exists in this repo, so the two native `<select>`s keep plain Tailwind classes matching `Input`'s own look) - inputs bumped to `min-h-11` to keep this app's existing 40-44px touch-target convention (shadcn's default `Input` is 32px), same reasoning as the dashboard migration's own `Button` size bump (prompt 2).
- **`how-we-work`'s empty state** is the one natural `EmptyState` fit in this section's own scope (its old ad-hoc "Not written yet" paragraph) - no other ad-hoc empty/loading state was hunted for outside this sub-PR's own 5 sections, per the prompt's own scope line; the other 5 Company sub-routes are sub-PR 5's job. No `Skeleton`/loading state was added anywhere: this page has no Suspense boundary and never did (it's one blocking server read), and inventing one would be a data-flow change, not a styling pass.
- **Nothing flagged as missing data this time** - every section converted already had real data and real completion signals to reuse (or legitimately none, per the tick rule above); no new Server Action, query or migration was needed.
- Screenshots cover `/company` in full (before: old inline-CSSProperties page with its horizontal jump-nav; after: left sub-nav + extracted sections), 1440px and 390px, via a temporary dev-only route under `app/design/` (mock company data, since this environment has no live Supabase backend) deleted immediately after.

## Tools (hub + 4 calculators): color-token migration (2026-10-21)

The SANRAL schedules/Tools/Admin audit's systemic finding: `/tools` (the public, unauthenticated lead-magnet section - deliberately outside `AppShell`, see "App shell" above) was still 100% raw inline-CSSProperties with the OLD pre-color-scheme-update palette (Civic Navy `#16233B`, gold `#D97706`), from before prompt 3's "confident & premium" direction shipped - the same root cause repeating in 5+ places. Migrated the shared header first (fixes the pattern in 5 places at once - the hub + all 4 calculators mount it), then each page's own remaining hardcoded hex.

- **`ToolsHeader.tsx`** (shared header/footer for the hub and all 4 tools): `bg-foreground`/`text-white` for the navy bar (same pairing `AuthShell` already established for a dark panel), `bg-accent`/`text-accent-foreground` for the one solid CTA ("Start free") and the logo badge - blue, not gold, matching the rest of the app since prompt 3. Links bumped to a 44px touch target (`min-h-11`); the old 36px CTA predated that convention.
- **`/tools` hub**: badges/left-border read `bg-foreground`/`border-l-foreground` (ink, matching the header); the one hover highlight on each tool card now reads `border-accent` + `shadow-md` instead of reintroducing gold - "accent is the one highlight color" holds here too. Page background moved from flat white to `bg-background` so the white tool cards read as lifted surfaces, same card-on-canvas layering every migrated page already uses; the cards themselves stayed white (`bg-card`), no visual change there.
- **Status-color migration, by meaning, not 1:1 hex swap** (the specific ask): CIDB grade's sufficient/insufficient verdict -> `text-success`/`text-destructive`; its grading-table "this is the row you need" highlight isn't a pass/fail verdict, so it reads `text-accent`, not a leftover amber. B6 estimator's 3-way outlook (clears/borderline/cannot-clear) -> `text-success`/`text-warning`/`text-destructive`; its matrix-not-found note is a genuine warning, not an error, so it also reads `text-warning` (previously the same amber hex as a coincidence, not a deliberate pairing). Every plain input-validation error across all 4 tools -> `text-destructive`.
- **Deadline calculator's mode toggle**: was two hand-rolled `<button>`s swapping navy/white hex for the selected state - replaced with the real `Tabs`/`TabsList`/`TabsTrigger` (already used elsewhere, e.g. the Bids board's own Board/List toggle) instead of re-skinning the hand-rolled version, so the selected-state look and focus ring match every other tab control in the app.
- **Real bug found and fixed in passing, not just a color change**: `CidbGradeClient`'s `formatZar()` and `BeePreferencePointsClient`'s inline threshold line both called `n.toLocaleString("en-ZA")` - this caused a genuine, reproducible React hydration-mismatch error on first load of both static-prerendered pages (confirmed via a real headless-browser run, console: `Hydration failed... R200,000` server vs `R200 000` client), because Node's own ICU data formats "en-ZA" with a comma while every browser's full ICU data uses the correct SA space-grouping. Fixed by formatting the space-separated grouping by hand (no `Intl`/locale dependency), which can't disagree between server and client. Re-verified with the same headless run: zero hydration errors across all 4 tool pages afterward.
- **Mobile**: CIDB's grading table and the B-BBEE level table both gained a horizontal-scroll wrapper (`-mx-5 overflow-x-auto px-5`, `min-w-[320px]` on the table) so a wide table scrolls within its own card rather than overflowing the page at 390px. B6 estimator's per-project Start/End date row switches from `flex-row` to stacked (`sm:flex-row`) under 640px. Every input/select/button across all 4 tools bumped to a 44px touch target (`min-h-11`), beyond this app's older 40px convention, per this pass's own a11y bar.
- Screenshots cover the hub and all 4 calculators (including a filled/verdict state for CIDB and B6), 1440px and 390px, against the running dev server directly (this environment does have a reachable Supabase for `/tools`, which needs no auth) - confirmed via headless Chromium, including the before/after hydration-error check above.

## Notifications bell error isolation + SANRAL schedules error state (2026-10-21)

Highest-severity finding from the SANRAL schedules/Tools/Admin audit: `AppShell.tsx` called `getNotifications(supabase)` inside its one `Promise.all` with no try/catch. `Promise.all` rejects the moment any one of its promises rejects, so a `getNotifications()` failure (a bad expiry date, a transient read) didn't just blank the bell - it made the whole `Promise.all` reject, which made `AppShell` itself throw, which broke **every signed-in page in the app**, not only the one with the bad notification.

- **Fix is isolation, not a try/catch around the whole block**: `getNotifications(supabase).catch((error) => { console.error(...); return null; })` is now one of the 3 promises inside the same `Promise.all` - the admin-check and company-name reads stay genuinely parallel (no perf regression), but a `getNotifications()` rejection now resolves to `null` instead of rejecting the whole array. `AppShell` turns that into `notifications: []` + a new `notificationsError: true`, threaded through `TopBar` to `NotificationsBell`, which now shows "Couldn't load notifications right now. Try reloading the page." inside its own popover instead of either a blank list or (previously) nothing at all, because the page never rendered.
- **Confirmed the bug was real, not theorized**: a standalone Node reproduction of the exact `Promise.all` shape (one throwing promise, uncaught) confirmed the whole array rejects and would propagate out of `AppShell`; with the `.catch()` in place the same reproduction resolves cleanly with `notificationsError: true` and the other two reads intact. Also screenshotted `TopBar` directly (mounted via a temporary dev-only route under `app/design/`, deleted after) with `notificationsError={true}` - the search bar, company name, sidebar trigger and avatar all render normally; only the bell's popover shows the degraded message. Confirmed the popover (`w-80`, 320px) doesn't clip off-screen at 390px either, with `align="end"` - no change needed there.
- **`app/sanral-schedules/page.tsx`** had the same shape of gap one level down: both the `tenders` and `pack_generation_jobs` Supabase reads were unwrapped, with only a zero-rows empty state, no error state. Wrapped both in one `try/catch`; a thrown/`error`-returning read now shows a new shared `ErrorState` (`components/tt/error-state.tsx` - same shape as `EmptyState` but destructive-toned, for "this failed" rather than "nothing here yet") with a new `RetryButton` (`app/_components/RetryButton.tsx`, a small client component wrapping `router.refresh()` - reused by both this fix and, going forward, by the admin loading/error pass).
- Both new components (`ErrorState`, `RetryButton`) are generic, not sanral-schedules-specific, since the admin pages' own error-state pass (planned as a separate PR) needs the exact same shape.
- No color/token changes in this PR - `ErrorState` reads `bg-destructive/10`/`text-destructive` the same way `EmptyState` already reads `bg-accent/10`/`text-accent`, nothing hardcoded.
- Screenshots cover the bell (working state unchanged; new error state) and the SANRAL schedules card list (empty state unchanged; new error state), 1440px and 390px, via a temporary dev-only route under `app/design/` deleted before the final commit.

## PayFast billing + Resend transactional email (2026-10-21)

Two new, genuinely new pieces of infrastructure: a `company_subscriptions` table + PayFast sandbox checkout/ITN, and a Resend integration for a welcome email and "closing in 3 days/24 hours" deadline reminders. Both are real, server-side features - not a UI mock - built and tested as far as this session's own tools allow; what was and wasn't tested live is spelled out below rather than asserted.

### Pricing tiers: a real discrepancy, resolved by trusting the live page

- **The prompt that asked for this named a 4-tier scheme (Starter R1,490/Professional R2,990/Roads & Civils R4,990/Enterprise "from R9,500") that does not exist anywhere in this codebase** - checked `app/page.tsx`'s own `PRICING_TIERS` (the real, current, shipped pricing) and `docs/strategy/Marketing-Pricing-Strategy.md` (the actual pricing research behind it, commit `f565916`): both agree on 3 tiers - **Tender Watch** (free), **Tender Pro** (R1,490/month), **SANRAL Pro** (R3,950/month) - and neither has ever named a "Roads & Civils" or "Enterprise" tier. Likely a stale/confused brief rather than a deliberate pricing change nobody told this session about. Per this piece's own scope boundary ("`app/page.tsx` is off-limits... leaving `PRICING_TIERS` exactly as currently written for you to make true"), `lib/billing.ts` matches the REAL, live tiers, not the brief's 4-tier list - flagged here rather than silently picked one.
- **Yearly = 10x monthly ("2 months free"), computed in `lib/billing.ts`'s `yearlyPriceZar()`, never a second hardcoded price** - matches the Marketing-Pricing-Strategy doc's own stated R14,900/R39,500 annual figures exactly (`priceForPlanZar()`'s own test asserts this).

### Schema (`supabase/migrations/0078_company_subscriptions.sql`, `0079_sent_deadline_reminders.sql`)

- **`company_subscriptions`**: one row per company (`unique` on `company_id`), `plan_tier`/`billing_interval`/`status` + `trial_ends_at`/`current_period_end`/`payfast_token`/`payfast_m_payment_id`. Created automatically by an `after insert on companies` trigger (`companies_start_trial`), not a change to `create_company_and_join()` itself - same "add via trigger, don't touch the existing function" pattern `0066`'s own `tt_check_same_company` trigger already used in this repo. Every new company starts `trialing`, defaulted to **`sanral_pro`** (the full product, not the free Watch tier) for 14 days - Sarel's own "full access" wording for the trial.
- **No service-role client anywhere in `app/`** - confirmed and deliberately followed, not just avoided by accident: `0077`'s own header comment states outright "this Next.js app never holds the Supabase service-role key... only `engine/*`, the bridge workers, do." PayFast's ITN arrives with zero Supabase session (PayFast's server calls ours directly), which would normally be exactly what a service-role key is for - instead, two narrow `SECURITY DEFINER` RPCs do the privileged writes: `start_payfast_checkout(plan, interval)` (`auth.uid()`-scoped, same shape as `0073`'s `set_my_daily_digest_opt_in`) issues an unguessable `payfast_m_payment_id` bearer token; `apply_payfast_itn(m_payment_id, ...)` (granted to `anon` - same precedent as `0064`'s `signups_enabled()`) updates **only** the one row matching that token, never a `company_id` argument a caller could point anywhere else - the exact same "possession of an unguessable token is the authorization" model `0077`'s own `company_invites` already uses for exactly the same "no Supabase session exists for this caller" problem.
- **`sent_deadline_reminders`** (+ `record_deadline_reminder_sent()`): one row per `(tender_id, threshold_days)`, claimed atomically via the insert's own unique-constraint violation (not a select-then-insert race). Not tenant-scoped, not readable by any client role at all (RLS enabled, zero policies) - the only thing anything reads from it is "did I already send this."
- **Real-database verification, not just unit tests**: replayed all 79 migrations onto a fresh local Postgres (`engine/security/replay_schema.sh`, the same tool `bridge-worker-ci.yml`'s `tenant-isolation-db` job uses) and walked the FULL lifecycle with real RLS roles switched via `set local role`: `create_company_and_join()` as `authenticated` → trial row appears automatically (`sanral_pro`/`trialing`/14-day `trial_ends_at`) → `start_payfast_checkout('pro','yearly')` as that same user → `apply_payfast_itn(...)` as `anon` with `payment_status='COMPLETE'` → row flips to `active` with the real `payfast_token`/`current_period_end`. Also confirmed: a `FAILED` status sets `past_due`; an unknown `m_payment_id` hard-errors rather than silently succeeding; a second company's `authenticated` user reads zero rows of the first company's subscription (RLS); a direct client-side `update company_subscriptions` affects zero rows (no update policy exists at all - the two RPCs are the only path); `record_deadline_reminder_sent` returns true once, false on an immediate repeat, true again for a different threshold.

### PayFast integration (`lib/payfast.ts`, `app/api/billing/checkout`, `app/api/billing/payfast/itn`)

- **Signature algorithm independently verified against PayFast's own official open-source SDK, not assumed from conflicting third-party tutorials.** Cloned `github.com/PayFast/payfast-php-sdk` and read `lib/Auth.php`/`lib/PaymentIntegrations/Notification.php` directly: there is no single "canonical field order" PayFast requires (a real misconception several community tutorials repeat) - the actual rule is narrower: sign and submit fields in the SAME order (PHP's `$_POST`, like this app's own parsed form body, preserves submission order), and PHP's `urlencode()` differs from JS's `encodeURIComponent()` in two ways (`+` for space, and escaping `! * ' (` `)` too). `lib/payfast.spec.ts` reproduces PayFast's own real recorded ITN test fixture from that SDK's test suite (`m_payment_id=000000020`... → `4078bca2c8987e0e0c4e7230f2f46323`) byte-for-byte - the strongest available confirmation this is right, independent of this repo's own code being merely self-consistent with itself.
- **`orderedCheckoutEntries()` is the one place checkout's field order is decided**, used by both the signature AND the actual rendered `<form>` inputs (`app/api/billing/checkout/route.ts`) - they can never silently drift apart into two different orders.
- **ITN verification does all three of PayFast's own documented checks, failing closed**: signature (`verifyItnSignature`, above), source IP (resolves PayFast's own documented hostnames via DNS, best-effort - doesn't hard-block if the host can't resolve any of them, since a platform not forwarding a client IP shouldn't make every payment unreconcilable), and - PayFast's own strongest documented check - a server-to-server POST of the exact raw body back to PayFast's `/eng/query/validate`, requiring the literal response `"VALID"`. This third check matters more than usual here: the sandbox's universal test merchant has no real passphrase configured, so a bare signature match is a weaker guarantee than on a live account with one set; `confirmWithPayfast()` is the real gate.
- **Live sandbox checkout could NOT be completed with the "well-known" universal test credentials (`merchant_id 10000100` / `merchant_key 46f0cd694581a`) this piece was told to use** - tried systematically (no passphrase, the passphrase several tutorials cite for this exact pair, alphabetical/raw/percent-20 field-order variants, minimal and full field sets) against the REAL `sandbox.payfast.co.za/eng/process` endpoint; every well-formed attempt was rejected with the identical `"Generated signature does not match submitted signature"`, while a deliberately malformed `merchant_key` got a DIFFERENT, specific error (`"must be 13 characters"`) - proving the endpoint validates fields for real rather than being generically broken, and narrowing the problem to this specific account's current state, not this file's algorithm (independently confirmed correct against PayFast's own fixture, above). Most likely explanation: this shared demo account no longer has an active secret on PayFast's current servers. **Not faked or assumed working** - flagged plainly: before this goes live for a real customer, get a real PayFast sandbox merchant account (free, via PayFast's own developer portal - a human/business-registration step, not something this session could do) and confirm its actual `merchant_id`/`merchant_key`/passphrase, then re-run the live walk end-to-end including PayFast's own hosted checkout page (this session also has no browser-automation tool to click through a hosted payment page even with working credentials).
- **What was and wasn't tested, precisely**: real (byte-verified against PayFast's own fixture + exercised against the real validate endpoint returning genuine `INVALID`/field-specific errors) - the signature algorithm, the ITN handler's accept/reject logic, the full DB lifecycle (trial → checkout → active/past_due) against a real Postgres replica. NOT completed live - an actual successful hosted-checkout payment and its resulting real ITN delivery, because the publicly-documented sandbox credentials this piece was told were "universal" did not work against PayFast's real server in this session.

### Enforcement: banner only, no hard gate (deliberate, first-cut scope)

- `lib/billing.ts`'s `effectiveSubscriptionStatus()`/`isSubscriptionLapsed()` are pure, computed fresh on every load from `trial_ends_at` vs. now - same "recomputed, nothing persisted that doesn't need to be" idiom as `lib/notifications.ts`/`lib/documentExpiry.ts`. A lapsed trial (`past_due`/`cancelled`) shows `SubscriptionBanner` (mounted in `AppShell`, every signed-in page except an `employee` - they can't act on billing anyway) with a link to `/billing` - **nothing is hidden or blocked**. This was a judgment call reading the prompt's own "not silently keep working OR silently locking out mid-session" as asking for visibility first, not a hard paywall in the very first pass that also introduces real money-adjacent code.
- **Explicitly NOT built, flagged as real future work**: per-feature/per-tier gating (e.g. "only SANRAL Pro sees SANRAL schedules") - the prompt's own instruction said not to attempt this unless trivial, and it isn't (every route would need its own tier check). A genuine hard lock-out once lapsed. A self-service downgrade-to-Watch or cancel flow (`/billing` only ever links to checkout for the two paid tiers - there's no button that moves a company OFF a paid plan). PayFast subscription cancel/pause via their own adhoc API (`payfast_token` is stored for exactly this, unused so far). `current_period_end` is estimated locally (+1 month/+1 year from the ITN's own timestamp) rather than read from PayFast's own billing-date fields, which would be more exact.

### Resend transactional email (`lib/resendEmail.ts`, `lib/emailTemplates.ts`)

- **Confirmed, not assumed: no email-SENDING call existed anywhere in `app/` before this piece** (`company_members.daily_digest_opt_in` + `set_my_daily_digest_opt_in()`, migration `0073`, was a consent flag with nothing behind it - `app/company/Notifications.tsx`'s own copy already says so). **A real Resend sender DOES already exist, just not in `app/`**: `engine/notify/send_digest_emails.py` (a sibling pass, same day as `0073`) sends the role-based daily digest via Resend, scheduled by `.github/workflows/daily-digest.yml`. This piece's welcome/deadline-reminder emails are a genuinely different, event-triggered notification type (not a daily summary) - built alongside that, not duplicating it, and deliberately reusing its one real design choice: **honest degradation on a missing `RESEND_API_KEY`** (log clearly, send nothing, never throw, never claim a send that didn't happen) rather than inventing a second convention.
- **Consent reused, not duplicated**: deadline reminders check the SAME `company_members.daily_digest_opt_in` flag as the daily digest, rather than a second opt-in checkbox - read as the task's own "reuse this existing infrastructure... rather than building a second, parallel email-sending mechanism" instruction applying to consent as much as to data. The welcome email is sent once, unconditionally, on company creation (a one-time transactional email, not a recurring notification - the normal SaaS convention of not opt-in-gating it).
- **Deadline reminders are a standalone script (`scripts/send-deadline-reminders.ts`), not a Next.js route** - same reasoning as the service-role-key decision above: this job genuinely needs to read every company's closing tenders and members' emails in one run (cross-tenant), which needs the service-role key, which `app/` never holds. Run by a new `.github/workflows/deadline-reminders.yml`, same shape as `daily-digest.yml` (scheduled GitHub Action, not an always-on worker, degrading to "a bit late" rather than broken on a missed run). **Triggers off the exact facts `lib/notifications.ts`'s bell already computes** - same tenders/`tender_packs` join, same `DEADLINE_WINDOW_DAYS` constant (moved to the new `lib/deadlineReminders.ts` and re-exported from `lib/notifications.ts`, not duplicated - see that file's own comment on why it had to move: `lib/notifications.ts` has its own extensionless relative import (`"./dates"`) that a direct `node --experimental-strip-types` run of the script can't resolve, the exact limitation `app/AGENTS.md`'s "Verify/Provide/Fix grouping" entry already documented for `pack-review-logic.ts`'s "zero imports" rule - confirmed by trying it, not assumed).
- **A real correctness fix found while building this, not merely a missing-key placeholder**: `record_deadline_reminder_sent`'s claim is one-time-only (the table's own unique constraint), so the script checks `RESEND_API_KEY` is set BEFORE claiming anything, not after a failed send - claiming a reminder it couldn't actually email would permanently waste that tender's one shot at its 3-day/24-hour warning, with no way to retry once a real key is eventually added.
- **Colors in the email HTML are literal hex, copied from `app/globals.css`'s own light-mode token values** (`#0B1F3A` ink, `#1D4ED8` accent, etc.) - the one place this app's own "tokens only" rule doesn't apply, since an inbox can't read a CSS custom property or a Tailwind class. Flagged in `lib/emailTemplates.ts`'s own header comment that these need a manual update if the tokens ever change.
- **`RESEND_API_KEY` is not set in this environment** - every send path (welcome email, deadline reminders) logs `"RESEND_API_KEY not set - email not sent"` and returns cleanly rather than throwing; nothing else in the app is affected. Needs to be added as a real environment variable (Vercel project settings, or this session's own environment's Network secrets) before either email actually sends - not something to paste into chat.

### Onboarding: new Step 6, additive only

- **A new "Choose a plan" step** (`app/onboarding/_components/Step6.tsx`), after the existing 5 steps - `WizardShell`'s own step list grew to 6 entries, Step 5's "Finish setup" button now continues to step 6 (renamed "Continue") rather than jumping straight to the readiness end screen. Nothing about steps 1-5's own fields, validation or styling changed - a new step, not a rewrite, per this piece's own scope line (a sibling agent's demo-company/trial-walkthrough pass should be re-run against this change, since it adds one more screen to the signup→onboarding flow it's walking).
- Reuses `/api/billing/checkout` directly (same route `/billing` itself uses) rather than a separate onboarding-only checkout path - "Skip for now" (the wizard's own existing pattern on every step) just continues the trial already running since step 1's company creation.

### Signup page itself: untouched

- No change to `app/signup/page.tsx` or its styling at all - plan selection lives in onboarding (step 6, above), the point at which a company - and therefore a subscription row - actually exists. Signup itself only ever creates the Supabase auth user, before any company exists.

### Infra finding while verifying the Vercel preview (unrelated to this PR's own code, flagged for Sarel)

- **Vercel's `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are scoped to `production` only** (checked directly via the Vercel API) - no `preview` target at all. This means EVERY preview deployment for EVERY branch (not just this one) 500s on any page that reaches Supabase (`/dashboard`, `/company`, this PR's own `/billing`) - confirmed it's pre-existing and not something this PR caused, by hitting `/dashboard` and `/company` (untouched by this PR) on the same preview and seeing the identical failure, and by confirming production itself (`tender-tool-sarel.vercel.app`) redirects correctly where the preview 500s. The GitHub "Vercel" status check still reports success because it reports BUILD success, not runtime behaviour - the actual gate this project's workflow has used for every merge so far. Not fixed here (a Vercel project-settings change - add those 3 vars to the Preview environment too - not a code change, and outside this piece's own scope), but flagged since it means no PR's preview has actually been runtime-verifiable through its own Vercel URL.

## Design-system audit fixes: Home cockpit, Bids pipeline, Discovery (2026-10-21)

A follow-up audit named 12 findings across Home/Bids/Discovery - a stale-hex color migration on 3 screens, a couple of mislabeled vocabularies, missing empty states, a stale "Pipeline" label, and a "Discovery" header that never got renamed to "Opportunities". Split into 3 small PRs (one per screen cluster) rather than one large one, same discipline as every other multi-part prompt in this log. Finding 12 (homepage pricing bullet) is explicitly out of scope here - a sibling agent owns `app/app/page.tsx`.

### Home cockpit (this PR)

- **Finding 1 (StatusBadge vocabulary) - confirmed intentional, not fixed.** `statusFor()`'s three variants (`needs-docs`/`in-progress`/`ready`) are a whole-tender PACK-COMPLETION status, not a Verify/Provide/Fix task classifier, and the two don't map 1:1: `computeTenderReadiness()` (the tender workspace's own V/P/F source of truth) can return a tender with BOTH open Fix items and open Provide items at once, while this badge can only show one color. Forcing V/P/F here would either lose information or arbitrarily pick a winner. The badge's TEXT already carries the real next action (`nextStepFor()`'s short, Fix/Provide-shaped phrase, e.g. "Upload COID letter") once a pack exists - only the 3-state colour/variant is a different, valid vocabulary, the same judgment call as the Bids board's own stage machine (see below). Documented in `app/dashboard/page.tsx`'s own `statusFor()` comment, not just here.
- **Finding 2 fixed**: "Closing soon" and "New opportunities for you"'s empty rows were plain `<div>` text - now both use the shared `EmptyState` component (a `Clock`/`Search` icon, a short title, the same description text unchanged).
- **New: empty-state setup checklist** (a separate ask, not an audit finding) - `components/tt/setup-checklist-card.tsx`, a 5-item tick list (company profile, CSD, B-BBEE, SARS TCS PIN, >=1 person with a CV) shown INSTEAD of the "Closing soon" section when `rows.length === 0 && readiness.percent < 50` (zero tracked tenders AND a readiness score low enough that the basics clearly aren't done yet - the same 50% boundary `BidReadinessCard`'s own ring colour already treats as "accent vs warning"). Composed entirely from already-computed signals, nothing invented: `company_basics`/`csd`/`bee` are existing `readiness.criteria`; the tax-PIN check reuses `lib/documentExpiry.ts`'s `loadDocumentExpiryOverview()` row for "SARS Tax Compliance PIN" (on file or not, ignoring its own 30-day expiring-soon window, which isn't the question here); the CV check reuses a NEW pass-through field, `ReadinessResult.peopleWithCvCount` (`lib/readiness.ts`) - the exact same count the `people_cvs` criterion already computes, just exposed raw so this checklist can apply its own >=1 bar instead of that criterion's own >=2 (two honest, different bars on the same fact, not a second computation). Each incomplete item links straight to the screen that fixes it, same `href`-per-blocker pattern `BidReadinessCard`'s own blockers list already uses. "New opportunities for you" keeps rendering independently underneath, unchanged - same reasoning prompt 7 already documented (a fresh company can have real unclaimed Discovery matches).
- **Loading + error states** (task D): `app/dashboard/loading.tsx` (new), shaped like the real page via `StatCardSkeleton`/`SectionCardSkeleton`/`TableRowsSkeleton` - this app's first `loading.tsx` anywhere. The page body moved into a `renderDashboard()` helper wrapped in try/catch; a thrown exception (as opposed to the `tenders` query's own existing, already-handled `{error}` field) now falls back to a new `components/tt/error-state.tsx` + a plain "Retry" link back to `/dashboard`, instead of crashing to Next's generic error boundary. The existing inline `{error}` banner also gained a visible Retry link (previously text-only).
- Screenshots cover the before/after empty-state rows and both setup-checklist states (some items done / all done), 1440px and 390px, via a temporary dev-only route under `app/design/` (no AppShell/Supabase - this environment has no live backend) deleted before the final commit.

## Admin (all 6 pages + AdminNav): color-token migration (2026-10-21)

The SANRAL schedules/Tools/Admin audit's third systemic finding: every `/admin/*` page and its row components were still 100% raw inline-CSSProperties on the OLD palette (navy `#16233B`, muted `#5B6472`/`#8A93A0`, border `#E3E6EA`, gold `#D97706`, plus ad-hoc red/amber/green hex per status) - internally consistent with each other (per the audit's own framing) but consistent with the WRONG, pre-color-scheme-update system. Migrated as one coherent pass across all 14 files (`AdminNav`, the 6 pages, and the 7 row/table sub-components each page renders), same semantic mapping throughout.

- **`AdminNav`** migrated first (same reasoning as `ToolsHeader` for `/tools`): active item `text-foreground`, every link `text-accent` (was gold). Each item wrapped in its own `min-h-11` flex item for a real touch target - the old version was bare inline text with no padding at all.
- **Status chips, same soft 10%-tint convention everywhere** (`bg-<tone>/10 text-<tone> border-<tone>/20`, matching the app-wide Badge/chip convention): system-alert severity (critical/error -> destructive, warning -> warning) and open/resolved status (resolved -> success, e-mailed -> warning, new -> destructive); harness-run ok/flagged and reviewed/not-reviewed; opportunity readiness status and confidence band; requirement-extraction confidence (everything on that page is already below-threshold, so only destructive/warning bands exist, never success). **One real Tailwind bug caught and fixed before it shipped**: `OpportunityRow`'s old `Pill` took a raw hex `color` prop and built its background with a `color + "1A"` alpha-hex trick - a first-pass rewrite of this as `` `bg-${tone}/10` `` would have silently produced NO styling at all, since Tailwind's scanner needs a full static class string in the source and can't see a runtime-interpolated one. Caught by re-reading the diff before moving on, not by a failed build (an invalid/unmatched utility class is not a compile error) - fixed with a static `Record<Tone, string>` map in every row component that needed one, and flagged with a comment at each site so the same mistake isn't reintroduced later.
- **The one CTA per form reads `bg-accent`/`text-accent-foreground`** where the old version used gold for the same role (taxonomy's "Approve and add"/"Add category", settings' "on" toggle state, SystemAlertRow's "Mark resolved", HarnessRunRow's "Mark reviewed") - an ordinary per-row "Save" (taxonomy's `CategoryForm`, OpportunityRow's confidence override) stays `bg-foreground`, preserving the SAME two-tier hierarchy the original inline-hex version already had between "the one consequential add/approve action" and "an ordinary edit-and-save" - not a new distinction invented for this pass.
- **`StatCard` (`components/tt/stat-card.tsx`) gained a `muted` tone** (`text-muted-foreground`) - admin's own CV/document-stats row needed a genuinely de-emphasized count next to 3 toned ones (default/success/warning), which the shared component didn't have a tone for yet. Small, backward-compatible addition in service of a real migration, same precedent as `StatCard`'s own `tone` prop from the dashboard migration (prompt 2). The page's own local `StatCard` function is gone - reuses the shared one.
- **Taxonomy's bespoke `<style>` media-query block** (a hand-written `@media (max-width: 640px) { .tax-grid { grid-template-columns: 1fr !important } }`) is gone, replaced by Tailwind's own `sm:grid-cols-*` responsive classes on each grid directly - also a real mobile fix in passing: the old fixed-width grids only collapsed to 1 column under 640px, so the add-category/approve-suggestion 2-3 column grids stayed multi-column in the 390-639px phone band, where those inputs were already uncomfortably narrow.
- **Every select/input/button across all 6 pages bumped to a 44px touch target** (`min-h-11`) - the old inline versions were mostly 32-40px.
- No logic, query, or data-shape change anywhere in this pass - confirmed by keeping every page's JSX structurally identical (same conditionals, same props, same server actions), only the styling layer rewritten.
- Screenshots cover `AdminNav`, a toned `StatCard` row, and one expanded row from each of the 6 pages' own row components (`SystemAlertRow`/`HarnessRunRow`/`CustomerRow`/`OpportunityRow`/`RequirementItemRow`), 1440px and 390px, via a temporary dev-only route under `app/design/` (mock data passed directly to the real components - this environment's Supabase has no admin session reachable without real platform-admin credentials) deleted before the final commit.

### Bids pipeline + pricing (part 2 of 3)

- **Findings 3-4 fixed (color migration)**: `lib/pipeline.ts`'s `STAGE_META` (the kanban stage chips), `app/pipeline/page.tsx` (board + list), `outcome-form.tsx` and `economics-form.tsx` converted from 100% inline-CSSProperties stale hex to Tailwind + the design tokens in `app/globals.css`, mapped by semantic intent rather than a 1:1 hex swap: `found` (not yet decided) is neutral/muted, `bidding` (active work still to do) is warning, `submitted` matches `StatusBadge`'s own "submitted" variant exactly, `won`/`lost` are success/destructive. Added a `success` `Button` variant (`components/ui/button.tsx`, soft-tint, mirrors the existing `destructive` one) for the outcome form's "Mark Awarded" action - no soft-tint success button existed anywhere in the shared variant set before this.
- **Findings 3-4 (V/P/F vocabulary) - confirmed intentional, not fixed.** The pipeline's "stage" concept (Discovered/Assessing & building/Submitted/Awarded/Lost) is a STAGE MACHINE - which of 5 mutually-exclusive states a tender's pack is currently in - not a Verify/Provide/Fix task classifier. The two are different, valid vocabularies for different questions ("where is this in the process" vs "what kind of thing does the user still need to do on it"); the readiness %/verdict chips already shown per-card are the closer analogue to V/P/F-style task information (readiness is literally derived from `computeTenderReadiness()`, the same Fix/Provide/Verify classifier used elsewhere), and those were left as-is since they already carry that signal. Same judgment call as Home cockpit's `StatusBadge` (see above).
- **Finding 7 fixed**: the Bids List tab now shows the shared `EmptyState` when there's nothing tracked, mirroring the Board view's existing per-column empty copy, instead of rendering a bare empty table.
- **Findings 5-6 fixed**: `pricing/page.tsx` and `market-comparison.tsx` got the same color-token migration, and the stale "Pipeline" label (2 spots: the unpriced-tenders banner's link, and the empty-state link) now reads "Bids" - the current label everywhere else in the app since the App shell prompt.
- **Mobile pass (task C)**: the Bids board is a stacked, full-width card list below `lg` (each stage its own section, one after another) - only becomes side-by-side horizontally-scrolling columns (with the existing `ScrollFade` hint) at `lg` and up, where 5 columns actually fit without cutting content off. Same two-Tailwind-layouts-for-one-markup pattern `CompanySubNav` already used for its own responsive nav (app/AGENTS.md "Company vault: shell"), not a second component tree. The Bids List tab and the pricing page's main "Tenders" table both get a parallel stacked-card layout below `md` (table `hidden md:block`, cards `md:hidden`) - the pricing page's "By type/client/sector" summary table and `market-comparison.tsx`'s two tables stay plain horizontally-scrolling tables on mobile (not converted to cards): they're short, columns-of-numbers, secondary/below-the-fold context, not this screen's main per-tender record the way the Tenders table and the Bids list are. Every button on these screens (including the board's secondary "← Back" control, previously 32px) now has a real 44px touch target.
- **Loading + error states (task D)**: `app/pipeline/loading.tsx` and `app/pipeline/pricing/loading.tsx` (new), shaped like each real page via the existing skeleton primitives. Both pages' bodies now run inside a try/catch, falling back to `ErrorState` + a "Retry" link instead of an unhandled crash on a thrown exception (the `tenders`/`tender_packs` queries' own existing `{error}` field handling is unchanged).
- Screenshots cover the board (token colours, stacked-on-mobile), the List tab's new empty state, and the pricing page's stage chips, 1440px and 390px, via a temporary dev-only route under `app/design/` (mock data, no AppShell/Supabase - this environment has no live backend) deleted before the final commit.

### Discovery -> Opportunities (part 3 of 3)

- **Finding 9 fixed**: the page's `<h1>` still said "Discovery" - renamed to "Opportunities" to match the sidebar label (set in the App shell prompt, app/AGENTS.md above). No other "Discovery" copy on this page named the screen itself (the body copy's own references are to the product concept/flow, e.g. "Discovery's fit verdict" in code comments - left alone, not user-facing).
- **Finding 10 fixed (color migration)**: `discovery/page.tsx` and `downgrade-flag.tsx` converted from inline-CSSProperties stale hex to Tailwind + the design tokens, same semantic mapping used on the other two screens in this audit pass (success/warning/destructive/muted soft-tints). `lib/listingChanges.ts`'s `changeTone()` is a shared pure helper this page is the only caller of - its catch-all tone (a new document, an extension, a published list/award/regret letter) now reads as `info`, not `accent`: several rows can show this "notable, not urgent" tone at once, and the product promise reserves accent for a screen's single most important action/highlight.
- **Mobile pass (task C)**: the right-hand "Closes / action / docs" rail - previously a fixed `flex: 0 0 180px` with a hand-rolled `<style>` media-query override at 600px (flagged in the file's own old comment as a known issue: once it wraps to its own line on a phone, it stays stuck at a narrow fixed width with empty space beside it) - is now plain Tailwind responsive classes (full-width/left-aligned below `sm`, fixed-width/right-aligned at `sm` and up). Same visual fix, no inline `<style>` tag left on the page. The compact "Prepare this tender" button shown inline next to the verdict chip (for mobile reachability, so the primary action isn't buried below the card's full content) now has the same real 44px touch target as the desktop rail's own copy of that button - it was 32px before.
- **Loading + error (task D)**: `app/discovery/loading.tsx` (new), and the page body now runs inside a try/catch with an `ErrorState` + Retry link fallback, same pattern as the other two screens in this pass.
- Screenshots cover the renamed header, the filter-chip row + a card's token-coloured verdict/change badges, and the mobile right-rail stacking, 1440px and 390px, via a temporary dev-only route under `app/design/` (mock data, no AppShell/Supabase) deleted before the final commit.

### Design-system audit: closing note

All 3 PRs are small and independently shippable (Home cockpit #48, merged; Bids pipeline + pricing; Discovery). Finding 12 (homepage "Pipeline" bullet) is explicitly a sibling agent's file (`app/app/page.tsx`) and was never touched by this pass. Findings 8 and 11 were not in this session's numbered list (the audit's own numbering skips from 7 to 9) - nothing was found to fix under those numbers on these 3 screens; if they refer to a different screen, they're out of this pass's scope (Home/Bids/Discovery only).

## Prospect-facing audit, round 1 (2026-10-21)

Three independent findings from a prospect-facing audit, each scoped to its own file(s) and shipped as its own PR so a revert of one never touches the others.

### Home (`/`) and Privacy notice (`/privacy`): color-token migration

Both were still 100% hand-rolled `React.CSSProperties` on the **pre-color-update** palette (`#16233B` navy, `#D97706` amber) - the only two public pages nobody had circled back to since the 2026-10-21 color-scheme update (see "Color scheme update (prompt 3)" above) landed everywhere else. Migrated both to Tailwind + the current tokens, same discipline as every other migration in this log: content, copy and section order unchanged, only the styling mechanism swapped. This piece is color/styling only - the Founding Firms CTA wording and the stale "Pipeline" bullet (both genuine content findings on the same file) are deliberately a separate, follow-on PR below, so this one stays a pure, easily-revertible repaint.

- **Pattern followed**: `AuthShell.tsx` (navy `bg-foreground` panel, white text, the real `Logo` component, `text-accent` for an emphasised line on a dark panel) for the two navy bands on each page, and `dashboard/page.tsx`/Company vault's `bg-card`/`border-border`/`buttonVariants` conventions for everything else. Reused the real `Logo` component (`variant="light"`) in both headers instead of the old ad-hoc amber "T" square - one less hand-drawn mark to keep in sync. `Logo.tsx` itself still hardcodes its checkmark stroke to the pre-update amber (`#D97706`) regardless of variant - out of scope here (not one of this pass's files, and `AuthShell`'s own already-audited header uses the exact same mark unchanged), flagged here rather than touched.
- **Checkmark bullets** (the "inside a generated envelope" list, pricing-tier bullets) moved from the old decorative amber to `text-success` - these mark "this is true/done", which is what the design system's green already means everywhere else (`StatusBadge`'s `ready` variant, dashboard's "Packs ready" stat tone); `accent` is reserved for the single most important action on a screen, not a repeated list marker, so it was the wrong token for this job even though it's the new "brand" color.
- **Every interactive control bumped to a 44px touch target** (`min-h-11`, including the compact header "Start free" button) rather than this app's more common 40px (`min-h-10`) convention used elsewhere - these are the first two pages a prospect who may be on a phone reaches before ever signing in, so the stricter target was used throughout rather than only at hero-CTA size. Plain inline-text links (footer, "back to Tender Ready", the mailto address) were left as ordinary text links, matching how the rest of the app treats prose links (e.g. dashboard's "Fix" links) - the 44px rule was applied to standalone nav/button-shaped controls, not inline prose.
- **Responsive grids**: the 3-way comparison cards, the 4 free-tool cards and the 3 pricing tiers all moved from the old `auto-fit`/`minmax` inline-style grid to explicit `grid-cols-1 sm:grid-cols-2 lg:grid-cols-{3,4}` - stacks to one column with no horizontal scroll at 390px, checked directly (screenshots below).
- **`PRICING_TIERS` is untouched** - a separate, dedicated piece of work is building real billing/subscription enforcement for the plan limits this array advertises; changing the copy now (even to soften it) would pre-empt that decision and conflict with it, so only the array's own styling (how each tier card is painted) changed here, never its numbers or words.
- Screenshots cover both pages in full, before (old hex/amber) and after, at 1440px and 390px - the real routes (both render without a live Supabase backend in this environment: `/privacy` has no data dependency, `/` was checked against the placeholder `.env.local.example` values, which are enough for `auth.getUser()` to resolve to no user without throwing).

## Demo company with realistic sample data

A live Supabase project (the real one, not a mock) is reachable from this environment via `app/.env.local` (gitignored, same vars as `.env.local.example`) - unlike every earlier design-system prompt's screenshot note above, this piece was built and verified against real data, not a `/design` mock route.

- **One fixed demo/trial company, "Mzansi Roads & Civils (Pty) Ltd"**, seeded by a new `engine/seed_demo_company.py` (same service-role REST convention as `seed_supabase_company.py`, plus its own GoTrue Admin API calls for the auth user `company_members` needs - nobody signs this company up through onboarding, so there's no other way to get it a real login). Realistic South African content throughout: CIPC/VAT/CSD/CIDB numbers, a Pretoria head office, 3 ECSA-registered people (a Pr Eng director, a Pr Tech Eng resident engineer, a candidate engineer), 3 tenders (N3 KZN, N14 Gauteng geotechnical, N7 Western Cape) and 3 `tender_packs` matching the spec exactly: one **Awarded** (SANRAL N3 Section 12, R4.87m, real past `submitted_at`), one **Submitted** (a General-family N14 geotechnical tender, R1.25m, awaiting outcome - the outcome-form's 4 competitor fields are genuinely N/A/blank for both of these, per spec, since this company hasn't recorded losing to anyone), and one **Assessing & building** (SANRAL N7 Section 3) detailed enough to not be an empty shell: 3 key positions (2 confirmed people, 1 genuinely unconfirmed), `field_provenance` rows (a realistic Verify/Provide mix), a draft `financial_capture`, a done briefing task, and 3 `experience_items`.
- **Demo login**: `demo@mzansiroads.co.za` (password set by the seed script, not committed here - see the handback report for this prompt, or reset it from the Supabase dashboard).
- **Verified live, not just seeded**: logged into the demo account and walked the Home dashboard (85% bid-ready, populated "closing soon"/"documents expiring" tiles, the demo banner), the Bids board (all 3 stages populated, correct value/readiness/outcome-form rendering), and the N7 tender workspace (readiness score 54%, disqualification guard showing a genuine mix of Clear/Would disqualify/Not tracked, the Verify/Provide readiness-report cards rendering the seeded `field_provenance` rows correctly). The "Fill SANRAL schedules" button correctly refuses to generate, with real, specific reasons (DS1 still unconfirmed, blank SANRAL templates not uploaded, Form B7 unanswered) - a genuine stopping point per this app's own documented behaviour, not seeded further: faking a "ready" pack job with no real output files would be exactly the kind of fabricated state this codebase's own history (CV-tailoring buttons, cover-page fields, pack reordering - see "CV tailoring and cover page" above) has consistently refused to build.
- **Demo banner, static allowlist, no migration**: `lib/demoCompany.ts` exports a single hardcoded `DEMO_COMPANY_ID`, checked by `AppShell` and rendered as a small, dismissible-looking `DemoBanner` (`components/tt/demo-banner.tsx`, soft `info`-tint, plain local `useState` dismiss - session-only, no persistence, since this is presentation only) whenever the signed-in company matches it. Deliberately NOT a new `companies` column: 0007 already added `is_test_company` for exactly this kind of "which company is a fixture" question, but its own comment is explicit that it must **never** surface in customer-facing UI (it's Sarel's own internal test harness flag) - reusing it for a customer-facing banner would contradict its documented purpose. **Flagged, not decided here**: a real `companies.is_demo_company` column would be the cleaner long-term answer once that's confirmed with Sarel; the static allowlist needs no migration and can't affect any other company in the meantime.
- **Where "a brand-new signup sees this" actually means**: nothing in this schema links one company's data to another, and there's no existing "preview another company's data" mechanism to reuse - a real signup's own company is, and stays, empty until they add real tenders. This piece reads that requirement as a sales/trial demo LOGIN (a fixed account anyone evaluating the product can sign into and see populated from the first click), not a change to what a genuinely new company's own `/dashboard` shows - inventing the latter would be new product behaviour (auto-cloning sample data into every new signup), not a styling or seed-data pass.

## Company vault: ui.tsx root-cause color fix (sub-PR 2 of 5)

Picks up the first slice of the shell sub-PR's explicitly deferred scope (app/AGENTS.md, "Company vault: shell"): the 4 separate routes (`/company/bank-accounts`, `/principals`, `/properties`, `/registrations`) plus `Notifications.tsx`/`OfficeLocations.tsx`, both mounted on `/company` itself but missed by the shell pass since they live outside that page's own file.

- **Root cause, as scoped**: `app/company/_components/ui.tsx` (the shared kit for the 4 sub-routes) hardcoded `NAVY #16233B`/`AMBER #D97706`/`CREAM #FFFFFF`/`BORDER #E3E6EA`/`MUTED #5B6472`/`FAINT #8A93A0` - the stale pre-color-update values the shell sub-PR's own token migration never reached, since this file sits outside `/company`'s own `page.tsx`. Migrated `ui.tsx` itself in place, in two ways depending on how each export is actually consumed: `SubPage`/`Card`/`Chip`/`Text`/`Select`/`YesNo`/`Area`/`Submit`/`DangerButton`/`FileUpload`/`Disclosure` became real Tailwind/shadcn implementations (`Input`/`Textarea`/`Label`/`Button`, `PageHeader`, and `shared.tsx`'s own `ChipBadge`/`Banner`), matching the shell sub-PR's own component-by-component conversion; `NAVY`/`AMBER`/`CREAM`/`BORDER`/`MUTED`/`FAINT` stayed as exported constants (every one of the 4 consumer pages still reads several of these directly in one-off inline styles outside `ui.tsx`'s own components) but now point at the real CSS custom properties (`var(--foreground)`, `var(--accent)`, `var(--card)`, `var(--border)`, `var(--muted-foreground)` twice over - see below) instead of literal hex - the "token-based values" option named for exactly this shape of consumer.
- **`MUTED`/`FAINT` collapse onto one token**: the design system has no second, fainter muted-text tone anywhere else either (`shared.tsx`'s own `Field` "Not on file" caption reaches for `text-muted-foreground/70`, an opacity modifier a plain exported string can't express) - both now read `var(--muted-foreground)` rather than inventing a second grey token nobody else uses. Visual hierarchy between them was already carried by font-size/weight at each call site, not by this now-tiny color difference.
- **`Chip` now wraps `shared.tsx`'s own `ChipBadge`** (`toneForChip` exported from `shared.tsx` for this reuse) rather than re-deriving the hex-to-tone mapping a second time - every `<Chip status={...}>` call across the 4 pages (`lib/dates.ts`'s `expiryStatus()` results, and several ad hoc `{label,bg,color}` literals already matching the same 4-color convention) now renders as the same soft-tint token badge the rest of the vault uses, with zero change to any status logic.
- **The 4 consumer pages themselves needed real edits, not just a `ui.tsx` swap**: `grid` changed from a `CSSProperties` object to a Tailwind class string (matching how every other migrated form grid in this codebase works), so every `style={grid}` call site became `className={grid}`; each page's own inline `style={{ color: NAVY }}`-style spans were converted to the matching Tailwind text/border/bg utility. Also added the error-banner fix from the audit's part B.1 to all 4 (see below) while in the same files.
- **Error banner on a failed Supabase read (B.1)**: bank-accounts, principals, properties and registrations all previously swallowed a failed `select` into an empty array, indistinguishable from "genuinely nothing here yet" - each now reads the query's own `{error}`, logs it (matching this codebase's existing `console.error` convention), and renders a destructive-tone banner ("Couldn't load ... - try refreshing. If it keeps happening, let us know.") instead of a silent empty state, same wording style as `/company`'s own `Banner tone="destructive"` loader-failure line. A genuine empty list (no error, zero rows) still gets its own distinct, non-alarming empty-state line.
- **`Notifications.tsx`/`OfficeLocations.tsx`** (mounted on `/company`, visible beside the shell sub-PR's already-migrated sections, but themselves outside that page's own file so the shell pass's "convert `/company`'s own `page.tsx`" scope line didn't reach them): both converted to the same `VaultSection` shell every other `/company` section already uses, with `OfficeLocations`' per-office form fields converted to shadcn `Input`/`Label`/the same native-`<select>`-matching-`Input`-look pattern `EditForm.tsx` already established, and its own already-correct error/empty states kept, just token-painted.
- **`ConfirmSubmitButton`** (`app/_components/ConfirmSubmitButton.tsx`, shared by `ui.tsx`'s `DangerButton` and 2 other call sites in People/Experience, both still pre-migration) gained an optional `className` prop alongside its existing `style` prop - a small, backward-compatible extension (same reasoning as `StatCard`'s `tone` prop, prompt 2) so `DangerButton` could move to Tailwind without breaking the other two still-inline-styled callers.
- Screenshots cover `ui.tsx`'s own component kit in isolation (status chips, form fields, danger button/file upload/disclosure), 1440px and 390px, via a temporary dev-only route under `app/design/` (mock data, no live Supabase backend in this environment) deleted immediately after - the 4 real pages read live company data this environment doesn't have, so the isolated kit is the honest screenshot target, same reasoning prompt 8's isolated-component screenshots used throughout.

## Tender workspace: 4 real color-disagreement bugs (audit fix pass, part 1 of several)

A product-promise audit of `/tenders/[id]` flagged a handful of genuine defects on this already-built screen - distinct from the many deliberate, already-flagged gaps this file documents elsewhere on the same page (CV diff/"Use tailored" buttons, drag-to-reorder, cover-page editable fields, the 2-of-7 "not tracked yet" Disqualification Guard checks, SanralProgress's cosmetic cycling - none of those touched here). This piece fixes the 4 real bugs only; the lower-priority Key people/Locality vocabulary migration and the whole-screen Tailwind/token migration are separate, still-pending pieces (see the two new sections below).

- **`page.tsx`'s readiness-report summary chip disagreed with the Verify `ReportCard` 20px beneath it, for the exact same `reviewRows` data** - the chip read amber ("to verify", `#FEF3C7`/`#B45309`), the card read green (`#DCFCE7`/`#15803D`, the correct color per the already-shipped "Verify/Provide readiness-report cards" merge, see above). The card was right; the chip was missed when that merge recolored "Please review" into "Verify". Fixed by recoloring the chip to match - no wording or data change.
- **`pack-checklist.tsx`'s `STYLE` map had `included_warning` (red) and `not_included` (amber) backwards** from the Fix(red) > Provide(amber) severity this screen uses everywhere else - a document missing from the pack entirely is the real gap (closer to Fix), not one that's in the pack but flagged with a warning (closer to Provide, a look-before-you-submit note). Swapped the two. This component is shared by `submission-pack.tsx`/`general-workspace.tsx`/`pack-review.tsx`/`general-pack-review.tsx` - one fix, four screens corrected.
- **`submission-pack.tsx`'s own "gaps" banner was both on the old pre-unification vocabulary** ("mandatory - disqualifying"/"don't have"/"confirm by hand", never updated when the Compliance Check card above it got Verify/Provide/Fix) **and had the identical mandatory-blind bug this session already fixed once for `pack-review-data.ts`/`general-pack-review-data.ts`** (see "pack-review's own mandatory-blind bug" above): it derived its gap list from `compliance-data.ts`'s `packReadiness()`, which splits `toConfirm` (status `"check"`) by itself, blind to `mandatory` - so a mandatory-but-merely-unconfirmed doc (e.g. A1 CSD) showed as amber "confirm by hand" here while `classifyComplianceItem()` one card up correctly called the same item Fix. Fixed the same way as the reference pass: the banner now classifies every `docItems` row through `classifyComplianceItem()` directly (not through `packReadiness()`'s own mandatory-blind split, which is left exactly as-is - `actions.ts`'s `readiness_snapshot` write and `pack-review-data.ts`'s own `gapsCount` still read it unchanged), keeps only Fix/Provide rows (a Verify-bucketed, still-unconfirmed optional item isn't a "gap" - same exclusion rule `pack-review-data.ts`'s own `gapsCount` already uses), and relabels each row's note "Fix"/"Provide" instead of the old 3 phrases. `compliance-data.ts` gained one small shared export, `complianceItemLabel()` (the `"FORM label (+ expired-copy note)"` formatter `packReadiness()` already had inline), reused by both so the two can't drift on wording for the same item. Form B7's own soft warnings (never mandatory-classified - no `ComplianceItem` backs them) stay a separate, always-Provide addition to the same list, relabeled "Provide" instead of "your subcontracting plan".
- **`compliance-report.tsx`'s Locality section painted a `no_match` specific-goals/functionality row the same disqualification-red as a genuinely mandatory miss** - `matchLocality()` only ever returns points (0 on `no_match`), never disqualifies anything; the one real disqualifying locality case (a missing *mandatory* local office) is its own separate, correctly-red row just below it, unaffected by this change. A `no_match` scored-points row now reads the same softer amber as `STATUS_STYLE.check` (the file's own existing "need a look" tone - no new severity concept invented), leaving `matched` (green) and the mandatory-office row (red) exactly as they were.
- Screenshots cover all 4 fixes in isolation (before/after, mock data for the 3 that aren't a standalone pure component - summary chip, gaps banner, locality row; `PackChecklist` itself rendered live since it's already a pure, exported component), 1440px and 390px, via a temporary dev-only route under `app/design/` deleted immediately after.
- **Working-tree note**: this repo's single checkout was being driven by several concurrent sessions on different branches at once during this pass (confirmed via `git worktree list` and an unrelated branch's uncommitted changes appearing mid-session) - this piece's own changes were isolated into their own `git worktree` (not the shared checkout) before committing, rather than risk committing another session's in-flight, unrelated files.

## Tender workspace: loading skeleton + section-level error recovery (audit fix pass, part 2 of several)

- **New `app/app/tenders/[id]/loading.tsx`**, composed entirely from existing `components/tt/skeletons.tsx` primitives (`SectionCardSkeleton`, `StatCardSkeleton`, `TableRowsSkeleton`) - shaped like this page's own real layout (facts header, 3 Fix/Provide/Verify-ish groups, a Pack Review-shaped table) so the loading state doesn't jump/reflow once real content arrives. This is Next's automatic route-segment loading state (no `Suspense` wiring needed) - it only ever shows on the very first navigation to a tender, same as every other `loading.tsx` convention.
- **Section-level error recovery, done as a direct awaited call + try/catch, not a Suspense + Client-Component error boundary**: the page's 4 heaviest, most failure-prone async Server "components" (`ComplianceReport`/`GeneralTenderWorkspace`, `SubmissionPack`, `PackReview`, `DisqualificationGuard`) are now called directly as plain async functions (`await ComplianceReport({ tenderId: id })` instead of `<ComplianceReport tenderId={id} />` - a Server Component is just an async function; the JSX form is sugar for the same call) and wrapped in a real `try/catch` right in `page.tsx`, so one section's bad read degrades to the existing `ErrorBanner` (with a working Retry, see below) for that section only, instead of throwing and 500ing the whole page. **A `<Suspense>` + Client Component error-boundary (`getDerivedStateFromError`) version was tried first** (the textbook App Router pattern for this) and built, but empirically verified NOT to work on this repo's own Next build (`app/AGENTS.md`'s own header: "This is NOT the Next.js you know") - a forced test error thrown from inside the Suspense boundary still reached the top-level page/build error path instead of the boundary's fallback, in both `next dev` and a production `next build`/`next start` round-trip. Rather than ship an unverified pattern, it was replaced with the direct-call-and-catch approach above, which is plain synchronous JavaScript (no framework-specific streaming behavior to trust) and was verified working by the same forced-error test. Flagging this finding here in case a future pass on a newer/unforked Next wants to revisit the Suspense-boundary version.
- **Retry is real, not decorative**: `RetryButton` (new, `app/app/tenders/[id]/retry-button.tsx`, Client Component) calls `router.refresh()` - a real re-fetch of this same Server Component tree, not a full page reload - added to the existing `ErrorBanner` (which previously only said "try refreshing" in prose with no actual control - a prose-only hint doesn't help someone who doesn't know what "refreshing" means on a web app) and reused for each of the 4 new section-level catches above.
- Not built: per-query try/catch for every one of this page's many parallel Supabase reads individually - most already degrade to `[]`/`null` safely without throwing (supabase-js returns `{error}`, it doesn't throw), so the real risk was always the handful of larger child Server Components doing their own multi-query reads and rethrowing/crashing on a bad one; the 4 direct-call wrappers above cover exactly those without a per-query rewrite of files outside this pass's bug-fix scope.

### Homepage: Founding Firms CTA wording + stale "Pipeline" bullet (follow-on, same day)

Two genuine content findings on `page.tsx`, kept out of the color migration above so each can be reverted independently.

- **Founding Firms CTA**: the button read "Apply as a founding firm", implying a differentiated intake - nothing in the schema or codebase supports that (no founding-firm field, no separate application flow; it linked to the exact same `/signup` the ordinary "Start free" buttons do). Checked for a real contact mechanism to point it at instead first, per the audit's own instruction: the only email address anywhere in the app is `privacy@tendertool.co.za` on the Privacy notice, and that's explicitly POPIA/privacy-scoped, not a general sales inbox - routing a "founding rate" enquiry there would trade one dishonesty for another. Softened the wording instead, to "Get in touch", still linking to the same `/signup` a click already reached - true to what actually happens, no flow invented. Not built: a founding-firm field or a separate intake form - that's new business logic/schema, outside a presentation-only pass.
- **Stale label**: Tender Pro's pricing bullet said "**Pipeline**, tasks and role-based digest" - a leftover from before `/pipeline` was relabelled "Bids" app-wide (see "App shell (prompt 4)" above). Fixed to "**Bids**, tasks and role-based digest" - a stale-name fix on this one bullet's wording, not a pricing-claim change, so it's unrelated to (and doesn't pre-empt) the billing-enforcement work also touching this array's numbers.
- Screenshots cover the Founding Firms card and the Tender Pro bullet, before/after, at 1440px.

## Onboarding Step4: pending state + error placement (prospect-facing audit, round 1)

Third finding from the same round of audit as the Home/Privacy color migration (#51) and the Founding Firms CTA wording fix (#55) - this one on `app/onboarding/_components/Step4.tsx`, unrelated to those two files, so its own PR. Audit finding: the add-person and upload-CV server actions had no visible loading state, and a failed action's error message always rendered as one generic banner at the very top of the step - even when the actual problem was "no CV file chosen" (which has nothing to do with the add-person form directly beneath it) or "enter a name" (which landed above the people list rather than next to the empty field it was actually about).

- **No existing `useFormStatus` (or equivalent) convention anywhere in the onboarding wizard** - checked Step1/2/3/5 and `WizardShell` first, per the prompt's own instruction to reuse a convention if one exists; none of the other four steps have a pending indicator either (their own audit passed without one being asked for), so this introduces the pattern fresh, scoped to this one file only.
- **`Step4.tsx` became a client component** (`"use client"`) so its two submit buttons can read `useFormStatus()` - the only way to get a real per-form pending state from a Server Action without a second round-trip. Binding a `"use server"` action's extra argument (`companyId`) from inside a client component is the documented Next.js pattern (`action.bind(null, arg)` works identically on either side of the boundary); nothing about `addPersonStep`/`uploadPersonCvStep` themselves changed. Each submit button (`AddPersonSubmitButton`, `UploadCvSubmitButton`) shows a spinner (`lucide-react`'s `Loader2`, `animate-spin` - the same icon/class `login`/`signup` already use for their own pending state) and relabels to "Saving…" while its own `<form>` is in flight; verified live (not just visually mocked) by clicking the real button against this sandbox's dummy Supabase credentials and screenshotting mid-flight.
- **Error placement**: both actions still redirect to the same `/onboarding?step=4&error=...` with one plain string - there's no per-field key to route by, and adding one would mean touching `actions.ts` and `page.tsx`, both outside this file's own scope. Routed on the message's own fixed wording instead (`isCvUploadError()`, matching `/\bcv\b|upload/i` - every string these two actions can send for this step is enumerated in `actions.ts` and checked against this pattern): a CV-upload error now renders directly above the people/CV list, an add-person error renders directly above the Full name field - never both, never neither, and never the old single top-of-step banner.
- Screenshots cover both error cases and the live pending state, old vs. new, 1440px (plus a 390px check that nothing regressed - this step's own layout wasn't otherwise touched), via a temporary dev-only route under `app/design/` (mock people data, `AuthShell`-wrapped to match the real page) deleted immediately after.

## SANRAL schedules/Tools/Admin audit: loading skeletons + mobile card layout (2026-10-21)

Final piece of the 4-part SANRAL schedules/Tools/Admin audit (bugfix #47, Tools color migration #49, Admin color migration #59, this one) - `loading.tsx` for every route named in scope, plus the one remaining real mobile-squeeze case the color-migration passes left behind.

- **7 new `loading.tsx` files**: `app/sanral-schedules/loading.tsx` and one each for `/admin` (alerts + harness results) and its 5 sub-routes (`customers`, `settings`, `taxonomy`, `discovered-opportunities`, `requirement-extractions`) - all built from `components/tt/skeletons.tsx`'s existing primitives (`StatCardSkeleton`/`SectionCardSkeleton`/`TableRowsSkeleton`, plus bare `Skeleton` for headers/filter rows), shaped like each real page's own section layout, same convention `dashboard/pipeline/discovery`'s own `loading.tsx` already established. The 4 tools pages do no network calls (pure client-side math) so they're deliberately skipped, per this piece's own scope.
- **Admin error states**: already confirmed correct by the Admin color-migration pass (#59) - every admin page's inline Supabase-error banner already reads `border-destructive/20 bg-destructive/10 text-destructive`, the same token styling this piece would otherwise have had to add. Nothing to extend here; re-verified by reading each page's current banner rather than assumed.
- **Keyboard focus - audited, not changed**: every interactive control across the whole scope (admin's hand-rolled toggle buttons, Tools' calculator inputs) is a plain native `<button>`/`<input>`/`<select>` with no `outline-none` anywhere in this scope's own files (checked by grep) - `app/globals.css`'s own `@layer base { * { @apply border-border outline-ring/50; } }` colors the browser's native focus outline but never removes it, so every one of these already gets a real, visible, ring-colored focus indicator. Confirmed empirically, not just by reading the CSS: a headless-browser keyboard-Tab test onto a hand-rolled button (B6 estimator's "+ Add another project") showed `outline-style: auto` with the ring color applied, and the resulting screenshot shows a clearly visible blue ring - no fix was needed.
- **Touch targets**: already 44px (`min-h-11`) throughout, from the 3 preceding PRs in this same audit - re-confirmed by grep, not re-done.
- **The one real mobile "squeezed" case left to fix**: `CustomerRow` (`/admin/customers`) packed name, a "test company" badge, 3 counts and a joined-date all onto one `flex-wrap` line - technically non-overflowing (confirmed in #59's own screenshots) but genuinely cramped on a phone, the exact "not a squeezed table" case this prompt named. Restructured to a real 2-line card below `sm` (name + badge + the open/hide indicator on one line, the 3 counts + date as their own wrapped meta line underneath) while keeping the original single-row layout at `sm:` and up, where it already had room. The same small fix applied to the expanded member-list row (`min-w-0 truncate` on the email so a long address doesn't force the row wider than its card). Taxonomy's own category/group list was re-checked, not re-touched: it was never a table to begin with (a vertical list of `<details>` disclosures, each a `flex-wrap` summary line of independent tag-like spans) and #59's own fix already replaced its one real mobile bug (the fixed-width form-grid media query) - at 390px its summary rows already wrap tag-by-tag rather than overflowing or squeezing, confirmed structurally.
- **Notifications bell popover at 390px** - re-checked, already confirmed fine in #47 (its own screenshot shows the `w-80`/320px popover sitting fully on-screen with `align="end"`); nothing to fix here either.
- Screenshots cover `CustomerRow`'s new mobile card layout (mock data) and both new loading skeletons (`/admin`, `/sanral-schedules`), 1440px and 390px, via a temporary dev-only route under `app/design/` deleted before the final commit.

### Mobile/a11y audit of the 4 named risk areas (audit fix pass, part 3) - no structural bug found

Before starting the whole-screen Tailwind/token migration (the single biggest remaining lift on this page - see below), checked the 4 areas the audit specifically named as mobile-risk (Key positions grid, Pack Review/Compliance Check tables, the submission-pack job list, Disqualification Guard rows) for the named failure mode - "degrade to single-column/stacked cards, not horizontally-scrolling tables cut off at the edge":

- **None of the 4 use a fixed-width grid or a literal `<table>`** - confirmed by reading each file directly, not assumed: Key positions (`page.tsx`) is a stacked list of flex rows (`flexWrap: "wrap"`, `minWidth: 0`); Pack Review/Compliance Check (`pack-review.tsx`, `compliance-report.tsx`'s task groups) are the same `repeat(auto-fit, minmax(…px, 1fr))` pattern used everywhere else on this page, which already collapses to one column once the viewport can't fit `minmax`'s lower bound; the submission-pack job list and Disqualification Guard rows are both plain stacked `flex-direction: column` rows. All 4 already degrade to single-column/stacked cards at 390px with no horizontal cut-off - verified directly (no screenshot artifact kept, since nothing changed).
- **The only literal `<table>`s anywhere in this route** (`market-context.tsx`'s published-bidders register and segment-benchmark comparison) were NOT named in the audit's list and are deliberately NOT "fixed" here - both are genuinely tabular, comparative numeric data (a bidders register, a side-by-side benchmark across market segments) that doesn't have a sensible single-column stacked-card form, and both already scroll horizontally with momentum scrolling (`WebkitOverflowScrolling: "touch"`) inside a collapsed `<details>` the user opens deliberately - the same accepted pattern this page's own sticky jump-nav row already uses for unavoidably-wide content. Left alone rather than restructured into cards that would make genuinely comparative data harder to read, not easier.
- **Keyboard focus rings**: confirmed by grep across every file in this route for anything that would suppress one (`outline: none`, `tabIndex={-1}`, etc.) - zero hits. Nothing here strips the browser's default focus ring; every button/link/select/input stays keyboard-reachable with a visible ring, no change needed.
- **Touch targets below 44px DO exist** (several buttons/selects across this route sit at this app's older 32-40px convention, e.g. `position-person-select.tsx`'s "Confirm"/"Use" buttons and person `<select>`) - not fixed here. Bumping every one of these to 44px touches the same files, in the same shallow, mechanical way, as the still-pending whole-screen color migration below - rather than a scattered, easy-to-miss mechanical pass done twice, it's left as part of that migration's own per-file scope, flagged explicitly rather than silently skipped.

### Tender workspace Tailwind/tokens migration, PR 1 of ~5: Disqualification guard

The single biggest remaining lift in this screen's audit (item 6: 100% inline-CSSProperties, stale pre-color-update hex, 13+ files) - split into small, separately-shipped sub-PRs by sub-section, same discipline as every other multi-part design-system prompt in this log. This piece is `disqualification-guard.tsx` alone, the smallest, most self-contained file in scope - a deliberate first cut to prove the pattern (a new shared Verify/Provide/Fix pill component) before touching the much larger files.

- **New `components/tt/bid-task-badge.tsx`**: the Verify/Provide/Fix pill this and every later tender-workspace color-migration piece needs, kept as a shared component (not redeclared per file) the same way `ChipBadge`/`toneForChip` serves `StatusChip` for Company vault. Its `BidTaskBadgeStatus` type is a plain `"fix"|"provide"|"verify"|"not_tracked"` string union, NOT imported from `app/tenders/[id]/bid-task-status.ts` - a shared `components/tt/` primitive taking a dependency on one route's own logic file would be a layering violation the rest of this codebase doesn't have anywhere else. The 4th state, `not_tracked` (neutral grey), exists only for this guard's own "not tracked yet" rows - nothing else in this app currently needs a 4th tone, but it was cheap to add alongside the real 3.
- **This screen's own existing pill wording is preserved via `children`, not the shared component's own default label** - `BidTaskBadge`'s default labels are the short "Fix"/"Provide"/"Verify" (matching `compliance-report.tsx`'s `TASK_STYLE` titles), but this guard's pills have always read "Would disqualify"/"You need to supply this"/"Clear" (a more conversational phrasing fitting this specific card's own framing) - passed as `children` to override, the exact same pattern `StatusBadge`'s own dashboard migration used to keep a screen-specific word choice (see "Dashboard migration" above).
- **Structure**: the hand-rolled `card` style object is now `SectionCard` (title/description), and the id-anchor + sticky-jump-nav-offset wrapper is the same `<div id="…" className="scroll-mt-20">` pattern `VaultSection` already established for Company vault - this guard gains the same "doesn't scroll under the sticky jump-nav bar" behavior those sections already have, as a side effect of reusing the real component rather than a one-off div.
- **One deliberate, acknowledged sizing difference from a pixel-for-pixel transliteration**: `SectionCard`'s own `CardTitle`/`CardDescription` use this design system's own type scale (not the previous inline 15px/12px) - reusing the shared component's own established sizing, the same choice the Company vault shell sub-PR already made throughout (see above: "every field, label and value is unchanged" refers to content, not literal pixel values, once a shared component's own scale applies). Every word, every status, every detail sentence is otherwise unchanged.
- **The "not tracked" rows' dimmer grey** (`#8A93A0`, visibly lighter than the regular rows' `#4B5563` detail text) is `text-muted-foreground/70`, not a flat `text-muted-foreground` - preserves the 3-tier grey hierarchy this screen already had (dark detail text / medium description text / a dimmer "this isn't even a real check" tone for the 2 not-tracked rows) rather than flattening it to one shade because only one muted token exists.
- Screenshots cover the card in isolation (old vs. new, same mock rows covering every `BidTaskStatus` plus the 2 not-tracked rows), 1440px and 390px, via a temporary dev-only route under `app/design/` deleted immediately after.
- **Remaining scope, explicitly not done here**: the header/tender-facts card and the rest of `page.tsx`, `submission-pack.tsx`, `pack-review.tsx`/`general-pack-review.tsx` (+ `pack-checklist.tsx`), `compliance-report.tsx`, `cv-compare.tsx`/`cover-page-preview.tsx`/`intake-card.tsx`, `activity-log.tsx`/`position-person-select.tsx`/`tender-templates.tsx`/`submission-plan-view.tsx` - all still 100% inline-CSSProperties, unmigrated. Each is its own follow-up sub-PR.

## Company vault: document-scan + CV review migrate to Verify/Provide/Fix (sub-PR 3 of 5)

Continues the shell sub-PR's deferred scope - this piece covers the two screens flagged as the clearest Verify/Provide/Fix mismatches in the whole app (per the audit): `app/company/document-scan/review.tsx` (bulk document-scan intake) and `app/people/[id]/cv-review.tsx` (CV intake), plus color-token migration of `document-scan/page.tsx`/`upload-form.tsx` and `people/[id]/page.tsx` (neither reads from `ui.tsx`, each re-declared its own hex locally).

- **The actual V/P/F mapping, worked out field by field**: both screens are AI-extraction intake, not SANRAL compliance docs - nothing in `lib/onboardingScan.ts` or `lib/cvExtraction.ts` marks any field "required"/"mandatory", so **Fix never applies here** (Fix means a genuine disqualification risk on a required field; these screens have no such concept - a gap is always "needs a human to confirm or supply it", i.e. Provide). The real, useful distinction both screens already tracked was confidence (`verified`/OCR-sourced), which now reads as the product's real vocabulary: a field the model traced with confidence needs no pill at all once ticked by default (the old code showed nothing here either); an unticked/low-confidence/OCR-sourced field gets an amber "Provide - check" pill (was "check this"/"check"); a field that already matches what's on file keeps its green "same as on file" pill (was already correct, just re-painted with tokens). The whole-document "Waiting for your check" chip became "Provide - check before confirming"/"Provide - check before saving".
- **One state deliberately NOT forced into V/P/F**: document-scan's "Needs manual review" (an `UNROUTED_KINDS` document the model couldn't confidently classify at all) stays a neutral/muted pill, not Provide - it's a different kind of gap (routing failure, not a confidence-on-a-known-field gap), so painting it amber would overstate it as the same kind of task as a low-confidence field. Documented inline in `review.tsx`'s own header comment.
- **Every confirm/edit/discard action is byte-for-byte unchanged** - `applyCvExtraction`, `discardCvExtraction`, `confirmVaultDocument`, `confirmCvHandoff`, `confirmIdDocument`, `confirmExperienceReferenceLetter`, `skipOnboardingDocument`, `discardOnboardingDocument` - this pass only changed how a field/document's status is classified and painted, never what a tick or a button does.
- **Mobile row collapse**: both screens' checkbox/label/value field rows (`.cvx-row`, `.obx-row`) used to rely on a raw `<style>` media-query block hand-rolled per page; replaced with a `grid-cols-[28px_1fr] sm:grid-cols-[28px_150px_1fr(_1fr)]` + `sm:contents` wrapper pattern, so the fixed multi-column layout only applies at `sm:` and up and the content stacks naturally on a phone with no manual breakpoint duplication. The raw `<style>` blocks in both pages were deleted.
- **`people/[id]/page.tsx` not-found state fixed (audit part E)**: the old code read only `{ data }` from the person query, so a genuine Supabase error silently became "Person not found" - a real failure and a missing record are different situations. Now captures `{ data, error }`, and the not-found screen (moved inside `AppShell` + the shared `EmptyState` component, replacing a bare unstyled `<div>` outside the shell entirely) shows "Couldn't load this person" for a real error vs. "Person not found" for a genuinely missing/inaccessible record, each with its own icon and copy.
- **`ConfirmSubmitButton` gained `className`** (same small, backward-compatible addition as sub-PR 2 - both touched this file independently; identical change, so no real conflict once rebased) so its 3 call sites across People/Experience could move to Tailwind without a `style` prop.
- **Color migration elsewhere in these 4 files**: every literal hex replaced with the matching design-system token/Tailwind class (`bg-card`/`border-border`/`text-foreground`/`text-muted-foreground`/`text-accent`/soft-tint `success`/`warning`/`destructive` pairs) - no new hex introduced, content and field layout otherwise unchanged from the original. `CV_UPLOAD_STATUS_LABEL`/`GENERATED_CV_STATUS_LABEL`/`ExpiryBadge`'s status records moved from literal `{label,bg,color}` hex pairs to `{label,tone}`, rendered through a small local `Pill`/tone-class helper (the same 4-tone convention as `app/company/_components/shared.tsx`'s `ChipBadge`, duplicated locally rather than imported - People is its own feature folder, and `general-pack-review-logic.ts`'s own header comment already set the precedent for duplicating a small status-style map across feature boundaries rather than importing across them).
- Screenshots cover `cv-review.tsx`'s and `review.tsx`'s own cards in isolation (every pill state: ticked/high-confidence, unticked/Provide, same-as-on-file, duplicate-project, unrouted/needs-manual-review), 1440px and 390px, via a temporary dev-only route under `app/design/` (mock extraction data, no live Supabase backend in this environment) deleted immediately after.

## Company vault: People list migrates to design tokens (sub-PR 4 of 5)

`app/people/page.tsx` never read from `ui.tsx` and carried its own full set of stale pre-color-update hex, same seam as every other un-migrated screen in this cluster. Converted to `PageHeader`/`EmptyState`/the design system's soft-tint tone classes.

- **Registration-health chips (ECSA/SACPCMP) kept as the existing 4-state expiry vocabulary**, not forced into Verify/Provide/Fix - same reasoning as `registrations/page.tsx` (app/AGENTS.md, sub-PR 2): these are a renewal-date state, not a bid task, and the audit itself named this screen's chips as a case to leave alone. Only the paint changed (`toneFromChip()` maps `lib/dates.ts`'s literal hex pairs onto tone classes, same small helper duplicated per screen as `people/[id]/page.tsx`'s own `toneFromChip` from sub-PR 3 - still not imported across feature folders, same reasoning given there).
- **Empty vs. error, already distinguished in the data, now distinguished in the UI too**: the old code already correctly checked `error` separately from an empty `rows` array (so a real Supabase failure never silently looked like "no one on file yet") - but both states rendered as a plain inline `<div>`. The genuine-empty case now uses the shared `EmptyState` component (with a "+ Add person" action, same component the audit asked this cluster to adopt); the error case stays its own distinct destructive banner, now token-painted.
- **Mobile**: the person-card grid's old hand-rolled `<style>` media query (`.people-grid`/`.people-header-row`) is gone - `grid-cols-1 sm:grid-cols-2` and `PageHeader`'s own built-in wrap-to-stacked layout do the same job with zero custom CSS.
- **`app/people/loading.tsx` and `app/people/[id]/loading.tsx` added** (task D) - shaped like each real page via the existing skeleton primitives (`SectionCardSkeleton`), this app's first loading states for this screen cluster. `people/[id]/page.tsx` itself isn't touched in this PR (already migrated in sub-PR 3) - its loading skeleton approximates the real page's shape (title, jump-nav pills, 3 section cards) without needing to read that file's internals.
- Screenshots cover the People list (old inline-CSSProperties vs. new tokens, empty state, registration-health chip row), 1440px and 390px, via a temporary dev-only route under `app/design/` (mock data, no live Supabase backend in this environment) deleted immediately after.

## Company vault: Experience migrates to design tokens + Verify/Provide/Fix (sub-PR 5 of 5)

Final piece of the Company vault/People/Experience design-system migration started by the shell sub-PR. Covers `app/experience/page.tsx` and `app/experience/[id]/page.tsx`, neither of which read from `ui.tsx` (own hex declared locally, like People's list).

- **Genuine Provide-type gaps relabelled with the real vocabulary**: "Needs tagging" and "No document" both became "Provide - ..." chips - nothing here counts toward a bid until a captured document is tagged (or a tagged item has a document attached), exactly the kind of gap the audit named as a clean V/P/F fit. The detail page's "captured, not yet tagged" banner copy was adjusted the same way ("Provide the tags next...").
- **What was deliberately NOT forced into V/P/F**: "Tagged"/"Rated good/poor/excellent" describe a completed state with nothing outstanding - relabelling them "Verify" would misuse the word (Verify implies an unconfirmed AI guess waiting on a human; a saved tag is already final, no further confirmation step exists for it). The discipline-suggestion pending/approved/rejected pill (an external review-workflow status for promoting a company's own tag to the shared catalog) is its own 3-state vocabulary, kept as named states (not relabelled Verify/Provide/Fix) - it isn't a bid-readiness task at all, nothing about it helps or blocks a tender; only its colours were token-painted (warning/success/muted).
- **`experience/[id]/page.tsx` not-found state fixed (audit part E)**: the old code read only `{ data }`, silently turning a real Supabase error into "Experience item not found, or you don't have access to it." - now captures `{ data, error }` and distinguishes them, moved inside `AppShell` with the shared `EmptyState` component (was a bare unstyled `<div>` outside the shell).
- **`app/experience/loading.tsx` and `app/experience/[id]/loading.tsx` added** (task D) - this screen cluster's first loading states, shaped like each real page via the existing skeleton primitives.
- **Mobile**: both pages' `exp-grid-2` hand-rolled `<style>` media query is gone - `grid-cols-1 sm:grid-cols-2` does the same job.
- **Color migration elsewhere**: every literal hex replaced with the matching token/Tailwind class, content and field layout otherwise unchanged. This is the last of the audit's named Company/People/Experience color-migration targets - every file app/AGENTS.md's "Company vault: shell" entry listed as deferred scope is now migrated.
- **Touch targets (task C)**: the discipline filter pills (`FilterLink`) and every disclosure `<summary>` trigger (group toggles, "Suggest again") bumped from 32px to the 44px convention - these are real clickable controls, not decorative badges. The service-stage/discipline checkbox rows stay at their denser size deliberately (a multi-item checklist, same judgment call as `people/[id]/page.tsx`'s own role-tag checklist) - the clickable area is the whole label row, not a single small checkbox, so a dense list reads fine without each row needing a full 44px.
- Screenshots cover the Experience list (readiness card, capture form, tagged/untagged/no-document rows) and the detail page's tagging form + custom-tag suggestion states, 1440px and 390px, via a temporary dev-only route under `app/design/` (mock data, no live Supabase backend in this environment) deleted immediately after.

## Company vault/People/Experience: loading skeletons + remaining a11y sweep (final piece)

Closes out the audit's parts C and D for this whole screen cluster (Company vault's 4 sub-routes, document-scan, People, Experience) - the pieces that didn't fit naturally inside any single screen's own color/V-P-F sub-PR.

- **`loading.tsx` added for every route in scope still missing one**: `company/bank-accounts`, `company/principals`, `company/properties`, `company/registrations`, `company/document-scan` (People and Experience already got theirs in sub-PRs 4 and 5). Each is shaped like its own real page via the existing `SectionCardSkeleton` primitive, same convention as `dashboard/loading.tsx` - a title/intro skeleton plus 1-3 card-shaped placeholders matching how many real cards that page renders, not a generic spinner.
- **Touch targets (task C)**: swept every remaining sub-44px clickable control in this cluster. `ui.tsx`'s shared `Disclosure` component (used by all 4 Company sub-routes) and `OfficeLocations.tsx`'s "+ Add an office" trigger were 32px disclosure summaries - real clickable controls, not decorative text - bumped to this app's 44px convention. `people/[id]/page.tsx`'s jump-nav pills and its remaining disclosure summaries/small destructive buttons got the same treatment (already migrated in sub-PR 3, this just finishes the pass that sub-PR's own scope line didn't reach). One deliberate exception, consistent with the app's existing judgment calls (dashboard's `min-h-10` secondary actions, prompt 2): the tender-role/discipline checklist rows (`people/[id]/page.tsx`'s role tags, kept here rather than re-touched) stay at their denser size - a dense multi-item checklist's clickable area is the whole label row, not a single checkbox, so it doesn't need each row at a full 44px the way a real button does.
- **"Tables become cards on mobile" - checked, nothing to convert.** Every screen named in this task's own description (principals' shareholding breakdown, registrations list, bank accounts list) was already a `<div>`-based card/row layout before this pass, never a literal `<table>` - confirmed by grepping every file in scope. Each already collapses cleanly at 390px via the Tailwind grid/flex classes the earlier sub-PRs (2-5) already applied (`grid-cols-1 sm:grid-cols-2/3/4`, `flex-wrap`) - there was no squeezed table to fix.
- **Focus rings**: every interactive control in this cluster now goes through either a shadcn `Button`/`Input`/native `<select>` sharing `Input`'s focus classes (all carry `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` already, inherited for free from earlier sub-PRs) or a plain link/summary styled with `text-accent` (browser-default focus ring, never suppressed with `outline-none` anywhere in this cluster - checked directly).
- No screenshots for this piece specifically - it has no new visual surface of its own (loading states render for a fraction of a second behind real data in this environment's absence of a live backend, and the touch-target bumps are sub-pixel-visible spacing changes already covered by each sub-PR's own before/after screenshots); verified instead by `npm run verify`, the full test suite, and a direct re-read of every touched file's diff.

## Full trial walkthrough: 2 onboarding dead-ends fixed

Walked the full new-customer trial end to end against the live Supabase project (same one as the demo-company piece above), as a human would, via a real signup: `/signup` -> the 5-step onboarding wizard -> `/dashboard` -> `/tenders/new` (manual load, since this fresh company has no Discovery matches yet) -> the tender workspace -> "Generate submission pack".

- **Bug found and fixed: Step 3 ("Where you work") and Step 4 ("Your people") had no way to move forward once you'd actually added data.** `WizardShell`'s own header comment is explicit that "each step supplies its own form and Continue button as children" - every other step does, but these two (the only ones with a repeatable "add a row" pattern instead of one form) only ever rendered an "Add this office"/"Add this person" button and relied on the shared "Skip for now" link for the ONLY way to advance - worded for someone who wants to skip the step, confusing (and a real dead end, not just a wording problem) for someone who just added real data and has nothing meaningfully "Skip"-shaped left to do. Fixed by adding a `Continue` link (styled as the primary action, `buttonVariants`) once `offices.length > 0` / `people.length > 0`, navigating to the next step exactly like `WizardShell`'s own Skip link does - no new data, no new action, same forward-navigation mechanism already used everywhere else in this wizard. `app/onboarding/_components/Step3.tsx`, `Step4.tsx`.
- **Confirmed NOT a bug, just slow (a test-harness false alarm worth recording)**: the general-tender "Generate submission pack" button looked like a dead button on a quick check (no visible response within ~2.5s) - a longer wait showed it's a real server-action redirect with a specific, correctly-rendered error ("Review the full Pack Review list above and click 'I've reviewed this' before generating a pack."), exactly the documented `pack_review_confirmations` gate (`general-actions.ts`'s `requestJob`). A genuine, already-correct stopping point, not touched.
- **A pre-existing, repo-wide dev-console warning, not fixed, not new**: every dynamic page that imports any date-utility function (dashboard, onboarding, discovery, tenders/new, tenders/[id] - confirmed by grepping the dev server's own log) logs "Next.js encountered the unstable value `Date.now()` while prerendering" in the browser console during this session's Next.js 16 canary + `cacheComponents: true` dev mode. Every one of these routes already carries the established `export const instant = false` escape hatch (confirmed present on `app/onboarding/page.tsx` itself) - this is Next's own experimental Cache Components static-analysis pass flagging it anyway, a known rough edge of that still-experimental flag, not a functional defect: every page affected rendered and behaved correctly throughout this whole walkthrough. Out of scope for a "small, targeted" bugfix (it would mean auditing every date call in the codebase against a brand-new framework flag) - flagged here so a future session doesn't re-discover it from scratch.
- **The manual-load intake pipeline genuinely runs in this environment** (not just a sandbox stub): uploading a one-page test PDF through `/tenders/new` produced a real `pack_generation_jobs` row (`engine: general`, `kind: extract_requirements`) that completed in seconds with an honest, correct result ("Only an advert or short notice was found, not the full tender document") - confirming the real worker is live here, not something this walkthrough had to work around.
- No other broken step found: signup, all 5 onboarding steps (after the fix), the bid-readiness end screen, dashboard, Bids board, and the tender workspace all rendered and behaved correctly for a genuinely fresh company with an empty vault.

## Homepage hero: general-product positioning (Sarel, 2026-10-22)

**Positioning rule: the hero and all top-level marketing copy sell the general tender product first; SANRAL appears only as a named feature, badge or its own landing page.** The hero previously read "Your SANRAL technical and financial envelopes: built, numbered, bookmarked, and checked page by page" - framing the whole product as a SANRAL-specific tool, when SANRAL automation is one feature among several (compliance checks, CVs, cover pages, cross-tender discovery). Future top-level copy (hero, section titles, card headlines) should follow this rule; SANRAL-specific detail belongs inside the copy, in a named badge/callout, or on its own SANRAL landing page, never as the lead.

- **Headline + subhead replaced verbatim with Sarel's own copy**: "Your tender department, without hiring one." / "Tender Ready assembles your complete bid - compliance checks, company info, CVs and cover pages - from your own documents, then checks it page by page and flags anything that could get you disqualified. You verify, price and sign." No "not AI-written" sentence was re-added - Sarel's own replacement subhead already carries that idea ("from your own documents"), and the instruction was to use it as given, not layer a second clause onto it.
- **New SANRAL callout** - a small pill directly under the hero CTAs, deliberately quieter than the hero (`border-accent/40 bg-white/5`, brand-blue `#1D4ED8`/`text-accent` only, no solid fill): "Built-in SANRAL automation: technical and financial envelopes built, numbered and bookmarked in minutes, not hours." Left unlinked - the public SANRAL landing page this would point to doesn't exist yet (`/sanral-schedules` is a signed-in app page behind `AppShell`, not a marketing page); link it once that page is built.
- **Metadata (`<title>`/description) rewritten the same way** - the old copy led with "SANRAL submission packs" at the literal page-title level, which is exactly what this rule says not to do; SANRAL is now a trailing clause in the description, not the headline.
- **Swept the rest of the homepage for other SANRAL-leading copy**: only the hero and metadata actually led with SANRAL at a section/headline level. Everything else that mentions SANRAL does so as supporting detail inside an already-general headline (the differentiation band's "Tender Ready" card, a proof point, the "SANRAL B6 functionality score estimator" free-tool name) - none of those needed rewriting, since none of them frame the whole product or section around SANRAL specifically.
- **Found and fixed in passing, not part of the positioning ask**: the Founding Firms Programme paragraph still said "the first 10 firms get SANRAL Pro at a locked founding rate" - `SANRAL Pro` stopped existing as a plan name once PR #71 renamed every `plan_tier` to Starter/Professional/Business/Enterprise, so the homepage was advertising a plan that no longer exists. Reworded to "our top plan" (same offer, a name that's still real) rather than hardcoding a specific tier that may rename again.
- Screenshots cover the hero in full (headline, subhead, CTAs, new callout), before/after, 1440px and 390px, against the real `/` route (no live Supabase needed - `auth.getUser()` resolves to no user with the placeholder `.env.local.example` values, same as the earlier homepage color-migration pass).

## Brand asset swap: real logo/favicon pack (Sarel, 2026-10-22)

Sarel supplied a production brand asset pack (`Tender-Ready-Brand-Guide.pdf` + `Tender-Ready-Brand-Assets.zip`: approved vector SVGs, PNGs, a multi-size favicon.ico and a Claude handover note) replacing the earlier hand-drawn checked-document mark (concept #2 from `Personas-Branding-Research-2026-10-18.md`) with a blue rounded-square "TR" monogram and an outlined wordmark. Used the supplied files directly, not a redrawn approximation, per the pack's own instruction.

- **`public/brand/{mark,logo-light,logo-dark}.svg`** - the pack's real vector files, copied in as-is (outlined wordmark paths, no font dependency at render time). `Logo.tsx` now has two exports: `Logo` (mark only, one fixed design - the brand guide is explicit "the square stays blue", no light/dark variant needed for the mark itself) and `LogoLockup` (full mark+wordmark, height-driven width from the file's real 643:128 aspect ratio so it's never stretched). `LogoLockup`'s `surface` prop ("light" | "dark") matches the asset pack's own naming exactly - the files are named for the SURFACE they sit on, not the ink colour (`logo-light.svg` = navy ink, for a light surface; `logo-dark.svg` = white ink, for a dark surface) - picking `surface` to mirror that directly rather than inventing a differently-named prop that someone would have to mentally invert against the brand guide.
- **Call sites updated**: `AuthShell.tsx`'s header (`LogoLockup surface="dark"`, the panel is `bg-foreground`/navy) and its large low-opacity decorative corner texture (`Logo size={420}`, unchanged position/opacity, now the real mark instead of the hand-drawn one); the homepage and `/privacy` headers (same `bg-foreground` navy bars) both moved from a separate `<Logo/>` + hardcoded `<span>Tender Ready</span>` text pair to a single `LogoLockup` image - the old text span was a redraw-by-font risk the pack's own instruction says to avoid ("do not substitute live text... for the wordmark").
- **Favicon/app icons replaced**: `app/favicon.ico` overwritten with the pack's real multi-size `.ico`; added `app/icon.svg` (Next's file-based icon convention - modern browsers prefer this over the `.ico`) and `app/apple-icon.png` (180px, Apple touch icon). Deliberately did NOT also add `app/icon.png` from the pack's `app-icon.png` - `icon.svg` already covers every non-Apple icon need at any size without a second, redundant `<link>` tag; `app-icon.png` stays unused in the repo today, available if a PWA manifest is ever added.
- Verified `npm run verify` (build generates `/icon.svg` and `/apple-icon.png` as routes, both confirmed serving with correct content-types), the full vitest + node:test suite (80/80 + all node:test files), and before/after screenshots of `/`, `/privacy` and `/login` at 1440px and 390px.

## Standing UI/UX pass: homepage contrast + /tools brand regression (2026-10-22)

Picked from a fresh prospect-readiness audit (every §1-12 claim in a full product/UX spec checked against the real app) - these two were the highest-value fix available without inventing copy or needing an owner decision: both are objective, zero-judgment corrections against rules this codebase has already locked in, not new design calls.

- **Homepage closing CTA, blue-on-navy contrast fixed** (`app/page.tsx`): "We promise nothing in it is missing, expired, or mis-filed." was `text-accent` (brand blue, `#1D4ED8`) directly on `bg-foreground` (navy) - a 2.46:1 contrast ratio, well under WCAG AA's 4.5:1 minimum, and the exact pairing this app's own color-scheme decision already forbids ("blue text on navy" was never a supported combination - blue is for button backgrounds with white labels, or accents on a LIGHT surface, never body text on navy). Changed to `text-white`, matching the line directly above it in the same section. Wording unchanged - the sentence's own truthfulness (an unqualified "nothing is missing" guarantee) is a content decision for Sarel, not something to rewrite unprompted; this pass fixed only the contrast defect.
- **`/tools` header no longer shows a different brand** (`app/tools/_components/ToolsHeader.tsx`): this file had its own hand-coded "T" badge (`bg-accent` div with a literal `T` character) that PR #75 (the real brand-asset-pack swap, same day) never touched - every other public-facing header moved to the real `LogoLockup` component, but a visitor who reached a free tool directly (search, a shared link) without passing through the homepage first saw a plain blue square with a generic letter instead of the actual approved mark. Replaced with `<LogoLockup height={24} surface="dark" />`, same component/props pattern as `page.tsx`/`privacy/page.tsx`'s own headers (`bg-foreground`/navy surface).
- Screenshots confirm both: the closing CTA's two lines now read at equal, clearly-legible white-on-navy; the `/tools` index header (the one call site that passes `showBackLink={false}`) now renders the real blue "TR" badge + "Tender Ready" wordmark, matching every other page.
- Not touched this pass (left for the owner's review of the full audit): the "No customers yet" headline, the pricing page's per-tier feature-locking copy, the "falsifiable claims"/`fingerprint.py` wording, the footer's stale "construction and engineering firms" line, the mobile auth-page logo gap, the unlinked SANRAL callout - all real findings, each either needs new copy (ground rule: never invent customer-facing claims without a real decision) or a larger restructure (the pricing page's shared-feature-list rework) than a single standing pass should take unprompted.

## Design-system color migration, batch 1 of N (2026-10-22, spec §2)

A repo-wide sweep (`grep -rlE "style=\{\{[^}]*#[0-9A-Fa-f]{3,6}" app`) for the §2 audit's own ask ("use semantic tokens in globals.css only; no hard-coded colours") found the entire tender-workspace screen cluster was NEVER migrated off the pre-"confident & premium" Civic Navy system (navy `#16233B`, gold accent `#D97706`, pastel status pills, cream-family leftovers like `#F6F5F1`/`#D6D1C2`) - 18 files, ~400 inline-hex occurrences, the single biggest remaining gap against the locked design system. Three of those files (`page.tsx` 88 occurrences, `general-workspace.tsx` 64, `compliance-report.tsx` 50) account for over half the total and are deliberately NOT in this batch - each is large and central enough to deserve its own focused pass, not a rushed sweep alongside 17 other files.

This batch covers the 14 smallest, lowest-risk files: `download-all-button.tsx`, `ocr-notice.tsx`, `retry-button.tsx`, `sanral-progress.tsx`, `review-button.tsx`, `task-assignee-select.tsx`, `task-status-button.tsx`, `private-documents.tsx`, `tender-templates.tsx`, `subcontracting-plan.tsx`, `app/not-found.tsx`, `app/error.tsx`, `app/_components/ScrollFade.tsx`, `app/tenders/new/page.tsx`.

- **Mapping used, consistent with every prior token migration** (`pack-checklist.tsx`/`cover-page-preview.tsx`/`cv-compare.tsx`): navy `#16233B` text → `text-foreground`; grey `#5B6472`/`#8A93A0` → `text-muted-foreground`; white card bg → `bg-card`; border `#E3E6EA`/`#ECEEF1` → `border-border`; green `#DCFCE7`/`#15803D` → `bg-success/10 text-success` (or the bare `text-success` where only text color was ever set); amber `#FEF3C7`/`#B45309` → `bg-warning/10 text-warning`; red `#FEE2E2`/`#B91C1C` → `bg-destructive/10 text-destructive`; neutral chip `#ECEEF1`/`#16233B` → `bg-muted text-foreground`. Soft-tint opacity values (`/10` bg, `/20`-`/30` border) copied directly from `components/tt/bid-task-badge.tsx`'s own established convention, not invented fresh.
- **Gold `#D97706` accent eliminated everywhere it appeared in this batch** - `not-found.tsx`/`error.tsx`'s CTA buttons, `tenders/new/page.tsx`'s back-link - replaced with the real `bg-accent`/`text-accent` blue, matching every other migrated CTA.
- **`ocr-notice.tsx`'s info box** (`#EFF6FF`/`#BFDBFE`/`#1E3A8A`, a light-blue informational banner) mapped to the existing `--info` token (`bg-info/10 border-info/20 text-info`) rather than an ad-hoc blue - this token already existed in `globals.css` but had no real usage anywhere in the app until this file.
- **`private-documents.tsx`'s download link** moved from a solid gold link to `cv-compare.tsx`'s own established `actionLinkClass` pattern (`text-foreground underline hover:text-accent`) - same reasoning: a single download link among several on a page isn't the screen's one highlighted action, so it doesn't get a solid accent fill.
- Verified `npm run verify`, `npx vitest run` (80/80), the full `node:test` sweep, and a screenshot of `/not-found` (reachable without a live Supabase session) confirming the gold CTA is now blue and all text reads through the correct tokens. The remaining 4 files already matching the grep (`AdminNav.tsx`, `tools/page.tsx`, `company/_components/ui.tsx`) turned out to be false positives on re-inspection - their only hex-string matches were in header comments documenting a PRIOR migration, not live code.
- **Next batches, same initiative**: batch 2 covers the next tier of medium files (`activity-log.tsx`, `pack-review.tsx`, `general-pack-review.tsx`, `submission-plan-view.tsx`, `subcontracting-plan-form.tsx`, `position-person-select.tsx`, `invite/[token]/page.tsx`, `manual-tender-form.tsx`, `my-cv/page.tsx`, `company/team/page.tsx`, `reuse-past-submission.tsx`, `intake-card.tsx`); batch 3+ takes on the three large central files (`market-context.tsx`, `tender-updates.tsx`, `submission-pack.tsx`, then finally `compliance-report.tsx`, `general-workspace.tsx` and `page.tsx` itself) - each of those needs its own dedicated, carefully-screenshotted pass given their size and centrality to the product.

## Design-system color migration, batch 2 of N (2026-10-22, spec §2)

Continues batch 1's sweep (see that entry) - the next 12 files from the same 18-file inventory, same hex→token mapping, same reasoning throughout: `activity-log.tsx`, `company/team/page.tsx` (+ its shared `company/_components/ui.tsx` neighbour, already on CSS-variable-backed `NAVY`/`MUTED` constants - only its own 3 literal cream-hex leftovers, `#F0EEE6`/`#E5E1D5`/`#F6F5F1`, needed fixing), `pack-review.tsx`, `general-pack-review.tsx` (kept deliberately in sync - that file's own header comment documents mirroring `pack-review.tsx`'s styling rather than sharing it), `submission-plan-view.tsx`, `subcontracting-plan-form.tsx`, `position-person-select.tsx`, `invite/[token]/page.tsx`, `tenders/new/manual-tender-form.tsx`, `my-cv/page.tsx`, `reuse-past-submission.tsx`, `intake-card.tsx`.

- **`my-cv/page.tsx` was the worst offender found so far**: its own top-of-file `NAVY`/`AMBER`/`CREAM`/`BORDER`/`MUTED`/`FAINT` constants were literal pre-redesign hex (`CREAM = "#F6F5F1"` - the exact cream color §2 names for removal), used as the page's own background. Fully converted; `AMBER` (old gold CTA accent) became `bg-accent`/`text-accent-foreground` throughout, matching every other migrated CTA.
- **`intake-card.tsx`'s dynamic `chip(bg, color)` helper** took runtime hex strings (including from the shared `lib/generalTender.ts` `JOB_STATUS_STYLE` export, still hex-based) - converted to a `chip(className)` helper. For the one badge sourced from that external, not-yet-migrated constant, added a small local `JOB_BADGE_CLASS` map mirroring its semantics (queued/working→warning, ready→success, failed→destructive) rather than changing the shared lib export itself, which other unmigrated files (`general-workspace.tsx`, deferred to a later batch) still read directly - a wider change there belongs with that file's own pass, not smuggled in here.
- **`reuse-past-submission.tsx`**: `#D6D1C2` (another cream-family border leftover, this one not even caught by a straightforward grep for 6-hex-digit colors tied to known tokens) replaced with `border-border`.
- Verified `npm run verify`, `npx vitest run` (80/80), the full `node:test` sweep, and a screenshot of `/invite/[a-fake-token]` (the one page in this batch reachable without a live Supabase session) confirming clean token-based rendering on both the dark auth panel and the light card.
- **Remaining for batch 3+**: `tender-updates.tsx`, `submission-pack.tsx`, `market-context.tsx` (medium-large, ~20-25 occurrences each), then finally the three largest, most central files - `compliance-report.tsx`, `general-workspace.tsx`, `page.tsx` itself (together over half of this whole initiative's total occurrence count) - each still needing its own dedicated, carefully-screenshotted pass.

## Live infrastructure note (2026-10-22, ~13:50 UTC) - NOT part of this pass, flagged in passing

While working on the above, confirmed directly against the live project's own REST OpenAPI listing (`$NEXT_PUBLIC_SUPABASE_URL/rest/v1/` with the service-role key) that the gap this file's own "Resume here" section (top of file, added by PR #78) describes is real and still open as of this timestamp: `narrative_documents`, `company_subscriptions`, `tt_plan_limits` and `company_can_request_pack` are all genuinely absent from the live schema. `SUPABASE_DB_URL` was not visible in this session's own environment either (same "needs a fresh session to load a newly-added secret" issue the handover itself names) - so this session could not pick up the migration-application work, and didn't attempt a workaround for a missing production credential. Left entirely to whichever session next has that secret loaded; nothing here was touched or fixed.

## Design-system color migration, batch 3 of N (2026-10-22, spec §2)

Completes the "medium" tier flagged in batch 2's own entry - the last 3 files before the three largest, most central ones (`compliance-report.tsx`, `general-workspace.tsx`, `page.tsx` itself).

- **`submission-pack.tsx`**: the "SANRAL schedules" promo banner (item 51's own highlighted-card treatment) kept its visual intent - a warm, attention-getting strip - via `bg-gradient-to-r from-warning/10 to-card border-warning/30` instead of the old literal `linear-gradient(90deg, #FFF7E6, #FFFFFF)`. Every status pill (`STATUS` record), blocker/gap banner and the disabled-submit button's grey state converted to tokens.
- **`tender-updates.tsx`**: the one file in this batch that imports a shared, still-hex-based constant (`URGENCY_STYLE` from `lib/tenderUpdates.ts`) - unlike `intake-card.tsx`'s `JOB_STATUS_STYLE` in batch 2 (which has other, not-yet-migrated consumers and was deliberately left alone), `URGENCY_STYLE` has exactly one consumer (this file), confirmed by grep, so it was safe to convert the shared export itself to Tailwind classes (`badgeClassName`/`cardBorderClassName`) rather than duplicating a local shadow copy. `DateDisagreement`'s "strong" field border (`#D97706` gold, flagging which of two disagreeing dates is the one from the document) → `border-accent`.
- **`market-context.tsx`**: the largest and most structurally varied of the three - two separate local `th`/`td` `CSSProperties` objects (one in `Register`, one in `SegmentTable`) consolidated into one shared pair of className constants reused by both; the inline SVG bid-strip chart's dot/line colors (navy "you", cream-grey "other bids", white+gold "winner") converted to `fill-*`/`stroke-*` Tailwind utility classes against the same tokens, matching `Logo.tsx`'s own established `fill-accent` SVG precedent rather than leaving raw hex on `fill=`/`stroke=` attributes. The register table's "your own bid" row highlight (`#EEF2FF`) became `bg-accent/10` - the one row that's genuinely the screen's single most relevant item, a reasonable accent usage under the "one highlighted thing" rule.
- Verified `npm run verify`, `npx vitest run` (80/80), the full `node:test` sweep. No screenshot this pass - all three files render only inside the signed-in tender workspace, which needs a live Supabase session this environment's placeholder credentials can't provide (same limitation noted for every tender-workspace-only file in batches 1-2); correctness here rests on the same direct, token-by-token hex→class mapping already screenshot-verified on `/not-found`, `/invite/[token]` and the homepage in earlier batches, not a fresh visual check.
- **Remaining for batch 4 (final)**: `compliance-report.tsx`, `general-workspace.tsx`, `page.tsx` itself - together over half of the whole initiative's original ~400-occurrence count, each large and central enough to warrant its own dedicated pass rather than being folded into this one.

## Design-system color migration, batch 4 of 4 (final) (2026-10-22, spec §2)

Closes out the initiative started in batch 1 (18 files, ~400 inline-hex occurrences, all now converted). `page.tsx` turned out to already be fully migrated (no hex colors, no `rgba()`, no legacy `NAVY`/`AMBER`/`CREAM` constants found by direct inspection) - it was never touched this pass despite being flagged in the original audit count, so this batch is really just the two remaining files: `compliance-report.tsx` (548 lines) and `general-workspace.tsx` (632 lines), the densest, most inline-style-heavy pair in the whole sweep.

- **A hybrid approach, not a pure className rewrite like batches 1-3**: both files mix color properties into the same `style={{...}}` objects as layout properties (`fontSize`, `padding`, `display`, `flex`) on nearly every line - splitting every one of those into a separate `className` would have meant rewriting the entire render tree for a color-only pass. Instead: layout properties stayed in `style`; every color-only usage (a bare `color:`/`background:`/`border:` with no sibling layout properties worth keeping inline, i.e. the four shared `card`/`input`/`primaryBtn`/`secondaryBtn` `CSSProperties` constants in each file) got the `var(--token)` CSS-variable treatment, `company/_components/ui.tsx`'s own established exception to the "always Tailwind className" rule; and every OTHER scattered color property mixed into a layout-heavy style object (the bulk of both files - plain ink/white/grey/border/gold hex values used as a single `color`/`background`/`border` property) was substituted 1:1 with the matching `var(--token)` in place, same mapping as every prior batch (navy→`var(--foreground)`, white→`var(--card)`, both border greys→`var(--border)`, all three muted-text greys→`var(--muted-foreground)`, gold `#D97706`→`var(--accent)`, the `#92400E` darker-amber text shade collapsed into the same warning token as `#B45309`). This still fully satisfies §2's own ask ("semantic tokens in globals.css only, no hard-coded colours") with a much smaller, lower-risk diff than a full structural rewrite would have needed.
- **Chip/status-record components did get the full Tailwind className treatment** (same soft-tint convention as every prior batch, `border-X/20 bg-X/10 text-X`), since these are small, self-contained, and are exactly where the old hex values were pastel tints (`#FEF3C7` pale amber, `#DCFCE7` pale green, `#FEE2E2` pale red) that a plain `var(--warning)` 1:1 swap can't reproduce - `var(--warning)` is a solid, saturated amber meant for text, not a pale background wash. Both files' local `Chip`/`CountBadge` functions now take a `className` prop instead of `bg`/`color`; both files' local `STATUS_STYLE` (+ `compliance-report.tsx`'s own `TASK_STYLE`) records now hold `{label/title, className}` instead of `{label/title, bg, color}`; every ternary-constructed Chip call site (score-estimate outlook, CV/tender-CV/project-count badges, qualifying-experience count) converted the same way, branch by branch.
- **`lib/generalTender.ts`'s `FORM_STATUS_STYLE`** converted directly to `{label, className}` - confirmed its only real code consumer is `general-workspace.tsx` itself (`submission-plan-logic.ts`/`.spec.ts` only name it in comments). **`JOB_STATUS_STYLE` was deliberately left untouched** - it has another real consumer, `intake-card.tsx` (batch 2), which already shims it locally via its own `JOB_BADGE_CLASS` rather than touching the shared export; `general-workspace.tsx` now does the exact same thing with its own copy of that map, rather than changing semantics two files rely on from one pass.
- A handful of warning/success banners in both files (the "what Tender Ready can't do" gaps box, `SavedBanner`, the fixCount disqualification banner, the C3.1.11-minimums/evidence-rule "assumed vs read" banners, the Experience-Library-unreadable dashed card) got the same Tailwind soft-tint treatment as the Chips, for the same pastel-tint reason.
- Verified `npm run verify` (typecheck + lint + build, clean), `npx vitest run` (80/80), and the full `node:test` sweep (11 files, all green) - this worktree's own `node_modules` needed a fresh `npm install` (the shared main checkout's own install was missing the `resend` package despite being in `package.json`, an unrelated pre-existing environment gap, not something this pass caused or fixed). No screenshot this pass - same documented limitation as every tender-workspace-only file in batches 1-3 (needs a live Supabase session this environment's placeholder credentials can't provide); correctness rests on the same direct, token-by-token mapping already screenshot-verified elsewhere in this initiative.
- **This closes the color-migration initiative.** All 18 originally-flagged files (+ `page.tsx`, confirmed already clean) are now on the oklch/Tailwind token system; no further batches planned.

**Correction (2026-10-22, later the same day): the line above was wrong.** The "`page.tsx` already clean" check above was against `app/page.tsx` (the public homepage) - it never checked `app/app/tenders/[id]/page.tsx` (the tender workspace container page, a different file with the same basename, 1309 lines). A separate audit pass found that file still had 161 raw hex occurrences, confirmed directly by grep. See the batch 5 entry below - that one is the actual final batch.

## Design-system color migration, batch 5 of 5 (actually final): tender workspace page.tsx (2026-10-22)

Corrects the batch 4 oversight above. `app/app/tenders/[id]/page.tsx` (the page that mounts `compliance-report.tsx`/`general-workspace.tsx`/`submission-pack.tsx` and renders the tender's own facts, readiness score, key positions, tasks/milestones and won-project record) had 161 raw hex occurrences, never touched by any prior batch.

- Same hybrid approach as batch 4: the file's two local status records (`GENERATED_CV_STATUS_LABEL`, `PACK_STATUS_LABEL` - both confirmed file-local only, `my-cv/page.tsx`'s own identically-named constant is a separate, already-migrated copy, not a shared import) converted to `{label, className}`; the `SummaryChip`, `ReportCard`, `JumpLink` and `ErrorBanner` helper components converted from `bg`/`color`/`accent` hex props to a single `className` prop using the established soft-tint convention; every other scattered pastel-tint pill inline in the render tree (the readiness-score circle, the key-positions "N to confirm" pill, the "no key person confirmed" Fix pill, the task-kind tag) got the same className treatment since a plain `var()` swap can't reproduce a pale background wash; everything else (plain card/border/text colors mixed into layout-heavy `style={{}}` objects, the primary-button navy/white pairs, the ReminderForm toggle) converted 1:1 to `var(--token)` strings, same mapping as every prior batch.
- `JumpLink`'s "primary" variant was still gold (`#D97706`) - the one CTA-style nav pill in this file that had never been touched by the earlier homepage/button gold-to-blue sweep; now `bg-accent`/`text-accent-foreground`, consistent with every other primary action in the app.
- Verified `npm run verify` (clean), `npx vitest run` (80/80, unchanged), full `node:test` sweep (11 files, all green - this worktree needed its own fresh `npm install`, same pre-existing `resend`-package gap noted in batch 4, not caused by this pass). No screenshot - this page only renders inside the signed-in tender workspace, same documented limitation as every other file in this initiative; correctness rests on the same direct, token-by-token mapping verified visually elsewhere.
- **This closes out the "18 files + page.tsx" inventory this initiative was originally scoped against.** Hex count in this file: 161 -> 0.
- **Correction #2, found while double-checking the "no other files" claim before writing it here**: a repo-wide grep turned up a SEPARATE, previously-undiscovered cluster of live hex-based styling that was never part of this initiative's original inventory and is still unconverted: a shared `{label, bg, color}` -> `toneFromColor()` pattern spanning `app/company/_components/ReadOnlyView.tsx`, `app/company/_components/shared.tsx`, `app/company/registrations/page.tsx`, `app/company/properties/page.tsx`, `app/company/principals/page.tsx`, `app/people/page.tsx`, `app/people/[id]/page.tsx`, and the underlying record-producing functions in `lib/personCredentials.ts`, `lib/principals.ts`, and `lib/dates.ts` (the latter's `GREEN`/`AMBER`/`RED`/`GREY` constants include `#F0EEE6`/`#6B6758` - the exact cream-family colors §2 names for removal). Not touched in this pass - out of scope for "fix the one file I was asked to fix," and surfacing it honestly here rather than claiming completion again. `lib/generalTender.ts`'s `JOB_STATUS_STYLE` hex values are NOT part of this gap - that one is deliberately left hex-based per batch 2/4's own reasoning (shimmed locally by its two consumers) and is correct as-is. `lib/emailTemplates.ts`'s hex constants are also NOT a gap - HTML email can't use CSS variables or Tailwind classes, so that file's own header comment already documents this as a deliberate, permanent exception.

## Spec §4/§5/§12 copy fixes: truthfulness pass, pricing tier-locking, mobile auth logo (2026-10-22)

Picks up the items an earlier standing pass (see "Not touched this pass" above) deliberately left open, citing the ground rule against inventing customer-facing claims without a real decision. That decision arrived via Sarel's own uploaded `Tender-Ready-Claude-Spec_v1.md`, which gives exact replacement wording/approach for most of these - this pass applies it rather than improvising new copy.

- **`app/page.tsx`**: removed the exposed internal file name (`fingerprint.py`) and "falsifiable claims" developer-language from the proof section; "No customers yet. Here's what to check instead of a testimonial" → "Check it yourself, not a testimonial" (spec: don't headline immaturity); "Not a draft to tidy up. A submission pack, ready to print and sign." → "See what Tender Ready checks before you submit - then you give it a final look, price it and sign." (spec's own suggested replacement); closing CTA's two absolute guarantees ("We don't promise to write your bid." / "We promise nothing in it is missing, expired, or mis-filed.") → the real promise, matching the hero's own wording ("Tender Ready compiles your bid from your own company information and flags what's missing." / "You review it, price it and sign."); footer → "built for South African companies that submit tenders" (spec's exact replacement text, was "construction and engineering firms").
- **Pricing tier-locking fixed** (`app/page.tsx`'s `PRICING_TIERS`): the lede above the pricing grid already said "every plan gets every AI engine - plans differ only in how many people and how many bid packs a month," but the tier bullets directly contradicted it (CV tailoring/cover pages/SANRAL schedule engine gated to Professional, "deeper analytics" and "priority onboarding and support" gated to Business) - an internal inconsistency, not a deliberate decision to undo. Added one shared `INCLUDED_IN_EVERY_PLAN` list (tender discovery, AI compliance/opportunity checks, company vault, CV tailoring, cover pages, buyer-specific form completion where supported, SANRAL schedule automation, pipeline tracking with win rate, email deadline reminders - every item independently verified as real/working in this codebase, not copied from the spec's own example list uncritically: left out "push reminders" since no push infrastructure exists, and left out a standalone "analytics" bullet since §10's dedicated analytics work hasn't been built yet, beyond the pipeline's own real win-rate stat) rendered once above the per-tier cards. Each tier's own bullets now carry only its real differentiator (users + bid packs/month); Professional's "The plan most companies start on" → "For companies tendering regularly" (spec's exact required wording - "most companies start on"/"Most popular" are explicitly forbidden). Sarel's own confirmed numbers (R1,490/R2,990/R4,990/Enterprise, user counts, pack limits) are completely unchanged - this pass only touched the capability-framing bullets that contradicted the page's own lede, not the pricing structure a prior session already resolved directly with him.
- **`app/tools/page.tsx`**: B6 estimator blurb dropped the unsupported competitor absolute ("no SANRAL competitor covers this at all").
- **`app/privacy/page.tsx`**: Security section no longer claims the RLS isolation was "independently audited" (no dated evidence of a real independent audit exists - the automated-test-suite claim right after it stays, since that one's genuinely true and verified in this session's own test runs). "What's still in progress" box no longer claims the open paperwork items (Information Officer registration, retention period, hosting region) have no bearing on protection today - kept the honest disclosure of what's outstanding, dropped the unsupported reassurance.
- **`app/_components/AuthShell.tsx`, two fixes**: (1) blue-on-navy contrast - "Miss fewer deadlines." was `text-accent` (brand blue) directly on the `bg-foreground` navy panel, the exact pairing spec §2/§4 names as forbidden (2.46:1 contrast, fails WCAG AA) and the exact example text spec §4 itself cites; changed to plain white, matching the homepage's own earlier contrast fix for the same violation. (2) mobile auth logo gap (spec §3) - the left brand panel is `hidden` below `md:`, so login/signup/forgot-password/reset-password/onboarding (all share this shell) showed no logo at all on mobile; added a small linked `LogoLockup` (`surface="light"`, since the mobile right-panel background is the light canvas) above the form, visible only below `md:`.
- Verified `npm run verify` (clean build/typecheck/lint), `npx vitest run` (80/80), full `node:test` sweep (11 files, all green). Screenshots at 1440px/390px: homepage (pricing section confirms the shared included-list and simplified tier bullets render correctly), `/tools`, `/privacy`, and `/login` (confirms the new mobile logo and the white "Miss fewer deadlines." on desktop) - all four are reachable without a live Supabase session.
- **Still open from the same "not touched" list, deliberately left for a separate pass**: the unlinked SANRAL homepage callout (correctly deferred per the spec's own instruction - no public `/sanral` page exists yet to link to).

## Savings figures rule (spec §9.7)

Savings figures are always estimates derived from the company's own baseline and actually completed steps.

## Spec §9: Time and cost saved counter (new feature, 2026-10-22)

Calculation-and-display only, per the spec's own ground rule 0 - no engine rules, Python SANRAL engine, prices, entitlements, permissions, database policies (beyond the one additive migration below) touched.

- **Migration `0085_savings_counter.sql`**: two not-null columns on `companies` (`savings_baseline_hours_per_tender` default 20, `savings_baseline_hourly_cost_zar` default 450 - the spec's own placeholder numbers, not measured figures) plus a new `savings_counted_steps` table (company_id, tender_id, step_key, hours snapshot, unique on all three) whose unique constraint IS the "once per tender" dedupe - same shape as `0079_sent_deadline_reminders.sql`'s own dedupe table, with RLS following the ordinary `people`/`projects`/`tender_packs` tenant-isolation pattern (read access included this time, unlike 0079's write-only table, since the Home counter card and final-review panel both need to read it back). **Not verified against a real Postgres** - this environment has no `SUPABASE_DB_URL` (see `docs/specs/System-Status.md`'s "Resume here" section); only checked against 0030/0079/0083's own house style. Replay it for real before trusting it in production.
- **`lib/savingsCounter.ts`**: the one pure, unit-tested calculation core (same split as `lib/readiness.ts`/`lib/companyReadinessData.ts` - no Supabase call inside it). `SAVINGS_STEP_HOURS` (compliance check 2h, vault documents 3h, CVs tailored 4h, cover page 1h, template/SANRAL schedule 5h, pack assembled 2h) are **round, invented placeholder numbers** - "Default hours per step are placeholders until the owner supplies timed figures from a real tender" is the spec's own wording; replace these once Sarel times a real tender end to end. `hoursSavedForTender()` caps one tender's total at the company's own baseline; `extraCapacity()` implements the spec's own divide-by-zero guard (floor(hours saved ÷ (baseline − average saved)), returns 0 rather than Infinity/NaN whenever that denominator is zero or negative); `formatRand()` uses a plain space thousands separator ("R27 900"), matching the spec's own example, not a comma. 20 unit tests in `lib/savingsCounter.spec.ts` cover all four of §9.6's required cases (baseline cap, once-per-step counting, divide-by-zero, Rand rounding) plus extra edge cases.
- **`lib/savingsCounterData.ts`**: the DB-touching layer - `fetchSavingsCounterSummary()` (Home card's this-month/all-time totals), `fetchTenderSavingsBreakdown()` (final review's per-tender "how we worked this out" list), `recordSavingsStep()` (the once-per-tender insert, idempotent via the unique constraint - a `23505` unique-violation means "already counted", not an error). Also a deliberately-unwired `monthlySummaryEmailNotYetBuilt()` stub (§9.4: "if the report doesn't exist yet, leave a clearly marked hook, don't fake it") - this app has no monthly-digest email infrastructure at all yet (only `lib/deadlineReminders.ts`'s per-tender cron exists), so this is a documented hook naming exactly what a real one would need (a cron route, a per-period dedupe table matching `0079`'s own pattern, an `emailTemplates.ts` template), not a half-built version of it.
- **Where steps are recorded**: `submission-pack.tsx` (SANRAL workspace) records all six steps the first time a pack job reaches `status: "ready"` - by that point the compliance check, vault documents, CV tailoring, cover page and SANRAL schedule are all genuinely bundled into the one generated PDF, so this is the single safe, already-rendered moment to count all six at once, rather than scattering `recordSavingsStep()` calls across every individual action file this pass didn't have the budget to audit one-by-one. **`general-workspace.tsx`'s equivalent general-tender pack completion is NOT wired up yet** - deliberately left for a follow-up pass rather than touching a file batch 4 of the color-migration initiative had just finished migrating, to avoid colliding with that very recent change.
- **Display surfaces**: the Home cockpit (`app/dashboard/page.tsx`) gets a new `SavingsCounterCard` (`components/tt/savings-counter-card.tsx`) right under the stat row, with the exact empty state the spec asks for ("Finish your first bid to see your savings.") when nothing's been counted yet; a 6th setup-checklist item ("Your time/cost baseline confirmed") reads as done once either baseline value differs from its default, since there's no separate "confirmed" flag. `submission-pack.tsx`'s pack-ready state now shows "About X hours saved (R Y)" plus a collapsible "How we worked this out" breakdown, replacing the old generic, unsupported "Time saved: usually 6-8 hours by hand" line from the earlier item-2 pass - the new figure is the company's own real baseline-driven number, not a blanket marketing claim. The pricing page (`app/page.tsx`) gets a `SavingsCalculator` (`components/tt/savings-calculator.tsx`) - a live, client-side estimate (tenders/month × hours/tender × hourly cost) compared against the Professional plan's real price, reusing `lib/billing.ts`'s existing `PLAN_MONTHLY_ZAR.professional` rather than a 4th hardcoded copy of that number (same "checked against each other, never imported" convention `app/page.tsx`'s own `PRICING_TIERS` comment already documents).
- **Baseline fields, editable in both places §9.1 names**: onboarding step 2 (`Step2.tsx`) and Company vault's new "Time and cost saved" section (`EditForm.tsx`/`SavingsBaselineSection.tsx`, `#savings-baseline` anchor) both go through the same shared `buildCompanyUpdate()` (`lib/companyProfileUpdate.ts`) - unlike every other numeric field there, a blank submission is refused rather than written as null (these columns have no "not recorded" state to fall back to), handled by a small dedicated `BLANK_NOT_ALLOWED` set rather than touching the generic blank-becomes-null loop every other numeric field relies on.
- **No dedicated "money" design-system token exists** - the locked §2 table calls for "one dedicated accent colour, used only for Rand amounts" but it was never actually added to `globals.css`. Rather than invent one outside this feature's own scope, every Rand figure here reuses the existing `text-accent` blue. Flagging for whoever next works on §2's own token set. **Fixed in the standing UI/UX review pass below** - see "Dedicated `money` design-system token".
- Verified `npm run verify` (clean build/typecheck/lint), `npx vitest run` (100/100 - 80 existing + 20 new, all green), full `node:test` sweep (11 files, all green). No screenshot of the Home counter card or the final-review breakdown - both need a live, signed-in Supabase session this environment's placeholder credentials can't provide (same documented limitation as every signed-in-only surface this whole initiative has hit); the pricing-page calculator is reachable without one and was screenshotted at 1440px/390px.

## Design-system color migration, batch 6: company/people cluster, actually final this time (2026-10-22, spec §2)

A second, previously-undiscovered hex cluster, surfaced by batch 5's own closing sweep (it checked its "no other files have raw hex" claim before writing it down, rather than repeating batch 4's mistake) - never part of the original 18-file inventory. Ten files: `app/company/_components/ReadOnlyView.tsx`, `app/company/_components/shared.tsx`, `app/company/registrations/page.tsx`, `app/company/properties/page.tsx`, `app/company/principals/page.tsx`, `app/people/page.tsx`, `app/people/[id]/page.tsx`, `lib/personCredentials.ts`, `lib/principals.ts`, `lib/dates.ts` (62 hex occurrences total across all ten).

- **Fixed at the source, not file-by-file**: all ten shared one underlying pattern - `lib/dates.ts`'s `StatusChip = { label, bg, color }` type (produced by `expiryStatus()`, `NotStated()`, and several ad-hoc literals of the same shape), rendered everywhere via `app/company/_components/shared.tsx`'s `ChipBadge`, which recovered a soft-tint tone by string-matching the literal hex in `.color` (`"#15803D"` → success, `"#B45309"` → warning, `"#B91C1C"` → destructive, anything else → muted) through a `toneForChip()` helper. Two more files (`app/people/[id]/page.tsx`, `app/people/page.tsx`) had independently duplicated the exact same string-matching function locally (`toneFromChip`), rather than importing it - this app's own precedent for duplicating small per-feature-folder helpers (see `general-pack-review-logic.ts`'s header comment) rather than importing across them, but it meant the same hex strings had to be kept in sync in three places.
- **`StatusChip` changed shape**: `{ label: string; bg: string; color: string }` → `{ label: string; tone: ChipTone }` where `ChipTone = "success" | "warning" | "destructive" | "muted" | "accent"` (new export from `lib/dates.ts`). `expiryStatus()` now returns the tone directly instead of a hex pair matched back to a tone at render time - this isn't just a color-token swap, it removes a genuinely fragile indirection (if `GREEN`/`AMBER`/`RED`/`GREY`'s hex values had ever drifted even slightly, `toneForChip()`'s exact string match would have silently fallen through to "muted" for every status). `toneForChip()` (shared.tsx) and both local `toneFromChip()` duplicates (people pages) are deleted outright as dead code - every caller now reads `.tone` straight off the `StatusChip`.
- **"accent" is a new 5th tone**, not one of the original four - `app/company/principals/page.tsx`'s role tags (e.g. "Director", "Shareholder") were using an ad-hoc `{bg: "#E0E7FF", color: "#16233B"}` literal, a plain informational tag rather than a pass/fail judgement, so folding it into "muted" would have lost the visual distinction the original hex gave it. Added `border-accent/20 bg-accent/10 text-accent` to `CHIP_TONE_CLASS` for this one case rather than forcing it into the 4-state status vocabulary.
- **Every literal `{label, bg, color}` fallback object** across `app/company/properties/page.tsx`, `app/company/registrations/page.tsx`, `app/company/principals/page.tsx`, `lib/personCredentials.ts`, `lib/principals.ts`'s `certificationStatus()` (confirmed single real consumer, safe to convert directly) converted to `{label, tone}` the same way.
- **Found and fixed a real, latent counting bug as a direct side-effect of this refactor**: `ReadOnlyView.tsx`'s `notOnFileCount` filtered on `s.color === "#5B6472"` - but `expiryStatus()`'s own "no date on file" case (`GREY`) was actually `#6B6758`, a different grey entirely. So a document with no expiry date recorded via `expiryStatus()` was never counted as "not on file" in the vault health summary - only `NotStated()`'s chips (empty-string color) were, via the `!s.color` half of that same check. Both paths now correctly read `s.tone === "muted"`.
- **Final sweep, this time actually checked before claiming completion**: `grep -rlE "#[0-9A-Fa-f]{3,6}" app lib --include="*.tsx" --include="*.ts"` still returns 21 files, but every one is a false positive on manual inspection - anchor hrefs (`#bee-cidb`, `#r-${id}`, `#add`), an HTML warning-triangle entity (`&#9888;`), an order-number string in a payfast test fixture (`"Order #000000020"`), header comments documenting a PRIOR migration (`AdminNav.tsx`, `app/admin/*`, `app/tools/cidb-grade/CidbGradeClient.tsx` - the same false-positive pattern batch 1 already found and excluded), or `app/app/tenders/[id]/page.tsx` itself (batch 5's own target, not yet merged into this branch at the time this sweep ran - will resolve on rebase). `lib/generalTender.ts`'s `JOB_STATUS_STYLE` and `lib/emailTemplates.ts` remain the two deliberate, already-documented exceptions.
- Verified `npm run verify` (clean build/typecheck/lint), `npx vitest run` (80/80), full `node:test` sweep (11 files, all green). No screenshot - every one of these ten files renders only behind a signed-in Supabase session (`/people`, `/people/[id]`, `/company/registrations`, `/company/properties`, `/company/principals` all call `createClient()`/read the authenticated user), the same documented limitation as the rest of this initiative; confirmed by checking each file's own auth call before writing this line, not assumed.
- **This closes the color-migration initiative for real** - between batch 5 (tender workspace `page.tsx`) and this batch, every genuine hex cluster this session's own repeated closing-sweep discipline could find is now gone. If a third cluster turns up, the pattern to follow is the same one that caught these two: never write "initiative complete" without running the repo-wide grep yourself and manually excluding every false positive first.

## Standing UI/UX review pass: dedicated `money` design-system token (2026-10-22)

Highest-value fix found this pass: the locked §2 design system names "Money figures - one dedicated
accent colour, used only for Rand amounts" as its own row, separate from the blue brand accent, but
that token was never actually added - every Rand figure in the app had been inconsistently reusing
whatever was at hand (`text-foreground` on the pricing cards, `text-accent` blue on the savings
counter card and calculator, `text-success` green inherited from its surrounding banner on the
submission-pack breakdown). Three different treatments for the same semantic concept, none of them
the dedicated color the spec actually calls for.

- **Added `--money`/`--money-foreground` to `globals.css`** (light + dark, registered in the
  `@theme inline` block as `text-money`/`bg-money` etc.) - a violet (`#7C3AED` light, `#A78BFA`
  dark), chosen deliberately outside every other semantic hue already in use (navy ink, blue
  accent, green success, amber warning, red destructive, blue info) so a Rand figure reads as its
  own category rather than borrowing a color that already means something else.
- **Applied consistently**: the pricing page's per-tier price (not the "Priced on request" custom
  tier - that's not a Rand amount), the Home cockpit's savings counter card (both the this-month and
  all-time Rand lines), the pricing-page savings calculator's "Rand saved a year" stat (renamed its
  `accent` prop to `money` for clarity), and the submission-pack "About X hours saved (R Y)"
  breakdown (wrapped just the Rand parenthetical, keeping the hours portion in the surrounding
  success-tint styling it already had).
- Updated the `money`-token gap note left in this file's own §9 savings-counter entry to point here
  rather than leaving it stale.
- **Found a second, duplicate instance of a spec violation already fixed once elsewhere**: while
  checking `/billing` (the real in-app subscription page) for its own Rand display, found it still
  said "The plan most companies start on" on the Professional card - the exact phrase spec §5
  explicitly forbids ("Never 'Most popular' or 'The plan most companies start on'"), already fixed
  on the public pricing page (`app/page.tsx`) in an earlier pass but missed here since that pass only
  touched the marketing homepage, not the real billing page users actually subscribe from. Fixed the
  same way: "For companies tendering regularly". Also applied `text-money` to `/billing`'s own
  monthly-price display, same fix as the marketing pricing cards. Grepped the rest of the repo for
  the same forbidden phrase afterward - the only other hit is a header comment in `lib/billing.ts`
  documenting Sarel's own verbatim pricing confirmation, not live copy, left alone.
- Verified `npm run verify` (clean), `npx vitest run` (100/100, no logic touched - this is styling
  only), full `node:test` sweep (all green). Screenshot at 1440px/390px: the pricing page (both the
  tier cards and the savings calculator) - reachable without a live Supabase session; `/billing`, the
  Home counter card and the submission-pack breakdown all need a signed-in session this environment's
  placeholder credentials can't provide, same documented limitation as every other signed-in-only
  surface.
- **Not touched this pass**: a broader sweep for every other Rand-amount display in the app (invoice-
  style line items, if any exist beyond the five surfaces checked here) - worth a follow-up pass if
  more turn up.

## Spec §6 (part 1): explicit trial terms, B-BBEE caveat placement (2026-10-22)

Small, high-confidence fixes from §6's own checklist - audited all four free-tool pages first; CIDB
and B-BBEE already had correct SA-format Rand display (`formatZar`/`formatThousands` helpers, a
pre-existing hydration-mismatch fix, not something this pass touched) and the intro paragraphs on
every tool were already short (1-2 sentences before the interactive card), so the only concrete
gaps were:

- **`app/signup/page.tsx`** had no trial-terms statement anywhere - replaced the generic subtitle
  with the spec's own exact wording: "14-day trial · no card needed · one full bid pack".
- **B-BBEE tool's buyer-specific-goal caveat was buried in the page footer**, well below the result
  box, the points table and the other-tools links - spec explicitly asks for it "next to the
  result". Added a short version directly under the result box; trimmed the footer's citation note
  (now just the regulation/gazette reference + "not legal advice") so the two don't duplicate the
  same point twice on one page.
- Checked the rest of §6's checklist against the live app: no "unlimited free tier" claim exists
  anywhere (confirmed by grep), and the Founding Firms "Get in touch" CTA was already fixed in an
  earlier pass (see that pass's own AGENTS.md entry) - left untouched.
- Verified `npm run verify` (clean), `npx vitest run` (100/100, no logic touched), screenshots at
  1440px of both changed pages (`/signup`, `/tools/bee-preference-points`) - both reachable without
  a live Supabase session.
- **Not covered by this pass - §6's biggest remaining item**: the no-signup interactive demo
  (sample company + sample tender, real capabilities with sample data) is a substantial net-new
  build, not a polish fix - tracked separately, built in part 2 below.

## Spec §11: failure states, mobile layout, accessibility audit (2026-10-22)

A systematic, 6-area audit against spec §11's own checklist, fixing only confirmed real gaps -
most of this app's failure-state handling turned out to already be correct, built carefully across
many earlier passes this session.

1. **Loading skeletons** - 20 routes already had a `loading.tsx` (confirmed by listing every one).
   6 genuine data-fetching routes were missing one: `/billing`, `/company`, `/company/team`,
   `/invite/[token]`, `/my-cv`, `/tenders/new` - all real server components reading live Supabase
   rows before rendering. Added skeletons for all six, reusing the exact existing kit
   (`components/tt/skeletons.tsx`'s `SectionCardSkeleton`/`TableRowsSkeleton`, `components/ui/
   skeleton.tsx`'s base `Skeleton`), shaped to roughly match each real page's layout, same
   convention as `dashboard/loading.tsx`. Deliberately NOT added to `/login`, `/signup`, `/forgot-
   password`, `/reset-password`, `/privacy`, `/design` (no server data fetch to skeleton) or `/tools/*`
   (pure client-side calculators, no fetch at all).
2. **Engine/AI failure states** - already correct. `general-workspace.tsx`'s extract-requirements
   and pack-generation flows, and `submission-pack.tsx`'s pack flow, all show a short
   `text-destructive` `error_message` line (never a raw stack trace) and keep the real generate/
   retry form available on a `failed` status (re-submits the same server action - a genuine retry,
   not a dead end). No fix needed.
3. **Unsupported-template messaging** - already correct. `general-workspace.tsx`'s "No SBD/MBD
   standard forms were found..." messages both end "(see below)", and what's below is real,
   substantive next-step content (`OcrNotice`'s per-document OCR detail, `manifest.gaps`'s "what
   Tender Ready can't do" list) - not a dead-end reference. No fix needed.
4. **390px: tables/sidebar/overflow** - checked every `<table>` in the app (`market-context.tsx`,
   `market-comparison.tsx`, `pipeline/pricing/page.tsx`, `pipeline/page.tsx`, the two free-tool
   reference tables) plus the sidebar. Confirmed live via Playwright at 390px on every page reachable
   without a session (`/`, `/tools`, `/tools/bee-preference-points`, `/tools/cidb-grade`, `/login`,
   `/signup`, `/privacy`): zero horizontal page overflow anywhere (`document.documentElement.
   scrollWidth` never exceeds `clientWidth`). Every table already sits inside an `overflow-x-auto`
   container, so none of them ever bleed past the viewport - the "no horizontal overflow" half of
   this requirement holds everywhere, not assumed. The separate "tables become cards" treatment is
   already done for the two highest-traffic, genuinely row-per-entity tables (`pipeline/page.tsx`'s
   list view and part of `pipeline/pricing/page.tsx`, both with their own 2026-10-21 "design-system
   audit fix" comments explaining exactly this). **Left as a flagged, not-fixed gap**:
   `market-context.tsx`'s `Register`/`SegmentTable` and `market-comparison.tsx`'s two tables are
   comparison/cross-tabulation matrices (dynamic per-tender column counts, nested sub-labels per
   cell) - converting these to a card layout is a real design call, not a mechanical fix (a card
   stack can make an at-a-glance comparison WORSE, not better), and they already satisfy the literal
   "no horizontal overflow" requirement via their scroll container. Flagging rather than forcing a
   risky structural change to these files, consistent with this pass's own scope discipline.
5. **Keyboard focus / touch targets / contrast** - already correct, checked rather than assumed.
   Every `outline-none` usage in the app (13 files, searched directly) pairs with a
   `focus-visible:ring-3 focus-visible:ring-ring/50` (or the `AvatarMenu`'s own `ring-2`) - no
   unguarded occurrence found anywhere. `min-h-11`/`h-11` (44px) is the pervasive touch-target
   convention already, confirmed by spot-check. `text-muted-foreground` on `bg-background`
   contrast-computed by hand (not assumed): 5.51:1; on `bg-card` (pure white): 6.01:1 - both clear
   WCAG AA passes (4.5:1 minimum).
6. **Difficult-case testing** - exercised live, not read from source: typed an invalid B-BBEE input
   (Pmin = 0) and confirmed the real instant, friendly `text-destructive` validation message
   renders with no crash and the visible keyboard focus ring showing on the active field.
   Expired-certificate/missing-document/unsupported-template/incomplete-pricing states all need a
   live Supabase session to exercise directly - read their handling code instead (covered under
   areas 2-3 above) rather than claiming they were exercised.

- Verified `npm run verify` (clean), `npx vitest run` (100/100, unchanged - no logic touched), full
  `node:test` sweep (all green). Screenshots at 390px confirm no overflow on every public route.
- **This pass is mechanical and additive only** (6 new skeleton files, no logic/behavior changes) -
  safe to merge once CI/Vercel are green, same trusted pattern as the color-migration batches.

## Spec §6 (part 2): no-signup interactive demo (2026-10-22)

Builds spec §6's biggest remaining item: "a clearly labelled sample company + sample tender...
real capabilities with sample data, not simulated success." New public route `/demo`, zero auth,
server-rendered.

- **Reused the SAME house demo identity, not a new invented customer**: "Mzansi Roads & Civils
  (Pty) Ltd" is already the one seeded, signed-in demo/trial company (`lib/demoCompany.ts`,
  `engine/seed_demo_company.py`, see "Demo company with realistic sample data" above) - its own N7
  Western Cape tender (SANRAL, Assessing & building, 3 key positions) is the scenario this public
  teaser is modelled on, so the name stays consistent whether a visitor is looking at the public
  no-signup page or (separately) signs into the real seeded account. No new fictional company
  invented.
- **Real components, hand-built sample data, not a mockup** - `lib/demoData.ts` is the one place
  invented values live (clearly a sample tender, never a real customer); every renderer around it
  is the real one:
  - `components/tt/requirement-row.tsx` (new): the quote/OCR-tag/status-chip pattern
    `general-workspace.tsx` renders inline for returnables, pulled into its own small component so
    the demo renders it through the real `ChipBadge`/`StatusChip`/`OCR_TAG` pieces rather than a
    separate "looks similar" block. **Not yet wired back into `general-workspace.tsx`'s own inline
    markup** - that file was only just stabilised by the color-migration pass, so full
    de-duplication is left for a follow-up rather than risked here; flagging this honestly rather
    than claiming the inline markup was replaced.
  - `cv-compare.tsx` split into the existing DB-touching `CvCompare` wrapper (zero behaviour
    change for the real tender workspace) and a new pure `CvCompareView` taking plain
    `{filename, href}`/`{pdfHref, docxHref}` props - the demo calls `CvCompareView` directly with
    sample file names and no download links ("Sample - download disabled in this demo").
  - `cover-page-preview.tsx` gained an optional `company` prop (default: its existing live
    `companies` read) - the one DB call in an otherwise pure-props component, now skippable with
    injected sample data; the real tender workspace is unaffected (prop omitted there).
  - `position-person-select.tsx` gained a `demo?: boolean` prop - "Confirm"/"Use"/the dropdown
    send a visitor to `/signup` instead of writing `tender_pack_assignments.confirmed_person_id`
    (no real `tenderPackId` exists behind a sample tender to write to).
  - The suggestion itself is **not hand-written** - `lib/demoData.ts` calls the real
    `suggestForPosition()`/`whySuggested()` with a crafted `CandidateScore[]`/`RoleTag[]`, so the
    "why" text and the ranking are the real logic's own output for this input, not invented prose.
  - "A caught missing/expired document" calls the real `expiryStatus()` with a past date
    (`"2026-08-15"`) - the "Expired" tone is the function's genuine output, not a hand-picked chip.
  - `PackChecklist` (already a pure, exported component, no changes needed) renders a hand-built
    `ChecklistRow[]` including one `not_included` row with a real reason ("Needs a director's
    signature - never guessed or auto-signed") - the homepage's own "Not included, and why" proof
    point, demonstrated for real.
- **Banner**: a persistent `bg-info/10` strip at the very top of the page ("Sample company and
  tender. Nothing below is a real customer...") - not a dismissible footnote, matching the spec's
  "clearly labelled" requirement; reuses the same `info` soft-tint token `DemoBanner` (the
  signed-in equivalent) already established, rather than inventing a new banner style.
- **Linked from the homepage** (spec §6.2: "link naturally into the product") - a third hero CTA,
  "See a sample tender", alongside the existing "Start free"/"Try a free tool first".
- Verified `npm run verify` (clean), `npx vitest run` (100/100, unchanged - no logic regressed),
  full `node:test` sweep (11 files, all green). **Screenshots at 1440px and 390px of the real,
  live `/demo` route** (not a temporary `/design` mock) - this is the one piece of the whole spec
  rollout that's finally fully screenshot-verified rather than "needs a live session", since it's
  genuinely public.
- **Not built this pass**: wiring `RequirementRow` back into `general-workspace.tsx`'s own inline
  markup (noted above); a monthly-rotating or multiple sample tenders (one scenario is enough to
  demonstrate every required capability per spec's own checklist).
- **Two small review-time fixes, caught while checking this PR before merge**: `position-person-
  select.tsx`'s demo-mode "Confirm"/"Use" used `window.location.href` (a real lint warning -
  `@next/next/no-location-assign-relative-destination` - not just a style nit, since a full page
  reload loses client-side router state) - switched to `useRouter().push()`. Separately,
  `cover-page-preview.tsx`'s own explanatory footer text (pre-existing in the authenticated app,
  not introduced by this pass) leaked two internal references into user-facing copy - "Sarel's own
  spec" and "see app/AGENTS.md for what that would take" - harmless when only signed-in users saw
  it, worse now that the exact same component renders on a public page with no auth. Trimmed the
  sentence to the honest, customer-facing part ("nothing here can be typed over yet") and dropped
  the internal detail; the fuller reasoning stays in the component's own code comment for whoever
  next touches it.

## Spec §10: analytics page (truthful only) - audit-first (2026-10-22)

New `/analytics` page (nav item added between Bids and SANRAL schedules). Per the spec's own
instruction ("only where reliable data exists... otherwise show an honest empty state, not sample
charts presented as real"), the real work here was a dimension-by-dimension audit BEFORE writing
any UI - every section below is annotated with what was actually found, not assumed:

1. **Own bid activity & outcomes** - real. `lib/pipeline.ts`'s five real stages
   (`found/bidding/submitted/won/lost`, migration 0021) aggregated into stage counts + win rate,
   same calculation `app/pipeline/page.tsx` already does, not duplicated logic.
2. **Upcoming deadlines** - real. Active-stage tenders (`found`/`bidding`/`submitted`) with a future
   `closing_date`, sorted soonest first.
3. **Win/loss trend over time** - real, and genuinely a TREND, not just a snapshot: `stage_changed_at`
   (already stored per pack, migration 0021) lets the won/lost moves be bucketed by month. New pure
   function `lib/analyticsLogic.ts`'s `buildWinLossTrend()` (6 unit tests in
   `lib/analyticsLogic.spec.ts`, same split as `lib/savingsCounter.ts`/`lib/readiness.ts` - no
   Supabase call inside it) deliberately keeps zero-decision months in the window rather than
   skipping straight to the next month with data, so a quiet stretch reads as quiet, not compressed.
4. **Submission values** - real. `tender_packs.submitted_price_zar` (already tracked for
   `/pipeline`'s own "Total value being bid" stat) aggregated into total + median across every
   tender with a recorded price.
5. **Briefing attendance** - real, but thin: `tender_tasks` rows with `kind = 'briefing'` (one task
   per tender, `status` either done or not) give a genuine "X of Y compulsory briefings confirmed
   attended" count - not a rich attendance log (no record of WHO attended, just whether the task was
   marked done), but a real, computed number, not invented.
6. **Pricing trends & competitor/market insights** - real, and far richer than expected: a whole
   already-built, tested market-pricing system (`lib/marketPricing.ts`, migrations 0053/0060/0062,
   `engine/discovery/award_outcomes.py` scraping public eTenders/SANRAL award data) backs this, not
   just `market-context.tsx`'s own per-tender view. Rolled up here across every tender this company
   has bid on (not per-tender like `market-context.tsx`): `loadOutcomesForTenders()` matches this
   company's own tenders against published award outcomes, `ownPosition()` places the company's own
   recorded price on each matched register, `firmsMet()` lists which other bidders the company has
   actually competed against (and how often each won), and `benchmark()` aggregates real
   scale-free stats (lowest-bid-won rate, bidder-count percentiles, contract-size percentiles) -
   gated by the module's own `MIN_SAMPLE` (5) so a company with too few matched outcomes gets the
   honest empty state instead of a benchmark built on 1-2 data points. This is the one section where
   skipping straight to the empty state would have been the WRONG call despite nothing like it
   existing on a dedicated page before - the underlying data was real and already built, just never
   surfaced outside a single tender's own workspace.
7. **Savings figures from §9** - reused directly (`fetchSavingsCounterSummary()` +
   `SavingsCounterCard`, no duplicated calculation), per the spec's own explicit instruction that
   these appear on analytics too.
- **Added a `money` tone to `components/tt/stat-card.tsx`** (`text-money`, the dedicated token from
  the earlier money-token pass) for the Rand-amount stats this page needed - the shared component
  didn't have one yet since nothing had asked for it on a `StatCard` specifically before.
- Verified `npm run verify` (clean), `npx vitest run` (106/106 - 100 existing + 6 new), full
  `node:test` sweep (11 files, all green). No screenshot - `/analytics` is signed-in only, needs a
  live Supabase session this environment's placeholder credentials can't provide, same documented
  limitation as every other authenticated-only page in this initiative.
- **Not built, deliberately**: a standalone "pricing trends over time" chart beyond what
  `loadMarketTrend()`/`market_trend_for_tags()` already computes (that RPC is itself segment-scoped
  to one discipline/value-band at a time, designed for the per-tender context, not a cross-tender
  rollup) - the company-wide benchmark above covers the spec's intent without duplicating that
  RPC's own honesty-gating logic in a new shape; a dedicated historical price-trend chart for the
  company's own most common discipline is a reasonable follow-up, not attempted here.

**One review-time fix, caught while checking this PR before merge, unrelated to the analytics build
itself**: `nav-items.ts`'s "SANRAL schedules" sidebar entry carried `badge: "Roads & Civils"`,
visible to every signed-in user in the main nav and its tooltip. Spec §5's positioning rules
explicitly forbid this exact phrase anywhere user-facing ("Never use the name 'Roads & Civils'") -
a different, earlier session's own AGENTS.md entry had already flagged "Roads & Civils" as a stale/
confused brief term with no real product meaning when it turned up in a pricing-tier context, but
this standing nav badge was missed. Removed rather than replaced with another invented segment
name - the item's own label, "SANRAL schedules", already says what the feature is.

## Whole-app reset spec (v3) - Batch 1: broken journeys

Two confirmed defects from the v3 audit's traceability register (O03, and an unlisted dev-only
build error), both frontend-only - no schema, pricing, SANRAL engine or access-control change.

1. **O03 - signed-in "Tools" left the app shell.** The sidebar's Tools item pointed at `/tools`,
   the public, signed-out lead-magnet catalogue (deliberately outside `AppShell` - see the "App
   shell" entry above) - so a signed-in user lost their nav, company context and return path for
   calculators they could otherwise use without leaving. Built `/toolkit` (`app/app/toolkit/`): an
   AppShell-wrapped index plus one route per calculator, each importing the SAME Client component
   the public page renders (`DeadlineCalculatorClient`, `CidbGradeClient`,
   `BeePreferencePointsClient`, `B6EstimatorClient`) with a new `embedded` prop. `embedded` only
   toggles the public chrome (`ToolsHeader`, `OtherTools`, the full-bleed page wrapper, the
   calculator's own `<h1>` since `PageHeader` now supplies it) - every input, calculation and
   result element is the identical JSX either way, so the two contexts can never compute different
   answers. The public `/tools/*` pages are untouched in behaviour (screenshot-diffed, still fully
   interactive). `nav-items.ts`'s Tools item now points at `/toolkit`; `isNavItemActive`'s existing
   prefix match needed no change. **Caught on first self-review round**: `/toolkit` built and
   worked, but was reachable unauthenticated - `proxy.ts` gates routes via BOTH an in-function
   `guarded` boolean AND a separate `config.matcher` array (Next only runs middleware on paths the
   matcher lists at all), and the first pass only added `/toolkit` to `guarded`. Fixed by adding
   `/toolkit/:path*` to `matcher` too; confirmed via curl that `/toolkit` now 307s to `/login` while
   `/tools` stays a public 200. Noted, not fixed (pre-existing, out of this batch's scope): `/billing`,
   `/analytics`, `/sanral-schedules` and `/market-intelligence` have the same unauthenticated-reachable
   gap already (none in `guarded`/`matcher`) - AppShell itself renders an empty-state shell for a null
   user rather than redirecting, so nothing sensitive leaks, but it's worth the same one-line fix in
   a dedicated pass.
2. **Dev-time Cache Components prerendering crash on every `loading.tsx` using `AppShell`.**
   `AppShell` is an async server component reading `cookies()` and making live Supabase calls (auth,
   notifications, subscription) - correct for a real page, wrong inside a loading boundary, which
   Next's Cache Components tries to prerender as static shell chrome. Reproduced across all 25
   `loading.tsx` files that imported it (`/pipeline`, `/company`, `/billing`, `/people`,
   `/experience`, `/tenders/new` and 19 more - a full repo grep, not just the 6 the audit happened
   to name). Root-caused, not suppressed: added `AppShellSkeleton` (new,
   `app/app/_components/AppShellSkeleton.tsx`) - a fully static, synchronous stand-in built from the
   SAME `Sidebar`/`SidebarContent`/`SidebarHeader`/`SidebarFooter`/`SidebarInset`/`SidebarProvider`
   primitives `AppShell` and `AppSidebar` use (so the `group-data-[collapsible=icon]` Tailwind
   selectors still resolve correctly without reimplementing the sidebar's own collapse behaviour),
   rendering chrome shape only - no auth, no cookies, no data. All 25 `loading.tsx` files now import
   `AppShellSkeleton` in place of `AppShell`; none changed their own skeleton content. New
   `/toolkit/*` routes got matching `loading.tsx` files from the start, same convention.
   Verified by `npm run build` (Turbopack): every `◐` Partial Prerender route - the exact ones that
   previously threw - now compiles clean with no prerender error.

**Tested**: `npm run verify` (0 errors, same 3 pre-existing unrelated warnings), `npx vitest run`
(115/115), full `node:test` sweep (67/67), `npm run build` (all 56 routes compile, no prerender
errors), Playwright screenshots at 1440px/390px of the public `/tools` index and all four rewritten
public tool pages (pixel- and function-identical to before - the deadline calculator still computes
a real result, the CIDB/B-BBEE/B6 tools still render their tables and verdicts), plus curl checks
confirming `/toolkit` redirects unauthenticated visitors to `/login` while `/tools` stays public.
**Not tested, and reported rather than faked**: a live signed-in walkthrough of `/toolkit` itself
with the seeded demo company - this environment's credential-generation tools (magic-link/Admin API
sign-in) are blocked by the session's own safety classifier, and the demo account's real password
isn't committed anywhere this session can read. The embedded calculators render through the exact
same component tree Playwright already exercised live on the public pages, and the route-protection
behaviour (middleware redirect) was verified directly - but nobody has actually seen `/toolkit`
rendered inside a real authenticated `AppShell` yet. Three full self-review rounds ran before this
was merged (middleware matcher gap found and fixed in round 1; `Sidebar` `group` context and
duplicate-`<h1>` a11y check in round 2; nav active-state and dead-reference sweep in round 3) - none
surfaced a reason to believe the signed-in render itself is broken, but that's inference from a
clean build and an identical component tree, not a screenshot of the real thing.

### Hotfix: closed the middleware auth gap Batch 1 flagged but didn't fix

The gap noted above as "out of scope" turned out to matter more than a one-line nice-to-have:
`proxy.ts`'s `guarded` check and its `config.matcher` array never listed `/billing`, `/analytics`,
`/sanral-schedules` or `/market-intelligence` at all, so middleware never ran for them - no redirect,
not even an attempt. Each page itself has no independent auth check (`billing/page.tsx` reads
`user?.id ?? ""` and just gets an empty membership back; the other three have no `auth.getUser()`
call whatsoever), so a signed-out visitor got the full `AppShell` page render, not a 404 or a blank
screen. `market-intelligence/page.tsx`'s own top-of-file comment records that this page was only
approved to exist on the condition it's "shown only to signed-in, paying customers... never resold
to or built for non-bidders" (tied to SANRAL's own data-reuse terms,
`docs/specs/Award-Outcomes-Findings.md` §6) - an unauthenticated visitor loading it violated that
condition directly, not just a UX nicety.

Fixed by adding all four to both `guarded` and `matcher`, same pattern as every other protected
route. This is access-restoring, not access-widening (the repo's own ground rule only forbids the
latter without approval), so it went out as its own small PR rather than folding into Batch 1's.

**Tested**: `npm run verify` (0 errors), `npx vitest run` (115/115), full `node:test` sweep (67/67),
curl against a live dev server confirming all four now 307-redirect an unauthenticated request to
`/login` while `/tools` and `/demo` stay public 200s, and that Batch 1's `/toolkit` still redirects
correctly after the rebase. Three review rounds: round 1 confirmed no other allowlist/auth-gate
mechanism exists elsewhere in the app that duplicates or conflicts with `proxy.ts`'s; round 2 and 3
confirmed the new `/billing` matcher entry (`/billing/:path*`) does not and cannot match
`/api/billing/checkout` or `/api/billing/payfast/itn` (different path prefix entirely -
`/api/billing/...` does not start with `/billing`), so the PayFast checkout flow and webhook are
untouched.

### Spec v3 Batch 2: shared document intake foundation

Batch 0's audit found the engine spec §4/§17 asks for already exists and works correctly - the
bulk AI document-scan pipeline (`/company/document-scan`, migration 0063: upload -> OCR/AI
classification -> a review-and-confirm screen that never silently overwrites a verified field -
only a ticked field is written). The real gap was that 12+ other upload sites each had their own
separate, dumber `<input type="file">` with no classification or review step at all - Company
vault's own 7-row `DocumentRow.tsx` being the clearest example: choosing a file there wrote
straight to the matching `companies.*` column with zero review, the exact "silent overwrite" §4/§17
forbids.

This batch did NOT rebuild the extraction engine - it extracted the GENERIC parts of
`document-scan/upload-form.tsx` into two shared, reusable pieces, then wired exactly one additional
real surface through the existing engine, per the spec's own "demonstrate one full real
extraction/save/readback before propagating it everywhere" instruction (Batch 4 does the rest:
People, Experience).

- **New `app/app/_components/document-intake/uploadBatch.ts`** - the per-file upload engine,
  extracted with one real behaviour fix: the original `uploadAll()` rolled back and discarded
  every ALREADY-SUCCEEDED file in a batch the moment any ONE file failed, then aborted the whole
  batch with a single generic error - directly against spec v3 §17's "a failed file must not
  discard successfully received files." Rewritten so each file's outcome
  (`queued`/`uploading`/`uploaded`/`failed`) is independent; a sibling's failure never touches
  another file's state. Pure reducer functions (`markUploading`, `applyUploadResult`,
  `partitionBatch`) are unit-tested directly (`uploadBatch.test.ts`, 5 tests) without needing a
  DOM or a real Supabase call - same pattern as `onboardingScan.test.ts`.
- **New `app/app/_components/document-intake/FileDropzone.tsx`** - the generic drag-drop +
  click-to-choose UI (spec v3 O12: "one 'Add documents' control... Drag-and-drop is equally
  supported"), with a `compact` mode for a single row inside a longer list (Company vault) versus
  the full dashed panel for a dedicated upload page (document-scan). `validateFiles()` is the pure
  extension/size/empty-file check, also unit-testable without rendering anything.
- **`document-scan/upload-form.tsx`** now composes these two pieces instead of its own copy.
  One deliberate behaviour change beyond the bug fix: registering a batch for AI classification is
  no longer its own manual "Upload N documents" click - it happens automatically the moment every
  file in that drop finishes uploading (spec v3 §17: "Starting upload after selection is
  automatic"). The only button left in this component is the failed-file retry action.
- **New `app/app/company/_components/VaultDocumentUploader.tsx`** - the new path for 6 of
  `DocumentRow.tsx`'s 7 rows (`cidb`, `sars_tcs_pin`, `pi_insurance`, `iso_9001`, `bank_letter`,
  `bee_proof`). Upload -> real AI classification (same engine, same `registerOnboardingBatch`
  action, unchanged) -> the existing `/company/document-scan` review screen, where only a ticked
  field is written (that gating logic - `confirmVaultDocument` in `document-scan/actions.ts` - was
  already correct and needed no change; the fix was routing DocumentRow's upload through it at
  all). `coid` (COID Letter of Good Standing) deliberately keeps the old direct-upload form,
  unchanged: it has no entry anywhere in `onboardingScan.ts`'s `DocumentKind` enum or
  `classify_documents.py`'s own kind list, and adding one means teaching the Python classifier a
  new kind plus a new `document_kind` check-constraint value (migration 0063) - a schema/engine
  change this batch's ground rules leave for a separate, explicitly-approved pass, not something to
  fold in quietly. New `lib/vaultDocuments.ts` export `VAULT_KIND_TO_DOCUMENT_KIND` records exactly
  which 6 are mapped, with its own tests (`vaultDocuments.test.ts`, 4 tests) pinning that `coid` is
  deliberately absent and that nothing is silently unmapped.
- **Byproduct, not the batch's goal**: the 6 upgraded rows can now accept up to 25 MB per file
  (document-scan's own limit) instead of the old 4.4 MB `uploadVaultDocument` cap - that cap only
  existed because a Server Action's request body is capped at 4.5 MB on Vercel, and these rows no
  longer go through a Server Action for the file itself (straight-to-Storage from the browser, same
  as document-scan). `coid` is unchanged and stays at 4.4 MB. Found and fixed in self-review round
  2: the section's own shared caption still claimed a blanket "4.4 MB each" for all 7 rows after
  this change, which was now wrong for 6 of them.

**Self-review (3 rounds)**: round 1 confirmed every existing `onboardingScan.test.ts` /
`document-scan` behaviour is unchanged (19 pre-existing tests still pass, `confirmVaultDocument`
and the whole classify/review/confirm chain untouched) and added 9 new tests for the two new pieces;
confirmed `DocumentRow.tsx` has exactly one real consumer (`ComplianceDocumentsSection.tsx` - a
grep hit in `properties/page.tsx` turned out to be an unrelated type also named
`PropertyDocumentRow`, not this component). Round 2 caught the stale 4.4 MB caption above. Round 3
re-ran the full `npm run verify` + `vitest` + `node:test` suite clean after the fix.

**Not tested, reported rather than faked**: same limitation as Batch 1 - this sandbox's
credential-generation tools (Admin API magic-link sign-in) are blocked by its own safety
classifier, and the demo account's real password isn't committed anywhere this session can read, so
nobody has actually seen `VaultDocumentUploader` or the updated `upload-form.tsx` rendered and
clicked inside a real authenticated session. What WAS verified live: both touched routes
(`/company`, `/company/document-scan`) compile and correctly 307-redirect a signed-out request to
`/login` with no console error (`npm run build`'s own route table shows both compiling as Partial
Prerender routes with no prerender failure), and a standalone `react-dom/server` static render of
`FileDropzone` in both its full and `compact` modes produces the expected markup with no runtime
error - real evidence the component tree itself is sound, short of an actual click-through.

### Spec v3 Batch 3: onboarding collapsed from a 6-step wizard to 2 screens

Onboarding used to be `WizardShell` + `Step1.tsx` through `Step6.tsx`, each a full page with its own
"Step N of 6", a Continue button chaining to the next step, and a "Skip for now" link - company
basics, then compliance fields (CSD/SARS/B-BBEE/savings baseline), then one office location, then up
to 3 people + CVs, then a notification preference, then plan selection, then a "done" bid-readiness
screen. Every step past the first was individually skippable, but the sheer length (spec v3 O09) and
the fact that none of it had a document-upload step at all (O13) were real, confirmed problems from
the Batch 0 audit.

**What actually changed**: `Step2.tsx`-`Step6.tsx` and their five actions (`saveComplianceStep`,
`saveOfficeStep`, `addPersonStep`, `uploadPersonCvStep`, `saveNotificationStep`) are deleted, not
rebuilt elsewhere - every field they captured already has a real, permanent, non-onboarding home:
compliance/CSD/B-BBEE/savings baseline in Company vault (`CompanyIdentitySection.tsx`,
`BeeCidbSection.tsx`, `ComplianceDocumentsSection.tsx`, `SavingsBaselineSection.tsx` - confirmed by
grep before deleting anything), office location (`app/company/officeActions.ts`), people/CVs
(`app/people/actions.ts`), the daily digest toggle (`app/company/Notifications.tsx`), and plan
selection (Billing, reachable any time - the trial already starts automatically on company creation
via the `companies_start_trial` trigger, migration 0078). None of that data-capture needed
rebuilding; it only needed to stop being a forced sequential gate before Home. New
`AddDocumentsScreen.tsx` is Screen 2 - it reuses `UploadForm` (spec v3 Batch 2, `#103`) completely
unchanged, so "drop a file -> upload -> auto-classify -> review" is identical to `/company/
document-scan`'s own flow, not a second implementation. `WizardShell.tsx` dropped to 2 titles
("Your company", "Add documents") and lost its generic Back/Skip link logic, since neither of the
two real screens needs it the same way the old 6 did (Screen 1 has nothing to go back to; Screen 2's
skip is its own explicit "Skip for now, I'll add documents later" link straight to `/dashboard`, not
a generic "advance to next step"). `onboarding/page.tsx` now has exactly two branches: no membership
-> Screen 1; `?step=2` -> Screen 2; everything else (no param, a stale `step=3..6`/`step=done` link,
anything else) -> `redirect("/dashboard")`. No schema change was needed or made - "has a
`company_members` row" already meant "Screen 1 done" before this batch and still does; Screen 2 has
no persisted "seen it" state at all, which is deliberate (per the spec's own boundary: don't add a
column to solve this when behaving as "redirect to Home, whose own checklist already prompts for
missing documents" is both simpler and already correct).

**Real bugs this surfaced, not invented**: three call sites pointed at the step URLs being deleted,
and would have otherwise silently regressed into dead loops (clicking them would land on `/onboarding`
with a stale step number, which now redirects straight back to `/dashboard` - doing nothing).
`lib/readiness.ts`'s `company_basics`/`csd`/`tax_compliance`/`bee`/`people_cvs` criteria all had
`href: "/onboarding?step=N"` fix-it links; repointed to their real Company vault/`/people`
destinations (`/company#company-identity`, `/company#bee-cidb`, `/company#compliance-documents`,
`/people`). `dashboard/page.tsx`'s `setupChecklistItems` had the same three as fallback hrefs plus
one hardcoded `/onboarding?step=4` for "add a CV" - same fix. `components/tt/bid-readiness-card.tsx`'s
compact variant (used in Company vault's header) linked to `/onboarding?step=done` as its "see the
full breakdown" action; repointed to `/dashboard`, where the large variant with the full blockers
list actually lives. None of these three were found by writing a new test - they were found in round
2 self-review by grepping every `onboarding?step` reference across the repo after making the
deletions, specifically because a UX simplification that quietly breaks three "fix this" links would
be worse than the problem it solved.

**Tested**: `npm run verify` 0 errors (same 3 pre-existing unrelated warnings), `npx vitest run`
115/115 (no new tests needed - this batch is routing/composition, not new pure logic;
`lib/readiness.spec.ts`'s existing 6 tests don't assert on href values and still pass unchanged),
full `node:test` sweep 76/76. Live dev server + curl: `/onboarding`, `/onboarding?step=2`, and
`/dashboard` all still correctly 307-redirect an unauthenticated request to `/login` (middleware
untouched). A standalone `react-dom/server` static render confirms `Step1` renders correctly
standalone ("Your company", "Step 1 of 2" both present in the output);
`AddDocumentsScreen` could not be rendered the same way, because it embeds `UploadForm` (a client
component that calls `useRouter()`, which throws outside a real Next.js App Router context) - this
is a limitation of the crude standalone-render harness, not evidence of a problem: `npm run build`
itself already compiled `/onboarding` as a working dynamic route with no React Server Component
boundary error, which is the real proof this composition is valid.

**Not tested, reported rather than faked**: same sandbox limitation as every batch tonight - no way
to generate real sign-in credentials here, so nobody has actually clicked through Screen 1 ->
Screen 2 -> upload/skip -> Home as a real user. This is a significant UX restructuring of something
that previously worked end-to-end; the structural checks above (build success, middleware behavior,
every stale link found and fixed, existing tests still green) are real evidence, but they are not the
same as watching a real signed-in walkthrough.

## Spec v3 Batch 4: Experience's shared intake + ECSA/SACPCMP no longer universal (O23, O24)

Two independent pieces - see the PR for why they aren't split in two, if they are.

### Part A: Experience leads with upload through the existing engine

Confirmed before writing anything: the AI extraction spec v3 §8/§17 wants for reference letters
already exists and already works - `experience_reference_letter` has been a real `DOCUMENT_KINDS`
entry with its own field set (`onboardingScan.ts`) and its own confirm action
(`confirmExperienceReferenceLetter`, `company/document-scan/actions.ts`, files straight into
`experience_items`) since migration 0063. The gap the audit found was real but narrower than it
looked: `/experience`'s own "Add experience" form never offered a path INTO that engine - it had its
own separate upload, with zero extraction, always.

Fixed by giving `/experience` a real entry point into the SAME engine, not a second one:
- `UploadForm` (`company/document-scan/upload-form.tsx`) gained three optional props -
  `redirectTo`, `title`, `hint` - all defaulting to its exact previous hardcoded values, so its one
  existing caller (`company/document-scan/page.tsx`) and Batch 3's `AddDocumentsScreen` are
  byte-identical in behaviour. Experience passes `redirectTo="/experience?uploaded=1"` so the user
  never leaves the page.
- `DocumentReviewCard` (`company/document-scan/review.tsx`) gained an optional `returnTo` prop; when
  set, a hidden `return_to` field rides along with every one of its forms (confirm/skip/discard).
- `confirmExperienceReferenceLetter`, `confirmVaultDocument`, `confirmIdDocument`, `confirmCvHandoff`,
  `skipOnboardingDocument`, `discardOnboardingDocument` (`company/document-scan/actions.ts`) all now
  read that optional `return_to` via a new `backTo()` helper and redirect there instead of the
  hardcoded `/company/document-scan`, falling back to the old constant when it's absent - every
  existing caller (Company vault's own document-scan page) omits it, so their behaviour is
  unchanged. `backTo()` only honours a same-origin relative path (`startsWith("/")`, rejects
  `//host` protocol-relative forms) - this is user-supplied form data landing in a `redirect()` call,
  so it gets the same open-redirect guard any such value needs.
- `/experience/page.tsx` now queries its own `company_id` via the real `company_members` lookup
  every other signed-in page uses (it used to read `all[0]?.company_id` from the experience list
  itself - null for exactly the brand-new company with nothing in the Library yet, the one case this
  feature matters most for), lists its own `onboarding_document_results` pending rows filtered to
  `document_kind = 'experience_reference_letter'`, and renders them with the same
  `DocumentReviewCard` Company vault's document-scan page uses - `returnTo="/experience"`, `principals`/
  `people` passed as `[]` since this kind's render path never reads them. The pre-existing manual
  "Add experience" form stays, relabelled "Enter a project manually" - the explicit secondary
  alternative spec §8 asks for, not removed.

**Known, inherited limitations - not introduced by this batch, not silently claimed fixed**:
`confirmExperienceReferenceLetter` always INSERTS a new `experience_items` row; it has no "does this
project already exist, is this an update" conflict-detection, and it never splits one uploaded
document into several proposed projects even when the letter plausibly describes more than one.
Spec §8/§17 asks for both. Building either is new engine capability (deciding whether this and an
existing row are "the same project", or segmenting one PDF into N proposed records), not a UI wiring
job - exactly the kind of thing this batch's own instructions said not to invent from scratch.
Flagging it here rather than claiming full compliance.

### Part B: ECSA/SACPCMP stop being the universal category (O23)

**No schema change needed or made** - checked first, as instructed. The company-level
`registration_types`/`held_registrations` catalog (0050) already supports a `person_id`
(`loadHeldCatalogRegistrations` already queries it by person), and five bodies (SACAP, SACPLAN,
SACQSP, SACPVP, PSIRA) already use it person-scoped with zero changes needed. ECSA and SACPCMP
already have their own dedicated `people` columns (`ecsa_*`/`sacpcmp_*`, migration 0035) - exactly
the same shape SACNASP/SAGC already use successfully as "conditional" bodies. The actual gap: ECSA
and SACPCMP were the only two bodies in the whole registrations system that were NEVER conditional -
`/people/[id]/page.tsx` rendered their 6 fields unconditionally on every person, and `/people/page.tsx`
put a warning chip ("No ECSA on file") on every person lacking one, in both cases regardless of
whether the company does engineering work or any tender asks for it at all. That's the literal "ECSA
as the universal category" the spec names.

**Deliberately did NOT touch** `CONDITIONAL_BODIES`/`ConditionalBody`/`bodyKeys()`/`isColumnBody()`
(`lib/personCredentials.ts`) or anything importing them for compliance purposes
(`lib/tenderCompliance.ts`, `lib/generalTender.ts`, `tenders/[id]/compliance-data.ts`,
`tenders/[id]/general-workspace.tsx`) - `bodyKeys()`'s `${k}_category` pattern doesn't hold for ECSA
(`ecsa_level`, not `ecsa_category`) or SACPCMP (no category field at all), so forcing them into that
exact mechanism would have broken it for both; more importantly, those four files are compliance-
/readiness-adjacent, and the ground rule for every batch tonight is not to touch tender-assessment
surface without Sarel's own review, schema change or not. Scoped down to a change that provably
cannot affect them:
- `/people/[id]/page.tsx`: ECSA/SACPCMP's 6 fields now render inside the exact same `<details>`
  disclosure pattern SACNASP/SAGC already use, shown by default only when `expiryByBody` already has
  an `ECSA`/`SACPCMP` entry (i.e. `credentialExpiries()` - existing, unchanged - found the person
  already holds one or has an expiry on file). A collapsed `<details>` still submits its fields
  normally on save (confirmed: HTML form fields inside a closed `<details>` are NOT excluded from
  `FormData`, only visually hidden) - `savePerson` needed no changes.
  Section heading renamed "Registrations" -> "Memberships and professional registrations".
- `/people/page.tsx`: dropped the unconditional "No ECSA on file" warning chip entirely - the
  positive "ECSA: <level>" chip (shown only when actually held) already existed and is unchanged.
- **Deliberately NOT done**: wiring ECSA into `registrationsAskedFor()`/`AskedFor` the way
  SACNASP/SAGC/catalog bodies are (so a SANRAL tender asking for a Professional Engineer would
  auto-reveal the disclosure). That needs a new "does this position need ECSA" signal on the tender
  side - compliance-adjacent surface, out of this batch's safe scope. Today, ECSA/SACPCMP show
  automatically only when already held; a user adding a brand-new engineer must open the disclosure
  themselves. Noted as a real, smaller follow-up, not silently solved.

**Tested**: `npm run verify` 0 errors (same 3 pre-existing unrelated warnings), `npx vitest run`
115/115, full `node:test` sweep 76/76 (no count change - this batch is composition/conditional
rendering, no new pure-function logic to unit test). Live dev server + curl: `/experience`,
`/people/[id]`, `/company/document-scan` all still correctly 307-redirect an unauthenticated request
to `/login` (middleware untouched by this batch). Confirmed via grep that every existing caller of
`UploadForm`/`DocumentReviewCard` (`company/document-scan/page.tsx`, Batch 3's `AddDocumentsScreen`)
omits every new optional prop, so their behaviour is provably unchanged, not just assumed so.

**Not tested, reported rather than faked**: same sandbox credential-generation limitation as every
batch tonight - nobody has actually uploaded a real reference letter through `/experience` or toggled
the ECSA disclosure in a real browser session. The build compiling `/experience` and `/people/[id]`
as working dynamic routes, the existing test suites staying green, and the explicit non-regression
check above are real evidence; they are not the same as a real signed-in click-through.

### Spec v3 Batch 5: tender workspace layout (`/tenders/[id]`, 12,755px single scroll)

Batch 0's audit measured `/tenders/[id]` at 12,755px tall, one unbroken scroll - the underlying
compliance/pricing/readiness logic is correct (confirmed again here: every pre-existing
`*-logic.test.ts`/`*.spec.ts` under this directory passes unchanged, byte-for-byte), the problem is
purely that every section - "report card" ready or not, blocker or pure history - renders fully
expanded, every time, with no structure beyond a sticky jump-nav row of anchor links.

**What changed** (`page.tsx` only - `compliance-report.tsx`, `general-workspace.tsx`,
`submission-pack.tsx`, `pack-review.tsx` and every `*-logic.ts` file are untouched, so both the
SANRAL and general workflows' own actual content is identical to before):

- New `collapsible-section.tsx`: a plain `<details>/<summary>` wrapper, no client JS, no persisted
  state (the `open` prop is per-page-load only - deliberately not written anywhere, so this stays
  presentation-only with no schema change, per this batch's own ground rule).
- **Persistent header** (spec §16.E: "tender title/reference, client, deadline... blockers... Do not
  bury blockers in a hidden tab"): a slim row added above the existing sticky jump-nav, in the same
  `position: sticky` wrapper so both scroll together - title/contract number, countdown, and the
  confirmed/review/provide/overdue/open-positions counts the facts card below already computes
  (`confirmedRows`/`reviewRows`/`missingRows`/`overdueTaskCount`/`openPositionsCount` - the last one
  hoisted out of an inline IIFE that used to compute it only for one badge, now reused in two
  places). No new data read - same values, now also visible while scrolled past the facts card.
- **Key positions**: collapses to a one-line "All N confirmed" summary only when
  `openPositionsCount === 0` - an unconfirmed position still renders its red "Fix: no key person
  confirmed - blocks the submission pack" badge exactly as before and keeps the section fully open,
  since that's a real blocker, never buried.
- **Readiness report** (the Verify/Provide grid): collapses to "All confirmed" only when both
  `missingRows` and `reviewRows` are empty - any real Provide/Verify work keeps it open exactly as
  before.
- **Deliberately NOT collapsed**: `MarketContext` and `ActivityLog` - both already render their own
  `id="market"`/`id="activity"` anchor div internally (for the jump-nav's existing `#market`/
  `#activity` links). Wrapping them in another `<details>` would mean either a duplicate `id` (two
  elements sharing one id - invalid HTML) or editing those two components to accept an "embedded,
  skip your own id" prop - a reasonable future change, but out of this batch's time/risk budget
  tonight; noted here as a real, smaller follow-up rather than silently left undocumented.

**Before/after page height**: NOT independently measured against a real populated tender - the same
sandbox credential-generation limitation every batch tonight has hit (no way to sign in as the
seeded demo company here) applies to Playwright/`scrollHeight` measurement too, so reporting a
specific before/after number would be fabricated precision. What IS verifiable: the two sections
collapsed by default when complete (Key positions, Readiness report) are exactly the two
`id="..."` targets the audit's own jump-nav row links to, and each can run to several hundred to
well over a thousand pixels on a mature/near-ready tender (Key positions renders one ~150-250px row
per position; the Readiness grid's "Verify" card lists every confirmed field). Collapsing both to a
single summary line each, on a tender that's actually ready to submit (the exact state where
scrolling through confirmed-already content is pure waste), is a real, structural reduction - just
not a number honestly claimed without having seen it render.

**Tested**: `npm run verify` 0 errors (same 3 pre-existing unrelated warnings), `npm run build`
compiles `/tenders/[id]` clean, `npx vitest run` 115/115 and full `node:test` 76/76 - every
pre-existing tender/compliance/pricing/readiness test passes unchanged, confirming no calculation
was touched. Live dev server + curl: `/tenders/new` still correctly 307-redirects an unauthenticated
request to `/login` (middleware untouched); public routes unaffected.

**Not tested, reported rather than faked**: an actual signed-in render of `/tenders/[id]` itself -
same sandbox limitation as every batch tonight. The collapsing logic (`openPositionsCount === 0`,
`missingRows.length === 0 && reviewRows.length === 0`) was verified by reading the exact same
variables the pre-existing, already-tested facts-card summary chips use - not a new computation -
but nobody has seen the collapsed/expanded states actually render against real data.

## Spec v3 Batch 6: savings/founding-rate/digest truthfulness

Four items from the spec's own Batch 6 scope (§18/§19/§16.K), each closed with a different outcome -
fixed, already correct, or a documented gap, not all silently claimed as "done":

1. **Savings default labeling (§18, Sarel's own 2026-10-22 answer)** - fixed, and a real bug found
   along the way. `fetchSavingsCounterSummary()` (the Home/Analytics card) used to read
   `savings_baseline_hours_per_tender`/`_hourly_cost_zar` straight off the `companies` row with no
   fallback at all - an unconfirmed baseline (`null`) was cast straight to `number`, and
   `hoursSavedForTender`'s own `Math.max(0, null)` guard silently resolved to a 0-hour cap, so a
   company that had done real counted work but never visited the baseline field saw "0h / R0
   saved", not even the documented 20h/R450 placeholder. Meanwhile `fetchTenderSavingsBreakdown()`
   (the per-tender "how we worked this out" panel) had its OWN separate `?? 20`/`?? 450`, with no
   way for the UI to tell confirmed and default apart, and no way for the two surfaces to agree on
   which case they were even in.
   Fixed with one new pure function, `resolveBaseline()` (`lib/savingsCounter.ts`, 6 new
   `.spec.ts` tests), that both call sites now use instead of their own separate handling. Returns
   `{ hoursPerTender, hourlyCostZar, isDefault }` - `isDefault` true unless BOTH values are
   confirmed (a confirmed `0` is accepted as real, not treated as missing - `== null`, not falsy).
   Both `SavingsCounterSummary` and `fetchTenderSavingsBreakdown()`'s return type gained a
   `usingDefaultBaseline` field; `savings-counter-card.tsx` and `submission-pack.tsx`'s "How we
   worked this out" panel now show two genuinely different sentences depending on which case
   applies - "Using a default estimate (20h/R450 per tender) - we don't have your own numbers yet"
   vs. "Estimated from your own confirmed baseline." The calculation itself (`hoursSavedForTender`/
   `aggregateSavings`/`extraCapacity`) is untouched - confirmed by every pre-existing test in
   `savingsCounter.spec.ts` still passing unmodified.

2. **Founding-rate homepage claim** - fixed. `app/page.tsx`'s Founding Firms Programme paragraph
   used to promise "the first 10 firms... a locked founding rate" - a hard count and a rate
   commitment with no mechanism anywhere in this app to track or honour either (confirmed again
   this pass: no founding-firm intake table, no per-customer locked-price flag). Reworded to keep
   the founding-customer framing (true: an early customer gets more of Sarel's own direct attention
   right now than one joining later will) without the count or the rate promise - "Early customers
   get more of our attention while we build out the rest." The CTA itself was already fixed in an
   earlier pass (links to plain `/signup`, labeled "Get in touch", not "Apply as a founding firm").

3. **Analytics vs. Home consistency (§16.K)** - checked, already correct, nothing to fix. Both
   `dashboard/page.tsx` and `analytics/page.tsx` call the exact same `fetchSavingsCounterSummary()`
   and render the result through the exact same `SavingsCounterCard` - they cannot drift because
   they're not two implementations of the same number, they're one. Checked the rest of each
   page's own stats for an overlapping metric name that could visibly contradict itself (Home:
   "Active bids"/"Packs ready"/"Closing this week"/"Documents expiring"; Analytics: "Submitted to
   date"/"Total submitted value"/win-loss trend) - no shared metric besides savings exists on both
   pages at all, so there's no second divergence risk to fix.

4. **Email audit (§19)** - the TypeScript side (`lib/emailTemplates.ts`: welcome + deadline-reminder
   emails) was already correct - "Tender Ready" identity throughout, real per-item deep links
   (`/tenders/${tenderId}`), no old branding found. The daily digest is NOT sent from TypeScript at
   all, though - it's `engine/notify/send_digest_emails.py` (Python, triggered by
   `.github/workflows/daily-digest.yml`), confirmed via its own module docstring and
   `daily_digest.py`'s doc comment. Checked the CURRENT file rather than assuming the spec's cited
   "known uploaded-snapshot issue" was already fixed - it was not:
   - **Old "Tender Tool" branding**: present live in `DEFAULT_FROM`, the subject line, and the
     body greeting (3 occurrences). Fixed to "Tender Ready" in all three.
   - **Dropped dates**: `render_text()` showed only each item's title/description, no date at all.
     Fixed with a new `_item_date()` helper checking every date key this script's sections are
     CONFIRMED to use (traced key-by-key in `watch_deadlines.py`/`daily_digest.py`'s own
     dict-building code): `closing_date` (new_tenders/submission_due), `expiry_date`
     (document_expiry, both "document" and "person_credential" item types), `due_date`
     (tender_tasks), `updated_at` (readiness_changes). Verified against a REAL generated fixture
     (ran `test_digest_live.py`, fed its own written `digest.json` into
     `send_digest_emails.py --dry-run`), not just a hand-written example - caught and fixed a real
     miss this way (`expiry_date` wasn't in the first version of the key list, confirmed by
     tracing `find_due_documents()`'s actual dict shape, not guessed).
   - **Dropped links**: fixed with one link at the end of every digest email -
     `{APP_URL}/dashboard`, reusing the exact same `APP_URL` env var name/fallback
     `scripts/send-deadline-reminders.ts` already established, rather than inventing a second
     convention.
   - **Honest, documented gap, not silently left as "done"**: per-item deep links (spec's own "one
     primary action to the exact signed-in item") were NOT built for each of the 8 section types'
     own different destinations (`new_tenders` -> Discovery, `tender_tasks` -> a specific tender,
     `listing_changes`/`tender_updates`/`reassessed_tenders` -> unverified routes). Doing that
     correctly needs each section's actual item shape and real route individually confirmed, which
     is its own piece of work, not something to guess at under tonight's time budget and risk a
     wrong/broken link going out in a real customer email. One safe generic dashboard link now,
     real per-item links as a flagged follow-up.
   - Digest opt-in/opt-out (`set_my_daily_digest_opt_in`, `app/company/digestActions.ts`) and
     no-duplicate-send guarantees (`daily_digest.py`'s own seen-store) were already correct and
     untouched - confirmed by reading, not re-verified with new tests, since this batch didn't
     touch that code.

Python side has no automated test for `send_digest_emails.py` itself (confirmed: neither
`test_digest_live.py` nor `test_digest_opt_in.py` imports it - its own docstring calls itself "the
missing send step" the rest of this test suite predates). Verified instead by: `python3 -m
py_compile` (syntax), a smoke test against a hand-built digest dict, and the real fixture run above.
Both pre-existing Python test files (`test_digest_live.py`, `test_digest_opt_in.py`) still pass
unchanged (0 failures each) - confirms nothing this batch touched broke the digest-building logic
upstream of the sender.

**Tested (TypeScript)**: `npm run verify` 0 errors, `npx vitest run` 121/121 (115 pre-existing + 6
new `resolveBaseline` tests), full `node:test` sweep 76/76 unchanged - run both ways (`tsx --test`
and the real CI invocation, `node --experimental-strip-types` per file directly). Live dev server +
curl against the real homepage confirmed the new founding-rate copy renders and the old "first 10
firms"/"locked founding rate" text is gone.

**Not tested**: an actual signed-in render of the savings card's two different messages (same
sandbox credential limitation as every batch tonight) - verified instead by reading
`resolveBaseline()`'s own unit tests and the component's conditional, not a screenshot of both
states.

### Spec v3 Batch 7: final public-page polish + whole-rollout status note

Last batch of tonight's run. Scope held to what's actually verifiable without a signed-in
session - every public, no-auth route - rather than guessing at signed-in pages this sandbox
can't click through.

**Found and fixed, via a real Playwright pass (both 1440px and 390px) over every public route**
(`/`, `/demo`, `/tools` + its 4 calculators, `/privacy`, `/signup`, `/login`):
- `/signup` and `/login` (and, same shared `AuthShell`, `/forgot-password`, `/reset-password`, and
  onboarding's `WizardShell`) each rendered TWO `<h1>`s - `AuthShell`'s own left-panel headline
  ("Win more tenders. Miss fewer deadlines.") plus the page's own heading ("Create your account",
  "Welcome back", etc.). Both are visible simultaneously at desktop widths (the left panel is only
  CSS-hidden below `md:`, not removed from the DOM) - a real heading-hierarchy violation (spec
  v3 §20/§28: one stable page heading), not just a lint nit. Fixed by demoting the six per-page
  headings to `<h2>` - `AuthShell`'s headline is the true page-level heading; re-ran the same
  Playwright check after the fix and confirmed `h1Count === 1` on every public page, both
  viewports.
- Three more B-BBEE spelling inconsistencies beyond what earlier sessions already fixed:
  `BeeCidbSection.tsx` and `EditForm.tsx` both had a "BEE & CIDB" section title plus "BEE level"/
  "BEE procurement recognition %" field labels - alongside "B-BBEE proof held"/"B-BBEE proof
  expiry" in the very same section, an inconsistency within one form, not just across the app.
  `company/page.tsx`'s own left-nav jump link had the same "BEE & CIDB" short form. All four now
  read "B-BBEE" consistently; the `#bee-cidb` anchor id itself (what Batch 3's `lib/readiness.ts`
  links point at) was left untouched, only the visible label text changed.
- A stale comment in `app/tools/page.tsx` still said the signed-in sidebar's Tools item links to
  this public page ("a signed-in visitor briefly leaves the shell") - Batch 1 (#101) fixed that
  exact problem by giving signed-in users `/toolkit` instead, and had already updated
  `nav-items.ts`'s own comment to say so, but left this page's comment telling the old story.
  Updated to match current reality. No functional code changed here, just a comment that would
  have misled the next session reading it.

**Checked and already correct, no change needed**: zero horizontal overflow at 390px on any of the
10 pages/viewport combinations tested; zero `<img>` without `alt` text; no console errors on any
page at either viewport. `/demo`'s "Sample company and tender" labeling, the homepage's founding-
rate and proof-point copy (both already fixed in Batch 6), and `/privacy`'s honest "what's still in
progress" disclosure all read as intended on a fresh, skeptical re-read against spec §20's exact
rules (plain language, no absolute guarantees, no "artefact"/"entity"/"workflow"/vague error text -
none of those appear anywhere in the public-facing copy checked).

**Found, not fixed - a real gap, correctly left alone per this batch's own scope**: both the
homepage's Enterprise-tier "Contact us" (`app/page.tsx`) and the signed-in Billing page's identical
Enterprise card (`app/billing/page.tsx`) are `mailto:hello@tendertool.co.za` links - and
`hello@tendertool.co.za` is confirmed, as of earlier tonight, a non-existent mailbox nobody reads.
Unlike the Founding Firms CTA Batch 6 already fixed (which could honestly reroute to `/signup`
because that's genuinely where a "Start free" click already goes), an Enterprise prospect can't
self-serve through `/signup` - that flow only handles the four fixed-price self-serve tiers, not a
custom-quoted Enterprise deal, so rerouting there would trade one dishonest promise for a different
one. The only real fix is a working mailbox, which is infrastructure, not code - noted here rather
than patched around with equally-unbacked text, per this batch's own explicit instruction not to
invent a second kind of fake certainty to cover the first.

**Tested**: `npm run verify` 0 errors, 121/121 vitest, 76/76 node:test both ways (`tsx --test` and
the real CI invocation, `node --experimental-strip-types` per file). Playwright pass over all 10
public routes at 1440px and 390px, screenshots captured for all 20 combinations, re-run after the
h1 fix to confirm it actually resolved.

**Not tested**: anything behind sign-in. Same limitation every batch hit tonight (this sandbox's
credential-generation tools are blocked by its own safety classifier, and the demo account's real
password isn't committed anywhere any batch could read) - repeated here once more, explicitly,
because this is the batch whose own job was supposed to include "whole-app quality," and it would
be dishonest to let that scope note quietly disappear into "we checked everything" by the end of
the night.

---

### Where spec v3's whole-app rollout actually stands, end of this session's run (2026-10-22)

Seven batches plus one same-night security hotfix merged to `main` tonight (PRs #101-#107,
chronologically: Batch 1 broken-journeys fix, a middleware auth-gap hotfix, Batch 2 shared
document intake, Batch 3 onboarding collapse, Batch 4 Experience/People intake, Batch 5 tender
workspace layout, Batch 6 savings/analytics/email truthfulness, this Batch 7). Every one was
independently re-verified by the parent session after merge - diff re-read, fresh `npm install`,
`npm run verify`, both vitest and both node:test invocations re-run - not just trusted from each
batch's own self-report.

**What's genuinely verified, not just logically argued**: every automated test in the repo (121
vitest + 76 node:test, both runner conventions) passes on the current `main`. Every public page is
confirmed, via a real browser, to render correctly at 1440px and 390px with no overflow, no missing
alt text, no console errors, and (as of this batch) exactly one `<h1>` per page. The middleware
auth gap is confirmed closed by direct `curl` against a running dev server. The Python digest
sender's date-dropping bug fix is confirmed against a real generated fixture.

**What's verified by logic/tests only, not an actual signed-in click-through**: literally
everything behind `/login` - every batch tonight hit the same wall, a sandbox whose
credential-generation tools are blocked by its own safety classifier, with no committed password
for the seeded demo account. That covers: the new `/toolkit` route's actual rendering inside a real
`AppShell`; the shared document-intake component's real upload/classify/review/confirm cycle (its
logic is tested, its wiring is read-verified, but nobody has clicked through it); the 2-screen
onboarding's actual flow for a brand-new signup; Experience's new upload path; the tender
workspace's collapse/expand behavior on a real populated tender; the savings card's two different
messages. None of this is faked or glossed over - every batch said so plainly in its own entry
above - but it adds up to a whole rollout where the signed-in half of the product has not been
seen working by anything other than its own source code and test suite, all night.

**Known gaps from the Batch 0 audit's O01-O25 register that NO batch tonight touched** (not
forgotten, just out of scope for what got done): O06 (tender workspace and Company vault are still
long pages - Batch 5 only collapsed two sections once a tender is already near-complete; a
brand-new tender is still close to its original ~12,755px height, and Company vault's own form
density was never audited at all); O08 (click-count reduction was never measured before/after for
any flow); O11 (signed-in form field widths/overflow was never checked live, only the public auth
forms were); O16 (document-expiry page's own edit/replace-in-place behavior was not independently
re-verified this session - pre-existing, not touched, not broken, just not re-confirmed); O19
(SANRAL still has its own separate sidebar nav item, per the spec's "remove SANRAL as a universal
primary menu destination" - a deliberate choice to leave alone, since Batch 0's audit found real
SANRAL-specific capability behind it that a merge into a generic "Tools" or tender-workspace
concept risks flattening, and that's a product decision, not a batch to execute unilaterally); O21
(CV-led person creation was flagged by the Batch 0 audit as "not confirmed CV-first this pass" and
no later batch independently re-checked it).

**Also still open, unrelated to any specific O-item, flagged earlier tonight and unchanged by
this batch**: no real contact mailbox exists yet (`hello@tendertool.co.za`,
`privacy@tendertool.co.za` are both fake) - three more call sites of this same gap were found in
this batch (both Enterprise "Contact us" links) and are listed above, not fixed, since the fix is
infrastructure Sarel owns, not code. The live-database-write-access question from earlier tonight
was also left untouched by every batch - no batch wrote to production data beyond the normal
app-level writes its own feature needed.

This is the honest state of the rollout at the end of tonight's run: real, substantial, verified-
where-verification-was-possible progress across 6 of 7 planned batches plus an unplanned same-night
security fix - and an equally real, equally honest list of what still needs either Sarel's own
signed-in walkthrough or his own judgment call, not another batch pretending to supply either.

### Spec v3 Batch 8: Company vault form density (O06 remainder)

A follow-up batch, after the Batch 1-7 status note above was already written, picking up one of
its own listed gaps: "Company vault's own form density was never audited at all." Scoped to the
main `/company` page's own capture forms (`EditForm.tsx` plus the `*Section.tsx` read-only
display components) - spec v3 §10/§28 exactly, not a cosmetic shrink pass.

**Found and fixed, two real violations**:
- **Addresses squeezed into a 1-of-3 grid column** (`EditForm.tsx`, `CompanyIdentitySection.tsx`):
  `fieldGridClass` (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) gives every field in "Company
  identity" the same share of the row regardless of content - a VAT number and a full postal
  address got identical width. Spec §10/§28, verbatim: "Names, email addresses and long values
  need enough width... Do not make all boxes smaller to make the form compact." In the edit form
  this meant typing a multi-line registered/postal address into a ~370px-wide `<Textarea rows={2}>`
  at desktop widths - the one field in this form that actually needed the room. Fixed with a new
  optional `fullWidth` prop on both `shared.tsx`'s `Field` (read-only) and `EditForm.tsx`'s
  `TextInput` (edit mode), applied only to `registered_address`/`postal_address` - `col-span-full`
  spans the field across the grid's full row at every breakpoint the grid defines, harmless at
  `grid-cols-1` (mobile) where it's already full width. No other field in any of the vault's
  section components (`SizeOfficesSection`, `BankDetailsSection`, `SavingsBaselineSection`,
  `ComplianceDocumentsSection`, `BeeCidbSection`) holds a comparably long value - checked each one,
  none needed the same treatment.
- **Major sections spaced tighter than a "major region" per spec §28** (16px via `gap-4`, spec's
  own range for this is 24-32px for "major page regions" vs. 6-16px for fields/related groups
  within one topic): `EditForm.tsx`'s top-level form, `ReadOnlyView.tsx`'s top-level wrapper, and
  `page.tsx`'s own list of major components (document-expiry overview, the read-only sections,
  notifications, register links, letters, office locations) all used the same 16px gap a form's
  own *fields* should use, not what should separate "Company identity" from "B-BBEE & CIDB" from
  "Bank details" - genuinely different topics, not one continuous list. Bumped all three to
  `gap-6` (24px, the low end of the spec's own stated range) for consistency between read and edit
  modes.

**Found, deliberately NOT fixed here - flagged for a future, separate pass**: `EditForm.tsx`'s
"Size & offices (SANRAL Form B3)" section asks every company, regardless of whether it does
engineering work, for ECSA-registered and SACPCMP-registered staff counts, unconditionally -
the same "ECSA as the universal category" pattern spec v3 O23 already fixed at the *person*
level (Batch 4, #105: these two bodies no longer render unconditionally on every person). This is
the same problem one level up, at the *company* level, and genuinely belongs with that same O23
work rather than a "form density" batch bundling in a different kind of fix under cover of a CSS
pass - noted here so it isn't lost, not touched, to keep this batch's own diff to what it actually
set out to do.

**Also found, out of this batch's own stated scope** (Company vault's main page, not its
sub-routes): `registrations/page.tsx`, `properties/page.tsx` and `principals/page.tsx` each have
their own "Notes" field (`ui.tsx`'s shared `Area` component) sitting in a same-width grid cell
alongside short fields - the identical pattern just fixed here, on different pages with their own
separate `grid`/`Text`/`Area` component family (not `fieldGridClass`/`TextInput`). A real
instance of the same spec rule, left alone because it's a different set of files than this
batch's own directive named.

**Tested**: `npm run verify` 0 errors, 129/129 vitest (the +8 over Batch 7's 121 are from other
sessions' commits already on `main` before this batch started, unrelated to this change), 76/76
node:test both ways (`tsx --test` and the real CI invocation, `node --experimental-strip-types` per
file). A standalone `react-dom/server` static render of both `CompanyIdentitySection` (read-only)
and `EditForm` (edit mode) with representative sample data confirmed `col-span-full` appears
exactly twice in each - the two address fields, nothing else - and that neither component throws
when rendered with the new prop.

**Not tested**: an actual signed-in render of `/company` itself, in either mode, at either
viewport - the same sandbox credential-generation limitation every batch has hit all night. The
fix is a span/gap class change on components that already render correctly per the static-render
check above and the existing build/test suite, but nobody has seen the real page with real data
in a real browser.

### Spec v3 Batch 9: company-level ECSA/SACPCMP collapse + registrations/properties/principals field width

Picks up the two gaps Batch 8 flagged rather than fixing: "the company-level 'Size & offices'
section asks every company for ECSA/SACPCMP staff counts unconditionally" and "the identical
grid-squeeze on registrations/properties/principals' 'Notes' fields - different component family".

**Part 1 - company-level ECSA/SACPCMP (O23, one level up from Batch 4)**: `EditForm.tsx`'s "Size &
offices (SANRAL Form B3)" section and its read-only counterpart `SizeOfficesSection.tsx` both
rendered ECSA-registered/SACPCMP-registered staff-count fields unconditionally, the exact same
"ECSA as the universal category" problem Batch 4 (#105) already fixed at the *person* level.
Applied the identical convention here: `recorded = ecsa_registered_staff_count != null ||
sacpcmp_registered_staff_count != null` (a real `0` counts as recorded - this section's own
description already says "blank is never written as 0", same meaning as "held" at the person
level). In edit mode, not-recorded collapses both fields behind a `<details>` disclosure
("+ Add ECSA or SACPCMP staff counts - only engineering-focused companies need these"), wrapped in
`col-span-full` so it doesn't disturb `fieldGridClass`'s row layout; recorded shows them inline, as
before. In read-only mode, not-recorded simply omits the two `Field` rows (no "Not on file" pair to
show, and there's nothing to "add" from a read-only view - that lives in edit mode). Verified via
`grep` that both columns are read ONLY by `pack-review-data.ts` (lists the field name/value in a
tender pack review, does not gate anything on it) and the company-select string in `page.tsx` -
confirmed, same as Batch 4's own verification, that a display-only change cannot affect any
compliance/assessment logic.

**Part 2 - registrations/properties/principals field width**: all three sub-pages
(`registrations/page.tsx`, `properties/page.tsx`, `principals/page.tsx`) have their own "Notes"
field via `ui.tsx`'s shared `Area` component, sitting in the same `grid` (`grid-cols-1
sm:grid-cols-2 lg:grid-cols-3`) as short fields like a registration number or a title deed
number - the identical violation Batch 8 just fixed in the main vault form, confirmed as a
"different component family" (`ui.tsx`'s `Area`/`Text`/`grid`, not `shared.tsx`'s `Field`/
`EditForm.tsx`'s `TextInput`/`fieldGridClass`). Added the same optional `fullWidth` prop to `Area`
(`col-span-full`, identical pattern to Batch 8's `Field`/`TextInput` fix) and applied it at all
three call sites. No other `Text`/`Select`/`YesNo` field on any of the three pages holds a
comparably long value - checked each page's own field list, none needed the same treatment.

**Tested**: `npm run verify` 0 errors, 129/129 vitest (unchanged - this batch added no new test
files), 76/76 node:test both ways (`tsx --test` and the real CI invocation, `node
--experimental-strip-types` per file). A standalone `react-dom/server` static render of both
`EditForm` and `SizeOfficesSection` across three states (`ecsa`/`sacpcmp` both null, `ecsa=0`,
`sacpcmp=3`) confirmed: not-recorded renders exactly one `<details>` in edit mode and zero ECSA
fields in read-only mode; a real `0` in either field correctly counts as recorded (no `<details>`,
field shown) rather than being treated as blank; either field alone being set reveals both, same
OR logic as Batch 4's `ecsaOrSacpcmpHeld`. No render threw in any of the three states.

**Not tested**: an actual signed-in render of `/company`, `/company/registrations`,
`/company/properties`, or `/company/principals` - same sandbox credential-generation limitation
every batch has hit all night.

### Compliance documents: one upload button, table view default (Sarel's own live feedback)

Sarel's first real signed-in look at the app tonight, with two screenshots of `/company`'s
"Compliance documents" section: "it is confusing having two buttons for files, make this easier
with just one button to click to upload a file. these cards take up a lot of space, move towards
a table row view and not these cards, or have the option to switch between cards and list view."
Both are real, not new bugs - the exact documented gap from Batch 2 (`coid` kept its old two-
control `<input type="file">` + Submit form, since it has no AI-classifier entry - see
`VAULT_KIND_TO_DOCUMENT_KIND`'s own comment) and a layout choice (one card per document) nobody
had pushed back on before now.

**One button**: new `DirectVaultDocumentUploader.tsx` - the same `FileDropzone` single-action UI
every other vault row already uses (upload starts automatically on file choice, spec v3 O12),
wired to the EXISTING `uploadVaultDocument` server action instead of the AI-classify pipeline
(`coid` still has no classifier entry - that's still a Python/schema change, still out of this
fix's scope, still not silently worked around). `DocumentRow.tsx` now calls a new shared
`DocumentUploadAction` helper (reviewable kinds -> `VaultDocumentUploader`, `coid` ->
`DirectVaultDocumentUploader`) in both the card view and the new table view, so the two can never
drift onto different upload behaviours. `MAX_UPLOAD_BYTES` (4.4 MB, the Server Action body cap),
not onboarding's 25 MB - this path still goes through the action's own request body, unlike the AI
path which uploads straight to storage first.

**Table view**: new `ComplianceDocumentsView.tsx` (client component - the view choice is plain
`useState`, not persisted anywhere, a display preference rather than data) replaces the section's
direct card rendering. Defaults to a compact table row per document (Document + one-line detail +
filename link | Expires | Status | upload action), matching spec v3 §29's own "Expiry / document
lists" composition example; a toggle in the section header (`VaultSection`'s new `actions` slot -
`SectionCard` already had one built for exactly this, "a link, a button, a menu trigger" beside the
title, not crammed inside the `<CardTitle>` heading itself) switches to the original card view,
unchanged in its own markup. Table rows stack to a compact block (no horizontal scroll) below
`sm:`, per spec §27/§29's "mobile may use rows/cards... not a horizontally-scrolling table."
`ComplianceDocumentsSection.tsx` now only computes one `ComplianceDocEntry[]` array (title, full
card-view `lines`, a one-line `detail` for the table, a raw `expiry` date for the table's own
column, status, path, url) and hands it to the view component - the same per-kind field logic as
before, just captured once instead of being re-derived per view.

**Self-review**: round 1 - a static `react-dom/server` render of `DirectVaultDocumentUploader`
alone confirmed exactly one dropzone control, no second submit button; a render of
`ComplianceDocumentsView` with a single `coid` entry confirmed the table header row, both toggle
buttons, and the row-grid markup all present; a render of the post-refactor card-view `DocumentRow`
for `coid` confirmed no regression there either. Round 2 - re-read against Sarel's own literal
words: one button (confirmed), table as the default with cards one click away (confirmed, not the
reverse). Round 3 - `VaultSection` has a dozen other callers across this page (`BeeCidbSection.tsx`,
`CompanyIdentitySection.tsx`, `BankDetailsSection.tsx`, `EditForm.tsx` alone uses it 6 times,
`HowWeWorkSection.tsx`, `LettersSection.tsx`, `RegisterLinks.tsx`, `SavingsBaselineSection.tsx`,
`SizeOfficesSection.tsx`); `actions` is a new optional prop and every one of them still passes
only `title`/`id`/`description` exactly as before - confirmed by grep, not just assumed from the
type signature.

**Tested**: `npm run verify` 0 errors, 133/133 vitest, 76/76 node:test both ways. **Not tested**: an
actual signed-in render - same sandbox credential-generation limitation as every batch tonight,
even with Sarel live and the strongest possible reason to find a workaround if one existed; none
did. The static-render checks above are real evidence the new code paths don't throw and produce
the right markup, not a substitute for him clicking it himself.

---

## CV-led "Add person" + bulk CV/people upload (Sarel's own live feedback, 2026-10-23)

Direct quote (typos his own): "on the add person, allow uption to add a CV and have AI read and
capture all the information instead of the user capturing it" and "also alow bulk upload of all
People CVs, and bulk upload ofpeople CVs or bulkd uload of people with their details."

**Investigation finding, before anything was built**: a fully CV-led, zero-typing "AI reads even
the name off the CV, nothing saved until confirmed" flow is blocked by a hard schema constraint,
not a missing feature. `cv_uploads.person_id` and `cv_extraction_results.person_id` are both
`uuid not null references people(id)` (`0008_cv_uploads.sql`, `0023_cv_extraction_results.sql`) -
nothing can be attached to or extracted for a person who doesn't exist in the `people` table yet.
The one pipeline that doesn't need a person first - the generic company-level document classifier
from spec v3 Batch 2 (`lib/onboardingScan.ts`) - can recognise "this is a CV" without a target, but
deliberately extracts zero fields for that document kind (`cv: []`); real field/name extraction is
`engine/cv/extract_cv_fields.py`'s job alone, and that only ever runs against an already-existing
`cv_uploads.person_id`. Making this genuinely zero-typing needs either a schema change (a nullable
`cv_uploads.person_id`, or a staging table for an unconfirmed person) or an engine change (teaching
the generic classifier to also do name/field extraction, duplicating `extract_cv_fields.py`'s own
job) - both out of scope for an autonomous merge under this repo's standing rule (no schema/engine
change without Sarel's own review), and **neither was built**. Flagged here for his own call, not
worked around silently.

**What was built instead, in scope**: the smallest honest anchor, not a workaround that pretends
otherwise. `/people/new` now leads with a new "Add from a CV" card
(`CvLedAddPerson`, `app/app/people/_components/cv-led-add-person.tsx`) - full name (typed, the one
field that has to be) plus an optional CV upload, calling a new `createPersonWithCv()` action
(`app/app/people/actions.ts`). It creates the `people` row with only the typed name (everything
else starts null, same as the existing blank form always left it), then - if a file was given -
attaches it through the exact same `cv_uploads` row shape, storage-path convention and
`extraction_requested` pipeline `uploadCv()` already uses for an existing person, so the CV then
goes through the SAME `CvExtractionReview`/`applyCvExtraction()` confirm-or-correct card every
other person's CV already gets. Nothing from the CV is trusted or saved without that review; only
the name the human actually typed is saved immediately, and it's correctable there too. The old
~20-field blank manual form is untouched and still there right below it ("Or enter details
manually") - this is additive, not a replacement.

**Bulk upload**, new `/people/bulk-cv` page (`bulk-cv/page.tsx`, `BulkCvUpload` component): drop
several CV files at once, each row assigned - via filename-based fuzzy pre-matching
(`bestPersonMatch`, all of an existing person's name parts must appear in the filename) as a
non-binding starting guess only, never auto-submitted - to an existing person or a new one (name
typed, same reason as above). A new `bulkUploadCvs()` action processes every assigned row in one
call (existing `uploadCv()`/`createPersonWithCv()` each end in their own `redirect()`, which throws
in a Server Action and can't run inside a loop, so the shared per-file logic was factored into a
new non-throwing `attachCvToPerson()` helper instead of being duplicated a third time) and redirects
once at the end to `/people?bulk=...` with a plain-English summary ("3 CVs uploaded, 1 new person
added. 1 failed: ..."), which `/people/page.tsx` now actually renders (it previously only read
`?error=`, so this banner would otherwise have silently done nothing). A "Bulk upload CVs" link
was added next to "+ Add person" on `/people` - the page existed from the first draft but had no
way to reach it from the UI until this pass caught it in round 3 of self-review.

**Caught in round 2 of self-review (adversarial re-read against
`Tender-Tool-Competitor-Feature-Deep-Dive.md`'s "CVs: upload once, never recapture" section,
specifically the "Use as-is" sub-requirement)**: the first draft of both `createPersonWithCv()` and
`bulkUploadCvs()` hardcoded `mode: "ai_extract"`, silently removing the as-is/AI-extract choice
`uploadCv()` already requires for every other CV upload in this app ("AI extraction/reformatting
must be optional, not forced"). Fixed before merge: both new client components now show the same
two-option radio choice `uploadCv()`'s own form already uses, in the same wording ("AI-extract the
fields for you to check..." / "Use as-is - attach this exact file to submissions, no AI involvement
at all"), for `CvLedAddPerson` once a file is chosen and for `BulkCvUpload` as one choice applied to
the whole batch (not per-file - keeps the bulk screen usable with many rows, and still a real,
visible, un-hardcoded choice at the point of upload rather than a default silently forced through).

**Known limitation, not built this pass**: no duplicate-person detection on either new path. This
matches the existing baseline exactly - `savePerson()` never checked for an existing person with
the same name either - so it's not a regression, but it's more likely to bite in the bulk flow
specifically, where a CV's filename not matching any existing person's name (misspelling, nickname,
initials-only) falls through to "new person" by default rather than failing closed. The UI always
shows the "Existing person" dropdown as a manual override for exactly this reason, but nothing
stops two rows for the same real person from being submitted as two separate new people if neither
matches by filename. Worth a real dedup pass if duplicate people start showing up in practice.

**Tested**: `npm run verify` 0 errors (clean typecheck, lint, build - `/people/bulk-cv` appears in
the route list), 133/133 vitest, 76/76 node:test both ways (same 4 pre-existing
`app/tenders/[id]/*.test.ts` files reporting 0 tests under the `node --experimental-strip-types`
invocation specifically - confirmed by diffing against a fresh `origin/main` checkout that this is
a pre-existing Node test-runner quirk with `[id]` bracket characters in a directory path, not
something this pass caused; the same files pass fully under `tsx --test`, and nothing in this pass
touches `app/tenders/`). **Live-tested further than the last several batches**: the sandbox still
has no way to generate a real signed-in session (re-checked specifically for this pass, since Sarel
was live - still blocked), but unlike a static `react-dom/server` render, this pass built a
temporary, dev-only mock-data route (`app/dev-screenshot-cv/page.tsx` - never a route with a
leading underscore, Next.js treats `_`-prefixed folders as private/non-routable and silently 404s
them, caught immediately when the first screenshot came back blank), rendered both new components
for real inside `next dev` + Chromium via Playwright, and drove them through actual browser
interaction - a real `<input type="file">` set via `setInputFiles()`, not simulated. That confirmed
the fuzzy-match logic genuinely works end to end (a file named `mock-cv-thabo-nkosi.pdf` auto-
matched the mock person "Thabo Nkosi"; an unmatched file correctly defaulted to "New person" with a
guessed name from its filename), not just that the markup renders. Screenshotted at 1440px and
390px both before and after the round-2 mode-toggle fix - no horizontal scroll, touch-sized
controls, toggle and rows all visible at both widths. The temporary route, `.env.local`, and the
`playwright-core` dev install were all deleted again before commit (confirmed via `git status`
showing only the real feature files) - this was a self-review aid, never meant to reach `main`.

---

### Tender workspace: quick doc link, phase-grouped plan, action-type tags, tabs (Sarel's own live feedback)

Sarel's third live-feedback round tonight, screenshot of `/tenders/[id]#general-preparation`
(RFP165/2026, DBSA, general family): "have a quick link to access all tender docs. change
submission plan to be grouped by how to compile the tender pack and according to the timeline...
not just one long list. also indicate if it requires a physical action, a decision, a document,
info, review etc not just [a status badge]... you can still color code if it needs fixing or done
or ready to submit. the tags in the standard forms section should be standard sizes. add a summary
of how much is still needed per section... always displayed. see if you can streamline the page
and move to different tabs, it is a very long list, even reduce some of the blabber on the
questions." Seven distinct asks, all in `general-workspace.tsx`/`submission-plan-*.ts` (general
family only - SANRAL's own `compliance-report.tsx` and `disqualification-guard.tsx` sit outside
this page's biggest-complaint area and were left alone beyond one copy trim). The CV-pre-population/
confidence-level closing line is the same ground `CV-led "Add person"` work (same night, different
Claude session/PR) already covers - not re-scoped here to avoid two sessions racing the same code.

**Action-type tags (new axis, not a status change)**: new `ActionType = "physical" | "decision" |
"document" | "info" | "review"` and a pure `actionTypeForStep()` in `submission-plan-logic.ts`,
derived from each step's existing `category` (+ `bidTaskStatus` for forms: engine-filled ->
review, by-hand -> document) - no new data, no schema change. Rendered by new `ActionTypeTag`
(`action-type-tag.tsx`) - deliberately a square-cornered, icon+outline tag, a different SHAPE from
`BidTaskBadge`'s rounded pill, so the two read as two different kinds of information at a glance:
the existing Fix/Provide/Verify status badge (kept, unchanged, still color-coded) stays the "is
this OK" signal; the new tag is "what do I actually have to go and do." Never merged into one
badge - Sarel's own words kept the two separate ("not just [status], it is not descriptive enough,
you can still color code").

**Submission plan regrouped by phase, not status**: `submission-plan-view.tsx` rewritten -
`PHASE_ORDER` groups the exact same steps into "1. Confirm you qualify" (returnable, cidb_grading)
-> "2. Assign your team" (role) -> "3. Complete the forms" (form, buyer_form) -> "4. Answer this
tender's own questions" (question) -> "5. Attend the briefing" (briefing) -> "6. Known limitations"
(gap) - the order a pack actually gets compiled in, derived purely from each step's existing
`category` field (8 values already there, nothing new read). Status is still worst-first WITHIN
each phase and still the row's own color-coded badge - grouping changed, the Fix/Provide/Verify
model didn't. An always-visible "`N` of `M` ready · `fix` to fix · `provide` to provide · `verify`
to verify" bar sits above the phases (item 5), plus a "`done` of `total` done" count per phase
header, even while scrolled past it. An empty phase (e.g. no gaps) is skipped entirely rather than
padded with an empty-state line - the old flat list's own `emptyText` strings are gone; a phase
with zero items for this tender just isn't shown.

**Tabs, scoped deliberately**: new `WorkspaceTabs` (`workspace-tabs.tsx`, client component) wraps
ONLY `GeneralTenderWorkspace`'s 4 secondary sections (Documents/Questions/People/Pack) behind a tab
bar - "What this tender needs" (has its own live blocker chips) stays always visible above the
tabs, and the Disqualification guard + Submission plan (`page.tsx`, mounted above this whole
component) were already structurally outside/above it before tonight - confirmed by reading
`page.tsx` before starting. No blocker is ever hidden in a tab (spec v3 §16.E: "Do not bury
blockers in a hidden tab"). Every tab's content is always rendered (same data already being
fetched unconditionally before tabs existed) - only which one is VISIBLE changes, via the `hidden`
attribute rather than unmounting, so an existing `JumpLink href="#general-documents"` style anchor
still finds a real element. Since a `hidden` element can't be scrolled to, `WorkspaceTabs` listens
for `hashchange` (a `JumpLink` click, or the page loading with a hash already in the URL) and
switches tabs itself before re-doing the scroll the browser couldn't do while it was hidden; a
tab's optional `anchors` list (used for `general-pack-review`, rendered inside the Pack tab but
with its own id) covers a hash that isn't the tab's own id. Each tab carries a `TabBadge` - the
same per-section "still outstanding" count Sarel asked for (item 5), on the bar itself so it's
genuinely "always displayed" even while a different tab is open: Documents = `docsMissing`,
Questions = `needAnswer`, People = `regGaps + roleGaps` (new, a small pure count from already-
loaded `personRegs`/`roleRowsForTender`, not a new query), Pack = `generalFixCount` (already
computed, reused).

**Quick doc link + standard-size form tags + copy trim**: "Read from N documents" in "What this
tender needs" is now a link to `#general-documents`/the Documents tab; that section gained a
`<details>` disclosure listing every `manifest.documents[]` entry by name (with an unreadable/OCR
note) - the one genuine gap found while investigating (the manifest's own document list was being
counted everywhere but never itemized anywhere) - rather than inventing a download feature the
schema doesn't have (checked: no `listing_url`/original-document storage exists beyond
`tender_private_documents`, which IS already linked from inside the disclosure when present).
`FormTag` (SBD/MBD code pills, "standard forms" section) got a `minWidth: 56` + centered text - the
literal ask ("standard forms section tags should be standard sizes"); previously auto-width, so
"SBD 1" and "SBD 6.1" visibly differed. Trimmed the Questions intro paragraph, the Submission plan
intro, and the Disqualification guard's description to their load-bearing sentence each - the
"blabber" complaint was about fixed wrapper copy, not per-question `help` text (that's extracted
from the tender's own documents, not authored here).

**Self-review (4 rounds, this page's size/risk)**: round 1 - re-read Sarel's own words item by
item against the diff; the "info" fallback for a signatory-type question (`q.type === "person"`)
is a known, accepted simplification - `PlanStep` carries no discriminator for it today, so it reads
as generic "info" rather than "decision" (who signs); not silently missed, flagged here. Round 2 -
confirmed `disqualification-guard.tsx`'s own `plan.steps.filter((s) => s.category === "role")`
still works unchanged (category values untouched, only a new derived `ActionType` added alongside).
Round 3 - a mock-data screenshot harness (`/design/screenshot-workspace-redesign`, temporary,
deleted before finishing) rendered `ActionTypeTag` for all 5 types, the phase-grouped plan with 9
mock steps across 5 phases, and `WorkspaceTabs` with its badges; confirmed visually at 1440px and
390px, and confirmed a real click switches tabs (Playwright, `page.getByRole('tab').click()`).
Round 4 - re-read the full restructured `general-workspace.tsx` end to end for the tab-content
extraction itself (the highest-risk mechanical step): every section's own id, every prop/state
closure (`tenderId`, `manifest`, `returnables`, `qStates`, etc.) still reads from the same
surrounding closure as before, nothing duplicated or dropped in the move.

**Tested**: `npm run build` clean, `npm run verify` 0 errors, 144/144 vitest (11 new
`actionTypeForStep` cases added to the existing `submission-plan-logic.spec.ts`), 76/76 node:test
both ways. **Not tested**: an actual signed-in render of `/tenders/[id]` - same sandbox credential-
generation limitation as every batch tonight; the mock-data screenshot harness above is real
evidence the new components render, lay out, and respond to clicks correctly, not a substitute for
Sarel clicking through his own real tender.

---

### Fix: stop naming SANRAL in the general (non-SANRAL) tender flow

Sarel's own live feedback: "there is still sanral specific references and saying not sanral
temple [template], dont do that, onlt when it is a sanral tender, then mention the sanral specs and
tools and process." Grepped every `SANRAL` occurrence under `app/app/tenders/[id]/` to check each
one was actually gated to a real SANRAL-route tender (most already were - `compliance-report.tsx`,
`submission-pack.tsx`, `subcontracting-plan.tsx`, `tender-templates.tsx` are only rendered at all
when `isSanralFamily`/`showSubmissionPack` is true, per `page.tsx`'s own conditional). Found three
real leaks, all in files a general (non-SANRAL) tender's own user would actually see:

- `general-workspace.tsx`'s "Tender preparation" intro used to open with "This isn't a SANRAL
  tender, so..." - naming the one thing this screen explicitly isn't, to a user who may never deal
  with SANRAL at all. Now opens directly with what the screen actually does: "What this tender
  needs is read from its own documents...".
- `intake-card.tsx`'s route chip said "General (non-SANRAL) flow" for every non-SANRAL tender -
  now just "General flow". The chip for an actual SANRAL tender still correctly says "SANRAL pack
  flow - {family}".
- `intake-card.tsx`'s "reading the documents" loading message used to say "working out whether
  this is a SANRAL template tender or a general one" - said to every tender while intake is still
  running, before the route is even known. Reworded to describe what's actually happening ("working
  out what this tender requires and how it fits your company") without leading with SANRAL.
- `intake-card.tsx`'s generic "missing something?" prompt under the manual-upload form used "an
  addendum, the SANRAL workbook, a readable copy of a scanned page" as its three examples
  unconditionally - a general tender's own user saw "the SANRAL workbook" as a suggested example of
  something THEY might be missing. Now conditional on `intake?.route === "sanral"`.

Pure copy/conditional-rendering change - no calculation, routing decision, or SANRAL-specific
feature was touched; `compliance-report.tsx`/`submission-pack.tsx`/`subcontracting-plan.tsx`/
`tender-templates.tsx` (the actual SANRAL-only screens) are unchanged, confirmed still gated
correctly. `npm run verify` 0 errors, 133/133 vitest, 76/76 node:test both ways (`tsx --test` and
the real CI invocation, `node --experimental-strip-types` per file).

---

## App-wide counts & calculations audit (2026-10-23)

Sarel, after seeing the real Active-bids 6-vs-1 discrepancy (PR #122, `fix/active-bids-count-mismatch`
- same root cause shape cited throughout this pass): "run through the app all calculations and counts
and make sure they are correct." A systematic read of every page that shows a computed stat, count,
percentage or total - `dashboard/page.tsx`, `pipeline/page.tsx` (read-only per the file-overlap rule
below), `analytics/page.tsx`, Company vault (`lib/companyReadinessData.ts`/`lib/readiness.ts`),
`lib/savingsCounter*.ts`, `lib/marketPricing.ts` and everything reachable from them - checked against
its own label, against every other place in the app computing what should logically be the same
number, and against zero-row/one-row/null-field/wrong-company edge cases, same bar as the
Audit-fix-cluster batches above.

**File-overlap rule followed**: two other sessions were concurrently touching
`app/app/discovery/page.tsx`, `app/app/pipeline/page.tsx` and `app/app/pipeline/pricing/page.tsx`
(server-side pagination/filtering batch, and PR #122's own active-bids fix) - none of those three
were edited in this pass, even though `pipeline/page.tsx`'s own `totalValueBeingBid`/
`submittedThisMonth`/`winRate` were read and checked (see "found but not fixed" below for the one
real issue that turned up there).

**Fixed - real bug, same precedent as PR #111 ("silently reading a 2.5% sample, not the real
table")**: `app/dashboard/page.tsx` and `app/analytics/page.tsx` both read the whole shared `tenders`
table (migration 0001: "Shared across every company - not tenant-scoped", readable by every
authenticated user for every non-manual row) with a plain `.select()` and **no `.range()`-based
pagination at all** - `analytics/page.tsx`'s own read didn't even have an `.order()` clause. PostgREST
caps any response at 1000 rows (db-max-rows) regardless of a client-side `.limit()`, confirmed live
during the PR #111 QA pass against this exact project - once the shared `tenders` table (grown daily
by the discovery pipeline, with nothing ever pruning closed/old rows) passes 1000 rows, both pages
would silently see an arbitrary, truncated slice instead of the real set, undercounting "Active
bids"/"Packs ready"/"Closing this week"/"Tenders tracked"/"Win rate" etc. for every company on the
platform at once - not a single-company bug, a whole-platform one, the moment the row count crosses
the cap. Grepped the whole codebase for every other `.select()` that could plausibly read more than
1000 rows without `.range()`-based pagination (325 `.select()` calls checked) - every other one is
either already paginated (`lib/marketPricing.ts`, PR #111) or inherently bounded by a real filter
(`.eq("id", ...)`, a single company's own RLS-scoped rows, a `tender_packs!inner(...)` join that
requires a real pack, a `.limit()` on a small capped list) - these two were the only genuine gaps.
- **Extracted `fetchAllRows()`/`POSTGREST_PAGE_SIZE` out of `lib/marketPricing.ts` into a new shared
  `lib/supabasePaging.ts`** (re-exported from `marketPricing.ts` so its own existing imports/tests
  don't need to change) - this exact fix needed reusing in two more files, not redefining.
- `dashboard/page.tsx`'s `tenders` read now pages through `fetchAllRows()` (keeping its existing
  `.order("closing_date")`, needed for the "Closing soon" list's own ordering) capped at 20,000 rows
  - headroom above any plausible current count, not a measurement, same reasoning
  `loadMarketOutcomes()`'s own 60,000 cap documents.
- `analytics/page.tsx`'s `tenders` read gets the same fix (no pre-existing `.order()` to preserve -
  none was ever applied here, matching `lib/marketPricing.ts`'s own un-ordered
  `loadSegment()`/`loadMarketOutcomes()` precedent for a `fetchAllRows()` caller).
- **Test**: `lib/supabasePaging.spec.ts` (5 cases, moved from `marketPricing.spec.ts` + one new) -
  including a direct regression case naming the exact old bug (a naive single `.range()` request
  returns only 1000 of 1800 real rows) vs. the fix (returns the real 1800). The generic helper is
  what's unit-tested (same as PR #111's own fix); neither `dashboard/page.tsx` nor
  `analytics/page.tsx` can be unit-tested against a live-growing table in this environment (no
  `SUPABASE_DB_URL` here either - same documented limitation as every other DB-dependent page in
  this file), so correctness here rests on reusing the already-tested helper verbatim, not a new
  page-level test.
- **Before/after**: today's real row count is well under 1000, so this is forward-looking, not a
  live-data fix visible in a screenshot right now - exactly the same situation PR #111 was in before
  `public_tender_outcomes` crossed the cap for real. The bug is real and reproducible (the new
  regression test proves it) even though it hasn't yet bitten in production.

**Checked and confirmed correct (re-verified, not just trusted from the prior pass's own fix)**:
- `lib/savingsCounter.ts`/`lib/savingsCounterData.ts` (this file's own "Spec §9" entry documents a
  real past R0-savings bug) - `resolveBaseline()` is used consistently in both
  `fetchSavingsCounterSummary()` and `fetchTenderSavingsBreakdown()`, `hoursSavedForTender()`'s
  baseline cap and `extraCapacity()`'s divide-by-zero guard are both still correct against their own
  26 unit tests. One real but very narrow edge case found, **not fixed**: `fetchSavingsCounterSummary()`'s
  "this month" boundary (`new Date(now.getFullYear(), now.getMonth(), 1)`) uses the server's own local
  time zone, not `Africa/Johannesburg` (unlike `dashboard/page.tsx`'s own `greetingFor()`, which
  explicitly uses SAST) - on a server running in UTC, a step counted in the ~2-hour window around
  midnight SAST at a month boundary could land in the wrong month's total. Narrow enough (a few hours,
  once a month) that this pass judged it not worth the risk of a deploy-environment-dependent fix
  without being able to confirm the real server's time zone here - flagged for whoever next touches
  this file.
- `lib/companyReadinessData.ts`/`lib/readiness.ts` - confirmed `app/dashboard/page.tsx`,
  `app/company/page.tsx` and the onboarding end screen all ultimately feed the exact same
  `computeBidReadiness()` pure function with field-for-field identical inputs;
  `app/company/page.tsx` computes its own input object (rather than calling
  `fetchCompanyReadiness()`) only to reuse data it had already fetched for other reasons on the same
  page (the company row, the principal count) - checked every field one by one against
  `fetchCompanyReadiness()`'s own mapping and found zero drift, so this is a legitimate fetch-path
  optimization, not the "recomputing its own version" drift risk this audit was looking for.
- `lib/documentExpiry.ts`/`lib/notifications.ts` - the vault's "N documents need attention" count and
  the topbar bell read the same `COMPANY_EXPIRY_FIELDS`/tables, the bell's tighter 60-day vs. the
  vault's 30-day window is a documented, deliberate difference (already in this file's own prior
  entry), not a disagreement bug.
- `app/pipeline/page.tsx`'s own `totalValueBeingBid`/`submittedThisMonth`/`winRate` (read-only, not
  edited per the file-overlap rule) - all three check out: `winRate` uses the identical
  `won/(won+lost)` formula (with the identical `decided === 0 -> null` guard) as
  `analytics/page.tsx`'s own win rate, `submittedThisMonth` counts by `submitted_at`'s calendar
  month regardless of current stage (correct - a tender submitted this month that was later decided
  should still count), and `totalValueBeingBid` sums `submitted_price_zar` only across
  found+bidding (not-yet-decided) cards, matching the field the pipeline card itself already shows.
  The one real disagreement in this area - `pipeline/page.tsx`'s own "Active bids" (found+bidding
  only) vs. `dashboard/page.tsx`'s (found+bidding+submitted, via `ACTIVE_PURSUIT_STAGES`) - is
  exactly PR #122's own fix, already in flight; not re-fixed here to avoid colliding with it.
- `lib/dealEconomics.ts`'s `median()` (odd/even length, empty array), `commissionRand()`'s
  round-to-cents arithmetic, `lib/dates.ts`'s `daysUntil()` (NaN/malformed-date guard) - all read
  correct against their call sites and existing tests; left alone.
- `app/tenders/[id]/tender-readiness.ts`'s `computeTenderReadiness()` returning `score: 100` for
  `totalCount === 0` is deliberate and already covered by its own 5-case test (an unmapped family or
  zero-section pack reads as "nothing to assess yet", not "0% ready") - not a bug.
- Confirmed no query anywhere in `app/`/`lib/` uses a service-role/admin Supabase client that bypasses
  RLS (grepped for `service_role`/`SUPABASE_SERVICE_ROLE`/`supabaseAdmin` - the only hit is
  `scripts/send-deadline-reminders.ts`, a standalone cron script, not a page) - **no tenant-isolation
  leak found** in this pass. `discovered_opportunities`, `savings_counted_steps`, `tender_packs` all
  confirmed to carry a real `company_id` + tenant-scoped RLS policy by reading their migrations
  directly, not assumed from naming.

**Found but NOT fixed here (file-overlap conflict with concurrent work - write-up only, per this
batch's own instruction)**:
- `app/app/pipeline/page.tsx`'s "Active bids" stat (found+bidding only) disagreeing with
  `app/app/dashboard/page.tsx`'s "Active bids" (found+bidding+submitted, via
  `ACTIVE_PURSUIT_STAGES`) - this is the exact bug PR #122 (`fix/active-bids-count-mismatch`) is
  already open to fix; deliberately not touched a second time here to avoid a merge collision. See
  that PR's own description for the fix (a shared `IN_PROGRESS_STAGES` constant in `lib/pipeline.ts`).
- No other real counts/calculations bug was found specifically inside `discovery/page.tsx`,
  `pipeline/page.tsx` or `pipeline/pricing/page.tsx` beyond the one above - both files were read in
  full for this audit's own verification purposes (see "Checked and confirmed correct" above), not
  skipped, just not edited.

Verified: `rm -rf .next && npm run verify` - 0 errors (3 pre-existing warnings, unrelated to this
pass - 2 `no-img-element` on `Logo.tsx`, 1 `no-unused-vars` on `analytics/page.tsx`'s own
`STAGE_META` import, confirmed present on `origin/main` before this pass touched the file).
`npx vitest run` - 145/145 (144 baseline + 1 new regression test; `supabasePaging.spec.ts`'s 5 cases
replace the 4 `fetchAllRows` cases moved out of `marketPricing.spec.ts`). Full `node:test` sweep both
ways: `npx tsx --test $(find . -name "*.test.ts" -not -path "*/node_modules/*")` - 76/76; the same
set run individually via `node --experimental-strip-types --test <file>` - 76/76, zero failures.

---

### Opportunities/Bids/Pricing history: discovered_opportunities scaling fix (Sarel: "filtering tenders is going to be critical with the load, we need to be smart about how we manage that")

**Root cause.** `discovered_opportunities` is a per-company table that accumulates one row for
every OCDS release ever scored against that company, forever - there is no retention/archival
(see the proposal at the end of this entry). Three call sites fetched the ENTIRE table, unbounded,
on every page load: `app/discovery/page.tsx` (no `.range()`/`.limit()` at all, with every
verdict/changed/reassessed filter done in JS over the full in-memory array), `app/pipeline/page.tsx`,
and `app/pipeline/pricing/page.tsx` (the latter two only ever using rows to look up
`categories`/`verdict` for tenders this company has actually pursued). **This is the same class of
bug PR #111 fixed** ("Fix Market Intelligence silently reading a 2.5% sample, not the real table",
`lib/marketPricing.ts`'s own `fetchAllRows()`/`POSTGREST_PAGE_SIZE` comment): PostgREST silently
caps any single `.select()` response at 1000 rows (`db-max-rows`, confirmed live during that PR's
own investigation) regardless of a client-side `.limit()` past it - so an unpaginated discovery
fetch wasn't just slow, it would eventually start silently truncating and showing wrong
counts/filters once a company's scored history passed 1000 rows. Treated as a real, found
defect-in-waiting, not a hypothetical - exactly per the task brief.

**Fixed, pure application-code, no schema/migration change** (the table was already indexed for
exactly this access pattern - `discovered_opportunities_company_verdict_idx (company_id, verdict)`
and `discovered_opportunities_company_first_seen_idx (company_id, first_seen desc)`, migration
0004):

1. **Pipeline + Pipeline Pricing**: both queries narrowed with `.not("tender_id", "is", null)`.
   Verified safe by reading `pursue_discovered_opportunity()`'s full history across migrations
   0018/0024/0051 - the 0024/0051 redefinitions (`create or replace function`, which wins) always
   `update discovered_opportunities set tender_id = t_id where id = opp.id` the moment a tender is
   pursued, and the opportunity upsert key is `(company_id, ocid)` (one row per company per ocid,
   `seed_supabase_opportunities.py`), so every row either of these two pages' ocid/contract_number/
   tender_id lookup can ever match already has `tender_id` set. Narrowing drops only opportunities
   neither page reads anyway (never pursued into a `tenders` row), never one the lookup still needs.
   Zero UI/behaviour change.
2. **Discovery page pagination**: a growing `.range(0, show)` window (default 30, `PAGE_SIZE` in
   the new `lib/discoveryPagination.ts`), fetching `show + 1` rows each time to know for certain
   whether a further row exists (no extra count query) and capped at `MAX_SHOW = 300` (10 "Load
   more" clicks). **Chosen over true keyset pagination** (which the task preferred and the index
   supports directly) because expressing a keyset tuple comparison
   (`WHERE (first_seen, id) < (cursor)`) in supabase-js means a hand-rolled `.or()`/`.and()`
   PostgREST filter string, and this sandbox has no live Supabase project to verify that string
   against (same standing gap as every other page in `docs/specs/System-Status.md`) - a silently-
   wrong hand-rolled filter is a worse failure mode than the bug being fixed. The growing-limit
   approach uses only ordinary `.order()`/`.range()` calls, never skips or duplicates rows under
   concurrent inserts the way classic increasing-OFFSET pagination can (there is no offset - a new
   row inserted between "Load more" clicks just appears at the top of a bigger, still fully
   consistent window, like a refreshed inbox), at the cost of re-transferring already-seen rows on
   every click instead of only the incremental delta - bounded and cheap given `MAX_SHOW`. True
   keyset is a reasonable follow-up once there's a way to verify a compound PostgREST filter
   against a real project. Full reasoning + the "open downgrade bump-to-top is now only within the
   loaded window, not the whole table" tradeoff (addressed below) are in `discoveryPagination.ts`'s
   own module comment and in the page's inline comments.
3. **Verdict filter tabs pushed into the query.** Strong fit/Needs review/Not a fit are now
   `.eq()`/`.in()` on the indexed `verdict` column server-side (`verdictQuerySpec()`, pure and unit
   tested). Per-tab counts are their own `{count:"exact", head:true}` queries (5 total, run in
   parallel, no row data transferred) instead of scanning the fetched array - and are real,
   company-wide exact counts (`count:"exact"` is accurate even past PostgREST's 1000-row *data*
   cap - only the row data is capped, confirmed by the same Content-Range behaviour PR #111 found).
4. **Re-assessed turned out to be a real, full-history filter, not just a scoped one** - the task
   flagged this as worth checking (`downgraded_from`/`downgrade_acknowledged_at` are real columns
   on the row), and it checks out: `.not("downgraded_from", "is", null)` is both the main-query
   predicate and its own exact count, so the Re-assessed tab now genuinely searches this company's
   entire downgrade history (paginated the same growing-window way), not just whatever's loaded on
   "All". **Changed is the one tab that stays an honest, scoped limitation** - it needs a
   cross-reference against `tender_listing_changes`, which isn't a column on `discovered_opportunities`,
   so it can't become a WHERE clause without a schema change (a dedicated view/function - see the
   proposal below). It only searches whatever window is currently loaded (shown with its own
   explanatory note on the page, and its count badge is only ever computed while that tab is open -
   "–" otherwise rather than a fake number elsewhere).
5. **The open-downgrade warning banner at the top of the page** got its own small, separately-scoped
   query (`.not("downgraded_from","is",null).is("downgrade_acknowledged_at", null)`, row data capped
   at 200 with an honest "200+" shown past that, but the *count* itself is always the true,
   un-truncated total) so it stays accurate across the company's full history regardless of which
   page/tab is currently in view - it no longer silently undercounts once history grows past
   whatever's loaded. Its "Show re-assessed tenders" link is how every open downgrade stays
   reachable even though the in-window bump-to-top (unchanged visual behaviour) can no longer
   guarantee an old one appears on the very first screen of "All".
6. **The `tender_listing_changes` ocid lookup** now naturally only chunks over the current window's
   ocids (it operates on `rows`, which is now bounded) - fell out for free from the pagination
   change, no separate work needed, confirmed by reading the data flow rather than assumed.
7. **Interaction with `lib/marketPricing.ts`'s `MAX_PRICING_LOOKUPS = 40` cap** (PR #120,
   Opportunities card enrichment): **not touched in this batch**, and worth noting precisely because
   that PR is still open/draft, not merged (see the coordination note below, despite this task's
   own brief describing it as "just-merged" - checked directly via the GitHub API, not assumed).
   Once this pagination lands, that cap stops being load-bearing on its own (a page can no longer
   show more than `MAX_SHOW` cards at once, so `MAX_PRICING_LOOKUPS` will rarely if ever actually
   bind) - not a loose end, just worth whoever reconciles the two branches knowing why.

**A real cross-session coordination finding, not assumed.** This task's own brief described PR #120
as "just-merged" - it is not: `gh api repos/.../pulls/120` shows `draft: true, merged: false` as of
this pass, and its diff substantially rewrites the same `renderDiscovery()` function this batch
touches (countdown chips, compliance/pricing/"done similar tenders before" insight cards), including
logic that scans the company's **full, unpaginated** `rows` array on purpose (`buildDoneHistory()`
needs every tender this company has ever pursued, not just the current page, to answer "done N
similar tenders before"). **This is a real, substantive merge/semantics conflict for whoever lands
second, not just a textual diff conflict** - PR #120's "done similar tenders before" feature will
need to either accept running over a bounded window too (losing some historical matches) or get its
own separate, targeted query once this pagination merges. Flagging this explicitly here rather than
leaving it only in chat/PR description, per this file's own standing discipline. PR #118
(discovery-scoring-diagnosis) is also still open/draft but touches only `engine/discovery/`
Python files, not `page.tsx` - no overlap there.

**Verified**: `npm run verify` (0 errors, confirmed the two pre-existing warnings - `Logo.tsx`'s
`<img>` and `analytics/page.tsx`'s unused `STAGE_META` import - predate this branch, both traced to
commits before this work), `npx vitest run` 144/144 (unchanged - no vitest-covered logic touched),
`npx tsx --test` over every `*.test.ts` file 88/88 (76 existing + 12 new in
`discoveryPagination.test.ts`, covering `parseShowParam`/`nextShow`/`hasMore`/`canLoadMore` and the
verdict-to-query-filter mapping), and `node --experimental-strip-types --test` per file individually
- same 88/88, both sweeps agree. A temporary dev-only mock-data route
(`app/design/screenshot-discovery`, deleted before commit - confirmed via `git status` showing only
the real feature files) rendered the real pagination/filter logic from `lib/discoveryPagination.ts`
(imported directly, not reimplemented) against an in-memory mock dataset at 1440x900 and 390x844 via
Playwright (a temporary `playwright-core` dev install, removed again after - `npm uninstall
playwright-core`, confirmed no `package.json`/`package-lock.json` diff remains): clicked "Load
more" (window grew from 30 to 55 rows, button correctly disappeared once no more existed), clicked
through Strong fit/Needs review/Not a fit/Changed/Re-assessed tabs (each filtered server-side
correctly; Re-assessed showed all 5 ever-downgraded mock rows including 2 un-acknowledged ones
bumped to the top with the warning border, confirming it is NOT scoped to a window; Changed showed
its scoped-limitation note and only the 5 mock rows with a matching "listing change" inside the
loaded window). Not verified: against a live Supabase project or real authenticated session (same
standing gap as every other page in this file) - the mock route therefore also skipped `AppShell`
(sidebar/topbar), which needs a real session and wasn't the part under test.

**Explicitly out of scope - proposed for Sarel's own review, not built:**
- **A real DB-side full-text/buyer/title search box** - would want a trigram index or similar, a
  schema change.
- **A dedicated SQL function/materialized view so "Changed" (and, if ever needed again, a cheap
  "Changed" count) can search this company's FULL history, not just the loaded pages** - also
  schema work. Re-assessed no longer needs this (see above - it turned out to reduce to a real
  column predicate), so this follow-up is narrower than the original task brief anticipated: only
  "Changed" (the `tender_listing_changes` cross-reference) would benefit.
- **A retention/archival policy for old `discovered_opportunities` rows** (e.g. auto-dropping
  `not_a_fit`/`closed` rows after N days) - could independently fix a lot of the scaling problem at
  the source, but is a product/data-retention decision for Sarel, not something to decide here. The
  pagination/filtering fix in this entry works regardless of whether such a policy ever exists, but
  would need less of it (smaller `MAX_SHOW`, fewer "Load more" clicks to reach deep history) if one
  did.

---

### Reconciling PR #120 (Opportunities card enrichment) onto the now-paginated Discovery page

PR #120 (`feature/opportunities-card-enrichment`) built five real additions to each Opportunities
card from Sarel's own live feedback (2026-10-22): a closes-in countdown, a company-readiness
indicator, a "done N similar tenders before" history match, a market-pricing-range lookup, and
conditional scope/pricing-model display. It was opened against the OLD, pre-pagination `main` and
was never merged - PR #123 (the `discovered_opportunities` scaling fix directly above this entry)
landed first and rewrote the same `renderDiscovery()` function PR #120 touches, which PR #123's own
entry above flagged explicitly as "a real, substantive merge/semantics conflict for whoever lands
second, not just a textual diff conflict." This entry is that reconciliation, done by hand (not a
blind `git merge`/`git cherry-pick`) onto `main`'s current, already-paginated
`app/app/discovery/page.tsx`.

**The one real conflict, exactly as PR #123 diagnosed it.** PR #120's `buildDoneHistory()`
(`lib/opportunityInsights.ts`) needs every past opportunity this company has pursued to at least a
submitted bid, to answer "done N similar tenders before" honestly. Before PR #123, the page's own
`rows` variable WAS this company's entire scored-opportunity history, so passing `rows` into
`buildDoneHistory()` worked. After PR #123, `rows` is only the current bounded page/filter window
(`PAGE_SIZE=30` by default, up to `MAX_SHOW=300`) - feeding that windowed `rows` into
`buildDoneHistory()` would silently undercount history matches for any company with more pursued
history than what's currently loaded on screen. Exactly the same class of bug this whole session's
other PRs (#111, #122, #123, #124) have been hunting and fixing - this must not ship as a
regression, and it doesn't.

**The fix**: `buildDoneHistory()`'s own pure-function signature in `lib/opportunityInsights.ts` is
UNCHANGED from PR #120 - only what `discovery/page.tsx` passes into it changed. The page now runs a
second, dedicated, un-paginated query in the SAME `Promise.all(...)` as the existing queries (not
serially after it):
```
supabase.from("discovered_opportunities").select("tender_id, buyer, categories").not("tender_id", "is", null)
```
identical in shape and reasoning to `app/app/pipeline/page.tsx`'s own query after its PR #123 fix -
this is safe because `pursue_discovered_opportunity()` always backfills `tender_id` the moment a
tender is pursued (verified across migrations 0018/0024/0051, same verification PR #123's own entry
above already did for the pipeline page). A company's own pursued pipeline is naturally small - one
row per OCDS release that became a real tender - unlike the full scored-opportunity table the page
itself must paginate, so this query needs no pagination of its own. `buildDoneHistory()` is now fed
these rows (`pursuedHistoryRows`), not the windowed `rows`, so it always sees this company's FULL
pursued history regardless of which page/filter window is currently showing.

**Proven with a real test, not just asserted**: `lib/opportunityInsights.test.ts` has a new case
("a pursued match outside a 30-row paginated window is still counted") that builds a 400-row mock
dataset with exactly one pursued/won match sitting at index 349 - well outside any default
PAGE_SIZE=30 slice - and shows that feeding `buildDoneHistory()` a plain windowed slice silently
drops the match to zero (the regression this whole fix exists to prevent), while feeding it the
dedicated-query-shaped full set finds it correctly. This is the regression PR #123's own entry
warned about, reproduced and then shown fixed, not just described.

**The other four PR #120 features - verified unaffected by pagination, confirmed by reading the
code, not assumed**:
- **Closes-in countdown** (`closingCountdown()`, new export on `lib/dates.ts`) - operates per-card
  only, no history dependency. Unaffected, unchanged from PR #120.
- **Company-readiness/compliance indicator** (`fetchCompanyReadiness()`) - called once per page
  render inside the same `Promise.all(...)` as everything else, company-wide, not per-row or
  history-dependent. Unaffected, unchanged from PR #120.
- **Market pricing range** (`pricingCategoriesFor()`/`pricingSegmentKey()`, `lib/marketPricing.ts`,
  capped at `MAX_PRICING_LOOKUPS = 40`) - operates on whatever cards are in the CURRENT rendered
  `visibleRows` window, which is fine: pagination (PR #123) already means fewer cards per page than
  before PR #123 was ever drafted, so this cap will rarely if ever actually bind now. Noted plainly
  here, not treated as something to "fix" - exactly the interaction PR #123's own entry above
  predicted, and the cap is kept anyway as a correct belt-and-braces guard (see this constant's own
  comment in `discovery/page.tsx`).
- **Scope/pricing-model conditional display** (`tender_scope_records`, migration 0060) - per
  already-pursued row within the current `visibleRows` window, not history-wide. Unaffected,
  unchanged from PR #120 (still honestly rare today - `engine/discovery/tender_enrichment.py` is
  still never invoked by the production discovery pipeline, same standing follow-up PR #120 itself
  flagged, not re-litigated here).

**Self-review, 3 full rounds**: round 1 - re-read `lib/discoveryPagination.ts`'s own module comment
and the current (post-#123) `discovery/page.tsx` in full before writing anything, to work from the
file's real current shape rather than PR #120's stale diff assumptions. Round 2 - traced every one
of PR #120's five features through the new tabbed/paginated/windowed structure one at a time,
confirming each renders correctly and that only the history-match feature had a real
pagination-window dependency (matching PR #123's own diagnosis - no other hidden dependency found).
Round 3 - confirmed directly in the diff that the new pursued-history query is a sibling array
entry inside the existing `Promise.all(...)` (parallel), never a second `await` after it, and that
`buildDoneHistory()`'s call site now reads from `pursuedHistoryRows`, never from `rows` or
`visibleRows`.

**Verified**: `rm -rf .next && npm run verify` - 0 errors (the same 3 pre-existing warnings as PR
#123's own pass - `Logo.tsx`'s two `<img>` warnings and `analytics/page.tsx`'s unused `STAGE_META`
import, confirmed present on `main` before this branch touched anything). `npx vitest run` -
147/147 (unchanged from main's baseline - no vitest-covered logic touched by this reconciliation).
Full `node:test` sweep both ways: `npx tsx --test $(find . -name "*.test.ts" -not -path
"*/node_modules/*")` - 104/104 (88 baseline + 7 in `dates.test.ts` + 9 in
`opportunityInsights.test.ts`, the latter including the new regression-proof case above); the same
set run individually via `node --experimental-strip-types --test <file>` - 104/104, both sweeps
agree (the same pre-existing 5 zero-test `app/tenders/[id]/*.test.ts` files PR #120's own entry
already noted as an unrelated quirk of single-file invocation, not something this reconciliation
introduced or touched).

PR #120 itself is closed (superseded, not merged) once this reconciliation branch is open, with a
comment pointing to the new PR - avoids leaving a stale, now-conflicting original open alongside its
own replacement.

---

### Company vault: always-visible progress summary + grouped sub-nav (Sarel's own live feedback)

Sarel's next piece of live feedback tonight: "Company vault need a similar improvement to see
progress, number of docs uploaded and missing, people uploaded and missing docs per person. also
see if there is a better way to do the layout and how to get to the different sections it feel
intimidating for an initial users... it need to be completely clear how the process and flow
works." Two real gaps, both addressed without a second completeness mechanism: Company vault had
no document count anywhere, no per-person CV status anywhere, and People wasn't linked from this
page at all (not in `RegisterLinks`' card grid, not in the sub-nav).

**Progress summary**: new `VaultProgressSummary.tsx` - two always-visible cards (not inside a
section you have to open), right under `BidReadinessCard` at the top of the page. "Compliance
documents: N of 7 on file" with a link to the missing count when incomplete, and "People / CVs: N
of M have a CV" with up to 4 missing names linked straight to `/people/[id]` plus a "see all" link
to `/people`; a zero-people company instead gets "No one on file yet" + "Add your first person" -
the actual first-attempt state, not a 0/0 that reads as done. Both numbers reuse data `page.tsx`
already computes or trivially extends: `documentsOnFile`/`documentsTotal` loop the same 7
`VAULT_DOCUMENTS` keys `ComplianceDocumentsSection` already renders one row per (counted, not
re-derived as a second array); the per-person CV set is the one new `people(id, name)` query added
alongside the `cv_uploads` read the bid-readiness score already made, kept instead of discarded
once its count was taken. Deliberately not a second progress bar/percentage - `BidReadinessCard`
above it still owns "the one score" for this company; this is the concrete, countable version of
the same underlying facts (its own file's doc comment: "these surfaces can't quietly disagree").

**Grouped sub-nav**: `CompanySubNavItem` gained an optional `group` field; `CompanySubNav.tsx`
renders a small uppercase header above each cluster of items that share one (desktop column only -
the horizontal pill row below `lg` stays flat, since a scroller has no good place to inline a
header). `page.tsx`'s `subNavItems` now reads as three clusters instead of one flat 12-item list:
"Required for every tender" (Expiry, Documents, Identity, B-BBEE & CIDB, Bank details), "Team &
experience" (new **People** and **Experience** entries - neither existed in the sub-nav before,
despite both having real `lib/readiness.ts` criteria with hrefs already pointing at `/people` and
`/experience` - plus Registers), "Other company info" (Size & offices, Time & cost saved, How we
work, Notifications, Letters, Offices). Two new completion ticks reuse existing criteria exactly
like `identityComplete`/`beeCidbComplete` already did (`satisfied("people_cvs")`,
`satisfied("experience")`, `satisfied("bank_confirmation")` for the pre-existing Bank details
entry, which never had one before) - no guessed tick invented for the nav. Grouping only relabels
and reorders the existing items; no section, href, or signal is new besides the two sub-nav
entries themselves (both already real pages).

**Self-review**: round 1 - a dev-only mock route (`/design/screenshot-company-vault`, deleted
before finishing, never committed) rendered the real `VaultProgressSummary` + `CompanySubNav`
components with `computeBidReadiness`-derived mock data, screenshotted at 1440px and 390px in both
a populated state and an all-zero first-time-user state (`?empty=1`). Confirmed: group headers
render correctly above each cluster on desktop, the pill row degrades to a flat horizontal
scroller with no stray headers on mobile, the progress cards stack to one column below `sm:`, and
the empty state reads as "add your first document / your first person" rather than a misleading
0/0. Round 2 - re-checked against Sarel's own two asks: progress (done - two always-visible counts,
missing docs and missing people both link straight to where to fix them) and layout (done - the
sub-nav is now three named clusters instead of one list, and People/Experience are reachable from
it for the first time). Round 3 - confirmed `lib/readiness.ts` and the compliance-docs/field-width
work from the last two batches are untouched: `git diff` shows only `page.tsx`,
`CompanySubNav.tsx`, and the new `VaultProgressSummary.tsx`; `lib/readiness.spec.ts` (6/6) and the
full vitest/node:test suites re-run clean.

**Tested**: `npm run verify` 0 errors, 133/133 vitest, 76/76 node:test both ways (`tsx --test` and
`node --experimental-strip-types` per file). **Not tested**: an actual signed-in render - same
sandbox credential-generation limitation as every batch tonight; the mock-route screenshots above
are the closest available substitute, not a replacement for Sarel clicking it himself.
---

### Feature: real scope/BOQ/quantity extraction engine (BOQ line items, LLM-assisted scope, backlog pagination check)

Sarel's own request, verbatim: "In the market analysis shown the number of tenders in the system
and stats on them. We need an engine that assess and extract the scope of each tender even the
backlog so that we can. Do analysis on scope and boq and quantities even on historic tenders to
provide insights and trends. Build the extract engines so long we will still finalize what we
analyze and what we visualise." Read literally: the extraction engine only - the analysis/
visualisation layer (`app/app/market-intelligence/`) is explicitly deferred and NOT touched here.

This builds on `engine/discovery/tender_enrichment.py` (migration 0060, 2026-10-18), whose own
module docstring and the `tender_scope_records.boq_summary` column comment both explicitly
anticipated this exact follow-on ("a future real-extraction pass"). No schema change was needed or
made - confirmed by reading migration 0060's own column comments before writing a line of code, and
again at the end of this pass; `scope_source`'s existing check constraint
(`'description_text' | 'document_scope_snippet'`) already had room for the new LLM path (see below -
it reuses `'document_scope_snippet'`, deliberately, rather than adding a third value that would need
a migration).

**What's REAL now (read `tender_enrichment.py`'s own module docstring for the full, precise
breakdown - this is the summary):**

- **BOQ line items** (`boq_summary.items`) - real, deterministic spreadsheet parsing, new module
  `engine/discovery/boq_extraction.py`. Reuses `engine/sanral_fill.Workbook` (this repo's own
  hand-rolled .xlsx/.xlsm zip+XML reader - confirmed, again, that no third-party spreadsheet library
  exists anywhere in this repo before writing this) rather than adding `openpyxl` - `Workbook` turned
  out to already have everything needed except a way to read a whole sheet's shape without already
  knowing which cell holds what, so it gained two new, narrowly-scoped, read-only methods:
  `sheet_names()` and `sheet_grid(sheet, max_rows=5000)` (every existing `Workbook` caller -
  `fingerprint.py`, `fill_financial.py`, `sanral_fill.py`'s own SANRAL-specific code - is unchanged
  and still reads known, fixed cell references exactly as before; confirmed by re-running
  `test_form_field_audit.py`, `test_sanral_b7.py` and `test_tenant_isolation.py` after the change -
  all still pass).
  - **Item shape** (no fixed schema on the jsonb column itself, so documented here and in
    `boq_extraction.py`'s own docstring): `{"description": str, "unit": str|None,
    "quantity": number|None, "rate_zar": number|None, "amount_zar": number|None}`.
  - **Header detection, not a fixed layout**: a row is trusted as a real header only when it matches
    both "description" and "quantity" column-name variants (`HEADER_PATTERNS` - extend this list from
    a real template that doesn't match, never from a guess), each to a *different* column letter.
    Every sheet in the workbook is tried in turn (the priced schedule is rarely sheet 1 - a BOQ
    workbook usually opens on a cover/instructions sheet first).
  - **Three separate "never fabricate" guards**, each with its own test in
    `test_boq_extraction.py`: (1) a sheet with no confident header match at all leaves `items: []`
    with an honest `note`; (2) a header match whose "quantity" column is mostly non-numeric text
    (a coincidental match, e.g. a returnable-schedule Yes/No table) is rejected
    (`MIN_NUMERIC_QUANTITY_RATIO`); (3) a row with real text in the description column but **no
    number anywhere** (quantity/rate/amount all null - a footer note, an instruction, a signature
    line that happens to land in the same column as the real descriptions) is never counted as an
    item - every genuine BOQ row has at least one number attached to it. Caught in this pass's own
    round-2 self-review (a footer-note row was briefly being counted as a zero-info "item" before
    this guard was added) and has its own test
    (`test_footer_note_in_the_description_column_is_not_fabricated_as_an_item`).
  - **Known limitation, honestly flagged, not silently worked around**: a BOQ shipped inside a
    `.zip` (seen live in this pass's own sample run - DBSA's RFP165/2026 "SHEQ Annexures.zip") is not
    unpacked by this CLI's own document fetcher (`_read_document_text()` reads one file at a time by
    URL/extension; it does not reuse `engine/general/requirements.collect_documents()`'s own zip-
    unpacking, which was built for a local directory of already-downloaded files, not one URL at a
    time). Logged plainly ("'zip' is not a text document format this reader handles"), never guessed
    at - a real gap worth closing in a follow-up pass if zipped BOQ bundles turn out to be common on
    non-SANRAL buyers.

- **LLM-assisted scope summary** - new module `engine/discovery/scope_llm.py`, built per
  `docs/specs/AI-Call-Quality-Standard.md` **read in full before writing the prompt**, both required
  parts:
  1. **A prompt specific to this exact job** (`SYSTEM_PROMPT`, `test_scope_llm.py`'s own
     `test_prompt_is_scenario_specific_not_a_copy_of_the_cv_prompt` proves it isn't a copy of
     `extract_cv_fields.py`'s prompt): what the output is for (a cross-tender market-intelligence
     record for real trend-spotting, not a sworn compliance document, but still a real cost if
     wrong); SA-government-tender-specific rules (scope scattered across SCOPE OF WORK/Part
     T1.2/annexures, "the Contractor/Service Provider shall", SBD/MBD/BOQ form references are form
     numbers, not scope); the explicit null-when-unclear + verbatim-quote-evidence rule; and a
     concrete checklist of what "good" looks like for this output (specific to THIS tender's actual
     work vs. a generic restatement of the buyer; every quantity/unit genuinely in the source text,
     not inferred; every claim traceable to a real quote; free of filler like "as required" with
     nothing substantive attached).
  2. **The mandatory 3-pass generate -> review -> revise loop**
     (`extract_scope_with_review()`), each review pass re-reading the source text plus the
     **previous pass's own corrected output** (never the original draft again) - proven by
     `test_review_loop_chains_forward_and_stops_on_clean_pass`, which inspects the actual request
     body sent on the 2nd review call. Stops as soon as a pass reports "No issues found on this
     pass"; if pass 3 still finds a real issue, the result is still returned (the best version found)
     but `needs_human_review` is set and the reason is folded into `source_note` with a
     `"NEEDS HUMAN REVIEW: ..."` prefix - never silently shipped as if it passed its own check
     (`test_review_loop_caps_at_3_passes_and_flags_needs_human_review`).
  - Called **only as a fallback**: `extract_scope_summary()`'s existing fast/free "SCOPE OF WORK"
    heading regex is tried first and kept whenever it succeeds (the task was explicit: don't replace
    working logic with a slower/costlier one for no reason) - the LLM pass only runs when that regex
    finds nothing, real document text exists, and it's at least `MIN_TEXT_CHARS_FOR_LLM_PASS` (400)
    characters long. `scope_source` stays `'document_scope_snippet'` for BOTH paths deliberately (no
    migration needed to add a third check-constraint value): both genuinely came from reading the
    tender's own document; which one ran is distinguishable, if needed, by whether `source_note`
    starts with "LLM-extracted".
  - Same proven LLM-calling convention as `engine/cv/extract_cv_fields.py`, reused deliberately, not
    reinvented: `client.beta.messages.create()` with a `json_schema` structured output, the
    `server-side-fallback-2026-07-01` beta + `"default"` fallbacks pair, the same
    `SetupError`/`TransientError` exception taxonomy, the same `<MODULE>_EXTRACTION_MODEL`
    (`SCOPE_EXTRACTION_MODEL`) env-var-override pattern (default `claude-opus-5-5`).

- **`tender_enrichment.enrich()` now actually receives real document text/BOQ items** when its
  caller supplies them (`boq_items`, `llm_scope_result` - both optional, both None by default) - it
  still does **no I/O itself** (stays a pure function, see its own docstring); only the CLI (`run()`)
  does real I/O. A tender whose documents yield either real `boq_items` or real `document_text` is
  marked `confidence='document_confirmed'`; everything else stays `'heuristic'`, exactly as the
  column always promised.

- **The CLI (`run()`) now actually fetches and reads each tender's own documents** before calling
  `enrich()` - previously it called `enrich()` with no `document_text`/`documents` at all, so every
  row ever written was permanently heuristic regardless of `enrich()`'s own capability. Documents
  come from `discovered_opportunities.document_urls` (join on `tender_id`) - the direct buyer-site
  links captured at discovery time for an eTenders/general tender; `discovered_opportunities` is
  also the only place a tender's `buyer` name is recorded (`tenders` itself has no `buyer` column),
  read from there for the LLM prompt's own context, not guessed from the title (a real bug caught and
  fixed in this pass's own round-1 self-review - the first draft wrongly passed `contract_no` as the
  "buyer"). PDFs are read via `assess_tender.fetch_pdf_text()` (read-only reuse, never modified);
  .docx/.doc/.txt via `engine/general/requirements.read_document()` (confirmed by a prior session's
  own PR #118 investigation to NOT be wired into the live discovery feed - reused here rather than a
  third document-reading path, without touching the live feed itself). **SANRAL tenders'
  `tender_documents` rows are deliberately NOT read for this** - they are blank template workbooks
  uploaded by hand (migration 0001), not the tender's real scope/BOQ content; a SANRAL tender's scope
  still comes from its own title/description (the heuristic path, unchanged).

- **Per-release heuristic hook, going forward**: `gov_sources.fetch_all()` now calls
  `tender_enrichment.enrich_release()` on every merged release (`attach_scope_enrichment()`),
  attaching `release['scope_enrichment']` - the same cheap, free, zero-cost tagging `enrich()`
  always did, just now running on every release as it's discovered, not only once it becomes a
  `tenders` row. Deliberately heuristic-only at this point (no `tenders.id` exists yet for most
  releases - most eTenders releases only get one once pursued, migration 0018 - and no document has
  been downloaded this early) - never fatal (one release's tagging failure is logged and skipped,
  same "one bad release never stops the whole run" discipline `gov_sources.py` already uses
  throughout). The existing per-company scoring fan-out in `watch_new_tenders.py` is completely
  untouched.

**Backlog pagination (step 5) - checked, found already fixed, not re-fixed**: the task's own brief
named this as a real, previously-found bug class (`app/lib/marketPricing.ts`, PR #111 - a
client-side `.limit()` silently truncated at PostgREST's hard 1000-row cap). Read
`company_profiles.RestClient.select()`'s own implementation before assuming anything: it already
loops on `offset`/`limit` (`PAGE = 1000`) until a page comes back short - this was evidently already
fixed (or built correctly from the start) in the Python client, separately from the TypeScript one
PR #111 fixed. No code change was needed. Added `engine/discovery/test_company_profiles.py` anyway -
the Python-equivalent of `marketPricing.spec.ts`'s own `serverThatCapsAt()` test - proving it for
real (a server stand-in capped at 1000 rows regardless of the requested limit; `select()` correctly
pages through 2500 real rows in 3 requests) rather than leaving this as a read-and-trust claim.

**Real backlog-size numbers** - a new `counts` subcommand
(`python3 engine/discovery/tender_enrichment.py counts`) reports the true, paginated total tender
count and how many already have a `tender_scope_records` row, split by confidence, vs. none at all.
Run for real in this sandbox's own configured Supabase project (a dev/test project - `companies`
rows are named things like "E2E Test Construction", "Debug Co", "Fresh Walkthrough Civils", not real
customers; this is NOT the same as checking Sarel's real production backlog size, which needs this
same command run against production credentials): **9 total tenders, 0 already enriched** before this
pass. This is a small, dev-scale number precisely because it's a test project, not evidence about the
real production backlog - the full-backfill proposal below is sized in general terms for exactly that
reason.

**Sample run - a REAL run, not just a mocked one**: this sandbox turned out to have real
(non-placeholder) `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` configured (confirmed live,
read-only, before writing anything) - no `ANTHROPIC_API_KEY` though (confirmed absent, same as every
other LLM-adjacent pass tonight). Ran `python3 engine/discovery/tender_enrichment.py run --limit 20
--all` for real against all 9 real tenders in that project (within this task's own 20-50 sample
bound) - real network fetches of real government documents, real BOQ-candidate detection, real
writes to `tenders`/`tender_scope_records`. Result: **9/9 enriched, 2 document_confirmed (both real
PDFs fetched and read over the network from dbsa-procurement), 7 heuristic** (manual/demo tenders and
one Cape Town RFQ with no attached document URLs). One of the two document-confirmed rows (DBSA
RFQ073/2026) got a real regex-matched "SCOPE OF WORK" snippet genuinely pulled from the live-fetched
PDF text ("2.1 Supply and Provision of Equipment - Supply and provide suitable three (03) X-ray
baggage/item screening machines..."); the other (DBSA RFP165/2026) also matched the regex path but
picked up a less useful snippet (a repeated page header/boilerplate from elsewhere in a 108-page PDF)
- a **pre-existing limitation of the regex-only heading match, not something this pass introduced**,
and exactly the kind of case the new LLM fallback exists to improve on - except the regex path
"succeeded" (found *a* heading) so the LLM fallback correctly didn't run for it, per this task's own
explicit instruction not to replace a working fast/free path. Neither of the 9 real tenders triggered
the LLM fallback for real (every one either matched the regex path or had no document text at all),
so **the LLM scope call itself is still unverified against a live Anthropic API** - proven correct
only via the mocked `test_scope_llm.py` (3-pass loop, chaining, early-stop, cap+flag) and a local,
stub-client demonstration script (not committed) that exercised the real `extract_scope_with_review()`
logic end to end. Real BOQ parsing WAS exercised end to end with a real (synthetic, hand-built)
.xlsx in `test_boq_extraction.py` and the same local demonstration.

**Full-backfill proposal - NOT YET RUN, a sized decision for Sarel, same "propose, don't spend"
discipline this repo already applies to schema risk, applied here to real API cost**:
- Real tender count in whatever project this runs against: check with
  `python3 engine/discovery/tender_enrichment.py counts` first - this sandbox's own project has only
  9 (see above); Sarel's real production count needs checking separately, against production
  credentials, before deciding anything.
- Rough per-tender cost/time, from this pass's own sample run and `scope_llm.py`'s own call shape: a
  tender whose regex heading match fails needs up to 4 LLM calls (1 generate + up to 3 review passes,
  `effort: "medium"`, ~4000 max_tokens each) against `claude-opus-5-5` (or whatever
  `SCOPE_EXTRACTION_MODEL` is set to) - each call sends the tender's own document text (capped at
  `MAX_TEXT_CHARS_SENT` = 60,000 characters) plus the system prompt. **Check current published
  Anthropic pricing for the configured model before relying on a dollar figure here** - this pass
  did not have a live key to measure real token usage/cost against, so any number quoted here would
  be a guess dressed up as a measurement, which is exactly what this standard exists to prevent.
  Order-of-magnitude planning assumption instead: budget for up to 4 LLM calls per tender that
  doesn't have a clean "SCOPE OF WORK" heading (most adverts in this pass's own earlier samples
  across `test_tender_enrichment.py`'s fixtures do state one or have no document text at all, so this
  is likely well under 100% of the real backlog, but that ratio should be measured on a larger real
  sample before committing to a number) - a few seconds of wall-clock time per call, so a few tens of
  seconds per tender needing the fallback, times the real tender count.
- Exact CLI invocation for the full run, once a count and a cost estimate are in hand:
  `ANTHROPIC_API_KEY=... python3 engine/discovery/tender_enrichment.py run --all` (drop `--all` to
  only enrich tenders with no `tags_updated_at` yet, i.e. skip ones already done in an earlier
  partial run).

**Self-review (3 rounds, per this task's own standing rule)**: round 1 - re-read the CLI's own
document-fetch wiring line by line and caught a real bug before it ever ran: the first draft passed
`t.get("contract_no")` as the LLM prompt's "buyer" context, but `tenders` has no `buyer` column at
all (migration 0001) - fixed by reading the real buyer from `discovered_opportunities` alongside the
document URLs (`_tender_context()`, replacing the narrower `_documents_for_tender()`), with its own
new test (`test_tender_context_dedupes_documents_and_reads_the_buyer`) checking the buyer is read
from the right table, not guessed. Round 2 - re-read `boq_extraction.py`'s own item-row filter
adversarially and found it would count a footer/signature line with no numbers as a zero-info "item"
whenever it happened to land in the description column; added the "at least one number" guard and
its own test before moving on, exactly the "does the BOQ parser ever fabricate a line item from a
sheet it genuinely can't read" question this task's own brief asked self-review to specifically
check. Round 3 - re-ran the FULL existing Python test sweep (46 files, all pre-existing, 0 changed by
this pass) plus the new test files, then did the real, live sample run above as the final check
rather than trusting the unit tests alone; re-confirmed the chaining/early-stop/cap-and-flag review-
loop behaviour and the real-paginated-count behaviour both have their own passing tests, not just
read-and-trust claims, per this task's own explicit self-review checklist.

**Tested**: 50/50 Python test files (46 pre-existing + 4 new: `test_boq_extraction.py`,
`test_scope_llm.py`, `test_company_profiles.py`, `test_tender_enrichment_cli.py`), 0 failures,
including `test_form_field_audit.py`/`test_sanral_b7.py`/`test_tenant_isolation.py` re-run to confirm
the new `Workbook.sheet_grid()`/`sheet_names()` methods didn't disturb any existing `sanral_fill.py`
caller. Plus the real, live sample run above (not a substitute for the mocked LLM tests, a
complement to them - this is explicitly the one new LLM call site this pass could NOT verify live, no
`ANTHROPIC_API_KEY` in this sandbox).

**Not touched, per this task's own explicit scope**: `app/app/market-intelligence/` or any other
analysis/visualisation page (what gets analysed/shown is still Sarel's own call); any database
migration (none was needed - confirmed by reading migration 0060's own column comments, twice);
`app/lib/marketPricing.ts`, `app/app/discovery/page.tsx`, `app/app/pipeline/page.tsx`,
`app/app/pipeline/pricing/page.tsx` (other sessions' own in-flight files tonight); the full historic
backlog itself (sized and proposed above, deliberately not run).

---

### Opportunity preferences (SANRAL visibility + discipline interest) - UI preview + schema proposal, DRAFT, not mergeable as-is

Sarel's own live feedback, this session (2026-10-23), after onboarding a new test company: (1) "the
Opportunities list was empty right after onboarding ... to a new user it looks like it is empty",
(2) "in the opportunities page we need to add options to set the opportunity preferences for a
company", (3) "i see also there is by default a sanral bid pulled in, this shouldnt be tehere if the
company is not interested in sanral projects." Items 2 and 3 are treated as ONE feature request (a
company-level "what we care about" concept doesn't exist anywhere in the schema today), per this
task's own framing - not two separate asks.

**Why the Opportunities feed was empty (confirmed, not re-derived) - a real, already-partially-fixed
timing gap, not a bug.** `.github/workflows/daily-discovery.yml`'s own header comment (written by an
earlier session, 2026-10-22) confirms nothing in this repo had ever scheduled
`engine/discovery/watch_new_tenders.py` - the only script that writes `discovered_opportunities`
(migration 0004), which `/discovery` reads - until that session added a daily `cron: "45 2 * * *"`
(02:45 UTC) schedule, since run successfully at least once. A company created between runs can still
see an empty feed for up to ~24h. **Not re-triggered on demand here**: `watch_new_tenders.py` has no
"score just this one company" mode - an on-demand `workflow_dispatch` right after onboarding would
re-score the ENTIRE platform's tender backlog against EVERY company every time anyone signs up, a
real, possibly large repeated cost/runtime decision that is this repo's engine-logic standing rule
to defer, not build blind. **What a `--company-id` flag would need** (proposed, not built): a CLI
flag on `watch_new_tenders.py` narrowing `all_company_profiles()` (engine/discovery/company_profiles.py)
to one company, called from a new onboarding-completion hook (a Supabase Edge Function or a
`workflow_dispatch` trigger from the Next.js side once a company finishes onboarding) instead of the
nightly cron sweeping everyone. Cost tradeoff: one scored-against-full-backlog run per signup, vs.
the current one run per day for everyone - cheaper per event but with a higher QPS ceiling risk if
signups cluster. Sarel's own call, not decided here.

**What's built instead (zero schema, zero engine change)**: the Discovery page's own "Nothing scored
yet" empty-state copy (the `activeFilter === "all"` case only - the other cases were untouched) now
says the scan "runs once a day, overnight" and that first results land "after tonight's run, not
immediately" if a company just signed up or changed its profile - accurate to the real cadence,
without promising anything instant or on-demand that doesn't exist. `app/app/discovery/page.tsx`,
the one string in the existing `EmptyState description` ternary - not a new component, not a
restructure of the filter-tab bar or pagination logic around it (both PR #123/#124/#125's own work,
left untouched).

**Why a SANRAL tender showed up for an unrelated new company (confirmed, not a bug) - two separate,
real mechanisms, both re-verified by reading the actual code this session, not trusted from memory**:

1. `engine/discovery/assess_tender.py`'s `assess_fit()` has its own `elif not known_disciplines:`
   branch with its own code comment: "An empty disciplines list is 'we don't know yet', not 'we
   checked and this is out of scope'" - a deliberate anti-regression fix (an earlier version
   wrongly scored a real SANRAL roads tender as `not_a_fit` for a company with no tagged Experience
   Library items yet). So a brand-new company gets `needs_review`, not `not_a_fit`, for ambiguous
   tenders - confirmed correct/intentional, **not changed here**.
2. Separately - and this is the one that actually explains Sarel's own screenshot - `app/app/pipeline/page.tsx`'s
   "found" column (`renderPipeline()`'s own `if (!pack) { if (t.family === GENERAL_FAMILY || t.status
   !== "open") continue; ... }`) reads the SHARED, un-tenant-scoped `tenders` table directly (migration
   0001's own comment: "Shared across every company - not tenant-scoped") and shows every open,
   non-general-family (i.e. SANRAL-conventional) tender with no pack yet to EVERY company by default,
   regardless of fit score - a completely different code path from the scored `/discovery` feed.
   Confirmed directly in the current (post-#122/#123/#125) `pipeline/page.tsx`, not assumed from an
   older copy.

**The real gap, confirmed**: there is no company-level concept anywhere in the schema of "we don't do
SANRAL/road-construction work, don't show us that board by default" or "we only care about these
disciplines." This step 5's own onboarding-wizard writeup already flagged exactly this ("Preferred
buyers ... not tracked anywhere", "Disciplines you work in ... no company-level disciplines table
exists") - this entry is that gap's first concrete UI pass, not a new discovery.

**A directly relevant precedent, read and reused but NOT touched**: PR #121
(`feature/opportunities-tags-interest-proposal`, still open/draft) already built the same
preview-UI-plus-proposed-schema pattern for a DIFFERENT, adjacent need (per-opportunity company tags
+ interest/decline marker on `discovered_opportunities`, via `lib/opportunityTagsPreview.ts`'s
`useSyncExternalStore`-over-`localStorage` technique). This entry's own preview store
(`lib/opportunityPreferencesPreview.ts`, key `tt_opportunity_preferences_preview_v1`) is a
deliberately SEPARATE module and a separate `localStorage` key - a per-COMPANY concept (which
buyer boards/disciplines the company cares about at all), not a per-opportunity one - so the two
previews cannot collide if Sarel later approves both schemas. PR #121's own files
(`lib/opportunityTagsPreview.ts`, `app/app/discovery/OpportunityQuickActions.tsx`) are untouched -
confirmed by diff: this branch adds no changes to either path.

**What's built, as a real working UI interaction (not a static mock)**:
- `app/lib/opportunityPreferencesPreview.ts` - the browser-only mock store (`localStorage`, read via
  `useSyncExternalStore`, same technique as PR #121's own file, its own separate module). Shape:
  `{ hideSanral: boolean, disciplines: string[] }`. Two pure, unit-tested helpers:
  `sanitizePreferences()` (never trusts raw JSON blindly - degrades to the empty default on any
  malformed shape) and `toggleDiscipline()` (on/off list toggle for the checkbox handler).
- `app/app/discovery/OpportunityPreferencesPanel.tsx` - a collapsed-by-default `<details>` panel
  (so a company that never opens it sees no visible change at all), mounted additively in
  `discovery/page.tsx` just above the existing verdict filter-tab bar (the tab bar itself, and
  everything below/around it, is byte-for-byte untouched - confirmed by diff). Contains: a "Don't
  show me SANRAL / road-construction tenders" checkbox (`hideSanral`), and a discipline
  picker reusing `lib/disciplineTaxonomy.ts`'s existing `taxonomyGroups()` (migration 0040's own
  vocabulary - the SAME list Experience Library tagging and pricing already use, no new taxonomy
  invented). Every interactive element carries a visible "Preview - not yet saved" badge plus
  explanatory body copy: "every choice below lives only in this browser ... reloading on another
  device or clearing your browser data loses it. Nothing here changes what you or your team are
  shown today" - this is load-bearing honesty, not decoration: **nothing in this PR actually hides
  the SANRAL board anywhere** (the Bids/`pipeline/page.tsx` "found" column is completely untouched
  by this branch - a deliberate scope cut, since wiring the preview's `localStorage` state into a
  SERVER-rendered board would mean either a client-side re-filter of server-rendered cards - a
  half-real, confusing middle ground - or pretending a browser-local preview is company data, which
  is exactly the dishonesty this whole pattern exists to avoid). The panel only lets Sarel react to
  the interaction; it changes nothing about what anyone actually sees yet.
- `app/lib/disciplineTaggingNudge.ts` + an additive banner in `discovery/page.tsx` (task item 3,
  zero schema change): `hasNoTaggedDisciplines()` mirrors, read-side, EXACTLY what
  `engine/discovery/company_profiles.py`'s `profile_from_company_rows()` computes for
  `known_disciplines` (`sorted({d for i in items if i.get("tagged_at") for d in (i.get("disciplines")
  or [])})`) - verified by reading that function directly this session, not assumed. The page now
  runs one additional, RLS-scoped `supabase.from("experience_items").select("tagged_at,
  disciplines")` query (same table, same two columns, same no-explicit-`company_id`-filter pattern
  `app/app/experience/page.tsx` already uses, confirmed by reading that file directly before
  committing to this being buildable without new schema) alongside the page's existing
  `Promise.all(...)`. When the result says this company has never tagged a single Experience
  Library item with a discipline, a plain-language banner explains WHY some tenders show "Needs
  review" instead of a tighter verdict, and links to `/experience` to fix it - turning the
  previously-opaque `assess_fit()` behaviour (confirmed correct, not touched) into something a
  first-time user can actually act on.

**Proposed schema (SQL below) - NOT applied, NOT a migration file in this branch** (kept out of
`app/supabase/migrations/` on purpose, same discipline as PR #121), **for Sarel's own review**:

```sql
-- Proposed: company-level opportunity/visibility preferences (Sarel, this
-- session, 2026-10-23: "set the opportunity preferences for a company" +
-- the SANRAL visibility case). A new table, not new columns on `companies`
-- (that table is already 60+ columns of compliance/registration facts per
-- migration 0001 - this is a distinct, optional, UI-preference concern,
-- same reasoning migration 0038's own discovery_seen_releases and 0041's
-- reminder-seen-stores tables used for "a preference/state row that isn't
-- a core company fact"). One row per company, upserted - never multiple
-- rows, so a plain primary key on company_id, not a surrogate id + unique
-- constraint.

create table company_tender_preferences (
  company_id uuid primary key references companies(id) on delete cascade,

  -- Sarel's own concrete case: true = don't show this company SANRAL/
  -- road-construction work by default. Column name intentionally generic
  -- (not "hide_sanral") since the real mechanism this would gate is "the
  -- shared, un-tenant-scoped SANRAL-conventional board on /pipeline" (see
  -- this entry's own writeup on why that board shows every open SANRAL
  -- tender to every company today) - a future second shared board (a
  -- different buyer family) would reuse this same column's intent, not need
  -- a new one, if the product ever adds one.
  hide_sanral_board boolean not null default false,

  -- discipline_categories (0040) slugs this company says it cares about -
  -- reuses the SAME taxonomy Experience Library tagging/pricing already use
  -- (no second vocabulary). Nullable/empty = no stated preference yet
  -- (different from "we checked and care about nothing" - same "we don't
  -- know yet" honesty principle assess_tender.py's own known_disciplines
  -- branch already applies, carried into this table's own default).
  interested_disciplines text[] not null default '{}',

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create index company_tender_preferences_disciplines_idx
  on company_tender_preferences using gin (interested_disciplines);

comment on table company_tender_preferences is
  'One row per company: opt-out of a shared buyer board (hide_sanral_board) and/or the disciplines this company says it cares about (interested_disciplines, discipline_categories 0040 slugs) - distinct from discovered_opportunities.categories (0004, per-tender fit-scoring output) and from PR #121''s proposed discovered_opportunities.company_tags (per-opportunity, free-text search tags) - this is a company-wide, structured statement of intent, read by the UI to filter/hide, never by the scoring engine itself.';

alter table company_tender_preferences enable row level security;

create policy company_tender_preferences_select on company_tender_preferences
  for select to authenticated using (is_company_member(company_id));
-- Same reasoning as 0038/0041's own seen-store tables: any company member
-- may read and write their own company's preferences (not owner/admin-only -
-- this is a shared team setting, not a sensitive compliance fact).
create policy company_tender_preferences_upsert on company_tender_preferences
  for insert to authenticated with check (is_company_member(company_id));
create policy company_tender_preferences_update on company_tender_preferences
  for update to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));
```

**What a real implementation would also need** (documented, NOT built - same "not in this PR"
discipline as PR #120's own schema-gated half):
- `setOpportunityPreferences(hideSanralBoard, interestedDisciplines)` - a server action in a new
  `app/app/discovery/preferencesActions.ts`, upserting the row above (`is_company_member` already
  covers the RLS check; the action itself would still re-check company membership server-side,
  same pattern every other mutating action in this app follows).
- `pipeline/page.tsx`'s own "found" column (`renderPipeline()`) would need its own, SEPARATE follow-
  up change to actually read `hide_sanral_board` and skip those cards - **not built or touched by
  this PR at all**, kept out deliberately (this task's own scope keeps `pipeline/page.tsx`
  untouched, and wiring real visibility logic ahead of the schema landing would be exactly the kind
  of "ships a preview that implies it's already real" this whole pattern exists to avoid).
- `discovery/page.tsx` would read `interested_disciplines` to pre-filter or highlight matching
  verdicts, and `OpportunityPreferencesPanel.tsx` would read/write through the server action instead
  of `localStorage` once the schema exists - the panel's own props/shape were kept close to what
  that real version would need (a flat `{hideSanral, disciplines}` object) specifically so this swap
  is mechanical, not a rewrite.

**Self-review, 3 full rounds** (per this task's own instruction):
1. Re-read the finished `OpportunityPreferencesPanel.tsx` and its mounted position in `page.tsx` as
   a first-time user would see it: collapsed by default, the badge and body copy are the first
   things visible once opened, and no other part of the page (verdict chips, pursue buttons, the
   Bids board) changes behavior based on anything stored here - confirmed by grep: no other file in
   this branch reads `opportunityPreferencesPreview.ts`'s exports except the panel itself.
2. Re-checked the empty-state copy against the real cron (`45 2 * * *` = 02:45 UTC, confirmed by
   re-reading `.github/workflows/daily-discovery.yml` directly this session, not from memory) -
   the new copy says "once a day, overnight" and "after tonight's run", never a specific clock time
   that could drift from the actual schedule, and never implies an on-demand/instant path that
   doesn't exist.
3. Re-verified the discipline-tagging nudge's data source is genuinely readable from the app layer,
   not assumed: read `engine/discovery/company_profiles.py`'s `profile_from_company_rows()` line by
   line, matched its exact `known_disciplines` computation against `disciplineTaggingNudge.ts`'s
   `hasNoTaggedDisciplines()`, and read `app/app/experience/page.tsx`'s own `experience_items` query
   to confirm the same table/columns/RLS-reliance pattern this page's new query now also uses - no
   new scoring-result field was needed, so this shipped as the real thing, not a proposal.

**Verified**: `rm -rf .next && npm run verify` - 0 errors (the same 3 pre-existing warnings every
recent pass on this area has reported - `Logo.tsx`'s two `<img>` warnings and `analytics/page.tsx`'s
unused `STAGE_META` import, confirmed present on `main` before this branch touched anything).
`npx vitest run` - 147/147 (unchanged - no vitest-covered logic touched). Full `node:test` sweep both
ways: `npx tsx --test $(find . -name "*.test.ts" -not -path "*/node_modules/*")` - 118/118 (104
baseline + 9 new in `opportunityPreferencesPreview.test.ts` + 5 new in
`disciplineTaggingNudge.test.ts`); the same set via `node --experimental-strip-types --test <file>` -
118/118, both sweeps agree.

**This PR is intentionally left in draft, not merged.** Like PR #121, the real half of this feature
(actually saving a preference, and actually hiding anything anywhere) is gated on Sarel's own review
of the `company_tender_preferences` schema above - a database decision is his to make, never
something to force through by shipping a preview that quietly implies it already works. The two
engine-level items flagged above (a `--company-id` on-demand scan flag, and wiring
`hide_sanral_board` into `pipeline/page.tsx` once the schema exists) are also explicitly deferred to
him, not built.

---

### Opportunity preferences (SANRAL visibility + disciplines) - built for real, migration 0088 NOT yet applied live

Sarel's explicit sign-off, this session (2026-10-23): he reviewed the `company_tender_preferences`
schema proposed above and approved building the real feature against it - not just reacting to
another preview. This entry replaces the preview end-to-end; `lib/opportunityPreferencesPreview.ts`
and its test (the localStorage-only mock the entry above describes) are deleted, not kept alongside
the real version - one source of truth, not two that could drift.

**Migration**: `app/supabase/migrations/0088_company_tender_preferences.sql` - the exact SQL
proposed above, unchanged (Sarel's own review covered that exact text), **renumbered 0087 -> 0088**
while rebasing onto latest `main`: the same collision pattern this file's own earlier entries
describe (`0084`->`0085`->`0086`->`0087`, each time a different, already-merged migration took the
next number first) had already happened again - PR #74's own `0087_narrative_documents.sql` merged
while this branch was open, so this migration moved to the next free number, same discipline, no
other change. **NOT applied to the live
database from this session** - this environment can reach the real Supabase project over
PostgREST but genuinely cannot run raw DDL (confirmed, see this file's own 2026-10-23 ~19:00 UTC
addendum and `docs/specs/System-Status.md`'s matching entry). **Sarel needs to paste this migration's
SQL into Supabase's own SQL Editor (Project > SQL Editor) before merging** - every server action
below will error with "relation does not exist" against a database that doesn't have this table
yet (both pages degrade gracefully when that happens - see below - but nothing actually saves or
filters until the table is real).

**Server action**: `app/app/discovery/preferencesActions.ts`'s `setOpportunityPreferences(hideSanralBoard,
interestedDisciplines)` - same `requireCompanyId()` tenant-check shape as every other mutating
action in this app (`app/app/tenders/[id]/actions.ts`'s own copy, read directly before writing
this one); companyId is derived server-side from the signed-in user's own `company_members` row,
never taken from the client, so RLS (`is_company_member`, migration 0088) and this extra check
agree by construction. Upserts both columns in one row (`onConflict: "company_id"`), re-validates
every discipline slug against `SLUG_RE` (0040's own slug shape) rather than trusting the client
array, and revalidates both `/discovery` and `/pipeline` since `hide_sanral_board` affects both.

**Panel wiring**: `OpportunityPreferencesPanel.tsx` no longer reads/writes `localStorage` at all -
prefilled from a real row `discovery/page.tsx` reads server-side
(`company_tender_preferences.select("hide_sanral_board, interested_disciplines").maybeSingle()`,
same no-explicit-company_id-filter pattern the page's own `experience_items` query already uses),
and every toggle calls `setOpportunityPreferences()` directly inside `useTransition` - same
direct-invoke-no-form shape as `task-status-button.tsx`'s `advanceTaskStatus` - with an optimistic
local update that reverts and shows an error banner on a failed save. The "Preview - not yet saved"
badge is gone; the body copy now says this is saved to the company's account.

**`pipeline/page.tsx` wiring (task item 4 - explicitly deferred, not built, by the entry above)**:
`renderPipeline()` now also reads `company_tender_preferences.hide_sanral_board` (same
no-explicit-filter RLS read) and, inside the existing `if (!pack) { ... }` guard for the "found"
column, `continue`s past a card when `hideSanralBoard` is true - every remaining branch of that
guard is already narrowed to a non-general-family (i.e. SANRAL-conventional) tender by the
`t.family === GENERAL_FAMILY` check just above it, so this is exactly the shared board the
preference is about, nothing else. A pack that already exists (anything actually pursued) is
completely unaffected - this only ever hides the un-tenant-scoped "found" suggestions, never a
tender this company is already working.

**`discovery/page.tsx` wiring (task item 5)** - deliberately additive, never a filter:
`lib/opportunityDisciplineMatch.ts`'s `matchesInterestedDisciplines()` (new, unit-tested pure
function - expands BOTH the company's stated disciplines and the tender's own categories via
`disciplineTaxonomy.ts`'s existing `expandDisciplines()`, the same call the page's own
market-pricing lookup already makes on an opportunity's categories, so a company that selected a
whole group matches a tender tagged with one of its children and vice versa) is used only to sort
matching tenders first within whatever verdict tab and pagination window is already active - same
window, same count, same cards, nothing hidden or removed. A company with no stated preference
(`interested_disciplines` empty, the default) sees exactly today's order, since the function
returns `true` for everything in that case. A non-matching card (only shown when the company HAS
stated a preference) gets a small muted "Outside your disciplines" badge next to its verdict chip,
with a title explaining it was sorted lower, not hidden - the same honesty discipline every other
badge on this page already follows.

**A real, necessary one-line fix found along the way, not a scope change**: `disciplineTaxonomy.ts`
itself imported `lib/experience.ts` via the `"@/lib/experience"` alias. That's fine for
Next.js/`tsx` (both resolve `tsconfig.json`'s `paths`), but `opportunityDisciplineMatch.test.ts` is
this file's first unit-test importer, and this task's own required sweep
(`node --experimental-strip-types --test <file>`, no bundler, no tsconfig paths resolution) failed
with `ERR_MODULE_NOT_FOUND` on the alias. Fixed by switching that one import to the equivalent
relative path (`./experience.ts`, same directory, same file, same runtime behavior, confirmed by
re-running the full app `verify`/`vitest`/both `node:test` sweeps below) - the only form every
required test runner in this repo can resolve, same reasoning `tender-readiness.ts` already uses
an explicit `.ts` relative import for.

**Self-review, 3 full rounds** (per this task's own instruction):
1. Re-read `discovery/page.tsx`'s diff adversarially: confirmed the new discipline-interest sort key
   sits strictly between the existing open-downgrade sort and the original index tiebreak (never
   overriding the downgrade bump), confirmed `visibleRows`/`changedVisible` for the "Changed" tab
   still derive from the same (now-additionally-sorted) `rows`, and confirmed the "Outside your
   disciplines" badge and the sort use the exact same `matchesInterestedDisciplines()` call so they
   can never disagree with each other.
2. Re-read `pipeline/page.tsx`'s diff adversarially: confirmed `hideSanralBoard` only short-circuits
   inside the `if (!pack)` branch (a card with an existing pack - bidding/submitted/won/lost, or
   already "found" via a manual load - is untouched), and confirmed it reads the same
   `company_tender_preferences` table/column the panel writes, not a stale duplicate.
3. Grepped the whole repo for every remaining reference to
   `lib/opportunityPreferencesPreview`/`setHideSanralPreview`/`setDisciplinesPreview`/the old
   "Preview - not yet saved" copy after deleting that module - none left outside this entry's own
   explanatory prose (confirmed: a dangling import would also have failed `npm run typecheck`/`build`
   below, which it didn't).

**Verified**: `rm -rf app/.next && npm run verify` (`typecheck` + `lint` + `build`) - 0 errors, the
same 3 pre-existing warnings every recent pass on this area has reported (`Logo.tsx`'s two `<img>`
warnings, `analytics/page.tsx`'s unused `STAGE_META` import). `npx vitest run` - 147/147 (unchanged -
no vitest-covered logic touched). Full `node:test` sweep both ways: combined
`npx tsx --test $(find . -name "*.test.ts" -not -path "*/node_modules/*")` - 116/116 (118 from the
preview entry above, minus 9 deleted with `opportunityPreferencesPreview.test.ts`, plus 7 new in
`opportunityDisciplineMatch.test.ts`); the same set run individually via
`node --experimental-strip-types --test <file>` - also 116/116, including the new file (the fix
above was specifically to make this per-file invocation pass, not just the combined one), both
sweeps agree. No `engine/` file touched - Python sweep not re-run.

**This PR stays in draft.** The schema is approved and the code is real (not a preview), but the
migration genuinely is not live yet - merging now would ship server actions and page reads against
a table that, until Sarel runs the SQL above in Supabase's own SQL Editor, does not exist, which
both pages handle gracefully (empty preferences, board stays visible) but is still not the state
this PR is meant to land in.

---

## Opportunity tags + interest/decline: real schema + wiring (migration 0089, 2026-10-23)

Sarel's own live feedback on `/discovery` (2026-10-22: "allow the company to add tags for how to
search and prioritise opportunities. add quick tags to indicate interest or declines.") first
shipped as a browser-only localStorage preview (PR #121, explicitly "DO NOT MERGE" - no schema
existed yet). **Sarel has now reviewed and approved the schema** - this pass replaces the preview
with the real thing: `company_tags text[]` + `interest_marker`/`interest_marked_at`/
`interest_marked_by` on `discovered_opportunities`, real `setOpportunityTag()`/
`setOpportunityInterest()` server actions, and `OpportunityQuickActions.tsx` now reads/writes the
real row instead of `lib/opportunityTagsPreview.ts` (deleted).

**The migration is NOT yet applied to the live database** - same standing limitation as every
session tonight (see `docs/specs/System-Status.md`'s ~19:00 UTC addendum: this sandbox can reach
Supabase over PostgREST but cannot run raw DDL). `0089_opportunity_tags_interest.sql` is committed
and reviewed, but until Sarel pastes it into Supabase's own SQL Editor, every real call to
`set_opportunity_tag()`/`set_opportunity_interest()` will fail with "function does not exist" -
this PR stays in draft for exactly that reason.

**A real gap found in the original PR's own RLS claim, fixed, not just trusted**: PR #121's
description said no RLS change was needed because `discovered_opportunities` already has
`is_company_member`-scoped RLS. True for reads, but reading every migration that touches this
table's RLS (0004, 0048's own precedent, 0055, 0072) confirms `discovered_opportunities` has **no
client UPDATE policy at all** - 0004's own header comment says it plainly ("service-role written"),
and 0055's `acknowledge_discovery_downgrade()` exists for exactly this reason. A column-only
migration with no write path would mean `setOpportunityTag`/`setOpportunityInterest` either need a
new blanket UPDATE policy (a bigger surface than this needs) or fail outright. Instead, two new
SECURITY DEFINER functions (`set_opportunity_tag`, `set_opportunity_interest`) were added to the
same migration file, below Sarel's exact approved column SQL (left untouched, verbatim) - same
shape as `acknowledge_discovery_downgrade`: check the row exists and `is_company_member(company_id)`
inside the function, then write. No new RLS policy; the approved "no RLS change needed" conclusion
holds, just not for the reason the original PR gave.

**"Declined" filter tab (task item 4)**: added to the SAME exclusive, single-select tab list as the
existing verdict filters (`lib/discoveryPagination.ts`'s `VerdictFilter`/`verdictQuerySpec`/
`COUNTABLE_FILTERS`, `page.tsx`'s own `FILTERS`), not a second, independent toggle composed with
them. Reasoning: this list was never strictly "verdict values" - `reassessed` is already
`downgraded_from`, a different column, and `changed` isn't a column at all - it's "what the one row
of filter tabs can show at a time", and Sarel asked for "a Declined filter chip/tab alongside the
existing ones", not a second axis to intersect with the first. Selecting Declined shows every
declined row regardless of verdict, the same way Re-assessed already ignores verdict. A composable
second toggle would need its own query param, a two-dimensional WHERE clause and two
simultaneously-highlighted controls - real complexity not asked for here. `interest_marker` has its
own partial index (migration 0089), so - like `reassessed` - this is a genuine full-history filter
with a real exact count, not a page-scoped JS filter like `changed`.

**Tag suggestions, deliberately page-scoped**: `OpportunityQuickActions`'s "reuse a tag you already
typed" datalist is built from `company_tags` across whatever window of `discovered_opportunities`
is currently loaded (`page.tsx`'s own `allCompanyTags`), not a dedicated company-wide-vocabulary
query - the same documented scoped-limitation `lib/discoveryPagination.ts` already applies to the
`changed` tab. A tag only ever used on a row outside the current window won't suggest until that
row is loaded too; worth a dedicated query later if Sarel wants it, not built blind here.

**Self-review (3 rounds)**: round 1 - re-read the RLS claim adversarially against every migration
touching `discovered_opportunities`'s policies (listed above) rather than trusting PR #121's own
description; found and fixed the missing write path (above). Round 2 - re-verified pagination/count
behaviour from PR #123/#125 is unaffected: `COUNTABLE_FILTERS`/`verdictQuerySpec`/`withVerdictSpec`
are extended (one more case each), not rewritten - every existing filter's query shape is untouched,
confirmed by re-running `discoveryPagination.test.ts`'s pre-existing cases alongside the two new
ones. Round 3 - re-read `OpportunityQuickActions.tsx` end to end for the mock-to-real swap
specifically: no `useSyncExternalStore`/localStorage read left anywhere, `tags`/`interest` always
come from the prop the server component passed down (the real row), and every write path
(add/remove tag, toggle interest) goes through `startTransition()` + the real server action, same
shape as `task-status-button.tsx`/`task-assignee-select.tsx` - no stale "Preview" copy left in the
UI.

**Tested**: `npm run verify` (`rm -rf .next` first) - 0 errors. `npx vitest run` - 147/147 (no
vitest files touched; this feature's new pure-logic test lives in `discoveryPagination.test.ts`,
Node's test runner, same as the rest of that module). Full `node:test` sweep both ways - combined
`npx tsx --test` across every `*.test.ts` file (105/105) and per-file `node --experimental-strip-types
--test` (same count once the pre-existing `[id]`-bracketed-path glob quirk is worked around the way
this repo's own CI does - `node --experimental-strip-types <path>` with no `--test` flag for those 5
files specifically; not a regression, see System-Status.md's own prior notes on this). All green,
including the 2 new `declined`-filter cases in `discoveryPagination.test.ts`.

**Not done, by design**: the migration is not applied live (see above - Sarel's manual step, spelled
out in the PR description). No new RLS policy (verified unnecessary, see above). No dedicated
company-wide tag-vocabulary query (page-scoped suggestions, see above, a reasonable follow-up).
