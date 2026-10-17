# CV AI-Extraction Findings

Oct 17, 2026. This closes the AI-extract half of "CVs: upload once, never recapture"
(`Tender-Tool-Competitor-Feature-Deep-Dive.md`). Evidence first, then the design, then what is
verified and what isn't. It uses the same Observed / Assumed split as the other findings docs.

**Short version.** An `ai_extract` upload is now read by `engine/cv/extract_cv_fields.py`, a
bridge run by the worker. It pulls the CV's text, refuses a file it can't honestly read, and asks
Claude for the `people`/`projects` fields. Each value comes with the verbatim CV line it came from,
and every one is checked against the CV text again. The result is stored as a **proposal**
(`cv_extraction_results`, migration `0023`). The People page shows it next to what is on file now.
Nothing reaches `people`/`projects` until a person ticks fields and presses **Save ticked fields**.
The text step, the failure modes and all the plumbing are verified for real. **The Claude call itself
has never run**: this sandbox has no API key. Its request shape is checked against a stub client and
the installed SDK's signature, not against the live API (see "Verified vs not").

## 1. What CVs actually look like here (Observed)

Everything CV-shaped in the repo, opened and read (`templates/incoming/completed_sample/`, which is
gitignored real data):

| File | What it really is | Text layer |
| --- | --- | --- |
| `Technical submission/01 Forms B1-B2 Position 1.pdf` | Henning's SANRAL **Form B1.1 + B2.1**, printed from the SANRAL workbook by LibreOffice Calc | Yes. 2 pages, 11,868 chars from `pdftotext -layout`, about 70% of it column padding |
| `Returnables/Form B1.pdf`, `Form B2.1.pdf` | The same forms printed from Excel on macOS | Yes. 8,052 and 4,023 chars |
| `Returnables/Form B2.1CE/SKMBT_C452...pdf` | A **scan** (Konica Minolta bizhub) | **None** (1 char) |
| `Returnables/Form B2.1CE/ECSA Certificate (3).pdf`, `Meng (3).pdf` | **Scanned** registration and degree certificates | **None** |
| `Returnables/Form B6a/b/c - Key Personnel.pdf` | Not CVs: PSP performance reports (already noted in `CV-Engine-Findings.md` §1) | Yes |

What this tells us:

- **The only real "CV" Klipcorp has in the repo is SANRAL's own form, not a narrative CV.** It is a
  label/value grid. The client and the contract number sit on different lines (`ACSA` /
  `ORT5737/2018/RFP`). Each date appears three times in three spellings (`2015/3/5`,
  `2015 Mar 5`, and loose `Mar` / `5`). The ID and ECSA numbers are bare digits. The extractor has
  to handle this layout, which is why `document_kind` has a `sanral_key_person_forms` value and the
  prompt says how to read it.
- **Scans are real and common in this team's files**: 3 of the 6 person-related PDFs are image-only.
  A team member who uploads "whatever exists", as the spec says, will often upload a scan. That makes
  "fail clearly on a scan" a main path, not an edge case.
- **No free-form CV from any other staff member exists in the repo.** `config/team_roster.json` names
  Sarel plus four synthetic stand-ins. **How the rest of the team's CVs are laid out is unknown.** This
  is open question 1 below. The narrative-CV path was tested on a synthetic CV built for the test
  (section 5), not a real one.
- External evidence from earlier passes still holds: buyers hand out their own CV templates (QCTO,
  `CV-Engine-Findings.md` §2), and World Bank CVs are narrative (§3). So a CV that arrives here may
  have been reformatted for any of several buyers, and a layout-specific parser would not survive.

## 2. Existing infrastructure (checked, reused)

- **No LLM integration existed anywhere.** A repo-wide grep for `anthropic|openai|llm|claude-` over
  `.py`/`.ts`/`.tsx`/`.json`/`.yml`/Dockerfile matched nothing, apart from regex `fullmatch` false
  positives. This is a new integration point, and it needs a real credential.
- **Text readers already exist** in `engine/general/requirements.py`: `pdf_text()` (pdftotext
  `-layout`), `docx_text()` (python-docx, paragraphs and de-duplicated table cells) and
  `convert_with_soffice()` (`.doc` to `.docx`). They are imported, not copied. `pdftotext` was
  chosen over `pdfplumber`: pdfplumber is installed locally but is not in the worker image, while
  `poppler-utils` is (the general bridge needs it). That means no new system dependency.
- **Bridge shape** follows `process_cv_jobs.py`. It shares that file's `supabase_request()`, the
  `poll_loop` `--once` / `--loop` contract, an atomic `requested`→`working` claim and a stale-claim
  reclaim. It is registered in `engine/worker/run_bridges.py` as `cv_extract`.

## 3. Approaches considered

| Approach | Verdict |
| --- | --- |
| Regex/heuristic parser per layout | Rejected. Arbitrary layouts, and the one real layout already defeats line-based parsing (client and contract number on different lines, dates repeated three ways) |
| **Extract the text locally, then one structured-output LLM call that returns JSON in the schema's shape, with a verbatim quote per value** | **Chosen.** Works across layouts. The JSON schema (`output_config.format`) guarantees the shape. The quotes make each value checkable against the CV text afterwards |
| Send the PDF itself to Claude (a `document` block, which reads scans too) | Deferred, not rejected. It is the cheapest route to supporting scans (open question 2). The brief asked to fail clearly on scans rather than guess, and the quote check needs a text layer to verify against |
| Local OCR (tesseract) | Not installed, it's a new dependency, and OCR'd SANRAL grids would need their own validation. Same open question |

**Provider and model:** Anthropic's Claude via the official `anthropic` Python SDK (pinned
`1.15.0` in `engine/worker/requirements.txt`). The default model is `claude-opus-5-5`, which you
can override with `CV_EXTRACTION_MODEL`. Effort is set to `medium`. The call sends
`fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), so a rare safety-classifier decline
is retried on Anthropic's recommended fallback model inside the same call.

## 4. Design: what makes it "review-then-confirm" and not "upload and trust"

1. **Gate on the text before any API call.** Each case below fails with a reason the user can act
   on, and nothing is sent:
   - an image upload, or a PDF with no text layer on any page (a scan);
   - fewer than 200 non-space characters;
   - letters making up under 35% of the characters (a broken font encoding);
   - more than 150k characters (a whole tender pack, not a CV).

   A PDF where only some pages have text goes ahead, with a warning naming the pages that weren't
   read.
2. **SA ID numbers never leave the machine.** A 13-digit number counts as an ID only if its Luhn
   checksum is valid, its month and day are plausible and its citizenship digit is 0 or 1. Each one
   is replaced with `[SA ID NUMBER REMOVED]` before the call, and the ID is proposed from the local
   match. Registration, phone and contract numbers are not affected (tested). Two different IDs in
   one CV means none is proposed.
3. **Every value carries a quote, and the quote is searched for in the CV.** The search runs on
   normalised text, again with letters and digits only (this handles a table cell wrapped
   mid-token, `TMRA/2019/04` + `4`, and a line-end hyphen the PDF dropped), and against
   pdftotext's reading-order text as well as `-layout` (layout interleaves table columns, so a
   wrapped cell is split up there). Numbers (ECSA, SACPCMP, phone) must have their digits in the
   CV, and an email must appear verbatim. A value that fails a check is marked "check" and left
   **unticked**.
4. **SANRAL's closed lists are enforced.** `ecsa_level` and `highest_level` must be one of the
   Form B2.1 dropdown labels, read from the real R.396 workbook with `sanral_fill.Workbook.options()`.
   `fill_conventional.py` raises on any other label, so a free-text "MSc" would break pack
   generation later. A value outside the list is blanked, and the reviewer picks from a dropdown.
5. **Dates are never invented.** The model returns `YYYY`, `YYYY-MM` or `YYYY-MM-DD` at the
   precision the CV gives. A year-only or month-only date gets a visible placeholder (1 January, or
   the 1st of the month), a warning, and is left unticked for person fields. This matters because
   `initial_graduated` drives years of experience.
6. **Whole-answer sanity checks fail the job.** The job fails when the model says it's not a CV,
   when nothing is found, or when more than 60% of the values can't be traced to the CV text. The
   last check catches a layout so unusual that the output would be garbage.
7. **The review card** (`app/app/people/[id]/cv-review.tsx`) shows per field what is on file now,
   the value from the CV (editable), the CV's own words, and the reasons for each unticked row:
   - A value that would replace a different one on file is unticked by default. Re-uploading a
     newer CV is therefore safe: it updates the same record, and only what the reviewer ticks.
   - A project that looks like one already on file is unticked. The check compares contract-number
     tokens.
   - Added projects get `contact_match_confidence = 'unconfirmed'` and a `source_note`
     (`From CV "x.pdf" (AI-extracted, confirmed 2026-10-17)`).
   - **Discard** saves nothing.

   The result row records what was applied and which values the reviewer edited.
8. **Not proposed, on purpose:**
   - SANRAL's coded values (`client_type`, `project_type`, `position_code`), because a CV doesn't
     state them;
   - `description` / `signatory_capacity`, which are company decisions;
   - years of experience, which is never stored (computed per tender).

   "Years per skill" from the spec is derived the same way, from `initial_graduated` and the
   project start/end dates the review saves. No new column.
9. **Found but not saved:** other professional bodies (SAICE, SACAP, SACPLAN, SACNASP...) are
   listed on the card as "Also on the CV, not saved", because `people` has no column for them
   (open question 4).
10. **Behaviour change (ai_extract only; `as_is` untouched).** Upload used to queue the four
    standard `generated_cvs` jobs immediately, which built them from a person record that was still
    empty. They are now queued when the reviewer saves, and skipped if a set is already waiting.

## 5. Measured (evidence, not "ran without crashing")

| Input | Result |
| --- | --- |
| Real SANRAL Form B1-B2 PDF (2 pages) | Text read: 11,868 chars, 3,405 after padding is collapsed for the model. 1 SA ID found, and it matches Henning's ID in the real profile. The ID is absent from the outgoing text and the placeholder is present. Quotes `Meng (Civil Engineering)`, `University of Stellenbosch`, `Professional Engineer`, `Beng (Civil Engineering)` and `Kamogelo Molawa` trace back. ECSA number digits are present |
| Real Form B1.pdf (Excel/macOS print) | Text read, 8,052 chars, 1 ID found and redacted |
| Real scans: B2.1CE scan, ECSA certificate, MEng certificate | Refused: "no text layer on any of its 1 page(s) - it is a scan...". No API call |
| Synthetic narrative CV, built in the test (`.docx`; `.pdf` and legacy `.doc` via LibreOffice) | All three read. Registration number, institution and a table cell present. ID redacted, ECSA/phone numbers kept. In the PDF a narrow table column wraps `TMRA/2019/044` as `TMRA/2019/04` / `4`; the quote check still traces it (letters-and-digits pass) |
| PNG photo, image-only PDF, near-empty text, garbled symbols, 160k chars, `.pages` | Each refused with its own reason |
| Hand-written model answers (**test doubles**, not Claude): correct, invented ECSA number, non-SANRAL "MSc" level, quote not in CV, "not a CV", empty, mostly untraceable, two IDs | Each handled as designed (16 checks in `test_extract_cv_fields.py` §3). The correct answer validates against the exact JSON schema sent to the API (`jsonschema`) |
| Queue: in-memory stand-in for Supabase REST, stub LLM client | Missing key: the pass stops, the upload is put back to `extraction_requested` (not failed) and nothing is written. Docx: result stored as `pending_review`, upload `extracted`, ID absent from the request. Scan: `extraction_failed` with its reason, no API call. `as_is` row untouched. Stale `extracting` → failed |
| Migration `0001`→`0023` replayed on scratch Postgres 16 (auth/storage stub) | All apply. On `0023`: upsert on `cv_upload_id` keeps one row per upload, a bad `review_status` is rejected, a member sees only their own company's results and errors, can review (update) their own, updates 0 of another company's rows, can't insert or delete results, can't move a result to another company, and deleting the upload cascades |

Run: `python3 engine/cv/test_extract_cv_fields.py` (now in CI, no secrets). The local tool
`python3 engine/cv/extract_cv_fields.py --file <cv> --text-only` shows exactly what text would be
sent.

## 6. Verified vs not verified

- **Verified for real:**
  - text extraction on real and synthetic files;
  - every refusal path;
  - ID redaction;
  - the quote, digit, enum and date checks;
  - the request the code builds (model, structured-output schema, effort, fallbacks), checked
    against a stub client;
  - the parameter names, checked against the installed `anthropic` 1.15.0 SDK's
    `beta.messages.create` signature (`fallbacks` accepts `"default"`);
  - the queue state machine;
  - the migration and its RLS;
  - typecheck and lint on the review UI.
- **Not verified: no API key in this sandbox.**
  - **The quality of Claude's extraction on any CV.** How well it reads the SANRAL grid, and how
    often it misses or misreads a project, is unmeasured.
  - That the API accepts this exact schema. The anyOf-with-null fields and the enums follow the
    documented structured-output subset, but if the live API rejects part of the schema, every job
    fails with "The AI service rejected this CV's request: ..." and that message names the problem.
  - Real token counts and cost.
  - The fallback path.
- **Not verified: no live Supabase (System-Status Gap #9).** The REST and Storage download calls
  (same pattern as the other bridges) and the People page review card have not been rendered
  against real rows. The `cv_uploads(original_filename)` embed in `applyCvExtraction` relies on the
  single FK from `0023`.

## 7. What Sarel needs to set up

1. **An Anthropic API account**: sign up at console.anthropic.com, add a payment method, and
   create an API key under *API Keys*. Set a monthly spend limit under *Limits*; R500 / about $25
   is far more than CV volume needs.
2. **Set `ANTHROPIC_API_KEY` on the bridge worker**, the Railway service from
   `Automated-Fulfillment-Deployment.md`, next to `NEXT_PUBLIC_SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`. Not on Vercel: the web app never calls the AI. Optionally set
   `CV_EXTRACTION_MODEL`; the default is `claude-opus-5-5`.
3. **Apply migration `0023`** with the rest, then redeploy the worker. The image now installs
   `anthropic`.
4. **First check, before trusting it:** on a machine with the key set, run
   `python3 engine/cv/extract_cv_fields.py --file "<a real team CV>"` for 3-5 real CVs, including
   Henning's Form B1-B2 PDF, and compare the proposals with the CVs. This is the measurement this
   pass couldn't make.

**Rough cost** (Anthropic list prices cached 2026-10-06; Opus 5.5 is $4 per million input tokens
and $20 per million output tokens). One CV is about 1-3k tokens of CV text, plus about 3k of
instructions and schema, so roughly 4-6k input tokens. The output is about 2-5k tokens of JSON
with quotes, plus thinking at medium effort. That puts it at **about $0.05-0.15 per CV (roughly R1-3)**.
A 20-person CV library costs a few dollars once, and re-uploads cost the same per CV. Setting
`CV_EXTRACTION_MODEL=claude-haiku-5-5` ($0.10 / $0.50 per million tokens) would make it about 40
times cheaper, but its accuracy on these forms is unmeasured. These are estimates; the real token
counts are stored per job in `cv_extraction_results.usage`.

**Data handling:** CV text (names, phones, emails, qualifications and project history, but not ID
numbers) is sent to Anthropic's API. Anthropic doesn't train on API data by default. For POPIA, the
company should tell staff their CVs are processed this way. The "use as-is" path sends nothing
anywhere.

## 8. Open questions for Sarel

1. **Real CVs from the rest of the team:** 3-5 of them, in whatever form people really have them, to
   measure extraction against. Only Henning's SANRAL form is in evidence today.
2. **Scans:** about half of the team's person documents in the sample are scans. Should a scanned
   CV go to Claude as a PDF or image, which reads scans at a somewhat higher per-CV cost, with the
   reviewer checking the scan? Or should scans stay "use as-is" only? The quote check can't verify
   a scan's values, so every field would arrive unticked.
3. **Model choice:** keep Opus 5.5 (the default, about R1-3 per CV), or trial Haiku 5.5 once real
   CVs have been measured?
4. **Other registrations** (SAICE, SACAP, SACPLAN, PLATO...) are read but have nowhere to go. Add
   them to `people`? The role catalog (`0016`) already names SACAP/SACPLAN/SACPVP roles.
5. **World Bank fields** (nationality, languages, countries worked in) could be extracted the same
   way once columns exist (`CV-Engine-Findings.md` §5).
