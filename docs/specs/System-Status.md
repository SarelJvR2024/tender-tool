# System Status

Maintained by the standing solution-architect review pass. This file reflects **current real
state**, verified by reading code and running checks — not a history (see `git log` for that)
and not a restatement of the phased feature list in
`Tender-Tool-Competitor-Feature-Deep-Dive.md` (read that for *what should exist and why*; read
this for *what actually exists right now, and what's inconsistent between agents' work*).

Last full pass: 2026-10-16 (first pass — file created this run; updated twice more the same
run, once after `engine/cv/` landed mid-pass, once after Sarel's "test company" rename and
the CV upload-as-is spec addition arrived via a cross-session message — see below).

**Check-in at 16:12 UTC the same day:** scheduled routine fired, ran the full checklist again.
`git log` on `origin/main` is unchanged since the last commit this file records (`27e418e`) —
no other agent landed anything in between. Re-confirmed the two headline gaps are still open
(no caller anywhere in `app/` for `engine/cv/generate_cv.py` or `engine/general/fill_sbd_docx.py`
— re-ran the same grep, still zero hits) and re-ran `npm run typecheck` / `npm run lint`, both
still clean. Nothing to fix, nothing new to flag — recorded here rather than silently skipping
the check-in, so a quiet pass is visible as "checked, nothing changed" rather than looking like
it didn't happen.

## Check-in: role-based daily digest engine (2026-10-16, this pass)

Built in response to Sarel's explicit request: define tender-workflow roles first, then a
role-based daily digest. Landed alongside, in the same shared working tree, concurrently with
another agent's document-expiry/tender-task work (`engine/compliance/watch_deadlines.py`,
migration `0009_tender_tasks.sql`) - confirmed by `git log`/`ls` mid-pass, not duplicated;
this pass's engine **calls** that script's functions rather than re-reading `tender_tasks` or
`companies` itself. Migration number collision avoided by renumbering this pass's migration
from `0009` to `0010` once the other agent's `0009_tender_tasks.sql` was seen on disk.

**Built:**
- **Role definitions + notification content matrix** - new section in
  `docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md` ("Roles and the role-based daily
  digest"). Five roles (full_cycle, validator, cv_admin, finance, viewer), each tied to real
  pages/actions, not an abstract permission system - per the doc's own scope-discipline rule.
  Flagged explicitly rather than guessed: workflow role is global-per-user, not
  per-tender-assignment (no `tender_assignments`-style table exists anywhere in the schema to
  hang a per-tender role off), and the matrix's filtering for `cv_admin`/`finance`/`validator`
  is approximated by keyword-matching free-text fields (`tender_tasks.description`,
  `field_provenance.field_key`) since neither has a real category/criticality tag today -
  both approximations are named as such in the spec and in the code, not hidden.
- **Migration `0010_add_tender_workflow_role.sql`** - `company_members.tender_role`
  (nullable text, checked against the five role values; null = full_cycle). Verified for
  real: replayed the full migration chain (`0001`→`0007`, `0009`, `0010`; `0008` skipped - it
  needs a live Supabase `storage` schema, not reproducible on vanilla Postgres, a pre-existing
  limitation unrelated to this change) against a scratch local Postgres 16 instance with a
  stubbed `auth.users`/`auth.uid()`; all applied cleanly, `company_members.tender_role`
  confirmed present with the right type/nullability/check constraint via
  `information_schema.columns`.
- **`engine/notify/daily_digest.py`** - builds one filtered digest per person per the matrix
  above. Reuses, does not reimplement: `assess_tender.py`'s `assess_release()` for new-tender
  fit (via a fresh OCDS fetch, same as `watch_new_tenders.py`); `watch_new_tenders.py`'s own
  `REPORT_WORTHY_VERDICTS` constant (imported, not redeclared); `watch_deadlines.py`'s
  `find_due_documents()`/`find_due_tasks()` directly, unchanged, for live-mode document-expiry
  and tender-task signals. New code only for reading `field_provenance` (nothing else in the
  repo reads it outside the Next.js app) - implemented with its own seen-store
  (`state/seen_digest_readiness.json`, same pattern as the other two watch scripts) so it
  reports genuine status *changes*, not just "currently flagged" on every run.
- **Two run modes**, because this environment still has no live Supabase project (confirmed
  again this pass: no `app/.env.local`, no `NEXT_PUBLIC_SUPABASE_URL`/
  `SUPABASE_SERVICE_ROLE_KEY` set). `--mode live` reads Supabase directly (company_members,
  companies, tender_tasks, field_provenance) - **written but not run against a real project,
  flagged honestly, same gap every Supabase-reading script in this repo has had since day
  one**. `--mode local` (the mode actually run and verified) uses a small roster JSON
  (`config/team_roster.json`, gitignored like `klipcorp_profile.json`; `.example.json`
  committed) standing in for `company_members` until a live project exists, and reads
  document-expiry straight from the company profile JSON (richer today than the Supabase
  schema - COID, SARS TCS PIN, professional indemnity, all three real fields in
  `klipcorp_profile.json`) since `watch_deadlines.py`'s own `TRACKED_EXPIRY_FIELDS` is
  (correctly, per that script's own docstring) limited to the one expiry column the schema
  actually has.
- **No new UI built.** Checked first and confirmed by grep: there is no team-members/roster
  page anywhere in `app/app/` today - `company_members` has zero UI surface, not even a list.
  Adding a role picker would mean building that whole page from nothing, which is a bigger
  piece of product/UI work than "assigning a role to a person needs a minimal picker" (the
  instruction's own bar) - flagged for Sarel's call, not built unilaterally. Until it exists,
  `tender_role` is set directly via the Supabase dashboard/SQL (documented in the column's own
  comment).

**Verified for real, not just syntax-checked:**
- Migration replay against scratch Postgres (above).
- `npm run typecheck` and `npm run lint` both pass clean on the current tree (no TS/TSX files
  touched by this pass - no UI was built, see above).
- `python3 daily_digest.py --mode local --roster config/team_roster.json --days 3
  --no-fetch-documents` run against the real national OCDS feed and the real
  `klipcorp_profile.json`: fetched 100 real releases (hit the OCDS API's own known ~500-record
  page-2 500-error limit, degraded gracefully per `etenders_national.py`'s existing handling,
  exactly as documented elsewhere in this file), produced 5 real per-person digests (one per
  role) with correct section visibility per role confirmed by reading the output JSON back:
  `full_cycle` got all 5 sections, `cv_admin` got only `tender_tasks`/`readiness_changes` (both
  empty - no live Supabase data to read, expected), `viewer` got the 3 count-only sections with
  numeric counts not raw rows, `document_expiry` correctly empty for everyone (both real expiry
  dates on file - COID 2027-04-30, SARS TCS 2027-06-24 - are >60 days out, so nothing should
  have fired, and nothing did). `--mode live` with no env vars set correctly refuses with a
  clear error rather than crashing.
- `--mode live`'s Supabase-reading paths (`find_readiness_changes`, `load_roster_live`,
  `watch_deadlines`'s own functions) are **not** verified against a real project - no live
  Supabase project exists in this environment, same limitation this file has recorded for
  every other Supabase-writing/reading engine script to date.

**Known gaps, named:**
- Readiness-change and tender-task signals are empty in every digest produced so far, purely
  because local mode has no fixture for either (both are Supabase-only data) - not a bug, a
  consequence of this environment's missing live project, same as the rest of this file's
  running "no live Supabase" caveat.
- The `cv_admin`/`finance`/`validator` keyword-based filtering (see spec section) will
  misclassify some real free-text task descriptions and field keys - acceptable as a first
  pass per the matrix's own "when uncertain, omit rather than over-include" rule, but should
  be replaced with a real tag/category column on `tender_tasks` and `field_provenance` once
  real usage shows which keywords actually matter.
- No real email is sent by this script (same explicit boundary as `watch_new_tenders.py` and
  `watch_deadlines.py` - confirmed again this pass by grepping the whole repo for
  smtp/sendgrid/resend/nodemailer/send_email/mailgun: zero hits anywhere). The only real
  notification channel today is the scheduled check-in that emails Sarel directly from these
  scripts' JSON output - this script's `--out` JSON is written to be read the same way.

## Repo shape, in one paragraph

Two independent codebases share this repo: `engine/` (Python, no shared runtime with the web
app — invoked by hand or cron, writes to Supabase via the service-role key, never imported by
Next.js) and `app/` (Next.js 16 web app, reads/writes Supabase directly under RLS). They meet
only at the Supabase schema (`app/supabase/migrations/`) and at `config/klipcorp_profile.json`
(gitignored real data; `config/test_companies/*.json` are the committed synthetic stand-ins).
Three buyer-filling engines now exist side by side under `engine/`: SANRAL (mature, root-level
scripts), `engine/general/` (one script, `.docx`-only SBD forms, built today), and
`engine/cv/` (CV document generator, also built today — see below). All three share the same
pattern: real, verified Python scripts with **no caller anywhere in `app/`** — see Gaps.

## Built and verified — working today

| Area | What it does | How verified |
| --- | --- | --- |
| SANRAL workbook fill (`engine/fill_tender.py`, `fill_conventional.py`, `fill_a_forms.py`, `fill_financial*.py`) | Fills both template families (Conventional 9-sheet, RRM 15-sheet), A-Forms bundle, financial/hours sheets | `engine/admin_harness.py` regression-tests this against 3 test companies on every run; real tender runs recorded in git history (e.g. `afad9d2`, `6658b73`) |
| Template fingerprinting (`engine/fingerprint.py`) | Detects a changed SANRAL template before filling | Documented false-positive case already found and understood (README's own "open question") |
| Field-level provenance (`engine/provenance.py`, migration `0002_field_provenance.sql`) | Every written field tagged confirmed/computed/assumed_default/missing | **Now wired end-to-end, not just a CLI/DB concept** — `app/app/tenders/[id]/page.tsx` reads `field_provenance` directly and renders the 3-bucket readiness report (item 32). Spec text calling this "Supabase table only, not yet wired to the web app" is stale — see Drift section below. |
| National tender discovery (`engine/discovery/etenders_national.py`, `assess_tender.py`) | Pulls OCDS feed, scores fit against company profile | `app/app/discovery/page.tsx` reads `discovered_opportunities` and renders the same verdict buckets (`strong_fit`/`possible`/`needs_review`/`not_a_fit`) `assess_tender.py` produces — genuinely wired, not a disconnected feed |
| General (non-SANRAL) SBD form fill (`engine/general/fill_sbd_docx.py`) | Fills SBD1/4/6.1 **`.docx` edition only**, label-matched, refuses PDF/`.doc` | Verified against real downloaded Treasury/RAF samples (see `General-Tender-Engine-Findings.md`); drop-in with `generate_action_checklist.py` | 
| Admin test-company harness (`engine/admin_harness.py`, item 30) | Runs test companies through the real SANRAL pipeline, flags shape changes vs. stored baseline | Self-verifying by design (3 real bugs caught per its own commit `d86c84e`) — but **SANRAL-only**, see Gaps |
| Admin results console (`app/app/admin/page.tsx`, item 31) | Plain list of harness runs (test company × tender, status, last run) | Real, reads `admin_harness_runs` (migration `0005`, column renamed by `0006`), populated by `engine/write_admin_harness_results.py`. **Simpler than the spec's description** — no inline rendering of generated documents, no "mark reviewed" workflow yet; it's the diagnostic list half of item 31, not the full visual queue. Spec marks item 31 "Gap" — that's now wrong, see Drift section. |
| Company vault (`app/app/company/page.tsx`) | Company profile + COID expiry badge | Read-only + edit form both real; expiry coloring now shared (see Fixes below) |
| Onboarding (`app/app/onboarding/`) | One field (legal name) → company + owner row, atomically via `create_company_and_join` | Matches spec's "minimum to get started" principle exactly, verified by reading the SQL function and the page |
| Route guard (`app/proxy.ts`) | Redirects signed-out users to `/login`, no-company users to `/onboarding` | Covers every real app route (`/dashboard`, `/onboarding`, `/tenders`, `/discovery`, `/company`, `/people`, `/admin`) |
| RLS policy set (`0001`–`0005`) | Tenant isolation via `is_company_member()`, shared/public tables explicitly marked as such | Internally consistent — every deviation from the "tenant isolation" default (shared `tenders`, non-tenant `admin_harness_runs`) carries its own comment explaining why. No RLS inconsistency found this pass. |

## In progress / partially built

- **Item 31 (admin review console)** — see table above. Data side (`admin_harness_runs`) and a plain list UI exist; the richer "look at the actual filled document inline, mark reviewed" workflow described in the spec does not yet.
- **CV engine (items 2/4/5 — the product's core niche)** — landed mid-way through this review pass (commit `724f038`, same run as the findings doc `abdef44`). Real, not a stub: `engine/cv/generate_cv.py` builds an actual Word+PDF CV in two confirmed template families (`sanral_keyperson` — mirrors SANRAL's real Form B1.1/B2.1; `world_bank` — the donor-funded structure, confirmed via WebSearch against secondary sources since the primary World Bank PDF wasn't fetchable), each with summary/detailed and standard/tender-customized toggles. The tender-customized cover page reuses `suggest_pack.py`'s own `score_candidate()` — no new matching logic invented. Verified against real data: generated and read back (python-docx + pdfplumber) three real combinations, including correctly raising a specialism warning (Henning's file has no evidence of Pavement and Materials experience, and the generator said so rather than hiding it). Logs every field through `ProvenanceLog`, same honesty model as the rest of the engine. **Still reads `config/klipcorp_profile.json` directly, not Supabase** — same CLI-only limitation as the general SBD filler (see Gap #1, which now applies to this too).

## Known gaps (named, not just "incomplete")

1. **Two of today's three new engine capabilities have zero path into the web app — this is the headline finding of this pass.** `engine/general/fill_sbd_docx.py` (general SBD form fill) and `engine/cv/generate_cv.py` (CV generation — the product's actual stated niche, items 2/4/5) are both real, verified CLI scripts with **no caller anywhere in `app/`** — confirmed by grep across `app/`, zero hits for either. Both also still read `config/klipcorp_profile.json` directly rather than Supabase, so even a hypothetical caller couldn't reach them per-tenant without further work. This is exactly the kind of gap Sarel asked this review to watch for: real, tested capability that a customer using the actual product cannot reach at all today. Concretely, `app/app/people/page.tsx` (where CV generation would surface) has no button, link, or server action anywhere that calls `generate_cv.py` or anything like it. Needs a product decision (own page? a "Generate CV" action on the people/[id] page? folded into a future pack builder?) before either is "done" in any customer-facing sense — flagged for Sarel's call, not built unilaterally here since it's a UI/product design decision, not a mechanical fix.
2. **`admin_harness.py` still only exercises the SANRAL path.** It calls `fill_docx_forms` and `fill_a_forms` only — confirmed by reading its imports. Neither the general-engine filler (`fill_sbd_docx.py`) nor the new CV generator (`generate_cv.py`) has **any test-company regression coverage**. If a buyer wording variance ever breaks the label-matcher, or a future `people`/`projects` schema change breaks CV generation silently, nothing catches it automatically the way SANRAL template changes are caught.
3. **CV upload-and-AI-extract (item 2) is not built.** `app/app/people/page.tsx` and `[id]/page.tsx` are still manual add/edit forms, real columns only. This matches what the spec already says (flagged 2026-10-16 as the highest-priority gap in the people flow) — restated here as current-state confirmation, not a new finding.
4. **Test-company coverage is 3 profiles, not 4.** `config/test_companies/` has `complete_co`, `expired_certs_co`, `new_co`. The spec's own item-30 description names a 4th scenario — "no confirmed specialist for a position the tender requires" — with no matching fixture. Low priority (the spec itself lists "how many test companies is enough" as an open question), noted so it isn't silently forgotten.
5. **Schema now has `is_test_company`; `admin_harness.py` doesn't read it yet — this is a half-landed architectural piece, not a finished one.** Earlier this pass I'd found the schema didn't match the spec's own description (item 30: "maintain several test companies in the same `companies` table... a simple `is_test_company` flag") and recommended updating the spec to match the simpler JSON-fixture reality instead. That recommendation was **wrong** — a cross-session message relayed a correction from Sarel: the original spec intent is the actual target, a test company should be a real row in `companies`, onboarded through the normal flow (`create_company_and_join`), not a fixture file. Noting the sourcing honestly: I could independently re-verify the spec text itself (it did already say `is_test_company`, which is what grounds the column added below), but the relayed quotes attributed to Sarel in that message aren't something this pass could check against a primary-source commit the way the earlier "test company" rename was — there was no corresponding spec-doc update at the time this was acted on. The column add is low-risk and reversible either way, and independently justified by the spec text alone, so I proceeded; treat the broader architectural framing (onboarding flow, not fixtures) as reported-not-verified until a spec commit confirms it. Added migration `0007_add_is_test_company.sql` (boolean, default `false`, never surfaced customer-facing) to close that specific gap — **verified for real**, not just syntax-checked: stood up a scratch local Postgres 16 instance, stubbed the minimal `auth.users`/`auth.uid()` Supabase provides, and replayed all seven migrations (`0001`→`0007`) in order against it; all applied cleanly, `companies.is_test_company` and the renamed `admin_harness_runs.test_company` both confirmed present with correct type/default via `information_schema`. **Still open, deliberately not built this pass** (no live Supabase project exists in this environment to build or verify against, and the relay itself said this is fine to defer): `engine/admin_harness.py` still reads `config/test_companies/*.json`, not a real company's row out of Supabase — that's a real rewrite (reading a company's people/projects/financial data live instead of a local profile dict), not a column add, and needs a live project to verify against, not just a schema replay. No UI sets `is_test_company` yet either — nothing public should, and where a trusted (admin-only) toggle lives is an open product decision, not decided here. The 3 local JSON fixtures (`config/test_companies/*.json`) are left in place as a CLI-only fallback for now, not removed.

## Terminology fix applied this pass

**"Dummy company" renamed to "test company" everywhere, per Sarel's explicit instruction**
(received via a cross-session message, verified against the spec commit `2acb495` before
acting on it). Code-level rename landed in `f942bed`: `config/dummy_companies/` →
`config/test_companies/` (directory + every "Dummy"-prefixed value inside the 3 fixtures),
`engine/admin_harness.py`, `engine/write_admin_harness_results.py`, comment-only mentions in
`fill_a_forms.py`/`fill_docx_forms.py`, a new migration `0006_rename_dummy_to_test_company.sql`
(`admin_harness_runs.dummy_company` → `test_company`; `0005` itself left untouched as applied
history), and `app/app/admin/page.tsx` + `HarnessRunRow.tsx`. Verified for real: ran
`python3 engine/admin_harness.py --reset` after the rename — 18 clean runs (3 test companies ×
6 tenders), 0 flagged, 0 failures; `npm run typecheck` and `npm run lint` pass clean; `next
build` compiles and type-checks successfully (same pre-existing prerender-only failure as
every other build attempt in this environment, unrelated to this change).

## New spec requirement this pass: CV "use as-is" (no AI interference)

Landed as `docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md`'s own update (`2acb495`): a
third CV path alongside AI-extract-to-fields and AI-generate (`engine/cv/generate_cv.py`) — a
company can upload a CV and have it attached to a submission **exactly as uploaded**, no
extraction, no reformatting, not run through `generate_cv.py` at all. Not necessarily this
session's to build (it's a people-page/CV-flow UI decision), but the judgment call asked for:
**does this change anything about how `people`/storage should be shaped now, rather than
later?** Yes, in one concrete way, checked directly against the schema: `people` currently has
no file-storage column of any kind — confirmed by reading `0001_init_schema.sql`'s `people`
table definition. The pattern already exists elsewhere in the same schema
(`companies.logo_storage_path text -- path in Supabase Storage, not the file itself`,
`tender_documents.storage_path`, `generated_documents.storage_path`), just not yet applied to
`people`. This isn't a need created by the new "use as-is" path alone — the *already-planned*
AI-extract path also needs the original uploaded file kept (to show back on the confirm/correct
screen, and so a re-upload can replace "the same person's CV" rather than only their extracted
fields) — but "use as-is" makes it unambiguous that storing the original file is not an
optional nice-to-have for later, it's the common foundation all three CV paths need. Recommend
whoever builds the people-page CV upload flow add a `people` storage-path column (or a small
`person_documents` table if more than one file per person turns out to be needed - e.g. an
old CV being replaced rather than overwritten) as part of that same piece of work, not bolt it
on afterward. Flagging this reasoning here rather than writing the migration myself, since the
actual shape (column vs. side table, one file vs. a history of them) is a decision for whoever
builds the upload UI and should be made alongside it, not predicted in isolation.

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
- Gap #5 follow-up: rewriting `admin_harness.py` to read a real company's data from Supabase instead of `config/test_companies/*.json`, and deciding where an `is_test_company` toggle should live in the admin UI. Both need a live Supabase project to build and verify against properly, which this environment doesn't have.
- The `people`/CV storage-path decision raised above (new spec requirement section) — flagged with reasoning, not decided, since it belongs with whoever builds the upload UI.

## 2026-10-16: tender task/deadline timeline + document-expiry reminder script (item 8, plus the new "Document expiry reminders" spec section)

**Built and verified:**

- Migration `0009_tender_tasks.sql`: `tender_tasks` table, tenant-scoped (RLS via `is_company_member(company_id)`, same pattern as `tender_packs`). Columns: `description` (not null, free text), `due_date`, `status` (`not_started`/`in_progress`/`done`), `kind` (nullable, closed to `closing`/`briefing`/`clarification`/`submission` — only ever set by the auto-seed path, never by the manual-entry form), `is_standard`. Partial unique index on `(company_id, tender_id, kind) where kind is not null` so the one auto-seeded milestone (`closing`, from `tenders.closing_date`) can be upserted idempotently without a select-then-insert race. **Verified for real, same method as the `0007` pass**: stood up a scratch local Postgres 16, stubbed `auth.users`/`auth.uid()` **and** `storage.buckets`/the `authenticated`/`anon` roles (the earlier pass's stub was missing these, which `0001` and `0008` both need), replayed `0001`→`0009` in order. All of `0001`-`0009` applied cleanly except `0008`, which failed partway on a **pre-existing, unrelated bug**: `generated_cvs_person_idx` references a `created_at` column that doesn't exist on `generated_cvs` (the real column is `requested_at`) — not introduced by this pass, not fixed by this pass (out of scope, flagging for whoever owns `0008`), and it doesn't affect `0009` (`tender_tasks` has no dependency on `cv_uploads`/`generated_cvs`). Confirmed `tender_tasks`'s table shape, indexes, RLS policy and `updated_at` trigger directly via `psql \d` and `pg_policy`/`pg_indexes` afterward.
- Tender Workspace page (`app/app/tenders/[id]/page.tsx`): new "Tasks & milestones" section, placed alongside the readiness report per the explicit spec requirement (not a separate page). Closing milestone auto-seeds on page load via `ensureClosingMilestone` (idempotent upsert). Manual "add task" form is description + due date only — **no fixed dropdown of task types**, per the explicit spec requirement; `kind` is never set from that form. Inline status control (`task-status-button.tsx`) mirrors `review-button.tsx`'s tap-to-advance shape but actually persists (`tender_tasks.status` is a real column, unlike `field_provenance.reviewed_at`, which `review-button.tsx` still can't write to).
- `engine/compliance/watch_deadlines.py`: same family/boundary as `engine/discovery/watch_new_tenders.py` — finds (a) company documents entering their expiry lead-time window and (b) not-done `tender_tasks` entering their due-date lead-time window, against a shared seen-store so a run only reports a given (item, date) pair once, prints a summary, writes `--out` JSON. **Does not send any notification itself** — confirmed by grep across `engine/` that no email-sending wrapper script exists anywhere in this repo today (no cron file, no `smtplib`/email-API import); the daily tender-watch email is sent by a scheduled check-in reading `watch_new_tenders.py`'s output, not by committed code, so there is literally no wrapper script to "plug into" beyond documenting the same reuse pattern in this script's own docstring for whatever reads both scripts' output.
- `npm run typecheck` and `npm run lint` (in `app/`) both pass clean. `npm run build` compiles and type-checks successfully, failing only at the prerender step for the same pre-existing, environment-only reason every prior pass has hit (`@supabase/ssr` needs real project credentials this sandbox doesn't have) — not caused by this change.

**Explicitly not built, by design (per the task's own scope limits):**

- No real email/notification sending — `watch_deadlines.py` only ever produces a report, same one-way boundary as `watch_new_tenders.py`. Wiring it into an actual send (and deciding whether that's the scheduled-check-in pattern again, or finally a real wrapper script) is Sarel's call, not built here.
- No briefing/clarification/submission milestone auto-seeding — their dates aren't captured anywhere in the schema yet (`assess_tender.py` only detects that a briefing is *mentioned*, not its date). They're available today only as manual tasks (optionally tagged with the matching `kind` if a future UI wants to offer that as a quick-fill, which this pass did not add — the manual form stays unconstrained free text, per spec).
- No "sidewalk" feature. Sarel's own phrase ("ask them if they're willing to do a sidewalk") is flagged in the spec as possibly a transcription artifact and was deliberately *not* guessed at or built — the general free-text task capability already covers whatever it turns out to mean.

**Open question for Sarel, written up in its own note rather than guessed at:** `docs/specs/Document-Expiry-Tracked-Fields-Open-Item.md` — the spec text for the expiry reminder names "COID, B-BBEE, insurance, CSD" as tracked documents, but reading the actual schema turned up only one real expiry-date column (`companies.coid_letter_of_good_standing_expiry`). `watch_deadlines.py`'s `TRACKED_EXPIRY_FIELDS` is therefore COID-only today, by evidence, not a shortcut — adding the others needs Sarel to confirm which fields are worth capturing and a migration to add them, at which point extending the script is a one-line change.

**Reminder lead time:** deliberately set to 60 days for documents (`--doc-lead-days`, default), not the task's own suggested-but-unconfirmed "e.g. default 30 days" — matched instead to `app/lib/dates.ts`'s existing `expiryStatus(..., renewSoonWithinDays = 60)` so the amber "renew soon" badge on the Document Vault and the reminder window mean the same threshold, rather than two different numbers for the same concept. Tasks default to a shorter 14-day lead time (`--task-lead-days`), since a manual tender task is typically a much shorter-fuse item than a compliance certificate.

## 2026-10-16: task/milestone assignee (Sarel's request - "assign specific people to each of the steps in the flow, so we know who's responsible")

**Built and verified:**

- Migration `0011_tender_task_assignee.sql`: `tender_tasks.assigned_to`, nullable uuid, `references people(id) on delete set null` (partial index on `assigned_to where not null`). Deliberately **not** `company_members`: read both schemas before deciding - `company_members` only links an `auth.users` account to a company (id/company_id/user_id/role), has no display name, and `0010`'s own check-in note confirms it has zero UI surface today, not even a list. `people` (`app/app/people/page.tsx`, titled "People / CV Library") is the table with a real name/role per person and is already the roster shown to the user elsewhere - reused as-is for "who can be assigned" rather than inventing a second team-members concept. `on delete set null`, not cascade: removing a person from the People library should never silently delete a task that references them.
- Tender Workspace page: each task/milestone row (both auto-seeded standard milestones and manual tasks - same table, same UI, no special-casing) now shows a plain `<select>` of the company's people (`task-assignee-select.tsx`, same client-component "tap it, it persists via a server action" shape as the existing `task-status-button.tsx`), defaulting to "Unassigned" and showing the assigned person's name once set - the select itself is the display, no separate label needed. The "add task" form gained one more optional field, "Assign to (optional)", same Civic Navy inline styling (no new design pattern).
- `actions.ts`: `addTenderTask` now accepts an optional `assigned_to` from the add-task form (empty string means null/unassigned). New `reassignTenderTask(taskId, tenderId, personId)` action - same inline-update, no-redirect shape as the existing `advanceTaskStatus`, scoped by `company_id` same as that action.
- **Verified for real, same method as the `0007`/`0009` passes**: stood up a scratch local Postgres 16 (already running in this environment, no setup needed), stubbed `auth.users`/`auth.uid()`/`storage.buckets`/the `authenticated`/`anon` roles, replayed `0001`→`0007`, `0009`→`0011` in order (`0008` skipped - same pre-existing, unrelated `generated_cvs_person_idx`/`created_at` bug flagged by the `0009` pass, still not fixed, still not this pass's to fix). All applied cleanly. Confirmed via `psql \d tender_tasks` that `assigned_to` is a nullable uuid FK to `people(id)` with `on delete set null`, and did a real sanity round-trip: inserted a `people` row, assigned a task to it, confirmed the join (`tender_tasks` -> `people.name`) returns the real name, then deleted the `people` row and confirmed the task survived with `assigned_to` set back to null (not cascade-deleted).
- `npm run typecheck` and `npm run lint` (in `app/`) both pass clean.

**Merge conflict handling:** this pass landed concurrently with another agent's "reorder tender workspace, add readiness-report summary chips" commit (`0f9068f`), which also touched `app/app/tenders/[id]/page.tsx` (moved the `<TaskTimeline>` call from right after the facts card to after the readiness report, and added a summary-chip row inside the facts card). Pull-rebase surfaced one real conflict block at the facts-card/TaskTimeline boundary; resolved by keeping both sides in full - their summary-chip block stays inside the facts card exactly as they wrote it, and `<TaskTimeline>` keeps their new position (after the readiness report, before key positions), just with `people={assignablePeople}` added onto their call. No other file conflicted. Rechecked `npm run typecheck`/`lint` after resolving, both still clean, and re-read the whole JSX tree afterward to confirm no duplicate `<TaskTimeline>` render was left behind by the auto-merge.

**Explicitly not built, per the task's own scope limits:** no notification-on-assignment (the role-based daily digest engine, `engine/notify/daily_digest.py`, already built separately can pick this up later if relevant - not this pass's job); no general task-template system - this is strictly "assign a person to a task row."

**Open note:** noticed `app/supabase/migrations/0012_experience_items.sql` appear on disk mid-pass (a third concurrent agent's in-progress work, untracked, unrelated to tasks/assignment) - left untouched and not committed by this pass; flagging only so whoever owns it isn't surprised it was seen but not acted on.
