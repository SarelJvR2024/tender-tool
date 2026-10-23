# engine/narrative/ — cover letter / methodology statement generator

Generates a company- and tender-specific cover letter or methodology statement as a real,
editable Word (.docx) document, grounded in that company's own profile, key people, past
experience and how they describe their own approach (`companies.how_we_work`) — never a
generic template two companies could both submit.

## Why this exists, and why it's careful about it

`docs/specs/Company-Voice-Audit.md` (2026-10-17) records a deliberate decision, five days
before this feature was built: AI-drafted executive summaries/methodology were cut from
scope because they make every tenant's submission look the same, which is exactly the kind
of similarity that can get two bidders on the same tender disqualified for apparent
collusion. Sarel asked for this feature directly (2026-10-22) with the identical worry in
his own words: "it may NEVER generate the same or similar versions for two companies — then
they might both get disqualified." Confirmed before any code was written: build it anyway,
as a **full, ready-to-use draft**, but with a **mechanical similarity check** across
companies for the same tender — not just "trust the prompt" — plus an explicit export /
hand-edit-in-Word / re-upload path, so nothing ships without a human actually reading and
owning the words. See migration `app/supabase/migrations/0086_narrative_documents.sql`'s own
header comment for the same reasoning recorded against the schema.

## Modules

- `build_prompt.py` — pure prompt construction. The system prompt forbids inventing any
  fact not supplied (names, projects, numbers), instructs the model to draw on and preserve
  `how_we_work`'s own authentic phrasing rather than substituting generic "approach"
  language, names and forbids concrete filler phrases ("we are committed to excellence", …),
  and ties length/detail/visual-richness to the company's chosen style preferences.
- `uniqueness.py` — the mechanical anti-collusion safeguard. Stdlib-only
  (`difflib.SequenceMatcher`), normalizes two texts (lowercase, strip punctuation, collapse
  whitespace) and scores their similarity 0–1. `SIMILARITY_FLAG_THRESHOLD = 0.6`.
- `build_docx.py` — renders the model's structured output into a real, well-formed `.docx`
  (python-docx) a person can open and edit in Word — never a locked or image-based
  rendering. Five curated color themes, three visual-richness levels.
- `generate_narrative.py` — the orchestrator. One structured-output Anthropic Messages API
  call (same `call_llm` convention as `engine/cv/extract_cv_fields.py`: `output_config`
  `json_schema`, the `AuthenticationError`/`RateLimitError`/… → `SetupError`/
  `TransientError`/`GenerationFailed` cascade), then `uniqueness.check_uniqueness()` against
  every other company's ready document of the same kind for the same tender. A draft that
  scores too similar gets **exactly one** automatic regeneration with an explicit
  distinctness instruction; if still too similar after that, it is honestly flagged
  (`similarity_flagged=true`) for a human to read and rewrite — never silently shipped, never
  silently discarded, never retried a third time. Once the uniqueness question is settled,
  `run_review_passes()` chains up to **3** real self-review turns onto the SAME conversation
  the draft was generated in — Sarel's own standing standard
  (`docs/specs/AI-Call-Quality-Standard.md`, verbatim: "neve be stisfied with your first anser
  and output, always review it... run that 3 times"). Each pass checks the corrected-so-far
  output against the real source facts for exactly the mistakes a sworn tender submission
  can't afford (an invented name/number, a generic-filler regression, the requester's own
  guidance being dropped), stops the moment a pass finds nothing wrong, and — if the model is
  still finding real issues on the very last allowed pass — sets `quality_flagged=true` rather
  than silently shipping a result that failed its own check.
- `process_narrative_jobs.py` — the Supabase polling bridge (see below).

## Usage

```
python3 generate_narrative.py <context.json> <out_dir> [--model claude-opus-5-5]
```

`context.json` has the shape `build_prompt.build_user_message()` expects — see
`test_build_prompt.py`'s `CONTEXT` fixture for a worked example (a SANRAL N4 tender for a
fictional "Mahlangu Civils"). This CLI path has no Supabase involvement and is for manual
testing of the prompt/docx pipeline against a hand-written context.

## Web app wiring

`app/app/tenders/[id]/narrative-documents.tsx` is a card on the Tender Workspace page: a
guidance textarea plus length/detail/visual/color style pickers, per document kind (cover
letter, methodology statement). `app/app/tenders/[id]/narrative-actions.ts`'s
`requestNarrativeDocument` only ever inserts a `narrative_documents` row with
`status='requested'` — the web app (Next.js on Vercel) cannot run Python or call the
Anthropic API directly as part of a request. `uploadNarrativeFinal` is the human-finishing
step: once a draft is `ready`, the company exports it, edits it in Word, and re-uploads the
real final version, recorded in the same row's `final_storage_path` — which, not
`generated_storage_path`, is what anything downstream should treat as the real document.

## The Python-execution problem, and how it's solved

Same problem, same answer as `engine/cv/README.md`'s own section of this name:
`process_narrative_jobs.py` is a bridge script with the same async request/fulfil shape as
`process_cv_jobs.py`/`process_pack_jobs.py`. It polls `narrative_documents` for `requested`
rows, claims one atomically (`PATCH ...&status=eq.requested`, empty result means another
worker already took it), builds `generate_narrative.py`'s context dict from the real
Supabase `companies`/`people`/`experience_items`/`tenders` rows (`load_company_context`/
`load_key_people`/`load_experience`/`load_tender_context`), loads every *other* company's
ready document of the same kind for the same tender (`load_other_companies_text` — the one
cross-tenant read this whole feature exists to make safe, using the service-role key the
same way every other `engine/*/process_*_jobs.py` bridge already does; no RLS policy ever
grants this to a client), calls `generate_with_uniqueness_check`, builds and uploads the
`.docx`, and marks the row `ready` (with the similarity result recorded) or `failed`.

```
python3 process_narrative_jobs.py [--once]
python3 process_narrative_jobs.py --loop [--interval 30]
```

In production this runs inside the same always-on worker container as the CV and pack
bridges (`engine/worker/run_bridges.py`). Jobs are claimed atomically, so two workers never
generate the same document twice.

## `load_key_people`'s own named simplification

Unlike the CV engine's tender-specific path (which reads `tender_pack_assignments` for the
people actually *confirmed* on this one tender), `load_key_people` picks a reasonable
default: this company's own named people with a role on file, up to 5, by name. It does
**not** specifically pick the key people confirmed for this one tender —
`tender_pack_assignments` is SANRAL-specific and general-family tenders (where this feature
also applies) have no equivalent concept yet. A deliberate, flagged simplification for this
first pass; a natural follow-up once a general-family "confirmed people" concept exists.

## What's genuinely not done yet

- **No live Supabase run, and no real LLM call, anywhere in this work.** No
  `ANTHROPIC_API_KEY` and no live Supabase project exist in this sandbox — the same
  limitation every pass building this app has hit. What IS verified, for real: every module's
  own unit tests (`test_uniqueness.py`, `test_build_prompt.py`, `test_build_docx.py` —
  reopens the generated `.docx` with `python-docx` and checks real styling,
  `test_generate_narrative.py` — a stub Anthropic client proves the exact two-call-maximum
  distinctness-retry behaviour AND the review-pass loop's own real behaviour: stops as soon
  as a pass reports nothing wrong, chains each pass's correction into the next pass's actual
  input, caps at exactly 3 passes, flags honestly if still finding issues on the last one, and
  sends a genuine multi-turn conversation rather than a reconstructed single prompt;
  `test_process_narrative_jobs.py` — a stub Supabase client proves the row-shape adapters),
  the migration's schema and RLS (fresh 76-migration replay plus the full tenant-isolation
  suite, both `ALL PASSED`), and the Next.js side (`tsc --noEmit`, `eslint`, `vitest`,
  `next build`, all clean). The actual "write a real draft from a real company's real data"
  path is not exercised end to end until this runs somewhere with real credentials.
- **Not wired into submission-pack assembly.** `engine/pack/assemble_pack.py` /
  `engine/general/build_general_pack.py` do not yet pull a narrative document's
  `final_storage_path` into the compiled submission pack — a deliberate scope cut for this
  pass, flagged rather than built, since it touches two separate pack-assembly engines and
  the product decision of exactly where a cover letter/methodology statement belongs in each
  pack's own document order.
- `load_key_people`'s own simplification, above.
