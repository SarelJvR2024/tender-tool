# Company voice ("how we work") - where it is used, and where it is not yet

Audit date: 2026-10-17. Spec: `Tender-Tool-Competitor-Feature-Deep-Dive.md`, section
"No AI-drafted narrative sections - and why: company voice, not AI blabber (Sarel, 2026-10-17)".

## What was built

- **Migration `0030_company_how_we_work.sql`:** `companies.how_we_work text`, null by default,
  with a check constraint capping it at 10 000 characters. No new RLS: the existing
  `companies` member select/update policies (0001) cover it.
- **Company page (`app/app/company/page.tsx`, `actions.ts`):** a "How we work" section under
  Company identity. Read-only view shows the text exactly as saved (line breaks kept); edit view
  is a 10-row textarea. The save action stores the text as typed. It only changes the browser's
  CRLF line endings to LF and trims the start and end. No rewriting, no summarising, no AI call.

**The rule for any engine that uses it:** reproduce the company's text **verbatim**. Don't
paraphrase it, "polish" it, summarise it or extend it with an LLM. Doing any of those turns the
company's own words back into the same generic output for every tenant, which is the problem
this field exists to fix.

## Audit: every output point checked

Engines were checked by reading the code and by grepping `engine/` and `app/` for cover
letters, transmittals, introductions, executive summaries, methodology, capability statements
and similar prose.

| Output point | Has company-facing prose today? | Field wired in? | Why |
| --- | --- | --- | --- |
| `engine/cv/generate_cv.py` tender cover page (`add_cover_page`) | **No.** The page holds structured data only: contract no., closing date, position, candidate, `suggest_pack.py`'s match score and rationale, and a specialism warning. The cover page is about the *candidate's* fit for one position. It contains no company description. | **No** | Adding the company's "how we work" text to every key person's CV cover would put the same company paragraph on every CV in the pack. That is padding, not tailoring. The CV's job is the person's evidence. Nothing here currently produces company prose that this field could replace. |
| `engine/make_envelope_covers.py` (outer / Envelope 1 / Envelope 2 covers) | No. Addressee block, tender block and bidder block (legal name, address, CIPC no.): all structured facts. | No | Envelope covers follow SANRAL's own reference layout. A company narrative doesn't belong on an envelope. |
| `engine/fill_authority_letter.py` (Authority for Signatory letter) | Fixed legal wording, reproduced from Klipcorp's own historical letter. | No | It is a legal authorisation and has to stay in that formal wording. (Separate observation, not in scope here: every tenant gets Klipcorp's letter wording. That is the "don't assume Klipcorp is universal" discipline, not a voice question.) |
| `engine/pack/assemble_pack.py` + `pdf_merge.py` contents page / notes | No. Contents table, page ranges, included/not-included status, draft notice. | No | Structured checklist. There is no cover letter, transmittal note or company introduction anywhere in the SANRAL pack. |
| `engine/general/build_general_pack.py` completion guide | No. It gives instructions to the *user* (which forms are filled, which values to copy by hand). | No | Instructions to the user, not text written to the buyer. There is no cover letter or company introduction in the general pack either. |
| SANRAL Form B4 (quality systems) / B5 (programme / methodology) | **Yes. This is the one real narrative point in a pack.** It is printed from the buyer's own workbook print areas (`print_reports.py`) and **written by hand**. `tender-compilation-playbook.md` item 6 makes "B4/B5 content generation is deliberately NOT a target" a standing rule. | No (engine) | The engine doesn't write this content and shouldn't. The company's "how we work" text is the natural *reference* for whoever writes B4/B5. The honest next step is to **show it beside the "write B4/B5 by hand" action on the Tender Workspace** (read-only, verbatim), not to generate B4/B5 from it. This isn't built in this pass because the Tender Workspace files have uncommitted concurrent work from other agents. It is listed as an open follow-up below. |
| `app/lib/tenderCompliance.ts` / `compliance-report.tsx` | No. Structured requirement/status rows shown to the company itself. | No | It is a readiness check for the company's own team, not a submission document. There is no tone to customise. |
| `engine/notify/daily_digest.py`, `watch_deadlines.py` | No. Internal emails to the company's own staff. | No | Not buyer-facing. |

**Engine plumbing:** `process_pack_jobs.py` and `process_general_jobs.py` already read the
whole `companies` row (`client.select("companies", ...)`), so a future output point in those
engines gets `how_we_work` with no extra query. `process_cv_jobs.py` reads only `legal_name` and
would need `how_we_work` added to its `select` if a CV output point ever needs it.

## Conclusion

The field is captured, editable and stored verbatim. Today **no engine wires it in**, because no
engine produces company-descriptive prose for it to replace. This is the outcome the spec allows
for ("mainly a readiness requirement for when a genuinely free-text/narrative output point
exists"). I didn't build a narrative feature to give the field somewhere to go. A generator that
"uses" the company's text to produce new prose is item 16 by another name, and it would make
100 tenants' submissions read the same again.

## Related finding (flagged, not fixed here): tool-internal boilerplate in submitted CVs

The tender-customized CV is the version `process_pack_jobs.py` merges into the submission pack
(`generated_cvs`, newest ready tender CV per position). It currently prints text that is the
same for every tenant and is aimed at this project's developers, not at a buyer. I verified this
by generating a real CV (`generate_cv.py config/test_companies/complete_co.json 0 ... --tender
... --position PL`) and reading the .docx back:

- "Reproduces the shape of SANRAL's own Form B1.1 ... as a standalone document - see
  docs/specs/CV-Engine-Findings.md section 1." (`build_sanral_keyperson`; the World Bank format
  has the same kind of line)
- "The matching below is the same scoring suggest_pack.py uses to rank candidates ..."
- "Match score: N (suggest_pack.py's own scoring scale, not a percentage)." plus, where it
  applies, "SPECIALISM NOT EVIDENCED ON FILE for this position."

This isn't company voice and isn't fixed in this pass. It is the CV engine's own lane, and it
raises a separate question for Sarel: **is the cover page an internal review aid that should be
stripped from the submitted copy, or meant for the buyer?** If it is meant for the buyer, the
file-path and script-name lines should go and the match score/warning should be reworded. If it
is internal, the pack should merge a cover-less CV. In neither case should the fix be generated
narrative.

## Open follow-ups

1. Show `how_we_work` verbatim (read-only, with a link to edit it on /company) next to the
   B4/B5 "complete by hand" item on the SANRAL Tender Workspace. Do the same in the general
   engine wherever its manifest identifies a buyer form that asks for an approach or methodology
   write-up. This is reference material for the person writing it, not generated content.
2. The CV cover-page boilerplate question above (Sarel's call).
3. Onboarding stays minimal (spec: legal name only). Don't make `how_we_work` an onboarding
   requirement. It is filled in progressively, like the rest of the vault.
