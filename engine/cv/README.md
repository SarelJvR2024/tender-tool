# engine/cv/ — CV generator

Generates a person's CV as a real Word (.docx) and PDF document, in one of two confirmed
real template families, optionally with a tender-specific requirement-matching cover page.

See `docs/specs/CV-Engine-Findings.md` for the evidence behind the format choices — this
is not an imagined template, it reproduces two real, confirmed shapes.

## Usage

```
python3 generate_cv.py <profile.json> <person_index> <out_dir> \
    --format sanral_keyperson|world_bank --detail summary|detailed \
    [--tender <pack_suggestions.json> --position <CODE>] \
    [--logo <path/to/logo.png>]
```

- `person_index` is the index into `profile["key_people"]` (same `person_0`, `person_1`, ...
  convention `suggest_pack.py` already uses, so lookups line up with the same person).
- Without `--tender`/`--position`: a **standard** (generic, non-tender-specific) CV.
- With them: a **tender-customized** CV — adds a cover page stating which of that
  position's stated requirements this person's data evidences and which it doesn't, built
  directly on `suggest_pack.py`'s own `score_candidate()` output (never a new matcher).
  `--tender` points at an existing `pack_suggestions.json` (produced by
  `engine/pack_generator/suggest_pack.py` for a real tender) — not re-run here.

Every value written is logged through `engine/provenance.py`'s `ProvenanceLog`
(confirmed/computed/assumed_default/missing, with a reason) to a `.provenance.json` file
alongside the output.

## Web app wiring (this pass)

Two integration points now exist in the web app, per Sarel's own direction (2026-10-16):

- **People page** (`app/app/people/[id]/page.tsx` + `actions.ts`): upload a CV once, choose
  `as_is` (no AI at all, the file is the submission attachment) or `ai_extract` (which also
  pre-generates the standard sanral_keyperson/world_bank × summary/detailed formats right
  away). Recorded in `cv_uploads`.
- **Tender Workspace page** (`app/app/tenders/[id]/page.tsx`): "Generate tender-specific CV"
  for a confirmed key person, recorded in `generated_cvs` with `tender_id`/`position_code` set.

Both record a **request**, not a synchronous result — see the next section for why, and
`process_cv_jobs.py` for what actually fulfills the request.

## Use-as-is mode

`generate_as_is(source_path, out_dir, person_name)` — the "Use as-is" path (see the
competitor-deep-dive spec): copies the uploaded file through **untouched** (no AI, no
reformatting) and writes a `.provenance.json` recording that fact, same honesty discipline
as every other document in this project. CLI: `--as-is-source <file> --person-name <name>`.

## The Python-execution problem, and how it's solved

The web app is Next.js on Vercel, which cannot run Python or LibreOffice — this script
depends on both (`python-docx` + a `soffice` subprocess), same as `engine/print_reports.py`.
So a Next.js route cannot call this script directly and return a generated document
synchronously.

**Chosen approach**: `process_cv_jobs.py` is a bridge script, in the same spirit as
`engine/write_admin_harness_results.py` bridging `admin_harness.py`'s CLI output into
Supabase. The web app only ever writes a **request row** (`generated_cvs`, status
`requested`) — it never calls this script. `process_cv_jobs.py`, run by the always-on
worker (see below) or by hand on a machine with Python + LibreOffice, polls for `requested` rows, builds a
`generate_cv.py`-shaped profile dict from the real Supabase `people`/`projects`/`companies`
rows (see `adapt_person_row`/`adapt_project_row`/`adapt_company_row`), calls
`generate_cv.py`'s own `build_sanral_keyperson`/`build_world_bank` functions directly (never
a reimplementation), uploads the result to Supabase Storage, and marks the row `ready` (or
`failed`). The UI shows `requested`/`generating`/`ready`/`failed`, never blocks on a result.

**Running it without a person (2026-10-16):** `process_cv_jobs.py` with no flag (or `--once`)
processes the queue once and exits. `--loop [--interval 30]` keeps polling. In production
it runs inside the always-on worker container (`engine/worker/Dockerfile`, which runs
`engine/worker/run_bridges.py --loop` for both the CV bridge and the pack bridge). Jobs are
claimed atomically, so two workers never build the same CV twice. Deployment options,
the recommendation (Railway) and Sarel's setup steps are in
`docs/specs/Automated-Fulfillment-Deployment.md`. Smoke test:
`python3 engine/worker/test_poll_loop.py`.

Rejected: duplicating `generate_cv.py`'s logic in TypeScript to run synchronously in a
Vercel function — the brief is explicit that this would create two implementations that
drift apart, and `generate_cv.py` is the one real one.

## What's genuinely not done yet

- **No live Supabase run of `process_cv_jobs.py`** — no live Supabase project exists in this
  environment (same limitation every session building this app has hit today). What IS
  verified, for real, in this pass: the row-shape adapters (Supabase's flat `people`/
  `projects` columns → `generate_cv.py`'s nested profile-dict shape) feed `build_sanral_
  keyperson`/`build_world_bank` correctly and produce a real `.docx` — run
  `python3 process_cv_jobs.py --self-test` to re-check this without any Supabase credentials.
  The REST-call plumbing itself (`supabase_request`/`storage_upload`) follows the exact
  pattern already proven working in `write_admin_harness_results.py`/`seed_supabase_company.py`,
  but is untested end-to-end against a real project until Sarel connects one.
- **AI extraction of structured fields from an uploaded CV (the `ai_extract` mode's actual
  field-extraction step) is not built in this pass.** `cv_uploads.status` can reach
  `extraction_requested`, but nothing yet reads the uploaded file's content and proposes
  `people`/`projects` field values for confirm/correct. This is the single biggest remaining
  piece of "upload once, never recapture" — flagged here rather than stubbed with a fake
  extractor, per this project's honesty discipline. The standard-format **pre-generation**
  half of `ai_extract` mode (queuing `generated_cvs` rows immediately on upload) IS wired.
- World Bank format fields the schema doesn't capture (nationality, languages, countries of
  work experience, other professional memberships) are shown as `MISSING` with a reason —
  never fabricated. Adding those columns to `people` is a product decision for when a real
  World-Bank-funded tender needs them.
- Only one real buyer's template family (`sanral_keyperson`) has been checked against an
  actual submitted Klipcorp tender. `world_bank`'s structure is confirmed via secondary
  sources (see findings doc) but has not yet been checked against a real Klipcorp
  World-Bank-funded submission, because none exists in this repo to test against.
