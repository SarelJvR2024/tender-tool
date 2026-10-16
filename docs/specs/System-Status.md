# System Status

Maintained by the standing solution-architect review pass. This file reflects **current real
state**, verified by reading code and running checks — not a history (see `git log` for that)
and not a restatement of the phased feature list in
`Tender-Tool-Competitor-Feature-Deep-Dive.md` (read that for *what should exist and why*; read
this for *what actually exists right now, and what's inconsistent between agents' work*).

Last full pass: 2026-10-16 (first pass — file created this run; updated once more the same
run after `engine/cv/` landed mid-pass — see its own section below).

## Repo shape, in one paragraph

Two independent codebases share this repo: `engine/` (Python, no shared runtime with the web
app — invoked by hand or cron, writes to Supabase via the service-role key, never imported by
Next.js) and `app/` (Next.js 16 web app, reads/writes Supabase directly under RLS). They meet
only at the Supabase schema (`app/supabase/migrations/`) and at `config/klipcorp_profile.json`
(gitignored real data; `config/dummy_companies/*.json` are the committed synthetic stand-ins).
Three buyer-filling engines now exist side by side under `engine/`: SANRAL (mature, root-level
scripts), `engine/general/` (one script, `.docx`-only SBD forms, built today), and
`engine/cv/` (CV document generator, also built today — see below). All three share the same
pattern: real, verified Python scripts with **no caller anywhere in `app/`** — see Gaps.

## Built and verified — working today

| Area | What it does | How verified |
| --- | --- | --- |
| SANRAL workbook fill (`engine/fill_tender.py`, `fill_conventional.py`, `fill_a_forms.py`, `fill_financial*.py`) | Fills both template families (Conventional 9-sheet, RRM 15-sheet), A-Forms bundle, financial/hours sheets | `engine/admin_harness.py` regression-tests this against 3 dummy companies on every run; real tender runs recorded in git history (e.g. `afad9d2`, `6658b73`) |
| Template fingerprinting (`engine/fingerprint.py`) | Detects a changed SANRAL template before filling | Documented false-positive case already found and understood (README's own "open question") |
| Field-level provenance (`engine/provenance.py`, migration `0002_field_provenance.sql`) | Every written field tagged confirmed/computed/assumed_default/missing | **Now wired end-to-end, not just a CLI/DB concept** — `app/app/tenders/[id]/page.tsx` reads `field_provenance` directly and renders the 3-bucket readiness report (item 32). Spec text calling this "Supabase table only, not yet wired to the web app" is stale — see Drift section below. |
| National tender discovery (`engine/discovery/etenders_national.py`, `assess_tender.py`) | Pulls OCDS feed, scores fit against company profile | `app/app/discovery/page.tsx` reads `discovered_opportunities` and renders the same verdict buckets (`strong_fit`/`possible`/`needs_review`/`not_a_fit`) `assess_tender.py` produces — genuinely wired, not a disconnected feed |
| General (non-SANRAL) SBD form fill (`engine/general/fill_sbd_docx.py`) | Fills SBD1/4/6.1 **`.docx` edition only**, label-matched, refuses PDF/`.doc` | Verified against real downloaded Treasury/RAF samples (see `General-Tender-Engine-Findings.md`); drop-in with `generate_action_checklist.py` | 
| Admin test-company harness (`engine/admin_harness.py`, item 30) | Runs dummy companies through the real SANRAL pipeline, flags shape changes vs. stored baseline | Self-verifying by design (3 real bugs caught per its own commit `d86c84e`) — but **SANRAL-only**, see Gaps |
| Admin results console (`app/app/admin/page.tsx`, item 31) | Plain list of harness runs (dummy company × tender, status, last run) | Real, reads `admin_harness_runs` (migration `0005`), populated by `engine/write_admin_harness_results.py`. **Simpler than the spec's description** — no inline rendering of generated documents, no "mark reviewed" workflow yet; it's the diagnostic list half of item 31, not the full visual queue. Spec marks item 31 "Gap" — that's now wrong, see Drift section. |
| Company vault (`app/app/company/page.tsx`) | Company profile + COID expiry badge | Read-only + edit form both real; expiry coloring now shared (see Fixes below) |
| Onboarding (`app/app/onboarding/`) | One field (legal name) → company + owner row, atomically via `create_company_and_join` | Matches spec's "minimum to get started" principle exactly, verified by reading the SQL function and the page |
| Route guard (`app/proxy.ts`) | Redirects signed-out users to `/login`, no-company users to `/onboarding` | Covers every real app route (`/dashboard`, `/onboarding`, `/tenders`, `/discovery`, `/company`, `/people`, `/admin`) |
| RLS policy set (`0001`–`0005`) | Tenant isolation via `is_company_member()`, shared/public tables explicitly marked as such | Internally consistent — every deviation from the "tenant isolation" default (shared `tenders`, non-tenant `admin_harness_runs`) carries its own comment explaining why. No RLS inconsistency found this pass. |

## In progress / partially built

- **Item 31 (admin review console)** — see table above. Data side (`admin_harness_runs`) and a plain list UI exist; the richer "look at the actual filled document inline, mark reviewed" workflow described in the spec does not yet.
- **CV engine (items 2/4/5 — the product's core niche)** — landed mid-way through this review pass (commit `724f038`, same run as the findings doc `abdef44`). Real, not a stub: `engine/cv/generate_cv.py` builds an actual Word+PDF CV in two confirmed template families (`sanral_keyperson` — mirrors SANRAL's real Form B1.1/B2.1; `world_bank` — the donor-funded structure, confirmed via WebSearch against secondary sources since the primary World Bank PDF wasn't fetchable), each with summary/detailed and standard/tender-customized toggles. The tender-customized cover page reuses `suggest_pack.py`'s own `score_candidate()` — no new matching logic invented. Verified against real data: generated and read back (python-docx + pdfplumber) three real combinations, including correctly raising a specialism warning (Henning's file has no evidence of Pavement and Materials experience, and the generator said so rather than hiding it). Logs every field through `ProvenanceLog`, same honesty model as the rest of the engine. **Still reads `config/klipcorp_profile.json` directly, not Supabase** — same CLI-only limitation as the general SBD filler (see Gap #1, which now applies to this too).

## Known gaps (named, not just "incomplete")

1. **Two of today's three new engine capabilities have zero path into the web app — this is the headline finding of this pass.** `engine/general/fill_sbd_docx.py` (general SBD form fill) and `engine/cv/generate_cv.py` (CV generation — the product's actual stated niche, items 2/4/5) are both real, verified CLI scripts with **no caller anywhere in `app/`** — confirmed by grep across `app/`, zero hits for either. Both also still read `config/klipcorp_profile.json` directly rather than Supabase, so even a hypothetical caller couldn't reach them per-tenant without further work. This is exactly the kind of gap Sarel asked this review to watch for: real, tested capability that a customer using the actual product cannot reach at all today. Concretely, `app/app/people/page.tsx` (where CV generation would surface) has no button, link, or server action anywhere that calls `generate_cv.py` or anything like it. Needs a product decision (own page? a "Generate CV" action on the people/[id] page? folded into a future pack builder?) before either is "done" in any customer-facing sense — flagged for Sarel's call, not built unilaterally here since it's a UI/product design decision, not a mechanical fix.
2. **`admin_harness.py` still only exercises the SANRAL path.** It calls `fill_docx_forms` and `fill_a_forms` only — confirmed by reading its imports. Neither the general-engine filler (`fill_sbd_docx.py`) nor the new CV generator (`generate_cv.py`) has **any dummy-company regression coverage**. If a buyer wording variance ever breaks the label-matcher, or a future `people`/`projects` schema change breaks CV generation silently, nothing catches it automatically the way SANRAL template changes are caught.
3. **CV upload-and-AI-extract (item 2) is not built.** `app/app/people/page.tsx` and `[id]/page.tsx` are still manual add/edit forms, real columns only. This matches what the spec already says (flagged 2026-10-16 as the highest-priority gap in the people flow) — restated here as current-state confirmation, not a new finding.
4. **Dummy-company coverage is 3 profiles, not 4.** `config/dummy_companies/` has `complete_co`, `expired_certs_co`, `new_co`. The spec's own item-30 description names a 4th scenario — "no confirmed specialist for a position the tender requires" — with no matching fixture. Low priority (the spec itself lists "how many dummy companies is enough" as an open question), noted so it isn't silently forgotten.
5. **Dummy companies are not implemented the way the spec describes them.** Spec text (item 30) says dummy companies live "in the same `companies` table as real tenants" behind an `is_test_company` flag. Reality: no such column exists anywhere in the schema (confirmed by grep across all migrations) — dummy companies are local JSON fixtures (`config/dummy_companies/*.json`) consumed only by the Python harness, and `admin_harness_runs` is deliberately *not* tenant-scoped at all (its own migration comment explains why). This is arguably a safer design than the spec's (no risk of a test row ever leaking into a real customer's dashboard by a flag being missed), but it's a real divergence from the written spec. Recommend updating the spec's item 30 description to match reality rather than building the `is_test_company` column it currently calls for — flagging for Sarel's call, not deciding unilaterally since it's a product-doc change, not a code fix.

## Duplication found and fixed this pass

**Date-expiry coloring, two independent implementations.** `app/app/dashboard/page.tsx` had its own `daysLeft()` (closing-date countdown) and `app/app/company/page.tsx` had its own `expiryStatus()` (document-expiry badge) — same color palette (`#DCFCE7`/`#FEF3C7`/`#FEE2E2`) hand-copied into both files, same "days until a date" math written twice. Also found a real behavioral inconsistency while merging them: dashboard's version diffed against `Date.now()` (current instant) rather than midnight-truncated "today", so its days-left count could silently drop by one partway through the day, while the company page's version was already stable. **Fixed**: extracted both into `app/lib/dates.ts` (`daysUntil`, `expiryStatus`), standardized on the midnight-truncated (more correct) version, updated both pages to import it. Verified: `npm run typecheck` and `npm run lint` pass clean; `next build` compiles and type-checks successfully (fails only at the prerender step for the unrelated, pre-existing reason that this environment has no live Supabase credentials — same failure any agent would hit without `.env.local` populated).

## Git-history oddity checked, no fix needed

Two commits, same session (`session_01PAw7oeNsQgNdYpS5qH2b1R`), one minute apart, **identical commit message** "Add Tender Workspace readiness report page": `c872190` and `c38a2e5`. Diffed both directly — `c872190`'s actual diff is the admin harness console (`app/app/admin/page.tsx`, `HarnessRunRow.tsx`, migration `0005`, `write_admin_harness_results.py`); `c38a2e5`'s actual diff is the real readiness-report page (`tenders/[id]/page.tsx`, `actions.ts`, `review-button.tsx`). This is the shared-index git race the handover note already warned about — the agent built two features in one run and a race mislabeled which diff landed under which commit message. **No functional inconsistency**: both feature sets are present and correct in the working tree; only the historical commit message for `c872190` is wrong. Not rewriting shared `main` history over a cosmetic label — noted here instead so nobody goes looking for a "readiness report" commit and gets confused by `c872190`'s actual contents.

## QA / stability

- **`app/scripts` verification**: added `npm run typecheck` (`tsc --noEmit`) and `npm run verify` (`typecheck && lint && build`) to `app/package.json` this pass, so one command covers what every agent has been running by hand across three separate commands.
- **Migration numbering**: `0001`–`0005`, sequential, no collisions. No two agents independently wrote the same migration number.
- **RLS review**: every policy either follows the tenant-isolation default (`is_company_member(company_id)`) or carries an explicit comment explaining why it doesn't (shared read-only `tenders`, non-tenant `admin_harness_runs`). No mismatched pattern found.
- **`admin_harness.py` currency**: real and still running the SANRAL path correctly, but see Gap #2 above — it has not grown to cover the new general engine.

## Open items for Sarel's own call (not decided here)

- Gap #1 and #2 above (general SBD engine *and* the new CV engine both have no web-app entry point, and neither has harness coverage) — these are product/architecture decisions (where does CV generation live in the UI — people page? a new tender workspace action? is a second harness worth building now or after a second real non-SANRAL customer?), not something to build unilaterally in a status-doc pass. Given the CV niche is the product's actual stated differentiator (see the competitor deep-dive's own gap analysis), this is the highest-value gap to close next, ahead of more engine depth.
- Gap #5 (dummy-company mechanism vs. spec text) — recommend updating the spec rather than building the `is_test_company` column, but that's a call on the spec document, left to Sarel or the agent who wrote that section.
