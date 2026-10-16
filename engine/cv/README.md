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

## What's genuinely not done yet

- No web-app wiring: there is no UI for picking format/standard-vs-customized. This is a
  standalone engine, verified to work correctly on real data — the web app route is a
  separate pass (see the main task's summary in the project history).
- No live Supabase read: reads `config/klipcorp_profile.json` directly (no live Supabase
  project exists in this environment), per the schema in
  `app/supabase/migrations/0001_init_schema.sql` — the shape matches `people`/`projects`
  field-for-field, so swapping the loader for a real Supabase query later is additive.
- World Bank format fields the schema doesn't capture (nationality, languages, countries of
  work experience, other professional memberships) are shown as `MISSING` with a reason —
  never fabricated. Adding those columns to `people` is a product decision for when a real
  World-Bank-funded tender needs them.
- Only one real buyer's template family (`sanral_keyperson`) has been checked against an
  actual submitted Klipcorp tender. `world_bank`'s structure is confirmed via secondary
  sources (see findings doc) but has not yet been checked against a real Klipcorp
  World-Bank-funded submission, because none exists in this repo to test against.
