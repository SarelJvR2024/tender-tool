# CV Engine Findings — format research before building

Oct 16, 2026 · evidence gathered before writing any code, per Sarel's instruction not to
design CV templates from imagination. Same Observed-vs-Assumed discipline as the rest of
this project's spec docs (`Tender-Tool-Competitor-Feature-Deep-Dive.md`,
`General-Tender-Engine-Findings.md`).

## 1. What SANRAL itself actually asks for (Observed)

Read directly from a real, previously submitted Klipcorp tender:
`templates/incoming/completed_sample/Completed tender/Technical submission/01 Forms B1-B2 Position 1.pdf`.

SANRAL's own CV-shaped form is two one-page sheets per key position, already filled with
Henning Jansen van Rensburg's real data:

- **Form B1.1 — "CANDIDATE'S TECHNICAL/MANAGERIAL RECORD"**: name, ID number, position in
  team, then a table of **the most recent 3 projects only** ("List only the most recent 3
  projects that the tenderer considers relevant to the specified scope of works") — client,
  project/contract number, value (Rm), dates started/ended, position held, and a referee
  (contact name, position, phone). No prose "experience summary" — it's a structured table,
  which is exactly the shape of `people`/`projects` already (`client_and_number`, `value_rm`,
  `position_held`, `contact_name/phone`, `start_date/end_date`).
- **Form B2.1 — "CANDIDATE'S QUALIFICATION AND REGISTRATION RECORD"**: professional
  registration body + level + number + date (ECSA/SACPCMP), highest engineering
  qualification + institution + date graduated, initial qualification + institution + date
  graduated, and total years of relevant experience. Again, this maps field-for-field onto
  `people.ecsa_level/ecsa_number/ecsa_date`, `highest_*`, `initial_*` — not a new shape.

This is also exactly the data `engine/pack_generator/suggest_pack.py` already scores
candidates on (`candidate_person_text`, `years_experience_at`) — confirming the brief's
instruction that the cover-page generator should reuse that logic, not invent new matching.

`engine/fill_tender.py` already writes these two forms *into SANRAL's own macro workbook*
(`fill_person()`, offsets `proj_first=10` etc., `B2` sheet for qualifications). What does
**not** exist yet is a standalone, portable CV document (Word/PDF) built from the same data,
for use outside that one workbook — which is what Sarel is asking for here.

### Other files in the real sample, for completeness

`Returnables/Form B6a/B6b/B6c - Key Personnel.pdf` are **not** CVs despite the filename —
opened and read: they are "ANNEX 4 — INTERIM PSP PERFORMANCE REPORT" forms (a buyer's
rating of past performance on a contract), unrelated to CV format. Filenames in this folder
are not reliable evidence of contents; this is why the brief said to actually open the files.

## 2. Confirmation that buyers' CV formats genuinely differ (Observed)

`docs/specs/General-Tender-Engine-Findings.md` (a sibling agent's real-sample research,
finished just before this task started) records a non-SANRAL buyer requiring its own format:

> Quality Council for Trades and Occupations (QCTO), QCTO 15/2026 — "SETA-type entity, SBD
> forms as flat `.pdf`, plus a **buyer-specific CV template**"

This directly supports the brief's warning not to assume SANRAL's shape generalises:
different buyers hand out their own CV form, and a one-size-fits-all template would not
satisfy either SANRAL or QCTO as submitted. (Building a QCTO-specific importer is out of
scope for this pass — Klipcorp has no active QCTO tender in this repo to test against — but
the finding changes what "2–3 format options" should mean: generic, reusable shapes that
can be re-skinned per buyer, not one hardcoded buyer's exact layout as "the" CV.)

## 3. What a "World Bank format" CV actually is (confirmed, with a caveat on sourcing)

Sarel named this but wasn't sure. Researched via `WebSearch` rather than assumed from
training data alone, as instructed. The primary World Bank procurement page was not
reachable from this environment (403/DNS failures on direct fetches of the source PDFs), so
confidence rests on secondary sources plus general knowledge of the standard — stated
honestly, not papered over:

- [DevelopmentAid: "Your CV for donor-funded projects: World Bank format"](https://www.developmentaid.org/news-stream/post/151806/your-cv-for-donor-funded-projects-world-bank-format) —
  a procurement-sector publication describing the real structure: expert name, date of
  birth, citizenship/country of residence, professional memberships, education (reverse
  chronological, degree + institution + dates, diplomas attached as an annex *not* retyped
  into the CV), employment record (reverse chronological, **only work relevant to the
  assignment**, each entry giving employer/position/activities/location/referee), countries
  of work experience, language proficiency (speaking/reading/writing), and a signed
  declaration that the information is accurate.
- A real government procurement document built on the same standard — Belize's
  `Template-for-Application-WB.docx` (`procurement.gov.bz`) — follows the identical shape
  (degree column, "diplomas attached in annex" note, conflict-of-interest/debarment
  declaration).
- This matches what the brief described from recollection (Proposed Position, Name,
  Nationality, Education, Membership of Professional Associations, Other Training,
  Countries of Work Experience, Languages, Employment Record, certification statement) —
  the World Bank's own Standard Request for Proposals forms (commonly labelled TECH-6/TECH-7
  in RFP annexes) use exactly this structure. I could not re-fetch that exact numbered form
  from worldbank.org in this environment to quote it verbatim, so this is **confirmed by
  two independent secondary sources plus the well-documented standard, not by opening the
  primary PDF directly** — a real but second-hand confirmation, not a first-hand one.

Key structural difference from SANRAL's own form: World Bank format is **narrative and
general** (free-text "key qualifications" summary, employment record as prose entries, no
fixed count of projects), where SANRAL's is **tabular and capped** (exactly 3 most-recent
relevant projects, fixed columns). They are genuinely different shapes, not just different
letterheads on the same data — which is why both are worth building rather than treating
"CV format" as one thing with cosmetic variations.

## 4. Decision: what to actually build, with reasoning

**Not** defaulting to "summary / detailed / World Bank" as three parallel templates,
because the evidence doesn't support a buyer ever asking for a generic unbranded "summary
CV" as its own required shape — SANRAL's own form *is* already the summary case (exactly 3
projects, one page); there's no third buyer-shaped format in evidence to justify a third
template family.

**Built instead — two real template families, each with a detail toggle, crossed with a
standard-vs-tender-customized toggle (2 formats × 2 detail levels × 2 modes):**

1. **`sanral_keyperson`** — mirrors Form B1.1/B2.1's real shape: a tabular project record
   (most relevant projects first) plus the qualification/registration block. `detail=summary`
   caps at 3 projects (matching SANRAL's own form exactly); `detail=detailed` lists every
   project on file. Reusable for any buyer whose tender asks for a similarly tabular,
   project-and-registration CV (SANRAL today; plausibly others later — this is a shape, not
   a SANRAL-only importer, even though SANRAL is the only buyer tested against).
2. **`world_bank`** — the confirmed donor-funded structure above: personal/registration
   header, education (reverse chronological), employment record as narrative entries
   (reverse chronological, relevant-only in `summary`, full history in `detailed`),
   languages/countries-of-experience/other-memberships fields shown as **MISSING** with a
   stated reason where the `people`/`projects` schema genuinely has no such field yet
   (see §5) — never fabricated to make the template look complete.

**Standard vs tender-customized**, orthogonal to the format choice: a *standard* CV has no
cover page and no tender-specific matching — just the person's data in the chosen format,
for general use (e.g. attaching to an EOI). A *tender-customized* CV adds the cover page
Sarel asked for: given a specific tender + position, which of that position's stated
requirements this person's data actually evidences, and which it doesn't — built on
`suggest_pack.py`'s own scoring (`score_candidate`), not a new matching engine.

## 5. Data gaps this surfaces (feed into `people`/`projects`, not invented here)

The World Bank format wants fields `people`/`projects` do not currently carry: nationality,
countries of work experience, language proficiency, and "other professional training" /
memberships beyond ECSA/SACPCMP. The engine logs these as `missing` (with a reason) via
`ProvenanceLog`, exactly as `fill_a_forms.py` already does for fields it can't fill — it
does not guess a nationality or a language. Whether to add these columns to `people` is a
product decision for later, once a real World-Bank-funded tender actually needs them; no
schema change made in this pass (scope guard — don't add a field before a real document
needs it, per the competitor doc's "Scope discipline" section).

## 6. Scope guard

`engine/cv/` is its own namespace, same "a template family gets its own importer" principle
already used for SANRAL (`engine/fill_tender.py`, `engine/fill_conventional.py`). It does not
touch SANRAL's macro workbook at all — it is a separate, portable document generator that
happens to reuse the same underlying person/project data and the same matching logic.
